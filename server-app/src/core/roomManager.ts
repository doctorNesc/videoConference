import { Router, Worker } from "mediasoup/node/lib/types";
import { Peer } from "./peer";
import { SharedState } from "../types";
import { mediaCodecs } from "../config/mediasoup.config";

export class Room {
    roomName: string;
    router: Router;
    peers: Map<string, Peer> = new Map();

    constructor(roomName: string, router: Router) {
        this.roomName = roomName;
        this.router = router;
    }

    addPeer(peer: Peer) {
        this.peers.set(peer.id, peer);
    }

    getPeer(peerId: string): Peer | undefined {
        return this.peers.get(peerId);
    }

    getAllPeers(): Peer[] {
        return Array.from(this.peers.values()) || [];
    }

    removePeer(peerId: string): number {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.close();
            this.peers.delete(peerId);
        }

        // Cleanup if no peers left
        if (this.peers.size === 0) {
            this.router.close();
            this.peers.clear();
            console.log(`Room [${this.roomName}] closed`);
        }
        return this.peers.size;
    }
}

export class RoomManager {
    workerIndex: number = 0;
    rooms: Map<string, Room> = new Map();
    socketToRoom: Map<string, string> = new Map();

    constructor() {}

    getOrAssignWorker = (state: SharedState): Worker => {
        const worker = state.mediasoupWorkers![this.workerIndex];
        if (++this.workerIndex == state.mediasoupWorkers!.length) {
            this.workerIndex = 0;
        }
        return worker;
    }

    getOrCreateRoom = async (state: SharedState, roomName: string) => {

        let room = this.rooms.get(roomName);

        if (!room) {
            const worker = this.getOrAssignWorker(state);
            const router = await worker.createRouter({ mediaCodecs });
            // peer.setAdmin(true); //if room is new, first user to create it will be an admin
            room = new Room(roomName, router);
            this.rooms.set(roomName, room);
        }

        return room;
    };

    getRoom(name: string): Room | undefined {
        return this.rooms.get(name);
    }

    deleteRoom(roomName: string) {
        this.rooms.delete(roomName);
    }
}