import * as express from "express";
import * as moment from "moment";

import {
	uploadHandler, isAdmin, validateSchema, getSetting, updateSetting, setDefaultSettings, renderEmailHTML, renderEmailText,
	config
} from "../../common";
import { ApplicationToConfirmationMap } from "../../schema";

setDefaultSettings().catch(err => {
	throw err;
});

export let settingsRoutes = express.Router();

settingsRoutes.route("/application_availability")
	.get(async (request, response) => {
		let applicationOpen = await getSetting<Date>("applicationOpen");
		let applicationClose = await getSetting<Date>("applicationClose");
		let confirmationOpen = await getSetting<Date>("confirmationOpen");
		let confirmationClose = await getSetting<Date>("confirmationClose");
		response.json({
			"applicationOpen": applicationOpen.toISOString(),
			"applicationClose": applicationClose.toISOString(),
			"confirmationOpen": confirmationOpen.toISOString(),
			"confirmationClose": confirmationClose.toISOString()
		});
	})
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		let rawApplicationOpen = request.body.applicationOpen;
		let rawApplicationClose = request.body.applicationClose;
		let rawConfirmationOpen = request.body.confirmationOpen;
		let rawConfirmationClose = request.body.confirmationClose;
		if (!rawApplicationOpen || !rawApplicationClose || !rawConfirmationOpen || !rawConfirmationClose) {
			response.status(400).json({
				"error": "Application or confirmation open or close datetime not specified"
			});
			return;
		}
		if (moment(rawApplicationOpen).isAfter(moment(rawApplicationClose))) {
			response.status(400).json({
				"error": "Application open must come before application close"
			});
			return;
		}
		if (moment(rawConfirmationOpen).isAfter(moment(rawConfirmationClose))) {
			response.status(400).json({
				"error": "Confirmation open must come before confirmation close"
			});
			return;
		}

		try {
			await updateSetting<Date>("applicationOpen", new Date(rawApplicationOpen));
			await updateSetting<Date>("applicationClose", new Date(rawApplicationClose));
			await updateSetting<Date>("confirmationOpen", new Date(rawConfirmationOpen));
			await updateSetting<Date>("confirmationClose", new Date(rawConfirmationClose));
			response.json({
				"success": true
			});
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while updating the application availability"
			});
		}
	});

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
				"error": "An error occurred while enabling or disabling teams"
			});
		}
	});

settingsRoutes.route("/branch_roles")
	.get(isAdmin, async (request, response) => {
		let branchNames = (await validateSchema(config.questionsLocation, "./config/questions.schema.json")).map(branch => branch.name);
		let applicationBranches = await getSetting<string[]>("applicationBranches");
		let confirmationBranches = await getSetting<string[]>("confirmationBranches");
		response.json({
			"noop": branchNames.filter(branchName => applicationBranches.indexOf(branchName) === -1 && confirmationBranches.indexOf(branchName) === -1),
			"applicationBranches": applicationBranches,
			"confirmationBranches": confirmationBranches,
			"applicationToConfirmationMap": await getSetting<ApplicationToConfirmationMap>("applicationToConfirmation")
		});
	})
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		// First extract the application to confirmation map
		let applicationToConfirmationMap: ApplicationToConfirmationMap = JSON.parse(request.body.applicationToConfirmationMap);
		delete request.body.applicationToConfirmationMap;

		let applicationBranches = [];
		let confirmationBranches = [];
		if ((new Set(Object.keys(request.body))).size !== Object.keys(request.body).length) {
			response.status(400).json({
				"error": "Each branch can only be used once"
			});
			return;
		}
		for (let branchName of Object.keys(request.body)) {
			if (request.body[branchName] === "application") {
				applicationBranches.push(branchName);
			}
			if (request.body[branchName] === "confirmation") {
				confirmationBranches.push(branchName);
			}
		}
		try {
			await updateSetting<string[]>("applicationBranches", applicationBranches);
			await updateSetting<string[]>("confirmationBranches", confirmationBranches);
			await updateSetting<ApplicationToConfirmationMap>("applicationToConfirmation", applicationToConfirmationMap);
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
			let html: string = await renderEmailHTML(markdown, request.user);
			let text: string = await renderEmailText(html, request.user, true);

			response.json({ html, text });
		}
		catch (err) {
			console.error(err);
			response.status(500).json({
				"error": "An error occurred while rendering the email content"
			});
		}
	});
