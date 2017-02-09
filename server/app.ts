import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as os from "os";
import * as crypto from "crypto";
import * as http from "http";

import * as express from "express";
import * as serveStatic from "serve-static";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as multer from "multer";
import * as morgan from "morgan";

const PORT = parseInt(process.env.PORT) || 3000;
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost/";
const UNIQUE_APP_ID = process.env.UNIQUE_APP_ID || "registration";

export const STATIC_ROOT = path.resolve(__dirname, "../client");
export const VERSION_NUMBER = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version;
export const VERSION_HASH = require("git-rev-sync").short();

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

import * as mongoose from "mongoose";
(<any>mongoose).Promise = global.Promise;
mongoose.connect(url.resolve(MONGO_URL, UNIQUE_APP_ID));
export {mongoose}; // For future unit testing and dependent routes; see https://github.com/HackGT/Ultimate-Checkin/blob/master/test/api.ts#L11

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

// Promise version of crypto.pbkdf2()
export function pbkdf2Async (...params: any[]) {
	return new Promise<Buffer>((resolve, reject) => {
		params.push(function (err: Error, derivedKey: Buffer) {
			if (err) {
				reject(err);
				return;
			}
			resolve(derivedKey);
		});
		crypto.pbkdf2.apply(null, params);
	});
}

export let postParser = bodyParser.urlencoded({
	extended: false
});
export let uploadHandler = multer({
	"storage": multer.diskStorage({
		destination: function (req, file, cb) {
			// The OS's default temporary directory
			// Should be changed (or moved via fs.rename()) if the files are to be persisted
			cb(null!, os.tmpdir());
		},
		filename: function (req, file, cb) {
			cb(null!, `${file.fieldname}-${Date.now()}.${path.extname(file.originalname)}`);
		}
	}),
	"limits": {
		"fileSize": 50000000, // 50 MB
		"files": 1
	}
});

// For API endpoints
export let authenticateWithReject = async function (request: express.Request, response: express.Response, next: express.NextFunction) {
	let authKey = request.cookies.auth;
	let user = await User.findOne({"auth_keys": authKey});
	if (!user) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else {
		response.locals.email = user.email;
		next();
	}
};
// For directly user facing endpoints
export let authenticateWithRedirect = async function (request: express.Request, response: express.Response, next: express.NextFunction) {
	let authKey = request.cookies.auth;
	let user = await User.findOne({"auth_keys": authKey});
	if (!user) {
		response.redirect("/login");
	}
	else {
		response.locals.email = user.email;
		next();
	}
};

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