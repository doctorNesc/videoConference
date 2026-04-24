import { Router, WebRtcServer, Worker } from "mediasoup/node/lib/types";
import { v4 as uuidv4 } from "uuid";
import { Peer } from "./peer";
import { SharedState, RoomTopology, ScreenSlot, ScreenSlotDTO, RoomTopologyDTO, RoomDeviceCapabilities, RoomConfig } from "../types";
import { mediaCodecs } from "../config/mediasoup.config";

// ─────────────────────────────────────────────────────────────────────────────
// Room
// ─────────────────────────────────────────────────────────────────────────────

export class Room {
    roomName: string;
    router: Router;
    peers: Map<string, Peer> = new Map();
    webRtcServer!: WebRtcServer;

    /** Hybrid topology: all screen+camera slots in this physical room */
    topology: RoomTopology;

    constructor(roomName: string, router: Router, webRtcServer: WebRtcServer) {
        this.roomName = roomName;
        this.router = router;
        this.webRtcServer = webRtcServer;
        this.topology = {
            roomName,
            slots: new Map(),
            deviceSockets: new Set(),
        };
    }

    // ─── Peer management ─────────────────────────────────────────────────────

    addPeer(peer: Peer) {
        this.peers.set(peer.id, peer);
    }

    getPeer(peerId: string): Peer {
        const peer = this.peers.get(peerId);
        if (!peer) {
            throw new Error(`Peer with peerId:'${peerId}' not found`);
        }
        return peer;
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

        if (this.peers.size === 0) {
            this.peers.clear();
            console.log(`Room [${this.roomName}] closed`);
        }
        return this.peers.size;
    }

    // ─── Topology: room device registration ──────────────────────────────────

    /**
     * Called when a room device emits REGISTER_ROOM_DEVICE.
     * Creates unpaired ScreenSlots (no camera assigned yet) for each screen.
     */
    registerDevice(deviceSocketId: string, capabilities: RoomDeviceCapabilities): ScreenSlot[] {
        this.topology.deviceSockets.add(deviceSocketId);

        const newSlots: ScreenSlot[] = capabilities.screens.map((screen) => ({
            slotId: uuidv4(),
            deviceSocketId,
            screenIndex: screen.screenIndex,
            screenLabel: screen.label || `Screen ${screen.screenIndex}`,
            cameraDeviceId: null,
            cameraLabel: null,
            cameraProducerId: null,
            assignedRemoteIds: [],
            excluded: false,
        }));

        newSlots.forEach((slot) => this.topology.slots.set(slot.slotId, slot));
        console.log(`[Room ${this.roomName}] Device ${deviceSocketId} registered ${newSlots.length} screen slot(s)`);
        return newSlots;
    }

    /**
     * Called when a room device submits SCREEN_CAMERA_PAIRING.
     * Updates each slot with its paired camera.
     */
    applyScreenCameraPairing(pairings: { slotId: string; cameraDeviceId: string; cameraLabel: string }[]): void {
        for (const { slotId, cameraDeviceId, cameraLabel } of pairings) {
            const slot = this.topology.slots.get(slotId);
            if (slot) {
                slot.cameraDeviceId = cameraDeviceId;
                slot.cameraLabel = cameraLabel;
                console.log(`[Room ${this.roomName}] Slot ${slotId} paired with camera "${cameraLabel}"`);
            }
        }
    }

    /**
     * Called when a room device starts streaming a camera producer.
     * Links the mediasoup producer ID to the slot.
     */
    registerCameraProducer(slotId: string, producerId: string): ScreenSlot | null {
        const slot = this.topology.slots.get(slotId);
        if (!slot) return null;
        slot.cameraProducerId = producerId;
        console.log(`[Room ${this.roomName}] Slot ${slotId} camera producer registered: ${producerId}`);
        return slot;
    }

