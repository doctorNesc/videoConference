import { Socket } from "socket.io";
import { MediaType, SharedState } from "../types";

export function registerProducerHandlers(socket: Socket, state: SharedState) {

    socket.on("getProducers", (callback) => {
        //return all producer transports
        const { roomName } = state.peers[socket.id];

        let producerList: { id: string; mediaType: MediaType }[] = [];

        state.producers.forEach((producerData) => {
            //exclude clients, that are making the call
            if (producerData.socketId != socket.id && producerData.roomName == roomName) {
                producerList = [
                    ...producerList,
                    {
                        id: producerData.producer.id,
                        mediaType: producerData.mediaType,
                    },
                ];
            }
        });
        // return the producer list back to the client
        callback(producerList);
    });

}



