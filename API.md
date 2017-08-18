# APIs

## Current REST API

### `user.ts`
All routes mounted under `/api/user/:id`

- POST `/application/:branch`
	- Submits or edits if already submitted the requested application branch
		- *Note:* should actually be HTTP PUT
- DELETE `/application/:branch`
	- Deletes previously submitted application branch
- POST `/confirmation/:branch`
	- Identical to POST `/application/:branch` but for confirmation branches
		- *Note:* should also actually be HTTP PUT
- DELETE `/confirmation/:branch`
	- Identical to DELETE `/application/:branch` but for confirmation branches
- POST `/status` (**admin only**)
	- Sets user's accepted status to `true` or `false`
- POST `/send_acceptances` (**admin only**, ignores `id` param)
	- Sends accepted notification emails to users who have been accepted and not yet notified
- GET `/export` (**admin only**, ignores `id` param, requires update post-HackGT Catalyst)
	- Downloads .zip file containing `.csv` files of current user data
- POST `/team/create/:teamName`
	- Creates a team with the specified name and places the user into it`
- POST `/team/join/:teamName`
	- Adds the user to the specified team
- POST `/team/leave`
	- Removes the user from any team they are on
- POST `/team/rename/:newTeamName`
	- Renames the team that the user is currently on if they are the team's leader

### `settings.ts`
All routes mounted under `/api/settings`

- GET `/application_availability`
	- Gets the current application and confirmation open and close times
- PUT `/application_availability` (**admin only**)
	- Sets the current application and confirmation open and close times
- GET `/teams_enabled`
	- Gets a boolean value representing whether teams are enabled
- PUT `/teams_enabled` (**admin only**)
	- Sets the boolean value representing whether teams are enabled
- GET `/branch_roles` (**admin only**)
	- Returns the question branches from `questions.json` sorted into the categories `noop`, `applicationBranches`, and `confirmationBranches`.
- PUT `/branch_roles` (**admin only**)
	- Sets the role of the question branches from `questions.json` as one of `noop`, `application`, or `confirmation`.
- GET `/email_content/:type` (**admin only**)
	- Returns the Markdown content of the email type specified
- PUT `/email_content/:type` (**admin only**)
	- Sets the Markdown content of the email type specified
- POST `/email_content/:type/rendered` (**admin only**)
	- Returns rendered HTML and text from Markdown input using the same Markdown engine used for generating emails
		- Used for live preview of rendered Markdown in admin panel
