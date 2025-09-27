// src/types/actions.ts

export const ACTIONS = {
  // Room & peer lifecycle
  JOIN_ROOM: "joinRoom",
  LEAVE_ROOM: "leaveRoom",
  ROOM_CLOSED: "roomClosed",
  CONNECTION_SUCCESS: "connection-success",

  // Transport
  CREATE_TRANSPORT: "createTransport",
  TRANSPORT_CREATED: "transportCreated",
  CONNECT_TRANSPORT: "connectTransport",
  TRANSPORT_CONNECTED: "transportConnected",

  // Producer
  PRODUCE: "produce",
  PRODUCER_CREATED: "producerCreated",
  PRODUCER_CLOSED: "producerClosed",

  // Consumer
  CONSUME: "consume",
  CONSUMER_CREATED: "consumerCreated",
  CONSUMER_RESUME: "consumerResume",
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
} as const;

export type ActionType = typeof ACTIONS[keyof typeof ACTIONS];
