import express, { Request, Response } from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import { registerSocketHandlers } from "./handlers";
import { SharedState } from "./types";
import { creatMediasoupWorker } from "./mediasoup/utils";
import path from "path";
import dotenv from 'dotenv';

const app = express();
dotenv.config();

const httpServer = http.createServer(app);
httpServer.listen(process.env.PORT, () => {
    console.log("listening on port: " + process.env.PORT);
});

const io = new IOServer(httpServer,
    { cors: { origin: "http://localhost:4200" } }
);
// const connections = io.of("/mediasoup");

app.get("/", (req: Request, res: Response) => {
  res.sendFile(
    path.join(__dirname, "../client-app/dist/client-app/browser/index.html")
  );
});

const sharedState: SharedState = {
    peers: {},
    rooms: {},
    producers: [],
    consumers: [],
    transports: [],
    screenProducerTransports: {},
};

(async () => {
    sharedState.worker = await creatMediasoupWorker();
})();

registerSocketHandlers(io, sharedState);

