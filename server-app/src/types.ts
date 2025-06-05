import { Socket } from "socket.io";
import { Router } from "mediasoup/node/lib/Router";
import { Consumer, Producer, WebRtcTransport, Worker } from "mediasoup/node/lib/types";
interface PeerData {
  socket: Socket;
  roomName: string;
  transports: string[];
  producers: string[];
  consumers: string[];
  peerDetails: { name: string; isAdmin: boolean, isMainRoom: boolean };
}

export interface SharedState {
  rooms: Record<string, { router: Router; peers: string[] }>;
  peers: Record<string, PeerData>;
  transports: {
    socketId: string;
    transport: WebRtcTransport;
    roomname: string;
    isConsumer: boolean;
    isScreen: boolean;
  }[];
  producers: { socketId: string; roomName: string; producer: Producer, mediaType: MediaType }[];
  consumers: { socketId: string; roomName: string; consumer: Consumer }[];
  // screenProducerTransports: Record<string, { socketId: string; transport: WebRtcTransport | undefined }>;
  mainRoomDevices: { [roomName: string]: string[] }; // roomName -> [socketId, ...]
  remoteAssignments: { [roomName: string]: { [remoteSocketId: string]: string } }; // remoteSocketId -> mainRoomSocketId
  worker?: Worker;
  }

  export type MediaType = "camera" | "screen";
