import { Socket } from "socket.io";
import { SharedState } from "../types";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";

export function registerProducerHandlers(socket: Socket, state: SharedState, roomManager: RoomManager) {

    socket.on(ACTIONS.GET_PRODUCERS, (data, callback) => {
        // const { roomName } = state.peers[socket.id];
        const roomName = roomManager.socketToRoom.get(socket.id);
        // const isMainRoom = state.mainRoomDevices[roomName]?.includes(socket.id);

        const producerList: { producerId: string; socketId: string }[] = [];
        const room = roomManager.getRoom(roomName!,'GET_PRODUCERS');

        room?.getAllPeers().forEach(peer => {
            if (peer.id !== socket.id) {
                console.log(`[GET_PRODUCERS] Peer ${peer.id} (${peer.userName}, isRoomDevice: ${peer.isRoomDevice}) has ${peer.producers.size} producers`);
                peer.producers.forEach((producer) => {
                    producerList.push({ producerId: producer.id, socketId: peer.id });
                });
            }
        });
        console.log(`[GET_PRODUCERS] socket ${socket.id} requested producers, found ${producerList.length} producers from ${room?.getAllPeers().length || 0} peers`);
        callback(producerList);
        //     state.producers.forEach((producerData) => {
        //         if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
        //             const isProducerMainRoom = state.mainRoomDevices[roomName]?.includes(producerData.socketId);

        //             if (isMainRoom) {
        //                 // Main room devices: only get assigned remote users
        //                 const isAssigned = state.remoteAssignments[roomName]?.[producerData.socketId] === socket.id;
        //                 if (!isProducerMainRoom && isAssigned) {
        //                     producerList.push({
        //                         id: producerData.producer.id,
        //                         mediaType: producerData.mediaType,
        //                         socketId: producerData.socketId,
        //                     });
        //                 }
        //             } else {
        //                 let assignedMainRoomDevice: string | undefined = undefined;
        //                 if (!isProducerMainRoom) {
        //                     assignedMainRoomDevice = state.remoteAssignments[roomName]?.[producerData.socketId];
        //                 }
        //                 producerList.push({
        //                     id: producerData.producer.id,
        //                     mediaType: producerData.mediaType,
        //                     socketId: producerData.socketId,
        //                     assignedMainRoomDevice
        //                 });
        //             }
        //         }
        //     });

        //     if (!isMainRoom) {
        //         // For remote users, also send their own assigned main room device
        //         const myAssignedMainRoomDevice = state.remoteAssignments[roomName]?.[socket.id];
        //         callback({ producerList, myAssignedMainRoomDevice });
        //     } else {
        //         callback(producerList);
        //     }
    });

}



