import * as fs from "fs";
import * as path from "path";

import * as bodyParser from "body-parser";
import * as express from "express";
import { graphqlExpress, graphiqlExpress } from "graphql-server-express";
import { makeExecutableSchema } from "graphql-tools";
import { authenticateWithCustomRedirect } from "../../middleware";
import { User, IUser, IFormItem } from "../../schema";
import { Branches, Tags, AllTags } from "../../branch";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "./api.graphql"), "utf8");

/**
 * GraphQL API
 */
const resolvers = {
	Query: {
		user: async (
			prev: undefined,
			// TODO: replace `id` with `id?`
			args: { id: string }
		): Promise<IGraphqlUser | undefined> => {
			const user = await User.findById(args.id);
			return user? userRecordToGraphql(user) : undefined;
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

/**
 * Routes
 */
export function setupRoutes(app: express.Express) {
	// Set up graphql and graphiql routes
	app.use(
		"/graphql",
		bodyParser.json(),
		// TODO: auth without redirect here & pass along userid
		graphqlExpress({
			schema
		})
	);
	app.use(
		"/graphiql",
		authenticateWithCustomRedirect("/graphiql"),
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
