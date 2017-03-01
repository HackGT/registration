import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import * as url from "url";
import * as os from "os";

//
// Config
//
import { IConfig } from "./schema";
class Config implements IConfig {
	public secrets = {
		"session": crypto.randomBytes(32).toString("hex"),
		"github": {
			"id": "",
			"secret": ""
		},
		"google": {
			"id": "",
			"secret": ""
		},
		"facebook": {
			"id": "",
			"secret": ""
		}
	};
	public email = {
		from: "HackGT Team <hello@hackgt.com>",
		host: "",
		username: "",
		password: "",
		port: 465
	};
	public server = {
		isProduction: false,
		port: 3000,
		versionHash: fs.existsSync(".git") ? require("git-rev-sync").short() : "",
		workflowReleaseCreatedAt: null,
		workflowReleaseSummary: null,
		cookieMaxAge: 1000 * 60 * 60 * 24 * 30 * 6, // 6 months
		cookieSecureOnly: false,
		mongoURL: "mongodb://localhost/",
		uniqueAppID: "registration"
	};
	public admins: string[] = [];
	public eventName: string = "Untitled Event";

	public sessionSecretSet: boolean = false;

	constructor(fileName: string = "config.json") {
		this.loadFromJSON(fileName);
		this.loadFromEnv();
	}
	protected loadFromJSON(fileName: string): void {
		let config: IConfig | null = null;
		try {
			config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "./config", fileName), "utf8"));
		}
		catch (err) {
			if (err.code !== "ENOENT") {
				throw err;
			}
		}
		if (!config) return;
		if (config.secrets) {
			for (let key of Object.keys(config.secrets)) {
				this.secrets[key] = config.secrets[key];
			}
		}
		if (config.email) {
			for (let key of Object.keys(config.email)) {
				this.email[key] = config.email[key];
			}
		}
		if (config.server) {
			for (let key of Object.keys(config.server)) {
				this.server[key] = config.server[key];
			}
		}
		if (config.admins) {
			this.admins = config.admins;
		}
		if (config.eventName) {
			this.eventName = config.eventName;
		}
		if (config.secrets && config.secrets.session) {
			this.sessionSecretSet = true;
		}
	}
	protected loadFromEnv(): void {
		// Secrets
		if (process.env.SESSION_SECRET) {
			this.secrets.session = process.env.SESSION_SECRET;
			this.sessionSecretSet = true;
		}
		if (process.env.GITHUB_CLIENT_ID) {
			this.secrets.github.id = process.env.GITHUB_CLIENT_ID;
		}
		if (process.env.GITHUB_CLIENT_SECRET) {
			this.secrets.github.secret = process.env.GITHUB_CLIENT_SECRET;
		}
		if (process.env.GOOGLE_CLIENT_ID) {
			this.secrets.google.id = process.env.GOOGLE_CLIENT_ID;
		}
		if (process.env.GOOGLE_CLIENT_SECRET) {
			this.secrets.google.secret = process.env.GOOGLE_CLIENT_SECRET;
		}
		if (process.env.FACEBOOK_CLIENT_ID) {
			this.secrets.facebook.id = process.env.FACEBOOK_CLIENT_ID;
		}
		if (process.env.FACEBOOK_CLIENT_SECRET) {
			this.secrets.facebook.secret = process.env.FACEBOOK_CLIENT_SECRET;
		}
		// Email
		if (process.env.EMAIL_FROM) {
			this.email.from = process.env.EMAIL_FROM;
		}
		if (process.env.EMAIL_HOST) {
			this.email.host = process.env.EMAIL_HOST;
		}
		if (process.env.EMAIL_USERNAME) {
			this.email.username = process.env.EMAIL_USERNAME;
		}
		if (process.env.EMAIL_PASSWORD) {
			this.email.password = process.env.EMAIL_PASSWORD;
		}
		if (process.env.EMAIL_PORT) {
			let port = parseInt(process.env.EMAIL_PORT);
			if (!isNaN(port) && port > 0) {
				this.email.port = port;
			}
		}
		// Server
		if (process.env.PRODUCTION && process.env.PRODUCTION.toLowerCase() === "true") {
			this.server.isProduction = true;
		}
		if (process.env.PORT) {
			let port = parseInt(process.env.PORT);
			if (!isNaN(port) && port > 0) {
				this.server.port = port;
			}
		}
		if (process.env.VERSION_HASH) {
			this.server.versionHash = process.env.VERSION_HASH;
		}
		if (process.env.SOURCE_VERSION) {
			this.server.versionHash = process.env.SOURCE_VERSION;
		}
		if (process.env.WORKFLOW_RELEASE_CREATED_AT) {
			this.server.workflowReleaseCreatedAt = process.env.WORKFLOW_RELEASE_CREATED_AT;
		}
		if (process.env.WORKFLOW_RELEASE_SUMMARY) {
			this.server.workflowReleaseSummary = process.env.WORKFLOW_RELEASE_SUMMARY;
		}
		if (process.env.COOKIE_MAX_AGE) {
			let maxAge = parseInt(process.env.COOKIE_MAX_AGE);
			if (!isNaN(maxAge) && maxAge > 0) {
				this.server.cookieMaxAge = maxAge;
			}
		}
		if (process.env.COOKIE_SECURE_ONLY && process.env.COOKIE_SECURE_ONLY.toLowerCase() === "true") {
			this.server.cookieSecureOnly = true;
		}
		if (process.env.MONGO_URL) {
			this.server.mongoURL = process.env.MONGO_URL;
		}
		if (process.env.UNIQUE_APP_ID) {
			this.server.uniqueAppID = process.env.UNIQUE_APP_ID;
		}
		// Admins
		if (process.env.ADMIN_EMAILS) {
			this.admins = process.env.ADMIN_EMAILS.split(",");
		}
		// Event name
		if (process.env.EVENT_NAME) {
			this.eventName = process.env.EVENT_NAME;
		}
	}
}
export let config = new Config();

