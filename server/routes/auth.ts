import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";
import * as express from "express";
import * as session from "express-session";
import * as connectMongo from "connect-mongo";
const MongoStore = connectMongo(session);
import * as passport from "passport";

import {
	config, mongoose, COOKIE_OPTIONS, pbkdf2Async, postParser, sendMailAsync, trackEvent
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
if (!config.sessionSecretSet) {
	console.warn("No session secret set; sessions won't carry over server restarts");
}
app.use(session({
	secret: config.secrets.session,
	cookie: COOKIE_OPTIONS,
	resave: false,
	store: new MongoStore({
		mongooseConnection: mongoose.connection,
		touchAfter: 24 * 60 * 60 // Check for TTL every 24 hours at minimum
	}),
	saveUninitialized: true
}));
passport.serializeUser<IUser, string>((user, done) => {
	done(null, user._id.toString());
});
passport.deserializeUser<IUser, string>((id, done) => {
	User.findById(id, (err, user) => {
		done(err, user!);
	});
});

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
	passport.use(new strategy(options, async (request: express.Request, accessToken: string, refreshToken: string, profile: Profile, done: (err: Error | null, user?: IUserMongoose | false) => void) => {
		let email: string = "";
		if (profile.emails && profile.emails.length > 0) {
			email = profile.emails[0].value;
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
		let hash = await pbkdf2Async(password, salt, PBKDF2_ROUNDS, 128, "sha256");
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
		let link = `http${request.secure ? "s" : ""}://${request.hostname}:${getExternalPort(request)}/auth/verify/${user.localData!.verificationCode}`;
		let text =
`Hi ${user.name},

Thanks for signing up for ${config.eventName}! To verify your email, please click the following link: ${link}

Sincerely,

The ${config.eventName} Team.`;
		try {
			await sendMailAsync({
				from: config.email.from,
				to: email,
				subject: `[${config.eventName}] - Verify your email`,
				text
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
		let hash = await pbkdf2Async(password, Buffer.from(user.localData.salt, "hex"), PBKDF2_ROUNDS, 128, "sha256");
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

export let authRoutes = express.Router();

function getExternalPort(request: express.Request): number {
	let host = request.headers.host!;
	// IPv6 literal support
	let offset = host[0] === "[" ? host.indexOf("]") + 1 : 0;
	let index = host.indexOf(":", offset);
	if (index !== -1) {
		return parseInt(host.substring(index + 1), 10);
	}
	else {
		// Default ports for HTTP and HTTPS
		return request.protocol === "http" ? 80 : 443;
	}
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
authRoutes.get("/validatehost/:nonce", (request, response) => {
	let nonce: string = request.params.nonce || "";
	response.send(crypto.createHmac("sha256", config.secrets.session).update(nonce).digest().toString("hex"));
});

function addAuthenticationRoute(serviceName: "github" | "google" | "facebook", scope: string[], callbackHref: string) {
	authRoutes.get(`/${serviceName}`, validateAndCacheHostName, (request, response, next) => {
		let callbackURL = `${request.protocol}://${request.hostname}:${getExternalPort(request)}/${callbackHref}`;
		passport.authenticate(
			serviceName,
			{ scope, callbackURL } as passport.AuthenticateOptions
		)(request, response, next);
	});
	authRoutes.get(`/${serviceName}/callback`, validateAndCacheHostName, (request, response, next) => {
		let callbackURL = `${request.protocol}://${request.hostname}:${getExternalPort(request)}/${callbackHref}`;
		passport.authenticate(
			serviceName,
			{ failureRedirect: "/login", callbackURL } as passport.AuthenticateOptions
		)(request, response, next);
	}, (request, response) => {
		// Successful authentication, redirect home
		response.redirect("/");
	});
}

addAuthenticationRoute("github", ["user:email"], GITHUB_CALLBACK_HREF);
addAuthenticationRoute("google", ["email", "profile"], GOOGLE_CALLBACK_HREF);
addAuthenticationRoute("facebook", ["email"], FACEBOOK_CALLBACK_HREF);
authRoutes.post("/signup", validateAndCacheHostName, postParser, passport.authenticate("local", { failureRedirect: "/login", failureFlash: true }), (request, response) => {
	// User is logged in automatically by Passport but we want them to verify their email first
	request.logout();
	request.flash("success", "Account created successfully. Please verify your email before logging in.");
	response.redirect("/login");
});
authRoutes.post("/login", postParser, passport.authenticate("local", { failureRedirect: "/login", failureFlash: true, successRedirect: "/" }));
authRoutes.get("/verify/:code", async (request, response) => {
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

authRoutes.all("/logout", (request, response) => {
	request.logout();
	response.redirect("/login");
});
