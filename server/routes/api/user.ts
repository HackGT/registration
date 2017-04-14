import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as json2csv from "json2csv";
import * as archiver from "archiver";

import {
	UPLOAD_ROOT,
    postParser, uploadHandler,
	config, sendMailAsync,
	validateSchema
} from "../../common";
import {
	IFormItem,
	IUser, IUserMongoose, User,
} from "../../schema";
import {QuestionBranches, Questions} from "../../config/questions.schema";

function isUserOrAdmin (request: express.Request, response: express.Response, next: express.NextFunction) {
	let user = request.user as IUser;
	if (!request.isAuthenticated()) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else if (user._id.toString() !== request.params.id && !user.admin) {
		response.status(403).json({
			"error": "You are not permitted to access this endpoint"
		});
	}
	else {
		next();
	}
}

function isAdmin (request: express.Request, response: express.Response, next: express.NextFunction) {
	let user = request.user as IUser;
	if (!request.isAuthenticated()) {
		response.status(401).json({
			"error": "You must log in to access this endpoint"
		});
	}
	else if (!user.admin) {
		response.status(403).json({
			"error": "You are not permitted to access this endpoint"
		});
	}
	else {
		next();
	}
}

export let userRoutes = express.Router({ "mergeParams": true });

userRoutes.post("/application/:branch", isUserOrAdmin, postParser, uploadHandler.any(), async (request, response) => {
	let user = await User.findById(request.params.id);
	let branchName = request.params.branch as string;
	if (user.applied && branchName.toLowerCase() !== user.applicationBranch.toLowerCase()) {
		response.status(400).json({
			"error": "You can only edit the application branch that you originally submitted"
		});
		return;
	}

	let questionBranches: QuestionBranches;
	try {
		questionBranches = await validateSchema("./config/questions.json", "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.status(500).json({
			"error": "An error occurred while validating question structure"
		});
		return;
	}
	let questionBranch = questionBranches.find(branch => branch.name.toLowerCase() === branchName.toLowerCase());
	if (!questionBranch) {
		response.status(400).json({
			"error": "Invalid application branch"
		});
		return;
	}

	let errored: boolean = false; // Used because .map() can't be broken out of
	let rawData: (IFormItem | null)[] = questionBranch.questions.map(question => {
		if (errored) {
			return null;
		}
		// (Hackily) redefines the type of request.files because the default type is incorrect for multer's .any() handler
		let files: Express.Multer.File[] = (<any> request.files) as Express.Multer.File[];
		
		if (question.required && !request.body[question.name] && !files.find(file => file.fieldname === question.name)) {
			// Required field not filled in
			errored = true;
			response.status(400).json({
				"error": `'${question.label}' is a required field`
			});
			return null;
		}
		if ((question.type === "select" || question.type === "radio") && Array.isArray(request.body[question.name]) && question.hasOther) {
			// "Other" option selected
			request.body[question.name] = request.body[question.name].pop();
		}
		else if (question.type === "checkbox" && question.hasOther) {
			if (!request.body[question.name]) {
				request.body[question.name] = [];
			}
			if (!Array.isArray(request.body[question.name])) {
				request.body[question.name] = [request.body[question.name]];
			}
			// Filter out "other" option
			request.body[question.name] = (request.body[question.name] as string[]).filter(value => value !== "Other");
		}
		return {
			"name": question.name,
			"type": question.type,
			"value": request.body[question.name] || files.find(file => file.fieldname === question.name)
		};
	});
	if (errored) {
		return;
	}
	try {
		let data = rawData as IFormItem[]; // nulls are only inserted when an error has occurred
		// Move files to permanent, requested location
		await Promise.all(data
			.map(item => item.value)
			.filter(possibleFile => possibleFile !== null && typeof possibleFile === "object" && !Array.isArray(possibleFile))
			.map((file: Express.Multer.File): Promise<void> => {
				return new Promise<void>((resolve, reject) => {
					fs.rename(file.path, path.join(UPLOAD_ROOT, file.filename), err => {
						if (err) {
							reject(err);
							return;
						}
						resolve();
					});
				});
			})
		);
		// Set the proper file locations in the data object
		data = data.map(item => {
			if (item.value !== null && typeof item.value === "object" && !Array.isArray(item.value)) {
				item.value.destination = UPLOAD_ROOT;
				item.value.path = path.join(UPLOAD_ROOT, item.value.filename);
			}
			return item;
		});
		// Email the applicant to confirm
		// TODO: Make the content of these emails admin-configurable
		let text: string;
		if (questionBranch.name.toLowerCase() === "mentor") {
			text =
`Hi!

Thank you again for volunteering to be a mentor at ${config.eventName}! Please complete these background check forms as soon as possible: https://drive.google.com/open?id=0B8MqIMxG0xUJcmU5RFppWUNhWUE by following this guide: https://docs.google.com/document/d/1QJawDpf3a-oN15djbJ5jZufK_LJtKisMOgrbRVcUPEs/edit?usp=sharing.

If you have any questions, please don't hesitate to contact us by replying to this email.

Sincerely,

The ${config.eventName} Team`;
		}
		else {
			text =
`Hi!

Thank you for applying to be a ${questionBranch.name} at ${config.eventName}! Feel free to go back and update your application any time before registration closes.

If you have any questions please don't hesitate to contact us by replying to this email.

Sincerely,

The ${config.eventName} Team`;
		}
		if (!user.applied) {
			await sendMailAsync({
				from: config.email.from,
				to: user.email,
				subject: `[${config.eventName}] - Thank you for appying!`,
				text: text // TODO: Add HTML email template
			});
		}

		user.applied = true;
		user.applicationBranch = questionBranch.name;
		user.applicationData = data;
		user.markModified("applicationData");
		user.applicationSubmitTime = new Date();
		user.markModified("applicationSubmitTime");

		await user.save();
		response.status(200).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while saving the application"
		});
	}
});

