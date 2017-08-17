import * as fs from "fs";
import * as path from "path";

import { makeExecutableSchema } from "graphql-tools";
import { User, IUser, IFormItem } from "../../schema";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "./api.graphql"), "utf8");

const resolvers = {
	Query: {
		authority: (prev: undefined, args: { token: string }) => {
			return {
				// TODO: when central auth is a thing
			};
		}
	},
	AuthorizedQuery: {
		user: async (prev: { auth: string }, args: { id: string }) => {
			// TODO: use token maybe when central auth is a thing
			if (!args.id) {
				return null;
			}
			const user = await User.findById(args.id);
			if (!user) {
				return null;
			}
			return userRecordToGraphql(user);
		}
	}
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });

interface IGraphqlUser {
	id: string;
	email: string;
	email_verified: boolean;
	admin: boolean;
	name: string | undefined;

	info: {
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
	};
}

function userRecordToGraphql(user: IUser): IGraphqlUser {
	return {
		id: user._id.toHexString(),
		email: user.email,
		email_verified: !!user.verifiedEmail,
		admin: !!user.admin,
		name: user.name,

		info: {
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
		}
	};
}
