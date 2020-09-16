import * as express from "express";
import {isHelpScoutIntegrationEnabled, validateHelpScoutSignature} from "../../middleware";
import {
	IFormItem,
	IHelpScoutEmailNotFoundTemplate,
	IHelpScoutFormItem,
	IHelpScoutMainTemplate,
	IUser,
	User
} from "../../schema";
import bodyParser = require("body-parser");
import * as moment from "moment-timezone";
import {Template} from "../templates";
import * as Handlebars from "handlebars";
import * as Branches from "../../branch";

export const helpScoutRoutes = express.Router({"mergeParams": true});

export type RequestWithRawBody = express.Request & { rawBody: string };
helpScoutRoutes.use(isHelpScoutIntegrationEnabled);
helpScoutRoutes.use(bodyParser.json({
	verify: (req: RequestWithRawBody, res, buffer, encoding) => {
		if (buffer && buffer.length) {
			req.rawBody = buffer.toString(encoding || 'utf-8');
		}
	}
}));
helpScoutRoutes.use(validateHelpScoutSignature);
helpScoutRoutes.route("/userInfo").post(helpScoutUserInfoHandler);

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

async function getFormAnswers(userData: IFormItem[], branch: string): Promise<IHelpScoutFormItem[]> {
	let branchName = await Branches.BranchConfig.getCanonicalName(branch);
	let questionBranch = branchName ? await Branches.BranchConfig.loadBranchFromDB(branchName) : null;
	if (questionBranch) {
		const hsQuestionNames = questionBranch?.questions
			.filter(question => question.showInHelpScout)
			.map(question => question.name);

		return userData
			.filter(question => hsQuestionNames.includes(question.name))
			.map((question: IFormItem): IHelpScoutFormItem => {
				let name = question.name.replace(/-/g, " ");
				name = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

				let prettyValue: string = "";

				if (!question.value) {
					prettyValue = "No response";
				} else if (question.type === "file") {
					const file = question.value as Express.Multer.File;
					prettyValue = file.path;
				} else if (question.value instanceof Array) {
					prettyValue = question.value.join(", ");
				} else {
					prettyValue = question.value as string;
				}

				return {
					...question,
					prettyValue,
					name
				};
			});
	}

	return [];
}

async function helpScoutUserInfoHandler(request: express.Request, response: express.Response) {
	const email = safe(request.body.customer.email);
	const user: IUser | null = await findUserByEmail(email);

	if (!user) {
		response.status(200).json({
			html: EmailNotFoundTemplate.render({ email })
		});
	} else {
		const helpScoutInput: IHelpScoutMainTemplate = {
			name: user.name,
			email: user.email,
			uuid: user.uuid,
			applicationSubmitTime: user.applicationSubmitTime ? moment(user.applicationSubmitTime)
				.format("DD-MMM-YYYY h:mm a") : undefined,
			applicationQuestionsToShow: [],
			confirmationQuestionsToShow: [],
			applied: user.applied,
			accepted: user.accepted,
			confirmed: user.confirmed,
			applicationBranch: user.applicationBranch,
			confirmationBranch: user.confirmationBranch,
			confirmationSubmitTime: user.confirmationSubmitTime ? moment(user.confirmationSubmitTime)
				.format("DD-MMM-YYYY h:mm a") : undefined
		};

		if (user.applicationBranch && user.applicationData) {
			helpScoutInput.applicationQuestionsToShow = await getFormAnswers(user.applicationData, user.applicationBranch);
		}

		if (user.confirmationBranch && user.confirmationData) {
			helpScoutInput.confirmationQuestionsToShow = await getFormAnswers(user.confirmationData, user.confirmationBranch);
		}

		response.status(200).json({
			"html": MainHelpScoutTemplate.render(helpScoutInput)
		});
	}
}
