// Needed so that common.ts <-> schema.ts cyclical dependencies don't cause problems
/* tslint:disable:no-duplicate-imports */
import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import * as tmp from "tmp";
import "passport";

//
// Config
//
import { IConfig } from "./schema";
import { storageEngines } from "./storage";
class Config implements IConfig.Main {
	public secrets: IConfig.Secrets = {
		adminKey: crypto.randomBytes(32).toString("hex"),
		session: crypto.randomBytes(32).toString("hex"),
		github: {
			id: "",
			secret: ""
		},
		google: {
			id: "",
			secret: ""
		},
		facebook: {
			id: "",
			secret: ""
		}
	};
	public email: IConfig.Email = {
		from: "HackGT Team <hello@hackgt.com>",
		key: ""
	};
	public server: IConfig.Server = {
		isProduction: false,
		port: 3000,
		versionHash: fs.existsSync(".git") ? require("git-rev-sync").short() : "",
		workflowReleaseCreatedAt: null,
		workflowReleaseSummary: null,
		cookieMaxAge: 1000 * 60 * 60 * 24 * 30 * 6, // 6 months
		cookieSecureOnly: false,
		mongoURL: "mongodb://localhost/",
		passwordResetExpiration: 1000 * 60 * 60 // 1 hour
	};
	public admins: string[] = [];
	public eventName: string = "Untitled Event";
	public storageEngine = {
		"name": "disk",
		"options": {
			"uploadDirectory": "uploads"
		}
	};
	public maxTeamSize: number = 4;

	public sessionSecretSet: boolean = false;

	public style: IConfig.Style = {
		theme: path.resolve(__dirname, "../client/css/theme.css"),
		favicon: path.resolve(__dirname, "../client/favicon.ico")
	};

	public questionsLocation: string = path.resolve(__dirname, "./config/questions.json");

