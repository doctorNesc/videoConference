import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  RoomDeviceCapabilities,
  ScreenInfo,
  CameraInfo,
  ScreenSlotDTO,
  RoomTopologyDTO,
  SlotRemoteJoinedEvent,
  SlotRemoteLeftEvent,
  ScreenDetails,
} from '../utils/hybrid-types';

export interface SlotState {
  slotId: string;
  screenLabel: string;
  screenIndex: number;
  cameraDeviceId: string | null;
  cameraLabel: string | null;
  cameraProducerId: string | null;
  /** Remote participants currently assigned to this slot */
  assignedRemotes: { socketId: string; name: string }[];
}

@Injectable({ providedIn: 'root' })
export class RoomDeviceService {
  // ─── Capability state ─────────────────────────────────────────────────────
  private _screens: ScreenInfo[] = [];
  private _cameras: CameraInfo[] = [];

  // ─── Slot state (populated after server responds to REGISTER_ROOM_DEVICE) ──
  private slots$ = new BehaviorSubject<SlotState[]>([]);
  public slots = this.slots$.asObservable();
  get slotsSnapshot(): SlotState[] { return this.slots$.value; }

  // ─── Topology (full picture from server) ─────────────────────────────────
  private topology$ = new BehaviorSubject<RoomTopologyDTO | null>(null);
  public topology = this.topology$.asObservable();

  get screens(): ScreenInfo[] { return this._screens; }
  get cameras(): CameraInfo[] { return this._cameras; }

  // ─── Capability enumeration ───────────────────────────────────────────────

  /**
   * Enumerates physical screens using the Window Management API.
   * Falls back to a single screen entry if the API is unavailable or denied.
   */
  async enumerateScreens(): Promise<ScreenInfo[]> {
    try {
      if (typeof window.getScreenDetails === 'function') {
        const details: ScreenDetails = await window.getScreenDetails();
        this._screens = details.screens.map((s, i) => ({
          screenIndex: i,
          label: s.label || `Screen ${i + 1}`,
          width: s.width,
          height: s.height,
          left: s.left,
          top: s.top,
        }));
      } else {
        // Fallback: single screen
        this._screens = [{
          screenIndex: 0,
          label: 'Screen 1',
          width: window.screen.width,
          height: window.screen.height,
          left: 0,
          top: 0,
        }];
      }
    } catch (err) {
      console.warn('[RoomDeviceService] getScreenDetails failed, using fallback:', err);
      this._screens = [{
        screenIndex: 0,
        label: 'Screen 1',
        width: window.screen.width,
        height: window.screen.height,
        left: 0,
        top: 0,
      }];
    }
    return this._screens;
  }

  /**
   * Enumerates available video input devices (cameras).
   * Requires camera permission to get labels.
   */
  async enumerateCameras(): Promise<CameraInfo[]> {
    try {
      // Request permission first so labels are populated
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(s => s.getTracks().forEach(t => t.stop()))
        .catch(() => { /* permission denied — labels will be empty */ });

      const devices = await navigator.mediaDevices.enumerateDevices();
      this._cameras = devices
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
    } catch (err) {
      console.error('[RoomDeviceService] enumerateCameras failed:', err);
      this._cameras = [];
    }
    return this._cameras;
  }

  /**
   * Returns the full capabilities object ready to send to the server.
   */
  getCapabilities(): RoomDeviceCapabilities {
    return {
      screens: this._screens,
      cameras: this._cameras,
    };
  }

  // ─── Device fingerprinting ────────────────────────────────────────────────

  /**
   * Generates or retrieves a stable device fingerprint from localStorage.
   * Used to persist pairing config across sessions.
   */
  generateFingerprint(): string {
    const key = 'hybrid-device-id';
    let id = localStorage.getItem(key);
    if (!id) {
      // Generate a new UUID-like ID
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
      localStorage.setItem(key, id);
    }
    return id;
  }

