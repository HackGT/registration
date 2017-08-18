import * as fs from "fs";
import * as path from "path";

import { makeExecutableSchema } from "graphql-tools";
import { User, IUser, IFormItem } from "../../schema";
import { config, Branches, Tags, AllTags } from "../../common";
import { isAdmin } from "../auth-service";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "./api.graphql"), "utf8");

const resolvers = {
	Query: {
		authority: async (prev: undefined, args: { token: string }) => {
			if (!config.server.services.auth) {
				throw new Error("Cannot use graphql interface without auth service!");
			}
			return await isAdmin(config.server.services.auth, args.token);
		},
		question_branches: () => {
			return Branches;
		},
		question_names: (prev: undefined, args: { branch?: string }) => {
			if (args.branch) {
				return Tags[args.branch];
			}
			return AllTags;
		}
	},
	AuthorizedQuery: {
		user: async (
			prev: { id: string; admin: boolean },
			args: { id: string | null }
		): Promise<IGraphqlUser | undefined> => {
			if (args.id && args.id !== prev.id && !prev.admin) {
				throw new Error("Insufficient permissions.");
			}
			const user = await User.findById(args.id || prev.id);
			return user? userRecordToGraphql(user) : undefined;
		}
	},
	User: {
		question: async (
			prev: IGraphqlUser,
			args: { name: string }
		): Promise<IGraphqlFormItem | undefined> => {
			const user = await User.findById(prev.id);
			if (!user) return undefined;

			const found = user.confirmationData.concat(user.applicationData).find(question => {
				return question.name === args.name;
			});

			if (found && found.value instanceof String) {
				return {
					name: found.name,
					type: found.type,
					value: found.value
				};
			}
			return undefined;
		}
	}
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });

interface IGraphqlFormItem {
	name: string;
	type: string;
	value?: string;
	values?: string[];
	file?: string;
}

interface IGraphqlUser {
	id: string;

	applied: boolean;
	accepted: boolean;
	accepted_and_notified: boolean;
	attending: boolean;

	applicationBranch: string | undefined;
	applicationData: IFormItem[] | undefined;
	applicationStartTime: string | undefined;
	applicationSubmitTime: string | undefined;

	confirmationBranch: string | undefined;
	confirmationData: IFormItem[] | undefined;
	confirmationStartTime: string | undefined;
	confirmationSubmitTime: string | undefined;

	team: {
		id: string;
	} | undefined;
}

function userRecordToGraphql(user: IUser): IGraphqlUser {
	return {
		id: user._id.toHexString(),

		applied: !!user.applied,
		accepted: !!user.accepted,
		accepted_and_notified: !!user.acceptedEmailSent,
		attending: !!user.attending,

		applicationBranch: user.applicationBranch,
		applicationData: user.applicationData,
		applicationStartTime: user.applicationStartTime &&
			user.applicationStartTime.toDateString(),
		applicationSubmitTime: user.applicationSubmitTime &&
			user.applicationSubmitTime.toDateString(),

		confirmationBranch: user.confirmationBranch,
		confirmationData: user.confirmationData,
		confirmationStartTime: user.confirmationStartTime &&
			user.confirmationStartTime.toDateString(),
		confirmationSubmitTime: user.confirmationSubmitTime &&
			user.confirmationSubmitTime.toDateString(),

		team: user.teamId && {
			id: user.teamId.toHexString()
		}
	};
}
