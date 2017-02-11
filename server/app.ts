import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

import * as express from "express";
import * as serveStatic from "serve-static";
import * as compression from "compression";
import * as cookieParser from "cookie-parser";
import * as morgan from "morgan";

// Set up Express and its middleware
export let app = express();
app.use(morgan("dev"));
app.use(compression());
let cookieParserInstance = cookieParser(undefined, {
	"path": "/",
	"maxAge": 1000 * 60 * 60 * 24 * 30 * 6, // 6 months
	"secure": false,
	"httpOnly": true
});
app.use(cookieParserInstance);

import {
	// Functions
	pbkdf2Async,
	// Constants
	PORT, STATIC_ROOT, VERSION_NUMBER, VERSION_HASH
} from "./common";
import {
	IUser, IUserMongoose, User
} from "./schema";

// Check for number of admin users and create default admin account if none
const DEFAULT_EMAIL = "admin@hack.gt";
const DEFAULT_PASSWORD = "admin";
(async () => {
	let users = await User.find({"admin": true});
	if (users.length !== 0)
		return;

	let salt = crypto.randomBytes(32);
	let passwordHashed = await pbkdf2Async(DEFAULT_PASSWORD, salt, 500000, 128, "sha256");

	let defaultUser = new User({
		email: DEFAULT_EMAIL,
		name: "Default Admin",
		login: {
			hash: passwordHashed.toString("hex"),
			salt: salt.toString("hex")
		},
		auth_keys: [],
		admin: true
	});
	await defaultUser.save();
	console.info(`
Created default admin user
	Username: ${DEFAULT_EMAIL}
	Password: ${DEFAULT_PASSWORD}
**Delete this user after you have used it to set up your account**
	`);
})();

let apiRouter = express.Router();
// API routes go here
import {userRoutes} from "./routes/user";
apiRouter.use("/user", userRoutes);

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