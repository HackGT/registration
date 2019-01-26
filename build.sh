#!/usr/bin/env bash
SOURCE_DIR=$(readlink -f "${BASH_SOURCE[0]}")
cd "$(dirname "$SOURCE_DIR")" || exit
set -xeuo pipefail

node node_modules/json-schema-to-typescript/dist/src/cli.js \
     server/config/questions.schema.json \
     > server/config/questions.schema.d.ts

./node_modules/.bin/graphql-typewriter -i ./api.graphql
mv ./api.graphql.types.ts ./server/routes/api/

./node_modules/tslint/bin/tslint -p server/
./node_modules/tslint/bin/tslint -p client/
./node_modules/typescript/bin/tsc -b
