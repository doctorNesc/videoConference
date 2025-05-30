import { Server, Socket } from "socket.io";
import { registerRoomHandlers } from "./roomHandlers";
import { SharedState } from "../types";

export function registerSocketHandlers(io: Server, state: SharedState) {
  io.of("/mediasoup").on("connection", (socket: Socket) => {
    registerRoomHandlers(socket, state);
    // Register other handlers here
  });
}