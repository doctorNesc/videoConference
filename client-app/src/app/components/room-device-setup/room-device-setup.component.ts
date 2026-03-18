import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoomDeviceService } from '../../services/room-device.service';
import { ScreenInfo, CameraInfo, ScreenCameraPairing } from '../../utils/hybrid-types';

interface SlotPairing {
  slotId: string;
  screen: ScreenInfo;
  selectedCameraDeviceId: string;
  previewStream: MediaStream | null;
}

@Component({
  selector: 'app-room-device-setup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './room-device-setup.component.html',
  styleUrl: './room-device-setup.component.scss',
})
export class RoomDeviceSetupComponent implements OnInit, OnDestroy {
  /** Slot IDs returned by the server after REGISTER_ROOM_DEVICE */
  @Input() slotIds: string[] = [];

  /** Emitted when the operator confirms pairings */
  @Output() pairingConfirmed = new EventEmitter<ScreenCameraPairing[]>();

  screens: ScreenInfo[] = [];
  cameras: CameraInfo[] = [];
  pairings: SlotPairing[] = [];

  /** Bounding box of all screens for proportional rendering */
  layoutBounds = { minLeft: 0, minTop: 0, totalWidth: 1, totalHeight: 1 };

  constructor(private roomDeviceService: RoomDeviceService) {}

  ngOnInit() {
    this.screens = this.roomDeviceService.screens;
    this.cameras = this.roomDeviceService.cameras;
    this.buildPairings();
    this.computeLayoutBounds();
  }

  ngOnDestroy() {
    // Stop all preview streams
    this.pairings.forEach(p => p.previewStream?.getTracks().forEach(t => t.stop()));
  }

  // ─── Build pairing entries ────────────────────────────────────────────────

  private buildPairings() {
    this.pairings = this.screens.map((screen, i) => ({
      slotId: this.slotIds[i] ?? '',
      screen,
      selectedCameraDeviceId: this.cameras[i]?.deviceId ?? (this.cameras[0]?.deviceId ?? ''),
      previewStream: null,
    }));
  }

  // ─── Layout computation for proportional screen rendering ────────────────

  private computeLayoutBounds() {
    if (this.screens.length === 0) return;
    const minLeft = Math.min(...this.screens.map(s => s.left));
    const minTop = Math.min(...this.screens.map(s => s.top));
    const maxRight = Math.max(...this.screens.map(s => s.left + s.width));
    const maxBottom = Math.max(...this.screens.map(s => s.top + s.height));
    this.layoutBounds = {
      minLeft,
      minTop,
      totalWidth: maxRight - minLeft || 1,
      totalHeight: maxBottom - minTop || 1,
    };
  }

  /** Returns CSS style for a screen tile in the spatial layout */
  getScreenStyle(screen: ScreenInfo): Record<string, string> {
    const containerWidth = 600; // px — the layout container width
    const containerHeight = 200; // px — the layout container height
    const scaleX = containerWidth / this.layoutBounds.totalWidth;
    const scaleY = containerHeight / this.layoutBounds.totalHeight;

    return {
      position: 'absolute',
      left: `${(screen.left - this.layoutBounds.minLeft) * scaleX}px`,
      top: `${(screen.top - this.layoutBounds.minTop) * scaleY}px`,
      width: `${screen.width * scaleX}px`,
      height: `${screen.height * scaleY}px`,
    };
  }

  // ─── Camera preview ───────────────────────────────────────────────────────

  async onCameraChange(pairing: SlotPairing) {
    // Stop previous preview
    pairing.previewStream?.getTracks().forEach(t => t.stop());
    pairing.previewStream = null;

    if (!pairing.selectedCameraDeviceId) return;

    try {
      pairing.previewStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: pairing.selectedCameraDeviceId } },
        audio: false,
      });
    } catch (err) {
      console.error('[RoomDeviceSetup] Preview failed:', err);
    }
  }

  /** Attaches a preview stream to a video element */
  attachPreview(videoEl: HTMLVideoElement, pairing: SlotPairing) {
    if (pairing.previewStream && videoEl.srcObject !== pairing.previewStream) {
      videoEl.srcObject = pairing.previewStream;
    }
  }

  // ─── Confirm ──────────────────────────────────────────────────────────────

  confirm() {
    const result: ScreenCameraPairing[] = this.pairings
      .filter(p => p.slotId && p.selectedCameraDeviceId)
      .map(p => ({
        slotId: p.slotId,
        cameraDeviceId: p.selectedCameraDeviceId,
        cameraLabel: this.cameras.find(c => c.deviceId === p.selectedCameraDeviceId)?.label ?? 'Camera',
      }));

    // Stop previews before emitting (main streams will be opened by VideoRoomService)
    this.pairings.forEach(p => p.previewStream?.getTracks().forEach(t => t.stop()));

    this.pairingConfirmed.emit(result);
  }

  get canConfirm(): boolean {
    return this.pairings.every(p => p.selectedCameraDeviceId);
  }
}
