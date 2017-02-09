// The database schema used by Mongoose
// Exports TypeScript interfaces to be used for type checking and Mongoose models derived from these interfaces
import * as fs from "fs";
import * as path from "path";

import * as mongoose from "mongoose";
import * as ajv from "ajv";

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