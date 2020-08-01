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
		groundTruth: {
			url: string;
			id: string;
			secret: string;
		};
	}
	export interface Email {
		from: string;
		key: string;
		headerImage: string;
		twitterHandle: string;
		facebookHandle: string;
		contactAddress: string;
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
		defaultTimezone: string;
	}
	export interface Style {
		theme: string;
		favicon: string;
	}

	export interface Helpscout {
		enabled: boolean;
		secretKey: string;
	}

	export interface Main {
		secrets: Secrets;
		email: Email;
		server: Server;
		style: Style;
		admins: {
			domains: string[];
			emails: string[];
		};
		eventName: string;
		questionsLocation: string;
		storageEngine: {
			name: string;
			options: any;
		};
		maxTeamSize: number;
		helpscout: Helpscout;
	}
}

export interface IFormItem {
	"name": string;
	"type": string;
	// String for most types, string array for checkbox groups, file for file uploads, null if optional field is not filled in
	"value": string | string[] | Express.Multer.File | null;
}

// For stricter type checking of new object creation
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
interface RootDocument {
	_id: mongoose.Types.ObjectId;
}
export function createNew<T extends RootDocument>(model: mongoose.Model<T & mongoose.Document, {}>, doc: Omit<T, "_id">) {
	return new model(doc);
}
export type Model<T extends RootDocument> = T & mongoose.Document;

export interface ITeam extends RootDocument {
	teamLeader: mongoose.Types.ObjectId;
	members: mongoose.Types.ObjectId[];
	teamName: string;
}

export const Team = mongoose.model<Model<ITeam>>("Team", new mongoose.Schema({
	teamLeader: {
		type: mongoose.Schema.Types.ObjectId
	},
	members: [{
		type: mongoose.Schema.Types.ObjectId
	}],
	teamName: String
}));

export interface IUser extends RootDocument {
	uuid: string;
	email: string;
	name: string;
	token: string | null;

	teamId?: mongoose.Types.ObjectId;
	admin: boolean;

	applied: boolean;
	accepted: boolean;
	preConfirmEmailSent: boolean;
	confirmed: boolean;
	applicationBranch?: string;
	reimbursementAmount?: string;
	applicationData?: IFormItem[];
	applicationStartTime?: Date;
	applicationSubmitTime?: Date;

	confirmationDeadline?: {
		name: string;
		open: Date;
		close: Date;
	};

	confirmationBranch?: string;
	confirmationData?: IFormItem[];
	confirmationStartTime?: Date;
	confirmationSubmitTime?: Date;

}

// This is basically a type definition that exists at runtime and is derived manually from the IUser definition above
export const User = mongoose.model<Model<IUser>>("User", new mongoose.Schema({
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
	token: String,

	teamId: {
		type: mongoose.Schema.Types.ObjectId
	},

	admin: Boolean,

	applied: Boolean,
	accepted: Boolean,
	preConfirmEmailSent: Boolean,
	confirmed: Boolean,
	applicationBranch: String,
	reimbursementAmount: String,
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
	confirmationSubmitTime: Date
}).index({
	email: "text",
	name: "text"
}));

export interface ISetting extends RootDocument {
	name: string;
	value: any;
}

export const Setting = mongoose.model<Model<ISetting>>("Setting", new mongoose.Schema({
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
export interface IQuestionBranchConfig extends RootDocument {
	name: string;
	type: QuestionBranchType;
	settings: QuestionBranchSettings;
	location: string;
}

export const QuestionBranchConfig = mongoose.model<Model<IQuestionBranchConfig>>("QuestionBranchConfig", new mongoose.Schema({
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
		maxTeamSize?: number;
	};
}
type TimelineClass = "" | "complete" | "warning" | "rejected";
export interface IIndexTemplate extends ICommonTemplate {
	timeline: {
		application: TimelineClass;
		decision: TimelineClass;
		confirmation: TimelineClass;
		teamFormation: TimelineClass;
	};
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
	team?: ITeam | null;
	membersAsUsers?: IUser[] | null;
	teamLeaderAsUser?: IUser | null;
	isCurrentUserTeamLeader: boolean;
}
export interface IRegisterBranchChoiceTemplate extends ICommonTemplate {
	branches: string[];
}
export interface IInterstitialTemplate extends ICommonTemplate {
	html: string;
}
export interface IRegisterTemplate extends ICommonTemplate {
	branch: string;
	questionData: Questions;
	endText: string;
	unauthenticated: boolean;
}
export interface ResponseCount {
	response: string;
	count: number;
}
export interface StatisticEntry {
	questionName: string;
	questionLabel: string;
	branch: string;
	responses: ResponseCount[];
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
		adminEmails: IUser[];
		apiKey: string;
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

export interface ILoginTemplate {
	siteTitle: string;
	isLogOut: boolean;
	error?: string;
	groundTruthLogOut?: string;
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