    /**
     * Removes all slots owned by a device and unassigns its remotes.
     * Returns the list of remote socket IDs that need reassignment.
     */
    unregisterDevice(deviceSocketId: string): string[] {
        this.topology.deviceSockets.delete(deviceSocketId);

        const displacedRemotes: string[] = [];
        for (const [slotId, slot] of this.topology.slots) {
            if (slot.deviceSocketId === deviceSocketId) {
                displacedRemotes.push(...slot.assignedRemoteIds);
                this.topology.slots.delete(slotId);
            }
        }

        console.log(`[Room ${this.roomName}] Device ${deviceSocketId} unregistered. Displaced remotes: ${displacedRemotes.length}`);
        return displacedRemotes;
    }

    // ─── Topology: assignment engine ─────────────────────────────────────────

    /**
     * Returns all slots that have a paired camera (ready to accept remotes).
     * Excludes slots marked as excluded.
     */
    getPairedSlots(): ScreenSlot[] {
        return Array.from(this.topology.slots.values()).filter(
            (s) => s.cameraDeviceId !== null && !s.excluded
        );
    }

    /**
     * Assigns a remote participant to the slot with the fewest current assignees.
     * Returns the assigned slot, or null if no paired slots exist.
     */
    assignRemoteToSlot(remoteSocketId: string): ScreenSlot | null {
        const pairedSlots = this.getPairedSlots();
        if (pairedSlots.length === 0) return null;

        // Round-robin: pick slot with fewest assigned remotes
        const target = pairedSlots.reduce((min, slot) =>
            slot.assignedRemoteIds.length < min.assignedRemoteIds.length ? slot : min
        );

        if (!target.assignedRemoteIds.includes(remoteSocketId)) {
            target.assignedRemoteIds.push(remoteSocketId);
        }

        console.log(`[Room ${this.roomName}] Remote ${remoteSocketId} assigned to slot ${target.slotId} (screen: "${target.screenLabel}")`);
        return target;
    }

    /**
     * Removes a remote participant from whichever slot they are assigned to.
     * Returns the slot they were removed from, or null.
     */
    unassignRemote(remoteSocketId: string): ScreenSlot | null {
        for (const slot of this.topology.slots.values()) {
            const idx = slot.assignedRemoteIds.indexOf(remoteSocketId);
            if (idx !== -1) {
                slot.assignedRemoteIds.splice(idx, 1);
                return slot;
            }
        }
        return null;
    }

    /**
     * Returns the slot a remote participant is currently assigned to.
     */
    getSlotForRemote(remoteSocketId: string): ScreenSlot | undefined {
        return Array.from(this.topology.slots.values()).find(
            (s) => s.assignedRemoteIds.includes(remoteSocketId)
        );
    }

    /**
     * Assigns a remote participant to a specific display by displayId.
     * Returns the assigned slot, or null if the display is not available.
     *
     * Note: we do NOT require cameraDeviceId !== null here. The slot may be linked
     * to a display (has displayId) before the camera producer is registered.
     * The remote receives cameraProducerId: null initially, then gets an
     * ASSIGNMENT_UPDATE when CAMERA_PRODUCER_REGISTERED fires.
     */
    assignRemoteToDisplay(remoteSocketId: string, displayId: string): ScreenSlot | null {
        const slot = Array.from(this.topology.slots.values()).find(
            (s) => s.displayId === displayId && !s.excluded
        );
        if (!slot) return null;

        // Remove from any previous assignment
        this.unassignRemote(remoteSocketId);

        // Assign to the new slot
        if (!slot.assignedRemoteIds.includes(remoteSocketId)) {
            slot.assignedRemoteIds.push(remoteSocketId);
        }

        console.log(`[Room ${this.roomName}] Remote ${remoteSocketId} assigned to display ${displayId} (slot: ${slot.slotId})`);
        return slot;
    }

