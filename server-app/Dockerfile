FROM node:20-bullseye-slim AS stage-one

# Install DEB dependencies and others.
RUN \
	set -x \
	&& apt-get update \
	&& apt-get install -y net-tools build-essential python3 python3-pip valgrind

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ENV PORT=3000

RUN npm run build

EXPOSE 3000

CMD ["npm","run", "start"]
