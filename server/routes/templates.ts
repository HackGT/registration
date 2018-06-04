import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as Handlebars from "handlebars";
import * as moment from "moment-timezone";
import * as bowser from "bowser";
import * as uuid from "uuid/v4";

import {
	STATIC_ROOT, STORAGE_ENGINE,
	config, getSetting, renderMarkdown
} from "../common";
import {
	authenticateWithRedirect, isAdmin,
	onlyAllowAnonymousBranch, branchRedirector, ApplicationType
} from "../middleware";
import {
	IUser, IUserMongoose, User,
	ITeamMongoose, Team,
	IIndexTemplate, ILoginTemplate, IAdminTemplate, ITeamTemplate,
	IRegisterBranchChoiceTemplate, IRegisterTemplate, StatisticEntry,
	IFormItem
} from "../schema";
import * as Branches from "../branch";

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
Handlebars.registerHelper("encodeURI", encodeURI);
Handlebars.registerPartial("sidebar", fs.readFileSync(path.resolve(STATIC_ROOT, "partials", "sidebar.html"), "utf8"));

templateRoutes.route("/dashboard").get((request, response) => response.redirect("/"));
templateRoutes.route("/").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;

	let applyBranches: Branches.ApplicationBranch[];

	if (user.applicationBranch) {
		applyBranches = [(await Branches.BranchConfig.loadBranchFromDB(user.applicationBranch))] as Branches.ApplicationBranch[];
	} else {
		applyBranches = (await Branches.BranchConfig.loadAllBranches("Application") as Branches.ApplicationBranch[]);
	}

	let confirmBranches: Branches.ConfirmationBranch[] = [];

	if (user.confirmationBranch) {
		confirmBranches.push(await Branches.BranchConfig.loadBranchFromDB(user.confirmationBranch) as Branches.ConfirmationBranch);
	}

	interface IBranchOpenClose {
		name: string;
		open: Date;
		close: Date;
	}
	interface IDeadlineMap {
		[name: string]: IBranchOpenClose;
	}

	let confirmTimes = confirmBranches.reduce((map, branch) => {
		map[branch.name] = branch;
		return map;
	}, {} as IDeadlineMap);

	if (user.confirmationDeadline) {
		confirmTimes[user.confirmationDeadline.name] = user.confirmationDeadline;
	}
	let confirmTimesArr: IBranchOpenClose[] = Object.keys(confirmTimes).map(name => confirmTimes[name]);

	const dateComparator = (a: Date, b: Date) => (a.valueOf() - b.valueOf());

	let applicationOpenDate: moment.Moment | null = null;
	let applicationCloseDate: moment.Moment | null = null;
	if (applyBranches.length > 0) {
		applicationOpenDate = moment(applyBranches.map(b => b.open).sort(dateComparator)[0]);
		applicationCloseDate = moment(applyBranches.map(b => b.close).sort(dateComparator)[applyBranches.length - 1]);
	}
	let confirmationOpenDate: moment.Moment | null = null;
	let confirmationCloseDate: moment.Moment | null = null;
	if (confirmBranches.length > 0) {
		confirmationOpenDate = moment(confirmTimesArr.map(b => b.open).sort(dateComparator)[0]);
		confirmationCloseDate = moment(confirmTimesArr.map(b => b.close).sort(dateComparator)[confirmBranches.length - 1]);
	}

	function formatMoment(date: moment.Moment | null): string {
		const FORMAT = "dddd, MMMM Do YYYY [at] h:mm a z";
		if (date) {
			return date.tz(moment.tz.guess()).format(FORMAT);
		}
		return "(No branches configured)";
	}
	function formatMoments(open: moment.Moment, close: moment.Moment): { open: string; close: string } {
		let openString = formatMoment(open);
		let closeString = formatMoment(close);
		if (!moment().isBetween(open, close)) {
			closeString += " (Closed)";
		}
		return {
			open: openString,
			close: closeString
		};
	}
	let status = "";

	// Block of logic to dermine status:
	if (!user.applied) {
		status = "Incomplete";
	} else if (user.applied && !user.confirmationBranch) {
		status = "Pending Decision";
	} else if (user.applied && user.confirmationBranch) {
		// After confirmation - they either confirmed in time, did not, or branch did not require confirmation
		if (user.confirmed) {
			if (user.accepted) {
				status = "Attending - " + user.confirmationBranch;
			} else {
				// For confirmation branches that do not accept such as Rejected/Waitlist
				status = user.confirmationBranch;
			}
		} else if (moment().isAfter(confirmTimesArr[0].close)) {
			status = "Confirmation Incomplete - " + user.confirmationBranch;
		} else if (moment().isBefore(confirmTimesArr[0].open)) {
			status = "Confirmation Opens Soon - " + user.confirmationBranch;
		} else {
			status = "Please Confirm - " + user.confirmationBranch;
		}
	}

	let autoConfirm = false;
	if (user.confirmationBranch) {
		autoConfirm = confirmBranches[0].autoConfirm;
	}

	let templateData: IIndexTemplate = {
		siteTitle: config.eventName,
		status,
		autoConfirm,
		user,
		settings: {
			teamsEnabled: await getSetting<boolean>("teamsEnabled"),
			qrEnabled: await getSetting<boolean>("qrEnabled")
		},
		applicationOpen: formatMoment(applicationOpenDate),
		applicationClose: formatMoment(applicationCloseDate),
		applicationStatus: {
			areOpen: applicationOpenDate && applicationCloseDate ? moment().isBetween(applicationOpenDate, applicationCloseDate) : false,
			beforeOpen: applicationOpenDate ? moment().isBefore(applicationOpenDate) : true,
			afterClose: applicationCloseDate ? moment().isAfter(applicationCloseDate) : false
		},
		confirmationOpen: formatMoment(confirmationOpenDate),
		confirmationClose: formatMoment(confirmationCloseDate),
		confirmationStatus: {
			areOpen: confirmationOpenDate && confirmationCloseDate ? moment().isBetween(confirmationOpenDate, confirmationCloseDate) : false,
			beforeOpen: confirmationOpenDate ? moment().isBefore(confirmationOpenDate) : true,
			afterClose: confirmationCloseDate ? moment().isAfter(confirmationCloseDate) : false
		},
		allApplicationTimes: applyBranches.map(branch => {
			return {
				name: branch.name,
				...formatMoments(moment(branch.open), moment(branch.close))
			};
		}),
		allConfirmationTimes: confirmTimesArr.map(branch => {
			return {
				name: branch.name,
				...formatMoments(moment(branch.open), moment(branch.close))
			};
		})
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

templateRoutes.route("/apply").get(
	authenticateWithRedirect,
	branchRedirector(ApplicationType.Application),
	applicationHandler(ApplicationType.Application)
);
templateRoutes.route("/confirm").get(
	authenticateWithRedirect,
	branchRedirector(ApplicationType.Confirmation),
	applicationHandler(ApplicationType.Confirmation)
);

function applicationHandler(requestType: ApplicationType): (request: express.Request, response: express.Response) => Promise<void> {
	return async (request: express.Request, response: express.Response) => {
		let user = request.user as IUser;

		// TODO: integrate this logic with `middleware.branchRedirector` and `middleware.timeLimited`
		let questionBranches: string[] = [];
		// Filter to only show application / confirmation branches
		// NOTE: this assumes the user is still able to apply as this type at this point
		if (requestType === ApplicationType.Application) {
			if (user.applied) {
				questionBranches = [user.applicationBranch.toLowerCase()];
			}
			else {
				const branches = await Branches.BranchConfig.getOpenBranches<Branches.ApplicationBranch>("Application");
				questionBranches = branches.map(branch => branch.name.toLowerCase());
			}
		}
		// Additionally selectively allow confirmation branches based on what the user applied as
		else if (requestType === ApplicationType.Confirmation) {
			if (user.confirmationBranch) {
				questionBranches = [user.confirmationBranch.toLowerCase()];
			} else {
				response.redirect("/");
			}
		}

		let templateData: IRegisterBranchChoiceTemplate = {
			siteTitle: config.eventName,
			user,
			settings: {
				teamsEnabled: await getSetting<boolean>("teamsEnabled"),
				qrEnabled: await getSetting<boolean>("qrEnabled")
			},
			branches: questionBranches
		};

		if (requestType === ApplicationType.Application) {
			response.send(preregisterTemplate(templateData));
		}
		else {
			response.send(preconfirmTemplate(templateData));
		}
	};
}

templateRoutes.route("/register/:branch").get(
	isAdmin,
	onlyAllowAnonymousBranch,
	applicationBranchHandler(ApplicationType.Application, true)
);

templateRoutes.route("/apply/:branch").get(
	authenticateWithRedirect,
	branchRedirector(ApplicationType.Application),
	applicationBranchHandler(ApplicationType.Application, false)
);
templateRoutes.route("/confirm/:branch").get(
	authenticateWithRedirect,
	branchRedirector(ApplicationType.Confirmation),
	applicationBranchHandler(ApplicationType.Confirmation, false)
);

function applicationBranchHandler(requestType: ApplicationType, anonymous: boolean): (request: express.Request, response: express.Response) => Promise<void> {
	return async (request: express.Request, response: express.Response) => {
		let user: IUser;
		if (anonymous) {
			user = new User({
				uuid: uuid(),
				email: ""
			});
		} else {
			user = request.user as IUser;
		}

		let branchName = request.params.branch as string;

		let questionBranches = await Branches.BranchConfig.loadAllBranches();
		let questionBranch = questionBranches.find(branch => branch.name.toLowerCase() === branchName.toLowerCase())!;

		// tslint:disable:no-string-literal
		let questionData = await Promise.all(questionBranch.questions.map(async question => {
			let savedValue: IFormItem | undefined;
			if (user) {
				savedValue = user[requestType === ApplicationType.Application ? "applicationData" : "confirmationData"].find(item => item.name === question.name);
			}

			if (question.type === "checkbox" || question.type === "radio" || question.type === "select") {
				question["multi"] = true;
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
			if (savedValue && question.type === "file" && savedValue.value) {
				savedValue = {
				...savedValue,
					value: (savedValue.value as Express.Multer.File).originalname
				};
			}
			question["value"] = savedValue ? savedValue.value : "";

			if (questionBranch.textBlocks) {
				let textContent: string = (await Promise.all(questionBranch.textBlocks.filter(text => text.for === question.name).map(async text => {
					return `<${text.type}>${await renderMarkdown(text.content, { sanitize: true }, true)}</${text.type}>`;
				}))).join("\n");
				question["textContent"] = textContent;
			}

			return question;
		}));
		// tslint:enable:no-string-literal

		let endText: string = "";
		if (questionBranch.textBlocks) {
			endText = (await Promise.all(questionBranch.textBlocks.filter(text => text.for === "end").map(async text => {
				return `<${text.type} style="font-size: 90%; text-align: center;">${await renderMarkdown(text.content, { sanitize: true }, true)}</${text.type}>`;
			}))).join("\n");
		}

		if (!anonymous) {
			let thisUser = await User.findById(user._id) as IUserMongoose;
			// TODO this is a bug - dates are wrong
			if (requestType === ApplicationType.Application && !thisUser.applicationStartTime) {
				thisUser.applicationStartTime = new Date();
			}
			else if (requestType === ApplicationType.Confirmation && !thisUser.confirmationStartTime) {
				thisUser.confirmationStartTime = new Date();
			}
			await thisUser.save();
		}

		let templateData: IRegisterTemplate = {
			siteTitle: config.eventName,
			unauthenticated: anonymous,
			user: request.user,
			settings: {
				teamsEnabled: await getSetting<boolean>("teamsEnabled"),
				qrEnabled: await getSetting<boolean>("qrEnabled")
			},
			branch: questionBranch.name,
			questionData,
			endText
		};

		if (requestType === ApplicationType.Application) {
			response.send(registerTemplate(templateData));
		} else if (requestType === ApplicationType.Confirmation) {
			response.send(confirmTemplate(templateData));
		}
	};
}

templateRoutes.route("/admin").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;
	if (!user.admin) {
		response.redirect("/");
	}

	let teamsEnabled = await getSetting<boolean>("teamsEnabled");
	let qrEnabled = await getSetting<boolean>("qrEnabled");

	let adminEmails = await User.find({admin: true}).select('email');

	let noopBranches = (await Branches.BranchConfig.loadAllBranches("Noop")) as Branches.NoopBranch[];
	let applicationBranches = (await Branches.BranchConfig.loadAllBranches("Application")) as Branches.ApplicationBranch[];
	let confirmationBranches = (await Branches.BranchConfig.loadAllBranches("Confirmation")) as Branches.ConfirmationBranch[];

	let teamIDNameMap: {
		[id: string]: string;
	} = {};
	(await Team.find()).forEach((team: ITeamMongoose) => {
		teamIDNameMap[team._id.toString()] = team.teamName;
	});

	let templateData: IAdminTemplate = {
		siteTitle: config.eventName,
		user,
		applicationStatistics: {
			totalUsers: await User.find().count(),
			appliedUsers: await User.find({ "applied": true }).count(),
			admittedUsers: await User.find({ "accepted": true }).count(),
			attendingUsers: await User.find({ "confirmed": true }).count(),
			declinedUsers: await User.find({ "accepted": true, "confirmed": false }).count(),
			applicationBranches: await Promise.all(applicationBranches.map(async branch => {
				return {
					"name": branch.name,
					"count": await User.find({ "applicationBranch": branch.name }).count()
				};
			})),
			confirmationBranches: await Promise.all(confirmationBranches.map(async branch => {
				return {
					"name": branch.name,
					"count": await User.find({ "confirmationBranch": branch.name }).count()
				};
			}))
		},
		generalStatistics: [] as StatisticEntry[],
		settings: {
			teamsEnabled,
			teamsEnabledChecked: teamsEnabled ? "checked" : "",
			qrEnabled,
			adminEmails,
			qrEnabledChecked: qrEnabled ? "checked" : "",
			branches: {
				noop: noopBranches.map(branch => {
					return { name: branch.name };
				}),
				application: applicationBranches.map((branch: Branches.ApplicationBranch) => {
					return {
						name: branch.name,
						open: branch.open.toISOString(),
						close: branch.close.toISOString(),
						allowAnonymous: branch.allowAnonymous,
						autoAccept: branch.autoAccept
					};
				}),
				confirmation: confirmationBranches.map((branch: Branches.ConfirmationBranch) => {
					return {
						name: branch.name,
						open: branch.open.toISOString(),
						close: branch.close.toISOString(),
						usesRollingDeadline: branch.usesRollingDeadline,
						autoConfirm: branch.autoConfirm,
						isAcceptance: branch.isAcceptance
					};
				})
			}
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

	interface IApplicationMap {
		[key: string]: Branches.ApplicationBranch;
	}
	let applicationBranchMap = applicationBranches.reduce((map, b) => {
		map[b.name] = b;
		return map;
	}, {} as IApplicationMap);

	// Generate general statistics
	(await User.find({ "applied": true })).forEach(async statisticUser => {
		let appliedBranch = applicationBranchMap[statisticUser.applicationBranch];
		if (!appliedBranch) {
			return;
		}
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
					let statisticEntry: StatisticEntry | undefined = templateData.generalStatistics.find(entry => entry.questionName === rawQuestionLabel && entry.branch === appliedBranch.name);

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
	templateData.generalStatistics = await Promise.all(templateData.generalStatistics.sort((a, b) => {
		if (a.branch.toLowerCase() < b.branch.toLowerCase()) {
			return -1;
		}
		if (a.branch.toLowerCase() > b.branch.toLowerCase()) {
			return 1;
		}
		return 0;
	}).map(async statistic => {
		let questions = (await Branches.BranchConfig.loadBranchFromDB(statistic.branch)).questions;
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
	}));

	response.send(adminTemplate(templateData));
});
