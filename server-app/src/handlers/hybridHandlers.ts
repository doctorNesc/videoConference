import { Socket, Namespace } from "socket.io";
import { RoomManager } from "../core/roomManager";
import { ACTIONS } from "../config/actions";
import { RoomDeviceCapabilities, RemoteAssignment } from "../types";

/**
 * Registers all socket handlers related to hybrid room communication.
 *
 * Why `namespace` (Namespace) is needed here (and not just `socket`):
 *   - `socket.emit(...)` sends only to THIS connected client.
 *   - `namespace.to(roomName).emit(...)` broadcasts to ALL clients in a socket.io room.
 *   - `namespace.to(socketId).emit(...)` sends to a specific client by socket ID.
 * These are required for topology broadcasts and targeted assignment updates.
 * The namespace is `io.of("/mediasoup")` — the same namespace all clients connect to.
 */
export function registerHybridHandlers(
    socket: Socket,
    namespace: Namespace,
    roomManager: RoomManager,
) {
    // ─── REGISTER_ROOM_DEVICE ─────────────────────────────────────────────────
    // Emitted by a physical room device after joining the room.
    // Creates unpaired ScreenSlots for each advertised screen.
    socket.on(
        ACTIONS.REGISTER_ROOM_DEVICE,
        ({ capabilities }: { capabilities: RoomDeviceCapabilities }, callback?: Function) => {
            try {
                const roomName = roomManager.socketToRoom.get(socket.id);
                if (!roomName) {
                    console.warn("[REGISTER_ROOM_DEVICE] socket not in any room:", socket.id);
                    callback?.({ error: "not-in-room" });
                    return;
                }

                const room = roomManager.getRoom(roomName, "REGISTER_ROOM_DEVICE");
                const peer = room.getPeer(socket.id);

                // Store capabilities on the peer
                peer.setCapabilities(capabilities);

                // Create unpaired slots
                const newSlots = room.registerDevice(socket.id, capabilities);

                // Broadcast updated topology to everyone in the socket.io room
                const topologyDTO = room.getTopologyDTO();
                namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);

                console.log(
                    `[HYBRID] Device ${socket.id} (${peer.userName}) registered with`,
                    capabilities.screens.length, "screen(s) and",
                    capabilities.cameras.length, "camera(s)"
                );

                callback?.({ success: true, slots: newSlots.map(s => s.slotId) });
            } catch (err) {
                console.error("[REGISTER_ROOM_DEVICE] error:", err);
                callback?.({ error: String(err) });
            }
        }
    );

    // ─── SCREEN_CAMERA_PAIRING ────────────────────────────────────────────────
    // Emitted by a room device after the pairing wizard is completed.
    // Links each slot to a specific camera device.
    socket.on(
        ACTIONS.SCREEN_CAMERA_PAIRING,
        (
            { pairings }: { pairings: { slotId: string; cameraDeviceId: string; cameraLabel: string }[] },
            callback?: Function
        ) => {
            try {
                const roomName = roomManager.socketToRoom.get(socket.id);
                if (!roomName) {
                    callback?.({ error: "not-in-room" });
                    return;
                }

                const room = roomManager.getRoom(roomName, "SCREEN_CAMERA_PAIRING");

                // Apply pairings
                room.applyScreenCameraPairing(pairings);

                // Rebalance: now that slots are paired, assign any waiting remotes
                const newAssignments = room.rebalanceAssignments();

                // Notify each reassigned remote of their new assignment
                newAssignments.forEach((slot, remoteSocketId) => {
                    const assignment: RemoteAssignment = {
                        slotId: slot.slotId,
                        screenLabel: slot.screenLabel,
                        cameraProducerId: slot.cameraProducerId,
                        deviceSocketId: slot.deviceSocketId,
                    };
                    namespace.to(remoteSocketId).emit(ACTIONS.ASSIGNMENT_UPDATE, assignment);
                });

                // Notify room device of its assigned remotes per slot
                notifyDeviceOfSlotAssignments(socket.id, room, namespace);

                // Broadcast updated topology to all peers in the room
                const topologyDTO = room.getTopologyDTO();
                namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);

                callback?.({ success: true });
            } catch (err) {
                console.error("[SCREEN_CAMERA_PAIRING] error:", err);
                callback?.({ error: String(err) });
            }
        }
    );

    // ─── CAMERA_PRODUCER_REGISTERED ───────────────────────────────────────────
    // Emitted by a room device when it starts streaming a camera.
    // Links the mediasoup producer ID to the slot so remotes can consume it.
    socket.on(
        ACTIONS.CAMERA_PRODUCER_REGISTERED,
        ({ slotId, producerId }: { slotId: string; producerId: string }, callback?: Function) => {
            try {
                const roomName = roomManager.socketToRoom.get(socket.id);
                if (!roomName) {
                    callback?.({ error: "not-in-room" });
                    return;
                }

                const room = roomManager.getRoom(roomName, "CAMERA_PRODUCER_REGISTERED");
                const slot = room.registerCameraProducer(slotId, producerId);

                if (!slot) {
                    callback?.({ error: "slot-not-found" });
                    return;
                }

                // Notify all remotes assigned to this slot of the updated producer
                slot.assignedRemoteIds.forEach((remoteSocketId) => {
                    const assignment: RemoteAssignment = {
                        slotId: slot.slotId,
                        screenLabel: slot.screenLabel,
                        cameraProducerId: slot.cameraProducerId,
                        deviceSocketId: slot.deviceSocketId,
                    };
                    namespace.to(remoteSocketId).emit(ACTIONS.ASSIGNMENT_UPDATE, assignment);
                });

                // Broadcast updated topology to all peers
                const topologyDTO = room.getTopologyDTO();
                namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);

                callback?.({ success: true });
            } catch (err) {
                console.error("[CAMERA_PRODUCER_REGISTERED] error:", err);
                callback?.({ error: String(err) });
            }
        }
    );

    // ─── GET_ROOM_TOPOLOGY ────────────────────────────────────────────────────
    // Client requests the current topology (e.g. for 3D visualization).
    socket.on(ACTIONS.GET_ROOM_TOPOLOGY, (_: any, callback?: Function) => {
        try {
            const roomName = roomManager.socketToRoom.get(socket.id);
            if (!roomName) {
                callback?.({ error: "not-in-room" });
                return;
            }
            const room = roomManager.getRoom(roomName, "GET_ROOM_TOPOLOGY");
            callback?.(room.getTopologyDTO());
        } catch (err) {
            console.error("[GET_ROOM_TOPOLOGY] error:", err);
            callback?.({ error: String(err) });
        }
    });

    // ─── UNREGISTER_ROOM_DEVICE ───────────────────────────────────────────────
    // Explicit unregister (also called internally on disconnect).
    socket.on(ACTIONS.UNREGISTER_ROOM_DEVICE, (_: any, callback?: Function) => {
        handleDeviceLeave(socket.id, namespace, roomManager);
        callback?.({ success: true });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported helpers (used by roomHandlers and transportHandlers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles cleanup when a room device disconnects or explicitly unregisters.
 * Removes its slots, rebalances remaining remotes, and broadcasts topology update.
 */
export function handleDeviceLeave(
    deviceSocketId: string,
    namespace: Namespace,
    roomManager: RoomManager,
) {
    const roomName = roomManager.socketToRoom.get(deviceSocketId);
    if (!roomName) return;

    let room;
    try {
        room = roomManager.getRoom(roomName, "handleDeviceLeave");
    } catch {
        return; // room already gone
    }

    // Check if this socket was actually a room device
    if (!room.topology.deviceSockets.has(deviceSocketId)) return;

    // Remove device slots and get displaced remotes
    room.unregisterDevice(deviceSocketId);

    // Rebalance remaining remotes across remaining slots
    const newAssignments = room.rebalanceAssignments();

    // Notify each reassigned remote of their new slot
    newAssignments.forEach((slot, remoteSocketId) => {
        const assignment: RemoteAssignment = {
            slotId: slot.slotId,
            screenLabel: slot.screenLabel,
            cameraProducerId: slot.cameraProducerId,
            deviceSocketId: slot.deviceSocketId,
        };
        namespace.to(remoteSocketId).emit(ACTIONS.ASSIGNMENT_UPDATE, assignment);
    });

    // Broadcast updated topology to all peers
    const topologyDTO = room.getTopologyDTO();
    namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);

    console.log(`[HYBRID] Device ${deviceSocketId} left room ${roomName}, topology updated`);
}

/**
 * Handles assignment when a remote participant joins a room that already has
 * paired slots. Called from roomHandlers after JOIN_ROOM.
 * Returns the assignment (for inclusion in the JOIN_ROOM callback), or null.
 */
export function assignRemoteOnJoin(
    remoteSocketId: string,
    remoteName: string,
    namespace: Namespace,
    roomManager: RoomManager,
): RemoteAssignment | null {
    const roomName = roomManager.socketToRoom.get(remoteSocketId);
    if (!roomName) return null;

    let room;
    try {
        room = roomManager.getRoom(roomName, "assignRemoteOnJoin");
    } catch {
        return null;
    }

    const slot = room.assignRemoteToSlot(remoteSocketId);
    if (!slot) return null;

    const assignment: RemoteAssignment = {
        slotId: slot.slotId,
        screenLabel: slot.screenLabel,
        cameraProducerId: slot.cameraProducerId,
        deviceSocketId: slot.deviceSocketId,
    };

    // Notify the room device that owns this slot
    namespace.to(slot.deviceSocketId).emit(ACTIONS.SLOT_REMOTE_JOINED, {
        slotId: slot.slotId,
        remoteSocketId,
        remoteName,
    });

    return assignment;
}

/**
 * Handles cleanup when a remote participant leaves.
 * Removes their assignment and notifies the room device.
 */
export function unassignRemoteOnLeave(
    remoteSocketId: string,
    namespace: Namespace,
    roomManager: RoomManager,
) {
    const roomName = roomManager.socketToRoom.get(remoteSocketId);
    if (!roomName) return;

    let room;
    try {
        room = roomManager.getRoom(roomName, "unassignRemoteOnLeave");
    } catch {
        return;
    }

    const slot = room.unassignRemote(remoteSocketId);
    if (!slot) return;

    // Notify the room device that owns this slot
    namespace.to(slot.deviceSocketId).emit(ACTIONS.SLOT_REMOTE_LEFT, {
        slotId: slot.slotId,
        remoteSocketId,
    });

    // Broadcast updated topology
    const topologyDTO = room.getTopologyDTO();
    namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends SLOT_REMOTE_JOINED notifications to a room device for all its current
 * slot assignments. Used after pairing wizard completes to sync the device UI.
 */
function notifyDeviceOfSlotAssignments(
    deviceSocketId: string,
    room: import("../core/roomManager").Room,
    namespace: Namespace,
) {
    for (const slot of room.topology.slots.values()) {
        if (slot.deviceSocketId !== deviceSocketId) continue;
        for (const remoteSocketId of slot.assignedRemoteIds) {
            let remoteName = "Unknown";
            try {
                remoteName = room.getPeer(remoteSocketId)?.userName ?? "Unknown";
            } catch { /* peer may have left */ }

            namespace.to(deviceSocketId).emit(ACTIONS.SLOT_REMOTE_JOINED, {
                slotId: slot.slotId,
                remoteSocketId,
                remoteName,
            });
        }
    }
}
