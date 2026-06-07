import express, { Request, Response } from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import { registerSocketHandlers } from "./handlers";
import { SharedState, RoomConfig } from "./types";
import { getWebRtcTransportOptionsForWorker } from "./mediasoup/utils";
import path from "path";
import dotenv from 'dotenv';
import { createWorker } from "mediasoup";
import { systemConfig } from "./config/mediasoup.config";
import { RoomManager } from "./core/roomManager";
import { ACTIONS } from "./config/actions";
import multer from "multer";
import * as roomConfigService from "./services/roomConfigService";
import fs from "fs";

dotenv.config();

const app = express();


app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, "../../client-app/dist/client-app/browser")));


const roomManager = new RoomManager();

const httpServer = http.createServer(app);
httpServer.listen(process.env.PORT || 3000, () => {
  console.log("listening on port: " + process.env.PORT);
});

const io = new IOServer(httpServer, {
  cors: { origin: true },
  transports: ['websocket', 'polling']
});


app.get("/api/roomUsers", (req: Request, res: Response): void => {
  const filterRoom = req.query.room as string | undefined;

  
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
app.get("/api/topology", (_req: Request, res: Response): void => {
  res.json(roomManager.getAllTopologies());
});


/** GET /api/rooms — list all room configs */
app.get("/api/rooms", (_req: Request, res: Response): void => {
  try {
    console.log('[API] GET /api/rooms called');
    const configs = roomConfigService.loadAllRoomConfigs();
    console.log('[API] Loaded configs:', configs);
    res.json(configs);
  } catch (err) {
    console.error('[API] Error loading room configs:', err);
    res.status(500).json({ error: 'Failed to load room configs' });
  }
});

/** GET /api/rooms/:name — get a single room config */
app.get("/api/rooms/:name", (req: Request, res: Response): void => {
  try {
    const config = roomConfigService.loadRoomConfig(req.params.name);
    if (!config) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    res.json(config);
  } catch (err) {
    console.error('[API] Error loading room config:', err);
    res.status(500).json({ error: 'Failed to load room config' });
  }
});

/** POST /api/rooms — create a new room config */
app.post("/api/rooms", express.json(), (req: Request, res: Response): void => {
  try {
    const { roomName, splatPath } = req.body;
    if (!roomName) {
      res.status(400).json({ error: 'roomName is required' });
      return;
    }
    const config = roomConfigService.createRoomConfig(roomName, splatPath || '');
    res.status(201).json(config);
  } catch (err) {
    console.error('[API] Error creating room config:', err);
    res.status(500).json({ error: 'Failed to create room config' });
  }
});

/** PUT /api/rooms/:name — update room config (display positions).
 *  Persists to disk, updates the in-memory cache, and pushes the new config
 *  to all connected peers in that room via ROOM_CONFIG_UPDATE — so clients
 *  see the new display layout immediately without reconnecting. */
app.put("/api/rooms/:name", express.json(), (req: Request, res: Response): void => {
  try {
    const config = req.body as RoomConfig;
    if (config.roomName !== req.params.name) {
      res.status(400).json({ error: 'Room name mismatch' });
      return;
    }

    
    roomConfigService.saveRoomConfig(config);

    
    roomManager.setRoomConfig(config.roomName, config);

    
    io.to(config.roomName).emit(ACTIONS.ROOM_CONFIG_UPDATE, config);
    console.log(`[API] Pushed ROOM_CONFIG_UPDATE to room "${config.roomName}"`);

    res.json(config);
  } catch (err) {
    console.error('[API] Error updating room config:', err);
    res.status(500).json({ error: 'Failed to update room config' });
  }
});

/** DELETE /api/rooms/:name — delete a room config */
app.delete("/api/rooms/:name", (req: Request, res: Response): void => {
  try {
    roomConfigService.deleteRoomConfig(req.params.name);
    roomManager.roomConfigs.delete(req.params.name);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Error deleting room config:', err);
    res.status(500).json({ error: 'Failed to delete room config' });
  }
});


const upload = multer({ storage: multer.memoryStorage() });

/** POST /api/rooms/:name/splat — upload splat file */
app.post("/api/rooms/:name/splat", upload.single('splat'), (req: Request, res: Response): void => {
  try {
    console.log('[API] POST /api/rooms/:name/splat called for room:', req.params.name);
    if (!req.file) {
      console.log('[API] No file uploaded');
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const splatPath = roomConfigService.getSplatPath(req.params.name);
    console.log('[API] Writing splat file to:', splatPath);
    fs.writeFileSync(splatPath, req.file.buffer);
    
    
    const config = roomConfigService.loadRoomConfig(req.params.name);
    console.log('[API] Loaded config:', config);
    if (config) {
      config.splatPath = `splats/${req.params.name}.splat`;
      roomConfigService.saveRoomConfig(config);
      roomManager.setRoomConfig(config.roomName, config);
      console.log('[API] Saved config with splat path');
    }
    
    res.json({ success: true, splatPath: config?.splatPath });
  } catch (err) {
    console.error('[API] Error uploading splat file:', err);
    res.status(500).json({ error: 'Failed to upload splat file' });
  }
});

/** GET /api/rooms/:name/splat — serve splat file */
app.get("/api/rooms/:name/splat", (req: Request, res: Response): void => {
  try {
    const splatPath = roomConfigService.getSplatPath(req.params.name);
    if (!fs.existsSync(splatPath)) {
      res.status(404).json({ error: 'Splat file not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.splat"`);
    res.sendFile(splatPath);
  } catch (err) {
    console.error('[API] Error serving splat file:', err);
    res.status(500).json({ error: 'Failed to serve splat file' });
  }
});


/** GET /api/rooms/:name/device-config/:fingerprint — get device pairing config */
app.get("/api/rooms/:name/device-config/:fingerprint", (req: Request, res: Response): void => {
  try {
    const config = roomConfigService.loadDevicePairingConfig(req.params.name, req.params.fingerprint);
    if (!config) {
      res.status(404).json({ error: 'Device pairing config not found' });
      return;
    }
    res.json(config);
  } catch (err) {
    console.error('[API] Error loading device pairing config:', err);
    res.status(500).json({ error: 'Failed to load device pairing config' });
  }
});

/** PUT /api/rooms/:name/device-config/:fingerprint — save device pairing config */
app.put("/api/rooms/:name/device-config/:fingerprint", express.json(), (req: Request, res: Response): void => {
  try {
    const config = req.body;
    config.roomName = req.params.name;
    config.deviceFingerprint = req.params.fingerprint;
    roomConfigService.saveDevicePairingConfig(config);
    res.json(config);
  } catch (err) {
    console.error('[API] Error saving device pairing config:', err);
    res.status(500).json({ error: 'Failed to save device pairing config' });
  }
});

/** DELETE /api/rooms/:name/device-config/:fingerprint — delete device pairing config */
app.delete("/api/rooms/:name/device-config/:fingerprint", (req: Request, res: Response): void => {
  try {
    roomConfigService.deleteDevicePairingConfig(req.params.name, req.params.fingerprint);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Error deleting device pairing config:', err);
    res.status(500).json({ error: 'Failed to delete device pairing config' });
  }
});

app.get("*", (req: Request, res: Response): void => {
  res.sendFile(
    path.join(__dirname, "../../client-app/dist/client-app/browser/index.html")
  );
});


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
      systemConfig.workerSettings
    );
    console.log(`Created worker #${i}, worker pid ${worker.pid}`);

    worker.on(ACTIONS.DIED, () => {
      console.log(
        'mediasoup Worker died, exiting  in 2 seconds... [pid:%d]', worker.pid);
      setTimeout(() => process.exit(1), 2000);
    });

    
    const webRtcServerOptions = getWebRtcTransportOptionsForWorker(i);
    const webRtcServer = await worker.createWebRtcServer(webRtcServerOptions);
    webRtcServer.on("workerclose", () => {
      console.log("worker closed so webRtcServer closed");
    });

    worker.appData.webRtcServer = webRtcServer;

    sharedState.mediasoupWorkers!.push(worker);
  }
}

registerSocketHandlers(io, sharedState, roomManager);