	constructor(fileName: string = "config.json") {
		this.loadFromJSON(fileName);
		this.loadFromEnv();
		if (!this.server.isProduction) {
			this.eventName += " - Development";
		}
	}
	protected loadFromJSON(fileName: string): void {
		// tslint:disable-next-line:no-shadowed-variable
		let config: IConfig.Main | null = null;
		try {
			config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "./config", fileName), "utf8"));
		}
		catch (err) {
			if (err.code !== "ENOENT") {
				throw err;
			}
		}
		if (!config) {
			return;
		}
		if (config.secrets) {
			for (let key of Object.keys(config.secrets) as (keyof IConfig.Secrets)[]) {
				this.secrets[key] = config.secrets[key];
			}
		}
		if (config.email) {
			for (let key of Object.keys(config.email) as (keyof IConfig.Email)[]) {
				this.email[key] = config.email[key];
			}
		}
		if (config.server) {
			for (let key of Object.keys(config.server) as (keyof IConfig.Server)[]) {
				this.server[key] = config.server[key];
			}
		}
		if (config.admins) {
			this.admins = config.admins;
		}
		if (config.eventName) {
			this.eventName = config.eventName;
		}
		if (config.storageEngine) {
			this.storageEngine = config.storageEngine;
			if (!storageEngines[this.storageEngine.name]) {
				console.warn(`Custom storage engine "${this.storageEngine.name}" does not exist`);
			}
		}
		if (config.maxTeamSize) {
			this.maxTeamSize = config.maxTeamSize;
		}
		if (config.secrets && config.secrets.session) {
			this.sessionSecretSet = true;
		}

		if (config.questionsLocation) {
			this.questionsLocation = config.questionsLocation;
		}
		if (config.style) {
			this.style = config.style;
		}
	}
	protected loadFromEnv(): void {
		// Secrets
		if (process.env.ADMIN_KEY_SECRET) {
			this.secrets.adminKey = process.env.ADMIN_KEY_SECRET!;
		}
		else {
			console.warn("Setting random admin key! Cannot use the service-to-service APIs.");
		}
		if (process.env.SESSION_SECRET) {
			this.secrets.session = process.env.SESSION_SECRET!;
			this.sessionSecretSet = true;
		}
		if (process.env.GITHUB_CLIENT_ID) {
			this.secrets.github.id = process.env.GITHUB_CLIENT_ID!;
		}
		if (process.env.GITHUB_CLIENT_SECRET) {
			this.secrets.github.secret = process.env.GITHUB_CLIENT_SECRET!;
		}
		if (process.env.GOOGLE_CLIENT_ID) {
			this.secrets.google.id = process.env.GOOGLE_CLIENT_ID!;
		}
		if (process.env.GOOGLE_CLIENT_SECRET) {
			this.secrets.google.secret = process.env.GOOGLE_CLIENT_SECRET!;
		}
		if (process.env.FACEBOOK_CLIENT_ID) {
			this.secrets.facebook.id = process.env.FACEBOOK_CLIENT_ID!;
		}
		if (process.env.FACEBOOK_CLIENT_SECRET) {
			this.secrets.facebook.secret = process.env.FACEBOOK_CLIENT_SECRET!;
		}
		// Email
		if (process.env.EMAIL_FROM) {
			this.email.from = process.env.EMAIL_FROM!;
		}
		if (process.env.EMAIL_KEY) {
			this.email.key = process.env.EMAIL_KEY!;
		}
		// Server
		if (process.env.PRODUCTION && process.env.PRODUCTION!.toLowerCase() === "true") {
			this.server.isProduction = true;
		}
		if (process.env.PORT) {
			let port = parseInt(process.env.PORT!, 10);
			if (!isNaN(port) && port > 0) {
				this.server.port = port;
			}
		}
		if (process.env.VERSION_HASH) {
			this.server.versionHash = process.env.VERSION_HASH!;
		}
		if (process.env.SOURCE_REV) {
			this.server.versionHash = process.env.SOURCE_REV!;
		}
		if (process.env.SOURCE_VERSION) {
			this.server.versionHash = process.env.SOURCE_VERSION!;
		}
		if (process.env.WORKFLOW_RELEASE_CREATED_AT) {
			this.server.workflowReleaseCreatedAt = process.env.WORKFLOW_RELEASE_CREATED_AT!;
		}
		if (process.env.WORKFLOW_RELEASE_SUMMARY) {
			this.server.workflowReleaseSummary = process.env.WORKFLOW_RELEASE_SUMMARY!;
		}
		if (process.env.COOKIE_MAX_AGE) {
			let maxAge = parseInt(process.env.COOKIE_MAX_AGE!, 10);
			if (!isNaN(maxAge) && maxAge > 0) {
				this.server.cookieMaxAge = maxAge;
			}
		}
		if (process.env.COOKIE_SECURE_ONLY && process.env.COOKIE_SECURE_ONLY!.toLowerCase() === "true") {
			this.server.cookieSecureOnly = true;
		}
		if (process.env.MONGO_URL) {
			this.server.mongoURL = process.env.MONGO_URL!;
		}
		if (process.env.PASSWORD_RESET_EXPIRATION) {
			let expirationTime = parseInt(process.env.PASSWORD_RESET_EXPIRATION!, 10);
			if (!isNaN(expirationTime) && expirationTime > 0) {
				this.server.passwordResetExpiration = expirationTime;
			}
		}
		// Admins
		if (process.env.ADMIN_EMAILS) {
			this.admins = JSON.parse(process.env.ADMIN_EMAILS!);
		}
		// Event name
		if (process.env.EVENT_NAME) {
			this.eventName = process.env.EVENT_NAME!;
		}
		// Questions
		if (process.env.QUESTIONS_FILE) {
			this.questionsLocation = process.env.QUESTIONS_FILE!;
		}
		// Style
		if (process.env.THEME_FILE) {
			this.style.theme = process.env.THEME_FILE!;
		}
		if (process.env.FAVICON_FILE) {
			this.style.favicon = process.env.FAVICON_FILE!;
		}
		else if (process.env.FAVICON_FILE_BASE64) {
			this.style.favicon = unbase64File(process.env.FAVICON_FILE_BASE64!);
		}
		// Storage engine
		if (process.env.STORAGE_ENGINE) {
			this.storageEngine.name = process.env.STORAGE_ENGINE!;
			if (process.env.STORAGE_ENGINE_OPTIONS) {
				this.storageEngine.options = JSON.parse(process.env.STORAGE_ENGINE_OPTIONS!);
			}
			else {
				console.warn("Custom storage engine defined but no storage engine options passed");
			}
			if (!storageEngines[this.storageEngine.name]) {
				console.warn(`Custom storage engine "${this.storageEngine.name}" does not exist`);
			}
		}
		// Team size
		if (process.env.MAX_TEAM_SIZE) {
			this.maxTeamSize = parseInt(process.env.MAX_TEAM_SIZE!, 10);
		}
	}
}
export let config = new Config();

