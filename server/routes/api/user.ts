import * as path from "path";
import * as express from "express";
import * as json2csv from "json2csv";
import * as archiver from "archiver";
import * as uuid from "uuid/v4";

import {
	STORAGE_ENGINE,
	formatSize,
	config, getSetting, defaultEmailSubjects, agenda
} from "../../common";
import {
	MAX_FILE_SIZE, postParser, uploadHandler,
	isAdmin, isUserOrAdmin, ApplicationType,
	trackEvent, canUserModify
} from "../../middleware";
import {
	Model, createNew,
	IFormItem,
	IUser, User,
	Team
} from "../../schema";
import * as Branches from "../../branch";
import { GroundTruthStrategy } from "../strategies";

export let userRoutes = express.Router({ "mergeParams": true });
export let registrationRoutes = express.Router({ "mergeParams": true });

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

// We don't use canUserModify here, instead check for admin
registrationRoutes.route("/:branch")
	.post(
		isAdmin,
		postParser,
		uploadHandler.any(),
		postApplicationBranchErrorHandler,
		postApplicationBranchHandler(true)
	);

userRoutes.route("/application/:branch")
	.post(
		isUserOrAdmin,
		canUserModify,
		postParser,
		uploadHandler.any(),
		postApplicationBranchErrorHandler,
		postApplicationBranchHandler(false)
	)
	.delete(
		isUserOrAdmin,
		canUserModify,
		deleteApplicationBranchHandler
	);

userRoutes.route("/confirmation/:branch")
	.post(
		isUserOrAdmin,
		canUserModify,
		postParser,
		uploadHandler.any(),
		postApplicationBranchErrorHandler,
		postApplicationBranchHandler(false)
	)
	.delete(
		isUserOrAdmin,
		canUserModify,
		deleteApplicationBranchHandler
	);

