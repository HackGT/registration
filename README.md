# registration
*Still very much a work in progress*

## Building and running

First, make sure that you have a MongoDB server up and running.

Then, to build and run the server:

	npm install # Install dependencies
	npm run build # Build question type definitions for TypeScript from the questions schema and compile
	npm start # Run server (check the logs for the port and default user information)

## Deployment

Configuration should normally be done by editing the `config.json` file. Environment variables take precedence over `config.json` and should be used when those options need to be overridden or `config.json` can't be used for some reason (e.g. certain deployment scenarios).

Environment Variable | Description
---------------------|------------
PORT | The port the check in system should run on (default: `3000`)
MONGO_URL | The URL to the MongoDB server (default: `mongodb://localhost/`)
UNIQUE_APP_ID | The MongoDB database name to store data in (default: `registration`)
VERSION_HASH | The Git short hash used to identify the current commit (default: parsed automatically from the `.git` folder)
PRODUCTION | Set to `true` to set OAuth callbacks to production URLs (default: `false`)
BASE_URL | The base URL (with no path) to use for OAuth callbacks (default: `https://registration.hack.gt` in production, `http://localhost:${PORT}` in development)
SESSION_SECRET | The secret used to sign and validate session cookies (default: random 32 bytes regenerated on every start up)
GITHUB_CLIENT_ID | OAuth client ID for GitHub *required*
GITHUB_CLIENT_SECRET | OAuth client secret for GitHub *required*
GOOGLE_CLIENT_ID | OAuth client ID for Google *required*
GOOGLE_CLIENT_SECRET | OAuth client secret for Google *required*
FACEBOOK_CLIENT_ID | OAuth client ID for Facebook *required*
FACEBOOK_CLIENT_SECRET | OAuth client secret for Facebook *required*
