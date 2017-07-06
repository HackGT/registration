import * as fs from "fs";
import * as path from "path";
import * as express from "express";
import * as json2csv from "json2csv";
import * as archiver from "archiver";

import {
	UPLOAD_ROOT,
	postParser, uploadHandler,
	config, getSetting, renderEmailHTML, renderEmailText, sendMailAsync,
	ApplicationType,
	validateSchema,
	trackEvent
} from "../../common";
import {
	IFormItem,
	IUser, IUserMongoose, User,
	ITeamMongoose, Team
} from "../../schema";
import {QuestionBranches} from "../../config/questions.schema";

function isUserOrAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
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

function isAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
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

userRoutes.route("/application/:branch")
	.post(isUserOrAdmin, postParser, uploadHandler.any(), postApplicationBranchHandler)
	.delete(isUserOrAdmin, deleteApplicationBranchHandler);
userRoutes.route("/confirmation/:branch")
	.post(isUserOrAdmin, postParser, uploadHandler.any(), postApplicationBranchHandler)
	.delete(isUserOrAdmin, deleteApplicationBranchHandler);

async function postApplicationBranchHandler(request: express.Request, response: express.Response): Promise<void> {
	let requestType: ApplicationType = request.url.match(/\/application\//) ? ApplicationType.Application : ApplicationType.Confirmation;

	let user = await User.findById(request.params.id) as IUserMongoose;
	let branchName = request.params.branch as string;
	if (requestType === ApplicationType.Application && user.applied && branchName.toLowerCase() !== user.applicationBranch.toLowerCase()) {
		response.status(400).json({
			"error": "You can only edit the application branch that you originally submitted"
		});
		return;
	}
	else if (requestType === ApplicationType.Confirmation && user.attending && branchName.toLowerCase() !== user.confirmationBranch.toLowerCase()) {
		response.status(400).json({
			"error": "You can only edit the confirmation branch that you originally submitted"
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
		let files: Express.Multer.File[] = (request.files as any) as Express.Multer.File[];

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
		let data = rawData as IFormItem[]; // Nulls are only inserted when an error has occurred
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
		let emailMarkdown: string;
		try {
			let type = requestType === ApplicationType.Application ? "apply" : "attend";
			emailMarkdown = await getSetting<string>(`${questionBranch.name}-${type}-email`, false);
		}
		catch (err) {
			// Content not set yet
			emailMarkdown = "";
		}

		let emailHTML = await renderEmailHTML(emailMarkdown, user);
		let emailText = await renderEmailText(emailHTML, user, true);

		if (requestType === ApplicationType.Application) {
			if (!user.applied) {
				await sendMailAsync({
					from: config.email.from,
					to: user.email,
					subject: `[${config.eventName}] - Thank you for appying!`,
					html: emailHTML,
					text: emailText
				});
			}
			user.applied = true;
			user.applicationBranch = questionBranch.name;
			user.applicationData = data;
			user.markModified("applicationData");
			user.applicationSubmitTime = new Date();
			trackEvent("submitted application", request.ip, user.email);
		}
		else if (requestType === ApplicationType.Confirmation) {
			if (!user.attending) {
				await sendMailAsync({
					from: config.email.from,
					to: user.email,
					subject: `[${config.eventName}] - Thank you for RSVPing!`,
					html: emailHTML,
					text: emailText
				});
			}
			user.attending = true;
			user.confirmationBranch = questionBranch.name;
			user.confirmationData = data;
			user.markModified("confirmationData");
			user.confirmationSubmitTime = new Date();
		}

		await user.save();
		response.status(200).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while saving your application"
		});
	}
}

async function deleteApplicationBranchHandler(request: express.Request, response: express.Response) {
	let requestType: ApplicationType = request.url.match(/\/application\//) ? ApplicationType.Application : ApplicationType.Confirmation;

	let user = await User.findById(request.params.id) as IUserMongoose;
	if (requestType === ApplicationType.Application) {
		user.applied = false;
		user.applicationBranch = "";
		user.applicationData = [];
		user.markModified("applicationData");
		user.applicationSubmitTime = undefined;
		user.applicationStartTime = undefined;
	}
	else if (requestType === ApplicationType.Confirmation) {
		user.attending = false;
		user.confirmationBranch = "";
		user.confirmationData = [];
		user.markModified("confirmationData");
		user.confirmationSubmitTime = undefined;
		user.confirmationStartTime = undefined;
	}

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
}

userRoutes.route("/status").post(isAdmin, uploadHandler.any(), async (request, response): Promise<void> => {
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

userRoutes.route("/send_acceptances").post(isAdmin, async (request, response): Promise<void> => {
	try {
		let users = await User.find({ "accepted": true, "acceptedEmailSent": { $ne: true } });
		for (let user of users) {
			// Email the applicant about their acceptance
			let emailMarkdown: string;
			try {
				emailMarkdown = await getSetting<string>(`${user.applicationBranch}-accept-email`, false);
			}
			catch (err) {
				// Content not set yet
				emailMarkdown = "";
			}

			let emailHTML = await renderEmailHTML(emailMarkdown, user);
			let emailText = await renderEmailText(emailHTML, user, true);

			await sendMailAsync({
				from: config.email.from,
				to: user.email,
				subject: `[${config.eventName}] - You've been accepted!`,
				html: emailHTML,
				text: emailText
			});

			user.acceptedEmailSent = true;
			await user.save();
		}

		response.json({
			"success": true,
			"count": users.length
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while sending out acceptance emails"
		});
	}
});

userRoutes.route("/export").get(isAdmin, async (request, response): Promise<void> => {
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
			if (attendingUsers.length === 0) {
				continue;
			}

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

async function removeUserFromAllTeams(user: IUserMongoose): Promise<boolean> {
	if (!user.teamId) {
		return true;
	}

	let currentUserTeam = await Team.findById(user.teamId) as ITeamMongoose;
	if (!currentUserTeam) {
		return false;
	}

	if (currentUserTeam.teamLeader.toString() === user._id.toString()) {
		// If we're team leader, remove everybody from group
		await Team.findByIdAndRemove(currentUserTeam._id);
		await User.update({
			teamId: user.teamId
		}, {
			$unset: {
				teamId: 1
			}
		}, {
			multi: true
		});
		return true;
	}
	else {
		await Team.update({
			_id: user.teamId
		}, {
			$pull: {
				members: user._id
			}
		});
		// Remove us from the current team we're in
		await User.update({
			_id: user._id
		}, {
			$unset: {
				teamId: 1
			}
		});
		return true;
	}
}

userRoutes.route("/team/create/:teamName").post(isUserOrAdmin, async (request, response): Promise<void> => {
	/*
		First, check if there is already a team that has this user as captain
		If so, just re-assign the user's teamid to that one
		Else if the user's in a team, take them out of it
		Else make them a new team
	 */
	let user = await User.findById(request.params.id) as IUserMongoose;
	let decodedTeamName = decodeURI(request.params.teamName);

	let existingTeam = await Team.findOne({ teamName: decodedTeamName }) as ITeamMongoose;

	if (existingTeam) {

		// Someone else has a team with this name
		response.status(400).json({
			"error": `Someone else has a team called ${decodedTeamName}. Please pick a different name.`
		});
		return;
	}

	// If the user is in a team, remove them from their current team unless they're the team leader
	if (user.teamId) {
		let currentUserTeam = await Team.findById(user.teamId) as ITeamMongoose;

		if (currentUserTeam.teamLeader === user._id) {
			// The user is in the team they made already
			// Ideally this will never happen if we do some validation client side
			response.status(400).json({
				"error": "You're already the leader of this team"
			});
			return;
		}

		await removeUserFromAllTeams(user);
	}

	let query = {
		teamLeader: request.user._id,
		members: {
			$in: [user._id]
		},
		teamName: decodedTeamName
	};

	let options = {
		upsert: true,
		new: true,
		setDefaultsOnInsert: true
	};

	let team = await Team.findOneAndUpdate(query, {}, options) as ITeamMongoose;

	user.teamId = team._id;
	await user.save();

	response.json({
		"success": true
	});
});

userRoutes.route("/team/join/:teamName").post(isUserOrAdmin, async (request, response): Promise<void> => {
	let user = await User.findById(request.params.id) as IUserMongoose;
	let decodedTeamName = decodeURI(request.params.teamName);

	if (user.teamId) {
		// Remove them from any teams they're in
		await removeUserFromAllTeams(user);
	}

	if (!decodedTeamName) {
		// No team to join smh
		response.status(400).json({
			"error": "Please enter the team name you want to join"
		});
		return;
	}

	let teamToJoin = await Team.findOne({ teamName: decodedTeamName }) as ITeamMongoose;

	if (!teamToJoin) {
		// If the team they tried to join isn't real...
		response.status(400).json({
			"error": "No such team!"
		});
		return;
	}

	// Compare teamToJoin.members.length plus 2; 1 for the team leader, and 1 for the prospective user
	// If the maxTeamSize is set as a value that requires teams of 0 size, no team max size
	if (teamToJoin.members.length + 2 > config.maxTeamSize && config.maxTeamSize > 0) {
		response.status(400).json({
			"error": "This team is full!"
		});
		return;
	}

	await Team.update({
		teamName: decodedTeamName
	}, {
		$addToSet: {
			members: user._id
		}
	});

	user.teamId = teamToJoin._id;

	await user.save();

	response.json({
		"success": true
	});
});

userRoutes.route("/team/leave").post(isUserOrAdmin, async (request, response): Promise<void> => {
	let user = await User.findById(request.params.id) as IUserMongoose;
	await removeUserFromAllTeams(user);

	response.status(200).json({
		"success": true
	});
});

userRoutes.route("/team/rename/:newTeamName").post(isUserOrAdmin, async (request, response): Promise<void> => {
	let user = await User.findById(request.params.id) as IUserMongoose;

	if (!user.teamId) {
		response.status(400).json({
			"error": "You're not in a team"
		});
		return;
	}

	let currentUserTeam = await Team.findById(user.teamId) as ITeamMongoose;

	if (!currentUserTeam) {
		// User tried to change their team name even though they don't have a team
		response.status(400).json({
			"error": "You don't belong to a team!"
		});
		return;
	}

	if (currentUserTeam.teamLeader.toString() !== user._id.toString()) {
		// The user isn't the team captain
		response.status(400).json({
			"error": "You're not the leader of this team!"
		});
		return;
	}

	let decodedTeamName = decodeURI(request.params.newTeamName);
	if (await Team.findOne({teamName: decodedTeamName})) {
		// If there is a team with that name already
		response.status(400).json({
			"error": "Team with that name already exists!"
		});
		return;
	}

	await Team.findOneAndUpdate({_id: user.teamId}, {
		$set: {
			teamName: decodedTeamName
		}
	});

	response.json({
		"success": true
	});
});
