import { URL } from "url";
import * as crypto from "crypto";
import * as express from "express";
import * as session from "express-session";
import * as connectMongo from "connect-mongo";
const MongoStore = connectMongo(session);
import * as passport from "passport";

import {
	config, mongoose, COOKIE_OPTIONS
} from "../common";
import {
	IUser, User
} from "../schema";
import {
	AuthenticateOptions, GroundTruthStrategy, createLink, validateAndCacheHostName
} from "./strategies";

// Passport authentication
import { app } from "../app";

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
	saveUninitialized: false
}));
passport.serializeUser<IUser, string>((user, done) => {
	done(null, user.uuid);
});
passport.deserializeUser<IUser, string>((id, done) => {
	User.findOne({ uuid: id }, (err, user) => {
		done(err, user!);
	});
});

export let authRoutes = express.Router();

authRoutes.get("/validatehost/:nonce", (request, response) => {
	let nonce: string = request.params.nonce || "";
	response.send(crypto.createHmac("sha256", config.secrets.session).update(nonce).digest().toString("hex"));
});

authRoutes.all("/logout", async (request, response) => {
	let user = request.user as IUser | undefined;
	if (user) {
		let groundTruthURL = new URL(config.secrets.groundTruth.url);
		// Invalidates token and logs user out of Ground Truth too
		try {
			await GroundTruthStrategy.apiRequest("POST", new URL("/api/user/logout", groundTruthURL).toString(), user.token || "");
		}
		catch (err) {
			// User might already be logged out of Ground Truth
			// Log them out of registration and continue
			console.error(err);
		}
		request.logout();
	}
	if (request.session) {
		request.session.loginAction = "render";
	}
	response.redirect("/login");
});

app.use(passport.initialize());
app.use(passport.session());

const groundTruthStrategy = new GroundTruthStrategy(config.secrets.groundTruth.url);

passport.use(groundTruthStrategy);

authRoutes.get("/login", validateAndCacheHostName, (request, response, next) => {
	let callbackURL = createLink(request, "auth/login/callback");
	passport.authenticate("oauth2", { callbackURL } as AuthenticateOptions)(request, response, next);
});
authRoutes.get("/login/callback", validateAndCacheHostName, (request, response, next) => {
	let callbackURL = createLink(request, "auth/login/callback");

	if (request.query.error === "access_denied") {
		request.flash("error", "Authentication request was denied");
		response.redirect("/login");
		return;
	}
	passport.authenticate("oauth2", {
		failureRedirect: "/login",
		successReturnToOrRedirect: "/",
		callbackURL
	} as AuthenticateOptions)(request, response, next);
});
