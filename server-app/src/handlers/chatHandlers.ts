import { Socket } from "socket.io";
import { SharedState } from "../types";

export function registerChatHandlers(socket: Socket, state: SharedState) {
  socket.on("sendMessage", ({ roomName, message }) => {
    if (!roomName || !state.peers[socket.id]) return;

    const senderName = state.peers[socket.id].peerDetails.name || "Unknown";

    for (const peer of Object.values(state.peers)) {
      if (peer.roomName === roomName && peer.socket.id != socket.id) {
        peer.socket.emit("receiveMessage", {
          sender: senderName,
          message,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

}