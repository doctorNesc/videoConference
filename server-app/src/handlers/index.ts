import { Server, Socket } from "socket.io";
import { registerRoomHandlers } from "./roomHandlers";
import { SharedState } from "../types";
import { registerTransportHandlers } from "./transportHandlers";
import { registerConsumerHandlers } from "./consumerHandlers";
import { registerProducerHandlers } from "./producerHandlers";
import { registerChatHandlers } from "./chatHandlers";
import { RoomManager } from "../core/roomManager";

export function registerSocketHandlers(io: Server, state: SharedState, roomManager: RoomManager ) {
  io.of("/mediasoup").on("connection", (socket: Socket) => {
    
    socket.emit("connection-success", {
      socketId: socket.id,
    });

    registerRoomHandlers(socket, state,roomManager);
    registerTransportHandlers(socket, state, roomManager);
    registerProducerHandlers(socket, state, roomManager);
    registerConsumerHandlers(socket, state, roomManager);
    registerChatHandlers(socket, state);
  });
}