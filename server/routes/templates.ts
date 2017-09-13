import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as Handlebars from "handlebars";
import * as moment from "moment-timezone";
import * as bowser from "bowser";

import {
	STATIC_ROOT, STORAGE_ENGINE,
	authenticateWithRedirect,
	timeLimited, ApplicationType,
	config, getSetting, renderMarkdown
} from "../common";
import {
	IUser, IUserMongoose, User,
	ITeamMongoose, Team,
	IIndexTemplate, ILoginTemplate, IAdminTemplate, ITeamTemplate,
	IRegisterBranchChoiceTemplate, IRegisterTemplate, StatisticEntry,
	ApplicationToConfirmationMap
} from "../schema";
import {QuestionBranches} from "../config/questions.schema";

export let templateRoutes = express.Router();

// Load and compile Handlebars templates
let [
	indexTemplate,
	loginTemplate,
	forgotPasswordTemplate,
	resetPasswordTemplate,
	preregisterTemplate,
	preconfirmTemplate,
	registerTemplate,
	confirmTemplate,
	adminTemplate,
	unsupportedTemplate,
	teamTemplate
] = [
	"index.html",
	"login.html",
	"forgotpassword.html",
	"resetpassword.html",
	"preapplication.html",
	"preconfirmation.html",
	"application.html",
	"confirmation.html",
	"admin.html",
	"unsupported.html",
	"team.html"
].map(file => {
	let data = fs.readFileSync(path.resolve(STATIC_ROOT, file), "utf8");
	return Handlebars.compile(data);
});

