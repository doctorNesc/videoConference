import { Socket } from "socket.io";
import { MediaType, SharedState } from "../types";

export function registerProducerHandlers(socket: Socket, state: SharedState) {

    socket.on("getProducers", (callback) => {
        //return all producer transports
 const { roomName } = state.peers[socket.id];
        const isMainRoom = state.mainRoomDevices[roomName]?.includes(socket.id);

        const producerList: { id: string; mediaType: MediaType, socketId: string }[] = [];

        state.producers.forEach((producerData) => {
            if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
                const isProducerMainRoom = state.mainRoomDevices[roomName]?.includes(producerData.socketId);

                if (isMainRoom) {
                    // Main room devices: only get assigned remote users
                    const isRemote = !isProducerMainRoom;
                    const isAssigned = state.remoteAssignments[roomName]?.[producerData.socketId] === socket.id;
                    if (isRemote && isAssigned) {
                        producerList.push({
                            id: producerData.producer.id,
                            mediaType: producerData.mediaType,
                            socketId: producerData.socketId,
                        });
                    }
                } else {
                    // Remote users: get all producers except their own
                    producerList.push({
                        id: producerData.producer.id,
                        mediaType: producerData.mediaType,
                        socketId: producerData.socketId,
                    });
                }
            }
        });
        callback(producerList);
    });

}



