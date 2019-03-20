import * as fs from "fs";
import * as path from "path";

import * as bodyParser from "body-parser";
import * as express from "express";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import { makeExecutableSchema } from "graphql-tools";
import { isAdmin, authenticateWithRedirect } from "../../middleware";
import { User, IUser, Team, IFormItem, QuestionBranchConfig } from "../../schema";
import { Branches, Tags, AllTags, BranchConfig, ApplicationBranch, ConfirmationBranch, NoopBranch } from "../../branch";
import { schema as types } from "./api.graphql.types";
import { formatSize } from "../../common";

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
			const id = args.id || (request.user as IUser).uuid;
			const user = await User.findOne({uuid: id});
			return user ? userRecordToGraphql(user) : undefined;
		},
		users: async (prev, args) => {
			const lastIdQuery = args.pagination_token ? {
				_id: {
					$gt: args.pagination_token
				}
			} : {};
			const uuidQuery = args.ids ? {
				uuid: {
					$in: args.ids
				}
			} : {};
			const allUsers = await User
				.find({
					...lastIdQuery,
					...uuidQuery,
					...userFilterToMongo(args.filter)
				})
				.limit(args.n);

			return Promise.all(allUsers.map(userRecordToGraphql));
		},
		search_user: searchUser,
		search_user_simple: async (prev, args) => {
			return (await searchUser(prev, args)).users;
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
			return findQuestions(prev, args);
		}
	}
};

async function searchUser(prev: any, args: {
	search: string;
	use_regex: boolean;
	offset: number;
	n: number;
	filter: types.UserFilter;
}) {
	let escapedQuery: string = args.search;
	if (!args.use_regex) {
		escapedQuery = escapedQuery.trim().replace(/[|\\{()[^$+*?.-]/g, "\\$&");
	}
	const queryRegExp = new RegExp(escapedQuery, "i");
	const query = [
		{
			name: {
				$regex: queryRegExp
			}
		},
		{
			email: {
				$regex: queryRegExp
			}
		},
		{
			uuid: args.search
		}
	];
	const total = await User.find(userFilterToMongo(args.filter))
		.or(query)
		.count();
	const results = await User
		.find(userFilterToMongo(args.filter))
		.or(query)
		.collation({ "locale": "en" }).sort({ name: "asc" })
		.skip(args.offset)
		.limit(args.n)
		.exec();

	return {
		offset: args.offset,
		count: results.length,
		total,
		users: await Promise.all(results.map(userRecordToGraphql))
	};
}

async function findQuestions(
	target: types.User<express.Request>,
	args: { names: string[] }
): Promise<types.FormItem<Ctx>[]> {
	const user = await User.findOne({uuid: target.id});
	if (!user) {
		return [];
	}

	const names = new Set(args.names);

	function questionFilter(results: IFormItem[], question: IFormItem): IFormItem[] {
		if (names.has(question.name)) {
			results.push(question);
		}
		return results;
	}

	let items: types.FormItem<Ctx>[] = [];
	if (user.applied) {
		items = items.concat(await Promise.all(user.applicationData!
			.reduce(questionFilter, [])
			.map(item => recordToFormItem(item, user.applicationBranch!))
		));
	}
	if (user.confirmed) {
		items = items.concat(await Promise.all(user.confirmationData!
			.reduce(questionFilter, [])
			.map(item => recordToFormItem(item, user.confirmationBranch!))
		));
	}
	return items;
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

	function setIf(key: string, val: any): void {
		if (val !== null && val !== undefined) {
			query[key] = val;
		}
	}
	setIf("applied", filter.applied);
	setIf("accepted", filter.accepted);
	setIf("confirmed", filter.confirmed);
	setIf("applicationBranch", filter.application_branch);
	setIf("confirmationBranch", filter.confirmation_branch);
	return query;
}

let cachedBranches: {
	[name: string]: NoopBranch | ApplicationBranch | ConfirmationBranch;
} = {};
async function recordToFormItem(item: IFormItem, branchName: string): Promise<types.FormItem<Ctx>> {
	if (!cachedBranches[branchName]) {
		cachedBranches[branchName] = await BranchConfig.loadBranchFromDB(branchName);
	}
	let label: string = cachedBranches[branchName].questionLabels[item.name] || item.name;

	if (!item.value) {
		return {
			name: item.name,
			label,
			type: item.type
		};
	}
	else if (typeof item.value === "string") {
		return {
			name: item.name,
			label,
			type: item.type,
			value: item.value
		};
	}
	else if (item.value instanceof Array) {
		return {
			name: item.name,
			label,
			type: item.type,
			values: item.value
		};
	}
	// XXX: assume this is a file
	else {
		const file = item.value as Express.Multer.File;
		return {
			name: item.name,
			label,
			type: item.type,
			file: {
				original_name: file.originalname,
				encoding: file.encoding,
				mimetype: file.mimetype,
				path: file.path,
				size: file.size,
				size_formatted: formatSize(file.size)
			}
		};
	}
}

async function userRecordToGraphql(user: IUser): Promise<types.User<Ctx>> {
	const application: types.Branch<Ctx> | undefined = user.applied ? {
			type: user.applicationBranch!,
			data: await Promise.all(user.applicationData!.map(item => recordToFormItem(item, user.applicationBranch!))),
			start_time: user.applicationStartTime &&
				user.applicationStartTime.toDateString(),
			submit_time: user.applicationSubmitTime &&
				user.applicationSubmitTime.toDateString()
	} : undefined;

	const confirmation: types.Branch<Ctx> | undefined = user.confirmed ? {
		type: user.confirmationBranch!,
		data: await Promise.all(user.confirmationData!.map(item => recordToFormItem(item, user.confirmationBranch!))),
		start_time: user.confirmationStartTime &&
			user.confirmationStartTime.toDateString(),
		submit_time: user.confirmationSubmitTime &&
			user.confirmationSubmitTime.toDateString()
	} : undefined;

	let team = user.teamId ? await Team.findById(user.teamId) : null;

	return {
		id: user.uuid,

		name: user.name || "",
		email: user.email,
		admin: !!user.admin,

		applied: !!user.applied,
		accepted: !!user.accepted,
		accepted_and_notified: !!user.preConfirmEmailSent,
		confirmed: !!user.confirmed,
		confirmationBranch: user.confirmationBranch,

		application,
		confirmation,

		// Will be filled in child resolver.
		questions: [],
		team: user.teamId && {
			id: user.teamId.toHexString(),
			name: team ? team.teamName : "(Missing team)"
		},

		pagination_token: user._id.toHexString()
	};
}
