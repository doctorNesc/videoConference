// ─── Mirror of server-side hybrid types (safe for browser) ───────────────────

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

export interface ScreenInfo {
  screenIndex: number;
  label: string;
  width: number;
  height: number;
  left: number;
  top: number;
}

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export interface RoomDeviceCapabilities {
  screens: ScreenInfo[];
  cameras: CameraInfo[];
}

/** A single screen+camera slot as received from the server */
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

/** Full room topology as received from the server */
export interface RoomTopologyDTO {
  roomName: string;
  slots: ScreenSlotDTO[];
  deviceSocketIds: string[];
}

/** Assignment sent to a remote participant */
export interface RemoteAssignment {
  slotId: string;
  screenLabel: string;
  cameraProducerId: string | null;
  deviceSocketId: string;
}

/** Pairing submitted by a room device after the wizard */
export interface ScreenCameraPairing {
  slotId: string;
  screenIndex?: number;  // physical screen index — persisted in saved config for stable re-matching
  cameraDeviceId: string;
  cameraLabel: string;
  displayId?: string;    // links to RoomConfig.displays[].displayId
  excluded?: boolean;    // marks slot as excluded from conference
}

/** Notification sent to a room device when a remote joins its slot */
export interface SlotRemoteJoinedEvent {
  slotId: string;
  remoteSocketId: string;
  remoteName: string;
}

/** Notification sent to a room device when a remote leaves its slot */
export interface SlotRemoteLeftEvent {
  slotId: string;
  remoteSocketId: string;
}

// ─── Window Management API types (not yet in standard TS lib) ─────────────────

export interface ScreenDetailed extends Screen {
  readonly label: string;
  readonly left: number;
  readonly top: number;
  readonly isPrimary: boolean;
  readonly isInternal: boolean;
}

export interface ScreenDetails {
  readonly screens: ScreenDetailed[];
  readonly currentScreen: ScreenDetailed;
}

declare global {
  interface Window {
    getScreenDetails?: () => Promise<ScreenDetails>;
  }
}
