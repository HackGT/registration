import * as express from "express";

import { STORAGE_ENGINE } from "../common";
import { isAdmin } from "../middleware";

export let uploadsRoutes = express.Router();

uploadsRoutes.route("/:file").get(isAdmin, async (request, response) => {
	try {
		let stream = await STORAGE_ENGINE.readFile(request.params.file);
		response.attachment(request.params.file);
		stream.pipe(response);
	}
	catch {
		response.status(404).send("The requested file could not be found");
	}
});
