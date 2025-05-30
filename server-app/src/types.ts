import { Socket } from "socket.io";
import { Router } from "mediasoup/node/lib/Router";
import { Worker } from "mediasoup/node/lib/types";

export interface SharedState {
  peers: {
    [socketId: string]: {
      socket: Socket;
      roomName: string;
      peerDetails: { name: string };
    };
  };
  rooms: {
    [roomName: string]: {
      router: Router;
      peers: string[];
    };
  };
  worker: Worker; // mediasoup Worker
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mediaCodecs: any; // mediasoup media codecs
  // ...other shared state
}