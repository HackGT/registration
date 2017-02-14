import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

import * as express from "express";
import * as serveStatic from "serve-static";
import * as compression from "compression";
import * as cookieParser from "cookie-parser";
import * as morgan from "morgan";

import {
	// Functions
	pbkdf2Async,
	// Constants
	PORT, STATIC_ROOT, VERSION_NUMBER, VERSION_HASH, COOKIE_OPTIONS
} from "./common";
import {
	IUser, IUserMongoose, User
} from "./schema";

// Set up Express and its middleware
export let app = express();
app.use(morgan("dev"));
app.use(compression());
let cookieParserInstance = cookieParser(undefined, COOKIE_OPTIONS);
app.use(cookieParserInstance);

// Check for number of admin users and warn if none
(async () => {
	let users = await User.find({"admin": true});
	if (users.length !== 0)
		return;
	console.warn("No admin users are configured; admins can be added in config.json");
})();

// Auth needs to be the first route configured or else requests handled before it will always be unauthenticated
import {authRoutes} from "./routes/auth";
app.use("/auth", authRoutes);

let apiRouter = express.Router();
// API routes go here
import {userRoutes} from "./routes/api/user";
apiRouter.use("/user/:id", userRoutes);

app.use("/api", apiRouter);

// User facing routes
import {templateRoutes} from "./routes/templates";
app.use("/", templateRoutes);

app.use("/node_modules", serveStatic(path.resolve(__dirname, "../node_modules")));
app.use("/js", serveStatic(path.resolve(STATIC_ROOT, "js")));
app.use("/css", serveStatic(path.resolve(STATIC_ROOT, "css")));

app.listen(PORT, () => {
	console.log(`Registration system v${VERSION_NUMBER} @ ${VERSION_HASH} started on port ${PORT}`);
});