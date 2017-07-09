import * as express from "express";
import * as path from "path";

import { isAdmin, UPLOAD_ROOT } from "../common";

export let uploadsRoutes = express.Router();

uploadsRoutes.route("/:file").get(isAdmin, (request, response) => {
	response.sendFile(path.resolve(UPLOAD_ROOT, request.params.file), {
		"headers": {
			"Content-Disposition": `attachment; filename="${request.params.file}"`
		}
	});
});
