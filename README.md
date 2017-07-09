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
PRODUCTION | Set to `true` to set OAuth callbacks to production URLs (default: `false`)
PORT | The port the check in system should run on (default: `3000`)
MONGO_URL | The URL to the MongoDB server (default: `mongodb://localhost/`)
UNIQUE_APP_ID | The MongoDB database name to store data in (default: `registration`)
VERSION_HASH | The Git short hash used to identify the current commit (default: parsed automatically from the `.git` folder, if it exists)
*SOURCE_VERSION* | Same as `VERSION_HASH` but overrides it if present. Used by Deis.
*WORKFLOW_RELEASE_CREATED_AT* | Provided by Deis (default: `null`)
*WORKFLOW_RELEASE_SUMMARY* | Provided by Deis (default: `null`)
COOKIE_MAX_AGE | The `maxAge` of cookies set in milliseconds (default: 6 months) **NOTE: this is different from the session TTL**
COOKIE_SECURE_ONLY | Whether session cookies should sent exclusively over secure connections (default: `false`)
SESSION_SECRET | The secret used to sign and validate session cookies (default: random 32 bytes regenerated on every start up)
GITHUB_CLIENT_ID | OAuth client ID for GitHub *required*
GITHUB_CLIENT_SECRET | OAuth client secret for GitHub *required*
GOOGLE_CLIENT_ID | OAuth client ID for Google *required*
GOOGLE_CLIENT_SECRET | OAuth client secret for Google *required*
FACEBOOK_CLIENT_ID | OAuth client ID for Facebook *required*
FACEBOOK_CLIENT_SECRET | OAuth client secret for Facebook *required*
EMAIL_FROM | The `From` header for sent emails (default: `HackGT Team <hello@hackgt.com>`)
EMAIL_HOST | The SMTP email server's hostname (default: *none*)
EMAIL_PORT | The SMTP email server's port (default: `465`)
EMAIL_USERNAME | The username for the SMTP email server (default: *none*)
EMAIL_PASSWORD | The password for the SMTP email server (default: *none*)
ADMIN_EMAILS | A JSON array of the emails of the users that you want promoted to admin status when they create their account (default: none)
EVENT_NAME | The current event's name which affects rendered templates and sent emails (default: `Untitled Event`)
UPLOAD_DIRECTORY | Directory relative to the app's root in which uploads will be stored. Can be absolute and will be created if it doesn't exist. (default: `uploads`)
MAX_TEAM_SIZE | The maximum number of users allowed per team (default: `4`)
