import * as fs from "fs";
import * as path from "path";

import { makeExecutableSchema } from "graphql-tools";
import { User, IUser, IFormItem } from "../../schema";
import { config } from "../../common";
import { isAdmin } from "../auth-service";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "./api.graphql"), "utf8");

const resolvers = {
	Query: {
		authority: async (prev: undefined, args: { token: string }) => {
			if (!config.server.services.auth) {
				throw new Error("Cannot use graphql interface without auth service!");
			}
			return await isAdmin(config.server.services.auth, args.token);
		}
	},
	AuthorizedQuery: {
		user: async (
			prev: { id: string; admin: boolean },
			args: { id: string | null }
		) => {
			if (args.id && args.id !== prev.id && !prev.admin) {
				throw new Error("Insufficient permissions.");
			}
			const user = await User.findById(args.id || prev.id);
			return user && userRecordToGraphql(user);
		}
	}
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });

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