    /**
     * Rebalances all remote assignments across available paired slots.
     * Called after a device joins or leaves.
     */
    rebalanceAssignments(): Map<string, ScreenSlot> {
        const pairedSlots = this.getPairedSlots();

        // Collect all currently assigned remotes
        const allRemotes: string[] = [];
        for (const slot of this.topology.slots.values()) {
            allRemotes.push(...slot.assignedRemoteIds);
            slot.assignedRemoteIds = [];
        }

        // Also collect remotes from slots that no longer exist (displaced)
        // (already cleared above since we cleared all slots)

        if (pairedSlots.length === 0) {
            console.log(`[Room ${this.roomName}] No paired slots available for rebalancing`);
            return new Map();
        }

        // Reassign round-robin
        const newAssignments = new Map<string, ScreenSlot>(); // remoteSocketId → slot
        allRemotes.forEach((remoteId, i) => {
            const slot = pairedSlots[i % pairedSlots.length];
            slot.assignedRemoteIds.push(remoteId);
            newAssignments.set(remoteId, slot);
        });

        console.log(`[Room ${this.roomName}] Rebalanced ${allRemotes.length} remote(s) across ${pairedSlots.length} slot(s)`);
        return newAssignments;
    }

    // ─── Screen exclusion ─────────────────────────────────────────────────────

    /**
     * Marks a screen slot as excluded (reserved for local work).
     */
    excludeSlot(slotId: string): ScreenSlot | null {
        const slot = this.topology.slots.get(slotId);
        if (!slot) return null;
        slot.excluded = true;
        console.log(`[Room ${this.roomName}] Slot ${slotId} excluded`);
        return slot;
    }

    /**
     * Marks a screen slot as included (available for conference).
     */
    includeSlot(slotId: string): ScreenSlot | null {
        const slot = this.topology.slots.get(slotId);
        if (!slot) return null;
        slot.excluded = false;
        console.log(`[Room ${this.roomName}] Slot ${slotId} included`);
        return slot;
    }

    // ─── Topology serialisation ───────────────────────────────────────────────

    /** Serialise topology to a plain object safe for socket.io transmission */
    getTopologyDTO(): RoomTopologyDTO {
        const slots: ScreenSlotDTO[] = Array.from(this.topology.slots.values()).map((s) => ({
            slotId: s.slotId,
            deviceSocketId: s.deviceSocketId,
            screenIndex: s.screenIndex,
            screenLabel: s.screenLabel,
            cameraDeviceId: s.cameraDeviceId,
            cameraLabel: s.cameraLabel,
            cameraProducerId: s.cameraProducerId,
            assignedRemoteIds: [...s.assignedRemoteIds],
            displayId: s.displayId,   // ← required for display-state lookup on the client
            excluded: s.excluded,
            position3D: s.position3D,
        }));

        return {
            roomName: this.roomName,
            slots,
            deviceSocketIds: Array.from(this.topology.deviceSockets),
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RoomManager
// ─────────────────────────────────────────────────────────────────────────────

export class RoomManager {
    workerIndex: number = 0;
    rooms: Map<string, Room> = new Map();
    socketToRoom: Map<string, string> = new Map();

    /** In-memory cache of the latest saved RoomConfig per room name.
     *  Updated by the PUT /api/rooms/:name REST handler so connected clients
     *  receive live config pushes without a server restart. */
    roomConfigs: Map<string, RoomConfig> = new Map();

    constructor() { }

    setRoomConfig(roomName: string, config: RoomConfig): void {
        this.roomConfigs.set(roomName, config);
    }

    getRoomConfig(roomName: string): RoomConfig | null {
        return this.roomConfigs.get(roomName) ?? null;
    }

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
            room = new Room(roomName, router, worker.appData.webRtcServer as WebRtcServer);
            this.rooms.set(roomName, room);
        }

        return room;
    };

    getRoom(name: string, placeOfCall?: string): Room {
        const room = this.rooms.get(name);
        if (!room) {
            throw new Error(`Room '${name}' when using method '${placeOfCall}' not found`);
        }
        return room;
    }

    deleteRoom(roomName: string) {
        const room = this.rooms.get(roomName);
        room?.router.close();
        this.rooms.delete(roomName);
    }

    /** Returns topology DTOs for all rooms — used by the /api/topology REST endpoint */
    getAllTopologies(): import('../types').RoomTopologyDTO[] {
        return Array.from(this.rooms.values()).map(room => room.getTopologyDTO());
    }
}
