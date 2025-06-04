import { Socket } from "socket.io";
// import { Server } from "socket.io";
import { SharedState } from "../types"; // Define your shared state interface
import { getOrCreateRoom } from "../mediasoup/utils";

export function registerRoomHandlers(socket: Socket, state: SharedState) {
  // Join Room
  socket.on("joinRoom", async ({ roomName, userName, isMainRoom }, callback) => {
    const { router, isAdmin } = await getOrCreateRoom(state, roomName, socket.id);

    console.log("Socket ", socket.id, " joined room " + roomName);

    // Track main room devices
    if (isMainRoom && !state.mainRoomDevices?.[roomName]?.includes(socket.id)) {
      state.mainRoomDevices[roomName] = state.mainRoomDevices?.[roomName] || [];
      state.mainRoomDevices[roomName].push(socket.id);
    }
    if (!isMainRoom) {
      assignRemoteToMainRoomDevice(roomName, socket.id, state);
    }
    state.peers[socket.id] = {
      socket,
      roomName, // name for the Router this Peer joined
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: userName + (isMainRoom ? " (Main Room)" : "[Remote]"),
        isAdmin, //admin if joined the room first
        isMainRoom
      },
    };

    // call callback from the client and send back the rtpCapabilities
    callback({
      rtpCapabilities: router.rtpCapabilities,
    });
  });
  //unused
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

  const assignRemoteToMainRoomDevice = (roomName: string, remoteSocketId: string, state: SharedState) => {
    const devices = state.mainRoomDevices[roomName] || [];
    if (devices.length === 0) return null;
    // Count current assignments per device
    const counts = devices.map(deviceSocketId =>
      Object.values(state.remoteAssignments[roomName]).filter(id => id === deviceSocketId).length
    );
    const minIndex = counts.indexOf(Math.min(...counts));
    const assignedDevice = devices[minIndex];
    state.remoteAssignments[roomName][remoteSocketId] = assignedDevice;
    return assignedDevice;
  }

}