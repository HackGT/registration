// tslint:disable:interface-name variable-name
// The database schema used by Mongoose
// Exports TypeScript interfaces to be used for type checking and Mongoose models derived from these interfaces
import {mongoose} from "./common";
import {Questions} from "./config/questions.schema";

// Secrets JSON file schema
export namespace IConfig {
	export interface Secrets {
		adminKey: string;
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
	email: string;
	name: string;
	verifiedEmail: boolean;

	localData?: {
		hash: string;
		salt: string;
		verificationCode: string;
		resetRequested: boolean;
		resetCode: string;
		resetRequestedTime: Date;
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
	acceptedEmailSent: boolean;
	attending: boolean;
	applicationBranch: string;
	applicationData: IFormItem[];
	applicationStartTime?: Date;
	applicationSubmitTime?: Date;

	confirmationDeadlines: {
		name: string;
		open: Date;
		close: Date;
	}[];

	confirmationBranch: string;
	confirmationData: IFormItem[];
	confirmationStartTime?: Date;
	confirmationSubmitTime?: Date;

	admin?: boolean;
	uuid: string;

	teamId?: mongoose.Types.ObjectId;
}
export type IUserMongoose = IUser & mongoose.Document;

// This is basically a type definition that exists at runtime and is derived manually from the IUser definition above
export const User = mongoose.model<IUserMongoose>("User", new mongoose.Schema({
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

	localData: {
		hash: String,
		salt: String,
		verificationCode: String,
		resetRequested: Boolean,
		resetCode: String,
		resetRequestedTime: Date
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

	teamId: {
		type: mongoose.Schema.Types.ObjectId
	},

	applied: Boolean,
	accepted: Boolean,
	acceptedEmailSent: Boolean,
	attending: Boolean,
	applicationBranch: String,
	applicationData: [mongoose.Schema.Types.Mixed],
	applicationStartTime: Date,
	applicationSubmitTime: Date,

	confirmationDeadlines: [{
		name: String,
		open: Date,
		close: Date
	}],

	confirmationBranch: String,
	confirmationData: [mongoose.Schema.Types.Mixed],
	confirmationStartTime: Date,
	confirmationSubmitTime: Date,

	admin: Boolean,
	uuid: {
		type: String,
		required: true,
		index: true,
		unique: true
	}
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
	autoAccept?: boolean; // Used by application branch
	noConfirmation?: boolean; // Used by application branch
	confirmationBranches?: string[]; // Used by application branch
	usesRollingDeadline?: boolean; // Used by confirmation branch
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
		autoAccept: Boolean,
		noConfirmation: Boolean,
		confirmationBranches: [String],
		usesRollingDeadline: Boolean
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
}
export interface IRegisterBranchChoiceTemplate extends ICommonTemplate {
	branches: string[];
}
export interface IRegisterTemplate extends ICommonTemplate {
	branch: string;
	questionData: Questions;
	endText: string;
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
		admittedUsers: number;
		attendingUsers: number;
		declinedUsers: number;
		applicationBranches: {
			name: string;
			count: number;
		}[];
		confirmationBranches: {
			name: string;
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
				confirmationBranches: string[];
			}[];
			confirmation: {
				open: string;
				close: string;
			}[];
		};
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

// TODO remove this? deprecated?
export interface ApplicationToConfirmationMap {
	[applicationBranch: string]: string[];
}
