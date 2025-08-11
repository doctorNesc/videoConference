FROM node:22
 
# Install mediasoup native build dependencies
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  libssl-dev \
  libusrsctp-dev \
  libsrtp2-dev \
  pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .


RUN npm run build

EXPOSE 3000

CMD ["npm","run", "start"]
