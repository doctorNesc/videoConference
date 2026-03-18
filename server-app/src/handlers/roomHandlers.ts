import { Socket, Namespace } from "socket.io";
import { SharedState } from "../types";
import { ACTIONS } from "../config/actions";
import { Peer } from "../core/peer";
import { RoomManager } from "../core/roomManager";
import { leaveRoom } from "../mediasoup/utils";
import { assignRemoteOnJoin, unassignRemoteOnLeave, handleDeviceLeave } from "./hybridHandlers";

export function registerRoomHandlers(
    socket: Socket,
    state: SharedState,
    roomManager: RoomManager,
    namespace: Namespace,
) {
    // ─── JOIN_ROOM ────────────────────────────────────────────────────────────
    socket.on(ACTIONS.JOIN_ROOM, async (
        { roomName, userName, isRoomDevice = false }:
            { roomName: string; userName: string; isRoomDevice?: boolean },
        callback: Function
    ) => {
        try {
            const room = await roomManager.getOrCreateRoom(state, roomName);

            const peer = new Peer(socket.id, socket, userName, false, roomName, false, isRoomDevice);
            roomManager.socketToRoom.set(socket.id, roomName);
            room.addPeer(peer);

            // Join the socket.io room so namespace.to(roomName) broadcasts reach this peer
            socket.join(roomName);

            console.log(`[JOIN_ROOM] ${userName} (${socket.id}) joined "${roomName}" [isRoomDevice=${isRoomDevice}]`);

            // For remote participants: attempt immediate assignment if paired slots exist.
            // The assignment is returned in the callback so the client has it before
            // it starts consuming producers.
            let assignment = null;
            if (!isRoomDevice) {
                assignment = assignRemoteOnJoin(socket.id, userName, namespace, roomManager);
                if (assignment) {
                    console.log(`[JOIN_ROOM] Remote ${userName} assigned to slot "${assignment.screenLabel}"`);
                }
            }

            callback({
                rtpCapabilities: room.router.rtpCapabilities,
                assignment, // null for room devices or when no paired slots exist yet
            });
        } catch (err) {
            console.error("[JOIN_ROOM] error:", err);
            callback({ error: String(err) });
        }
    });

    // ─── LEAVE_ROOM ───────────────────────────────────────────────────────────
    socket.on(ACTIONS.LEAVE_ROOM, ({ roomName }: { roomName: string }, callback: Function) => {
        try {
            let isDevice = false;
            try {
                isDevice = roomManager.getRoom(roomName, "LEAVE_ROOM")?.peers.get(socket.id)?.isRoomDevice ?? false;
            } catch { /* room may already be gone */ }

            if (isDevice) {
                handleDeviceLeave(socket.id, namespace, roomManager);
            } else {
                unassignRemoteOnLeave(socket.id, namespace, roomManager);
            }

            leaveRoom(roomManager, roomName, socket.id);
            socket.leave(roomName);
            callback({ left: true });
        } catch (err) {
            console.error("[LEAVE_ROOM] error:", err);
            callback({ left: false, error: String(err) });
        }
    });
}
