import { Socket } from "socket.io";
// import { Server } from "socket.io";
import { SharedState } from "../types"; // Define your shared state interface
import { ACTIONS } from "../config/actions";
import { Peer } from "../core/peer";
import { RoomManager } from "../core/roomManager";
export function registerRoomHandlers(socket: Socket, state: SharedState, roomManager: RoomManager) {
  // Join Room
  socket.on(ACTIONS.JOIN_ROOM, async ({ roomName, userName, isMainRoom }, callback) => {

    const room = await roomManager.getOrCreateRoom(state, roomName);
    const peer = new Peer(socket.id, socket, userName, isMainRoom, roomName);
    room.addPeer(peer);
    console.log("User ", userName, " joined room " + roomName);

    // Track main room devices
    // if (isMainRoom && !state.mainRoomDevices?.[roomName]?.includes(socket.id)) {
    //   state.mainRoomDevices[roomName] = state.mainRoomDevices?.[roomName] || [];
    //   state.mainRoomDevices[roomName].push(socket.id);
    // }
    // if (!isMainRoom) {
    //   assignRemoteToMainRoomDevice(roomName, socket.id, state);
    // }

    // call callback from the client and send back the rtpCapabilities
    callback({
      rtpCapabilities: room.router.rtpCapabilities,
    });
  });

  //unused
  socket.on(ACTIONS.LEAVE_ROOM, ({ roomName }) => {
    const userCount = roomManager.getRoom(roomName)?.removePeer(socket.id);
    if (!userCount) {
      roomManager.deleteRoom(roomName);
    }
  });

  // const assignRemoteToMainRoomDevice = (roomName: string, remoteSocketId: string, state: SharedState) => {
  //   const devices = state.mainRoomDevices[roomName] || [];
  //   if (devices.length === 0) return null;
  //   // Count current assignments per device
  //   const counts = devices.map(deviceSocketId =>
  //     Object.values(state.remoteAssignments[roomName]).filter(id => id === deviceSocketId).length
  //   );
  //   const minIndex = counts.indexOf(Math.min(...counts));
  //   const assignedDevice = devices[minIndex];
  //   state.remoteAssignments[roomName][remoteSocketId] = assignedDevice;
  //   return assignedDevice;
  // }

}