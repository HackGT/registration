import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as Handlebars from "handlebars";

import {
	STATIC_ROOT,
	authenticateWithReject,
	authenticateWithRedirect,
	validateSchema
} from "../common";
import {
	IUser, IUserMongoose, User,
	IIndexTemplate, ILoginTemplate, 
	IRegisterTemplate
} from "../schema";
import {Questions} from "../config/questions.schema";
const SITE_NAME = "HackGT Catalyst";

export let templateRoutes = express.Router();

// Load and compile Handlebars templates
let [indexTemplate, loginTemplate, registerTemplate] = ["index.html", "login.html", "application.html"].map(file => {
	let data = fs.readFileSync(path.resolve(STATIC_ROOT, file), "utf8");
	return Handlebars.compile(data);
});
Handlebars.registerHelper("ifCond", function(v1, v2, options) {
	if (v1 === v2) {
		return options.fn(this);
	}
	return options.inverse(this);
});
Handlebars.registerHelper("required", function (isRequired: boolean) {
	// Adds the "required" form attribute if the element requests to be required
	return isRequired ? "required" : "";
});
Handlebars.registerPartial("sidebar", fs.readFileSync(path.resolve(STATIC_ROOT, "partials", "sidebar.html"), "utf8"));

templateRoutes.route("/").get(authenticateWithRedirect, (request, response) => {
	let templateData: IIndexTemplate = {
		siteTitle: SITE_NAME,
		user: request.user
	};
	response.send(indexTemplate(templateData));
});

templateRoutes.route("/login").get((request, response) => {
	let templateData: ILoginTemplate = {
		siteTitle: SITE_NAME
	};
	response.send(loginTemplate(templateData));
});

templateRoutes.route("/apply").get(authenticateWithRedirect, async (request, response) => {
	let questionData: Questions;
	try {
		questionData = await validateSchema("./config/questions.json", "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.send("An error occurred while generating the application form");
		return;
	}
	questionData = questionData.map(question => {
		if (["checkbox", "radio", "select"].indexOf(question.type) !== -1) {
			question["multi"] = true;
		}
		else {
			question["multi"] = false;
		}
		return question;
	});
	let templateData: IRegisterTemplate = {
		siteTitle: SITE_NAME,
		questionData: questionData,
		user: request.user
	};
	response.send(registerTemplate(templateData));
});