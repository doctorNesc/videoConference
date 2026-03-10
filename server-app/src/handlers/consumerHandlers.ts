import { Socket } from "socket.io";
import { SharedState } from "../types";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";

export function registerConsumerHandlers(socket: Socket, state: SharedState, roomManager: RoomManager) {

    socket.on(ACTIONS.CONSUME, async ({
        rtpCapabilities, remoteProducerId, serverConsumerTransportId
    }, callback) => {
        try {
            // const roomName = state.peers[socket.id].roomName;
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
            // const room = roomManager.getRoom(roomName!);
            // const producerPeer = room?.getAllPeers().find(peer => peer.producers.has(remoteProducerId));
            const userName = producerPeer?.userName;
            const router = room.router;
            // const consumerTransport = room?.getAllPeers().find(peer => peer.recvTransport.id == serverConsumerTransportId)?.recvTransport;
            // check if the router can consume the specified producer
            if (router.canConsume({
                producerId: remoteProducerId,
                rtpCapabilities,
            })) {
                // transport can now consume and return a consumer
                const consumer = await consumerTransport!.consume({
                    producerId: remoteProducerId,
                    rtpCapabilities,
                    paused: true,
                });

                consumer.on(ACTIONS.TRANSPORT_CLOSE, () => {
                    console.log("transport close from consumer", consumer.id);
                    // remove consumer from peer map when transport is closed
                    // try {
                    //     const peerConsumer = room.getPeer(socket.id);
                    //     peerConsumer.removeConsumer(consumer.id);
                    // } catch {
                    //     // ignore
                    // }
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

                // When this consumer is closed (for any reason) remove it from the peer
                // mediasoup emits an internal '@close' event when a consumer is closed
                consumer.on('@close', () => {
                    peerConsumer.removeConsumer(consumer.id);
                });

                // from the consumer extract the following params
                // to send back to the Client
                const params = {
                    id: consumer.id,
                    producerId: remoteProducerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                    serverConsumerId: consumer.id,
                    userName
                };
                // send the parameters to the client
                callback({ params });
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            console.error('[CONSUME] failed to create consumer:', error);
            callback({ params: { error: error.message || String(error) } });
        }
    });

    socket.on(ACTIONS.CONSUMER_RESUME, async ({ serverConsumerId }, callback) => {
        try {
            const roomName = roomManager.socketToRoom.get(socket.id);
            const room = roomManager.getRoom(roomName!, 'CONSUMER_RESUME');
            const consumer = room.getAllPeers().find(peer => peer.consumers.get(serverConsumerId))!.consumers.get(serverConsumerId);
            // const consumer = roomManager
            // const consumer = state.consumers.find(
            //     (consumerData) => consumerData.consumer.id == serverConsumerId
            // )?.consumer;
            await consumer?.resume();
            callback({ resumed: true });
        } catch (error) {
            console.error("Error resuming consumer:", error);
        }
    });

}