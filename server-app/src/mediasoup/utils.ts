

import { Router, WebRtcServer, WebRtcServerOptions, WebRtcTransport, } from "mediasoup/node/lib/types";
import { RoomManager } from "../core/roomManager";

export const getWebRtcTransportOptionsForWorker = (workerIndex: number): WebRtcServerOptions => {
  const basePort = 40000 + workerIndex * 500;
  const portRange = { min: basePort, max: basePort + 499 };
  return {
    listenInfos: [
      {
        portRange,
        protocol: "udp",
        ip: "0.0.0.0",
        announcedIp: process.env.ANNOUNCED_IP || "127.0.0.1"
      },
      {
        portRange,
        protocol: "tcp",
        ip: "0.0.0.0",
        announcedIp: process.env.ANNOUNCED_IP || "127.0.0.1"
      }
    ],
    
    
  };
}

export const createWebRtcTransport = async (
  router: Router,
  rtcServer: WebRtcServer
): Promise<WebRtcTransport> => {
  const transport = await router.createWebRtcTransport({
    webRtcServer: rtcServer,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    enableSctp: true,
    numSctpStreams: { OS: 1024, MIS: 1024 },
  });

  transport.on("dtlsstatechange", (dtlsState) => {
    if (dtlsState === "closed") {
      transport.close();
    }
  });

  
  return transport;
};

export function leaveRoom(roomManager: RoomManager, roomName: string, socketId: string) {
  try {
    const room = roomManager.getRoom(roomName);
    const peer = room.getPeer(socketId);

    if (peer) {
      const userCount = room.removePeer(socketId);
      roomManager.socketToRoom.delete(socketId);

      if (!userCount) {
        roomManager.deleteRoom(roomName);
      }
    }
  } catch (err) {
    
    console.warn(`[leaveRoom] Error cleaning up ${socketId} from ${roomName}:`, err);
    
    roomManager.socketToRoom.delete(socketId);
  }
}
