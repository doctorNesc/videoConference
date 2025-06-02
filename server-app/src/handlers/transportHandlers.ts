import { Producer, WebRtcTransport } from "mediasoup/node/lib/types";
import { Socket } from "socket.io";
import { createWebRtcTransport, removeItems } from "../mediasoup/utils";
import { MediaType, SharedState } from "../types";
import { Transport } from "mediasoup/node/lib/types";
import { SocketId } from "socket.io-adapter";


export function registerTransportHandlers(socket: Socket, state: SharedState) {
  socket.on(
    "createWebRtcTransport",
    async ({ isConsumer, isScreenShare }, callback) => {
      try {
        // get room name from peer's props
        const roomName = state.peers[socket.id].roomName;
        const router = state.rooms[roomName].router;

        const transport: WebRtcTransport = await createWebRtcTransport(router);
        // add transport to Peer's props
        addTransport(transport, roomName, isConsumer, isScreenShare);

        callback({
          params: {
            id: transport?.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });
      } catch (error) {
        console.error("Error creating WebRTC transport:", error);
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("peer disconnected");

    if (state.peers[socket.id]) {
      const { roomName } = state.peers[socket.id];
      delete state.peers[socket.id];
      // remove socket from room
      state.rooms[roomName] = {
        router: state.rooms[roomName].router,
        peers: state.rooms[roomName].peers.filter(
          (socketId) => socketId !== socket.id
        ),
      };
    }

    state.consumers = removeItems(state.consumers, socket.id, "consumer");
    state.producers = removeItems(state.producers, socket.id, "producer");
    state.transports = removeItems(state.transports, socket.id, "transport");
  });

  // see client's socket.emit('transport-connect', ...)
  socket.on("transport-connect", async ({ dtlsParameters, isScreen }) => {
    try {
      let transport: Transport | undefined;
      if (isScreen) {
        transport = getScreenTransport(socket.id);
      } else {
        transport = getTransport(socket.id);
      }

      await transport?.connect({ dtlsParameters });
    } catch (error) {
      console.error("Error connecting transport:", error);
    }
  });

  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, isScreen }, callback) => {
      // call produce based on the prameters from the client
      let transport;
      if (isScreen) {
        transport = getScreenTransport(socket.id);
      } else {
        transport = getTransport(socket.id);
      }

      const producer = await transport!.produce({ kind, rtpParameters });

      const roomName = state.peers[socket.id].roomName;

      // console.log("Created Producer, ID: ", producer?.id, producer?.kind);
      if (isScreen && producer) {
        state.screenProducerTransports[producer?.id] = {
          socketId: socket.id,
          transport: transport,
        };
      }
      addProducer(producer, roomName, isScreen ? "screen" : "camera");

      informConsumers(
        roomName,
        socket.id,
        producer.id,
        isScreen ? "screen" : "camera"
      );
      // Send back to the client the Producer's id
      callback({
        id: producer.id,
        producersExist: state.producers.length > 1 ? true : false,
      });
    }
  );

  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, serverConsumerTransportId, mediaType }) => {
      const consumerTransport = state.transports.find(
        (transportData) =>
          transportData.isConsumer &&
          transportData.transport.id == serverConsumerTransportId &&
          transportData.isScreen == (mediaType == "screen")
      )?.transport;
      await consumerTransport?.connect({ dtlsParameters });
    }
  );


  const addTransport = (transport: WebRtcTransport, roomname: string, isConsumer: boolean, isScreen: boolean) => {
    // console.log("added transport:\ntransport id:",transport.id,"isConsumer:",isConsumer,"isScreen:",isScreen);
    state.transports = [
      ...state.transports,
      { socketId: socket.id, transport, roomname, isConsumer, isScreen },
    ];

    state.peers[socket.id] = {
      ...state.peers[socket.id],
      transports: [...state.peers[socket.id].transports, transport.id],
    };
  };
  
  const getTransport = (socketId: SocketId) => {
    const producerTransport = state.transports.find(
      (transport) =>
        transport.socketId === socketId &&
        !transport.isConsumer &&
        !transport.isScreen
    );
    return producerTransport?.transport;
  };

  const getScreenTransport = (socketId: SocketId) => {
    const producerTransport = state.transports.find(
      (transport) =>
        transport.socketId === socketId &&
        !transport.isConsumer &&
        transport.isScreen
    );
    return producerTransport?.transport;
  };

  const informConsumers = (roomName: string, socketId: string, id: string, mediaType: MediaType) => {
    console.log(`New ${mediaType} producer joined in room ${roomName}, socket ${socketId}:`, id);
    // A new producer just joined
    // let all consumers to consume this producer
    state.producers.forEach((producerData) => {
      if (
        producerData.socketId !== socketId &&
        producerData.roomName === roomName
      ) {
        const producerSocket = state.peers[producerData.socketId].socket;
        // use socket to send producer id to producer
        producerSocket.emit("new-producer", { producerId: id, mediaType });
      }
    });
  };

  const addProducer = (producer: Producer, roomName: string, mediaType: MediaType) => {
    state.producers = [...state.producers, { socketId: socket.id, producer, roomName, mediaType }];

    state.peers[socket.id] = {
      ...state.peers[socket.id],
      producers: [...state.peers[socket.id].producers, producer.id],
    };
  };
}