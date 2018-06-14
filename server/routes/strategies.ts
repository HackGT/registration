// tslint:disable:interface-name
import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as passport from "passport";
import * as moment from "moment-timezone";
import * as uuid from "uuid/v4";

import { config, pbkdf2Async, renderEmailHTML, renderEmailText, sendMailAsync } from "../common";
import { postParser, trackEvent } from "../middleware";
import { IConfig, IUserMongoose, User } from "../schema";
import { Request, Response, NextFunction, Router } from "express";

import {Strategy as LocalStrategy} from "passport-local";
import {Strategy as GitHubStrategy} from "passport-github2";
import {Strategy as FacebookStrategy} from "passport-facebook";
// No type definitions available yet for this module
// tslint:disable-next-line:no-var-requires
const GoogleStrategy: StrategyConstructor = require("passport-google-oauth20").Strategy;

type Strategy = passport.Strategy;
type PassportDone = (err: Error | null, user?: IUserMongoose | false, errMessage?: { message: string }) => void;
interface StrategyConstructor {
	new(options: OAuthStrategyOptions, cb: (request: Request, accessToken: string, refreshToken: string, profile: Profile, done: PassportDone) => Promise<void>): Strategy;
}
interface OAuthStrategyOptions {
	clientID: string;
	clientSecret: string;
	profileFields?: string[];
	passReqToCallback: boolean;
}
type Profile = passport.Profile & {
	profileUrl?: string;
	_json: any;
};
interface LocalStrategyOptions {
	usernameField: string;
	passwordField: string;
	passReqToCallback: true;
}
// Because the passport typedefs don't include this for some reason
// Defined: https://github.com/jaredhanson/passport-oauth2/blob/9ddff909a992c3428781b7b2957ce1a97a924367/lib/strategy.js#L135
type AuthenticateOptions = passport.AuthenticateOptions & {
	callbackURL: string;
};

export const PBKDF2_ROUNDS: number = 300000;

export interface RegistrationStrategy {
	readonly name: string;
	readonly passportStrategy: Strategy;
	use(authRoutes: Router, scope?: string[]): void;
	logout(request: Request, response: Response): void;
}
abstract class OAuthStrategy implements RegistrationStrategy {
	public readonly passportStrategy: Strategy;

	public static get defaultUserProperties() {
		return {
			"uuid": uuid(),
			"verifiedEmail": false,

			"local": {},
			"github": {},
			"google": {},
			"facebook": {},

			"applied": false,
			"accepted": false,
			"confirmed": false,
			"preConfirmEmailSent": false,
			"applicationData": [],
			"applicationStartTime": undefined,
			"applicationSubmitTime": undefined,

			"admin": false
		};
	}

	constructor(public readonly name: IConfig.OAuthServices, strategy: StrategyConstructor, profileFields?: string[]) {

		const secrets = config.secrets.oauth[name];
		if (!secrets || !secrets.id || !secrets.secret) {
			throw new Error(`Client ID or secret not configured in config.json or environment variables for strategy "${this.name}"`);
		}
		let options: OAuthStrategyOptions = {
			clientID: secrets.id,
			clientSecret: secrets.secret,
			profileFields,
			passReqToCallback: true
		};
		this.passportStrategy = new strategy(options, this.passportCallback);
	}

	protected async passportCallback(request: Request, accessToken: string, refreshToken: string, profile: Profile, done: PassportDone) {
		let serviceName = this.name as IConfig.OAuthServices;

		let email: string = "";
		if (profile.emails && profile.emails.length > 0) {
			email = profile.emails[0].value;
		}
		else if (!profile.emails || profile.emails.length === 0) {
			done(null, false, { message: "Your GitHub profile does not have any public email addresses. Please make an email address public before logging in with GitHub." });
			return;
		}
		else if (!profile.displayName || !profile.displayName.trim()) {
			done(null, false, { message: "Your profile does not have a publicly visible name. Please set a name on your account before logging in." });
			return;
		}
		let user = await User.findOne({"email": email});
		let isAdmin = false;
		if (config.admins.includes(email)) {
			isAdmin = true;
			if (!user || !user.admin) {
				console.info(`Adding new admin: ${email}`);
			}
		}
		if (!user) {
			user = new User({
				...OAuthStrategy.defaultUserProperties,
				email,
				name: profile.displayName,
				verifiedEmail: true,
				admin: isAdmin
			});
			user[serviceName]!.id = profile.id;
			if (serviceName === "github" && profile.username && profile.profileUrl) {
				user[serviceName]!.username = profile.username;
				user[serviceName]!.profileUrl = profile.profileUrl;
			}
			try {
				await user.save();
				trackEvent("created account (auth)", request, email);
			}
			catch (err) {
				done(err);
				return;
			}

			done(null, user);
		}
		else {
			if (!user[serviceName] || !user[serviceName]!.id) {
				user[serviceName] = {
					id: profile.id
				};
			}
			if (!user.verifiedEmail) {
				// We trust our OAuth provider to have verified the user's email for us
				user.verifiedEmail = true;
			}
			if (serviceName === "github" && (!user.github || !user.github.username || !user.github.profileUrl) && (profile.username && profile.profileUrl)) {
				user.github!.username = profile.username;
				user.github!.profileUrl = profile.profileUrl;
			}
			if (!user.admin && isAdmin) {
				user.admin = true;
			}
			await user.save();
			done(null, user);
		}
	}

