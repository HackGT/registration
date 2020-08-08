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

async function helpScoutUserInfoHandler(request: express.Request, response: express.Response) {
	const email = request.body.customer.email;
	const user: IUser | null = await findUserByEmail(email);
	console.log(user);
	console.log(request.body);

	if (!user) {
		response.status(200).json({
			html: `<h4>${email}</h4>
				<h4>There are no users in registration with this email</h4>`
		});
	} else {
		const affiliationName = user.applicationBranch === "Mentor" ? "Affiliation" : "University";

		const affiliationBlock = `<li class="c-sb-list-item">
				<span class="c-sb-list-item__label">${affiliationName}<span class="c-sb-list-item__text">
					${user.applicationData ? findApplicationQuestion(user.applicationData, affiliationName.toLowerCase()): ""}</span>
					</span>
			</li>`;

		const cellphoneBlock = `<li class="c-sb-list-item">
			<span class="c-sb-list-item__label">Cell Phone<span class="c-sb-list-item__text">
				${user.applicationData ? findApplicationQuestion(user.applicationData, "phone-number") : ""}</span>
				</span>
			</li>`;
		response.status(200).json({
			"html": `
				<h4>
					<a href="mailto:${user.email}">${user.email}</a>
				</h4>
				<h4>${user.applicationBranch || "Has not applied"}</h4>
				<ul class="c-sb-list c-sb-list--two-line">
					${user.applicationData ? affiliationBlock : ""}
					${user.applicationData ? cellphoneBlock : ""}
					<li class="c-sb-list-item">
						<span class="c-sb-list-item__label">Applied?<span class="c-sb-list-item__text">
						${user.applicationSubmitTime ? moment(user.applicationSubmitTime)
								.format("DD-MMM-YYYY h:mm a") : "No application"}</span>
						</span>
					</li>
					<li class="c-sb-list-item">
						<span class="c-sb-list-item__label">Accepted?<span class="c-sb-list-item__text">${user.accepted ? "<span class=\"badge success\">Accepted</span>" : "No"}</span>
						</span>
					</li>
					<li class="c-sb-list-item">
						<span class="c-sb-list-item__label">Confirmed?<span class="c-sb-list-item__text">${user.confirmed ? "Yes" : "No"}</span>
						</span>
					</li>
					<li class="c-sb-list-item">
						<span class="c-sb-list-item__label">Ground Truth UUID<span class="c-sb-list-item__text">${user.uuid}</span>
						</span>
					</li>
				</ul>
			`
		});
	}
}
