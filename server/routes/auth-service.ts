import * as express from "express";
import * as sendHttpReq from "request-promise-native";

import {createLink} from "../common";
import {User} from "../schema";
import {app} from "../app";

interface IAuthResponse {
	data?: {
		user?: {
			_id: string;
			email: string;
			email_verified: boolean;
			name: string | undefined;
			admin: boolean;
		};
	};
}

export async function redirectToLogin(
	auth: { url: string; cookie: string },
	request: express.Request,
	response: express.Response
) {
	// TODO: escape url
	const callback = createLink(request, request.path.substr(1));
	const redirect = await sendHttpReq({
		method: "POST",
		url: auth.url + "/graphql",
		json: true,
		body: {
			query: `{authenticate(callback:"${callback}")}`
		}
	});

	if (redirect && redirect.data && redirect.data.authenticate) {
		response.redirect(redirect.data.authenticate);
	}
	else {
		console.error(redirect);
		throw new Error("Got invalid response from auth service.");
	}
}

export async function isAdmin(
	auth: { url: string; cookie: string },
	token: string
): Promise<{ id: string; admin: boolean } | null> {
	const query = `{user(token: "${token}") {id admin}}`;

	const login: {
		data: {
			user: {
				id: string;
				admin: boolean;
			} | null;
		} | undefined;
	} = await request({
		method: "POST",
		url: auth.url + "/graphql",
		json: true,
		body: { query }
	});

	if (!login || !login.data) {
		console.error(login);
		throw new Error('Got invalid response from auth service.');
	}
	return login && login.data && login.data.user;
}

export function authRoutes(auth: { url: string; cookie: string }) {
	app.use("/", async (request, response, next) => {
		const token = request.cookies[auth.cookie];
		// TODO: escape token
		const query = `{
			user(token: "${token}") {
				_id: id
				email
				email_verified
				name
				admin
			}
		}`;

		const login: IAuthResponse = await sendHttpReq({
			method: "POST",
			url: auth.url + "/graphql",
			json: true,
			body: {
				query
			}
		});

		if (!login || !login.data) {
			console.error(login);
			throw new Error("Got invalid response from auth service.");
		}
		const user = login && login.data && login.data.user;

		if (user) {
			request.user = await User.findByIdAndUpdate(user._id, user, {
				new: true,
				upsert: true,
				setDefaultsOnInsert: true
			});
		}
		request.isAuthenticated = () => !!user;
		next();
	});

	app.all("/auth/logout", async (req, res) => {
		const logout: { data: { logout: string } } = await sendHttpReq({
			method: "POST",
			url: auth.url + "/graphql",
			json: true,
			body: {
				query: "{logout}"
			}
		});

		res.redirect(logout.data.logout);
	});
}
