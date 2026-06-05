import { Socket } from "socket.io";
import { SharedState } from "../types";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";

export function registerConsumerHandlers(socket: Socket, state: SharedState, roomManager: RoomManager) {

    socket.on(ACTIONS.CONSUME, async ({
        rtpCapabilities, remoteProducerId, serverConsumerTransportId
    }, callback) => {
        try {
            
            const roomName = roomManager.socketToRoom.get(socket.id);
            if (!roomName) {
                console.warn('[CONSUME] request from socket not in room:', socket.id);
                return callback({ params: { error: 'not-in-room' } });
            }
            const room = roomManager.getRoom(roomName,'CONSUME');
            if (!room) {
                return callback({ params: { error: 'room-not-found' } });
            }
            const producerPeer = room.getAllPeers().find(peer => peer.producers.has(remoteProducerId));
            if (!producerPeer) {
                return callback({ params: { error: 'producer-not-found' } });
            }
            const consumerTransport = room?.getAllPeers().find(peer => peer.recvTransport.id == serverConsumerTransportId)?.recvTransport;
            if (!consumerTransport) {
                return callback({ params: { error: 'consumer-transport-not-found' } });
            }
            if (!room.router.canConsume({ producerId: remoteProducerId, rtpCapabilities })) {
                return callback({ params: { error: 'cannot-consume-with-rtp-capabilities' } });
            }
            
            
            const userName = producerPeer?.userName;
            const router = room.router;
            
            
            if (router.canConsume({
                producerId: remoteProducerId,
                rtpCapabilities,
            })) {
                
                const consumer = await consumerTransport!.consume({
                    producerId: remoteProducerId,
                    rtpCapabilities,
                    paused: true,
                });

                consumer.on(ACTIONS.TRANSPORT_CLOSE, () => {
                    console.log("transport close from consumer", consumer.id);
                    
                    
                });

                consumer.on(ACTIONS.PRODUCER_CLOSE, () => {
                    socket.emit(ACTIONS.PRODUCER_CLOSED, { remoteProducerId });
                    try {
                        consumer.close();
                    } catch (err) {
                        console.error('[CONSUMER] error closing consumer after producer close:', err);
                    }
                });

                const peerConsumer = room.getPeer(socket.id);
                peerConsumer.addConsumer(consumer);

                
                consumer.on('@close', () => {
                    peerConsumer.removeConsumer(consumer.id);
                });

                
                const params = {
                    id: consumer.id,
                    producerId: remoteProducerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                    serverConsumerId: consumer.id,
                    userName
                };
                
                callback({ params });
            }
            
        } catch (error: any) {
            console.error('[CONSUME] failed to create consumer:', error);
            callback({ params: { error: error.message || String(error) } });
        }
    });

    socket.on(ACTIONS.CONSUMER_RESUME, async ({ serverConsumerId }, callback) => {
        try {
            const roomName = roomManager.socketToRoom.get(socket.id);
            if (!roomName) {
                console.warn('[CONSUMER_RESUME] socket not in any room:', socket.id);
                return callback?.({ error: 'not-in-room' });
            }
            const room = roomManager.getRoom(roomName, 'CONSUMER_RESUME');
            if (!room) {
                console.warn('[CONSUMER_RESUME] room not found:', roomName);
                return callback?.({ error: 'room-not-found' });
            }
            
            const peerWithConsumer = room.getAllPeers().find(peer => peer.consumers.get(serverConsumerId));
            if (!peerWithConsumer) {
                console.warn('[CONSUMER_RESUME] consumer not found:', serverConsumerId);
                return callback?.({ error: 'consumer-not-found' });
            }
            
            const consumer = peerWithConsumer.consumers.get(serverConsumerId);
            if (!consumer) {
                console.warn('[CONSUMER_RESUME] consumer is null:', serverConsumerId);
                return callback?.({ error: 'consumer-null' });
            }
            
            console.log('[CONSUMER_RESUME] Resuming consumer:', serverConsumerId, 'for socket:', socket.id);
            await consumer.resume();
            console.log('[CONSUMER_RESUME] Consumer resumed successfully:', serverConsumerId);
            callback?.({ resumed: true });
        } catch (error) {
            console.error("[CONSUMER_RESUME] Error resuming consumer:", error);
            callback?.({ error: String(error) });
        }
    });

}