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

    if (state.peers[socket.id]) {
      const { roomName } = state.peers[socket.id];

      const mainDevices = state.mainRoomDevices[roomName] || [];
      const wasMainRoom = mainDevices.includes(socket.id);

      state.mainRoomDevices[roomName] = mainDevices.filter(id => id !== socket.id);
      if (wasMainRoom) {
        console.log("mainRoom peer disconnected");
        const assignments = state.remoteAssignments[roomName] || {};
        Object.entries(assignments).forEach(([remoteId, assignedDevice]) => {
          if (assignedDevice === socket.id) {
            // Reassign this remote user to another main room device
            const devices = state.mainRoomDevices[roomName];
            if (devices && devices.length > 0) {
              // Use your round-robin function
              const newDevice = devices.reduce((a, b) => {
                const aCount = Object.values(assignments).filter(id => id === a).length;
                const bCount = Object.values(assignments).filter(id => id === b).length;
                return aCount <= bCount ? a : b;
              });
              assignments[remoteId] = newDevice;
            } else {
              // No devices left, remove assignment
              delete assignments[remoteId];
            }
          }
        });
        // Clean up all transports for this socket
        state.transports = state.transports.filter((t) => {
          if (t.socketId === socket.id) {
            t.transport.close();
            return false;
          }
          return true;
        });

        delete state.peers[socket.id];

        state.remoteAssignments[roomName] = assignments;
      }

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

      // if (isScreen && producer) { //add screenProducer to a list to close it later
      //   state.screenProducerTransports[producer.id] = {
      //     socketId: socket.id,
      //     transport: transport,
      //   };
      // }
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  socket.on('stopScreenShare', ({ roomName, producerId }) => {
    // 1. Close and remove the screen producer
    if (producerId) {
      const producerData = state.producers.find(p => p.producer.id === producerId);
      if (producerData) {
        try { producerData.producer.close(); } catch { /* empty */ }
        state.producers = state.producers.filter(p => p.producer.id !== producerId);
      }
    }

    state.transports = state.transports.filter(t => {
      if (t.socketId === socket.id && t.isScreen) {
        try { t.transport.close(); } catch { /* empty */ }
        return false;
      }
      return true;
    });
  });

  const addTransport = (transport: WebRtcTransport, roomname: string, isConsumer: boolean, isScreen: boolean) => {
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

  const informConsumers = (roomName: string, producerSocketId: string, producerId: string, mediaType: MediaType) => {
    console.log(`New ${mediaType} producer joined in room ${roomName}, socket ${producerSocketId}:`, producerId);
    const isProducerMainRoom = state.mainRoomDevices[roomName]?.includes(producerSocketId);

    if (!state.remoteAssignments[roomName]) {
      state.remoteAssignments[roomName] = {};
    }

    if (isProducerMainRoom) {
      // Only inform remote users, not other main room devices
      console.log("Informing consumers that are not main room devices for socket:",);
      Object.keys(state.peers).forEach(socketId => {
        if (
          state.peers[socketId].roomName === roomName &&
          !state.mainRoomDevices[roomName]?.includes(socketId) &&
          socketId !== producerSocketId
        ) {
          state.peers[socketId].socket.emit("new-producer", { producerId, mediaType });
        }
      });
    } else {
      // Remote user: inform the assigned main room device
      const assignedDevice = state.remoteAssignments[roomName][producerSocketId];
      if (assignedDevice && state.peers[assignedDevice]) {
        state.peers[assignedDevice].socket.emit("new-producer", { producerId, mediaType });
      }
      Object.keys(state.peers).forEach(socketId => { //notify all remote users
        if (
          state.peers[socketId].roomName === roomName &&
          !state.mainRoomDevices[roomName]?.includes(socketId) &&
          socketId !== producerSocketId
        ) {
          state.peers[socketId].socket.emit("new-producer", { producerId, mediaType });
        }
      });

    }
  };

  const addProducer = (producer: Producer, roomName: string, mediaType: MediaType) => {
    state.producers = [...state.producers, { socketId: socket.id, producer, roomName, mediaType }];

    state.peers[socket.id] = {
      ...state.peers[socket.id],
      producers: [...state.peers[socket.id].producers, producer.id],
    };
  };
}