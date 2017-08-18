import * as path from "path";

import * as express from "express";
import * as session from "express-session";
import * as serveStatic from "serve-static";
import * as compression from "compression";
import * as cookieParser from "cookie-parser";
import * as morgan from "morgan";
import * as connectMongo from "connect-mongo";
const MongoStore = connectMongo(session);
import * as bodyParser from "body-parser";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import flash = require("connect-flash");

import * as graphql from "./routes/api/graphql";
import {
	// Constants
	PORT, STATIC_ROOT, VERSION_NUMBER, VERSION_HASH, COOKIE_OPTIONS,
	config, mongoose
} from "./common";
import {
	User
} from "./schema";
import {
	authRoutes as localAuth,
	redirectToLogin as loginRedirectLocal
} from "./routes/auth";
import {
	authRoutes as externalAuth,
	redirectToLogin as loginRedirectExternal
} from "./routes/auth-service";

// Set up Express and its middleware
export let app = express();
app.use(morgan("dev"));
app.use(compression());
let cookieParserInstance = cookieParser(undefined, COOKIE_OPTIONS);
app.use(cookieParserInstance);
app.use(flash());

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

// Lets keep session data around
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

// Check to enable proxy or not
if (!config.server.isProduction) {
	console.warn("OAuth callback(s) running in development mode");
}
else {
	app.enable("trust proxy");
}

// Check session secret & warn
if (!config.sessionSecretSet) {
	console.warn("No session secret set; sessions won't carry over server restarts");
}

// Auth needs to be the first route configured or else requests handled
// Before it will always be unauthenticated
const authService = config.server.services.auth;
if (authService) {
	externalAuth(authService);
	console.log(`Not using built-in auth over ${authService.url}.`);
} else {
	localAuth();
}

// Create a redirect function to go with either method
export async function redirectToLogin(request: express.Request, response: express.Response) {
	if (authService) {
		await loginRedirectExternal(authService, request, response);
	} else {
		loginRedirectLocal(request, response);
	}
}

// Metrics
import {trackEvent} from "./common";
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
apiRouter.use("/user/:id", userRoutes);
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
app.use("/css", serveStatic(path.resolve(STATIC_ROOT, "css")));

// Set up graphql and graphiql routes
app.use("/graphql", bodyParser.json(), graphqlExpress({
	schema: graphql.schema
}));
app.use("/graphiql", graphiqlExpress({
	endpointURL: "/graphql"
}));

app.listen(PORT, () => {
	console.log(`Registration system v${VERSION_NUMBER} @ ${VERSION_HASH} started on port ${PORT}`);
});