	public use(authRoutes: Router, scope: string[]) {
		passport.use(this.passportStrategy);

		const callbackHref = `auth/${this.name}/callback`;
		authRoutes.get(`/${this.name}`, validateAndCacheHostName, (request, response, next) => {
			let callbackURL = `${request.protocol}://${request.hostname}:${getExternalPort(request)}/${callbackHref}`;

			passport.authenticate(
				this.name,
				{ scope, callbackURL } as AuthenticateOptions
			)(request, response, next);
		});
		authRoutes.get(`/${this.name}/callback`, validateAndCacheHostName, (request, response, next) => {
			let callbackURL = `${request.protocol}://${request.hostname}:${getExternalPort(request)}/${callbackHref}`;

			passport.authenticate(
				this.name,
				{ failureRedirect: "/login", failureFlash: true, callbackURL } as AuthenticateOptions
			)(request, response, next);
		}, (request, response) => {
			// Successful authentication, redirect home
			response.redirect("/");
		});
	}

	public logout() {
		return;
	}
}

export class GitHub extends OAuthStrategy {
	constructor() {
		super("github", GitHubStrategy as any);
	}
	public use(authRoutes: Router) {
		super.use(authRoutes, ["user:email"]);
	}
}

export class Google extends OAuthStrategy {
	constructor() {
		super("google", GoogleStrategy);
	}
	public use(authRoutes: Router) {
		super.use(authRoutes, ["email", "profile"]);
	}
}

export class Facebook extends OAuthStrategy {
	constructor() {
		super("facebook", FacebookStrategy, ["id", "displayName", "email"]);
	}
	public use(authRoutes: Router) {
		super.use(authRoutes, ["email"]);
	}
}

export class Local implements RegistrationStrategy {
	public readonly name = "local";
	public readonly passportStrategy: Strategy;

	constructor() {
		let options: LocalStrategyOptions = {
			usernameField: "email",
			passwordField: "password",
			passReqToCallback: true
		};
		this.passportStrategy = new LocalStrategy(options, this.passportCallback);
	}

	protected async passportCallback(request: Request, email: string, password: string, done: PassportDone) {
		let user = await User.findOne({ email });
		if (user && request.path.match(/\/signup$/i)) {
			done(null, false, { "message": "That email address is already in use" });
		}
		else if (user && !user.local!.hash) {
			done(null, false, { "message": "Please log back in with an external provider" });
		}
		else if (!user || !user.local) {
			// User hasn't signed up yet
			if (!request.path.match(/\/signup$/i)) {
				// Only create the user when targeting /signup
				done(null, false, { "message": "Incorrect email or password" });
				return;
			}
			let name: string = request.body.name || "";
			name = name.trim();
			if (!name || !email || !password) {
				done(null, false, { "message": "Missing email, name, or password" });
				return;
			}
			let salt = crypto.randomBytes(32);
			let hash = await pbkdf2Async(password, salt, PBKDF2_ROUNDS);
			user = new User({
				...OAuthStrategy.defaultUserProperties,
				email,
				name: request.body.name,
				verifiedEmail: false,
				local: {
					"hash": hash.toString("hex"),
					"salt": salt.toString("hex"),
					"verificationCode": crypto.randomBytes(32).toString("hex")
				}
			});
			try {
				await user.save();
				trackEvent("created account", request, email);
			}
			catch (err) {
				done(err);
				return;
			}
			// Send verification email (hostname validated by previous middleware)
			let link = createLink(request, `/auth/verify/${user.local!.verificationCode}`);
			let markdown =
`Hi {{name}},

Thanks for signing up for ${config.eventName}! To verify your email, please [click here](${link}).

Sincerely,

The ${config.eventName} Team.`;
			try {
				await sendMailAsync({
					from: config.email.from,
					to: email,
					subject: `[${config.eventName}] - Verify your email`,
					html: await renderEmailHTML(markdown, user),
					text: await renderEmailText(markdown, user)
				});
			}
			catch (err) {
				done(err);
				return;
			}
			done(null, user);
		}
		else {
			// Log the user in
			let hash = await pbkdf2Async(password, Buffer.from(user.local.salt, "hex"), PBKDF2_ROUNDS);
			if (hash.toString("hex") === user.local.hash) {
				if (user.verifiedEmail) {
					done(null, user);
				}
				else {
					done(null, false, { "message": "You must verify your email before you can sign in" });
				}
			}
			else {
				done(null, false, { "message": "Incorrect email or password" });
			}
		}
	}

