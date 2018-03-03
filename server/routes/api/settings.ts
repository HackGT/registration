import * as express from "express";

import {
	getSetting, updateSetting, setDefaultSettings, renderEmailHTML, renderEmailText, sendMailAsync, config
} from "../../common";
import {
	isAdmin, uploadHandler
} from "../../middleware";
import * as Branches from "../../branch";
import {User} from "../../schema";

setDefaultSettings().catch(err => {
	throw err;
});

export let settingsRoutes = express.Router();

settingsRoutes.route("/teams_enabled")
	.get(async (request, response) => {
		let enabled = await getSetting<boolean>("teamsEnabled");
		response.json({
			"enabled": enabled
		});
	})
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		let rawEnabled = request.body.enabled;
		if (!rawEnabled || (rawEnabled !== "true" && rawEnabled !== "false")) {
			response.status(400).json({
				"error": "Invalid value for enabling or disabling teams"
			});
			return;
		}

		try {
			await updateSetting<boolean>("teamsEnabled", rawEnabled === "true");
			response.json({
				"success": true
			});
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while enabling or disabling teams"
			});
		}
	});

settingsRoutes.route("/qr_enabled")
	.get(async (request, response) => {
		let enabled = await getSetting<boolean>("qrEnabled");
		response.json({
			"enabled": enabled
		});
	})
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		let rawEnabled = request.body.enabled;
		if (!rawEnabled || (rawEnabled !== "true" && rawEnabled !== "false")) {
			response.status(400).json({
				"error": "Invalid value for enabling or disabling teams"
			});
			return;
		}

		try {
			await updateSetting<boolean>("qrEnabled", rawEnabled === "true");
			response.json({
				"success": true
			});
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while enabling or disabling qr codes"
			});
		}
	});

settingsRoutes.route("/admin_emails")
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		let rawAdminString = request.body.adminString;
		let addAdmins = request.body.addAdmins === "true";

		if (!rawAdminString) {
			return response.json({
				"success": true,
				"info": "Admins unchanged"
			});
		}

		let adminEmailArray = rawAdminString.split(/, */).map((element: string) => {
			return element.trim();
		});

		if (adminEmailArray.length === 0) {
			return response.status(400).json({
				"error": "Invalid value for enabling or disabling teams"
			});
		}

		await User.update({
			email: adminEmailArray[0]
		}, {
			$set: {
				admin: addAdmins
			}
		}, {
			multi: true
		});

		return response.json({
			"success": true
		});
	});

settingsRoutes.route("/branch_roles")
	.get(isAdmin, async (request, response) => {
		response.json({
			"noop": (await Branches.BranchConfig.loadAllBranches("Noop")).map(branch => branch.name),
			"applicationBranches": (await Branches.BranchConfig.loadAllBranches("Application")).map(branch => branch.name),
			"confirmationBranches": (await Branches.BranchConfig.loadAllBranches("Confirmation")).map(branch => branch.name)
		});
	})
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		if ((new Set(Object.keys(request.body))).size !== Object.keys(request.body).length) {
			response.status(400).json({
				"error": "Each branch can only be used once"
			});
			return;
		}

		try {
			// TODO use promises/async
			for (let branchName of Object.keys(request.body)) {
				let branchData = JSON.parse(request.body[branchName]);

				let branch = await Branches.BranchConfig.loadBranchFromDB(branchName); // TODO type checker determines this to be always a NoopBranch - ensure that branch.type will be the real type everytime
				// Convert the branch type (if not match)
				if (branch.type !== branchData.role) {
						switch (branchData.role) {
						case "Application":
							branch = await branch.convertTo<Branches.ApplicationBranch>("Application") as Branches.ApplicationBranch;
							break;
						case "Confirmation":
							branch = await branch.convertTo<Branches.ConfirmationBranch>("Confirmation") as Branches.ConfirmationBranch;
							break;
						default:
							branch = await branch.convertTo<Branches.NoopBranch>("Noop") as Branches.NoopBranch;
							break;
						}
				}

				// Set open/close times (if not noop)
				if (branch instanceof Branches.ApplicationBranch || branch instanceof Branches.ConfirmationBranch) {
					branch.open = branchData.open ? new Date(branchData.open) : new Date();
					branch.close = branchData.close ? new Date(branchData.close) : new Date();
				}
				// Set available confirmation branches (if application branch)
				if (branch instanceof Branches.ApplicationBranch) {
					branch.confirmationBranches = branchData.confirmationBranches || [];
				}
				// Set rolling deadline flag (if confirmation branch)
				if (branch instanceof Branches.ConfirmationBranch) {
					branch.usesRollingDeadline = branchData.usesRollingDeadline || false;
				}

				await branch.save();
			}
			response.json({
				"success": true
			});
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while setting branch roles"
			});
		}
	});

settingsRoutes.route("/email_content/:type")
	.get(isAdmin, async (request, response) => {
		let content: string;
		try {
			content = await getSetting<string>(`${request.params.type}-email`, false);
		}
		catch (err) {
			// Content not set yet
			content = "";
		}

		response.json({ content });
	})
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		let content = request.body.content as string;
		try {
			await updateSetting<string>(`${request.params.type}-email`, content);
			response.json({
				"success": true
			});
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while setting email content"
			});
		}
	});

settingsRoutes.route("/email_content/:type/rendered")
	.post(isAdmin, uploadHandler.any(), async (request, response) => {
		try {
			let markdown: string = request.body.content;
			let html: string = await renderEmailHTML(markdown, request.user, false);
			let text: string = await renderEmailText(html, request.user, true, false);

			response.json({ html, text });
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while rendering the email content"
			});
		}
	});

settingsRoutes.route("/email_content/rendered")
	.post(isAdmin, uploadHandler.any(), async (request, response) => {
		// Endpoint for generalized email, without templating for user args; meant for batch sending email
		try {
			let markdown: string = request.body.content;
			let html: string = await renderEmailHTML(markdown, request.user, true);
			let text: string = await renderEmailText(html, request.user, true, true);

			response.json({ html, text });
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while rendering the email content"
			});
		}
	});

settingsRoutes.route("/send_batch_email")
	.post(isAdmin, uploadHandler.any(), async (request, response) => {

		let filter = JSON.parse(request.body.filter);
		let subject = request.body.subject;
		let markdownContent = request.body.markdownContent;

		if (typeof filter !== "object") {
			return response.status(400).json({
				"error": `Your query '${filter}' is not a valid MongoDB query`
			});
		} else if (subject === "" || subject === undefined) {
			return response.status(400).json({
				"error": "Can't have an empty subject!"
			});
		} else if (markdownContent === "" || markdownContent === undefined) {
			return response.status(400).json({
				"error": "Can't have an empty email body!"
			});
		}

		let html: string = await renderEmailHTML(markdownContent, request.user, true);
		let text: string = await renderEmailText(html, request.user, true, true);

		let users = await User.find(filter);

		let userEmails: string = "";
		for (let user of users) {
			userEmails += user.email + ",";
		}

		if (userEmails.length > 0) {
			await sendMailAsync({
				from: config.email.from,
				to: userEmails,
				subject,
				html,
				text
			});

			console.log(`Batch email sent by ${request.user.email}`);
		}

		return response.json({
			"success": true
		});
	});
