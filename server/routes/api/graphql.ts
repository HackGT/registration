import * as fs from "fs";
import * as path from "path";

import { makeExecutableSchema } from "graphql-tools";
import { PubSub } from "graphql-subscriptions";

const typeDefs = fs.readFileSync(path.resolve(__dirname, "./api.graphql"), "utf8");

const pubsub = new PubSub();

const resolvers = {
	Query: {
		healthy: () => {
			return "I'm healthy!";
		}
	},
	Subscription: {
		ping: {
			subscribe: () => {
				return pubsub.asyncIterator("ping");
			}
		}
	}
};

// Simulate publishing data
let counter = 0;
setInterval(() => {
	counter += 1;
	pubsub.publish("ping", {
		ping: "pong: " + counter.toString()
	});
}, 1000);

export const schema = makeExecutableSchema({ typeDefs, resolvers });
