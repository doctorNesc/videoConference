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
            const room = roomManager.getRoom(roomName);
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
            // console.log(`CONSUME request: room=${roomName} user=${room.getPeer(socket.id).userName} consumerTransportId=${consumerTransport!.id}`);
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
                    console.log("transport close from consumer");
                });

                consumer.on(ACTIONS.PRODUCER_CLOSE, () => {
                    console.log("producer closed");
                    socket.emit(ACTIONS.PRODUCER_CLOSED, { remoteProducerId });

                    consumerTransport?.close();
                    consumer.close();
                });
                const peerConsumer = room.getPeer(socket.id);
                peerConsumer.addConsumer(consumer);

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

    socket.on(ACTIONS.CONSUMER_RESUME, async ({ serverConsumerId }) => {
        try {
            const roomName = roomManager.socketToRoom.get(socket.id);
            const room = roomManager.getRoom(roomName!);
            const consumer = room.getAllPeers().find(peer => peer.consumers.get(serverConsumerId))!.consumers.get(serverConsumerId);
            // const consumer = roomManager
            // const consumer = state.consumers.find(
            //     (consumerData) => consumerData.consumer.id == serverConsumerId
            // )?.consumer;
            await consumer?.resume();
        } catch (error) {
            console.error("Error resuming consumer:", error);
        }
    });

    // const addConsumer = (consumer: Consumer, roomName: string) => {
    //     // add the consumer to the consumers list
    //     state.consumers = [...state.consumers, { socketId: socket.id, consumer, roomName }];

    //     // add the consumer id to the peers list
    //     state.peers[socket.id] = {
    //         ...state.peers[socket.id],
    //         consumers: [...state.peers[socket.id].consumers, consumer.id],
    //     };
    // };
}