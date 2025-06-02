import { Socket } from "socket.io";
// import { Server } from "socket.io";
import { SharedState } from "../types"; // Define your shared state interface
import { getOrCreateRoom } from "../mediasoup/utils";

export function registerRoomHandlers(socket: Socket, state: SharedState) {
  // Join Room
  socket.on("joinRoom", async ({ roomName }, callback) => {
    const { router, isAdmin } = await getOrCreateRoom(state,roomName, socket.id);

    console.log("Socket ", socket.id, " joined room " + roomName);
    state.peers[socket.id] = {
      socket,
      roomName, // name for the Router this Peer joined
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: "",
        isAdmin, //admin if joined the room first
      },
    };

    // call callback from the client and send back the rtpCapabilities
    callback({
      rtpCapabilities: router.rtpCapabilities,
    });
  });

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