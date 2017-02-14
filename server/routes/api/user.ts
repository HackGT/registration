import * as express from "express";

import {
    postParser, uploadHandler,
	authenticateWithReject
} from "../../common";
import {
	IUser, IUserMongoose, User,
} from "../../schema";
import {Questions} from "../../config/questions.schema";

export let userRoutes = express.Router();

userRoutes.post("/application", authenticateWithReject, postParser, uploadHandler.any(), (request, response) => {
    response.status(501).send("Not implemented");
});