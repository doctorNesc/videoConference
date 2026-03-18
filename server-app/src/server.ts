import express, { Request, Response } from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import { registerSocketHandlers } from "./handlers";
import { SharedState } from "./types";
import { getWebRtcTransportOptionsForWorker } from "./mediasoup/utils";
import path from "path";
import dotenv from 'dotenv';
import { createWorker } from "mediasoup";
import { systemConfig } from "./config/mediasoup.config";
import { RoomManager } from "./core/roomManager";
import { ACTIONS } from "./config/actions";


dotenv.config();

const app = express();
app.use(express.static(path.join(__dirname, "../../client-app/dist/client-app/browser")));
// app.use(cors({
//   origin: ["http://192.168.1.241:3000"],
//   methods: ["GET", "POST"]
// }));

// app.use("/api", roomRoutes);

app.get("/api/roomUsers", (req: Request, res: Response) => {
  const filterRoom = req.query.room as string | undefined;

  // Build room list from RoomManager (new architecture)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRooms: any[] = [];

  roomManager.rooms.forEach((room, roomName) => {
    if (filterRoom && roomName !== filterRoom) return;

    const peers = room.getAllPeers().map(peer => ({
      socketId: peer.socket.id,
      name: peer.userName,
      isRoomDevice: peer.isRoomDevice,
      transports: [
        peer.sendTransport?.id,
        peer.recvTransport?.id,
      ].filter(Boolean),
      producers: Array.from(peer.producers.keys()),
      consumers: Array.from(peer.consumers.keys()),
      capabilities: peer.capabilities ?? null,
      peerDetails: {
        name: peer.userName,
        isAdmin: peer.isAdmin,
        isMainRoom: peer.isRoomDevice,
      },
    }));

    allRooms.push({
      room: roomName,
      userCount: peers.length,
      peers,
    });
  });

  if (filterRoom) {
    res.json(allRooms[0] ? [allRooms[0]] : []);
  } else {
    res.json(allRooms);
  }
});

/** REST endpoint: returns the hybrid topology for all rooms */
app.get("/api/topology", (_req: Request, res: Response) => {
  res.json(roomManager.getAllTopologies());
});

app.get("*", (req: Request, res: Response) => {
  res.sendFile(
    path.join(__dirname, "../../client-app/dist/client-app/browser/index.html")
  );
});

const httpServer = http.createServer(app);
httpServer.listen(process.env.PORT || 3000, () => {
  console.log("listening on port: " + process.env.PORT);
});

const io = new IOServer(httpServer,
  { cors: { origin: true } }
);
// const connections = io.of("/mediasoup");


export const sharedState: SharedState = {
  peers: {},
  rooms: {},
  producers: [],
  consumers: [],
  transports: [],
  mainRoomDevices: {},
  remoteAssignments: {},
  mediasoupWorkers: [],
  webRtcServers: [],
};

(async () => {
  await runMediasoupWorkers();
})();

async function runMediasoupWorkers() {
  const { numWorkers } = systemConfig;

  for (let i = 0; i < numWorkers; ++i) {
    const worker = await createWorker(
      // {
      // 	dtlsCertificateFile : config.mediasoup.workerSettings.dtlsCertificateFile,
      // 	dtlsPrivateKeyFile  : config.mediasoup.workerSettings.dtlsPrivateKeyFile,
      // 	logLevel            : config.mediasoup.workerSettings.logLevel,
      // 	logTags             : config.mediasoup.workerSettings.logTags,
      // 	rtcMinPort          : Number(config.mediasoup.workerSettings.rtcMinPort),
      // 	rtcMaxPort          : Number(config.mediasoup.workerSettings.rtcMaxPort),
      // 	disableLiburing     : Boolean(config.mediasoup.workerSettings.disableLiburing)
      // }
      systemConfig.workerSettings
    );
    console.log(`Created worker #${i}, worker pid ${worker.pid}`);

    worker.on(ACTIONS.DIED, () => {
      console.log(
        'mediasoup Worker died, exiting  in 2 seconds... [pid:%d]', worker.pid);
      setTimeout(() => process.exit(1), 2000);
    });

    // Create a WebRtcServer in this Worker, assigning different portRanges to each 
    const webRtcServerOptions = getWebRtcTransportOptionsForWorker(i);
    const webRtcServer = await worker.createWebRtcServer(webRtcServerOptions);
    webRtcServer.on("workerclose", () => {
      console.log("worker closed so webRtcServer closed");
    });

    worker.appData.webRtcServer = webRtcServer;

    sharedState.mediasoupWorkers!.push(worker);

    // Log worker resource usage every X seconds.
    // setInterval(async () => {
    //   const usage = await worker.getResourceUsage();

    //   console.log('mediasoup Worker resource usage [pid:%d]: %o', worker.pid, usage);

    //   const dump = await worker.dump();

    //   console.log('mediasoup Worker dump [pid:%d]: %o', worker.pid, dump);
    // }, 100000);
  }
}
const roomManager = new RoomManager(); //single instance for dependency injection

registerSocketHandlers(io, sharedState, roomManager);

