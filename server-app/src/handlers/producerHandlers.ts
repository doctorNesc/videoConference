import { Socket } from "socket.io";
import { MediaType, SharedState } from "../types";

export function registerProducerHandlers(socket: Socket, state: SharedState) {

socket.on("getProducers", (callback) => {
    const { roomName } = state.peers[socket.id];
    const isMainRoom = state.mainRoomDevices[roomName]?.includes(socket.id);

    const producerList: { id: string; mediaType: MediaType, socketId: string, assignedMainRoomDevice?: string }[] = [];

    state.producers.forEach((producerData) => {
        if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
            const isProducerMainRoom = state.mainRoomDevices[roomName]?.includes(producerData.socketId);

            if (isMainRoom) {
                // Main room devices: only get assigned remote users
                const isAssigned = state.remoteAssignments[roomName]?.[producerData.socketId] === socket.id;
                if (!isProducerMainRoom && isAssigned) {
                    producerList.push({
                        id: producerData.producer.id,
                        mediaType: producerData.mediaType,
                        socketId: producerData.socketId,
                    });
                }
            } else {
                let assignedMainRoomDevice: string | undefined = undefined;
                if (!isProducerMainRoom) {
                    assignedMainRoomDevice = state.remoteAssignments[roomName]?.[producerData.socketId];
                }
                producerList.push({
                    id: producerData.producer.id,
                    mediaType: producerData.mediaType,
                    socketId: producerData.socketId,
                    assignedMainRoomDevice
                });
            }
        }
    });

    if (!isMainRoom) {
        // For remote users, also send their own assigned main room device
        const myAssignedMainRoomDevice = state.remoteAssignments[roomName]?.[socket.id];
        callback({ producerList, myAssignedMainRoomDevice });
    } else {
        callback(producerList);
    }
});

}



