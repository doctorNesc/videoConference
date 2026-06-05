import { Socket } from "socket.io";
import { Router, Consumer, Producer, WebRtcTransport, Worker } from "mediasoup/node/lib/types";


interface PeerData {
  socket: Socket;
  roomName: string;
  transports: string[];
  producers: string[];
  consumers: string[];
  peerDetails: { name: string; isAdmin: boolean, isMainRoom: boolean };
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


export interface DisplayConfig {
  displayId: string;               
  label: string;                   
  position3D: { x: number; y: number; z: number };
  rotationY: number;               
  widthM: number;                  
  heightM: number;                 
}

export interface CameraPosition {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
}

export interface RoomConfig {
  roomName: string;
  splatPath: string;               
  displays: DisplayConfig[];       
  cameraPosition?: CameraPosition; 
  createdAt: string;
  updatedAt: string;
}


export interface DevicePairingConfig {
  deviceFingerprint: string;       
  roomName: string;
  pairings: {
    displayId: string;             
    screenIndex: number;           
    cameraDeviceId: string;        
    cameraLabel: string;
  }[];
  createdAt: string;
  updatedAt: string;
}


export interface ScreenSlot {
  slotId: string;                  
  deviceSocketId: string;          
  screenIndex: number;             
  screenLabel: string;             
  cameraDeviceId: string | null;   
  cameraLabel: string | null;      
  cameraProducerId: string | null; 
  assignedRemoteIds: string[];     
  displayId?: string;              
  excluded: boolean;               
  
  position3D?: { x: number; y: number; z: number };
}


export interface RoomTopology {
  roomName: string;
  slots: Map<string, ScreenSlot>;   
  deviceSockets: Set<string>;       
}


export interface RemoteAssignment {
  slotId: string;
  screenLabel: string;
  cameraProducerId: string | null;  
  deviceSocketId: string;
}


export interface ScreenSlotDTO {
  slotId: string;
  deviceSocketId: string;
  screenIndex: number;
  screenLabel: string;
  cameraDeviceId: string | null;
  cameraLabel: string | null;
  cameraProducerId: string | null;
  assignedRemoteIds: string[];
  displayId?: string;              
  excluded: boolean;               
  position3D?: { x: number; y: number; z: number };
}


export interface RoomTopologyDTO {
  roomName: string;
  slots: ScreenSlotDTO[];
  deviceSocketIds: string[];
}


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
  mainRoomDevices: { [roomName: string]: string[] }; 
  remoteAssignments: { [roomName: string]: { [remoteSocketId: string]: string } }; 
}

export type MediaType = "camera" | "screen";
