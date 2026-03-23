import { WebRtcTransport } from "mediasoup/node/lib/types";
import { Socket, Namespace } from "socket.io";
import { createWebRtcTransport, leaveRoom } from "../mediasoup/utils";
import { SharedState } from "../types";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";
import { handleDeviceLeave, unassignRemoteOnLeave } from "./hybridHandlers";


export function registerTransportHandlers(socket: Socket, state: SharedState, roomManager: RoomManager, namespace: Namespace) {
  socket.on(ACTIONS.CREATE_WEBRTC_TRANSPORT, async ({ isConsumer, roomName }, callback) => {
    try {
      // get room name from peer's props
      const room = roomManager.getRoom(roomName, 'CREATE_WEBRTC_TRANSPORT');
      const transport: WebRtcTransport = await createWebRtcTransport(room.router, room.webRtcServer);
      // add transport to Peer's props
      console.log("Creating a ", isConsumer ? 'recv ' : 'send ', "WebRTC transport with ID ", transport.id, " for user: ", room.getPeer(socket.id).userName);

      if (isConsumer) {
        room.getPeer(socket.id)?.setRecvTransport(transport);
      } else {
        room.getPeer(socket.id)?.setSendTransport(transport);
      }
      callback({
        success: true,
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    } catch (error) {
      console.error("Error creating WebRTC transport:", error);
      callback({
        success: false,
        error: "Failed to create WebRTC transport",
      });

    }
  });

  socket.on(ACTIONS.DISCONNECT, () => {
    const roomName = roomManager.socketToRoom.get(socket.id);
    if (!roomName) return;

    // Hybrid cleanup: handle device leave or remote unassignment before
    // leaveRoom() removes the peer from the room (we need peer data still intact)
    let isDevice = false;
    try {
      isDevice = roomManager.getRoom(roomName)?.peers.get(socket.id)?.isRoomDevice ?? false;
    } catch { /* room may already be gone */ }

    if (isDevice) {
      handleDeviceLeave(socket.id, namespace, roomManager);
    } else {
      unassignRemoteOnLeave(socket.id, namespace, roomManager);
    }

    // Clean up mediasoup resources (transports, producers, consumers)
    leaveRoom(roomManager, roomName, socket.id);
  });

  socket.on(ACTIONS.CONNECT_SEND_TRANSPORT, async ({ dtlsParameters }, callback) => {
    try {
      const roomName = roomManager.socketToRoom.get(socket.id);
      const sendTransport = roomManager.getRoom(roomName || "", "CONNECT_SEND_TRANSPORT")?.getPeer(socket.id)?.sendTransport;
      // const transport = getTransport(socket.id);
      await sendTransport.connect({ dtlsParameters });
      callback({ connected: true });
    } catch (error) {
      console.error("Error connecting transport:", error);
      callback({ error: error });
    }
  });

  socket.on(
    ACTIONS.TRANSPORT_PRODUCE,
    async ({ kind, rtpParameters, }, callback) => {
      // call produce based on the prameters from the client
      const roomName = roomManager.socketToRoom.get(socket.id);
      const peer = roomManager.getRoom(roomName || "", "TRANSPORT_PRODUCE")?.getPeer(socket.id);

      const transport = peer?.sendTransport;
      const producer = await transport!.produce({ kind, rtpParameters });
      // console.log("Created server-side producer with id: ", producer.id, " for user: ", peer.userName);

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
      console.log("peer count: ", roomManager.getRoom(roomName!, "TRANSPORT_PRODUCE")!.peers.size);
      callback({
        id: producer.id,
        producersExist: roomManager.getRoom(roomName!, "TRANSPORT_PRODUCE")!.peers.size > 1, //check, if there are other producers, when connection into the room
      });
    }
  );

  socket.on(
    ACTIONS.TRANSPORT_RECV_CONNECT,
    async ({ dtlsParameters, serverConsumerTransportId }, callback) => {
      const roomName = roomManager.socketToRoom.get(socket.id);
      // const peer = roomManager.getRoom(roomName!).getPeer(socket.id);
      const peer = roomManager.getRoom(roomName || "", "TRANSPORT_RECV_CONNECT")?.getAllPeers().find(p => p.recvTransport?.id === serverConsumerTransportId);
      const consumerTransport = peer?.recvTransport; //TODO check if right implementation

      // const consumerTransport = state.transports.find(
      //   (transportData) =>
      //     transportData.isConsumer &&
      //     transportData.transport.id == serverConsumerTransportId &&
      //     transportData.isScreen == (mediaType == "screen")
      // )?.transport;
      // console.log("conncting consumer transport:", consumerTransport?.id);
      await consumerTransport?.connect({ dtlsParameters });
      callback({ connected: true });
    }
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  socket.on(ACTIONS.STOP_SCREEN_SHARE, ({ roomName, producerId }) => {
    try {
      const room = roomManager.getRoom(roomName, 'STOP_SCREEN_SHARE');
      if (!room) return;

      const allPeers = room.getAllPeers();

      // Find the producer and close it
      const producerPeer = allPeers.find(peer => peer.producers.has(producerId));
      if (producerPeer && producerId) {
        const producer = producerPeer.producers.get(producerId);
        if (producer) {
          try {
            producer.close();
          } catch (err) {
            console.error('Error closing screen producer:', err);
          }
          producerPeer.removeProducer(producerId);
        }
      }

      // Find and close all consumers that were consuming this producer on other peers
      allPeers.forEach(peer => {
        if (peer.id !== socket.id) {
          peer.consumers.forEach((consumer, consumerId) => {
            if (consumer.producerId === producerId) {
              try {
                consumer.close();
                peer.removeConsumer(consumerId);
              } catch (err) {
                console.error('Error closing consumer:', err);
              }
              // Notify the peer that the producer closed
              peer.socket.emit(ACTIONS.PRODUCER_CLOSED, { remoteProducerId: producerId });
            }
          });
        }
      });

      console.log(`Screen share stopped for producer: ${producerId} in room: ${roomName}`);
    } catch (error) {
      console.error('Error in STOP_SCREEN_SHARE handler:', error);
    }
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
    try {
      const room = roomManager.getRoom(roomName || "", "INFORM_CONSUMERS");
      const producerPeer = room.getPeer(producerSocketId);
      
      console.log(`New producer joined in room ${roomName}, user ${producerPeer.userName}. ID:`, producerId);
      
      // Determine who should be notified about this producer
      room?.getAllPeers().forEach(consumerPeer => {
        if (consumerPeer.id === producerSocketId) return; // Don't notify the producer itself
        
        // Hybrid logic: filter based on peer roles and assignments
        if (producerPeer.isRoomDevice && consumerPeer.isRoomDevice) {
          // Room device → room device: don't notify (devices don't consume each other's cameras)
          return;
        }
        
        if (producerPeer.isRoomDevice && !consumerPeer.isRoomDevice) {
          // Room device → remote: check if remote is assigned to this device's slot
          const producerSlot = room.getSlotForRemote(consumerPeer.id);
          if (!producerSlot || producerSlot.deviceSocketId !== producerSocketId) {
            // Remote is not assigned to this device's slot, don't notify
            return;
          }
        }
        
        // All other cases: notify (remote → remote, remote → room device, etc.)
        console.log("Notifying", consumerPeer.userName, "about new producer from", producerPeer.userName);
        consumerPeer.socket.emit(ACTIONS.NEW_PRODUCER, { producerId, socketId: producerSocketId });
      });
    } catch (err) {
      console.error("[informConsumers] error:", err);
    }
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