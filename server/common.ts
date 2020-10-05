// Needed so that common.ts <-> schema.ts cyclical dependencies don't cause problems
/* tslint:disable:no-duplicate-imports */
import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import * as tmp from "tmp";
import * as qr from "qr-image";
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
		groundTruth: {
			url: "",
			id: "",
			secret: ""
		}
	};
	public email: IConfig.Email = {
		from: "HackGT Team <hello@hackgt.com>",
		key: "",
		headerImage: "",
		twitterHandle: "TheHackGT",
		facebookHandle: "thehackgt",
		contactAddress: "hello@hack.gt"
	};
	public server: IConfig.Server = {
		isProduction: false,
		port: 3000,
		versionHash: fs.existsSync(".git") ? require("git-rev-sync").short() : "",
		workflowReleaseCreatedAt: null,
		workflowReleaseSummary: null,
		cookieMaxAge: 1000 * 60 * 60 * 24 * 30 * 6, // 6 months
		cookieSecureOnly: false,
		mongoURL: "mongodb://localhost/registration",
		defaultTimezone: "America/New_York",
		rootURL: "http://localhost:3000"
	};
	public admins = {
		domains: [] as string[],
		emails: [] as string[]
	};
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

	public helpscout: IConfig.HelpScout = {
		integration: {
			enabled: false,
			secretKey: ""
		},
		beacon: {
			enabled: false,
			beaconId: "",
			supportHistorySecretKey: ""
		}
	};

	public hackgt7: IConfig.HackGT7 = {
		sponsorDomainWhitelist: [],
		sponsorEmailWhitelist: []
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
		let config: Partial<IConfig.Main> | null = null;
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
				(this.secrets as any)[key] = config.secrets[key];
			}
		}
		if (config.email) {
			for (let key of Object.keys(config.email) as (keyof IConfig.Email)[]) {
				this.email[key] = config.email[key];
			}
		}
		if (config.server) {
			for (let key of Object.keys(config.server) as (keyof IConfig.Server)[]) {
				(this.server as any)[key] = config.server[key];
			}
		}
		if (config.admins) {
			if (config.admins.domains) {
				this.admins.domains = config.admins.domains;
			}
			if (config.admins.emails) {
				this.admins.emails = config.admins.emails;
			}
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
		if (config.helpscout) {
			if (config.helpscout.integration.enabled) {
				this.helpscout.integration.enabled = config.helpscout.integration.enabled;
				this.helpscout.integration.secretKey = config.helpscout.integration.secretKey;
				if (!config.helpscout.integration.secretKey) {
					console.warn("Disabling Help Scout integration because it is set to be enabled but " +
						"integration secret key is empty");
					this.helpscout.integration.enabled = false;
				}
			}

			if (config.helpscout.beacon.enabled) {
				this.helpscout.beacon.enabled = config.helpscout.beacon.enabled;
				this.helpscout.beacon.beaconId = config.helpscout.beacon.beaconId;
				this.helpscout.beacon.supportHistorySecretKey = config.helpscout.beacon.supportHistorySecretKey;
				if (!config.helpscout.beacon.beaconId || !config.helpscout.beacon.supportHistorySecretKey) {
					console.log("Disabling Help Scout Beacon because it is set to be enabled but Beacon ID or " +
						"support history secret key is missing");
					this.helpscout.beacon.enabled = false;
				}
			}
		}
		if (config.hackgt7) {
			if (config.hackgt7.sponsorEmailWhitelist) {
				this.hackgt7.sponsorEmailWhitelist = config.hackgt7.sponsorEmailWhitelist;
			}
			if (config.hackgt7.sponsorDomainWhitelist) {
				this.hackgt7.sponsorDomainWhitelist = config.hackgt7.sponsorDomainWhitelist;
			}
		}
	}
	protected loadFromEnv(): void {
		// Secrets
		if (process.env.ADMIN_KEY_SECRET) {
			this.secrets.adminKey = process.env.ADMIN_KEY_SECRET;
		}
		if (process.env.SESSION_SECRET) {
			this.secrets.session = process.env.SESSION_SECRET;
			this.sessionSecretSet = true;
		}
		if (process.env.GROUND_TRUTH_URL) {
			this.secrets.groundTruth.url = process.env.GROUND_TRUTH_URL;
		}
		if (process.env.GROUND_TRUTH_ID) {
			this.secrets.groundTruth.id = process.env.GROUND_TRUTH_ID;
		}
		if (process.env.GROUND_TRUTH_SECRET) {
			this.secrets.groundTruth.secret = process.env.GROUND_TRUTH_SECRET;
		}
		// Email
		if (process.env.EMAIL_FROM) {
			this.email.from = process.env.EMAIL_FROM;
		}
		if (process.env.EMAIL_KEY) {
			this.email.key = process.env.EMAIL_KEY;
		}
		if (process.env.EMAIL_HEADER_IMAGE) {
			this.email.headerImage = process.env.EMAIL_HEADER_IMAGE;
		}
		if (process.env.EMAIL_TWITTER_HANDLE) {
			this.email.twitterHandle = process.env.EMAIL_TWITTER_HANDLE;
		}
		if (process.env.EMAIL_FACEBOOK_HANDLE) {
			this.email.facebookHandle = process.env.EMAIL_FACEBOOK_HANDLE;
		}
		if (process.env.EMAIL_CONTACT_ADDRESS) {
			this.email.contactAddress = process.env.EMAIL_CONTACT_ADDRESS;
		}
		// Server
		if (process.env.PRODUCTION && process.env.PRODUCTION.toLowerCase() === "true") {
			this.server.isProduction = true;
		}
		if (process.env.PORT) {
			let port = parseInt(process.env.PORT!, 10);
			if (!isNaN(port) && port > 0) {
				this.server.port = port;
			}
		}
		if (process.env.VERSION_HASH) {
			this.server.versionHash = process.env.VERSION_HASH;
		}
		if (process.env.SOURCE_REV) {
			this.server.versionHash = process.env.SOURCE_REV;
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
			let maxAge = parseInt(process.env.COOKIE_MAX_AGE, 10);
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
		if (process.env.DEFAULT_TIMEZONE) {
			this.server.defaultTimezone = process.env.DEFAULT_TIMEZONE;
		}
		// Admins
		if (process.env.ADMIN_EMAILS) {
			this.admins.emails = JSON.parse(process.env.ADMIN_EMAILS!);
		}
		if (process.env.ADMIN_DOMAINS) {
			this.admins.domains = JSON.parse(process.env.ADMIN_DOMAINS);
		}
		// Event name
		if (process.env.EVENT_NAME) {
			this.eventName = process.env.EVENT_NAME;
		}
		// Questions
		if (process.env.QUESTIONS_FILE) {
			this.questionsLocation = process.env.QUESTIONS_FILE;
		}
		// Style
		if (process.env.THEME_FILE) {
			this.style.theme = process.env.THEME_FILE;
		}
		if (process.env.FAVICON_FILE) {
			this.style.favicon = process.env.FAVICON_FILE;
		}
		else if (process.env.FAVICON_FILE_BASE64) {
			this.style.favicon = unbase64File(process.env.FAVICON_FILE_BASE64);
		}
		// Storage engine
		if (process.env.STORAGE_ENGINE) {
			this.storageEngine.name = process.env.STORAGE_ENGINE;
			if (process.env.STORAGE_ENGINE_OPTIONS) {
				this.storageEngine.options = JSON.parse(process.env.STORAGE_ENGINE_OPTIONS);
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
			this.maxTeamSize = parseInt(process.env.MAX_TEAM_SIZE, 10);
		}

		if (process.env.HELPSCOUT_INTEGRATION_ENABLED && process.env.HELPSCOUT_INTEGRATION_ENABLED.toLowerCase() === "true") {
			this.helpscout.integration.enabled = true;
			if (process.env.HELPSCOUT_INTEGRATION_SECRET_KEY) {
				this.helpscout.integration.secretKey = process.env.HELPSCOUT_INTEGRATION_SECRET_KEY;
			} else {
				console.warn("Disabling Help Scout integration because it is set to be enabled but " +
					"integration secret key is empty");
				this.helpscout.integration.enabled = false;
			}
		}

		if (process.env.HELPSCOUT_BEACON_ENABLED && process.env.HELPSCOUT_BEACON_ENABLED.toLowerCase() === "true") {
			this.helpscout.beacon.enabled = true;
			if (process.env.HELPSCOUT_BEACON_ID) {
				this.helpscout.beacon.beaconId = process.env.HELPSCOUT_BEACON_ID;
			}
			if (process.env.HELPSCOUT_BEACON_SUPPORT_HISTORY_SECRET_KEY) {
				this.helpscout.beacon.supportHistorySecretKey = process.env.HELPSCOUT_BEACON_SUPPORT_HISTORY_SECRET_KEY;
			}
			if (!process.env.HELPSCOUT_BEACON_ID || !process.env.HELPSCOUT_BEACON_SUPPORT_HISTORY_SECRET_KEY) {
				console.log("Disabling Help Scout Beacon because of missing Beacon ID or support history " +
					"secret key");
				this.helpscout.beacon.enabled = false;
			}
		}

		if (process.env.ROOT_URL) {
			this.server.rootURL = process.env.ROOT_URL;
		}

		if (process.env.HACKGT7_SPONSOR_EMAILS) {
			this.hackgt7.sponsorEmailWhitelist = JSON.parse(process.env.HACKGT7_SPONSOR_EMAILS);
			console.log("The HackGT 7 sponsor email whitelist is:", this.hackgt7.sponsorEmailWhitelist);
		}

		if (process.env.HACKGT7_SPONSOR_DOMAINS) {
			this.hackgt7.sponsorDomainWhitelist = JSON.parse(process.env.HACKGT7_SPONSOR_DOMAINS);
			console.log("The HackGT 7 sponsor email domain whitelist is:", this.hackgt7.sponsorDomainWhitelist);
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
mongoose.connect(config.server.mongoURL, { useNewUrlParser: true }).catch(err => {
	throw err;
});
export { mongoose };

import { Setting } from "./schema";

async function setDefaultSettings() {
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
import * as htmlToText from "html-to-text";
// tslint:disable-next-line:no-var-requires
const Email = require("email-templates");
const email = new Email({
	views: {
		root: path.resolve("server/emails/")
	},
	juice: true,
	juiceResources: {
		preserveImportant: true,
		webResources: {
			relativeTo: path.join(__dirname, "emails", "email-template")
		}
	}
});

export const defaultEmailSubjects = {
	apply: `[${config.eventName}] - Thank you for applying!`,
	preConfirm: `[${config.eventName}] - Application Update`,
	attend: `[${config.eventName}] - Thank you for RSVPing!`
};
export interface IMailObject {
	to: string;
	from: string;
	subject: string;
	html: string;
	text: string;
}
export function sanitize(input?: string): string {
	if (!input || typeof input !== "string") {
		return "";
	}
	return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function removeTags(input: string): string {
	let text = striptags(input);
	text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
	return text;
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
async function templateMarkdown(markdown: string, user: IUser): Promise<string> {
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

	let qrBuffer = await new Promise<Buffer>(resolve => {
		let qrStream = qr.image(`user:${user.uuid}`);
		let buffer: any[] = [];
		qrStream.on("data", chunk => {
			buffer.push(chunk);
		});
		qrStream.on("end", () => {
			resolve(Buffer.concat(buffer));
		});
	});
	let qrURI = `data:image/png;base64,${qrBuffer.toString("base64")}`;
	let qrMarkdown = `![${user.uuid}](${qrURI})`;

	// Interpolate and sanitize variables
	markdown = markdown.replace(/{{eventName}}/g, sanitize(config.eventName));
	markdown = markdown.replace(/{{reimbursementAmount}}/g, sanitize(user.reimbursementAmount));
	markdown = markdown.replace(/{{qrURI}}/g, qrURI);
	markdown = markdown.replace(/{{qrCode}}/g, qrMarkdown);
	markdown = markdown.replace(/{{email}}/g, sanitize(user.email));
	markdown = markdown.replace(/{{name}}/g, sanitize(user.name));
	markdown = markdown.replace(/{{teamName}}/g, sanitize(teamName));
	markdown = markdown.replace(/{{applicationBranch}}/g, sanitize(user.applicationBranch));
	markdown = markdown.replace(/{{confirmationBranch}}/g, sanitize(user.confirmationBranch));
	markdown = markdown.replace(/{{application\.([a-zA-Z0-9\- ]+)}}/g, (match, name: string) => {
		let question = (user.applicationData || []).find(data => data.name === name);
		return formatFormItem(question);
	});
	markdown = markdown.replace(/{{confirmation\.([a-zA-Z0-9\- ]+)}}/g, (match, name: string) => {
		let question = (user.confirmationData || []).find(data => data.name === name);
		return formatFormItem(question);
	});
	return markdown;
}
export async function renderEmailHTML(markdown: string, user: IUser): Promise<string> {
	let templatedMarkdown = await templateMarkdown(markdown, user);
	let renderedMarkdown = await renderMarkdown(templatedMarkdown);
	return email.render("email-template/html", {
		emailHeaderImage: config.email.headerImage,
		twitterHandle: config.email.twitterHandle,
		facebookHandle: config.email.facebookHandle,
		emailAddress: config.email.contactAddress,
		hackathonName: config.eventName,
		body: renderedMarkdown
	});
}
export async function renderEmailText(markdown: string, user: IUser): Promise<string> {
	let templatedMarkdown = await templateMarkdown(markdown, user);
	let renderedHtml = await renderMarkdown(templatedMarkdown);
	return htmlToText.fromString(renderedHtml);
}
export async function renderPageHTML(markdown: string, user: IUser): Promise<string> {
	let templatedMarkdown = await templateMarkdown(markdown, user);
	return renderMarkdown(templatedMarkdown);
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

export async function isBranchOpen(rawBranchName: string, user: IUser, requestType: ApplicationType): Promise<boolean> {
	const branchName = await BranchConfig.getCanonicalName(rawBranchName);
	if (!branchName) {
		return false;
	}
	let branch = await BranchConfig.loadBranchFromDB(branchName) as (ApplicationBranch | ConfirmationBranch);

	let openDate = branch.open;
	let closeDate = branch.close;
	if (requestType === ApplicationType.Confirmation
		&& user.confirmationDeadline
		&& user.confirmationDeadline.name
		&& user.confirmationDeadline.name.toLowerCase() === branchName.toLowerCase()) {
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

//
// Agenda Async Queue
//
import * as Agenda from "agenda";
export const agenda = new Agenda({db: {address: config.server.mongoURL}});
import { User } from "./schema";
agenda.define("send_templated_email", async (job, done) => {
	try {
		let user = await User.findOne({uuid: job.attrs.data.id});
		if (user) {
			let emailHTML = await renderEmailHTML(job.attrs.data.markdown, user);
			let emailText = await renderEmailText(job.attrs.data.markdown, user);
			let emailDetails = {
				from: config.email.from,
				to: user.email,
				subject: job.attrs.data.subject,
				html: emailHTML,
				text: emailText
			};
			await sendgrid.send(emailDetails);
			await done();
		} else {
			await done(new Error("No such user"));
		}
	}
	catch(err) {
		console.error(err);
		await done(err);
	}
});

agenda.start().catch((err) => {
	console.error("Unable to start agenda worker: ", err);
});