//
// Constants
//
export const PORT = config.server.port;
export const STATIC_ROOT = path.resolve(__dirname, "../client");
export const VERSION_NUMBER = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version;
export const VERSION_HASH = config.server.versionHash;
export const COOKIE_OPTIONS = {
	"path": "/",
	"maxAge": config.server.cookieMaxAge,
	"secure": config.server.cookieSecureOnly,
	"httpOnly": true
};
export const STORAGE_ENGINE = new storageEngines[config.storageEngine.name](config.storageEngine.options);

export function formatSize(size: number, binary: boolean = true): string {
	const base = binary ? 1024 : 1000;
	const labels = binary ? ["bytes", "KiB", "MiB", "GiB", "TiB"] : ["bytes", "KB", "MB", "GB", "TB"];

	let i = Math.floor(Math.log(size) / Math.log(base));
	let formattedSize = `${(size / Math.pow(base, i)).toFixed(2)} ${labels[i]}`;
	if (size <= 0) {
		formattedSize = "0 bytes";
	}
	return formattedSize;
}

//
// Database connection
//
import * as mongoose from "mongoose";
(mongoose as any).Promise = global.Promise;
mongoose.connect(config.server.mongoURL, {
	useMongoClient: true
} as mongoose.ConnectionOptions);
export {mongoose};

import { Setting } from "./schema";

export async function setDefaultSettings() {
	async function doesNotExist(key: string): Promise<boolean> {
		return await Setting.find({ "name": key }).count() === 0;
	}

	const DEFAULTS: any = {
		"teamsEnabled": true,
		"qrEnabled": true
	};

	for (let setting in DEFAULTS) {
		if (await doesNotExist(setting)) {
			await updateSetting(setting, DEFAULTS[setting]);
			console.log(`Updated previously unset setting ${setting} to ${JSON.stringify(DEFAULTS[setting])}`);
		}
	}
}
export async function getSetting<T>(name: string, createMissing: boolean = true): Promise<T> {
	let setting = await Setting.findOne({ name });
	if (!setting) {
		if (createMissing) {
			await setDefaultSettings();
			setting = await Setting.findOne({ name });
			if (!setting) {
				throw new Error(`Setting "${name}" not created by setDefaultSettings()`);
			}
		}
		else {
			throw new Error("Setting not found");
		}
	}
	return setting.value as T;
}
export async function updateSetting<T>(name: string, value: T, createMissing: boolean = true): Promise<void> {
	let setting = await Setting.findOne({ name });
	if (!setting) {
		if (!createMissing) {
			throw new Error("Setting not found to update");
		}
		await new Setting({ name, value }).save();
	}
	else {
		setting.value = value;
		setting.markModified("value");
		await setting.save();
	}
}

//
// Promisified APIs for use with async / await
//
export function pbkdf2Async(password: string | Buffer, salt: string | Buffer, iterations: number, keylength: number = 128, digest: string = "sha256") {
	return new Promise<Buffer>((resolve, reject) => {
		crypto.pbkdf2(password, salt, iterations, keylength, digest, (err: Error, derivedKey: Buffer) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(derivedKey);
		});
	});
}
export function readFileAsync(filename: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		fs.readFile(filename, "utf8", (err, data) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(data);
		});
	});
}

export function unbase64File(filename: string): string {
	const text = fs.readFileSync(filename, "utf8");
	const decoded = Buffer.from(text, "base64");
	const file = tmp.fileSync();
	fs.writeSync(file.fd, decoded);
	return file.name;
}

//
// Email
//
import * as sendgrid from "@sendgrid/mail";
sendgrid.setApiKey(config.email.key);
import * as marked from "marked";
// tslint:disable-next-line:no-var-requires
const striptags = require("striptags");
import { IUser, Team, IFormItem } from "./schema";

