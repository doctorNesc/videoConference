import { Socket } from "socket.io";
import { SharedState } from "../types";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";

export function registerProducerHandlers(socket: Socket, state: SharedState, roomManager: RoomManager) {

    socket.on(ACTIONS.GET_PRODUCERS, (data, callback) => {
        
        const roomName = roomManager.socketToRoom.get(socket.id);
        

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
        
        
    });

}

