import { Router } from "mediasoup/node/lib/types";
import { Peer } from "./peer";

export class Room {
    roomName: string;
    router: Router;
    peers: Map<string, Peer> = new Map();

    constructor(roomName: string, router: Router) {
        this.roomName = roomName;
        this.router = router;
    }
}

export class RoomManager {

    rooms: Map<string, Room> = new Map();

    constructor() {

    }

    joinRoom() {

    }

    getOrAssignWorker = (state: SharedState): Worker => {
        const worker = state.mediasoupWorkers![workerIndex];
        if (++workerIndex == state.mediasoupWorkers!.length) {
            workerIndex = 0;
        }
        return worker;
    }

    getOrCreateRoom = async (state: SharedState, roomName: string, socketId: string) => {
        // creates router for the roomName using worker.createRouter(options)
        let router;
        let isAdmin = false;
        let peers: string[] = [];
        if (state.rooms[roomName]) {
            router = state.rooms[roomName].router;
            peers = state.rooms[roomName].peers || [];
        } else {
            const worker = getOrAssignWorker(state);
            router = await worker.createRouter({ mediaCodecs });
            isAdmin = true; //if room is new, first user to create it will be an admin
        }

        state.rooms[roomName] = {
            router,
            peers: [...peers, socketId],
        };

        return { router, isAdmin };
    };
}