import { Server, Namespace } from "socket.io";
import { registerRoomHandlers } from "./roomHandlers";
import { SharedState } from "../types";
import { registerTransportHandlers } from "./transportHandlers";
import { registerConsumerHandlers } from "./consumerHandlers";
import { registerProducerHandlers } from "./producerHandlers";
import { registerChatHandlers } from "./chatHandlers";
import { registerHybridHandlers } from "./hybridHandlers";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";

export function registerSocketHandlers(io: Server, state: SharedState, roomManager: RoomManager) {
  // Capture the namespace once — all handlers that need to broadcast use this
  const nsp: Namespace = io.of("/mediasoup");

  nsp.on("connection", (socket) => {

    socket.emit(ACTIONS.CONNECTION_SUCCESS, {
      socketId: socket.id,
    });

    // Pass the namespace to handlers that need to broadcast to rooms or
    // target specific sockets (hybrid and room handlers)
    registerRoomHandlers(socket, state, roomManager, nsp);
    registerHybridHandlers(socket, nsp, roomManager);

    // Transport handler also needs namespace for hybrid disconnect cleanup
    registerTransportHandlers(socket, state, roomManager, nsp);
    registerProducerHandlers(socket, state, roomManager);
    registerConsumerHandlers(socket, state, roomManager);
    registerChatHandlers(socket, state);
  });
}
