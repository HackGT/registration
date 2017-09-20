import * as fs from "fs";
import * as moment from "moment-timezone";
import * as path from "path";
import * as os from "os";

import { config, getSetting, readFileAsync, STATIC_ROOT } from "./common";
import { getOpenConfirmationBranches, BranchConfig, ApplicationBranch, ConfirmationBranch } from "./branch";
import { IUser } from "./schema";

//
// Express middleware
//
import * as express from "express";
import * as bodyParser from "body-parser";
export let postParser = bodyParser.urlencoded({
	extended: false
});

import * as multer from "multer";
import {QuestionBranches} from "./config/questions.schema";

export const MAX_FILE_SIZE = 50000000; // 50 MB
export let uploadHandler = multer({
	"storage": multer.diskStorage({
		destination: (req, file, cb) => {
			// The OS's default temporary directory
			// Should be changed (or moved via fs.rename()) if the files are to be persisted
			cb(null, os.tmpdir());
		},
		filename: (req, file, cb) => {
			cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
		}
	}),
	"limits": {
		"fileSize": MAX_FILE_SIZE,
		"files": getMaxFileUploads()
	}
});

function getMaxFileUploads(): number {
	// Can't use validateSchema() because this function needs to run synchronously to export uploadHandler before it gets used
	let questionBranches: QuestionBranches = JSON.parse(fs.readFileSync(config.questionsLocation, "utf8"));
	let questions = questionBranches.map(branch => branch.questions);
	let fileUploadsPerBranch: number[] = questions.map(branch => {
		return branch.reduce((prev, current) => {
			if (current.type === "file") {
				return prev + 1;
			}
			return prev;
		}, 0);
	});
	return Math.max(...fileUploadsPerBranch);
}

export function isUserOrAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
	response.setHeader("Cache-Control", "private");
	let user = request.user as IUser;
	if (!request.isAuthenticated()) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else if (user._id.toString() !== request.params.id && !user.admin) {
		response.status(403).json({
			"error": "You are not permitted to access this endpoint"
		});
	}
	else {
		next();
	}
}

export function isAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
	response.setHeader("Cache-Control", "private");
	let user = request.user as IUser;
	if (!request.isAuthenticated()) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else if (!user.admin) {
		response.status(403).json({
			"error": "You are not permitted to access this endpoint"
		});
	}
	else {
		next();
	}
}

// For API endpoints
export function authenticateWithReject(request: express.Request, response: express.Response, next: express.NextFunction) {
	response.setHeader("Cache-Control", "no-cache");
	if (!request.isAuthenticated()) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else {
		next();
	}
}
// For directly user facing endpoints
export function authenticateWithRedirect(request: express.Request, response: express.Response, next: express.NextFunction) {
	response.setHeader("Cache-Control", "private");
	if (!request.isAuthenticated()) {
		response.redirect("/login");
	}
	else {
		next();
	}
}
import * as Handlebars from "handlebars";
import { ICommonTemplate } from "./schema";
export enum ApplicationType {
	Application, Confirmation
}
export async function timeLimited(request: express.Request, response: express.Response, next: express.NextFunction) {
	let requestType: ApplicationType = request.url.match(/^\/apply/) ? ApplicationType.Application : ApplicationType.Confirmation;

	let user = request.user as IUser;

	let openBranches: (ApplicationBranch | ConfirmationBranch)[];
	if (requestType === ApplicationType.Application) {
		openBranches = await BranchConfig.getOpenBranches<ApplicationBranch>("Application");
		if (user.applied) {
			openBranches = openBranches.filter((b => b.name === user.applicationBranch));
		}
	}
	else {
		openBranches = await getOpenConfirmationBranches(request.user as IUser);
		if (user.attending) {
			openBranches = openBranches.filter((b => b.name === user.confirmationBranch));
		}
	}

	if (openBranches.length > 0) {
		next();
		return;
	}

	// TODO reimplement open and close times
	/*
	const TIME_FORMAT = "dddd, MMMM Do YYYY [at] h:mm a z";
	*/
	interface IClosedTemplate extends ICommonTemplate {
		type: string;
		/*
		open: {
			time: string;
			verb: string;
		};
		close: {
			time: string;
			verb: string;
		};
		*/
		contactEmail: string;
	}
	let template = Handlebars.compile(await readFileAsync(path.resolve(STATIC_ROOT, "closed.html")));
	let emailParsed = config.email.from.match(/<(.*?)>/);
	let templateData: IClosedTemplate = {
		siteTitle: config.eventName,
		user: request.user,
		settings: {
			teamsEnabled: await getSetting<boolean>("teamsEnabled"),
			qrEnabled: await getSetting<boolean>("qrEnabled")
		},

		type: requestType === ApplicationType.Application ? "Application" : "Confirmation",
		/*
		open: {
			time: openDate.tz(moment.tz.guess()).format(TIME_FORMAT),
			verb: moment().isBefore(openDate) ? "will open" : "opened"
		},
		close: {
			time: closeDate.tz(moment.tz.guess()).format(TIME_FORMAT),
			verb: moment().isBefore(closeDate) ? "will close" : "closed"
		},
		*/
		contactEmail: emailParsed ? emailParsed[1] : config.email.from
	};
	response.send(template(templateData));
}

import { DataLog, HackGTMetrics } from "./schema";
export function trackEvent(action: string, request: express.Request, user?: string, data?: object) {
	let thisEvent: DataLog = {
		action,
		url: request.path,
		time: moment.utc().format(),
		ip: request.ip,
		user,
		userAgent: request.headers["user-agent"] as string
	};
	console.log(thisEvent);
	let tags = {
		action,
		url: request.path,
		ip: request.ip,
		user,
		...data
	};
	let metricsEvent: HackGTMetrics = {
		hackgtmetricsversion: 1,
		serviceName: `registration-${config.eventName.replace(/[^a-zA-Z0-9]/g, "")}-${action}`,
		values: {
			value: 1
		},
		tags
	};
	console.log(JSON.stringify(metricsEvent));
}

export async function hasProperExportKey(request: express.Request, response: express.Response, next: express.NextFunction) {
	let exportKey = await getSetting<string>("exportKey");

	if (exportKey === "") {
		// No export key defined
		response.status(403).json({
			"error": "Fetching exports by key is not supported - please configure it in registration's admin menu"
		});
	} else {
		let userKey = request.params.exportKey;
		if (exportKey === userKey) {
			next();
		} else {
			console.log("Export failed for export key!");
			response.status(401).json({
				"error": "Invalid key!"
			});
		}
	}
}
