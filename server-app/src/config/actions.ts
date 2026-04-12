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

    // ─── DataChannel (chat via mediasoup SCTP DataChannels) ──────────────────
    /**
     * Emitted by client → server to create a DataProducer on the send transport.
     * Callback: { id: string } — the server-side DataProducer ID.
     */
    PRODUCE_DATA: "produceData",

    /**
     * Emitted by server → a peer when a new DataProducer is available in the room.
     * Payload: { dataProducerId: string }
     */
    NEW_DATA_PRODUCER: "newDataProducer",

    /**
     * Emitted by client → server to consume a remote DataProducer.
     * Payload: { dataProducerId: string; serverConsumerTransportId: string }
     * Callback: { id, dataProducerId, sctpStreamParameters, label, protocol }
     */
    CONSUME_DATA: "consumeData",

    /**
     * Emitted by client → server to resume a DataConsumer.
     * Payload: { serverDataConsumerId: string }
     */
    DATA_CONSUMER_RESUME: "dataConsumerResume",

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

    // ─── Hybrid: Room configuration & assignment ──────────────────────────────
    /**
     * Emitted by a remote participant to choose a specific display.
     * Payload: { displayId: string }
     * Server assigns remote to the slot linked to that displayId.
     */
    CHOOSE_DISPLAY: "chooseDisplay",

    /**
     * Emitted by a room device to exclude a screen from conference.
     * Payload: { slotId: string }
     */
    EXCLUDE_SCREEN: "excludeScreen",

    /**
     * Emitted by a room device to include a previously excluded screen.
     * Payload: { slotId: string }
     */
    INCLUDE_SCREEN: "includeScreen",

    /**
     * Emitted by a remote participant to request assignment to a specific slot.
     * Payload: { slotId: string }
     * Server responds with ASSIGNMENT_UPDATE if successful.
     */
    REQUEST_SLOT_ASSIGNMENT: "requestSlotAssignment",

    /**
     * Emitted by a room device to update display-to-slot mappings.
     * Payload: { slotId: string; displayId: string }[]
     */
    UPDATE_DISPLAY_MAPPING: "updateDisplayMapping",

    // ─── Errors & system ─────────────────────────────────────────────────────
    ERROR: "error",
    DISCONNECT: "disconnect",
    DIED: "died",
} as const;

export type ActionType = typeof ACTIONS[keyof typeof ACTIONS];
