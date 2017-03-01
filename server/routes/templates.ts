import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as Handlebars from "handlebars";

import {
	STATIC_ROOT,
	authenticateWithReject,
	authenticateWithRedirect,
	validateSchema, config
} from "../common";
import {
	IUser, IUserMongoose, User,
	IIndexTemplate, ILoginTemplate, 
	IRegisterBranchChoiceTemplate, IRegisterTemplate
} from "../schema";
import {QuestionBranches, Questions} from "../config/questions.schema";

export let templateRoutes = express.Router();

// Load and compile Handlebars templates
let [indexTemplate, loginTemplate, preregisterTemplate, registerTemplate] = ["index.html", "login.html", "preapplication.html", "application.html"].map(file => {
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
Handlebars.registerHelper("checked", function (selected: boolean[], index: number) {
	// Adds the "checked" form attribute if the element was checked previously
	return selected[index] ? "checked" : "";
});
Handlebars.registerHelper("selected", function (selected: boolean[], index: number) {
	// Adds the "selected" form attribute if the element was selected previously
	return selected[index] ? "selected" : "";
});
Handlebars.registerHelper("enabled", function (isEnabled: boolean) {
	// Adds the "disabled" form attribute if the element should be disabled
	return !isEnabled ? "disabled" : "";
});
Handlebars.registerHelper("slug", function (input: string): string {
	return encodeURIComponent(input.toLowerCase());
});
Handlebars.registerPartial("sidebar", fs.readFileSync(path.resolve(STATIC_ROOT, "partials", "sidebar.html"), "utf8"));

templateRoutes.route("/dashboard").get((request, response) => response.redirect("/"));
templateRoutes.route("/").get(authenticateWithRedirect, (request, response) => {
	let templateData: IIndexTemplate = {
		siteTitle: config.eventName,
		user: request.user
	};
	response.send(indexTemplate(templateData));
});

templateRoutes.route("/login").get((request, response) => {
	let templateData: ILoginTemplate = {
		siteTitle: config.eventName,
		error: request.flash("error"),
		success: request.flash("success")
	};
	response.send(loginTemplate(templateData));
});

templateRoutes.route("/apply").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;
	if (user.applied) {
		response.redirect(`/apply/${encodeURIComponent(user.applicationBranch.toLowerCase())}`);
		return;
	}

	let questionBranches: QuestionBranches;
	try {
		// Path is relative to common.ts, where validateSchema function is implemented
		questionBranches = await validateSchema("./config/questions.json", "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.status(500).send("An error occurred while generating the application options");
		return;
	}
	// If there's only one path, redirect to that
	if (questionBranches.length === 1) {
		response.redirect(`/apply/${encodeURIComponent(questionBranches[0].name.toLowerCase())}`);
		return;
	}
	let templateData: IRegisterBranchChoiceTemplate = {
		siteTitle: config.eventName,
		user: user,
		branches: questionBranches.map(branch => branch.name)
	};
	response.send(preregisterTemplate(templateData));
});
templateRoutes.route("/apply/:branch").get(authenticateWithRedirect, async (request, response) => {
	let user = request.user as IUser;
	let branchName = request.params.branch as string;
	if (user.applied && branchName.toLowerCase() !== user.applicationBranch.toLowerCase()) {
		response.redirect(`/apply/${encodeURIComponent(user.applicationBranch.toLowerCase())}`);
		return;
	}

	let questionBranches: QuestionBranches;
	try {
		// Path is relative to common.ts, where validateSchema function is implemented
		questionBranches = await validateSchema("./config/questions.json", "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.status(500).send("An error occurred while generating the application form");
		return;
	}
	let questionBranch = questionBranches.find(branch => branch.name.toLowerCase() === branchName.toLowerCase());
	if (!questionBranch) {
		response.status(400).send("Invalid application branch");
		return;
	}
	let questionData = questionBranch.questions.map(question => {
		let savedValue = user.applicationData.find(item => item.name === question.name);
		if (question.type === "checkbox" || question.type === "radio" || question.type === "select") {
			question["multi"] = true;
			if (question.hasOther) {
				question.options.push("Other");
			}
			question["selected"] = question.options.map(option => {
				if (savedValue && Array.isArray(savedValue.value)) {
					return savedValue.value.indexOf(option) !== -1;
				}
				else if (savedValue !== undefined) {
					return option === savedValue.value;
				}
				return false;
			});
			if (question.hasOther && savedValue) {
				if (!Array.isArray(savedValue.value)) {
					// Select / radio buttons
					if (question.options.indexOf(savedValue.value as string) === -1) {
						question["selected"][question.options.length - 1] = true; // The "Other" pushed earlier
						question["otherSelected"] = true;
						question["otherValue"] = savedValue.value;
					}
				}
				else {
					// Checkboxes
					for (let value of savedValue.value as string[]) {
						if (question.options.indexOf(value) === -1) {
							question["selected"][question.options.length - 1] = true; // The "Other" pushed earlier
							question["otherSelected"] = true;
							question["otherValue"] = value;
						}
					}
				}
			}
		}
		else {
			question["multi"] = false;
		}
		if (question.type === "file") {
			savedValue = undefined;
		}
		question["value"] = savedValue ? savedValue.value : "";
		return question;
	});
	let templateData: IRegisterTemplate = {
		siteTitle: config.eventName,
		user: request.user,
		branch: questionBranch.name,
		questionData: questionData
	};
	response.send(registerTemplate(templateData));
});
