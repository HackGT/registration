// The database schema used by Mongoose
// Exports TypeScript interfaces to be used for type checking and Mongoose models derived from these interfaces
import * as fs from "fs";
import * as path from "path";

import {mongoose} from "./common";
import {Questions} from "./config/questions.schema";

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

export interface IFormItem {
	"name": string;
	// String for most types, string array for checkbox groups, file for file uploads, null if optional field is not filled in
	"value": string | string[] | Express.Multer.File | null;
}
export interface IUser {
	_id: mongoose.Types.ObjectId;
	email: string;
	name?: string;

	githubData?: {
		id: string;
		username: string;
		profileUrl: string;	
	};
	googleData?: {
		id: string;
	};
	facebookData?: {
		id: string;
	};

	applied: boolean;
	accepted: boolean;
	attending: boolean;
	applicationData: IFormItem[];

	admin?: boolean;
}
export type IUserMongoose = IUser & mongoose.Document;

// This is basically a type definition that exists at runtime and is derived manually from the IUser definition above
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

	applied: Boolean,
	accepted: Boolean,
	attending: Boolean,
	applicationData: [mongoose.Schema.Types.Mixed],

	admin: Boolean
}));

// Handlebars templates
export interface IIndexTemplate {
	siteTitle: string;
	user: IUser;
}
export interface ILoginTemplate {
	siteTitle: string;
}
export interface IRegisterTemplate {
	siteTitle: string;
	questionData: Questions;
	user: IUser;
}