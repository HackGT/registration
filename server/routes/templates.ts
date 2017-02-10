import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as Handlebars from "handlebars";

import {
	STATIC_ROOT,
	authenticateWithReject,
	authenticateWithRedirect
} from "../common";
import {
	IUser, IUserMongoose, User,
	IIndexTemplate, ILoginTemplate
} from "../schema";

export let templateRoutes = express.Router();

// Load and compile Handlebars templates
let [indexTemplate, loginTemplate] = ["index.html", "login.html"].map(file => {
	let data = fs.readFileSync(path.resolve(STATIC_ROOT, file), "utf8");
	return Handlebars.compile(data);
});

templateRoutes.route("/").get(authenticateWithRedirect, (request, response) => {
	let templateData: IIndexTemplate = {
		siteTitle: "HackGT High School"
	};
	response.send(indexTemplate(templateData));
});

templateRoutes.route("/login").get((request, response) => {
	let templateData: ILoginTemplate = {
		siteTitle: "HackGT High School"
	};
	response.send(loginTemplate(templateData));
});