function postApplicationBranchHandler(anonymous: boolean): (request: express.Request, response: express.Response) => Promise<void> {
	return async (request, response) => {
		let user: Model<IUser>;
		if (anonymous) {
			let email = request.body["anonymous-registration-email"] as string;
			let name = request.body["anonymous-registration-name"] as string;
			if (await User.findOne({ email })) {
				response.status(400).json({
					"error": `User with email "${email}" already exists`
				});
				return;
			}
			user = createNew<IUser>(User, {
				...GroundTruthStrategy.defaultUserProperties,
				uuid: uuid(),
				name,
				email,
				token: null
			});
		} else {
			let existingUser = await User.findOne({ uuid: request.params.uuid });
			if (!existingUser) {
				response.status(400).json({
					"error": "Invalid user id"
				});
				return;
			}
			user = existingUser;
		}

		let branchName = await Branches.BranchConfig.getCanonicalName(request.params.branch);
		let questionBranch = branchName ? await Branches.BranchConfig.loadBranchFromDB(branchName) : null;
		if (!questionBranch) {
			response.status(400).json({
				"error": "Invalid branch"
			});
			return;
		}

		let unchangedFiles: string[] = [];
		let errored: boolean = false; // Used because .map() can't be broken out of
		let rawData: (IFormItem | null)[] = questionBranch.questions.map(question => {
			function reportError(message: string): null {
				errored = true;
				response.status(400).json({
					"error": message
				});
				return null;
			}
			function getQuestion<T>(defaultValue?: T): T {
				let value = request.body[question.name] as T;
				if (defaultValue !== undefined) {
					return value || defaultValue;
				}
				return value;
			}

			if (errored) {
				return null;
			}
			let files = request.files as Express.Multer.File[];
			let preexistingFile: boolean =
				question.type === "file"
				&& user.applicationData != undefined
				&& user.applicationData.some(entry => entry.name === question.name && !!entry.value);

			if (question.required && !getQuestion<unknown>() && !files.find(file => file.fieldname === question.name)) {
				// Required field not filled in
				if (preexistingFile) {
					let previousValue = user.applicationData!.find(entry => entry.name === question.name && !!entry.value)!.value as Express.Multer.File;
					unchangedFiles.push(previousValue.filename);
					return {
						"name": question.name,
						"type": "file",
						"value": previousValue
					};
				}
				else {
					return reportError(`"${question.label}" is a required field`);
				}
			}
			if (question.type !== "file" && (question.minCharacterCount || question.maxCharacterCount || question.minWordCount || question.maxWordCount)) {
				let questionValue = getQuestion<string>("");
				if (question.minCharacterCount && questionValue.length < question.minCharacterCount) {
					return reportError(`Your response to "${question.label}" must have at least ${question.minCharacterCount} characters`);
				}
				if (question.maxCharacterCount && questionValue.length > question.maxCharacterCount) {
					return reportError(`Your response to "${question.label}" cannot exceed ${question.maxCharacterCount} characters`);
				}
				let wordCount = questionValue.trim().split(/\s+/).length;
				if (questionValue.trim().length === 0) {
					wordCount = 0;
				}
				const wordCountPlural = wordCount === 1 ? "" : "s";
				if (question.minWordCount && wordCount < question.minWordCount) {
					return reportError(`Your response to "${question.label}" must contain at least ${question.minWordCount} words (currently has ${wordCount} word${wordCountPlural})`);
				}
				if (question.maxWordCount && wordCount > question.maxWordCount) {
					return reportError(`Your response to "${question.label}" cannot exceed ${question.maxWordCount} words (currently has ${wordCount} word${wordCountPlural})`);
				}
			}

			if ((question.type === "select" || question.type === "radio") && Array.isArray(getQuestion<unknown>(question.name)) && question.hasOther) {
				// "Other" option selected
				request.body[question.name] = getQuestion<unknown[]>().pop();
			}
			else if (question.type === "checkbox" && question.hasOther) {
				if (!getQuestion<unknown>(question.name)) {
					request.body[question.name] = [];
				}
				if (!Array.isArray(getQuestion<unknown>(question.name))) {
					request.body[question.name] = [getQuestion<unknown>()];
				}
				// Filter out "other" option
				request.body[question.name] = getQuestion<string[]>().filter(value => value !== "Other");
			}
			return {
				"name": question.name,
				"type": question.type,
				"value": getQuestion<any>(files.find(file => file.fieldname === question.name))
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
			let type = questionBranch instanceof Branches.ApplicationBranch ? "apply" : "attend";
			let emailSubject: string | null;
			try {
				emailSubject = await getSetting<string>(`${questionBranch.name}-${type}-email-subject`, false);
			}
			catch {
				emailSubject = null;
			}
			let emailMarkdown: string;
			try {
				emailMarkdown = await getSetting<string>(`${questionBranch.name}-${type}-email`, false);
			}
			catch {
				// Content not set yet
				emailMarkdown = "";
			}

			if (questionBranch instanceof Branches.ApplicationBranch) {
				if (!user.applied && questionBranch.name !== "Sponsor") {
					await agenda.now("send_templated_email", {
						id: user.uuid,
						subject: emailSubject || defaultEmailSubjects.apply,
						markdown: emailMarkdown
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

				if (questionBranch.name === "Sponsor") {
					const userEmailRegex = user.email.match(/@([\w.]+)/);
					const userEmailDomain = userEmailRegex ? userEmailRegex[1].toLowerCase() : null;
					if ((userEmailDomain && config.hackgt7.sponsorDomainWhitelist.map(x => x.toLowerCase()).includes(userEmailDomain))
						|| config.hackgt7.sponsorEmailWhitelist.map(x => x.toLowerCase()).includes(user.email.toLowerCase())) {
						await updateUserStatus(user, "Sponsor Confirmation");
						//await sendPreConfirmNotification(user);
					} else {
						await updateUserStatus(user, "Denied Admission / Sponsor");
						//await sendPreConfirmNotification(user);
					}
				} else if (questionBranch.autoAccept && questionBranch.autoAccept !== "disabled") {
					await updateUserStatus(user, questionBranch.autoAccept);
				}

			} else if (questionBranch instanceof Branches.ConfirmationBranch) {
				if (!user.confirmed) {
					await agenda.now("send_templated_email", {
						id: user.uuid,
						subject: emailSubject || defaultEmailSubjects.attend,
						markdown: emailMarkdown
					});
				}
				user.confirmed = true;
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
				"uuid": user.uuid,
				"success": true
			});
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while saving your application"
			});
		}
	};
}
async function deleteApplicationBranchHandler(request: express.Request, response: express.Response) {
	let requestType: ApplicationType = request.url.match(/\/application\//) ? ApplicationType.Application : ApplicationType.Confirmation;

	let user = await User.findOne({ uuid: request.params.uuid });
	if (!user) {
		response.status(400).json({
			"error": "Invalid user id"
		});
		return;
	}
	if (requestType === ApplicationType.Application) {
		user.applied = false;
		user.accepted = false;
		user.confirmed = false;
		user.applicationBranch = "";
		user.applicationData = [];
		user.markModified("applicationData");
		user.applicationSubmitTime = undefined;
		user.applicationStartTime = undefined;
	}
	else if (requestType === ApplicationType.Confirmation) {
		user.confirmed = false;
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
	let status = request.body.status as string;

	if (!user) {
		response.status(400).json({
			"error": `No such user with id ${request.params.uuid}`
		});
		return;
	}

	try {
		await updateUserStatus(user, status);
		await user.save();
		response.status(200).json({
			"success": true
		});
	}
	catch (err) {
		console.error(err);
		response.status(500).json({
			// This endpoint is admin-only so directly communicating error messages is fine
			"error": `Error occurred while changing user status: ${err.message}`
		});
	}
});

async function updateUserStatus(user: Model<IUser>, status: string): Promise<void> {
	if (status === user.confirmationBranch) {
		throw new Error(`User status is already ${status}!`);
	} else if (status === "no-decision") {
		// Clear all confirmation data
		user.confirmationBranch = undefined;
		user.confirmationData = [];
		user.confirmationDeadline = undefined;
		user.confirmationStartTime = undefined;
		user.confirmationSubmitTime = undefined;
		user.confirmed = false;
		user.accepted = false;
		user.preConfirmEmailSent = false;
	} else {
		let confirmationBranch = await Branches.BranchConfig.loadBranchFromDB(status) as Branches.ConfirmationBranch;

		if (confirmationBranch) {
			// Clear all confirmation data
			user.confirmationData = [];
			user.confirmationDeadline = undefined;
			user.confirmationStartTime = undefined;
			user.confirmationSubmitTime = undefined;
			user.confirmed = false;
			user.accepted = false;
			user.preConfirmEmailSent = false;

			// Update branch
			user.confirmationBranch = status;

			// Handle rolling deadline
			if (confirmationBranch.usesRollingDeadline) {
				user.confirmationDeadline = {
					name: confirmationBranch.name,
					open: confirmationBranch.open,
					close: confirmationBranch.close
				};
			}

			// Handle accptance
			if (confirmationBranch.isAcceptance) {
				user.accepted = true;
			}

			// Handle no-op confirmation
			if (confirmationBranch.autoConfirm) {
				user.confirmed = true;
			}
		} else {
			throw new Error("Confirmation branch not valid!");
		}
	}
}

async function sendPreConfirmNotification(user: any) {
	// Email the applicant about their acceptance
	let emailSubject: string | null;
	try {
		emailSubject = await getSetting<string>(`${user.confirmationBranch}-pre-confirm-email-subject`, false);
	} catch {
		emailSubject = null;
	}
	let emailMarkdown: string;
	try {
		emailMarkdown = await getSetting<string>(`${user.confirmationBranch}-pre-confirm-email`, false);
	} catch {
		// Content not set yet
		emailMarkdown = "";
	}

	user.preConfirmEmailSent = true;
	await agenda.now("send_templated_email", {
		id: user.uuid,
		subject: emailSubject || defaultEmailSubjects.preConfirm,
		markdown: emailMarkdown
	});
	await user.save();
}

userRoutes.route("/send_acceptances").post(isAdmin, async (request, response): Promise<void> => {
	try {
		let users = await User.find({ "confirmationBranch": {$exists: true}, "preConfirmEmailSent": { $ne: true } });
		for (let user of users) {
			await sendPreConfirmNotification(user);
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
		let archive = archiver("zip", {
			store: true
		});
		response.status(200).type("application/zip");
		archive.pipe(response);

		for (let branchName of await Branches.BranchConfig.getNames()) {
			// TODO: THIS IS A PRELIMINARY VERSION FOR HACKGT CATALYST
			// TODO: Change this to { "accepted": true }
			let attendingUsers = await User.find({ "applied": true, "applicationBranch": branchName });
			if (attendingUsers.length === 0) {
				continue;
			}

			let csvData = attendingUsers.map(user => {
				// TODO: Replace with more robust schema-agnostic version
				let nameFormItem = (user.applicationData || []).find(item => item.name === "name");
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

async function removeUserFromAllTeams(user: IUser): Promise<boolean> {
	if (!user.teamId) {
		return true;
	}

	let currentUserTeam = await Team.findById(user.teamId);
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
	let user = await User.findOne({ uuid: request.params.uuid });
	if (!user) {
		response.status(400).json({
			"error": "Invalid user id"
		});
		return;
	}
	let decodedTeamName = decodeURI(request.params.teamName);

	let existingTeam = await Team.findOne({ teamName: decodedTeamName });

	if (existingTeam) {
		// Someone else has a team with this name
		response.status(400).json({
			"error": `Someone else has a team called ${decodedTeamName}. Please pick a different name.`
		});
		return;
	}

	// If the user is in a team, remove them from their current team unless they're the team leader
	if (user.teamId) {
		let currentUserTeam = await Team.findById(user.teamId);

		if (currentUserTeam) {
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
	}

	let query = {
		teamLeader: request.user && request.user._id,
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

	let team = await Team.findOneAndUpdate(query, {}, options);

	if (team) {
		user.teamId = team._id;
	}
	await user.save();

	response.json({
		"success": true
	});
});

userRoutes.route("/team/join/:teamName").post(isUserOrAdmin, async (request, response): Promise<void> => {
	let user = await User.findOne({ uuid: request.params.uuid });
	if (!user) {
		response.status(400).json({
			"error": "Invalid user id"
		});
		return;
	}

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

	let teamToJoin = await Team.findOne({ teamName: decodedTeamName });

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
	let user = await User.findOne({ uuid: request.params.uuid });
	if (!user) {
		response.status(400).json({
			"error": "Invalid user id"
		});
		return;
	}
	await removeUserFromAllTeams(user);

	response.status(200).json({
		"success": true
	});
});

userRoutes.route("/team/rename/:newTeamName").post(isUserOrAdmin, async (request, response): Promise<void> => {
	let user = await User.findOne({ uuid: request.params.uuid });
	if (!user) {
		response.status(400).json({
			"error": "Invalid user id"
		});
		return;
	}
	if (!user.teamId) {
		response.status(400).json({
			"error": "You're not in a team"
		});
		return;
	}

	let currentUserTeam = await Team.findById(user.teamId);
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

userRoutes.get("/", async (request, response) => {
	if (request.user) {
		let user = await User.findOne({ uuid: request.user.uuid });
		if (!user) {
			response.status(400).json({
				"error": "Invalid user id"
			});
			return;
		}

		response.json({
			uuid: user.uuid,
			name: user.name,
			email: user.email,
			admin: user.admin || false
		});
	}
	else {
		response.json({
			"error": "Not logged in"
		});
	}
});
