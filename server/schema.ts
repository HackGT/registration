// tslint:disable:interface-name variable-name
// The database schema used by Mongoose
// Exports TypeScript interfaces to be used for type checking and Mongoose models derived from these interfaces
import * as fs from "fs";
import * as path from "path";

import {mongoose} from "./common";
import {QuestionBranches, Questions} from "./config/questions.schema";

// Secrets JSON file schema
export namespace IConfig {
	export interface Secrets {
		session: string;
		github: {
			id: string;
			secret: string;
		};
		google: {
			id: string;
			secret: string;
		};
		facebook: {
			id: string;
			secret: string;
		};
	}
	export interface Email {
		from: string;
		host: string;
		username: string;
		password: string;
		port: number;
	}
	export interface Server {
		isProduction: boolean;
		port: number;
		versionHash: string;
		workflowReleaseCreatedAt: string | null;
		workflowReleaseSummary: string | null;
		cookieMaxAge: number;
		cookieSecureOnly: boolean;
		mongoURL: string;
		uniqueAppID: string;
	}

	export interface Main {
		secrets: Secrets;
		email: Email;
		server: Server;
		admins: string[];
		eventName: string;
		maxTeamSize: number;
	}
}

export interface IFormItem {
	"name": string;
	"type": string;
	// String for most types, string array for checkbox groups, file for file uploads, null if optional field is not filled in
	"value": string | string[] | Express.Multer.File | null;
}

export interface ITeam {
	_id: mongoose.Types.ObjectId;
	teamLeader: mongoose.Types.ObjectId;
	members: mongoose.Types.ObjectId[];
	teamName: string;
}

export type ITeamMongoose = ITeam & mongoose.Document;

export const Team = mongoose.model<ITeamMongoose>("Team", new mongoose.Schema({
	teamLeader: {
		type: mongoose.Schema.Types.ObjectId
	},
	members: [{
		type: mongoose.Schema.Types.ObjectId
	}],
	teamName: {
		type: mongoose.Schema.Types.String
	}
}));

export interface IUser {
	_id: mongoose.Types.ObjectId;
	email: string;
	name: string;
	verifiedEmail: boolean;

	localData?: {
		hash: string;
		salt: string;
		verificationCode: string;
	};
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
	applicationBranch: string;
	applicationData: IFormItem[];
	applicationStartTime?: Date;
	applicationSubmitTime?: Date;

	admin?: boolean;

	teamId?: mongoose.Types.ObjectId;
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
	verifiedEmail: Boolean,

	localData: {
		hash: String,
		salt: String,
		verificationCode: String
	},
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
	applicationBranch: String,
	applicationData: [mongoose.Schema.Types.Mixed],
	applicationStartTime: Date,
	applicationSubmitTime: Date,

	admin: Boolean,

	teamId: {
		type: mongoose.Schema.Types.ObjectId
	}
}));

export interface ISetting {
	_id: mongoose.Types.ObjectId;
	name: string;
	value: any;
}
export type ISettingMongoose = ISetting & mongoose.Document;

export const Setting = mongoose.model<ISettingMongoose>("Setting", new mongoose.Schema({
	name: {
		type: String,
		required: true,
		unique: true
	},
	value: mongoose.Schema.Types.Mixed
}));

// Handlebars templates
export interface ICommonTemplate {
	siteTitle: string;
	user: IUser;
	settings: {
		teamsEnabled: boolean;
	};
}
export interface IIndexTemplate extends ICommonTemplate {
	applicationOpen: string;
	applicationClose: string;
	applicationStatus: {
		areOpen: boolean;
		beforeOpen: boolean;
		afterClose: boolean;
	};
}
export interface ITeamTemplate extends ICommonTemplate {
	team?: ITeamMongoose | null;
	membersAsUsers?: IUserMongoose[] | null;
	teamLeaderAsUser?: IUserMongoose | null;
	isCurrentUserTeamLeader: boolean;
}
export interface ILoginTemplate {
	siteTitle: string;
	error?: string;
	success?: string;
}
export interface IRegisterBranchChoiceTemplate extends ICommonTemplate {
	branches: string[];
}
export interface IRegisterTemplate extends ICommonTemplate {
	branch: string;
	questionData: Questions;
}
export interface ResponseCount {
	"response": string;
	"count": number;
}
export interface StatisticEntry {
	"questionName": string;
	"branch": string;
	"responses": ResponseCount[];
}
export interface IAdminTemplate extends ICommonTemplate {
	branchNames: string[];
	applicationStatistics: {
		totalUsers: number;
		appliedUsers: number;
		admittedUsers: number;
		attendingUsers: number;
		declinedUsers: number;
	};
	generalStatistics: StatisticEntry[];
	users: any[];
	metrics: {};
	settings: {
		application: {
			open: string;
			close: string;
		};
		teamsEnabled: boolean;
		teamsEnabledChecked: string;
	};
}
