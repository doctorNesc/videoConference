import { Socket, Namespace } from "socket.io";
import { SharedState } from "../types";
import { ACTIONS } from "../config/actions";
import { Peer } from "../core/peer";
import { RoomManager } from "../core/roomManager";
import { leaveRoom } from "../mediasoup/utils";
import { assignRemoteOnJoin, unassignRemoteOnLeave, handleDeviceLeave } from "./hybridHandlers";
import * as roomConfigService from "../services/roomConfigService";

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

            // Load room config for 3D display picker (remotes need this)
            const roomConfig = roomConfigService.loadRoomConfig(roomName);

            // For remote participants: only auto-assign if the room has NO 3D display config.
            // Rooms with a 3D config use the DisplayPicker — the remote must call CHOOSE_DISPLAY
            // explicitly after viewing the 3D room. Auto-assigning here would bypass the picker
            // and cause the slot window to open before the remote has chosen a display.
            let assignment = null;
            if (!isRoomDevice) {
                const hasDisplayConfig = roomConfig?.displays && roomConfig.displays.length > 0;
                if (!hasDisplayConfig) {
                    assignment = assignRemoteOnJoin(socket.id, userName, namespace, roomManager);
                    if (assignment) {
                        console.log(`[JOIN_ROOM] Remote ${userName} auto-assigned to slot "${assignment.screenLabel}" (no 3D config)`);
                    }
                } else {
                    console.log(`[JOIN_ROOM] Remote ${userName} will choose display via DisplayPicker (3D config present)`);
                }
            }

            // Include current topology so remote participants can immediately
            // determine display availability without waiting for ROOM_TOPOLOGY_UPDATE.
            const topologyDTO = room.getTopologyDTO();

            callback({
                rtpCapabilities: room.router.rtpCapabilities,
                assignment, // null when room has 3D config — remote must call CHOOSE_DISPLAY
                roomConfig: roomConfig ?? null, // for 3D display picker
                topology: topologyDTO,           // for display status indicators
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
