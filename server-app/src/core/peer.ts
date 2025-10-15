import { Consumer, Producer, WebRtcTransport } from "mediasoup/node/lib/types";
import { Socket } from "socket.io";

export class Peer {
    id: string;
    userName: string;
    isConferenceRoom: boolean = false;
    isAdmin: boolean = false;
    conferenceRoomName: string = "default";
    socket: Socket;

    sendTransport!: WebRtcTransport;
    recvTransport!: WebRtcTransport;
    producers: Map<string, Producer> = new Map();
    consumers: Map<string, Consumer> = new Map();

    constructor(id: string, socket: Socket, userName: string, isConferenceRoom: boolean = false, conferenceRoomName: string = "default", isAdmin: boolean = false) {
        this.id = id;
        this.userName = userName;
        this.isConferenceRoom = isConferenceRoom;
        this.conferenceRoomName = conferenceRoomName;
        this.isAdmin = isAdmin;
        this.socket = socket;
    }

    setAdmin(isAdmin: boolean) {
        this.isAdmin = isAdmin;
    }

    setSendTransport(transport: WebRtcTransport) {
        this.sendTransport = transport;
    }

    setRecvTransport(transport: WebRtcTransport) {
        this.recvTransport = transport;
    }

    addProducer(producer: Producer) {
        this.producers.set(producer.id, producer);
    }

    removeProducer(producerId: string) {
        this.producers.delete(producerId);
    }

    addConsumer(consumer: Consumer) {
        this.consumers.set(consumer.id, consumer);
    }

    removeConsumer(consumerId: string) {
        this.consumers.delete(consumerId);
    }

    close() {
        // Clean up everything when peer disconnects
        this.producers.forEach((p) => p.close());
        this.consumers.forEach((c) => c.close());
        this.recvTransport?.close();
        this.sendTransport?.close();
        this.producers.clear();
        this.consumers.clear();
    }

}