import * as fs from "fs";
import * as moment from "moment-timezone";
import * as path from "path";
import * as os from "os";

import { config, isBranchOpen } from "./common";
import { BranchConfig, ApplicationBranch, ConfirmationBranch } from "./branch";
import { IUser, User, DataLog, HackGTMetrics } from "./schema";

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
import * as crypto from "crypto";

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
		const key = Buffer.from(auth.split(" ")[1], "base64").toString();
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
	if (!request.isAuthenticated() || !request.user) {
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
	if (!request.isAuthenticated() || !request.user) {
		if (request.session) {
			request.session.returnTo = request.originalUrl;
		}
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
	const branchName = await BranchConfig.getCanonicalName(request.params.branch);
	if (!branchName) {
		response.redirect("/");
		return;
	}
	const branch = await BranchConfig.loadBranchFromDB(branchName) as ApplicationBranch;
	if (!branch.allowAnonymous) {
		response.redirect("/");
		return;
	}
	next();
}
export async function canUserModify(request: express.Request, response: express.Response, next: express.NextFunction) {
	const user = await User.findOne({uuid: request.params.uuid}) as IUser;
	const branchName = await BranchConfig.getCanonicalName(request.params.branch);
	if (!branchName) {
		response.status(400).json({
			"error": "Invalid application branch name"
		});
		return;
	}
	let questionBranch = await BranchConfig.loadBranchFromDB(branchName);

	if (!(await isBranchOpen(branchName, user, questionBranch instanceof ApplicationBranch ? ApplicationType.Application : ApplicationType.Confirmation))) {
		response.status(400).json({
			"error": "Branch is closed"
		});
		return;
	}

	if (questionBranch instanceof ApplicationBranch) {
		// Don't allow user to modify application if we assigned them a confirmation branch
		if (user.confirmationBranch) {
			response.status(400).json({
				"error": "You can no longer edit this application"
			});
			return;
		}
		if (user.applied && branchName.toLowerCase() !== user.applicationBranch!.toLowerCase()) {
			response.status(400).json({
				"error": "You can only edit the application branch that you originally submitted"
			});
			return;
		}
	} else if (questionBranch instanceof ConfirmationBranch) {
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
	return async (request, response, next) => {
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
			// Branch name from URL can be different from config in casing
			let branchName = await BranchConfig.getCanonicalName(request.params.branch);
			if (!branchName) {
				// Invalid branch name
				response.redirect("/");
				return;
			}
			let branch = await BranchConfig.loadBranchFromDB(branchName);
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
				if (user.applied && branchName.toLowerCase() !== user.applicationBranch!.toLowerCase()) {
					response.redirect(`/apply/${encodeURIComponent(user.applicationBranch!.toLowerCase())}`);
					return;
				}
			}
			if (requestType === ApplicationType.Confirmation) {
				if (!user.confirmationBranch || branchName.toLowerCase() !== user.confirmationBranch.toLowerCase()) {
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
				const uriBranch = encodeURIComponent(targetBranch.toLowerCase());
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
		...data
	};
	let metricsEvent: HackGTMetrics = {
		hackgtmetricsversion: 1,
		serviceName: `registration-${config.eventName.replace(/[^a-zA-Z0-9]/g, "")}-${action}`,
		values: {
			user,
			ip: request.ip
		},
		tags
	};
	console.log(JSON.stringify(metricsEvent));
}

export function isHelpScoutIntegrationEnabled(request: express.Request, response: express.Response, next: express.NextFunction) {
	const enabled = config.helpscout.enabled;
	if (!enabled) {
		const message = "Helpscout integration functionality is currently disabled";
		console.error(message);
		response.status(403).json({
			"error": message
		});
		return;
	}

	next();
}

export function validateHelpScoutSignature(request: express.Request, response: express.Response, next: express.NextFunction) {
	const secret = config.helpscout.secretKey;
	console.log("Secret key length:", secret.length);
	console.log("Request body: ", request.body);
	console.log("Stringified request body:", JSON.stringify(request.body));
	const hsSignature = request.header('X-HelpScout-Signature');
	if (hsSignature) {
		const stringifiedBody = JSON.stringify(request.body);
		const computedHash = crypto.createHmac('sha1', secret)
			.update(Buffer.from(stringifiedBody))
			.digest('base64');

		console.log("hsSignature:", hsSignature);
		console.log("computedBodyHash:", computedHash);

		// Prevents timing attacks with HMAC hashes https://stackoverflow.com/a/51489494
		if (crypto.timingSafeEqual(Buffer.from(hsSignature), Buffer.from(computedHash))) {
			next();
			return;
		} else {
			console.warn("Rejecting request for Helpscout integration due to incorrect signature (check that " +
				"the secret key is correct in local config and in Helpscout app config)");
		}
	} else {
		console.warn("Rejecting request for Helpscout integration - missing required X-HelpScout-Signature " +
			"header");
	}

	response.status(400).json({
		"error": "Request validation failed; check server logs for details"
	});
}
