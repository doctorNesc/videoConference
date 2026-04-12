import { Socket, Namespace } from "socket.io";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";

/**
 * Handles mediasoup DataChannel signalling:
 *   PRODUCE_DATA         – client fires this via the 'producedata' transport event;
 *                          server creates a DataProducer and notifies other peers.
 *   CONSUME_DATA         – client wants to consume a remote DataProducer.
 *   DATA_CONSUMER_RESUME – client signals it is ready to receive data.
 *
 * Chat messages travel entirely over the SCTP DataChannel — no socket.io
 * events are used for message content.
 */
export function registerDataChannelHandlers(
  socket: Socket,
  nsp: Namespace,
  roomManager: RoomManager,
) {
  // ─── PRODUCE_DATA ──────────────────────────────────────────────────────────
  // Triggered by the mediasoup-client 'producedata' transport event.
  socket.on(ACTIONS.PRODUCE_DATA, async ({ sctpStreamParameters, label, protocol, appData }, callback) => {
    try {
      const roomName = roomManager.socketToRoom.get(socket.id);
      if (!roomName) return callback({ error: "Not in a room" });

      const room = roomManager.getRoom(roomName, "PRODUCE_DATA");
      const peer = room.getPeer(socket.id);

      if (!peer.sendTransport) {
        return callback({ error: "Send transport not ready" });
      }

      const dataProducer = await peer.sendTransport.produceData({
        sctpStreamParameters,
        label: label ?? "chat",
        protocol: protocol ?? "",
        appData: appData ?? {},
      });

      peer.addDataProducer(dataProducer);

      console.log(
        `[PRODUCE_DATA] peer ${peer.userName} created DataProducer ${dataProducer.id} (label: ${dataProducer.label})`
      );

      // Collect existing DataProducers from all other peers so the new peer
      // can consume them (handles the "late joiner" case).
      const existingDataProducers: { dataProducerId: string; socketId: string; userName: string }[] = [];
      room.getAllPeers().forEach((otherPeer) => {
        if (otherPeer.id === socket.id) return;

        // Notify existing peers about the new DataProducer
        otherPeer.socket.emit(ACTIONS.NEW_DATA_PRODUCER, {
          dataProducerId: dataProducer.id,
          socketId: socket.id,
          userName: peer.userName,
        });

        // Collect this peer's DataProducers for the new peer
        otherPeer.dataProducers.forEach((dp) => {
          existingDataProducers.push({
            dataProducerId: dp.id,
            socketId: otherPeer.id,
            userName: otherPeer.userName,
          });
        });
      });

      callback({ id: dataProducer.id, existingDataProducers });
    } catch (err) {
      console.error("[PRODUCE_DATA] error:", err);
      callback({ error: String(err) });
    }
  });

  // ─── CONSUME_DATA ──────────────────────────────────────────────────────────
  // The requesting socket is the consumer; serverConsumerTransportId identifies
  // which of its recv transports to use.
  socket.on(ACTIONS.CONSUME_DATA, async ({ dataProducerId, serverConsumerTransportId }, callback) => {
    try {
      const roomName = roomManager.socketToRoom.get(socket.id);
      if (!roomName) return callback({ error: "Not in a room" });

      const room = roomManager.getRoom(roomName, "CONSUME_DATA");

      // The consuming peer is the one making this request
      const consumerPeer = room.getPeer(socket.id);

      if (!consumerPeer.recvTransport || consumerPeer.recvTransport.id !== serverConsumerTransportId) {
        return callback({ error: "Consumer transport not found or ID mismatch" });
      }

      const dataConsumer = await consumerPeer.recvTransport.consumeData({
        dataProducerId,
      });

      consumerPeer.addDataConsumer(dataConsumer);

      console.log(
        `[CONSUME_DATA] peer ${consumerPeer.userName} consuming DataProducer ${dataProducerId} via DataConsumer ${dataConsumer.id}`
      );

      callback({
        id: dataConsumer.id,
        dataProducerId: dataConsumer.dataProducerId,
        sctpStreamParameters: dataConsumer.sctpStreamParameters,
        label: dataConsumer.label,
        protocol: dataConsumer.protocol,
      });
    } catch (err) {
      console.error("[CONSUME_DATA] error:", err);
      callback({ error: String(err) });
    }
  });

  // ─── DATA_CONSUMER_RESUME ──────────────────────────────────────────────────
  socket.on(ACTIONS.DATA_CONSUMER_RESUME, async ({ serverDataConsumerId }, callback) => {
    try {
      const roomName = roomManager.socketToRoom.get(socket.id);
      if (!roomName) return callback?.({ error: "Not in a room" });

      const room = roomManager.getRoom(roomName, "DATA_CONSUMER_RESUME");
      const peer = room.getPeer(socket.id);
      const dataConsumer = peer.dataConsumers.get(serverDataConsumerId);

      if (!dataConsumer) {
        return callback?.({ error: "DataConsumer not found" });
      }

      await dataConsumer.resume();
      callback?.({ resumed: true });
    } catch (err) {
      console.error("[DATA_CONSUMER_RESUME] error:", err);
      callback?.({ error: String(err) });
    }
  });
}
