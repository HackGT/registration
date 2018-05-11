import * as fs from "fs";
import * as moment from "moment-timezone";
import * as path from "path";
import * as os from "os";

import { config, isBranchOpen } from "./common";
import { BranchConfig, ApplicationBranch } from "./branch";
import { User, IUser } from "./schema";
import * as Branches from "./branch";

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
	else if (user.uuid !== request.params.uuid && !user.admin) {
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
	const auth = request.headers.authorization;

	if (auth && typeof auth === "string" && auth.indexOf(" ") > -1) {
		const key = new Buffer(auth.split(" ")[1], "base64").toString();
		if (key === config.secrets.adminKey) {
			next();
		}
		else {
			response.status(401).json({
				"error": "Incorrect auth token!"
			});
		}
	}
	else if (!request.isAuthenticated()) {
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

export enum ApplicationType {
	Application, Confirmation
}

export async function onlyAllowAnonymousBranch(request: express.Request, response: express.Response, next: express.NextFunction) {
	let branchName = request.params.branch as string;
	let questionBranches = (await BranchConfig.loadAllBranches()).filter(br => {
		return br.name.toLowerCase() === branchName.toLowerCase();
	});
	if (questionBranches.length !== 1) {
		response.redirect("/");
		return;
	}

	let branch = questionBranches[0] as ApplicationBranch;
	if (!branch.allowAnonymous) {
		response.redirect("/");
		return;
	}

	next();
}
export async function canUserModify(request: express.Request, response: express.Response, next: express.NextFunction) {
	let user = await User.findOne({uuid: request.params.uuid}) as IUser;
	let branchName = request.params.branch as string;
	let questionBranch = (await Branches.BranchConfig.loadAllBranches()).find(branch => branch.name.toLowerCase() === branchName.toLowerCase());

	if (!(await isBranchOpen(request.params.branch, user, questionBranch instanceof Branches.ApplicationBranch ? ApplicationType.Application : ApplicationType.Confirmation))) {
		response.status(400).json({
			"error": "Branch is closed"
		});
		return;
	}

	if (questionBranch instanceof Branches.ApplicationBranch) {
		// Don't allow user to modify application if we assigned them a confirmation branch
		if (user.confirmationBranch) {
			response.status(400).json({
				"error": "You can no longer edit this application"
			});
			return;
		}
		if (user.applied && branchName.toLowerCase() !== user.applicationBranch.toLowerCase()) {
			response.status(400).json({
				"error": "You can only edit the application branch that you originally submitted"
			});
			return;
		}
	} else if (questionBranch instanceof Branches.ConfirmationBranch) {
		if (!user.confirmationBranch) {
			response.status(400).json({
				"error": "You can't confirm for that branch"
			});
		} else if (user.confirmationBranch && branchName.toLowerCase() !== user.confirmationBranch.toLowerCase()) {
			response.status(400).json({
				"error": "You can only submit the confirmation branch you were assigned"
			});
			return;
		}
	} else {
		response.status(400).json({
			"error": "Invalid application branch"
		});
		return;
	}

	next();
}
export function branchRedirector(requestType: ApplicationType): (request: express.Request, response: express.Response, next: express.NextFunction) => Promise<void> {
	return async (request: express.Request, response: express.Response, next: express.NextFunction) => {
		// TODO: fix branch names so they have a machine ID and human label
		let user = request.user as IUser;

		if (requestType === ApplicationType.Application && user.confirmationBranch) {
			response.redirect("/");
			return;
		}

		if (requestType === ApplicationType.Confirmation && !user.confirmationBranch) {
			response.redirect("/");
			return;
		}

		if (request.params.branch) {
			let branchName = (request.params.branch as string).toLowerCase();
			let branch = (await BranchConfig.loadBranchFromDB(request.params.branch as string));
			if ((branch.type === "Application" && requestType !== ApplicationType.Application) || (branch.type === "Confirmation" && requestType !== ApplicationType.Confirmation)) {
				response.redirect("/");
				return;
			}

			if (!(await isBranchOpen(branchName, user, requestType))) {
				response.redirect("/");
				return;
			}

			if (requestType === ApplicationType.Application) {
				// Redirect directly to branch if there is an existing application or confirmation
				if (user.applied && branchName.toLowerCase() !== user.applicationBranch.toLowerCase()) {
					response.redirect(`/apply/${encodeURIComponent(user.applicationBranch.toLowerCase())}`);
					return;
				}
			}
			if (requestType === ApplicationType.Confirmation) {
				if (request.params.branch !== user.confirmationBranch ) {
					response.redirect("/");
					return;
				}
			}
		} else {
			let targetBranch: string | undefined;
			if (requestType === ApplicationType.Application && user.applied && user.applicationBranch) {
				targetBranch = user.applicationBranch;
			} else if (requestType === ApplicationType.Confirmation) {
				targetBranch = user.confirmationBranch;
			}

			if (targetBranch) {
				const uriBranch = encodeURIComponent(targetBranch);
				const redirPath = requestType === ApplicationType.Application ? "apply" : "confirm";
				response.redirect(`/${redirPath}/${uriBranch}`);
				return;
			}

			// If there are no open application branches, redirect to main page.
			if ((await BranchConfig.getOpenBranches<ApplicationBranch>("Application")).length === 0) {
				response.redirect("/");
				return;
			}
		}

		next();
	};
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
