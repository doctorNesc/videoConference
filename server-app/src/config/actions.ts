// src/config/actions.ts

export const ACTIONS = {
    // ─── Room & peer lifecycle ────────────────────────────────────────────────
    JOIN_ROOM: "joinRoom",
    LEAVE_ROOM: "leaveRoom",
    ROOM_CLOSED: "roomClosed",
    CONNECTION_SUCCESS: "connection-success",

    // ─── Transport ────────────────────────────────────────────────────────────
    CREATE_TRANSPORT: "createTransport",
    CREATE_WEBRTC_TRANSPORT: "createWebRtcTransport",
    TRANSPORT_CREATED: "transportCreated",
    CONNECT_SEND_TRANSPORT: "connectSendTransport",
    TRANSPORT_RECV_CONNECT: "transport-recv-connect",
    TRANSPORT_PRODUCE: "transport-produce",
    TRANSPORT_CONNECTED: "transportConnected",
    TRANSPORT_CLOSE: "transportclose",

    // ─── Producer ─────────────────────────────────────────────────────────────
    PRODUCE: "produce",
    PRODUCER_CREATED: "producerCreated",
    NEW_PRODUCER: "new-producer",
    GET_PRODUCERS: "getProducers",
    PRODUCER_CLOSE: "producerclose",
    PRODUCER_CLOSED: "producer-closed",

    // ─── Consumer ─────────────────────────────────────────────────────────────
    CONSUME: "consume",
    CONSUMER_CREATED: "consumerCreated",
    CONSUMER_RESUME: "consumer-resume",
    CONSUMER_PAUSE: "consumerPause",
    CONSUMER_CLOSED: "consumerClosed",

    // ─── Screen share ─────────────────────────────────────────────────────────
    START_SCREEN_SHARE: "startScreenShare",
    STOP_SCREEN_SHARE: "stopScreenShare",
    SCREEN_PRODUCER_CREATED: "screenProducerCreated",
    SCREEN_CONSUMER_CREATED: "screenConsumerCreated",

    // ─── Chat ─────────────────────────────────────────────────────────────────
    SEND_MESSAGE: "sendMessage",
    NEW_MESSAGE: "newMessage",

    // ─── Hybrid: Room device lifecycle ───────────────────────────────────────
    /**
     * Emitted by a physical room device after joining.
     * Payload: { capabilities: RoomDeviceCapabilities }
     * Server creates unpaired ScreenSlots and emits ROOM_TOPOLOGY_UPDATE.
     */
    REGISTER_ROOM_DEVICE: "registerRoomDevice",

    /**
     * Emitted by a physical room device after the pairing wizard is completed.
     * Payload: { pairings: { slotId: string; cameraDeviceId: string; cameraLabel: string }[] }
     * Server updates slots and triggers rebalance.
     */
    SCREEN_CAMERA_PAIRING: "screenCameraPairing",

    /**
     * Emitted by a physical room device when it starts streaming a camera.
     * Payload: { slotId: string; producerId: string }
     * Server updates slot.cameraProducerId and emits ASSIGNMENT_UPDATE to assigned remotes.
     */
    CAMERA_PRODUCER_REGISTERED: "cameraProducerRegistered",

    /**
     * Emitted by server → all peers in the room when topology changes.
     * Payload: RoomTopologyDTO
     */
    ROOM_TOPOLOGY_UPDATE: "roomTopologyUpdate",

    /**
     * Emitted by a physical room device when leaving (or on disconnect).
     * Server removes its slots, rebalances, emits ROOM_TOPOLOGY_UPDATE.
     */
    UNREGISTER_ROOM_DEVICE: "unregisterRoomDevice",

    // ─── Hybrid: Assignment ───────────────────────────────────────────────────
    /**
     * Emitted by server → a specific remote participant when their slot assignment changes.
     * Payload: RemoteAssignment
     */
    ASSIGNMENT_UPDATE: "assignmentUpdate",

    /**
     * Emitted by a client to request the current room topology.
     * Callback: RoomTopologyDTO
     */
    GET_ROOM_TOPOLOGY: "getRoomTopology",

    // ─── Hybrid: Slot notifications to room devices ───────────────────────────
    /**
     * Emitted by server → the room device that owns the slot when a remote is assigned.
     * Payload: { slotId: string; remoteSocketId: string; remoteName: string }
     */
    SLOT_REMOTE_JOINED: "slotRemoteJoined",

    /**
     * Emitted by server → the room device that owns the slot when a remote leaves/is reassigned.
     * Payload: { slotId: string; remoteSocketId: string }
     */
    SLOT_REMOTE_LEFT: "slotRemoteLeft",

    // ─── Errors & system ─────────────────────────────────────────────────────
    ERROR: "error",
    DISCONNECT: "disconnect",
    DIED: "died",
} as const;

export type ActionType = typeof ACTIONS[keyof typeof ACTIONS];
