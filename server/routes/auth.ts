import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import * as express from "express";
import * as session from "express-session";
import * as connectMongo from "connect-mongo";
const MongoStore = connectMongo(session);
import * as passport from "passport";

import {
	mongoose, PORT, COOKIE_OPTIONS
} from "../common";
import {
	Config,
	IUser, IUserMongoose, User
} from "../schema";

// Passport authentication
import {app} from "../app";
const GitHubStrategy = require("passport-github2").Strategy; // No type definitions available yet for this module (or for Google)
const GoogleStrategy = require("passport-google-oauth20").Strategy;
import {Strategy as FacebookStrategy} from "passport-facebook";

let config: Config | null = null;
try {
	config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../config", "config.json"), "utf8"));
}
catch (err) {
	if (err.code !== "ENOENT")
		throw err;
}

const isProduction: boolean = (config && config.server.isProduction) || process.env.PRODUCTION === "true";

// GitHub
const GITHUB_CLIENT_ID: string | null = process.env.GITHUB_CLIENT_ID || (config && config.secrets.github.id);
const GITHUB_CLIENT_SECRET: string | null = process.env.GITHUB_CLIENT_SECRET || (config && config.secrets.github.secret);
if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
	throw new Error("GitHub client ID or secret not configured in config.json or environment variables");
}
const GITHUB_CALLBACK_HREF: string = "auth/github/callback";

// Google
const GOOGLE_CLIENT_ID: string | null = process.env.GOOGLE_CLIENT_ID || (config && config.secrets.google.id);
const GOOGLE_CLIENT_SECRET: string | null = process.env.GOOGLE_CLIENT_SECRET || (config && config.secrets.google.secret);
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
	throw new Error("Google client ID or secret not configured in config.json or environment variables");
}
const GOOGLE_CALLBACK_HREF: string = "auth/google/callback";

// Facebook
const FACEBOOK_CLIENT_ID: string | null = process.env.FACEBOOK_CLIENT_ID || (config && config.secrets.facebook.id);
const FACEBOOK_CLIENT_SECRET: string | null = process.env.FACEBOOK_CLIENT_SECRET || (config && config.secrets.facebook.secret);
if (!FACEBOOK_CLIENT_ID || !FACEBOOK_CLIENT_SECRET) {
	throw new Error("Facebook client ID or secret not configured in config.json or environment variables");
}
const FACEBOOK_CALLBACK_HREF: string = "auth/facebook/callback";

if (!isProduction) {
	console.warn("OAuth callback(s) running in development mode");
}
else {
	app.enable("trust proxy");
}
const sessionSecretSet: boolean = !!(config && config.secrets.session) || !!process.env.SESSION_SECRET;
const sessionSecret: string = sessionSecretSet 
	? (config && config.secrets.session) || process.env.SESSION_SECRET
	: crypto.randomBytes(32).toString("hex");
if (!sessionSecretSet) {
	console.warn("No session secret set; sessions won't carry over server restarts");
}
app.use(session({
	secret: sessionSecret,
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
		done(err, user);
	});
});