	public use(authRoutes: Router) {
		passport.use(this.passportStrategy);

		authRoutes.post("/signup", validateAndCacheHostName, postParser, passport.authenticate("local", { failureRedirect: "/login", failureFlash: true }), (request, response) => {
			// User is logged in automatically by Passport but we want them to verify their email first
			request.logout();
			request.flash("success", "Account created successfully. Please verify your email before logging in.");
			response.redirect("/login");
		});

		authRoutes.post("/login", postParser, passport.authenticate("local", { failureRedirect: "/login", failureFlash: true, successRedirect: "/" }));

		authRoutes.get("/verify/:code", async (request, response) => {
			let user = await User.findOne({ "local.verificationCode": request.params.code });
			if (!user) {
				request.flash("error", "Invalid email verification code");
			}
			else {
				user.verifiedEmail = true;
				// Possibly promote to admin status
				if (config.admins.indexOf(user.email) !== -1) {
					user.admin = true;
					console.info(`Adding new admin: ${user.email}`);
				}
				await user.save();
				request.flash("success", "Thanks for verifying your email. You can now log in.");
				trackEvent("verified email", request, user.email);
			}
			response.redirect("/login");
		});

		authRoutes.post("/forgot", validateAndCacheHostName, postParser, async (request, response) => {
			let email: string | undefined = request.body.email;
			if (!email || !email.toString().trim()) {
				request.flash("error", "Invalid email");
				response.redirect("/login/forgot");
				return;
			}
			email = email.toString().trim();

			let user = await User.findOne({ email });
			if (!user) {
				request.flash("error", "No account matching the email that you submitted was found");
				response.redirect("/login/forgot");
				return;
			}
			if (!user.verifiedEmail) {
				request.flash("error", "Please verify your email first");
				response.redirect("/login");
				return;
			}
			if (!user.local) {
				request.flash("error", "The account with the email that you submitted has no password set. Please log in with an external service like GitHub, Google, or Facebook instead.");
				response.redirect("/login");
				return;
			}

			user.local.resetRequested = true;
			user.local.resetRequestedTime = new Date();
			user.local.resetCode = crypto.randomBytes(32).toString("hex");

			// Send reset email (hostname validated by previous middleware)
			let link = createLink(request, `/auth/forgot/${user.local.resetCode}`);
			let markdown =
`Hi {{name}},

You (or someone who knows your email address) recently asked to reset the password for this account: {{email}}.

You can update your password by [clicking here](${link}).

If you don't use this link within ${moment.duration(config.server.passwordResetExpiration, "milliseconds").humanize()}, it will expire and you will have to [request a new one](${createLink(request, "/login/forgot")}).

If you didn't request a password reset, you can safely disregard this email and no changes will be made to your account.

Sincerely,

The ${config.eventName} Team.`;
			try {
				await user.save();
				await sendMailAsync({
					from: config.email.from,
					to: email,
					subject: `[${config.eventName}] - Password reset request`,
					html: await renderEmailHTML(markdown, user),
					text: await renderEmailText(markdown, user)
				});
				request.flash("success", "Please check your email for a link to reset your password. If it doesn't appear within a few minutes, check your spam folder.");
				response.redirect("/login/forgot");
			}
			catch (err) {
				console.error(err);
				request.flash("error", "An error occurred while sending you a password reset email");
				response.redirect("/login/forgot");
			}
		});

		authRoutes.post("/forgot/:code", validateAndCacheHostName, postParser, async (request, response) => {
			let user = await User.findOne({ "local.resetCode": request.params.code });
			if (!user) {
				request.flash("error", "Invalid password reset code");
				response.redirect("/login");
				return;
			}

			let expirationDuration = moment.duration(config.server.passwordResetExpiration, "milliseconds");
			if (!user.local!.resetRequested || moment().isAfter(moment(user.local!.resetRequestedTime).add(expirationDuration))) {
				request.flash("error", "Your password reset link has expired. Please request a new one.");
				user.local!.resetCode = "";
				user.local!.resetRequested = false;
				await user.save();
				response.redirect("/login");
				return;
			}

			let password1: string | undefined = request.body.password1;
			let password2: string | undefined = request.body.password2;
			if (!password1 || !password2) {
				request.flash("error", "Missing new password or confirm password");
				response.redirect(path.join("/auth", request.url));
				return;
			}
			if (password1 !== password2) {
				request.flash("error", "Passwords must match");
				response.redirect(path.join("/auth", request.url));
				return;
			}

			let salt = crypto.randomBytes(32);
			let hash = await pbkdf2Async(password1, salt, PBKDF2_ROUNDS);

			try {
				user.local!.salt = salt.toString("hex");
				user.local!.hash = hash.toString("hex");
				user.local!.resetCode = "";
				user.local!.resetRequested = false;
				await user.save();

				request.flash("success", "Password reset successfully. You can now log in.");
				response.redirect("/login");
			}
			catch (err) {
				console.error(err);
				request.flash("error", "An error occurred while saving your new password");
				response.redirect(path.join("/auth", request.url));
			}
		});
	}