userRoutes.delete("/application", isUserOrAdmin, async (request, response) => {
	let user = await User.findById(request.params.id);
	user.applied = false;
	user.applicationBranch = "";
	user.applicationData = [];
	user.markModified("applicationData");
	user.applicationSubmitTime = undefined;
	user.markModified("applicationSubmitTime");
	user.applicationStartTime = undefined;
	user.markModified("applicationStartTime");

	try {
		await user.save();
		response.status(200).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while deleting the application"
		});
	}
});

userRoutes.route("/status").post(isAdmin, uploadHandler.any(), async (request, response) => {
	let user = await User.findById(request.params.id);
	let status = request.body.status === "true";

	if (!user) {
		response.status(400).json({
			"error": `No such user with id ${request.params.id}`
		});
		return;
	}
	user.accepted = status;

	try {
		await user.save();
		response.status(200).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while accepting or rejecting the user"
		});
	}
});

userRoutes.route("/export").get(isAdmin, async (request, response) => {
	try {
		let questionBranches: QuestionBranches;
		try {
			questionBranches = await validateSchema("./config/questions.json", "./config/questions.schema.json");
		}
		catch (err) {
			console.error("validateSchema error:", err);
			response.status(500).json({
				"error": "An error occurred while validating question structure"
			});
			return;
		}

		let branchNames: string[] = questionBranches.map(branch => branch.name);
		let archive = archiver("zip", {
			store: true
		});
		response.status(200).type("application/zip");
		archive.pipe(response);
		
		for (let branchName of branchNames) {
			// TODO: THIS IS A PRELIMINARY VERSION FOR HACKGT CATALYST
			// TODO: Change this to { "accepted": true }
			let attendingUsers: IUserMongoose[] = await User.find({ "applied": true, "applicationBranch": branchName });
			if (attendingUsers.length === 0) continue;

			let csvData = attendingUsers.map(user => {
				// TODO: Replace with more robust schema-agnostic version
				let nameFormItem = user.applicationData.find(item => item.name === "name");
				return {
					"name": nameFormItem && typeof nameFormItem.value === "string" ? nameFormItem.value : user.name,
					"email": user.email
				};
			});
			archive.append(json2csv({ data: csvData, fields: Object.keys(csvData[0]) }), { "name": branchName + ".csv" });
		}
		archive.finalize();
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while exporting data"
		});
	}
});
