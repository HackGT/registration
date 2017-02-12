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

const BASE_URL: string = (config && config.server.isProduction) ? "https://registration.hack.gt" : `http://localhost:${PORT}`;

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


if (!config || !config.server.isProduction) {
	console.warn("OAuth callback(s) running in development mode");
}
if (!config || !config.secrets.session) {
	console.warn("No session secret set; sessions won't carry over server restarts");
}
app.use(session({
	secret: (config && config.secrets.session) || crypto.randomBytes(32).toString("hex"),
	cookie: COOKIE_OPTIONS,
	resave: false,
	store: new MongoStore({
		mongooseConnection: mongoose.connection,
		touchAfter: 24 * 60 * 60 // Check for TTL every 24 hours at minimum
	}),
	saveUninitialized: true
}));
passport.serializeUser<IUser, string>((user, done) => {
	done(null, user._id);
});
passport.deserializeUser<IUser, string>((id, done) => {
	User.findById(id, (err, user) => {
		done(err, user);
	});
});

passport.use(new GitHubStrategy({
		clientID: GITHUB_CLIENT_ID,
		clientSecret: GITHUB_CLIENT_SECRET,
		callbackURL: `${BASE_URL}/${GITHUB_CALLBACK_HREF}`
	},
	async (accessToken, refreshToken, profile, done) => {
		let email = profile.emails[0].value;
		let user = await User.findOne({"email": email});
		let isAdmin = false;
		if (config && config.admins.indexOf(email) !== -1) {
			isAdmin = true;
			if (!user || !user.admin)
				console.info(`Adding new admin: ${email}`);
		}
		if (!user) {
			user = new User({
				"email": email,
				"name": profile.displayName,
				"githubData": {
					"id": profile.id,
					"username": profile.username,
					"profileUrl": profile.profileUrl
				},
				auth_keys: [],
				admin: isAdmin
			});
			await user.save();
			done(null, user);
		}
		else {
			if (!user.githubData.id || !user.githubData.username || !user.githubData.profileUrl) {
				user.githubData.id = profile.id;
				user.githubData.username = profile.username;
				user.githubData.profileUrl = profile.profileUrl;
			}
			if (!user.admin && isAdmin) {
				user.admin = true;
			}
			await user.save();
			done(null, user);
		}
	}
));
passport.use(new GoogleStrategy({
		clientID: GOOGLE_CLIENT_ID,
		clientSecret: GOOGLE_CLIENT_SECRET,
		callbackURL: `${BASE_URL}/${GOOGLE_CALLBACK_HREF}`
	},
	async (accessToken, refreshToken, profile, done) => {
		let email = profile.emails[0].value;
		let user = await User.findOne({"email": email});
		let isAdmin = false;
		if (config && config.admins.indexOf(email) !== -1) {
			isAdmin = true;
			if (!user || !user.admin)
				console.info(`Adding new admin: ${email}`);
		}
		if (!user) {
			user = new User({
				"email": email,
				"name": profile.displayName,
				"googleData": {
					"id": profile.id
				},
				auth_keys: [],
				admin: isAdmin
			});
			await user.save();
			done(null, user);
		}
		else {
			if (!user.googleData.id) {
				user.googleData.id = profile.id;
			}
			if (!user.admin && isAdmin) {
				user.admin = true;
			}
			await user.save();
			done(null, user);
		}
	}
));
passport.use(new FacebookStrategy({
		clientID: FACEBOOK_CLIENT_ID,
		clientSecret: FACEBOOK_CLIENT_SECRET,
		callbackURL: `${BASE_URL}/${FACEBOOK_CALLBACK_HREF}`,
		profileFields: ["id", "displayName", "email"]
	},
	async (accessToken, refreshToken, profile, done) => {
		if (!profile || !profile.emails || profile.emails.length === 0)
			done(null, false);

		let email = profile!.emails![0].value;
		let user = await User.findOne({"email": email});
		let isAdmin = false;
		if (config && config.admins.indexOf(email) !== -1) {
			isAdmin = true;
			if (!user || !user.admin)
				console.info(`Adding new admin: ${email}`);
		}
		if (!user) {
			user = new User({
				"email": email,
				"name": profile.displayName,
				"facebookData": {
					"id": profile.id
				},
				auth_keys: [],
				admin: isAdmin
			});
			await user.save();
			done(null, user);
		}
		else {
			if (!user.facebookData.id) {
				user.facebookData.id = profile.id;
			}
			if (!user.admin && isAdmin) {
				user.admin = true;
			}
			await user.save();
			done(null, user);
		}
	}
));

app.use(passport.initialize());
app.use(passport.session());

export let authRoutes = express.Router();

authRoutes.get("/github", passport.authenticate("github", { scope: [ "user:email" ] }));
authRoutes.get("/github/callback", passport.authenticate("github", { failureRedirect: "/login" }), (request, response) => {
	// Successful authentication, redirect home
	response.redirect("/");
});

authRoutes.get("/google", passport.authenticate("google", { scope: ["email"] }));
authRoutes.get("/google/callback", passport.authenticate("google", { failureRedirect: "/login" }), (request, response) => {
	// Successful authentication, redirect home
	response.redirect("/");
});

authRoutes.get("/facebook", passport.authenticate("facebook", { scope: [ "email" ] }));
authRoutes.get("/facebook/callback", passport.authenticate("facebook", { failureRedirect: "/login" }), (request, response) => {
	// Successful authentication, redirect home
	response.redirect("/");
});

authRoutes.all("/logout", (request, response) => {
	request.logout();
	response.redirect("/login");
});