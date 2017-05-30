import * as express from "express";
import * as moment from "moment";

import {
    uploadHandler, validateSchema
} from "../../common";
import {
	IUser, Setting
} from "../../schema";

function isAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
	let user = request.user as IUser;
	if (!request.isAuthenticated() || !user.admin) {
		response.status(403).json({
			"error": "You are not permitted to access this endpoint"
		});
	}
	else {
		next();
	}
}

export async function setDefaultSettings() {
	if (await Setting.find({ "name": "applicationOpen" }).count() === 0) {
		await new Setting({
			"name": "applicationOpen",
			"value": new Date()
		}).save();
	}
	if (await Setting.find({ "name": "applicationClose" }).count() === 0) {
		await new Setting({
			"name": "applicationClose",
			"value": new Date()
		}).save();
	}
	if (await Setting.find({ "name": "confirmationOpen" }).count() === 0) {
		await new Setting({
			"name": "confirmationOpen",
			"value": new Date()
		}).save();
	}
	if (await Setting.find({ "name": "confirmationClose" }).count() === 0) {
		await new Setting({
			"name": "confirmationClose",
			"value": new Date()
		}).save();
	}
	if (await Setting.find({ "name": "teamsEnabled" }).count() === 0) {
		await new Setting({
			"name": "teamsEnabled",
			"value": true
		}).save();
	}
	if (await Setting.find({ "name": "applicationBranches" }).count() === 0) {
		await new Setting({
			"name": "applicationBranches",
			"value": []
		}).save();
	}
	if (await Setting.find({ "name": "confirmationBranches" }).count() === 0) {
		await new Setting({
			"name": "confirmationBranches",
			"value": []
		}).save();
	}
}
setDefaultSettings().catch(err => {
	throw err;
});

export let settingsRoutes = express.Router();

settingsRoutes.route("/application_availability")
    .get(async (request, response) => {
		let applicationOpen = (await Setting.findOne({ "name": "applicationOpen" })).value as Date;
		let applicationClose = (await Setting.findOne({ "name": "applicationClose" })).value as Date;
		let confirmationOpen = (await Setting.findOne({ "name": "confirmationOpen" })).value as Date;
		let confirmationClose = (await Setting.findOne({ "name": "confirmationClose" })).value as Date;
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
		let applicationOpen = await Setting.findOne({ "name": "applicationOpen" });
		let applicationClose = await Setting.findOne({ "name": "applicationClose" });
		let confirmationOpen = await Setting.findOne({ "name": "confirmationOpen" });
		let confirmationClose = await Setting.findOne({ "name": "confirmationClose" });
		applicationOpen.value = new Date(rawApplicationOpen);
		applicationClose.value = new Date(rawApplicationClose);
		confirmationOpen.value = new Date(rawConfirmationOpen);
		confirmationClose.value = new Date(rawConfirmationClose);
		applicationOpen.markModified("value");
		applicationClose.markModified("value");
		confirmationOpen.markModified("value");
		confirmationClose.markModified("value");
		try {
			await Promise.all([
				applicationOpen.save(),
				applicationClose.save(),
				confirmationOpen.save(),
				confirmationClose.save()
			]);
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
		let enabled = (await Setting.findOne({ "name": "teamsEnabled" })).value as boolean;
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
		let enable = await Setting.findOne({ "name": "teamsEnabled" });
		enable.value = rawEnabled === "true";
		enable.markModified("value");
		try {
			await enable.save();
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
	.get(async (request, response) => {
		let branchNames = (await validateSchema("./config/questions.json", "./config/questions.schema.json")).map(branch => branch.name);
		let applicationBranches = (await Setting.findOne({ "name": "applicationBranches" })).value as string[];
		let confirmationBranches = (await Setting.findOne({ "name": "confirmationBranches" })).value as string[];
		response.json({
			"noop": branchNames.filter(branchName => applicationBranches.indexOf(branchName) === -1 && confirmationBranches.indexOf(branchName) === -1),
			"applicationBranches": applicationBranches,
			"confirmationBranches": confirmationBranches
		});
	})
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		let branchNames = (await validateSchema("./config/questions.json", "./config/questions.schema.json")).map(branch => branch.name);
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
			let applicationBranchesSetting = await Setting.findOne({ "name": "applicationBranches" });
			applicationBranchesSetting.value = applicationBranches;
			await applicationBranchesSetting.save();
			let confirmationBranchesSetting = await Setting.findOne({ "name": "confirmationBranches" });
			confirmationBranchesSetting.value = confirmationBranches;
			await confirmationBranchesSetting.save();

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