  /**
   * Loads saved pairing config from the server for this device and room.
   */
  async loadSavedConfig(roomName: string, fingerprint: string): Promise<any | null> {
    try {
      const response = await fetch(`/api/rooms/${roomName}/device-config/${fingerprint}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('[RoomDeviceService] Failed to load saved config:', err);
    }
    return null;
  }

  /**
   * Saves pairing config to the server for this device and room.
   */
  async savePairingConfig(roomName: string, fingerprint: string, pairings: any[]): Promise<boolean> {
    try {
      const config = {
        roomName,
        deviceFingerprint: fingerprint,
        pairings,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const response = await fetch(`/api/rooms/${roomName}/device-config/${fingerprint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      return response.ok;
    } catch (err) {
      console.error('[RoomDeviceService] Failed to save pairing config:', err);
      return false;
    }
  }

  // ─── Slot management (driven by server events) ────────────────────────────

  /**
   * Called when server responds to REGISTER_ROOM_DEVICE with slot IDs.
   * Initialises local slot state from the topology DTO.
   */
  initSlotsFromTopology(topology: RoomTopologyDTO, mySocketId: string) {
    this.topology$.next(topology);
    const mySlots = topology.slots
      .filter(s => s.deviceSocketId === mySocketId)
      .map(s => this.dtoToSlotState(s));
    this.slots$.next(mySlots);
  }

  /**
   * Updates slot state when a full topology update arrives.
   */
  onTopologyUpdate(topology: RoomTopologyDTO, mySocketId: string) {
    this.topology$.next(topology);
    const mySlots = topology.slots
      .filter(s => s.deviceSocketId === mySocketId)
      .map(s => {
        // Preserve existing remote name info if available
        const existing = this.slots$.value.find(e => e.slotId === s.slotId);
        const slotState = this.dtoToSlotState(s);
        if (existing) {
          // Keep names for remotes that are still assigned
          slotState.assignedRemotes = s.assignedRemoteIds.map(id => {
            const known = existing.assignedRemotes.find(r => r.socketId === id);
            return known ?? { socketId: id, name: 'Unknown' };
          });
        }
        return slotState;
      });
    this.slots$.next(mySlots);
  }

  /**
   * Called when server emits SLOT_REMOTE_JOINED.
   */
  onRemoteJoined(event: SlotRemoteJoinedEvent) {
    const updated = this.slots$.value.map(slot => {
      if (slot.slotId !== event.slotId) return slot;
      const alreadyPresent = slot.assignedRemotes.some(r => r.socketId === event.remoteSocketId);
      if (alreadyPresent) return slot;
      return {
        ...slot,
        assignedRemotes: [...slot.assignedRemotes, { socketId: event.remoteSocketId, name: event.remoteName }],
      };
    });
    this.slots$.next(updated);
  }

  /**
   * Called when server emits SLOT_REMOTE_LEFT.
   */
  onRemoteLeft(event: SlotRemoteLeftEvent) {
    const updated = this.slots$.value.map(slot => {
      if (slot.slotId !== event.slotId) return slot;
      return {
        ...slot,
        assignedRemotes: slot.assignedRemotes.filter(r => r.socketId !== event.remoteSocketId),
      };
    });
    this.slots$.next(updated);
  }

  /**
   * Updates a slot's cameraProducerId after CAMERA_PRODUCER_REGISTERED is confirmed.
   */
  updateSlotProducer(slotId: string, producerId: string) {
    const updated = this.slots$.value.map(slot =>
      slot.slotId === slotId ? { ...slot, cameraProducerId: producerId } : slot
    );
    this.slots$.next(updated);
  }

  /**
   * Applies camera pairing to local slot state (mirrors what was sent to server).
   */
  applyPairing(slotId: string, cameraDeviceId: string, cameraLabel: string) {
    const updated = this.slots$.value.map(slot =>
      slot.slotId === slotId ? { ...slot, cameraDeviceId, cameraLabel } : slot
    );
    this.slots$.next(updated);
  }

  // ─── Multi-window helpers ─────────────────────────────────────────────────

  /**
   * Opens a new browser window positioned on the physical screen for a given slot.
   * Uses Window Management API coordinates if available.
   * Returns the opened window reference.
   */
  openSlotWindow(slot: SlotState, url: string): Window | null {
    const screen = this._screens.find(s => s.screenIndex === slot.screenIndex);
    const left = screen?.left ?? 0;
    const top = screen?.top ?? 0;
    const width = screen?.width ?? 1280;
    const height = screen?.height ?? 720;

    return window.open(
      url,
      `slot-${slot.slotId}`,
      `left=${left},top=${top},width=${width},height=${height},menubar=no,toolbar=no,location=no`
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private dtoToSlotState(dto: ScreenSlotDTO): SlotState {
    return {
      slotId: dto.slotId,
      screenLabel: dto.screenLabel,
      screenIndex: dto.screenIndex,
      cameraDeviceId: dto.cameraDeviceId,
      cameraLabel: dto.cameraLabel,
      cameraProducerId: dto.cameraProducerId,
      assignedRemotes: dto.assignedRemoteIds.map(id => ({ socketId: id, name: 'Unknown' })),
    };
  }

  reset() {
    this._screens = [];
    this._cameras = [];
    this.slots$.next([]);
    this.topology$.next(null);
  }
}
