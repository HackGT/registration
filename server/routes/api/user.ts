import * as fs from "fs";
import * as path from "path";
import * as express from "express";

import {
	UPLOAD_ROOT,
    postParser, uploadHandler,
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

export let userRoutes = express.Router({ "mergeParams": true });

userRoutes.post("/application", isUserOrAdmin, postParser, uploadHandler.any(), async (request, response) => {
	let user = await User.findById(request.params.id);

	let questionData: QuestionBranches;
	try {
		questionData = await validateSchema("./config/questions.json", "./config/questions.schema.json");
	}
	catch (err) {
		console.error("validateSchema error:", err);
		response.status(500).json({
			"error": "An error occurred while validating question structure"
		});
		return;
	}
	let errored: boolean = false; // Used because .map() can't be broken out of
	let rawData: (IFormItem | null)[] = questionData.map(question => {
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
		return {
			"name": question.name,
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

		user.applied = true;
		user.applicationData = data;
		user.markModified("applicationData");

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
