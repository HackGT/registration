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
		[USER_ADDED]: {
			subscribe: (...args: any[]) => {
				// Create a symbol for this subscriber, giving him all users
				const target = Symbol();
				// Iterate with cursor and publish existing users
				setImmediate(() => {
					User.find({}).cursor().eachAsync(user => {
						pubsub.publish(USER_ADDED, {
							[USER_ADDED]: userRecordToGraphql(user),
							target
						});
					})
					.catch(err => {
						// TODO
						console.error("Error in sending pub sub of users", err);
					});
				});
				// Make a filter for all additions and existing ones.
				return withFilter(() => pubsub.asyncIterator(USER_ADDED), (payload, vars) => {
					if (payload.target && payload.target !== target) {
						return false;
					}
					return true;
				})(...args);
			}
		},
		[USER_REMOVED]: {
			subscribe: () => {
				return pubsub.asyncIterator(USER_REMOVED);
			}
		},
		[USER_MODIFIED]: {
			subscribe: (...args: any[]) => {
				return withFilter(() => pubsub.asyncIterator(USER_MODIFIED), (payload, vars) => {
					if (payload.event) {
						// TODO
						console.log("payload", payload);
						console.log("vars", vars);
						return payload.event === vars.event;
					} else {
						return true;
					}
				})(...args);
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
		},
		removed: (id: string) => {
			pubsub.publish(USER_REMOVED, {
				[USER_REMOVED]: id
			});
		},
		modified: (user: IUser, event?: UserEvent) => {
			pubsub.publish(USER_MODIFIED, {
				[USER_MODIFIED]: user,
				event
			});
		}
	}
};

export enum UserEvent {
	CREATED,
	APPLIED,
	ACCEPTED,
	ACCEPTED_AND_NOTIFIED,
	ATTENDING,
	REJECTED
}

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
		id: string;
	} | undefined;
}

function userRecordToGraphql(user: IUser): IGraphqlUser {
	return {
		id: user._id.toHexString(),
		email: user.email,
		email_verified: !!user.verifiedEmail,
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

		team: user.teamId && {
			id: user.teamId.toHexString()
		}
	};
}
