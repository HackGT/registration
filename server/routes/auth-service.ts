import * as express from "express";
import * as request from "request-promise-native";

import {createLink} from "../common";
import {User} from "../schema";
import {app} from "../app";

export async function redirectToLogin(auth: string, req: express.Request, res: express.Response) {
	// TODO: escape url
	const callback = createLink(req, req.path.substr(1));
	const redirect = await request({
		method: "POST",
		url: auth + "/graphql",
		json: true,
		body: {
			query: `{authenticate(callback:"${callback}")}`
		}
	});

	if (redirect && redirect.data && redirect.data.authenticate) {
		res.redirect(redirect.data.authenticate);
	}
	else {
		console.error(redirect);
		throw new Error('Got invalid response from auth service.');
	}
}

export function authRoutes(auth: string) {
	app.use("/", async (req, res, next) => {
		const token = req.cookies['sso-auth'];
		// TODO: escape token
		const query = `{
			user(token: "${token}") {
				id
				email
				email_verified
				name
				admin
			}
        }`;

		const login = await request({
			method: "POST",
			url: auth + "/graphql",
			json: true,
			body: {
				query
			}
		});

		if (!login || !login.data) {
			console.error(login);
			throw new Error('Got invalid response from auth service.');
		}
		const user = login && login.data && login.data.user;

		if (user) {
			const record = await User.findById(user.id);
			req.user = {
					...record,
					...user
			};
		}
		req.isAuthenticated = () => !!user;
		next();
	});
}