function useLoginStrategy(strategy: any, dataFieldName: "githubData" | "googleData" | "facebookData", options: { clientID: string; clientSecret: string; profileFields?: string[] }) {
	passport.use(new strategy(options, async (accessToken, refreshToken, profile, done) => {
		let email = profile.emails[0].value;
		let user = await User.findOne({"email": email});
		let isAdmin = false;
		if ((config && config.admins && config.admins.indexOf(email) !== -1) || (process.env.ADMIN_EMAILS && process.env.ADMIN_EMAILS.split(",").indexOf(email) !== -1)) {
			isAdmin = true;
			if (!user || !user.admin)
				console.info(`Adding new admin: ${email}`);
		}
		if (!user) {
			user = new User({
				"email": email,
				"name": profile.displayName,

				"githubData": {},
				"googleData": {},
				"facebookData": {},

				"applied": false,
				"accepted": false,
				"attending": false,
				"applicationData": [],

				"admin": isAdmin
			});
			user[dataFieldName]!.id = profile.id;
			if (dataFieldName === "githubData") {
				user[dataFieldName]!.username = profile.username;
				user[dataFieldName]!.profileUrl = profile.profileUrl;
			}
			await user.save();
			done(null, user);
		}
		else {
			if (!user[dataFieldName]!.id) {
				user[dataFieldName]!.id = profile.id;
			}
			if (dataFieldName === "githubData" && (!user.githubData!.username || !user.githubData!.profileUrl)) {
				user[dataFieldName]!.username = profile.username;
				user[dataFieldName]!.profileUrl = profile.profileUrl;
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
	clientID: GITHUB_CLIENT_ID,
	clientSecret: GITHUB_CLIENT_SECRET
});
useLoginStrategy(GoogleStrategy, "googleData", {
	clientID: GOOGLE_CLIENT_ID,
	clientSecret: GOOGLE_CLIENT_SECRET
});
useLoginStrategy(FacebookStrategy, "facebookData", {
	clientID: FACEBOOK_CLIENT_ID,
	clientSecret: FACEBOOK_CLIENT_SECRET,
	profileFields: ["id", "displayName", "email"]
});

app.use(passport.initialize());
app.use(passport.session());


export let authRoutes = express.Router();

function getExternalPort(request: express.Request): number {
	let host = request.headers.host;
	// IPv6 literal support
	let offset = host[0] === "[" ? host.indexOf("]") + 1 : 0;
	let index = host.indexOf(":", offset);
	if (index !== -1) {
		return parseInt(host.substring(index + 1));
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
	function callback (message: http.IncomingMessage) {
		if (message.statusCode !== 200) {
			console.error(`Got non-OK status code when validating hostname: ${request.hostname}`);
			message.resume();
			return;
		}
		message.setEncoding("utf8");
		let data = "";
		message.on("data", (chunk) => data += chunk);
		message.on("end", () => {
			let localHMAC = crypto.createHmac("sha256", sessionSecret).update(nonce).digest().toString("hex");
			if (localHMAC === data) {
				validatedHostNames.push(request.hostname);
				next();
			}
			else {
				console.error(`Got invalid HMAC when validating hostname: ${request.hostname}`);
			}
		});
	}
	function onError (err: Error) {
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
	response.send(crypto.createHmac("sha256", sessionSecret).update(nonce).digest().toString("hex"));
});

function addAuthenticationRoute(serviceName: "github" | "google" | "facebook", scope: string[], callbackHref: string) {
	authRoutes.get(`/${serviceName}`, validateAndCacheHostName, (request, response, next) => {
		let callbackURL = `${request.protocol}://${request.hostname}:${getExternalPort(request)}/${callbackHref}`;
		passport.authenticate(
			serviceName,
			<passport.AuthenticateOptions>{ scope: scope, callbackURL: callbackURL }
		)(request, response, next);
	});
	authRoutes.get(`/${serviceName}/callback`, validateAndCacheHostName, (request, response, next) => {
		let callbackURL = `${request.protocol}://${request.hostname}:${getExternalPort(request)}/${callbackHref}`;
		passport.authenticate(
			serviceName,
			<passport.AuthenticateOptions>{ failureRedirect: "/login", callbackURL: callbackURL }
		)(request, response, next);
	}, (request, response) => {
		// Successful authentication, redirect home
		response.redirect("/");
	});
}

addAuthenticationRoute("github", ["user:email"], GITHUB_CALLBACK_HREF);
addAuthenticationRoute("google", ["email"], GOOGLE_CALLBACK_HREF);
addAuthenticationRoute("facebook", ["email"], FACEBOOK_CALLBACK_HREF);

authRoutes.all("/logout", (request, response) => {
	request.logout();
	response.redirect("/login");
});
