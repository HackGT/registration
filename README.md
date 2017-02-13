# registration
*Still very much a work in progress*

## Building and running

First, make sure that you have a MongoDB server up and running.

Then, to build and run the server:

	npm install # Install dependencies
	npm install -g typescript # Install TypeScript
	npm run build # Builds question type definitions for TypeScript from the questions schema and compiles
	npm start # Run server (check the logs for the port and default user information)