import * as crypto from "crypto";
import * as path from "path";
import * as express from "express";
import * as session from "express-session";
import * as connectMongo from "connect-mongo";
const MongoStore = connectMongo(session);
import * as passport from "passport";

import {
	config, mongoose, COOKIE_OPTIONS, getSetting
} from "../common";
import {
	IUser, User, IUserMongoose
} from "../schema";
import { postParser, authenticateWithReject } from "../middleware";
import {
	RegistrationStrategy, strategies, validateAndCacheHostName, sendVerificationEmail
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

	// These routes need to be redefined on every instance of a new router
	router.post("/confirm", authenticateWithReject, validateAndCacheHostName, postParser, async (request, response) => {
		let user = request.user as IUserMongoose;
		let name = request.body.name as string;
		if (!name || !name.trim()) {
			request.flash("error", "Invalid name");
			response.redirect("/login/confirm");
			return;
		}
		user.name = name.trim();

		let email = request.body.email as string | undefined;
		if (email && email !== user.email) {
			if (!email.trim()) {
				request.flash("error", "Invalid email");
				response.redirect("/login/confirm");
				return;
			}
			if (await User.count({ email }) > 0) {
				request.flash("error", "That email address is already in use. You may already have an account from another login service.");
				response.redirect("/login/confirm");
				return;
			}
			user.admin = false;
			user.verifiedEmail = false;
			user.email = email;
			if (config.admins.includes(email)) {
				user.admin = true;
				console.info(`Adding new admin: ${email}`);
			}
		}
		user.accountConfirmed = true;

		try {
			await user.save();
			if (!user.verifiedEmail && (!user.local || !user.local.verificationCode)) {
				await sendVerificationEmail(request, user);
			}
			if (!user.verifiedEmail) {
				request.logout();
				request.flash("success", "Account created successfully. Please verify your email before logging in.");
				response.redirect("/login");
				return;
			}
			response.redirect("/");
		}
		catch (err) {
			console.error(err);
			request.flash("error", "An error occurred while creating your account");
			response.redirect("/login/confirm");
		}
	});

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

app.use((request, response, next) => {
	// Only block requests for GET requests to non-auth pages
	if (path.extname(request.url) !== "" || request.method !== "GET" || request.originalUrl.match(/^\/auth/)) {
		next();
		return;
	}
	let user = request.user as IUser;
	if (user && !user.accountConfirmed && request.originalUrl !== "/login/confirm") {
		response.redirect("/login/confirm");
	}
	else {
		next();
	}
});
