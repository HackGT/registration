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
const GitHubStrategy = require("passport-github2").Strategy;

let config: Config | null = null;
try {
	config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../config", "config.json"), "utf8"));
}
catch (err) {
	if (err.code !== "ENOENT")
		throw err;
}

const GITHUB_CLIENT_ID: string | null = process.env.GITHUB_CLIENT_ID || (config && config.secrets.github.id);
const GITHUB_CLIENT_SECRET: string | null = process.env.GITHUB_CLIENT_SECRET || (config && config.secrets.github.secret);
if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
	throw new Error("GitHub client ID or secret not configured in secrets.json or environment variables");
}
const GITHUB_CALLBACK_HREF: string = "auth/github/callback";
const GITHUB_CALLBACK_URL: string = (config && config.server.isProduction) ? `https://registration.hack.gt/${GITHUB_CALLBACK_HREF}` : `http://localhost:${PORT}/${GITHUB_CALLBACK_HREF}`;
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
		callbackURL: GITHUB_CALLBACK_URL
	},
	async (accessToken, refreshToken, profile, done) => {
		let email = profile.emails[0].value;
		let user = await User.findOne({"email": email});
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
				admin: false
			});
			await user.save();
			console.log("Created a new user");
			done(null, user);
		}
		else {
			console.log("Got previously existing user");
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

authRoutes.all("/logout", (request, response) => {
	request.logout();
	response.redirect("/login");
});