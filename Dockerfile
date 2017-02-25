FROM node:alpine
MAINTAINER Ryan Petschek <petschekr@gmail.com>

# Deis wants bash
RUN apk update && apk add bash

# Bundle app source
WORKDIR /usr/src/checkin
COPY . /usr/src/checkin
RUN npm install
RUN npm run build

# Deis wants EXPOSE and CMD
EXPOSE 3000
CMD ["npm", "start"]
