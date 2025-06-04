import { Socket } from "socket.io";
import { SharedState } from "../types";
import { Consumer } from "mediasoup/node/lib/types";

export function registerConsumerHandlers(socket: Socket, state: SharedState) {

    socket.on("consume", async ({
        rtpCapabilities, remoteProducerId, serverConsumerTransportId, mediaType
    }, callback) => {
        try {
            const roomName = state.peers[socket.id].roomName;
            // const userName = state.peers[socket.id].peerDetails.name;
            const producerPeer = Object.values(state.peers).find(
                peer => peer.producers.includes(remoteProducerId)
            );
            const userName = producerPeer?.peerDetails?.name || "Unknown";
            const router = state.rooms[roomName].router;
            const consumerTransport = state.transports.find(
                (transportData) =>
                    transportData.isConsumer &&
                    transportData.transport.id == serverConsumerTransportId &&
                    transportData.isScreen == (mediaType == "screen")
            )!.transport;
            // check if the router can consume the specified producer
            if (router.canConsume({
                producerId: remoteProducerId,
                rtpCapabilities,
            })) {
                // transport can now consume and return a consumer
                const consumer = await consumerTransport?.consume({
                    producerId: remoteProducerId,
                    rtpCapabilities,
                    paused: true,
                });

                consumer?.on("transportclose", () => {
                    console.log("transport close from consumer");
                });

                consumer?.on("producerclose", () => {
                    console.log("producer of consumer closed");
                    socket.emit("producer-closed", { remoteProducerId });

                    consumerTransport?.close();
                    state.transports = state.transports.filter(
                        (transportData) =>
                            transportData.transport.id !== consumerTransport?.id
                    );
                    consumer.close();

                    state.consumers = state.consumers.filter(
                        (consumerData) => consumerData.consumer.id !== consumer.id
                    );
                });

                addConsumer(consumer, roomName);

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
            console.log(error.message);
            callback({
                params: {
                    error: error,
                },
            });
        }
    });

    socket.on("consumer-resume", async ({ serverConsumerId }) => {
        // console.log("consumer resume");
        try {
            const consumer = state.consumers.find(
                (consumerData) => consumerData.consumer.id == serverConsumerId
            )?.consumer;
            await consumer?.resume();
        } catch (error) {
            console.error("Error resuming consumer:", error);
        }
    });

    const addConsumer = (consumer: Consumer, roomName: string) => {
        // add the consumer to the consumers list
        state.consumers = [...state.consumers, { socketId: socket.id, consumer, roomName }];

        // add the consumer id to the peers list
        state.peers[socket.id] = {
            ...state.peers[socket.id],
            consumers: [...state.peers[socket.id].consumers, consumer.id],
        };
    };
}