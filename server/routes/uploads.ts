import * as express from "express";

import { isAdmin, STORAGE_ENGINE } from "../common";

export let uploadsRoutes = express.Router();

uploadsRoutes.route("/:file").get(isAdmin, (request, response) => {
	response.attachment(request.params.file);
	STORAGE_ENGINE.readFile(request.params.file).pipe(response);
});
