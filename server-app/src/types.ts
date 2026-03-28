import { Socket } from "socket.io";
import { Router, Consumer, Producer, WebRtcTransport, Worker } from "mediasoup/node/lib/types";

// ─── Legacy peer data (kept for /api/roomUsers endpoint) ─────────────────────
interface PeerData {
  socket: Socket;
  roomName: string;
  transports: string[];
  producers: string[];
  consumers: string[];
  peerDetails: { name: string; isAdmin: boolean, isMainRoom: boolean };
}

// ─── Hybrid: Physical screen info advertised by a room device ─────────────────
export interface ScreenInfo {
  screenIndex: number;
  label: string;
  width: number;
  height: number;
  left: number;   // physical position (from Window Management API)
  top: number;
}

// ─── Hybrid: Camera info advertised by a room device ─────────────────────────
export interface CameraInfo {
  deviceId: string;
  label: string;
}

// ─── Hybrid: What a physical room device advertises on join ──────────────────
export interface RoomDeviceCapabilities {
  screens: ScreenInfo[];
  cameras: CameraInfo[];
}

// ─── Room Configuration: Static admin-defined display positions ───────────────
export interface DisplayConfig {
  displayId: string;               // stable uuid, set once by admin
  label: string;                   // e.g. "Front Left Screen"
  position3D: { x: number; y: number; z: number };
  rotationY: number;               // facing direction in radians
  widthM: number;                  // physical width in meters
  heightM: number;                 // physical height in meters
}

export interface CameraPosition {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
}

export interface RoomConfig {
  roomName: string;
  splatPath: string;               // relative path to .splat file
  displays: DisplayConfig[];       // pre-configured displays
  cameraPosition?: CameraPosition; // default camera position set by admin
  createdAt: string;
  updatedAt: string;
}

// ─── Device Pairing Config: Saved per device per room ────────────────────────
export interface DevicePairingConfig {
  deviceFingerprint: string;       // stable ID for the physical machine
  roomName: string;
  pairings: {
    displayId: string;             // which configured display
    screenIndex: number;           // which of the device's physical screens
    cameraDeviceId: string;        // which camera
    cameraLabel: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

// ─── Hybrid: A single screen+camera pair on a physical room device ────────────
export interface ScreenSlot {
  slotId: string;                  // stable uuid
  deviceSocketId: string;          // which physical device owns this slot
  screenIndex: number;             // index within that device's screens
  screenLabel: string;             // from Window Management API label
  cameraDeviceId: string | null;   // MediaDeviceInfo.deviceId (null until paired)
  cameraLabel: string | null;      // human-readable camera name
  cameraProducerId: string | null; // mediasoup producer ID once streaming
  assignedRemoteIds: string[];     // socket IDs of assigned remote participants
  displayId?: string;              // links to RoomConfig.displays[].displayId
  excluded: boolean;               // screen reserved for local work, not for conference
  // Physical position for 3D visualization (optional, set after pairing)
  position3D?: { x: number; y: number; z: number };
}

// ─── Hybrid: Topology of the physical room within a conference room ───────────
export interface RoomTopology {
  roomName: string;
  slots: Map<string, ScreenSlot>;   // slotId → ScreenSlot
  deviceSockets: Set<string>;       // all physical room device socket IDs
}

// ─── Hybrid: Assignment sent to a remote participant ─────────────────────────
export interface RemoteAssignment {
  slotId: string;
  screenLabel: string;
  cameraProducerId: string | null;  // null if camera not yet streaming
  deviceSocketId: string;
}

// ─── Hybrid: Serialisable slot (for sending over socket) ─────────────────────
export interface ScreenSlotDTO {
  slotId: string;
  deviceSocketId: string;
  screenIndex: number;
  screenLabel: string;
  cameraDeviceId: string | null;
  cameraLabel: string | null;
  cameraProducerId: string | null;
  assignedRemoteIds: string[];
  displayId?: string;              // links to RoomConfig.displays[].displayId
  excluded: boolean;               // screen reserved for local work
  position3D?: { x: number; y: number; z: number };
}

// ─── Hybrid: Topology DTO (for sending over socket) ──────────────────────────
export interface RoomTopologyDTO {
  roomName: string;
  slots: ScreenSlotDTO[];
  deviceSocketIds: string[];
}

// ─── Shared server state ──────────────────────────────────────────────────────
export interface SharedState {
  mediasoupWorkers?: Worker[];
  webRtcServers?: { workerIndex: number; webRtcServerId: string }[];
  transports: {
    socketId: string;
    transport: WebRtcTransport;
    roomname: string;
    isConsumer: boolean;
    isScreen: boolean;
  }[];
  producers: { socketId: string; roomName: string; producer: Producer, mediaType: MediaType }[];
  consumers: { socketId: string; roomName: string; consumer: Consumer }[];

  rooms: Record<string, { router: Router; peers: string[] }>;
  peers: Record<string, PeerData>;
  mainRoomDevices: { [roomName: string]: string[] }; // roomName -> [socketId, ...]
  remoteAssignments: { [roomName: string]: { [remoteSocketId: string]: string } }; // remoteSocketId -> mainRoomSocketId
}

export type MediaType = "camera" | "screen";
