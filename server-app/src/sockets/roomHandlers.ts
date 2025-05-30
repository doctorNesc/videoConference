import { Socket } from "socket.io";
// import { Server } from "socket.io";
import { SharedState } from "../types"; // Define your shared state interface

export function registerRoomHandlers(socket: Socket, state: SharedState) {
  // Join Room
  socket.on("joinRoom", async ({ roomName }, callback) => {
    if (!roomName) {
      callback({ error: "Room name is required" });
      return;
    }

    // Create room if it doesn't exist
    if (!state.rooms[roomName]) {
      // You may want to create a Mediasoup router here
      state.rooms[roomName] = {
        router: await state.worker.createRouter({ mediaCodecs: state.mediaCodecs }),
        peers: [],
      };
    }

    // Add peer to room
    state.rooms[roomName].peers.push(socket.id);
    state.peers[socket.id] = {
      socket,
      roomName,
      peerDetails: { name: "" }, // Fill in as needed
    };

    // Return router RTP capabilities to client
    callback({
      rtpCapabilities: state.rooms[roomName].router.rtpCapabilities,
    });
  });

  // Leave Room (optional)
  socket.on("leaveRoom", () => {
    const peer = state.peers[socket.id];
    if (peer) {
      const { roomName } = peer;
      state.rooms[roomName].peers = state.rooms[roomName].peers.filter(
        (id: string) => id !== socket.id
      );
      delete state.peers[socket.id];
    }
  });

  // You can add more room-related events here
}