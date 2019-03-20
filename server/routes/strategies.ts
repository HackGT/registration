import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import { URL } from "url";
import * as passport from "passport";
import { Strategy as OAuthStrategy } from "passport-oauth2";

import { config } from "../common";
// TODO import { trackEvent } from "../middleware";
import { createNew, IUser, User } from "../schema";
import { Request, Response, NextFunction } from "express";

type PassportDone = (err: Error | null, user?: IUser | false, errMessage?: { message: string }) => void;
type PassportProfileDone = (err: Error | null, profile?: IProfile) => void;
interface IStrategyOptions {
	passReqToCallback: true; // Forced to true for our usecase
}
interface IOAuthStrategyOptions extends IStrategyOptions {
	authorizationURL: string;
	tokenURL: string;
	clientID: string;
	clientSecret: string;
}
interface IProfile {
	uuid: string;
	name: string;
	email: string;
}

// Because the passport typedefs don't include this for some reason
// Defined: https://github.com/jaredhanson/passport-oauth2/blob/9ddff909a992c3428781b7b2957ce1a97a924367/lib/strategy.js#L135
export type AuthenticateOptions = passport.AuthenticateOptions & {
	callbackURL: string;
};

export class GroundTruthStrategy extends OAuthStrategy {
	public readonly url: string;

	public static get defaultUserProperties() {
		return {
			"admin": false,

			"applied": false,
			"accepted": false,
			"confirmed": false,
			"preConfirmEmailSent": false,
			"applicationStartTime": undefined,
			"applicationSubmitTime": undefined
		};
	}

	constructor(url: string) {
		const secrets = config.secrets.groundTruth;
		if (!secrets || !secrets.id || !secrets.secret) {
			throw new Error(`Client ID or secret not configured in config.json or environment variables for Ground Truth`);
		}
		let options: IOAuthStrategyOptions = {
			authorizationURL: new URL("/oauth/authorize", url).toString(),
			tokenURL: new URL("/oauth/token", url).toString(),
			clientID: secrets.id,
			clientSecret: secrets.secret,
			passReqToCallback: true
		};
		super(options, GroundTruthStrategy.passportCallback);
		this.url = url;
	}

	public userProfile(accessToken: string, done: PassportProfileDone) {
		(this._oauth2 as any)._request("GET", new URL("/api/user", this.url).toString(), null, null, accessToken, (err: Error | null, data: string) => {
			if (err) {
				done(err);
				return;
			}
			try {
				let profile: IProfile = JSON.parse(data);
				done(null, profile);
			}
			catch (err) {
				return done(err);
			}
		});
	}

	protected static async passportCallback(request: Request,  accessToken: string, refreshToken: string, profile: IProfile, done: PassportDone) {
		let user = await User.findOne({ uuid: profile.uuid });
		if (!user) {
			user = createNew<IUser>(User, {
				...GroundTruthStrategy.defaultUserProperties,
				...profile
			});
			await user.save();
		}
		if (config.admins.includes(profile.email) && !user.admin) {
			user.admin = true;
			await user.save();
		}
		done(null, user);
	}
}

// Authentication helpers
function getExternalPort(request: Request): number {
	function defaultPort(): number {
		// Default ports for HTTP and HTTPS
		return request.protocol === "http" ? 80 : 443;
	}

	let host = request.headers.host;
	if (!host || Array.isArray(host)) {
		return defaultPort();
	}

	// IPv6 literal support
	let offset = host[0] === "[" ? host.indexOf("]") + 1 : 0;
	let index = host.indexOf(":", offset);
	if (index !== -1) {
		return parseInt(host.substring(index + 1), 10);
	}
	else {
		return defaultPort();
	}
}

let validatedHostNames: string[] = [];
export function validateAndCacheHostName(request: Request, response: Response, next: NextFunction) {
	// Basically checks to see if the server behind the hostname has the same session key by HMACing a random nonce
	if (validatedHostNames.find(hostname => hostname === request.hostname)) {
		next();
		return;
	}

	let nonce = crypto.randomBytes(64).toString("hex");
	function callback(message: http.IncomingMessage) {
		if (message.statusCode !== 200) {
			console.error(`Got non-OK status code when validating hostname: ${request.hostname}`);
			message.resume();
			return;
		}
		message.setEncoding("utf8");
		let data = "";
		message.on("data", (chunk) => data += chunk);
		message.on("end", () => {
			let localHMAC = crypto.createHmac("sha256", config.secrets.session).update(nonce).digest().toString("hex");
			if (localHMAC === data) {
				validatedHostNames.push(request.hostname);
				next();
			}
			else {
				console.error(`Got invalid HMAC when validating hostname: ${request.hostname}`);
			}
		});
	}
	function onError(err: Error) {
		console.error(`Error when validating hostname: ${request.hostname}`, err);
	}
	if (request.protocol === "http") {
		http.get(`http://${request.hostname}:${getExternalPort(request)}/auth/validatehost/${nonce}`, callback).on("error", onError);
	}
	else {
		https.get(`https://${request.hostname}:${getExternalPort(request)}/auth/validatehost/${nonce}`, callback).on("error", onError);
	}
}

export function createLink(request: Request, link: string): string {
	if (link[0] === "/") {
		link = link.substring(1);
	}
	if ((request.secure && getExternalPort(request) === 443) || (!request.secure && getExternalPort(request) === 80)) {
		return `http${request.secure ? "s" : ""}://${request.hostname}/${link}`;
	}
	else {
		return `http${request.secure ? "s" : ""}://${request.hostname}:${getExternalPort(request)}/${link}`;
	}
}
