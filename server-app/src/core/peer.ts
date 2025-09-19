import { Consumer, Producer, WebRtcTransport } from "mediasoup/node/lib/types";

export class Peer {
    id: string;
    userName: string;
    isConferenceRoom: boolean = false;
    isAdmin: boolean = false;
    conferenceRoomName: string = "default";

    transports: Map<string, WebRtcTransport> = new Map();
    producers: Map<string, Producer> = new Map();
    consumers: Map<string, Consumer> = new Map();

    constructor(id: string, userName: string, isConferenceRoom: boolean, conferenceRoomName: string, isAdmin: boolean) {
        this.id = id;
        this.userName = userName;
        this.isConferenceRoom = isConferenceRoom;
        this.conferenceRoomName = conferenceRoomName;
        this.isAdmin = isAdmin;
    }

    addTransport(transport: WebRtcTransport) {
        this.transports.set(transport.id, transport);
    }

    removeTransport(transportId: string) {
        const transport = this.transports.get(transportId);
        if (transport) {
            transport.close();
            this.transports.delete(transportId);
        }
    }

    addProducer(producer: Producer) {
        this.producers.set(producer.id, producer);
    }

    removeProducer(producerId: string) {
        const producer = this.producers.get(producerId);
        if (producer) {
            producer.close();
            this.producers.delete(producerId);
        }
    }

    addConsumer(consumer: Consumer) {
        this.consumers.set(consumer.id, consumer);
    }

    removeConsumer(consumerId: string) {
        const consumer = this.consumers.get(consumerId);
        if (consumer) {
            consumer.close();
            this.consumers.delete(consumerId);
        }
    }

    close() {
        // Clean up everything when peer disconnects
        this.producers.forEach((p) => p.close());
        this.consumers.forEach((c) => c.close());
        this.transports.forEach((t) => t.close());

        this.producers.clear();
        this.consumers.clear();
        this.transports.clear();
    }

}