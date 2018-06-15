import * as crypto from "crypto";
import * as express from "express";
import * as session from "express-session";
import * as connectMongo from "connect-mongo";
const MongoStore = connectMongo(session);
import * as passport from "passport";

import {
	config, mongoose, COOKIE_OPTIONS, getSetting
} from "../common";
import {
	IUser, User
} from "../schema";
import {
	RegistrationStrategy, strategies
} from "./strategies";

// Passport authentication
import {app} from "../app";

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
	done(null, user._id.toString());
});
passport.deserializeUser<IUser, string>((id, done) => {
	User.findById(id, (err, user) => {
		done(err, user!);
	});
});

let router = express.Router();
export let authRoutes: express.RequestHandler = (request, response, next) => {
	// Allows for dynamic dispatch when authentication gets reloaded
	router(request, response, next);
};

export async function reloadAuthentication() {
	router = express.Router();
	let authenticationMethods: RegistrationStrategy[] = [];
	let methods = await getSetting<(keyof typeof strategies)[]>("loginMethods");
	console.info(`Using authentication methods: ${methods.join(", ")}`);
	for (let methodName of methods) {
		if (!strategies[methodName]) {
			console.error(`Authentication method "${methodName}" is not available. Did you add it to the exported list of strategies?`);
			continue;
		}
		let method = new strategies[methodName]();
		authenticationMethods.push(method);
		method.use(router);
	}

	// Need to be redefined on every instance of a new router
	router.get("/validatehost/:nonce", (request, response) => {
		let nonce: string = request.params.nonce || "";
		response.send(crypto.createHmac("sha256", config.secrets.session).update(nonce).digest().toString("hex"));
	});

	router.all("/logout", (request, response) => {
		request.logout();
		response.redirect("/login");
	});
}
reloadAuthentication().catch(err => {
	throw err;
});

app.use(passport.initialize());
app.use(passport.session());
