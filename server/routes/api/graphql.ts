import * as fs from "fs";
import * as path from "path";

import * as bodyParser from "body-parser";
import * as express from "express";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import { makeExecutableSchema } from "graphql-tools";
import { isAdmin, authenticateWithRedirect } from "../../middleware";
import { User, IUser, IFormItem } from "../../schema";
import { Branches, Tags, AllTags } from "../../branch";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "../../../api.graphqls"), "utf8");

/**
 * GraphQL API
 */
const resolvers = {
	Query: {
		user: async (
			prev: undefined,
			args: { id?: string },
			request: express.Request
		): Promise<IGraphqlUser | undefined> => {
			const id = args.id || (request.user as IUser)._id;
			const user = await User.findById(id);
			return user ? userRecordToGraphql(user) : undefined;
		},
		search_user: async (
			prev: undefined,
			args: { search: string; offset: number; n: number }
		): Promise<IGraphqlUser[]> => {
			const results = await User
				.find({
					$text: {
						$search: args.search
					}
				}, {
					score : {
						$meta: "textScore"
					}
				})
				.sort({
					score: {
						$meta: "textScore"
					}
				})
				.skip(args.offset)
				.limit(args.n);

			return results.map(userRecordToGraphql);
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

			if (found) {
				if (typeof found.value === "string") {
					return {
						name: found.name,
						type: found.type,
						value: found.value
					};
				}
				else if (found.value instanceof Array) {
					return {
						name: found.name,
						type: found.type,
						values: found.value
					};
				}
				// XXX: assume this is a file
				else if (found.value) {
					const file = found.value as Express.Multer.File;
					return {
						name: found.name,
						type: found.type,
						file: {
							original_name: file.originalname,
							encoding: file.encoding,
							mimetype: file.mimetype,
							path: file.path,
							size: file.size
						}
					};
				}
			}
			return undefined;
		}
	}
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });

/**
 * Routes
 */
export function setupRoutes(app: express.Express) {
	// Set up graphql and graphiql routes
	app.use(
		"/graphql",
		bodyParser.json(),
		isAdmin,
		(request, response, next) => {
			graphqlExpress({
				schema,
				context: request
			})(request, response, next);
		}
	);
	app.use(
		"/graphiql",
		authenticateWithRedirect,
		isAdmin,
		graphiqlExpress({
			endpointURL: "/graphql"
		})
	);
}

/**
 * Util and Types
 */
interface IGraphqlFormItem {
	name: string;
	type: string;
	value?: string;
	values?: string[];
	file?: {
		original_name: string;
		encoding: string;
		mimetype: string;
		path: string;
		size: number;
	};
}

interface IGraphqlUser {
	id: string;

	name: string;
	email: string;
	email_verified: boolean;

	applied: boolean;
	accepted: boolean;
	accepted_and_notified: boolean;
	attending: boolean;

	confirmation: {
		type: string;
		data: IFormItem[];
		start_time: string | undefined;
		submit_time: string | undefined;
	} | undefined;

	application: {
		type: string;
		data: IFormItem[];
		start_time: string | undefined;
		submit_time: string | undefined;
	} | undefined;

	team: {
		id: string;
	} | undefined;
}

function userRecordToGraphql(user: IUser): IGraphqlUser {
	return {
		id: user._id.toHexString(),

		name: user.name,
		email: user.email,
		email_verified: !!user.verifiedEmail,

		applied: !!user.applied,
		accepted: !!user.accepted,
		accepted_and_notified: !!user.acceptedEmailSent,
		attending: !!user.attending,

		application: user.applied ? {
			type: user.applicationBranch,
			data: user.applicationData || [],
			start_time: user.applicationStartTime &&
				user.applicationStartTime.toDateString(),
			submit_time: user.applicationSubmitTime &&
				user.applicationSubmitTime.toDateString()
		} : undefined,

		confirmation: user.attending ? {
			type: user.confirmationBranch,
			data: user.confirmationData,
			start_time: user.confirmationStartTime &&
				user.confirmationStartTime.toDateString(),
			submit_time: user.confirmationSubmitTime &&
				user.confirmationSubmitTime.toDateString()
		} : undefined,

		team: user.teamId && {
			id: user.teamId.toHexString()
		}
	};
}
