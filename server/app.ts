import * as path from "path";

import * as express from "express";
import * as serveStatic from "serve-static";
import * as compression from "compression";
import * as cookieParser from "cookie-parser";
import * as cookieSignature from "cookie-signature";
import * as chalk from "chalk";
import * as morgan from "morgan";
import flash = require("connect-flash");

import {
	// Constants
	PORT, STATIC_ROOT, VERSION_NUMBER, VERSION_HASH, COOKIE_OPTIONS,
	// Configuration
	config
} from "./common";
import {
	User
} from "./schema";
import { setupRoutes as graphQlRoutes } from "./routes/api/graphql";

// Set up Express and its middleware
export let app = express();

app.use(compression());
let cookieParserInstance = cookieParser(undefined, COOKIE_OPTIONS as cookieParser.CookieParseOptions);
app.use(cookieParserInstance);
morgan.token("sessionid", (request, response) => {
	const FAILURE_MESSAGE = "Unknown session";
	if (!request.cookies["connect.sid"]) {
		return FAILURE_MESSAGE;
	}
	let rawID: string = request.cookies["connect.sid"].slice(2);
	let id = cookieSignature.unsign(rawID, config.secrets.session);
	if (typeof id === "string") {
		return id;
	}
	return FAILURE_MESSAGE;
});
morgan.format("hackgt", (tokens, request, response) => {
	let statusColorizer: (input: string) => string = input => input; // Default passthrough function
	if (response.statusCode >= 500) {
		statusColorizer = chalk.red;
	}
	if (response.statusCode >= 400) {
		statusColorizer = chalk.yellow;
	}
	if (response.statusCode >= 300) {
		statusColorizer = chalk.cyan;
	}
	if (response.statusCode >= 200) {
		statusColorizer = chalk.green;
	}

	return [
		tokens.date(request, response, "iso"),
		tokens["remote-addr"](request, response),
		tokens.sessionid(request, response),
		tokens.method(request, response),
		tokens.url(request, response),
		statusColorizer(tokens.status(request, response)),
		tokens["response-time"](request, response), "ms", "-",
		tokens.res(request, response, "content-length")
	].join(" ");
});
app.use(morgan("hackgt"));
app.use(flash());

// Throw and show a stack trace on an unhandled Promise rejection instead of logging an unhelpful warning
process.on("unhandledRejection", err => {
	throw err;
});

// Check for number of admin users and warn if none
(async () => {
	let users = await User.find({"admin": true});
	if (users.length !== 0) {
		return;
	}
	console.warn("No admin users are configured; admins can be added in config.json");
})().catch(err => {
	throw err;
});

// Auth needs to be the first route configured or else requests handled before it will always be unauthenticated
import {authRoutes} from "./routes/auth";
app.use("/auth", authRoutes);

// Metrics
import {trackEvent} from "./middleware";
app.use((request, response, next) => {
	// Track endpoints without extensions
	if (path.extname(request.url) === "") {
		let email: string | undefined = request.user ? request.user.email : undefined;
		trackEvent("visit", request, email);
	}
	next();
});

let apiRouter = express.Router();
// API routes go here
import {userRoutes} from "./routes/api/user";
apiRouter.use("/user/:uuid", userRoutes);
import {settingsRoutes} from "./routes/api/settings";
apiRouter.use("/settings", settingsRoutes);

app.use("/api", apiRouter);

// Uploaded file downloading for admins
import {uploadsRoutes} from "./routes/uploads";
app.use("/uploads", uploadsRoutes);

// User facing routes
import {templateRoutes} from "./routes/templates";
app.use("/", templateRoutes);
app.route("/version").get((request, response) => {
	response.json({
		"version": VERSION_NUMBER,
		"hash": VERSION_HASH,
		"node": process.version
	});
});

app.use("/node_modules", serveStatic(path.resolve(__dirname, "../node_modules")));
app.use("/js", serveStatic(path.resolve(STATIC_ROOT, "js")));
app.use("/css/theme.css", serveStatic(config.style.theme));
app.use("/favicon.ico", serveStatic(config.style.favicon));
app.use("/css", serveStatic(path.resolve(STATIC_ROOT, "css")));

graphQlRoutes(app);

app.listen(PORT, () => {
	console.log(`Registration system v${VERSION_NUMBER} @ ${VERSION_HASH} started on port ${PORT}`);
});
