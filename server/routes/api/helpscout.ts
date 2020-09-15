import * as express from "express";
import {isHelpScoutIntegrationEnabled, validateHelpScoutSignature} from "../../middleware";
import {IHelpScoutEmailNotFoundTemplate, IHelpScoutMainTemplate, IUser, User} from "../../schema";
import bodyParser = require("body-parser");
import * as moment from "moment-timezone";
import {Template} from "../templates";
import * as Handlebars from "handlebars";

export const helpScoutRoutes = express.Router({"mergeParams": true});

export type RequestWithRawBody = express.Request & { rawBody: string };

helpScoutRoutes.route("/userInfo").post(
	isHelpScoutIntegrationEnabled,
	bodyParser.json({
		verify: (req: RequestWithRawBody, res, buffer, encoding) => {
			if (buffer && buffer.length) {
				req.rawBody = buffer.toString(encoding || 'utf-8');
			}
		}
	}),
	validateHelpScoutSignature,
	helpScoutUserInfoHandler
);

async function findUserByEmail(email: string) {
	return User.findOne({
		email
	});
}

function safe(text: string) {
	return Handlebars.Utils.escapeExpression(text);
}

const EmailNotFoundTemplate = new Template<IHelpScoutEmailNotFoundTemplate>("helpscout/email_not_found.html");
const MainHelpScoutTemplate = new Template<IHelpScoutMainTemplate>("helpscout/main.html");

async function helpScoutUserInfoHandler(request: express.Request, response: express.Response) {
	// TODO: validate signature here?
	const email = safe(request.body.customer.email);
	const user: IUser | null = await findUserByEmail(email);

	if (!user) {
		response.status(200).json({
			html: EmailNotFoundTemplate.render({ email }).replace(/[\r\n\t]/g, "")
		});
	} else {
		response.status(200).json({
			"html": MainHelpScoutTemplate.render({
				name: user.name,
				email: user.email,
				uuid: user.uuid,
				applicationSubmitTime: user.applicationSubmitTime ? moment(user.applicationSubmitTime)
					.format("DD-MMM-YYYY h:mm a") : undefined,
				applied: user.applied,
				accepted: user.accepted,
				confirmed: user.confirmed,
				applicationBranch: user.applicationBranch,
				confirmationBranch: user.confirmationBranch,
				confirmationSubmitTime: user.confirmationSubmitTime ? moment(user.confirmationSubmitTime)
					.format("DD-MMM-YYYY h:mm a") : undefined
			}).replace(/[\r\n\t]/g, "")
		});
	}
}
