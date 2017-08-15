import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";
import * as path from "path";
import * as moment from "moment-timezone";
import * as express from "express";
import * as passport from "passport";

import {
	config, pbkdf2Async, postParser, renderEmailHTML, renderEmailText, sendMailAsync, trackEvent,
	getExternalPort, createLink
} from "../common";
import {
	IUser, IUserMongoose, User
} from "../schema";

// Passport authentication
import {app} from "../app";

// tslint:disable:no-var-requires
// No type definitions available yet for these module (or for Google)
const GitHubStrategy = require("passport-github2").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
import {Strategy as FacebookStrategy} from "passport-facebook";
import {Strategy as LocalStrategy} from "passport-local";

export const LOGIN_PAGE = "/login";

export function redirectToLogin(req: express.Request, res: express.Response) {
	res.redirect("/login");
}

export function authRoutes() {
	// GitHub
	if (!config.secrets.github.id || !config.secrets.github.secret) {
		throw new Error("GitHub client ID or secret not configured in config.json or environment variables");
	}
	const GITHUB_CALLBACK_HREF: string = "auth/github/callback";

	// Google
	if (!config.secrets.google.id || !config.secrets.google.secret) {
		throw new Error("Google client ID or secret not configured in config.json or environment variables");
	}
	const GOOGLE_CALLBACK_HREF: string = "auth/google/callback";

	// Facebook
	if (!config.secrets.facebook.id || !config.secrets.facebook.secret) {
		throw new Error("Facebook client ID or secret not configured in config.json or environment variables");
	}
	const FACEBOOK_CALLBACK_HREF: string = "auth/facebook/callback";

	if (!config.server.isProduction) {
		console.warn("OAuth callback(s) running in development mode");
	}
	else {
		app.enable("trust proxy");
	}

	passport.serializeUser<IUser, string>((user, done) => {
		done(null, user._id.toString());
	});

	passport.deserializeUser<IUser, string>((id, done) => {
		User.findById(id, (err, user) => {
			done(err, user!);
		});
	});

	useLoginStrategy(GitHubStrategy, "githubData", {
		clientID: config.secrets.github.id,
		clientSecret: config.secrets.github.secret,
		passReqToCallback: true
	});
	useLoginStrategy(GoogleStrategy, "googleData", {
		clientID: config.secrets.google.id,
		clientSecret: config.secrets.google.secret,
		passReqToCallback: true
	});
	useLoginStrategy(FacebookStrategy, "facebookData", {
		clientID: config.secrets.facebook.id,
		clientSecret: config.secrets.facebook.secret,
		profileFields: ["id", "displayName", "email"],
		passReqToCallback: true
	});

	const PBKDF2_ROUNDS: number = 300000;
	passport.use(new LocalStrategy({
		usernameField: "email",
		passwordField: "password",
		passReqToCallback: true
	}, async (request, email, password, done) => {
		let user = await User.findOne({ "email": email });
		if (user && request.path.match(/\/signup$/i)) {
			done(null, false, { "message": "That email address is already in use" });
		}
		else if (user && !user.localData!.hash && (user.githubData!.id || user.googleData!.id || user.facebookData!.id)) {
			done(null, false, { "message": "Please log back in with GitHub, Google, or Facebook" });
		}
		else if (!user || !user.localData) {
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
			let isAdmin = false; // Only set this after they have verified their email
			let salt = crypto.randomBytes(32);
			let hash = await pbkdf2Async(password, salt, PBKDF2_ROUNDS);
			user = new User({
				"email": email,
				"name": request.body.name,
				"verifiedEmail": false,

				"localData": {
					"hash": hash.toString("hex"),
					"salt": salt.toString("hex"),
					"verificationCode": crypto.randomBytes(32).toString("hex")
				},
				"githubData": {},
				"googleData": {},
				"facebookData": {},

				"applied": false,
				"accepted": false,
				"acceptedEmailSent": false,
				"attending": false,
				"applicationData": [],
				"applicationStartTime": undefined,
				"applicationSubmitTime": undefined,

				"admin": isAdmin
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
			let link = createLink(request, `/auth/verify/${user.localData!.verificationCode}`);
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
			let hash = await pbkdf2Async(password, Buffer.from(user.localData.salt, "hex"), PBKDF2_ROUNDS);
			if (hash.toString("hex") === user.localData.hash) {
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
	}));

	app.use(passport.initialize());
	app.use(passport.session());

	const routes = express.Router();

	routes.get("/validatehost/:nonce", (request, response) => {
		let nonce: string = request.params.nonce || "";
		response.send(crypto.createHmac("sha256", config.secrets.session).update(nonce).digest().toString("hex"));
	});

	function addAuthenticationRoute(serviceName: "github" | "google" | "facebook", scope: string[], callbackHref: string) {
		routes.get(`/${serviceName}`, validateAndCacheHostName, (request, response, next) => {
			let callbackURL = `${request.protocol}://${request.hostname}:${getExternalPort(request)}/${callbackHref}`;
			passport.authenticate(
				serviceName,
				{ scope, callbackURL } as passport.AuthenticateOptions
			)(request, response, next);
		});
		routes.get(`/${serviceName}/callback`, validateAndCacheHostName, (request, response, next) => {
			let callbackURL = `${request.protocol}://${request.hostname}:${getExternalPort(request)}/${callbackHref}`;
			passport.authenticate(
				serviceName,
				{ failureRedirect: "/login", failureFlash: true, callbackURL } as passport.AuthenticateOptions
			)(request, response, next);
		}, (request, response) => {
			// Successful authentication, redirect home
			response.redirect("/");
		});
	}

	addAuthenticationRoute("github", ["user:email"], GITHUB_CALLBACK_HREF);
	addAuthenticationRoute("google", ["email", "profile"], GOOGLE_CALLBACK_HREF);
	addAuthenticationRoute("facebook", ["email"], FACEBOOK_CALLBACK_HREF);

	routes.post("/signup", validateAndCacheHostName, postParser, passport.authenticate("local", { failureRedirect: "/login", failureFlash: true }), (request, response) => {
		// User is logged in automatically by Passport but we want them to verify their email first
		request.logout();
		request.flash("success", "Account created successfully. Please verify your email before logging in.");
		response.redirect("/login");
	});

	routes.post("/login", postParser, passport.authenticate("local", { failureRedirect: "/login", failureFlash: true, successRedirect: "/" }));

	routes.get("/verify/:code", async (request, response) => {
		let user = await User.findOne({ "localData.verificationCode": request.params.code });
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

	routes.post("/forgot", validateAndCacheHostName, postParser, async (request, response) => {
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
		if (!user.localData) {
			request.flash("error", "The account with the email that you submitted has no password set. Please log in with GitHub, Google, or Facebook instead.");
			response.redirect("/login");
			return;
		}

		user.localData.resetRequested = true;
		user.localData.resetRequestedTime = new Date();
		user.localData.resetCode = crypto.randomBytes(32).toString("hex");

		// Send reset email (hostname validated by previous middleware)
		let link = createLink(request, `/auth/forgot/${user.localData.resetCode}`);
		let markdown =
	`Hi {{name}},

	You recently asked to reset the password for this account: {{email}}.

	You can update your password by [clicking here](${link}).

	If you don't use this link within ${moment.duration(config.server.passwordResetExpiration, "milliseconds").humanize()}, it will expire and you will have to [request a new one](${createLink(request, "/login/forgot")}).

	Sincerely,

	The ${config.eventName} Team.`;
		try {
			await user.save();
			await sendMailAsync({
				from: config.email.from,
				to: email,
				subject: `[${config.eventName}] - Please reset your password`,
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

	routes.post("/forgot/:code", validateAndCacheHostName, postParser, async (request, response) => {
		let user = await User.findOne({ "localData.resetCode": request.params.code });
		if (!user) {
			request.flash("error", "Invalid password reset code");
			response.redirect("/login");
			return;
		}

		let expirationDuration = moment.duration(config.server.passwordResetExpiration, "milliseconds");
		// TSLint is matching to the wrong type definition when checking for deprecation
		// tslint:disable-next-line:deprecation
		if (!user.localData!.resetRequested || moment().isAfter(moment(user.localData!.resetRequestedTime).add(expirationDuration))) {
			request.flash("error", "Your password reset link has expired. Please request a new one.");
			user.localData!.resetCode = "";
			user.localData!.resetRequested = false;
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
			user.localData!.salt = salt.toString("hex");
			user.localData!.hash = hash.toString("hex");
			user.localData!.resetCode = "";
			user.localData!.resetRequested = false;
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

	routes.all("/logout", (request, response) => {
		request.logout();
		response.redirect("/login");
	});

	app.use(routes);
}

// tslint:disable-next-line:interface-over-type-literal
type OAuthStrategyOptions = {
	clientID: string;
	clientSecret: string;
	profileFields?: string[];
	passReqToCallback: boolean;
};
type Profile = passport.Profile & {
	profileUrl?: string;
	_json: any;
};
function useLoginStrategy(strategy: any, dataFieldName: "githubData" | "googleData" | "facebookData", options: OAuthStrategyOptions) {
	passport.use(new strategy(options, async (request: express.Request, accessToken: string, refreshToken: string, profile: Profile, done: (err: Error | null, user?: IUserMongoose | false, errMessage?: object) => void) => {
		let email: string = "";
		if (profile.emails && profile.emails.length > 0) {
			email = profile.emails[0].value;
		}
		else if (!profile.emails || profile.emails.length === 0) {
			done(null, false, { message: "Your GitHub profile does not have any public email addresses. Please make an email address public before logging in with GitHub." });
			return;
		}
		else if (!profile.displayName || !profile.displayName.trim()) {
			done(null, false, { message: "Your profile does not have a publically visible name. Please set a name on your account before logging in." });
			return;
		}
		let user = await User.findOne({"email": email});
		let isAdmin = false;
		if (config.admins.indexOf(email) !== -1) {
			isAdmin = true;
			if (!user || !user.admin) {
				console.info(`Adding new admin: ${email}`);
			}
		}
		if (!user) {
			user = new User({
				"email": email,
				"name": profile.displayName,
				"verifiedEmail": true,

				"localData": {},
				"githubData": {},
				"googleData": {},
				"facebookData": {},

				"applied": false,
				"accepted": false,
				"attending": false,
				"applicationData": [],
				"applicationStartTime": undefined,
				"applicationSubmitTime": undefined,

				"admin": isAdmin
			});
			user[dataFieldName]!.id = profile.id;
			if (dataFieldName === "githubData" && profile.username && profile.profileUrl) {
				user[dataFieldName]!.username = profile.username;
				user[dataFieldName]!.profileUrl = profile.profileUrl;
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
			if (!user[dataFieldName] || !user[dataFieldName]!.id) {
				user[dataFieldName] = {
					id: profile.id
				};
			}
			if (!user.verifiedEmail) {
				// We trust our OAuth provider to have verified the user's email for us
				user.verifiedEmail = true;
			}
			if (dataFieldName === "githubData" && (!user.githubData || !user.githubData.username || !user.githubData.profileUrl) && (profile.username && profile.profileUrl)) {
				user.githubData!.username = profile.username;
				user.githubData!.profileUrl = profile.profileUrl;
			}
			if (!user.admin && isAdmin) {
				user.admin = true;
			}
			await user.save();
			done(null, user);
		}
	}));
}

let validatedHostNames: string[] = [];
function validateAndCacheHostName(request: express.Request, response: express.Response, next: express.NextFunction) {
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