export const defaultEmailSubjects = {
	apply: `[${config.eventName}] - Thank you for applying!`,
	preConfirm: `[${config.eventName}] - Application Update`,
	attend: `[${config.eventName}] - Thank you for RSVPing!`
};
interface IMailObject {
	to: string;
	from: string;
	subject: string;
	html: string;
	text: string;
}
export async function sendMailAsync(mail: IMailObject): Promise<void>  {
	await sendgrid.send(mail);
}
export function sanitize(input: string): string {
	if (typeof input !== "string") {
		return "";
	}
	return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let renderer = new marked.Renderer();
let singleLineRenderer = new marked.Renderer();
singleLineRenderer.link = (href, title, text) => `<a target=\"_blank\" href=\"${href}\" title=\"${title || ''}\">${text}</a>`;
singleLineRenderer.paragraph = (text) => text;
export async function renderMarkdown(markdown: string, options?: MarkedOptions, singleLine: boolean = false): Promise<string> {
	let r = singleLine ? singleLineRenderer : renderer;
	return new Promise<string>((resolve, reject) => {
		marked(markdown, { sanitize: false, smartypants: true, renderer: r, ...options }, (err: Error | null, content: string) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(content);
		});
	});
}
export async function renderEmailHTML(markdown: string, user: IUser): Promise<string> {
	let teamName: string;
	if (await getSetting<boolean>("teamsEnabled")) {
		teamName = "No team created or joined";
		if (user.teamId) {
			let team = await Team.findById(user.teamId);
			if (team) {
				teamName = team.teamName;
			}
		}
	}
	else {
		teamName = "Teams not enabled";
	}

	function formatFormItem(formItem: IFormItem | undefined): string {
		if (formItem === undefined || formItem.value === null) {
			return "N/A";
		}
		else if (typeof formItem.value === "string") {
			return formItem.value.replace(/\n/g, "\n<br />");
		}
		else if (Array.isArray(formItem.value)) {
			return formItem.value.join(", ");
		}
		else {
			// Multer file
			let file = formItem.value;
			let formattedSize = formatSize(file.size);

			return `\`${file.originalname}\` / ${formattedSize}`;
		}
	}

	// Interpolate and sanitize variables
	markdown = markdown.replace(/{{eventName}}/g, sanitize(config.eventName));
	markdown = markdown.replace(/{{email}}/g, sanitize(user.email));
	markdown = markdown.replace(/{{name}}/g, sanitize(user.name));
	markdown = markdown.replace(/{{teamName}}/g, sanitize(teamName));
	markdown = markdown.replace(/{{applicationBranch}}/g, sanitize(user.applicationBranch));
	markdown = markdown.replace(/{{confirmationBranch}}/g, sanitize(user.confirmationBranch || ""));
	markdown = markdown.replace(/{{application\.([a-zA-Z0-9\- ]+)}}/g, (match, name: string) => {
		let question = user.applicationData.find(data => data.name === name);
		return formatFormItem(question);
	});
	markdown = markdown.replace(/{{confirmation\.([a-zA-Z0-9\- ]+)}}/g, (match, name: string) => {
		let question = user.confirmationData.find(data => data.name === name);
		return formatFormItem(question);
	});

	return renderMarkdown(markdown);
}
export async function renderEmailText(markdown: string, user: IUser, markdownRendered: boolean = false): Promise<string> {
	let html: string;
	if (!markdownRendered) {
		html = await renderEmailHTML(markdown, user);
	}
	else {
		html = markdown;
	}
	// Remove <style> and <script> block's content
	html = html.replace(/<style>[\s\S]*?<\/style>/gi, "<style></style>").replace(/<script>[\s\S]*?<\/script>/gi, "<script></script>");

	// Append href of links to their text
	const cheerio = await import("cheerio");
	let $ = cheerio.load(html, { decodeEntities: false });
	$("a").each((i, el) => {
		let element = $(el);
		element.text(`${element.text()} (${element.attr("href")})`);
	});
	html = $.html();

	let text: string = striptags(html);
	// Reverse sanitization
	return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// Verify and load questions
import { BranchConfig, ApplicationBranch, ConfirmationBranch } from "./branch";
BranchConfig.verifyConfig().then(good => {
	if (good) {
		console.log(`Question branches loaded from ${config.questionsLocation} to DB successfully`);
	}
	else {
		throw new Error(`Question branches in ${config.questionsLocation} failed schema verification`);
	}
}).catch(err => {
	throw err;
});

import {ApplicationType} from "./middleware";
import * as moment from "moment-timezone";

export async function isBranchOpen(branchName: string, user: IUser, requestType: ApplicationType) {
	let branch = (await BranchConfig.loadAllBranches()).find(b => b.name.toLowerCase() === branchName.toLowerCase()) as (ApplicationBranch | ConfirmationBranch);
	if (!branch) {
		return false;
	}

	let openDate = branch.open;
	let closeDate = branch.close;
	if (requestType === ApplicationType.Confirmation && user.confirmationDeadline && user.confirmationDeadline.name.toLowerCase() === branchName.toLowerCase()) {
		openDate = user.confirmationDeadline.open;
		closeDate = user.confirmationDeadline.close;
	}

	if (branch instanceof ConfirmationBranch && branch.autoConfirm) {
		return false;
	}

	if (moment().isBetween(openDate, closeDate)) {
		return true;
	}

	return false;
}
