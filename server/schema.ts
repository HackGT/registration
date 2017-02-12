// The database schema used by Mongoose
// Exports TypeScript interfaces to be used for type checking and Mongoose models derived from these interfaces
import * as fs from "fs";
import * as path from "path";

import {mongoose} from "./common";

// We need to find some way of integrating these static types with a config that
// can be adapted with different questions and data in a JSON schema file
export interface IUser {
	email: string;
	name?: string;

	login: {
		hash: string;
		salt: string;
	};
	auth_keys: string[];

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

	login: {
		hash: {
			type: String,
			required: true,
		},
		salt: {
			type: String,
			required: true,
		}
	},
	auth_keys: [String],

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