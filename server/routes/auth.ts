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

authRoutes.all("/logout", (request, response) => {
	request.logout();
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
	passport.authenticate("oauth2", { callbackURL } as AuthenticateOptions, (err: Error | null, user?: IUser) {
		if (err) {
			console.error(err);
			next(err);
			return;
		}
		if (!user) {
			response.redirect("/login");
			return;
		}
		request.login(user, err2 => {
			if (err) {
				console.error(err2);
				next(err);
				return;
			}
			response.redirect("/");
		});
	})(request, response, next);
});
