import * as express from "express";
import {isHelpscoutIntegrationEnabled} from "../../middleware";

export const helpscoutRoutes = express.Router({ "mergeParams": true });

helpscoutRoutes.route("/userInfo").post(
	isHelpscoutIntegrationEnabled,
	helpscoutUserInfoHandler
)

async function helpscoutUserInfoHandler(request: express.Request, response: express.Response) {
	response.status(200).json({
		"success": true,
		"message": "Hello, World!"
	})
}
