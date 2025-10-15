// src/types/actions.ts

export const ACTIONS = {
    // Room & peer lifecycle
    JOIN_ROOM: "joinRoom",
    LEAVE_ROOM: "leaveRoom",
    ROOM_CLOSED: "roomClosed",
    CONNECTION_SUCCESS: "connection-success",

    // Transport
    CREATE_TRANSPORT: "createTransport",
    CREATE_WEBRTC_TRANSPORT: "createWebRtcTransport",
    TRANSPORT_CREATED: "transportCreated",
    CONNECT_TRANSPORT: "connectTransport",
    TRANSPORT_RECV_CONNECT: "transport-recv-connect",
    TRANSPORT_CONNECTED: "transportConnected",
    TRANSPORT_CLOSE: "transportclose",

    // Producer
    PRODUCE: "produce",
    PRODUCER_CREATED: "producerCreated",
    NEW_PRODUCER: "new-producer",
    GET_PRODUCERS: "getProducers",
    PRODUCER_CLOSE: "producerclose",
    PRODUCER_CLOSED: "producer-closed",
    // Consumer
    CONSUME: "consume",
    CONSUMER_CREATED: "consumerCreated",
    CONSUMER_RESUME: "consumer-resume",
    CONSUMER_PAUSE: "consumerPause",
    CONSUMER_CLOSED: "consumerClosed",

    // Screen share (separate transport/producer/consumer)
    START_SCREEN_SHARE: "startScreenShare",
    STOP_SCREEN_SHARE: "stopScreenShare",
    SCREEN_PRODUCER_CREATED: "screenProducerCreated",
    SCREEN_CONSUMER_CREATED: "screenConsumerCreated",

    // Chat
    SEND_MESSAGE: "sendMessage",
    NEW_MESSAGE: "newMessage",

    // Errors
    ERROR: "error",
    DISCONNECT: "disconnect",
    DIED: "died"
} as const;

export type ActionType = typeof ACTIONS[keyof typeof ACTIONS];
