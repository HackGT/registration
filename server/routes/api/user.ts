import * as path from "path";
import * as express from "express";
import * as json2csv from "json2csv";
import * as archiver from "archiver";
import * as moment from "moment-timezone";

import {
	STORAGE_ENGINE,
	formatSize,
	config, getSetting, renderEmailHTML, renderEmailText, sendMailAsync
} from "../../common";
import {
	MAX_FILE_SIZE, postParser, uploadHandler,
	isAdmin, isUserOrAdmin, ApplicationType,
	trackEvent
} from "../../middleware";
import {
	IFormItem,
	IUserMongoose, User,
	ITeamMongoose, Team
} from "../../schema";
import * as Branches from "../../branch";

export let userRoutes = express.Router({ "mergeParams": true });

let postApplicationBranchErrorHandler: express.ErrorRequestHandler = (err, request, response, next) => {
	if (err.code === "LIMIT_FILE_SIZE") {
		response.status(400).json({
			"error": `File size cannot exceed ${formatSize(MAX_FILE_SIZE, false)}`
		});
	}
	else {
		next(err);
	}
};

let applicationTimeRestriction: express.RequestHandler = async (request, response, next) => {
	let requestType: ApplicationType = request.url.match(/\/application\//) ? ApplicationType.Application : ApplicationType.Confirmation;
	let branchName = request.params.branch as string;
	let branch = (await Branches.BranchConfig.loadAllBranches()).find(b => b.name.toLowerCase() === branchName.toLowerCase()) as (Branches.ApplicationBranch | Branches.ConfirmationBranch);
	if (!branch) {
		response.status(400).json({
			"error": "Invalid application branch"
		});
		return;
	}

	let user = request.user as IUserMongoose;

	let openDate = branch.open;
	let closeDate = branch.close;
	if (requestType === ApplicationType.Confirmation && user.confirmationDeadlines) {
		let times = user.confirmationDeadlines.find((d) => d.name === branch.name);
		if (times) {
			openDate = times.open;
			closeDate = times.close;
		}
	}

	if (moment().isBetween(openDate, closeDate) || request.user.isAdmin) {
		next();
	}
	else {
		response.status(408).json({
			"error": `${requestType === ApplicationType.Application ? "Applications" : "Confirmations"} are currently closed`
		});
		return;
	}
};

userRoutes.route("/application/:branch")
	.post(isUserOrAdmin, applicationTimeRestriction, postParser, uploadHandler.any(), postApplicationBranchErrorHandler, postApplicationBranchHandler)
	.delete(isUserOrAdmin, applicationTimeRestriction, deleteApplicationBranchHandler);
userRoutes.route("/confirmation/:branch")
	.post(isUserOrAdmin, applicationTimeRestriction, postParser, uploadHandler.any(), postApplicationBranchErrorHandler, postApplicationBranchHandler)
	.delete(isUserOrAdmin, applicationTimeRestriction, deleteApplicationBranchHandler);

async function postApplicationBranchHandler(request: express.Request, response: express.Response): Promise<void> {
	let requestType: ApplicationType = request.url.match(/\/application\//) ? ApplicationType.Application : ApplicationType.Confirmation;

	let user = await User.findOne({uuid: request.params.uuid}) as IUserMongoose;
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

	// TODO embed branchname in the form so we don't have to do this
	let questionBranch = (await Branches.BranchConfig.loadAllBranches()).find(branch => branch.name.toLowerCase() === branchName.toLowerCase());
	if (!questionBranch) {
		response.status(400).json({
			"error": "Invalid application branch"
		});
		return;
	}

	let unchangedFiles: string[] = [];
	let errored: boolean = false; // Used because .map() can't be broken out of
	let rawData: (IFormItem | null)[] = questionBranch.questions.map(question => {
		if (errored) {
			return null;
		}
		let files = request.files as Express.Multer.File[];
		let preexistingFile: boolean = question.type === "file" && user.applicationData && user.applicationData.some(entry => entry.name === question.name && !!entry.value);

		if (question.required && !request.body[question.name] && !files.find(file => file.fieldname === question.name)) {
			// Required field not filled in
			if (preexistingFile) {
				let previousValue = user.applicationData.find(entry => entry.name === question.name && !!entry.value)!.value as Express.Multer.File;
				unchangedFiles.push(previousValue.filename);
				return {
					"name": question.name,
					"type": "file",
					"value": previousValue
				};
			}
			else {
				errored = true;
				response.status(400).json({
					"error": `'${question.label}' is a required field`
				});
				return null;
			}
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
				if (unchangedFiles.indexOf(file.filename) === -1) {
					return STORAGE_ENGINE.saveFile(file.path, file.filename);
				}
				else {
					return Promise.resolve();
				}
			})
		);
		// Set the proper file locations in the data object
		data = data.map(item => {
			if (item.value !== null && typeof item.value === "object" && !Array.isArray(item.value)) {
				item.value.destination = STORAGE_ENGINE.uploadRoot;
				item.value.path = path.join(STORAGE_ENGINE.uploadRoot, item.value.filename);
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
					subject: `[${config.eventName}] - Thank you for applying!`,
					html: emailHTML,
					text: emailText
				});
			}
			user.applied = true;
			user.applicationBranch = questionBranch.name;
			user.applicationData = data;
			user.markModified("applicationData");
			user.applicationSubmitTime = new Date();

			// Generate tags for metrics support
			let tags: {[index: string]: string} = {
				branch: questionBranch.name
			};
			for (let ele of data) {
				if (ele && ele.name && ele.value) {
					tags[ele.name.toString()] = ele.value.toString();
				}
			}
			trackEvent("submitted application", request, user.email, tags);
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

			let tags: {[index: string]: string} = {
				branch: questionBranch.name
			};
			for (let ele of data) {
				if (ele && ele.name && ele.value) {
					tags[ele.name.toString()] = ele.value.toString();
				}
			}
			trackEvent("submitted confirmation", request, user.email, tags);
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

	let user = await User.findOne({uuid: request.params.uuid}) as IUserMongoose;
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
	let user = await User.findOne({uuid: request.params.uuid});
	let status = request.body.status as ("accepted" | "no-decision");

	if (!user) {
		response.status(400).json({
			"error": `No such user with id ${request.params.uuid}`
		});
		return;
	}

	await updateUserStatus(user, status);

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

async function updateUserStatus(user: IUserMongoose, status: ("accepted" | "no-decision")): Promise<void> {
	if (status === "no-decision") {
		user.accepted = false;
		user.confirmationDeadlines = [];
	} else if (status === "accepted") {
		user.accepted = true;
		let applicationBranch = (await Branches.BranchConfig.loadBranchFromDB(user.applicationBranch)) as Branches.ApplicationBranch;
		user.confirmationDeadlines = ((await Branches.BranchConfig.loadAllBranches("Confirmation")) as Branches.ConfirmationBranch[])
				.filter(c => c.usesRollingDeadline)
				.filter(c => applicationBranch.confirmationBranches.indexOf(c.name) > -1);
	}
}

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

userRoutes.route("/batch_accept").post(isAdmin, postParser, uploadHandler.any(), async (request, response): Promise<void> => {
	try {
		let userIds = request.body.userIds.split(',');
		let acceptedCount = 0;
		let notAccepted = [];
		for (let userId of userIds) {
			let user;
			try {
				user = await User.findById(userId);
			} catch {
				notAccepted.push(userId);
			}
			if (user && user.applied && !user.accepted) {
				try {
					await updateUserStatus(user, "accepted"); // Assume that this succeeds
					await user.save();
					acceptedCount += 1;
				} catch {
					notAccepted.push(userId);
				}
			} else {
				notAccepted.push(userId);
			}
		}
		response.json({
			"success": true,
			"count": acceptedCount,
			"notAccepted": notAccepted
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			"error": "An error occurred while batch accepting applicants"
		});
	}
});

userRoutes.route("/export").get(isAdmin, async (request, response): Promise<void> => {
	try {
		let archive = archiver("zip", {
			store: true
		});
		response.status(200).type("application/zip");
		archive.pipe(response);

		for (let branchName of await Branches.BranchConfig.getNames()) {
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
	let user = await User.findOne({uuid: request.params.uuid}) as IUserMongoose;
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
	let user = await User.findOne({uuid: request.params.uuid}) as IUserMongoose;
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
	let user = await User.findOne({uuid: request.params.uuid}) as IUserMongoose;
	await removeUserFromAllTeams(user);

	response.status(200).json({
		"success": true
	});
});

userRoutes.route("/team/rename/:newTeamName").post(isUserOrAdmin, async (request, response): Promise<void> => {
	let user = await User.findOne({uuid: request.params.uuid}) as IUserMongoose;

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
