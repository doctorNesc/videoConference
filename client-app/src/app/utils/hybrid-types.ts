// ─── Mirror of server-side hybrid types (safe for browser) ───────────────────

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
  cameraDeviceId: string;
  cameraLabel: string;
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