// Block IE
templateRoutes.use(async (request, response, next) => {
	// Only block requests for rendered pages
	if (path.extname(request.url) !== "") {
		next();
		return;
	}

	let userAgent = request.headers["user-agent"] as string | undefined;
	const minBrowser = {
		msie: "12", // Microsoft Edge+ (no support for IE)
		safari: "7.1" // Safari v7 was released in 2013
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

// tslint:disable-next-line:no-any
Handlebars.registerHelper("ifCond", function(v1: any, v2: any, options: any) {
	if (v1 === v2) {
		// tslint:disable-next-line:no-invalid-this
		return options.fn(this);
	}
	// tslint:disable-next-line:no-invalid-this
	return options.inverse(this);
});
Handlebars.registerHelper("required", (isRequired: boolean) => {
	// Adds the "required" form attribute if the element requests to be required
	return isRequired ? "required" : "";
});
Handlebars.registerHelper("checked", (selected: boolean[], index: number) => {
	// Adds the "checked" form attribute if the element was checked previously
	return selected[index] ? "checked" : "";
});
Handlebars.registerHelper("branchChecked", (map: ApplicationToConfirmationMap, applicationBranch: string, confirmationBranch: string) => {
	return (map && map[applicationBranch] && map[applicationBranch].indexOf(confirmationBranch) !== -1) ? "checked" : "";
});
Handlebars.registerHelper("selected", (selected: boolean[], index: number) => {
	// Adds the "selected" form attribute if the element was selected previously
	return selected[index] ? "selected" : "";
});
Handlebars.registerHelper("enabled", (isEnabled: boolean) => {
	// Adds the "disabled" form attribute if the element should be disabled
	return !isEnabled ? "disabled" : "";
});
Handlebars.registerHelper("slug", (input: string): string => {
	return encodeURIComponent(input.toLowerCase());
});
Handlebars.registerHelper("numberFormat", (n: number): string => {
	return n.toLocaleString();
});
Handlebars.registerHelper("toLowerCase", (n: number): string => {
	return n.toString().toLowerCase();
});
Handlebars.registerHelper("toJSONString", (stat: StatisticEntry): string => {
	return JSON.stringify(stat);
});
Handlebars.registerHelper("removeSpaces", (input: string): string => {
	return input.replace(/ /g, "-");
});
Handlebars.registerPartial("sidebar", fs.readFileSync(path.resolve(STATIC_ROOT, "partials", "sidebar.html"), "utf8"));

templateRoutes.route("/dashboard").get((request, response) => response.redirect("/"));
templateRoutes.route("/").get(authenticateWithRedirect, async (request, response) => {
	let applicationOpenDate = moment(await getSetting<Date>("applicationOpen"));
	let applicationCloseDate = moment(await getSetting<Date>("applicationClose"));
	let confirmationOpenDate = moment(await getSetting<Date>("confirmationOpen"));
	let confirmationCloseDate = moment(await getSetting<Date>("confirmationClose"));

	let templateData: IIndexTemplate = {
		siteTitle: config.eventName,
		user: request.user,
		settings: {
			teamsEnabled: await getSetting<boolean>("teamsEnabled"),
			qrEnabled: await getSetting<boolean>("qrEnabled")
		},

		applicationOpen: applicationOpenDate.tz(moment.tz.guess()).format("dddd, MMMM Do YYYY [at] h:mm a z"),
		applicationClose: applicationCloseDate.tz(moment.tz.guess()).format("dddd, MMMM Do YYYY [at] h:mm a z"),
		applicationStatus: {
			areOpen: moment().isBetween(applicationOpenDate, applicationCloseDate),
			beforeOpen: moment().isBefore(applicationOpenDate),
			afterClose: moment().isAfter(applicationCloseDate)
		},

		confirmationOpen: confirmationOpenDate.tz(moment.tz.guess()).format("dddd, MMMM Do YYYY [at] h:mm a z"),
		confirmationClose: confirmationCloseDate.tz(moment.tz.guess()).format("dddd, MMMM Do YYYY [at] h:mm a z"),
		confirmationStatus: {
			areOpen: moment().isBetween(confirmationOpenDate, confirmationCloseDate),
			beforeOpen: moment().isBefore(confirmationOpenDate),
			afterClose: moment().isAfter(confirmationCloseDate)
		}
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
templateRoutes.route("/login/forgot").get((request, response) => {
	let templateData: ILoginTemplate = {
		siteTitle: config.eventName,
		error: request.flash("error"),
		success: request.flash("success")
	};
	response.send(forgotPasswordTemplate(templateData));
});
templateRoutes.get("/auth/forgot/:code", async (request, response) => {
	let user = await User.findOne({ "localData.resetCode": request.params.code });
	if (!user) {
		request.flash("error", "Invalid password reset code");
		response.redirect("/login");
		return;
	}
	else if (!user.localData!.resetRequested || Date.now() - user.localData!.resetRequestedTime.valueOf() > 1000 * 60 * 60) {
		request.flash("error", "Your password reset link has expired. Please request a new one.");
		user.localData!.resetCode = "";
		user.localData!.resetRequested = false;
		await user.save();
		response.redirect("/login");
		return;
	}
	let templateData: ILoginTemplate = {
		siteTitle: config.eventName,
		error: request.flash("error"),
		success: request.flash("success")
	};
	response.send(resetPasswordTemplate(templateData));
});

templateRoutes.route("/team").get(authenticateWithRedirect, async (request, response) => {
	let team: ITeamMongoose | null = null;
	let membersAsUsers: IUserMongoose[] | null = null;
	let teamLeaderAsUser: IUserMongoose | null = null;
	let isCurrentUserTeamLeader = false;

	if (request.user.teamId) {
		team = await Team.findById(request.user.teamId) as ITeamMongoose;
		membersAsUsers = await User.find({
			_id: {
				$in: team.members
			}
		});
		teamLeaderAsUser = await User.findById(team.teamLeader) as IUserMongoose;
		isCurrentUserTeamLeader = teamLeaderAsUser._id.toString() === request.user._id.toString();
	}

	let templateData: ITeamTemplate = {
		siteTitle: config.eventName,
		user: request.user,
		team,
		membersAsUsers,
		teamLeaderAsUser,
		isCurrentUserTeamLeader,
		settings: {
			teamsEnabled: await getSetting<boolean>("teamsEnabled"),
			qrEnabled: await getSetting<boolean>("qrEnabled")
		}
	};
	response.send(teamTemplate(templateData));
});

templateRoutes.route("/apply").get(authenticateWithRedirect, timeLimited, applicationHandler);
templateRoutes.route("/confirm").get(authenticateWithRedirect, timeLimited, applicationHandler);

async function applicationHandler(request: express.Request, response: express.Response) {
	let requestType: ApplicationType = request.url.match(/^\/apply/) ? ApplicationType.Application : ApplicationType.Confirmation;

	let user = request.user as IUser;
	if (requestType === ApplicationType.Application && user.accepted) {
		response.redirect("/confirm");
		return;
	}
	if (requestType === ApplicationType.Confirmation && (!user.accepted || !user.applied)) {
		response.redirect("/apply");
		return;
	}
	if (requestType === ApplicationType.Application && user.applied) {
		response.redirect(`/apply/${encodeURIComponent(user.applicationBranch.toLowerCase())}`);
		return;
	}
	else if (requestType === ApplicationType.Confirmation && user.attending) {
		response.redirect(`/confirm/${encodeURIComponent(user.confirmationBranch.toLowerCase())}`);
		return;
	}

	let questionBranches: QuestionBranches;
	try {
		// Path is relative to common.ts, where validateSchema function is implemented
		questionBranches = await validateSchema(config.questions, "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.status(500).send("An error occurred while generating the application options");
		return;
	}
	// Filter to only show application / confirmation branches
	let applicationBranches = await getSetting<string[]>(requestType === ApplicationType.Application ? "applicationBranches" : "confirmationBranches");
	questionBranches = questionBranches.filter(branch => applicationBranches.indexOf(branch.name) !== -1);
	// Additionally selectively allow confirmation branches based on what the user applied as
	if (requestType === ApplicationType.Confirmation) {
		let applicationToConfirmationMap: ApplicationToConfirmationMap = await getSetting<ApplicationToConfirmationMap>("applicationToConfirmation");
		let allowedBranches: string[] = [];
		if (applicationToConfirmationMap && applicationToConfirmationMap[user.applicationBranch]) {
			allowedBranches = applicationToConfirmationMap[user.applicationBranch];
		}
		questionBranches = questionBranches.filter(branch => allowedBranches.indexOf(branch.name) !== -1);
	}

	// If there's only one path, redirect to that
	if (questionBranches.length === 1) {
		response.redirect(`/${requestType === ApplicationType.Application ? "apply" : "confirm"}/${encodeURIComponent(questionBranches[0].name.toLowerCase())}`);
		return;
	}
	let templateData: IRegisterBranchChoiceTemplate = {
		siteTitle: config.eventName,
		user,
		settings: {
			teamsEnabled: await getSetting<boolean>("teamsEnabled"),
			qrEnabled: await getSetting<boolean>("qrEnabled")
		},
		branches: questionBranches.map(branch => branch.name)
	};
	response.send(requestType === ApplicationType.Application ? preregisterTemplate(templateData) : preconfirmTemplate(templateData));
}

templateRoutes.route("/apply/:branch").get(authenticateWithRedirect, timeLimited, applicationBranchHandler);
templateRoutes.route("/confirm/:branch").get(authenticateWithRedirect, timeLimited, applicationBranchHandler);

async function applicationBranchHandler(request: express.Request, response: express.Response) {
	let requestType: ApplicationType = request.url.match(/^\/apply/) ? ApplicationType.Application : ApplicationType.Confirmation;

	let user = request.user as IUser;

	if (requestType === ApplicationType.Confirmation && (!user.accepted || !user.applied)) {
		response.redirect("/apply");
		return;
	}

	let branchName = request.params.branch as string;
	if (requestType === ApplicationType.Application && user.applied && branchName.toLowerCase() !== user.applicationBranch.toLowerCase()) {
		response.redirect(`/apply/${encodeURIComponent(user.applicationBranch.toLowerCase())}`);
		return;
	}
	else if (requestType === ApplicationType.Confirmation && user.attending && branchName.toLowerCase() !== user.confirmationBranch.toLowerCase()) {
		response.redirect(`/confirm/${encodeURIComponent(user.confirmationBranch.toLowerCase())}`);
		return;
	}
	let allowedBranches = (await getSetting<ApplicationToConfirmationMap>("applicationToConfirmation"))[user.applicationBranch] || [];
	allowedBranches = allowedBranches.map(allowedBranchName => allowedBranchName.toLowerCase());
	if (requestType === ApplicationType.Confirmation && allowedBranches.indexOf(branchName.toLowerCase()) === -1) {
		response.redirect("/confirm");
		return;
	}

	let questionBranches: QuestionBranches;
	try {
		// Path is relative to common.ts, where validateSchema function is implemented
		questionBranches = await validateSchema(config.questions, "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.status(500).send("An error occurred while generating the application form");
		return;
	}
	let questionBranch = questionBranches.find(branch => branch.name.toLowerCase() === branchName.toLowerCase())!;
	if (!questionBranch) {
		response.status(400).send("Invalid application branch");
		return;
	}
	// tslint:disable:no-string-literal
	let questionData = await Promise.all(questionBranch.questions.map(async question => {
		let savedValue = user[requestType === ApplicationType.Application ? "applicationData" : "confirmationData"].find(item => item.name === question.name);
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
		if (savedValue && question.type === "file") {
			savedValue = {
				...savedValue,
				value: (savedValue.value as Express.Multer.File).originalname
			};
		}
		question["value"] = savedValue ? savedValue.value : "";

		if (questionBranch.text) {
			let textContent: string = (await Promise.all(questionBranch.text.filter(text => text.for === question.name).map(async text => {
				return `<${text.type}>${await renderMarkdown(text.content, { sanitize: true }, true)}</${text.type}>`;
			}))).join("\n");
			question["textContent"] = textContent;
		}

		return question;
	}));
	// tslint:enable:no-string-literal

	let endText: string = "";
	if (questionBranch.text) {
		endText = (await Promise.all(questionBranch.text.filter(text => text.for === "end").map(async text => {
			return `<${text.type} style="font-size: 90%; text-align: center;">${await renderMarkdown(text.content, { sanitize: true }, true)}</${text.type}>`;
		}))).join("\n");
	}

	let thisUser = await User.findById(user._id) as IUserMongoose;
	if (requestType === ApplicationType.Application) {
		thisUser.applicationStartTime = new Date();
	}
	else if (requestType === ApplicationType.Confirmation) {
		thisUser.confirmationStartTime = new Date();
	}
	await thisUser.save();

	let templateData: IRegisterTemplate = {
		siteTitle: config.eventName,
		user: request.user,
		settings: {
			teamsEnabled: await getSetting<boolean>("teamsEnabled"),
			qrEnabled: await getSetting<boolean>("qrEnabled")
		},
		branch: questionBranch.name,
		questionData,
		endText
	};

	response.send(requestType === ApplicationType.Application ? registerTemplate(templateData) : confirmTemplate(templateData));
}

templateRoutes.route("/admin").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;
	if (!user.admin) {
		response.redirect("/");
	}
	let rawQuestions = await validateSchema(config.questions, "./config/questions.schema.json");

	let teamsEnabled = await getSetting<boolean>("teamsEnabled");
	let qrEnabled = await getSetting<boolean>("qrEnabled");
	let applicationBranches = await getSetting<string[]>("applicationBranches");
	let confirmationBranches = await getSetting<string[]>("confirmationBranches");

	let teamIDNameMap: {
		[id: string]: string;
	} = {};
	(await Team.find()).forEach((team: ITeamMongoose) => {
		teamIDNameMap[team._id.toString()] = team.teamName;
	});

	let templateData: IAdminTemplate = {
		siteTitle: config.eventName,
		user,
		branchNames: rawQuestions.map(branch => branch.name),
		applicationStatistics: {
			totalUsers: await User.find().count(),
			appliedUsers: await User.find({ "applied": true }).count(),
			admittedUsers: await User.find({ "accepted": true }).count(),
			attendingUsers: await User.find({ "attending": true }).count(),
			declinedUsers: await User.find({ "accepted": true, "attending": false }).count(),
			applicationBranches: await Promise.all(applicationBranches.map(async branch => {
				return {
					"name": branch,
					"count": await User.find({ "applicationBranch": branch }).count()
				};
			})),
			confirmationBranches: await Promise.all(confirmationBranches.map(async branch => {
				return {
					"name": branch,
					"count": await User.find({ "confirmationBranch": branch }).count()
				};
			}))
		},
		generalStatistics: [] as StatisticEntry[],
		metrics: {},
		settings: {
			application: {
				open: await getSetting<string>("applicationOpen"),
				close: await getSetting<string>("applicationClose")
			},
			confirmation: {
				open: await getSetting<string>("confirmationOpen"),
				close: await getSetting<string>("confirmationClose")
			},
			teamsEnabled,
			teamsEnabledChecked: teamsEnabled ? "checked" : "",
			qrEnabled,
			qrEnabledChecked: qrEnabled ? "checked" : "",
			branchRoles: {
				"noop": rawQuestions.map(branch => branch.name).filter(branchName => applicationBranches.indexOf(branchName) === -1 && confirmationBranches.indexOf(branchName) === -1),
				"applicationBranches": applicationBranches,
				"confirmationBranches": confirmationBranches
			},
			applicationToConfirmationMap: await getSetting<ApplicationToConfirmationMap>("applicationToConfirmation")
		},
		config: {
			admins: config.admins.join(", "),
			eventName: config.eventName,
			storageEngine: config.storageEngine.name,
			uploadDirectoryRaw: config.storageEngine.options.uploadDirectory,
			uploadDirectoryResolved: STORAGE_ENGINE.uploadRoot,
			maxTeamSize: config.maxTeamSize.toString()
		}
	};
	// Generate general statistics
	(await User.find({ "applied": true })).forEach(statisticUser => {
		let appliedBranch = rawQuestions.find(branch => branch.name === statisticUser.applicationBranch);
		if (!appliedBranch) {
			return;
		}
		let branchName = statisticUser.applicationBranch;
		statisticUser.applicationData.forEach(question => {
			if (question.value === null) {
				return;
			}
			if (question.type === "checkbox" || question.type === "radio" || question.type === "select") {
				let values: string[];
				if (!Array.isArray(question.value)) {
					values = [question.value as string];
				}
				else {
					values = question.value as string[];
				}
				for (let checkboxValue of values) {
					let rawQuestion = appliedBranch!.questions.find(q => q.name === question.name);
					if (!rawQuestion) {
						continue;
					}
					let rawQuestionLabel = rawQuestion.label;
					let statisticEntry: StatisticEntry | undefined = templateData.generalStatistics.find(entry => entry.questionName === rawQuestionLabel && entry.branch === branchName);

					if (!statisticEntry) {
						statisticEntry = {
							"questionName": rawQuestionLabel,
							"branch": statisticUser.applicationBranch,
							"responses": []
						};
						templateData.generalStatistics.push(statisticEntry);
					}

					let responsesIndex = statisticEntry.responses.findIndex(resp => resp.response === checkboxValue);
					if (responsesIndex !== -1) {
						statisticEntry.responses[responsesIndex].count++;
					}
					else {
						statisticEntry.responses.push({
							"response": checkboxValue,
							"count": 1
						});
					}
				}
			}
			/*else if (question.type === "date") {
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
			}*/
		});
	});
	// Order general statistics as they appear in questions.json
	templateData.generalStatistics = templateData.generalStatistics.sort((a, b) => {
		if (a.branch.toLowerCase() < b.branch.toLowerCase()) {
			return -1;
		}
		if (a.branch.toLowerCase() > b.branch.toLowerCase()) {
			return 1;
		}
		return 0;
	}).map(statistic => {
		let questions = rawQuestions.find(branch => branch.name === statistic.branch)!.questions;
		let question = questions.find(q => q.label === statistic.questionName)!;

		statistic.responses = statistic.responses.sort((a, b) => {
			let aIndex: number = question.options.indexOf(a.response);
			let bIndex: number = question.options.indexOf(b.response);

			if (aIndex !== -1 && bIndex === -1) {
				return -1;
			}
			if (aIndex === -1 && bIndex !== -1) {
				return 1;
			}
			if (aIndex === -1 && bIndex === -1) {
				if (a.response.trim() === "") {
					return 1;
				}
				if (a.response.toLowerCase() < b.response.toLowerCase()) {
					return -1;
				}
				if (a.response.toLowerCase() > b.response.toLowerCase()) {
					return 1;
				}
				return 0;
			}
			return aIndex - bIndex;
		});

		return statistic;
	});

	response.send(adminTemplate(templateData));
});