//
// Constants
//
export const PORT = config.server.port;
export const STATIC_ROOT = path.resolve(__dirname, "../client");
export const UPLOAD_ROOT = path.resolve(__dirname, "../uploads"); // Should exist already
export const VERSION_NUMBER = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version;
export const VERSION_HASH = config.server.versionHash;
export const COOKIE_OPTIONS = {
	"path": "/",
	"maxAge": config.server.cookieMaxAge,
	"secure": config.server.cookieSecureOnly,
	"httpOnly": true
};

//
// Database connection
//
import * as mongoose from "mongoose";
(<any>mongoose).Promise = global.Promise;
mongoose.connect(url.resolve(config.server.mongoURL, config.server.uniqueAppID));
export {mongoose};

import {
	IUser, IUserMongoose, User
} from "./schema";

//
// Express middleware
//
import * as express from "express";
import * as bodyParser from "body-parser";
export let postParser = bodyParser.urlencoded({
	extended: false
});
import * as multer from "multer";
export let uploadHandler = multer({
	"storage": multer.diskStorage({
		destination: function (req, file, cb) {
			// The OS's default temporary directory
			// Should be changed (or moved via fs.rename()) if the files are to be persisted
			cb(null!, os.tmpdir());
		},
		filename: function (req, file, cb) {
			cb(null!, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
		}
	}),
	"limits": {
		"fileSize": 50000000, // 50 MB
		"files": 10 // Reasonable limit (real number is determined by the number of file questions in the config)
	}
});
// For API endpoints
export function authenticateWithReject (request: express.Request, response: express.Response, next: express.NextFunction) {
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
export function authenticateWithRedirect (request: express.Request, response: express.Response, next: express.NextFunction) {
	if (!request.isAuthenticated()) {
		response.redirect("/login");
	}
	else {
		next();
	}
}

//
// Promisified APIs for use with async / await
//
export function pbkdf2Async (...params: any[]) {
	return new Promise<Buffer>((resolve, reject) => {
		params.push(function (err: Error, derivedKey: Buffer) {
			if (err) {
				reject(err);
				return;
			}
			resolve(derivedKey);
		});
		crypto.pbkdf2.apply(null, params);
	});
}
export function readFileAsync (filename: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		fs.readFile(filename, "utf8", (err, data) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(data);
		})
	});
}

//
// JSON schema validator
//
import * as ajv from "ajv";
import {QuestionBranches, Questions} from "./config/questions.schema";
export async function validateSchema (questionsFile: string, schemaFile: string = "./config/questions.schema.json"): Promise<QuestionBranches> {
	let questionBranches: QuestionBranches;
	let schema: any;
	try {
		questionBranches = JSON.parse(await readFileAsync(path.resolve(__dirname, questionsFile)));
		schema = JSON.parse(await readFileAsync(path.resolve(__dirname, schemaFile)));
	}
	catch (err) {
		// Invalid JSON or file read failed unexpectedly
		return Promise.reject(err);
	}

	let validator = new ajv();
	let valid = validator.validate(schema, questionBranches);
	let branchNames = questionBranches.map(branch => branch.name);
	if (!valid) {
		return Promise.reject(validator.errors);
	}
	else if (new Set(branchNames).size !== branchNames.length) {
		return Promise.reject(new Error("Application branch names are not unique"));
	}
	else {
		return questionBranches;
	}
};

//
// Email
//
import * as nodemailer from "nodemailer";
export let emailTransporter = nodemailer.createTransport({
	host: config.email.host,
	port: config.email.port,
	secure: true,
	auth: {
		user: config.email.username,
		pass: config.email.password
	}
});
