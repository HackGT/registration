// tslint:disable:interface-name variable-name
// The database schema used by Mongoose
// Exports TypeScript interfaces to be used for type checking and Mongoose models derived from these interfaces
import {mongoose} from "./common";
import {Questions} from "./config/questions.schema";

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
		questions: string;
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

	confirmationBranch: string;
	confirmationData: IFormItem[];
	confirmationStartTime?: Date;
	confirmationSubmitTime?: Date;

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

	confirmationBranch: String,
	confirmationData: [mongoose.Schema.Types.Mixed],
	confirmationStartTime: Date,
	confirmationSubmitTime: Date,

	admin: Boolean
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
	branchNames: string[];
	applicationStatistics: {
		totalUsers: number;
		appliedUsers: number;
		admittedUsers: number;
		attendingUsers: number;
		declinedUsers: number;
	};
	generalStatistics: StatisticEntry[];
	metrics: {};
	settings: {
		application: {
			open: string;
			close: string;
		};
		confirmation: {
			open: string;
			close: string;
		};
		teamsEnabled: boolean;
		teamsEnabledChecked: string;
		qrEnabled: boolean;
		qrEnabledChecked: string;
		branchRoles: {
			noop: string[];
			applicationBranches: string[];
			confirmationBranches: string[];
		};
		applicationToConfirmationMap: ApplicationToConfirmationMap;
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

export interface ApplicationToConfirmationMap {
	[applicationBranch: string]: string[];
}
