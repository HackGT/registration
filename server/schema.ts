// tslint:disable:interface-name variable-name
// The database schema used by Mongoose
// Exports TypeScript interfaces to be used for type checking and Mongoose models derived from these interfaces
import {mongoose} from "./common";
import {Questions} from "./config/questions.schema";

// Secrets JSON file schema
export namespace IConfig {
	export type OAuthServices = "github" | "google" | "facebook";
	export type CASServices = "gatech";
	export type Services = "local" | OAuthServices | CASServices;
	export interface Secrets {
		adminKey: string;
		session: string;
		oauth: {
			[Service in OAuthServices]: {
				id: string;
				secret: string;
			}
		};
	}
	export interface Email {
		from: string;
		key: string;
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
		passwordResetExpiration: number;
	}
	export interface Style {
		theme: string;
		favicon: string;
	}

	export interface Main {
		secrets: Secrets;
		email: Email;
		server: Server;
		style: Style;
		admins: string[];
		eventName: string;
		questionsLocation: string;
		storageEngine: {
			name: string;
			options: any;
		};
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
	uuid: string;
	email: string;
	name: string;
	verifiedEmail: boolean;
	accountConfirmed: boolean;

	local?: Partial<{
		hash: string;
		salt: string;
		verificationCode: string;
		resetRequested: boolean;
		resetCode: string;
		resetRequestedTime: Date;
	}>;
	services: {
		[Service in Exclude<IConfig.Services, "local">]?: {
			id: string;
			// OAuth account email can be different than registration account email
			email: string;
			username?: string;
			profileUrl?: string;
		};
	};

	applied: boolean;
	accepted: boolean;
	preConfirmEmailSent: boolean;
	confirmed: boolean;
	applicationBranch: string;
	applicationData: IFormItem[];
	applicationStartTime?: Date;
	applicationSubmitTime?: Date;

	confirmationDeadline?: {
		name: string;
		open: Date;
		close: Date;
	};

	confirmationBranch?: string;
	confirmationData: IFormItem[];
	confirmationStartTime?: Date;
	confirmationSubmitTime?: Date;

	admin?: boolean;

	teamId?: mongoose.Types.ObjectId;
}
export type IUserMongoose = IUser & mongoose.Document;

// This is basically a type definition that exists at runtime and is derived manually from the IUser definition above
export const User = mongoose.model<IUserMongoose>("User", new mongoose.Schema({
	uuid: {
		type: String,
		required: true,
		index: true,
		unique: true
	},
	email: {
		type: String,
		required: true,
		index: true,
		unique: true
	},
	name: {
		type: String,
		index: true
	},
	verifiedEmail: Boolean,
	accountConfirmed: Boolean,

	local: {
		hash: String,
		salt: String,
		verificationCode: String,
		resetRequested: Boolean,
		resetCode: String,
		resetRequestedTime: Date
	},
	services: mongoose.Schema.Types.Mixed,

	teamId: {
		type: mongoose.Schema.Types.ObjectId
	},

	applied: Boolean,
	accepted: Boolean,
	preConfirmEmailSent: Boolean,
	confirmed: Boolean,
	applicationBranch: String,
	applicationData: [mongoose.Schema.Types.Mixed],
	applicationStartTime: Date,
	applicationSubmitTime: Date,

	confirmationDeadline: {
		name: String,
		open: Date,
		close: Date
	},

	confirmationBranch: String,
	confirmationData: [mongoose.Schema.Types.Mixed],
	confirmationStartTime: Date,
	confirmationSubmitTime: Date,

	admin: Boolean
}).index({
	email: 'text',
	name: 'text'
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
}, {
	minimize: false
}));

type QuestionBranchType = "Application" | "Confirmation" | "Noop";
export interface QuestionBranchSettings {
	open?: Date; // Used by all except noop
	close?: Date; // Used by all except noop
	allowAnonymous?: boolean; // Used by application branch
	autoAccept?: string; // Used by application branch
	confirmationBranches?: string[]; // Used by application branch
	usesRollingDeadline?: boolean; // Used by confirmation branch
	isAcceptance?: boolean; // Used by confirmation branch
	autoConfirm?: boolean; // Used by confirmation branch
}
export interface IQuestionBranchConfig {
	_id: mongoose.Types.ObjectId;
	name: string;
	type: QuestionBranchType;
	settings: QuestionBranchSettings;
	location: string;
}
export type IQuestionBranchConfigMongoose = IQuestionBranchConfig & mongoose.Document;

export const QuestionBranchConfig = mongoose.model<IQuestionBranchConfigMongoose>("QuestionBranchConfig", new mongoose.Schema({
	name: {
		type: String,
		required: true,
		unique: true
	},
	type: String,
	settings: {
		open: Date,
		close: Date,
		allowAnonymous: Boolean,
		autoAccept: String,
		confirmationBranches: [String],
		usesRollingDeadline: Boolean,
		isAcceptance: Boolean,
		autoConfirm: Boolean
	},
	location: String
}));

// Handlebars templates
export interface ICommonTemplate {
	siteTitle: string;
	user: IUser;
	settings: {
		teamsEnabled: boolean;
		qrEnabled: boolean;
	};
}
export interface IIndexTemplate extends ICommonTemplate {
	status: string;
	applicationOpen: string;
	applicationClose: string;
	applicationStatus: {
		areOpen: boolean;
		beforeOpen: boolean;
		afterClose: boolean;
	};
	confirmationOpen: string;
	confirmationClose: string;
	confirmationStatus: {
		areOpen: boolean;
		beforeOpen: boolean;
		afterClose: boolean;
	};
	autoConfirm: boolean;
	allApplicationTimes: {
		name: string;
		open: string;
		close: string;
	}[];
	allConfirmationTimes: {
		name: string;
		open: string;
		close: string;
	}[];
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
	loginMethods?: string[];
}
export interface IRegisterBranchChoiceTemplate extends ICommonTemplate {
	branches: string[];
}
export interface IRegisterTemplate extends ICommonTemplate {
	branch: string;
	questionData: Questions;
	endText: string;
	unauthenticated: boolean;
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
	applicationStatistics: {
		totalUsers: number;
		appliedUsers: number;
		acceptedUsers: number;
		confirmedUsers: number;
		nonConfirmedUsers: number;
		applicationBranches: {
			name: string;
			count: number;
		}[];
		confirmationBranches: {
			name: string;
			confirmed: number;
			count: number;
		}[];
	};
	generalStatistics: StatisticEntry[];
	settings: {
		teamsEnabled: boolean;
		teamsEnabledChecked: string;
		qrEnabled: boolean;
		qrEnabledChecked: string;
		branches: {
			noop: {
				name: string;
			}[];
			application: {
				open: string;
				close: string;
				allowAnonymous: boolean;
				autoAccept: string;
			}[];
			confirmation: {
				open: string;
				close: string;
			}[];
		};
		loginMethodsInfo: {
			name: string;
			raw: string;
			enabled: boolean;
		}[];
		adminEmails: IUserMongoose[];
	};
	config: {
		admins: string;
		eventName: string;
		storageEngine: string;
		uploadDirectoryRaw: string;
		uploadDirectoryResolved: string;
		maxTeamSize: string;
	};
}

export interface DataLog {
	action: string;
	url: string;
	time: string;
	ip: string;
	userAgent?: string;
	user?: string;
}

export interface HackGTMetrics {
	tags: object;
	serviceName: string;
	values: object;
	hackgtmetricsversion: number;
}
