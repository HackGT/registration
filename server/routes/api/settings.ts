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
		let open = (await Setting.findOne({ "name": "applicationOpen" })).value as Date;
		let close = (await Setting.findOne({ "name": "applicationClose" })).value as Date;
		response.json({
			"open": open.toISOString(),
			"close": close.toISOString()
		});
	})
	.put(isAdmin, uploadHandler.any(), async (request, response) => {
		let rawOpen = request.body.open;
		let rawClose = request.body.close;
		if (!rawOpen || !rawClose) {
			response.status(400).json({
				"error": "Application open or close datetime not specified"
			});
			return;
		}
		if (moment(rawOpen).isAfter(moment(rawClose))) {
			response.status(400).json({
				"error": "Application open must come before application close"
			});
			return;
		}
		let open = await Setting.findOne({ "name": "applicationOpen" });
		let close = await Setting.findOne({ "name": "applicationClose" });
		open.value = new Date(rawOpen);
		close.value = new Date(rawClose);
		open.markModified("value");
		close.markModified("value");
		try {
			await Promise.all([
				open.save(), close.save()
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
