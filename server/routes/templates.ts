import * as fs from "fs";
import * as path from "path";
import { URL } from "url";
import * as express from "express";
import * as Handlebars from "handlebars";
import * as moment from "moment-timezone";
import * as bowser from "bowser";
import * as uuid from "uuid/v4";

import {
	STATIC_ROOT, STORAGE_ENGINE,
	config, getSetting, renderMarkdown, removeTags, renderPageHTML
} from "../common";
import {
	authenticateWithRedirect, isAdmin,
	onlyAllowAnonymousBranch, branchRedirector, ApplicationType,
	postParser
} from "../middleware";
import {
	Model,
	IUser, User,
	ITeam, Team,
	ILoginTemplate, IIndexTemplate, IAdminTemplate, ITeamTemplate,
	IRegisterBranchChoiceTemplate, IInterstitialTemplate, IRegisterTemplate, StatisticEntry,
	IFormItem
} from "../schema";
import * as Branches from "../branch";

export let templateRoutes = express.Router();

export class Template<T> {
	private template: Handlebars.TemplateDelegate<T> | null = null;

	constructor(private readonly file: string) {
		this.loadTemplate();
	}

	private loadTemplate(): void {
		let data = fs.readFileSync(path.resolve(STATIC_ROOT, this.file), "utf8");
		this.template = Handlebars.compile(data);
	}

	public render(input: T): string {
		if (!config.server.isProduction) {
			this.loadTemplate();
		}
		return this.template!(input);
	}
}

const IndexTemplate = new Template<IIndexTemplate>("index.html");
const PreRegisterTemplate = new Template<IRegisterBranchChoiceTemplate>("preapplication.html");
const PreConfirmTemplate = new Template<IRegisterBranchChoiceTemplate>("preconfirmation.html");
const InterstitialTemplate = new Template<IInterstitialTemplate>("interstitial.html");
const RegisterTemplate = new Template<IRegisterTemplate>("application.html");
const ConfirmTemplate = new Template<IRegisterTemplate>("confirmation.html");
const AdminTemplate = new Template<IAdminTemplate>("admin.html");
const UnsupportedTemplate = new Template<{ siteTitle: string }>("unsupported.html");
const TeamTemplate = new Template<ITeamTemplate>("team.html");
const LoginTemplate = new Template<ILoginTemplate>("login.html");

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
		response.send(UnsupportedTemplate.render(templateData));
	}
	else {
		next();
	}
});

// tslint:disable-next-line:no-any
// tslint:disable:no-invalid-this
Handlebars.registerHelper("ifCond", function(v1: any, v2: any, options: any) {
	if (v1 === v2) {
		return options.fn(this);
	}
	return options.inverse(this);
});
Handlebars.registerHelper("ifIn", function<T>(elem: T, list: T[], options: any) {
	if (list.includes(elem)) {
		return options.fn(this);
	}
	return options.inverse(this);
});
// tslint:enable:no-invalid-this
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
Handlebars.registerHelper("join", <T>(arr: T[]): string  => {
	return arr.join(", ");
});
for (let name of ["sidebar", "login-methods", "form"]) {
	Handlebars.registerPartial(name, fs.readFileSync(path.resolve(STATIC_ROOT, "partials", `${name}.html`), "utf8"));
}

