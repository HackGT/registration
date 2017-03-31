import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as Handlebars from "handlebars";
import * as moment from "moment-timezone";
import * as bowser from "bowser";

import {
	STATIC_ROOT,
	authenticateWithReject,
	authenticateWithRedirect,
	validateSchema, config
} from "../common";
import {
	IUser, IUserMongoose, User,
	ISetting, ISettingMongoose, Setting,
	ICommonTemplate, IIndexTemplate, ILoginTemplate, IAdminTemplate,
	IRegisterBranchChoiceTemplate, IRegisterTemplate
} from "../schema";
import {QuestionBranches, Questions} from "../config/questions.schema";

export let templateRoutes = express.Router();

// Block IE
templateRoutes.use(async (request, response, next) => {
	// Only block requests for rendered pages
	if (path.extname(request.url) !== "") {
		next();
		return;
	}

	let userAgent = request.headers["user-agent"];
	const minBrowser = {
		msie: "12", // Microsoft Edge+ (no support for IE)
		safari: "7.1" // v7 released 2013
	};
	if (bowser.isUnsupportedBrowser(minBrowser, false, userAgent)) {
		let templateData = {
			siteTitle: config.eventName
		};
		response.send(unsupportedTemplate(templateData));
	}
	else {
		next();
	}
});

// Load and compile Handlebars templates
let [
	indexTemplate,
	loginTemplate,
	preregisterTemplate,
	registerTemplate,
	adminTemplate,
	unsupportedTemplate
] = [
	"index.html",
	"login.html",
	"preapplication.html",
	"application.html",
	"admin.html",
	"unsupported.html"
].map(file => {
	let data = fs.readFileSync(path.resolve(STATIC_ROOT, file), "utf8");
	return Handlebars.compile(data);
});
Handlebars.registerHelper("ifCond", function(v1: any, v2: any, options: any) {
	if (v1 === v2) {
		return options.fn(this);
	}
	return options.inverse(this);
});
Handlebars.registerHelper("required", function (isRequired: boolean) {
	// Adds the "required" form attribute if the element requests to be required
	return isRequired ? "required" : "";
});
Handlebars.registerHelper("checked", function (selected: boolean[], index: number) {
	// Adds the "checked" form attribute if the element was checked previously
	return selected[index] ? "checked" : "";
});
Handlebars.registerHelper("selected", function (selected: boolean[], index: number) {
	// Adds the "selected" form attribute if the element was selected previously
	return selected[index] ? "selected" : "";
});
Handlebars.registerHelper("enabled", function (isEnabled: boolean) {
	// Adds the "disabled" form attribute if the element should be disabled
	return !isEnabled ? "disabled" : "";
});
Handlebars.registerHelper("slug", function (input: string): string {
	return encodeURIComponent(input.toLowerCase());
});
Handlebars.registerHelper("numberFormat", function (n: number): string {
	return n.toLocaleString();
});
Handlebars.registerPartial("sidebar", fs.readFileSync(path.resolve(STATIC_ROOT, "partials", "sidebar.html"), "utf8"));

templateRoutes.route("/dashboard").get((request, response) => response.redirect("/"));
templateRoutes.route("/").get(authenticateWithRedirect, async (request, response) => {
	let templateData: IIndexTemplate = {
		siteTitle: config.eventName,
		user: request.user,
		settings: {
			teamsEnabled: (await Setting.findOne({ "name": "teamsEnabled" })).value as boolean
		},
		applicationClose: moment((await Setting.findOne({ "name": "applicationClose" })).value).tz(moment.tz.guess()).format("dddd, MMMM Do YYYY [at] h:mm:ss a z")
	};
	response.send(indexTemplate(templateData));
});

templateRoutes.route("/login").get((request, response) => {
	let templateData: ILoginTemplate = {
		siteTitle: config.eventName,
		error: request.flash("error"),
		success: request.flash("success")
	};
	response.send(loginTemplate(templateData));
});

