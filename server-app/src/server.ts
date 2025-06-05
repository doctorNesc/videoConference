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
    path.join(__dirname, "../../client-app/dist/client-app/browser/index.html")
  );
});

const sharedState: SharedState = {
  peers: {},
  rooms: {},
  producers: [],
  consumers: [],
  transports: [],
  // screenProducerTransports: {},
  mainRoomDevices: {},
  remoteAssignments: {},
};

(async () => {
  sharedState.worker = await creatMediasoupWorker();
})();

registerSocketHandlers(io, sharedState);

app.get("/api/roomUsers", (req: Request, res: Response) => {
  const room = req.query.room as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRooms = Object.values(sharedState.peers).reduce((rooms: any, peer: any) => {
    const { roomName, transports, producers, consumers, peerDetails } = peer;
    if (!rooms[roomName]) {
      rooms[roomName] = {
        room: roomName,
        userCount: 0,
        peers: [],
      };
    }
    rooms[roomName].userCount += 1;
    rooms[roomName].peers.push({
      transports,
      producers,
      consumers,
      peerDetails,
      socketId: peer.socket.id,
    });
    return rooms;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, {} as Record<string, any>);

  if (room && allRooms[room]) {
    res.json(Object.values(allRooms[room]));
  } else {
    res.json(Object.values(allRooms));
  }
});