templateRoutes.route("/dashboard").get((request, response) => response.redirect("/"));
templateRoutes.route("/").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;

	let applyBranches: Branches.ApplicationBranch[];

	if (user.applicationBranch) {
		applyBranches = [(await Branches.BranchConfig.loadBranchFromDB(user.applicationBranch))] as Branches.ApplicationBranch[];
	}
	else {
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

	if (user.confirmationDeadline && user.confirmationDeadline.name) {
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
			return date.tz(config.server.defaultTimezone).format(FORMAT);
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
	}
	else if (user.applied && !user.confirmationBranch) {
		status = "Submitted";
	}
	else if (user.applied && user.confirmationBranch) {
		// After confirmation - they either confirmed in time, did not, or branch did not require confirmation
		if (user.confirmed) {
			if (user.accepted) {
				status = "Attending - " + user.confirmationBranch;
			}
			else {
				// For confirmation branches that do not accept such as Rejected/Waitlist
				status = user.confirmationBranch;
			}
		}
		else if (moment().isAfter(confirmTimesArr[0].close)) {
			status = "Confirmation Incomplete - " + user.confirmationBranch;
		}
		else if (moment().isBefore(confirmTimesArr[0].open)) {
			status = "Confirmation Opens Soon - " + user.confirmationBranch;
		}
		else {
			status = "Please Confirm - " + user.confirmationBranch;
		}
	}

	let autoConfirm = false;
	if (user.confirmationBranch) {
		autoConfirm = confirmBranches[0].autoConfirm;
	}

	let templateData: IIndexTemplate = {
		siteTitle: config.eventName,
		user,
		timeline: {
			application: "",
			decision: "",
			confirmation: "",
			teamFormation: ""
		},
		status,
		autoConfirm,
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

	// Timeline configuration
	if (user.applied) {
		templateData.timeline.application = "complete";
	}
	else if (templateData.applicationStatus.beforeOpen) {
		templateData.timeline.application = "warning";
	}
	else if (templateData.applicationStatus.afterClose) {
		templateData.timeline.application = "rejected";
	}
	if (user.applied && user.confirmationBranch) {
		templateData.timeline.decision = user.accepted ? "complete" : "rejected";
	}
	if (user.confirmationBranch) {
		if (user.confirmed) {
			templateData.timeline.confirmation = "complete";
		}
		else if (templateData.confirmationStatus.beforeOpen) {
			templateData.timeline.confirmation = "warning";
		}
		else if (templateData.confirmationStatus.afterClose) {
			templateData.timeline.confirmation = "rejected";
		}
	}
	if (user.teamId) {
		templateData.timeline.teamFormation = "complete";
	}

	response.send(IndexTemplate.render(templateData));
});

templateRoutes.route("/login").get(async (request, response) => {
	// Allow redirect to any subpath of registration
	if (request.session && request.query.r && request.query.r.startsWith('/')) {
		request.session.returnTo = request.query.r;
	}

	let errorMessage = request.flash("error") as string[];
	if (request.session && request.session.loginAction === "render") {
		request.session.loginAction = "redirect";
		let templateData = {
			siteTitle: config.eventName,
			isLogOut: true,
			groundTruthLogOut: new URL("/logout", config.secrets.groundTruth.url).toString()
		};
		response.send(LoginTemplate.render(templateData));
	}
	else if (errorMessage.length > 0) {
		let templateData = {
			siteTitle: config.eventName,
			error: errorMessage.join(" "),
			isLogOut: false
		};
		response.send(LoginTemplate.render(templateData));
	}
	else {
		response.redirect("/auth/login");
	}
});

