import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import * as url from "url";
import * as os from "os";

//
// Constants
//
export const PORT = parseInt(process.env.PORT) || 3000;
export const STATIC_ROOT = path.resolve(__dirname, "../client");
export const VERSION_NUMBER = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")).version;
export const VERSION_HASH = require("git-rev-sync").short();

//
// Database connection
//
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost/";
const UNIQUE_APP_ID = process.env.UNIQUE_APP_ID || "registration";
import * as mongoose from "mongoose";
(<any>mongoose).Promise = global.Promise;
mongoose.connect(url.resolve(MONGO_URL, UNIQUE_APP_ID));
export {mongoose};

import {
	IUser, IUserMongoose, User
} from "./schema";

//
// Express middleware
//
import * as express from "express";
import * as bodyParser from "body-parser";
export let postParser = bodyParser.urlencoded({
	extended: false
});
import * as multer from "multer";
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
export async function authenticateWithReject (request: express.Request, response: express.Response, next: express.NextFunction) {
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
export async function authenticateWithRedirect (request: express.Request, response: express.Response, next: express.NextFunction) {
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

//
// Promisified APIs for use with async / await
//
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
export function readFileAsync (filename: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		fs.readFile(filename, "utf8", (err, data) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(data);
		})
	});
}

//
// JSON schema validator
//
import * as ajv from "ajv";
export async function validateSchema (questionsFile: string, schemaFile: string = "./config/questions.schema.json"): Promise<any> {
	let questions, schema;
	try {
		questions = JSON.parse(await readFileAsync(path.resolve(__dirname, questionsFile)));
		schema = JSON.parse(await readFileAsync(path.resolve(__dirname, schemaFile)));
	}
	catch (err) {
		// Invalid JSON or file read failed unexpectedly
		return Promise.reject(err);
	}

	let validator = new ajv();
	let valid = validator.validate(schema, questions);
	if (!valid) {
		return Promise.reject(validator.errors);
	}
	else {
		return questions;
	}
};