// The database schema used by Mongoose
// Exports TypeScript interfaces to be used for type checking and Mongoose models derived from these interfaces
import * as fs from "fs";
import * as path from "path";

import {mongoose} from "./common";

// Secrets JSON file schema
export interface Config {
	secrets: {
		session: string;
		github: {
			id: string;
			secret: string;
		};
		google: {
			id: string;
			secret: string;
		}
		facebook: {
			id: string;
			secret: string;
		};
	},
	server: {
		isProduction: boolean;
	},
	admins: string[]
}

// We need to find some way of integrating these static types with a config that
// can be adapted with different questions and data in a JSON schema file
export interface IUser {
	_id: string;
	email: string;
	name?: string;

	githubData: {
		id?: string;
		username?: string;
		profileUrl?: string;	
	};
	googleData: {
		id?: string;
	};
	facebookData: {
		id?: string;
	};

	admin?: boolean;
}
export type IUserMongoose = IUser & mongoose.Document;

export const User = mongoose.model<IUserMongoose>("User", new mongoose.Schema({
	email: {
		type: String,
		required: true,
		unique: true
	},
	name: String,

	githubData: {
		id: String,
		username: String,
		profileUrl: String
	},
	googleData: {
		id: String
	},
	facebookData: {
		id: String
	},

	admin: Boolean
}));

// Handlebars templates
export interface IIndexTemplate {
	siteTitle: string;
}
export interface ILoginTemplate {
	siteTitle: string;
}
export interface IRegisterTemplate {
	siteTitle: string;
	questionData: any; // Provide a type for this (generated from schema?)
}