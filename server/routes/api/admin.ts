import * as express from "express";

import {
	isAdmin, config, validateSchema, formatSize
} from "../../common";
import {
	User, Team
} from "../../schema";

export let adminRoutes = express.Router();

adminRoutes.route("/users").get(isAdmin, async (request, response) => {
	let offset = parseInt(request.query.offset, 10);
	if (isNaN(offset) || offset < 0) {
		offset = 0;
	}
	let count = parseInt(request.query.count, 10);
	if (isNaN(count) || count <= 0) {
		count = 10;
	}
	let filter: any = {};
	if (request.query.applied === "true") {
		filter.applied = true;
	}
	if (request.query.branch) {
		// tslint:disable-next-line:no-string-literal
		filter["$or"] = [{ "applicationBranch": request.query.branch }, { "confirmationBranch": request.query.branch }];
	}
	if (request.query.status === "no-decision") {
		filter.applied = true;
		filter.accepted = false;
	}
	if (request.query.status === "accepted") {
		filter.applied = true;
		filter.accepted = true;
	}
	let rawQuestions = await validateSchema(config.questions, "./config/questions.schema.json");

	let teamIDNameMap: {
		[id: string]: string;
	} = {};
	(await Team.find()).forEach(team => {
		teamIDNameMap[team._id.toString()] = team.teamName;
	});

	let total = await User.count(filter);
	let results = (await User.find(filter).collation({ "locale": "en" }).sort({ name: "asc" }).skip(offset).limit(count).exec()).map(user => {
		let loginMethods: string[] = [];
		if (user.githubData && user.githubData.id) {
			loginMethods.push("GitHub");
		}
		if (user.googleData && user.googleData.id) {
			loginMethods.push("Google");
		}
		if (user.facebookData && user.facebookData.id) {
			loginMethods.push("Facebook");
		}
		if (user.localData && user.localData.hash) {
			loginMethods.push("Local");
		}
		let status: string = "Signed up";
		if (user.applied) {
			status = `Applied (${user.applicationBranch})`;
		}
		if (user.accepted) {
			status = `Accepted (${user.applicationBranch})`;
		}
		if (user.attending) {
			status = `Accepted (${user.applicationBranch}) / Attending (${user.confirmationBranch})`;
		}
		let questionsFromBranch = rawQuestions.find(branch => branch.name === user.applicationBranch);
		let applicationDataFormatted: {"label": string; "value": string}[] = [];
		if (questionsFromBranch) {
			applicationDataFormatted = user.applicationData.map(question => {
				let rawQuestion = questionsFromBranch!.questions.find(q => q.name === question.name);
				// If there isn't schema information for this question return the raw name as the label
				let label: string = rawQuestion ? rawQuestion.label : question.name;

				if (typeof question.value === "string") {
					return { label, value: question.value };
				}
				else if (Array.isArray(question.value)) {
					return { label, value: question.value.join(", ") };
				}
				else if (question.value === null) {
					return { label, value: "N/A" };
				}
				else {
					// Multer file
					let file = question.value;
					let formattedSize = formatSize(file.size);
					return { label, value: `[${file.mimetype} | ${formattedSize}]: ${file.path}`, filename: file.filename };
				}
			});
		}

		return {
			...user.toObject(),
			"status": status,
			"loginMethods": loginMethods.join(", "),
			"applicationDataFormatted": applicationDataFormatted,
			"teamName": user.teamId ? teamIDNameMap[user.teamId.toString()] : null
		};
	});
	response.json({
		offset,
		count,
		total,
		data: results
	});
});
