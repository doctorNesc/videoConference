import { Server, Namespace } from "socket.io";
import { registerRoomHandlers } from "./roomHandlers";
import { SharedState } from "../types";
import { registerTransportHandlers } from "./transportHandlers";
import { registerConsumerHandlers } from "./consumerHandlers";
import { registerProducerHandlers } from "./producerHandlers";
import { registerDataChannelHandlers } from "./dataChannelHandlers";
import { registerHybridHandlers } from "./hybridHandlers";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";

export function registerSocketHandlers(io: Server, state: SharedState, roomManager: RoomManager) {
  
  const nsp: Namespace = io.of("/mediasoup");

  nsp.on("connection", (socket) => {

    socket.emit(ACTIONS.CONNECTION_SUCCESS, {
      socketId: socket.id,
    });

    
    registerRoomHandlers(socket, state, roomManager, nsp);
    registerHybridHandlers(socket, nsp, roomManager);

    
    registerTransportHandlers(socket, state, roomManager, nsp);
    registerProducerHandlers(socket, state, roomManager);
    registerConsumerHandlers(socket, state, roomManager);

    
    registerDataChannelHandlers(socket, nsp, roomManager);
  });
}
