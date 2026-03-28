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
    // If savedPairings are provided, applies them immediately (skip wizard).
    socket.on(
        ACTIONS.REGISTER_ROOM_DEVICE,
        (
            {
                capabilities,
                fingerprint,
                savedPairings,
            }: {
                capabilities: RoomDeviceCapabilities;
                fingerprint?: string;
                savedPairings?: { displayId: string; screenIndex: number; cameraDeviceId: string; cameraLabel: string; excluded: boolean }[];
            },
            callback?: Function
        ) => {
            try {
                const roomName = roomManager.socketToRoom.get(socket.id);
                if (!roomName) {
                    console.warn("[REGISTER_ROOM_DEVICE] socket not in any room:", socket.id);
                    callback?.({ error: "not-in-room" });
                    return;
                }

                const room = roomManager.getRoom(roomName, "REGISTER_ROOM_DEVICE");
                const peer = room.getPeer(socket.id);

                // Store capabilities and fingerprint on the peer
                peer.setCapabilities(capabilities);
                if (fingerprint) {
                    peer.deviceFingerprint = fingerprint;
                }

                // Create unpaired slots
                const newSlots = room.registerDevice(socket.id, capabilities);

                // If saved pairings provided, apply them immediately
                let hasSavedConfig = false;
                if (savedPairings && savedPairings.length > 0) {
                    // Apply pairings
                    room.applyScreenCameraPairing(
                        savedPairings.map((p) => ({
                            slotId: newSlots.find((s) => s.screenIndex === p.screenIndex)?.slotId ?? "",
                            cameraDeviceId: p.cameraDeviceId,
                            cameraLabel: p.cameraLabel,
                        }))
                    );

                    // Set displayId and excluded flag on slots
                    savedPairings.forEach((p) => {
                        const slot = newSlots.find((s) => s.screenIndex === p.screenIndex);
                        if (slot) {
                            slot.displayId = p.displayId;
                            slot.excluded = p.excluded;
                        }
                    });

                    // Rebalance remotes to include newly paired slots
                    const newAssignments = room.rebalanceAssignments();
                    newAssignments.forEach((slot, remoteSocketId) => {
                        const assignment: RemoteAssignment = {
                            slotId: slot.slotId,
                            screenLabel: slot.screenLabel,
                            cameraProducerId: slot.cameraProducerId,
                            deviceSocketId: slot.deviceSocketId,
                        };
                        namespace.to(remoteSocketId).emit(ACTIONS.ASSIGNMENT_UPDATE, assignment);
                    });

                    hasSavedConfig = true;
                    console.log(`[HYBRID] Device ${socket.id} applied saved pairing config`);
                }

                // Broadcast updated topology to everyone in the socket.io room
                const topologyDTO = room.getTopologyDTO();
                namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);

                console.log(
                    `[HYBRID] Device ${socket.id} (${peer.userName}) registered with`,
                    capabilities.screens.length, "screen(s) and",
                    capabilities.cameras.length, "camera(s)"
                );

                callback?.({ success: true, slots: newSlots.map(s => s.slotId), hasSavedConfig });
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

    // ─── CHOOSE_DISPLAY ───────────────────────────────────────────────────────
    // Emitted by a remote participant to choose a specific display.
    socket.on(ACTIONS.CHOOSE_DISPLAY, ({ displayId }: { displayId: string }, callback?: Function) => {
        try {
            const roomName = roomManager.socketToRoom.get(socket.id);
            if (!roomName) {
                callback?.({ error: "not-in-room" });
                return;
            }

            const room = roomManager.getRoom(roomName, "CHOOSE_DISPLAY");
            const slot = room.assignRemoteToDisplay(socket.id, displayId);

            if (!slot) {
                callback?.({ error: "display-not-available" });
                return;
            }

            const assignment: RemoteAssignment = {
                slotId: slot.slotId,
                screenLabel: slot.screenLabel,
                cameraProducerId: slot.cameraProducerId,
                deviceSocketId: slot.deviceSocketId,
            };

            // Notify the remote of their assignment
            namespace.to(socket.id).emit(ACTIONS.ASSIGNMENT_UPDATE, assignment);

            // Notify the room device that owns this slot
            namespace.to(slot.deviceSocketId).emit(ACTIONS.SLOT_REMOTE_JOINED, {
                slotId: slot.slotId,
                remoteSocketId: socket.id,
                remoteName: room.getPeer(socket.id)?.userName ?? "Unknown",
            });

            // Broadcast updated topology to all peers
            const topologyDTO = room.getTopologyDTO();
            namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);

            callback?.({ success: true, assignment });
        } catch (err) {
            console.error("[CHOOSE_DISPLAY] error:", err);
            callback?.({ error: String(err) });
        }
    });

    // ─── EXCLUDE_SCREEN ───────────────────────────────────────────────────────
    // Emitted by a room device to exclude a screen from conference.
    socket.on(ACTIONS.EXCLUDE_SCREEN, ({ slotId }: { slotId: string }, callback?: Function) => {
        try {
            const roomName = roomManager.socketToRoom.get(socket.id);
            if (!roomName) {
                callback?.({ error: "not-in-room" });
                return;
            }

            const room = roomManager.getRoom(roomName, "EXCLUDE_SCREEN");
            const slot = room.excludeSlot(slotId);

            if (!slot) {
                callback?.({ error: "slot-not-found" });
                return;
            }

            // Rebalance remotes away from this slot
            const newAssignments = room.rebalanceAssignments();
            newAssignments.forEach((s, remoteSocketId) => {
                const assignment: RemoteAssignment = {
                    slotId: s.slotId,
                    screenLabel: s.screenLabel,
                    cameraProducerId: s.cameraProducerId,
                    deviceSocketId: s.deviceSocketId,
                };
                namespace.to(remoteSocketId).emit(ACTIONS.ASSIGNMENT_UPDATE, assignment);
            });

            // Broadcast updated topology
            const topologyDTO = room.getTopologyDTO();
            namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);

            callback?.({ success: true });
        } catch (err) {
            console.error("[EXCLUDE_SCREEN] error:", err);
            callback?.({ error: String(err) });
        }
    });

    // ─── INCLUDE_SCREEN ───────────────────────────────────────────────────────
    // Emitted by a room device to include a previously excluded screen.
    socket.on(ACTIONS.INCLUDE_SCREEN, ({ slotId }: { slotId: string }, callback?: Function) => {
        try {
            const roomName = roomManager.socketToRoom.get(socket.id);
            if (!roomName) {
                callback?.({ error: "not-in-room" });
                return;
            }

            const room = roomManager.getRoom(roomName, "INCLUDE_SCREEN");
            const slot = room.includeSlot(slotId);

            if (!slot) {
                callback?.({ error: "slot-not-found" });
                return;
            }

            // Rebalance remotes to include this slot
            const newAssignments = room.rebalanceAssignments();
            newAssignments.forEach((s, remoteSocketId) => {
                const assignment: RemoteAssignment = {
                    slotId: s.slotId,
                    screenLabel: s.screenLabel,
                    cameraProducerId: s.cameraProducerId,
                    deviceSocketId: s.deviceSocketId,
                };
                namespace.to(remoteSocketId).emit(ACTIONS.ASSIGNMENT_UPDATE, assignment);
            });

            // Broadcast updated topology
            const topologyDTO = room.getTopologyDTO();
            namespace.to(roomName).emit(ACTIONS.ROOM_TOPOLOGY_UPDATE, topologyDTO);

            callback?.({ success: true });
        } catch (err) {
            console.error("[INCLUDE_SCREEN] error:", err);
            callback?.({ error: String(err) });
        }
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