templateRoutes.route("/apply").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;
	if (user.applied) {
		response.redirect(`/apply/${encodeURIComponent(user.applicationBranch.toLowerCase())}`);
		return;
	}

	let questionBranches: QuestionBranches;
	try {
		// Path is relative to common.ts, where validateSchema function is implemented
		questionBranches = await validateSchema("./config/questions.json", "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.status(500).send("An error occurred while generating the application options");
		return;
	}
	// If there's only one path, redirect to that
	if (questionBranches.length === 1) {
		response.redirect(`/apply/${encodeURIComponent(questionBranches[0].name.toLowerCase())}`);
		return;
	}
	let templateData: IRegisterBranchChoiceTemplate = {
		siteTitle: config.eventName,
		user: user,
		settings: {
			teamsEnabled: (await Setting.findOne({ "name": "teamsEnabled" })).value as boolean
		},
		branches: questionBranches.map(branch => branch.name)
	};
	response.send(preregisterTemplate(templateData));
});
templateRoutes.route("/apply/:branch").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;
	let branchName = request.params.branch as string;
	if (user.applied && branchName.toLowerCase() !== user.applicationBranch.toLowerCase()) {
		response.redirect(`/apply/${encodeURIComponent(user.applicationBranch.toLowerCase())}`);
		return;
	}

	let questionBranches: QuestionBranches;
	try {
		// Path is relative to common.ts, where validateSchema function is implemented
		questionBranches = await validateSchema("./config/questions.json", "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.status(500).send("An error occurred while generating the application form");
		return;
	}
	let questionBranch = questionBranches.find(branch => branch.name.toLowerCase() === branchName.toLowerCase());
	if (!questionBranch) {
		response.status(400).send("Invalid application branch");
		return;
	}
	let questionData = questionBranch.questions.map(question => {
		let savedValue = user.applicationData.find(item => item.name === question.name);
		if (question.type === "checkbox" || question.type === "radio" || question.type === "select") {
			question["multi"] = true;
			if (question.hasOther) {
				question.options.push("Other");
			}
			question["selected"] = question.options.map(option => {
				if (savedValue && Array.isArray(savedValue.value)) {
					return savedValue.value.indexOf(option) !== -1;
				}
				else if (savedValue !== undefined) {
					return option === savedValue.value;
				}
				return false;
			});
			if (question.hasOther && savedValue) {
				if (!Array.isArray(savedValue.value)) {
					// Select / radio buttons
					if (savedValue.value !== null && question.options.indexOf(savedValue.value as string) === -1) {
						question["selected"][question.options.length - 1] = true; // The "Other" pushed earlier
						question["otherSelected"] = true;
						question["otherValue"] = savedValue.value;
					}
				}
				else {
					// Checkboxes
					for (let value of savedValue.value as string[]) {
						if (question.options.indexOf(value) === -1) {
							question["selected"][question.options.length - 1] = true; // The "Other" pushed earlier
							question["otherSelected"] = true;
							question["otherValue"] = value;
						}
					}
				}
			}
		}
		else {
			question["multi"] = false;
		}
		if (question.type === "file") {
			savedValue = undefined;
		}
		question["value"] = savedValue ? savedValue.value : "";
		return question;
	});
	let templateData: IRegisterTemplate = {
		siteTitle: config.eventName,
		user: request.user,
		settings: {
			teamsEnabled: (await Setting.findOne({ "name": "teamsEnabled" })).value as boolean
		},
		branch: questionBranch.name,
		questionData: questionData
	};
	response.send(registerTemplate(templateData));
});

