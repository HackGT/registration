import * as express from "express";

import { STORAGE_ENGINE } from "../common";
import { isAdmin } from "../middleware";

export let uploadsRoutes = express.Router();

uploadsRoutes.route("/:file").get(isAdmin, (request, response) => {
	response.attachment(request.params.file);
	try {
		STORAGE_ENGINE.readFile(request.params.file).pipe(response);
	}
	catch {
		response.status(404).send("The requested file could not be found");
	}
});
