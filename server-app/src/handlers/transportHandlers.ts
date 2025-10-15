import { WebRtcTransport } from "mediasoup/node/lib/types";
import { Socket } from "socket.io";
import { createWebRtcTransport } from "../mediasoup/utils";
import { SharedState } from "../types";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";


export function registerTransportHandlers(socket: Socket, state: SharedState, roomManager: RoomManager) {
  socket.on(ACTIONS.CREATE_WEBRTC_TRANSPORT, async ({ roomName, isConsumer }, callback) => {
    try {
      // get room name from peer's props
      const room = roomManager.getRoom(roomName);
      console.log("Creating WebRTC transport for room:", roomName);
      const transport: WebRtcTransport = await createWebRtcTransport(room.router, room.webRtcServer);
      // add transport to Peer's props
      if (isConsumer) {
        room.getPeer(socket.id)?.setRecvTransport(transport);
      } else {
        room.getPeer(socket.id)?.setSendTransport(transport);
      }
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

  socket.on(ACTIONS.DISCONNECT, () => {

    const roomName = roomManager.socketToRoom.get(socket.id);
    if (!roomName) return;
    const room = roomManager.getRoom(roomName);
    const peer = room.getPeer(socket.id);

    if (peer) {
      peer.close();              // cleanup resources
      room.removePeer(socket.id);  // remove from room
      roomManager.socketToRoom.delete(socket.id);
    }
    roomManager.socketToRoom.delete(socket.id);

    // if (state.peers[socket.id]) {
    //   const { roomName } = state.peers[socket.id];

    //   const mainDevices = state.mainRoomDevices[roomName] || [];
    //   const wasMainRoom = mainDevices.includes(socket.id);

    // state.mainRoomDevices[roomName] = mainDevices.filter(id => id !== socket.id);
    // if (wasMainRoom) {
    //   console.log("mainRoom peer disconnected");
    //   const assignments = state.remoteAssignments[roomName] || {};
    //   Object.entries(assignments).forEach(([remoteId, assignedDevice]) => {
    //     if (assignedDevice === socket.id) {
    //       // Reassign this remote user to another main room device
    //       const devices = state.mainRoomDevices[roomName];
    //       if (devices && devices.length > 0) {
    //         // Use your round-robin function
    //         const newDevice = devices.reduce((a, b) => {
    //           const aCount = Object.values(assignments).filter(id => id === a).length;
    //           const bCount = Object.values(assignments).filter(id => id === b).length;
    //           return aCount <= bCount ? a : b;
    //         });
    //         assignments[remoteId] = newDevice;
    //       } else {
    //         // No devices left, remove assignment
    //         delete assignments[remoteId];
    //       }
    //     }
    //   });
    //   // Clean up all transports for this socket
    //   state.transports = state.transports.filter((t) => {
    //     if (t.socketId === socket.id) {
    //       t.transport.close();
    //       return false;
    //     }
    //     return true;
    //   });

    //   delete state.peers[socket.id];

    //   state.remoteAssignments[roomName] = assignments;
    // }

    // remove socket from room
    //     state.rooms[roomName] = {
    //       router: state.rooms[roomName].router,
    //       peers: state.rooms[roomName].peers.filter(
    //         (socketId) => socketId !== socket.id
    //       ),
    //     };
    //   }
  });

  socket.on(ACTIONS.CONNECT_TRANSPORT, async ({ dtlsParameters }) => {
    try {
      const roomName = roomManager.socketToRoom.get(socket.id);
      const transport = roomManager.getRoom(roomName || "")?.getPeer(socket.id)?.sendTransport;
      // const transport = getTransport(socket.id);


      await transport.connect({ dtlsParameters });
    } catch (error) {
      console.error("Error connecting transport:", error);
    }
  });

  socket.on(
    ACTIONS.PRODUCE,
    async ({ kind, rtpParameters, }, callback) => {
      // call produce based on the prameters from the client
      // let transport;
      // if (isScreen) {
      //   transport = getScreenTransport(socket.id);
      // } else {
      //   transport = getTransport(socket.id);
      // }
      const roomName = roomManager.socketToRoom.get(socket.id);
      const peer = roomManager.getRoom(roomName || "")?.getPeer(socket.id);

      const transport = peer?.sendTransport;
      const producer = await transport!.produce({ kind, rtpParameters });

      // const roomName = state.peers[socket.id].roomName;

      // if (isScreen && producer) { //add screenProducer to a list to close it later
      //   state.screenProducerTransports[producer.id] = {
      //     socketId: socket.id,
      //     transport: transport,
      //   };
      // }
      peer?.addProducer(producer);
      // addProducer(producer, roomName, isScreen ? "screen" : "camera");

      informConsumers(
        roomName!,
        socket.id,
        producer.id,
      );
      // Send back to the client the Producer's id
      callback({
        id: producer.id,
        producersExist: peer.producers.size > 0 ? true : false,
      });
    }
  );

  socket.on(
    ACTIONS.TRANSPORT_RECV_CONNECT,
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      const roomName = roomManager.socketToRoom.get(socket.id);
      const peer = roomManager.getRoom(roomName || "")?.getAllPeers().find(p => p.recvTransport?.id === serverConsumerTransportId);
      const consumerTransport = peer?.recvTransport; //TODO check if right implementation

      // const consumerTransport = state.transports.find(
      //   (transportData) =>
      //     transportData.isConsumer &&
      //     transportData.transport.id == serverConsumerTransportId &&
      //     transportData.isScreen == (mediaType == "screen")
      // )?.transport;
      await consumerTransport?.connect({ dtlsParameters });
    }
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  socket.on(ACTIONS.STOP_SCREEN_SHARE, ({ roomName, producerId }) => {
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

  // const getTransport = (socketId: SocketId) => {
  //   const producerTransport = state.transports.find(
  //     (transport) =>
  //       transport.socketId === socketId &&
  //       !transport.isConsumer &&
  //       !transport.isScreen
  //   );
  //   return producerTransport?.transport;
  // };

  // const getScreenTransport = (socketId: SocketId) => {
  //   const producerTransport = state.transports.find(
  //     (transport) =>
  //       transport.socketId === socketId &&
  //       !transport.isConsumer &&
  //       transport.isScreen
  //   );
  //   return producerTransport?.transport;
  // };

  const informConsumers = (roomName: string, producerSocketId: string, producerId: string) => {
    console.log(`New producer joined in room ${roomName}, socket ${producerSocketId}:`, producerId);
    // const isProducerMainRoom = state.mainRoomDevices[roomName]?.includes(producerSocketId);

    // if (!state.remoteAssignments[roomName]) {
    //   state.remoteAssignments[roomName] = {};
    // }

    // if (isProducerMainRoom) {
    // Only inform remote users, not other main room devices
    const room = roomManager.getRoom(roomName || "");
    room?.getAllPeers().forEach(element => {
      if (element.id != producerSocketId) {
        element.socket.emit(ACTIONS.NEW_PRODUCER, { producerId });
      }
    });
    // Object.keys(state.peers).forEach(socketId => {
    //   if (
    //     state.peers[socketId].roomName === roomName &&
    //     !state.mainRoomDevices[roomName]?.includes(socketId) &&
    //     socketId !== producerSocketId
    //   ) {
    //     state.peers[socketId].socket.emit("new-producer", { producerId });
    //   }
    // });
    // } else {
    //   // Remote user: inform the assigned main room device
    //   const assignedDevice = state.remoteAssignments[roomName][producerSocketId];
    //   if (assignedDevice && state.peers[assignedDevice]) {
    //     state.peers[assignedDevice].socket.emit("new-producer", { producerId, mediaType });
    //   }
    //   Object.keys(state.peers).forEach(socketId => { //notify all remote users
    //     if (
    //       state.peers[socketId].roomName === roomName &&
    //       !state.mainRoomDevices[roomName]?.includes(socketId) &&
    //       socketId !== producerSocketId
    //     ) {
    //       state.peers[socketId].socket.emit("new-producer", { producerId, mediaType });
    //     }
    //   });

    // }
  };

  // const addProducer = (producer: Producer, roomName: string, mediaType: MediaType) => {
  //   state.producers = [...state.producers, { socketId: socket.id, producer, roomName, mediaType }];

  //   state.peers[socket.id] = {
  //     ...state.peers[socket.id],
  //     producers: [...state.peers[socket.id].producers, producer.id],
  //   };
  // };
}