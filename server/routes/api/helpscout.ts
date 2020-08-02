import * as express from "express";
import {isHelpScoutIntegrationEnabled, validateHelpScoutSignature} from "../../middleware";
import {IUser, User} from "../../schema";
import bodyParser = require("body-parser");

export const helpScoutRoutes = express.Router({ "mergeParams": true });

helpScoutRoutes.route("/userInfo").post(
	isHelpScoutIntegrationEnabled,
	bodyParser.json(),
	validateHelpScoutSignature,
	helpScoutUserInfoHandler
);

async function findUserByEmail(email: string) {
	return User.findOne({
		email
	});
}

async function helpScoutUserInfoHandler(request: express.Request, response: express.Response) {
	const user: IUser|null = await findUserByEmail(request.body.customer.email);
	console.log(user);
	console.log(request.body);

	if (!user) {
		response.status(404).json({
			error: "User not found"
		});
	} else {
		response.status(200).json({
			"html": "<p>Hello, World! 2020</p>"
		});
	}
}
