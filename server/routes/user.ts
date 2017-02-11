import * as crypto from "crypto";
import * as express from "express";
import {
	pbkdf2Async,
	authenticateWithReject,
	authenticateWithRedirect,
	postParser
} from "../common";
import {
	IUser, IUserMongoose, User
} from "../schema";

export let userRoutes = express.Router();

userRoutes.route("/signup").post(postParser, async (request, response) => {
	let email: string = request.body.email || "";
	let password: string = request.body.password || "";
	email = email.trim();
	if (!email || !password) {
		response.status(400).json({
			"error": "Email or password not specified"
		});
		return;
	}

	let salt = crypto.randomBytes(32);
	let passwordHashed = await pbkdf2Async(password, salt, 500000, 128, "sha256");
	
	let user = new User({
		email: email,
		login: {
			hash: passwordHashed.toString("hex"),
			salt: salt.toString("hex")
		},
		auth_keys: [],
		admin: false
	});
	
	try {
		await user.save();
		response.status(201).json({
			"success": true
		});
	}
	catch (err) {
		if (err.code === 11000) {
			response.status(400).json({
				"error": "A user with that email already exists"
			});
			return;
		}
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while creating user"
		});
	}
});

userRoutes.route("/login").post(postParser, async (request, response) => {
	if (request.cookies.auth) {
		let authKey: string = request.cookies.auth;
		await User.update({ "auth_keys": authKey }, { $pull: { "auth_keys": authKey } }).exec();
		response.clearCookie("auth");
	}

	let email: string = request.body.email || "";
	let password: string = request.body.password || "";
	email = email.trim();
	if (!email || !password) {
		response.status(400).json({
			"error": "Email or password not specified"
		});
		return;
	}

	let user = await User.findOne({email: email});
	let salt: Buffer;
	if (!user) {
		salt = new Buffer(32);
	}
	else {
		salt = Buffer.from(user.login.salt, "hex");
	}
	// Hash the password in both cases so that requests for non-existant emails take the same amount of time as existant ones
	let passwordHashed = await pbkdf2Async(password, salt, 500000, 128, "sha256");
	if (!user || user.login.hash !== passwordHashed.toString("hex")) {
		response.status(401).json({
			"error": "Email or password incorrect"
		});
		return;
	}
	let authKey = crypto.randomBytes(32).toString("hex");
	user.auth_keys.push(authKey);

	try {
		await user.save();
		response.cookie("auth", authKey);
		response.status(200).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while logging in"
		});
	}
});

userRoutes.route("/logout").all(async (request, response) => {
	try {
		if (request.cookies.auth) {
			let authKey: string = request.cookies.auth;
			await User.update({ "auth_keys": authKey }, { $pull: { "auth_keys": authKey } }).exec();
			response.clearCookie("auth");
		}
		response.status(200).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while signing out"
		});
	}
});