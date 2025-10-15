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
  { cors: { origin: ["http://localhost:4200", "http://192.168.1.241:3000"] } }
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

    worker.on(ACTIONS.DIED, () => {
      console.log(
        'mediasoup Worker died, exiting  in 2 seconds... [pid:%d]', worker.pid);
      setTimeout(() => process.exit(1), 2000);
    });

    sharedState.mediasoupWorkers!.push(worker);

    // Create a WebRtcServer in this Worker, assigning different portRanges to each 
    const webRtcServerOptions = getWebRtcTransportOptionsForWorker(i);
    const webRtcServer = await worker.createWebRtcServer(webRtcServerOptions);
    // sharedState.webRtcServers!.push({ workerIndex: i, webRtcServerId: webRtcServer.id });
    webRtcServer.on("workerclose", () => {
      console.log("worker closed so webRtcServer closed");
    });

    worker.appData.webRtcServer = webRtcServer;

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

