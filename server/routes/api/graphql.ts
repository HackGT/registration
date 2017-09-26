import * as fs from "fs";
import * as path from "path";

import * as bodyParser from "body-parser";
import * as express from "express";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import { makeExecutableSchema } from "graphql-tools";
import { isAdmin, authenticateWithRedirect } from "../../middleware";
import { User, IUser, IFormItem } from "../../schema";
import { Branches, Tags, AllTags } from "../../branch";
import { schema as types } from "./api.graphql.types";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "../../../api.graphql"), "utf8");

type Ctx = express.Request;

interface IResolver {
	Query: types.Query<Ctx>;
	User: {
		question: types.GraphqlField<{name: string}, types.FormItem<Ctx> | undefined, Ctx>;
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
		search_user: async (prev, args) => {
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
		question_names: (prev, args) => {
			if (args.branch) {
				return Tags[args.branch];
			}
			return Array.from(AllTags);
		}
	},
	User: {
		question: async (prev, args) => {
			prev = prev as types.User<express.Request>;
			const user = await User.findById(prev.id);
			if (!user) return undefined;

			const found = user.confirmationData.concat(user.applicationData).find(question => {
				return question.name === args.name;
			});

			if (found) {
				return recordToFormItem(found);
			}
			return undefined;
		}
	}
};

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

function recordToFormItem(item: IFormItem): types.FormItem<Ctx> {
	if (typeof item.value === "string") {
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

		team: user.teamId && {
			id: user.teamId.toHexString()
		}
	};
}
