FROM node:20-bullseye-slim AS stage-one

# Install DEB dependencies and others.
RUN \
	set -x \
	&& apt-get update \
	&& apt-get install -y net-tools build-essential python3 python3-pip valgrind

WORKDIR /app

# Copy server-app and client-app
COPY server-app ./
COPY client-app/ ./client-app

# Build the client-app
WORKDIR /app/client-app
RUN npm install
RUN npm run build

# Build the server-app
WORKDIR /app
RUN npm install
RUN npm run build

ENV PORT=3000

EXPOSE 3000

CMD ["npm","run", "start"]
