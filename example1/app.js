import express from "express";
const app = express();

import https from "httpolyglot";
import fs from "fs";
import path from "path";
const __dirname = path.resolve();

import { Server } from "socket.io";
import mediasoup from "mediasoup";

app.get("/", (req, res) => {
  res.send("Hello from mediasoup app!");
});

app.use("/sfu", express.static(path.join(__dirname, "public")));

const options = {
  key: fs.readFileSync("./server/ssl/key.pem", "utf-8"),
  cert: fs.readFileSync("./server/ssl/cert.pem", "utf-8"),
};
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

const httpsServer = https.createServer(options, app);
httpsServer.listen(3000, () => {
  console.log("listening on port " + 3000);
});

const io = new Server(httpsServer);

const peers = io.of("/mediasoup");

let worker;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log("worker.pid ", worker.pid);

  worker.on("died", (error) => {
    console.log("worker died");
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
};

worker = createWorker();

peers.on("connection", async (socket) => {
  console.log(socket.id);
  socket.emit("connection-success", {
    socketId: socket.id,
  });

  socket.on("disconnect", () => {
    //TODO cleanup
    console.log("socket disconnected");
  });

  socket.on('getRtpCapabilities', (callback) => {

    const rtpCapabilities = router.rtpCapabilities

    console.log('rtp Capabilities', rtpCapabilities)

    // call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities })
  })
  let router = await worker.createRouter({ mediaCodecs });
});

