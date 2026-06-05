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
      
      const room = roomManager.getRoom(roomName, 'CREATE_WEBRTC_TRANSPORT');
      const transport: WebRtcTransport = await createWebRtcTransport(room.router, room.webRtcServer);
      
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
          sctpParameters: transport.sctpParameters,
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

    
    let isDevice = false;
    try {
      isDevice = roomManager.getRoom(roomName)?.peers.get(socket.id)?.isRoomDevice ?? false;
    } catch { /* room may already be gone */ }

    if (isDevice) {
      handleDeviceLeave(socket.id, namespace, roomManager);
    } else {
      unassignRemoteOnLeave(socket.id, namespace, roomManager);
    }

    
    leaveRoom(roomManager, roomName, socket.id);
  });

  socket.on(ACTIONS.CONNECT_SEND_TRANSPORT, async ({ dtlsParameters, roomName: payloadRoomName }, callback) => {
    try {
      const roomName = payloadRoomName || roomManager.socketToRoom.get(socket.id);
      const sendTransport = roomManager.getRoom(roomName || "", "CONNECT_SEND_TRANSPORT")?.getPeer(socket.id)?.sendTransport;
      
      if (!sendTransport) {
        console.error('[CONNECT_SEND_TRANSPORT] Send transport not found for socket', socket.id, 'room', roomName);
        return callback({ error: 'Send transport not found' });
      }
      
      
      await sendTransport.connect({ dtlsParameters });
      callback({ connected: true });
    } catch (error) {
      console.error("Error connecting transport:", error);
      callback({ error: error });
    }
  });

  socket.on(
    ACTIONS.TRANSPORT_PRODUCE,
    async ({ kind, rtpParameters, roomName: payloadRoomName }, callback) => {
      try {
        
        const roomName = payloadRoomName || roomManager.socketToRoom.get(socket.id);
        const peer = roomManager.getRoom(roomName || "", "TRANSPORT_PRODUCE")?.getPeer(socket.id);

        if (!peer) {
          console.error('[TRANSPORT_PRODUCE] Peer not found for socket', socket.id);
          return callback({ error: 'Peer not found' });
        }

        const transport = peer.sendTransport;
        if (!transport) {
          console.error('[TRANSPORT_PRODUCE] Send transport not ready for peer', socket.id);
          return callback({ error: 'Send transport not ready' });
        }

        const producer = await transport.produce({ kind, rtpParameters });
        console.log("[TRANSPORT_PRODUCE] Created server-side producer with id: ", producer.id, " for user: ", peer.userName, " isRoomDevice:", peer.isRoomDevice);

        
        peer.addProducer(producer);
        console.log("[TRANSPORT_PRODUCE] Peer", peer.id, "now has", peer.producers.size, "producers");
        

        informConsumers(
          roomName!,
          socket.id,
          producer.id,
        );
        
        console.log("peer count: ", roomManager.getRoom(roomName!, "TRANSPORT_PRODUCE")!.peers.size);
        callback({
          id: producer.id,
          producersExist: roomManager.getRoom(roomName!, "TRANSPORT_PRODUCE")!.peers.size > 1, 
        });
      } catch (err) {
        console.error('[TRANSPORT_PRODUCE] Error:', err);
        callback({ error: String(err) });
      }
    }
  );

  socket.on(
    ACTIONS.TRANSPORT_RECV_CONNECT,
    async ({ dtlsParameters, serverConsumerTransportId }, callback) => {
      const roomName = roomManager.socketToRoom.get(socket.id);
      
      const peer = roomManager.getRoom(roomName || "", "TRANSPORT_RECV_CONNECT")?.getAllPeers().find(p => p.recvTransport?.id === serverConsumerTransportId);
      const consumerTransport = peer?.recvTransport; 

      
      await consumerTransport?.connect({ dtlsParameters });
      callback({ connected: true });
    }
  );

  
  socket.on(ACTIONS.STOP_SCREEN_SHARE, ({ roomName, producerId }) => {
    try {
      const room = roomManager.getRoom(roomName, 'STOP_SCREEN_SHARE');
      if (!room) return;

      const allPeers = room.getAllPeers();

      
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

  
  const informConsumers = (roomName: string, producerSocketId: string, producerId: string) => {
    try {
      const room = roomManager.getRoom(roomName || "", "INFORM_CONSUMERS");
      const producerPeer = room.getPeer(producerSocketId);
      
      console.log(`New producer joined in room ${roomName}, user ${producerPeer.userName}. ID:`, producerId);
      
      
      room?.getAllPeers().forEach(consumerPeer => {
        if (consumerPeer.id === producerSocketId) return; 
        
        
        if (producerPeer.isRoomDevice && consumerPeer.isRoomDevice) {
          
          return;
        }
        
        if (producerPeer.isRoomDevice && !consumerPeer.isRoomDevice) {
          
          const producerSlot = room.getSlotForRemote(consumerPeer.id);
          if (!producerSlot || producerSlot.deviceSocketId !== producerSocketId) {
            
            return;
          }
        }
        
        if (!producerPeer.isRoomDevice && consumerPeer.isRoomDevice) {
          
          
          console.log("Notifying room device", consumerPeer.userName, "about new producer from remote", producerPeer.userName);
          consumerPeer.socket.emit(ACTIONS.NEW_PRODUCER, { producerId, socketId: producerSocketId });
          return;
        }
        
        
        console.log("Notifying", consumerPeer.userName, "about new producer from", producerPeer.userName);
        consumerPeer.socket.emit(ACTIONS.NEW_PRODUCER, { producerId, socketId: producerSocketId });
      });
    } catch (err) {
      console.error("[informConsumers] error:", err);
    }
    
    
  };

  
}