templateRoutes.route("/admin").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;
	if (!user.admin) {
		response.redirect("/");
	}
	let rawQuestions = await validateSchema("./config/questions.json", "./config/questions.schema.json");

	let teamsEnabled = (await Setting.findOne({ "name": "teamsEnabled" })).value as boolean;
	let templateData: IAdminTemplate = {
		siteTitle: config.eventName,
		user: user,
		branchNames: rawQuestions.map(branch => branch.name),
		applicationStatistics: {
			totalUsers: await User.find().count(),
			appliedUsers: await User.find({ "applied": true }).count(),
			admittedUsers: await User.find({ "accepted": true }).count(),
			attendingUsers: await User.find({ "attending": true }).count(),
			declinedUsers: await User.find({ "accepted": true, "attending": false }).count()
		},
		generalStatistics: [],
		users: (await User.find()).sort((a, b) => {
			if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
			if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;
			return 0;
		}).map(user => {
			let loginMethods: string[] = [];
			if (user.githubData && user.githubData.id) {
				loginMethods.push("GitHub");
			}
			if (user.googleData && user.googleData.id) {
				loginMethods.push("Google");
			}
			if (user.facebookData && user.facebookData.id) {
				loginMethods.push("Facebook");
			}
			if (user.localData && user.localData.hash) {
				loginMethods.push("Local");
			}
			let status: string = "Signed up";
			if (user.applied) {
				status = `Applied (${user.applicationBranch})`;
			}
			if (user.accepted) {
				status = `Accepted (${user.applicationBranch})`;
			}
			if (user.attending) {
				status = `Attending (${user.applicationBranch})`;
			}
			return {
				...user.toObject(),
				"status": status,
				"loginMethods": loginMethods.join(", ")
			};
		}),
		metrics: {},
		settings: {
			application: {
				open: (await Setting.findOne({ "name": "applicationOpen" })).value,
				close: (await Setting.findOne({ "name": "applicationClose" })).value,
			},
			teamsEnabled: teamsEnabled,
			teamsEnabledChecked: teamsEnabled ? "checked" : ""
		}
	};
	// Generate general statistics
	(await User.find({ "applied": true })).forEach(user => {
		user.applicationData.forEach(question => {
			if (question.value === null) return;
			if (question.type === "checkbox" || question.type === "radio" || question.type === "select") {
				let values: string[];
				if (!Array.isArray(question.value)) {
					values = [question.value as string];
				}
				else {
					values = question.value as string[];
				}
				for (let checkboxValue of values) {
					let rawQuestion = rawQuestions.find(branch => branch.name === user.applicationBranch)!.questions.find(q => q.name === question.name);
					let title = `${user.applicationBranch} → ${rawQuestion ? rawQuestion.label : question.name} → ${checkboxValue}`;
					let index = templateData.generalStatistics.findIndex(stat => stat.title === title);
					if (index !== -1) {
						templateData.generalStatistics[index].value++;
					}
					else {
						templateData.generalStatistics.push({
							"title": title,
							"value": 1
						});
					}
				}
			}
			else if (question.type === "date") {
				// Categorize by date
				let years = moment().diff(moment(question.value as string), "years", true);

				let rawQuestion = rawQuestions.find(branch => branch.name === user.applicationBranch)!.questions.find(q => q.name === question.name);
				let title = `${user.applicationBranch} → ${rawQuestion ? rawQuestion.label : question.name} (average)`;
				let index = templateData.generalStatistics.findIndex(stat => stat.title === title);
				if (index !== -1) {
					templateData.generalStatistics[index].value += years;
					templateData.generalStatistics[index].count = 1;
				}
				else {
					templateData.generalStatistics.push({
						"title": title,
						"value": years,
						"count": 1
					});
				}
			}
		});
	});
	// Finalize calculation of averages
	templateData.generalStatistics = templateData.generalStatistics.map(stat => {
		if (typeof stat.count === "number") {
			stat.value /= stat.count;
		}
		return stat;
	});
	// Sort general statistics alphabetically
	templateData.generalStatistics = templateData.generalStatistics.sort((a, b) => {
		if (a.title.toLowerCase() < b.title.toLowerCase()) return -1;
		if (a.title.toLowerCase() > b.title.toLowerCase()) return 1;
		return 0;
	});

	response.send(adminTemplate(templateData));
});
