import * as fs from "fs";
import * as path from "path";

import { makeExecutableSchema } from "graphql-tools";
import { PubSub, withFilter } from "graphql-subscriptions";
import { User, IUser, IFormItem } from "../../schema";

const USER_ADDED = "user_added";
const USER_REMOVED = "user_removed";
const USER_MODIFIED = "user_modified";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "./api.graphql"), "utf8");

const pubsub = new PubSub();

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
	},
	Subscription: {
		authority: (prev: undefined, args: { token: string }) => {
			return {
				// TODO: when central auth is a thing
			};
		}
	},
	AuthorizedSubscription: {
		[USER_ADDED]: {
			subscribe: () => {
				// TODO: async send all users with this subscription
				return pubsub.asyncIterator(USER_ADDED);
			}
		},
		[USER_REMOVED]: {
			subscribe: () => {
				return pubsub.asyncIterator(USER_REMOVED);
			}
		},
		[USER_MODIFIED]: {
			subscribe: () => {
				return withFilter(() => pubsub.asyncIterator(USER_MODIFIED), (payload, vars) => {
					if (payload.event) {
						return payload.event === vars.event;
					} else {
						return true;
					}
				});
			}
		}
	}
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });

export const publish = {
	user: {
		added: (user: IUser) => {
			pubsub.publish(USER_ADDED, {
				[USER_ADDED]: user
			});
		}
	}
};

interface IGraphqlUser {
	id: string;
	email: string;
	email_verified: boolean;
	admin: boolean;
	name: string | undefined;

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
		id: string | undefined;
	};
}

function userRecordToGraphql(user: IUser): IGraphqlUser {
	return {
		id: user._id.toHexString(),
		email: user.email,
		email_verified: user.verifiedEmail,
		admin: !!user.admin,
		name: user.name,

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

		team: {
			id: user.teamId && user.teamId.toHexString()
		}
	};
}