templateRoutes.route("/team").get(authenticateWithRedirect, async (request, response) => {
	let team: ITeam | null = null;
	let membersAsUsers: IUser[] | null = null;
	let teamLeaderAsUser: IUser | null = null;
	let isCurrentUserTeamLeader = false;

	if (request.user && request.user.teamId) {
		team = await Team.findById(request.user.teamId);
		if (team) {
			membersAsUsers = await User.find({
				_id: {
					$in: team.members
				}
			});
			teamLeaderAsUser = await User.findById(team.teamLeader);
			isCurrentUserTeamLeader = teamLeaderAsUser != null && teamLeaderAsUser._id.toString() === request.user._id.toString();
		}
	}

	let templateData: ITeamTemplate = {
		siteTitle: config.eventName,
		user: request.user as IUser,
		team,
		membersAsUsers,
		teamLeaderAsUser,
		isCurrentUserTeamLeader,
		settings: {
			teamsEnabled: await getSetting<boolean>("teamsEnabled"),
			qrEnabled: await getSetting<boolean>("qrEnabled"),
			maxTeamSize: config.maxTeamSize
		}
	};
	response.send(TeamTemplate.render(templateData));
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
	return async (request, response) => {
		let user = request.user as IUser;

		// TODO: integrate this logic with `middleware.branchRedirector` and `middleware.timeLimited`
		let questionBranches: string[] = [];
		// Filter to only show application / confirmation branches
		// NOTE: this assumes the user is still able to apply as this type at this point
		if (requestType === ApplicationType.Application) {
			if (user.applied) {
				questionBranches = [user.applicationBranch!.toLowerCase()];
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
			response.send(PreRegisterTemplate.render(templateData));
		}
		else {
			response.send(PreConfirmTemplate.render(templateData));
		}
	};
}

templateRoutes.route("/register/:branch").get(
	isAdmin,
	onlyAllowAnonymousBranch,
	applicationBranchHandler(ApplicationType.Application, true)
);

templateRoutes.route("/apply/:branch")
	.get(
		authenticateWithRedirect,
		branchRedirector(ApplicationType.Application),
		applicationBranchHandler(ApplicationType.Application, false)
	)
	.post(postParser, interstitialPostHandler);
templateRoutes.route("/confirm/:branch")
	.get(
		authenticateWithRedirect,
		branchRedirector(ApplicationType.Confirmation),
		applicationBranchHandler(ApplicationType.Confirmation, false)
	)
	.post(postParser, interstitialPostHandler);

function interstitialPostHandler(request: express.Request, response: express.Response) {
	if (request.body["interstitial-action"] === "Back") {
		response.redirect("/apply");
		return;
	}
	if (request.session) {
		request.session.interstitialShown = true;
	}
	response.redirect(request.url); // Redirect to a GET of this page
}
function applicationBranchHandler(requestType: ApplicationType, anonymous: boolean): (request: express.Request, response: express.Response) => Promise<void> {
	return async (request, response) => {
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

		let interstitialMarkdown: string = "";
		try {
			interstitialMarkdown = await getSetting<string>(`${questionBranch.name}-interstitial`, false);
		}
		// tslint:disable-next-line:no-empty
		catch {} // Setting retrieval will throw if the setting is unset

		// Show user interstitial for this branch if:
		// 1. The interstitial content is not blank
		// 2. User has not already been shown interstitial for this branch (and clicked Continue)
		// 3. User is applying to this branch for the first time (i.e. is not editing their existing application)
		let interstitialShown = false;
		if (request.session && request.session.interstitialShown) {
			interstitialShown = true;
		}
		let isUserEditing = false;
		if (requestType === ApplicationType.Application && user.applicationBranch) {
			isUserEditing = true;
		}
		if (requestType === ApplicationType.Confirmation && user.confirmationBranch) {
			isUserEditing = true;
		}
		if (interstitialMarkdown.trim() && !interstitialShown && !isUserEditing) {
			response.send(InterstitialTemplate.render({
				siteTitle: config.eventName,
				user,
				settings: {
					teamsEnabled: await getSetting<boolean>("teamsEnabled"),
					qrEnabled: await getSetting<boolean>("qrEnabled")
				},
				html: await renderPageHTML(interstitialMarkdown, user)
			}));
			return;
		}
		if (request.session) {
			request.session.interstitialShown = false;
		}

		// tslint:disable:no-string-literal
		let questionData = await Promise.all(questionBranch.questions.map(async question => {
			let savedValue: IFormItem | undefined;
			if (user) {
				savedValue = (user[requestType === ApplicationType.Application ? "applicationData" : "confirmationData"] || []).find(item => item.name === question.name);
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
				question["hasResponse"] = savedValue && savedValue.value; // Used to determine whether "Please select" is selected in dropdown lists
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
			let thisUser = await User.findById(user._id) as Model<IUser>;
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
			user: request.user as IUser,
			settings: {
				teamsEnabled: await getSetting<boolean>("teamsEnabled"),
				qrEnabled: await getSetting<boolean>("qrEnabled")
			},
			branch: questionBranch.name,
			questionData,
			endText
		};

		if (requestType === ApplicationType.Application) {
			response.send(RegisterTemplate.render(templateData));
		} else if (requestType === ApplicationType.Confirmation) {
			response.send(ConfirmTemplate.render(templateData));
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

	let adminEmails = await User.find({ admin: true }).select("email");

	let noopBranches = (await Branches.BranchConfig.loadAllBranches("Noop")) as Branches.NoopBranch[];
	let applicationBranches = (await Branches.BranchConfig.loadAllBranches("Application")) as Branches.ApplicationBranch[];
	let confirmationBranches = (await Branches.BranchConfig.loadAllBranches("Confirmation")) as Branches.ConfirmationBranch[];

	let teamIDNameMap: {
		[id: string]: string;
	} = {};
	(await Team.find()).forEach(team => {
		teamIDNameMap[team._id.toString()] = team.teamName;
	});

	let preconfiguredAdmins = config.admins.emails.concat(config.admins.domains.map(domain => `*@${domain}`));

	let templateData: IAdminTemplate = {
		siteTitle: config.eventName,
		user,
		applicationStatistics: {
			totalUsers: await User.find().count(),
			appliedUsers: await User.find({ "applied": true }).count(),
			acceptedUsers: await User.find({ "accepted": true }).count(),
			confirmedUsers: await User.find({ "accepted": true, "confirmed": true }).count(),
			nonConfirmedUsers: await User.find({ "accepted": true, "confirmed": false }).count(),
			applicationBranches: await Promise.all(applicationBranches.map(async branch => {
				return {
					"name": branch.name,
					"count": await User.find({ "applicationBranch": branch.name }).count()
				};
			})),
			confirmationBranches: await Promise.all(confirmationBranches.map(async branch => {
				return {
					"name": branch.name,
					"confirmed": await User.find({ "confirmed": true, "confirmationBranch": branch.name }).count(),
					"count": await User.find({ "confirmationBranch": branch.name }).count()
				};
			}))
		},
		generalStatistics: [] as StatisticEntry[],
		settings: {
			teamsEnabled,
			teamsEnabledChecked: teamsEnabled ? "checked" : "",
			qrEnabled,
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
			},
			adminEmails,
			apiKey: config.secrets.adminKey
		},
		config: {
			admins: preconfiguredAdmins.join(", "),
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
		let appliedBranch = applicationBranchMap[statisticUser.applicationBranch!];
		if (!appliedBranch) {
			return;
		}
		statisticUser.applicationData!.forEach(question => {
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
					let questionName = rawQuestion.name;
					let statisticEntry: StatisticEntry | undefined = templateData.generalStatistics.find(entry => entry.questionName === questionName && entry.branch === appliedBranch.name);

					if (!statisticEntry) {
						statisticEntry = {
							questionName,
							questionLabel: removeTags(rawQuestion.label),
							branch: statisticUser.applicationBranch!,
							responses: []
						};
						templateData.generalStatistics.push(statisticEntry);
					}

					checkboxValue = removeTags(checkboxValue);
					let responsesIndex = statisticEntry.responses.findIndex(resp => resp.response === checkboxValue);
					if (responsesIndex !== -1) {
						statisticEntry.responses[responsesIndex].count++;
					}
					else {
						statisticEntry.responses.push({
							response: checkboxValue,
							count: 1
						});
					}
				}
			}
		});
	});
	// Order general statistics as they appear in questions.json
	templateData.generalStatistics = templateData.generalStatistics.sort((a, b) => {
		if (a.branch !== b.branch) {
			// Sort the branches into order
			let branchIndexA = Branches.Branches.indexOf(a.branch);
			let branchIndexB = Branches.Branches.indexOf(b.branch);
			// Sort unknown branches at the end (shouldn't usually happen)
			if (branchIndexA === -1) branchIndexA = Infinity;
			if (branchIndexB === -1) branchIndexB = Infinity;

			return branchIndexA - branchIndexB;
		}
		else {
			if (!Branches.Tags[a.branch] || !Branches.Tags[b.branch]) {
				// If the user applied to a branch that doesn't exist anymore
				return 0;
			}
			// Sort the questions into order
			let questionIndexA = Branches.Tags[a.branch].indexOf(a.questionName);
			let questionIndexB = Branches.Tags[b.branch].indexOf(b.questionName);
			// Sort unknown questions at the end (shouldn't usually happen)
			if (questionIndexA === -1) questionIndexA = Infinity;
			if (questionIndexB === -1) questionIndexB = Infinity;

			return questionIndexA - questionIndexB;
		}
	}).map(question => {
		// Sort question responses into order
		let branchIndex = Branches.Branches.indexOf(question.branch);
		if (branchIndex === -1) {
			// Branch not found; return unchanged
			return question;
		}
		let branch = Branches.QuestionsConfig[branchIndex];

		let branchQuestion = branch.questions.find(q => q.name === question.questionName);
		if (!branchQuestion) {
			// Question not found; return unchanged
			return question;
		}

		if (branchQuestion.type === "checkbox" || branchQuestion.type === "radio" || branchQuestion.type === "select") {
			let options = branchQuestion.options;
			question.responses = question.responses.sort((a, b) => {
				let optionIndexA = options.indexOf(a.response);
				let optionIndexB = options.indexOf(b.response);
				// Sort unknown options at the end (happens for "other" responses)
				if (optionIndexA === -1) optionIndexA = Infinity;
				if (optionIndexB === -1) optionIndexB = Infinity;

				// If both are unknown, sort alphabetically
				if (optionIndexA === Infinity && optionIndexB === Infinity) {
					let responseA = a.response.toLowerCase();
					let responseB = b.response.toLowerCase();
					if (responseA < responseB) return -1;
					if (responseA > responseB) return  1;
					return 0;
				}
				return optionIndexA - optionIndexB;
			});
		}

		return question;
	});

	response.send(AdminTemplate.render(templateData));
});
