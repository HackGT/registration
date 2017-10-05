import * as fs from "fs";
import * as path from "path";

import * as bodyParser from "body-parser";
import * as express from "express";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import { makeExecutableSchema } from "graphql-tools";
import { isAdmin, authenticateWithRedirect } from "../../middleware";
import { User, IUser, IFormItem, QuestionBranchConfig } from "../../schema";
import { Branches, Tags, AllTags } from "../../branch";
import { schema as types } from "./api.graphql.types";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "../../../api.graphql"), "utf8");

type Ctx = express.Request;

interface IResolver {
	Query: types.Query<Ctx>;
	User: {
		question: types.GraphqlField<{name: string}, types.FormItem<Ctx> | undefined, Ctx>;
		questions: types.GraphqlField<{names: string[]}, types.FormItem<Ctx>[], Ctx>;
	};
}

/**
 * GraphQL API
 */
const resolvers: IResolver = {
	Query: {
		user: async (prev, args, request) => {
			const id = args.id || (request.user as IUser)._id;
			const user = await User.findById(id);
			return user ? userRecordToGraphql(user) : undefined;
		},
		users: async (prev, args) => {
			const lastIdQuery = args.last_id ? {
				_id: {
					$gt: args.last_id
				}
			} : {};
			const allUsers = await User
				.find({
					...lastIdQuery,
					...userFilterToMongo(args.filter)
				})
				.limit(args.n);

			return allUsers.map(userRecordToGraphql);
		},
		search_user: async (prev, args) => {
			let escapedQuery: string = args.search;
			if (!args.use_regex) {
				escapedQuery = escapedQuery.trim().replace(/[|\\{()[^$+*?.-]/g, "\\$&");
			}
			const queryRegExp = new RegExp(escapedQuery, "i");

			const results = await User
				.find(userFilterToMongo(args.filter))
				.or([
					{
						name: {
							$regex: queryRegExp
						}
					},
					{
						email: {
							$regex: queryRegExp
						}
					}
				])
				.skip(args.offset)
				.limit(args.n)
				.exec();

			return results.map(userRecordToGraphql);
		},
		question_branches: () => {
			return Branches;
		},
		application_branches: async () => {
			const branches = await QuestionBranchConfig.find({
				type: "Application"
			}, {
				name: true
			});
			return branches.map(b => b.name);
		},
		confirmation_branches: async () => {
			const branches = await QuestionBranchConfig.find({
				type: "Confirmation"
			}, {
				name: true
			});
			return branches.map(b => b.name);
		},
		question_names: (prev, args) => {
			if (args.branch) {
				return Tags[args.branch];
			}
			return Array.from(AllTags);
		}
	},
	User: {
		question: async (prev, args) => {
			return (await findQuestions(prev, { names: [args.name] }))[0];
		},
		questions: async (prev, args) => {
			return await findQuestions(prev, args);
		}
	}
};

async function findQuestions(
	target: types.User<express.Request>,
	args: { names: string[] }
): Promise<types.FormItem<Ctx>[]> {
	const user = await User.findById(target.id);
	if (!user) return [];

	const names = new Set(args.names);

	return user.confirmationData.concat(user.applicationData)
		.reduce((results, question) => {
			if (names.has(question.name)) {
				results.push(question);
			}
			return results;
		}, [] as IFormItem[])
		.map(recordToFormItem);
}

export const schema = makeExecutableSchema({
	typeDefs,
	// XXX: The types are javascript equivalent, but unreachable from the graphql-tools library
	resolvers: resolvers as any
});

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

function userFilterToMongo(filter: types.UserFilter | undefined) {
	if (!filter) {
		return {};
	}
	const query: { [name: string]: any } = {};
	const setIf = (key: string, val: any) => val ? query[key] = val : undefined;
	setIf("applied", filter.applied);
	setIf("accepted", filter.accepted);
	setIf("attending", filter.attending);
	setIf("applicationBranch", filter.application_branch);
	setIf("confirmationBranch", filter.confirmation_branch);
	return query;
}

function recordToFormItem(item: IFormItem): types.FormItem<Ctx> {
	if (!item.value) {
		return {
			name: item.name,
			type: item.type
		};
	}
	else if (typeof item.value === "string") {
		return {
			name: item.name,
			type: item.type,
			value: item.value
		};
	}
	else if (item.value instanceof Array) {
		return {
			name: item.name,
			type: item.type,
			values: item.value
		};
	}
	// XXX: assume this is a file
	else {
		const file = item.value as Express.Multer.File;
		return {
			name: item.name,
			type: item.type,
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

function userRecordToGraphql(user: IUser): types.User<Ctx> {
	const application: types.Branch<Ctx> | undefined = user.applied ? {
			type: user.applicationBranch,
			data: user.applicationData.map(recordToFormItem),
			start_time: user.applicationStartTime &&
				user.applicationStartTime.toDateString(),
			submit_time: user.applicationSubmitTime &&
				user.applicationSubmitTime.toDateString()
	} : undefined;

	const confirmation: types.Branch<Ctx> | undefined = user.attending ? {
		type: user.confirmationBranch,
		data: user.confirmationData.map(recordToFormItem),
		start_time: user.confirmationStartTime &&
			user.confirmationStartTime.toDateString(),
		submit_time: user.confirmationSubmitTime &&
			user.confirmationSubmitTime.toDateString()
	} : undefined;

	return {
		id: user._id.toHexString(),

		name: user.name,
		email: user.email,
		email_verified: !!user.verifiedEmail,

		applied: !!user.applied,
		accepted: !!user.accepted,
		accepted_and_notified: !!user.acceptedEmailSent,
		attending: !!user.attending,

		application,
		confirmation,

		// Will be filled in child resolver.
		questions: [],

		team: user.teamId && {
			id: user.teamId.toHexString()
		}
	};
}