	public logout() {
		return;
	}
}

export const strategies = {
	"local": Local,
	"github": GitHub,
	"google": Google,
	"facebook": Facebook
};

// Authentication helpers
function getExternalPort(request: Request): number {
	function defaultPort(): number {
		// Default ports for HTTP and HTTPS
		return request.protocol === "http" ? 80 : 443;
	}

	let host = request.headers.host;
	if (!host || Array.isArray(host)) {
		return defaultPort();
	}

	// IPv6 literal support
	let offset = host[0] === "[" ? host.indexOf("]") + 1 : 0;
	let index = host.indexOf(":", offset);
	if (index !== -1) {
		return parseInt(host.substring(index + 1), 10);
	}
	else {
		return defaultPort();
	}
}

let validatedHostNames: string[] = [];
function validateAndCacheHostName(request: Request, response: Response, next: NextFunction) {
	// Basically checks to see if the server behind the hostname has the same session key by HMACing a random nonce
	if (validatedHostNames.find(hostname => hostname === request.hostname)) {
		next();
		return;
	}

	let nonce = crypto.randomBytes(64).toString("hex");
	function callback(message: http.IncomingMessage) {
		if (message.statusCode !== 200) {
			console.error(`Got non-OK status code when validating hostname: ${request.hostname}`);
			message.resume();
			return;
		}
		message.setEncoding("utf8");
		let data = "";
		message.on("data", (chunk) => data += chunk);
		message.on("end", () => {
			let localHMAC = crypto.createHmac("sha256", config.secrets.session).update(nonce).digest().toString("hex");
			if (localHMAC === data) {
				validatedHostNames.push(request.hostname);
				next();
			}
			else {
				console.error(`Got invalid HMAC when validating hostname: ${request.hostname}`);
			}
		});
	}
	function onError(err: Error) {
		console.error(`Error when validating hostname: ${request.hostname}`, err);
	}
	if (request.protocol === "http") {
		http.get(`http://${request.hostname}:${getExternalPort(request)}/auth/validatehost/${nonce}`, callback).on("error", onError);
	}
	else {
		https.get(`https://${request.hostname}:${getExternalPort(request)}/auth/validatehost/${nonce}`, callback).on("error", onError);
	}
}

export function createLink(request: Request, link: string): string {
	if (link[0] === "/") {
		link = link.substring(1);
	}
	if ((request.secure && getExternalPort(request) === 443) || (!request.secure && getExternalPort(request) === 80)) {
		return `http${request.secure ? "s" : ""}://${request.hostname}/${link}`;
	}
	else {
		return `http${request.secure ? "s" : ""}://${request.hostname}:${getExternalPort(request)}/${link}`;
	}
}
