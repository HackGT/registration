import * as express from "express";
import {isHelpScoutIntegrationEnabled, validateHelpScoutSignature} from "../../middleware";
import {IFormItem, IUser, User} from "../../schema";
import bodyParser = require("body-parser");
import * as moment from "moment-timezone";

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

function findApplicationQuestion(applicationData: IFormItem[], questionName: string) {
	const result = applicationData.find((item: IFormItem) => item.name === questionName);
	return result ? result.value : "";
}

function createListBlock(title: string, content: string | string[] | Express.Multer.File | null) {
	return `<li class="c-sb-list-item">
			<span class="c-sb-list-item__label">${title}<span class="c-sb-list-item__text">${content}</span>
		</span>
	</li>`;
}

function badge(type: string, text: string) {
	return `<span class="badge ${type}">${text}</span>`;
}

async function helpScoutUserInfoHandler(request: express.Request, response: express.Response) {
	const email = request.body.customer.email;
	const user: IUser | null = await findUserByEmail(email);

	if (!user) {
		response.status(200).json({
			html: `<h4><a href="mailto:${email}">${email}</a></h4>
				<h4>There are no users in registration with this email</h4>`.replace(/[\n\t]/g, "")
		});
	} else {
		let affiliationName: string;
		if (user.applicationBranch === "Mentor") {
			affiliationName = "Affiliation";
		} else {
			affiliationName = "University";
		}
		let affiliationBlock: string;
		let cellphoneBlock: string;
		if (user.applicationData) {
			affiliationBlock = createListBlock(affiliationName, findApplicationQuestion(user.applicationData, affiliationName.toLowerCase()));
			cellphoneBlock = createListBlock("Cell Phone", findApplicationQuestion(user.applicationData, "phone-number"));

		} else {
			affiliationBlock = createListBlock(affiliationName, "");
			cellphoneBlock = createListBlock("Cell Phone", "");
		}

		let appliedBlock: string;
		if (user.applicationSubmitTime) {
			appliedBlock = createListBlock("Applied?",
				moment(user.applicationSubmitTime)
					.format("DD-MMM-YYYY h:mm a"));
		} else {
			appliedBlock = createListBlock("Applied?",
				"No application");
		}

		let acceptedText = badge("pending", "No decision");
		let acceptedBlock = "";

		let confirmationBlock = "";

		if (user.confirmationBranch) {
			acceptedText = user.accepted ? badge("success", "Accepted") : badge("error", "Rejected");
			acceptedBlock = createListBlock("Accepted?", acceptedText);

			const confirmationText = user.confirmed ? badge("success", "Confirmed") : "No";
			confirmationBlock = createListBlock("Confirmed?", confirmationText);
		}

		response.status(200).json({
			"html": `
				<h4>
					<a href="mailto:${user.email}">${user.email}</a>
				</h4>
				<h4>${user.applicationBranch || "Has not applied"}</h4>
				<ul class="c-sb-list c-sb-list--two-line">
					${user.applicationData ? affiliationBlock : ""}
					${user.applicationData ? cellphoneBlock : ""}
					${appliedBlock}
					${acceptedBlock}
					${confirmationBlock}
					<li class="c-sb-list-item">
						<span class="c-sb-list-item__label">Ground Truth UUID<span class="c-sb-list-item__text">${user.uuid}</span>
						</span>
					</li>
				</ul>
			`.replace(/[\n\t]/g, "")
		});
	}
}
