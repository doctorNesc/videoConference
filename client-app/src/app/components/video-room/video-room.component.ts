import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ParticipantComponent } from '../participant/participant.component';
import { VideoOptionsComponent } from '../video-options/video-options.component';
import { ResizableDirective } from '../../directives/app-resizable.directive';
import { SideBarComponent } from '../side-bar/side-bar.component';
import { RoomDeviceSetupComponent } from '../room-device-setup/room-device-setup.component';
import {
  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators,
} from '@angular/forms';
import { ChatMessage, VideoRoomService } from '../../services/video-room.service';
import { ScreenCameraPairing } from '../../utils/hybrid-types';
import { Subscription } from 'rxjs';
import { RoomDeviceService, SlotState } from '../../services/room-device.service';
import { BroadcastChannelService } from '../../services/broadcast-channel.service';
import { Participant } from '../../utils/types';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [
    CommonModule,
    ParticipantComponent,
    VideoOptionsComponent,
    ResizableDirective,
    SideBarComponent,
    RoomDeviceSetupComponent,
    ReactiveFormsModule,
    FormsModule,
  ],
  templateUrl: './video-room.component.html',
  styleUrls: ['./video-room.component.scss'],
})
export class VideoRoomComponent implements OnInit, OnDestroy {
  public participants: { id: string; stream: MediaStream; name: string; socketId?: string; isAssignedCamera?: boolean }[] = [];
  public mainParticipant!: { id: string; stream: MediaStream; name: string };
  public mainView: boolean = false;
  public roomName!: string;
  public name!: string;
  public isRoomDevice: boolean = false;
  public messages: ChatMessage[] = [];
  public newMessage: string = '';
  public isSidebarCollapsed = true;
  public messageForm = new FormGroup({
    message: new FormControl('', Validators.min(1)),
  });

  // ─── Pairing wizard state ─────────────────────────────────────────────────
  /** True while the room device setup wizard is shown */
  public showPairingWizard: boolean = false;
  /** Slot IDs returned by server after REGISTER_ROOM_DEVICE */
  public pendingSlotIds: string[] = [];

  // ─── Assignment label (remote participants) ───────────────────────────────
  public assignedScreenLabel: string | null = null;

  /** Map of slotId → opened Window reference */
  private slotWindows = new Map<string, Window>();

  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    protected videoService: VideoRoomService,
    private roomDeviceService: RoomDeviceService,
    private broadcastChannel: BroadcastChannelService,
  ) { }

  ngOnInit(): void {
    this.roomName = this.route.snapshot.paramMap.get('roomName') || '';
    this.name = this.route.snapshot.queryParamMap.get('userName') || 'Guest';
    this.isRoomDevice = this.route.snapshot.queryParamMap.get('inTheRoom')?.toLowerCase() === 'true' || false;

    // Override initializeSocket to intercept room device registration
    this.setupRoomDeviceRegistration();

    this.videoService.initializeSocket(this.roomName, this.name, this.isRoomDevice);

    // ─── Participants subscription ──────────────────────────────────────────
    this.subs.push(
      this.videoService.getParticipants().subscribe((participants) => {
        this.participants = participants;

        // Phase 7: For remote participants, auto-set main view to assigned camera
        if (!this.isRoomDevice && this.videoService.currentAssignment?.cameraProducerId) {
          const assignedCam = participants.find(
            p => p.id === this.videoService.currentAssignment!.cameraProducerId
          );
          if (assignedCam) {
            this.setMainParticipant(assignedCam);
          }
        }
      })
    );

    // ─── Assignment subscription ────────────────────────────────────────────
    this.subs.push(
      this.videoService.assignment.subscribe((assignment) => {
        if (assignment) {
          this.assignedScreenLabel = assignment.screenLabel;
          // Update main view when assignment changes
          if (assignment.cameraProducerId) {
            const cam = this.participants.find(p => p.id === assignment.cameraProducerId);
            if (cam) this.setMainParticipant(cam);
          }
        }
      })
    );

    // ─── Messages subscription ──────────────────────────────────────────────
    this.subs.push(
      this.videoService.getMessages().subscribe((messages) => {
        this.messages = messages;
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.videoService.disconnectAndCleanUp();
  }

  // ─── Room device setup interception ──────────────────────────────────────

  /**
   * Monkey-patches registerAsRoomDevice to show the wizard after registration.
   * The wizard emits pairingConfirmed which calls submitScreenCameraPairing.
   */
  private setupRoomDeviceRegistration() {
    if (!this.isRoomDevice) return;

    const originalRegister = this.videoService.registerAsRoomDevice.bind(this.videoService);
    this.videoService.registerAsRoomDevice = async () => {
      const slotIds = await originalRegister();
      if (slotIds.length > 0) {
        this.pendingSlotIds = slotIds;
        this.showPairingWizard = true;
      }
      return slotIds;
    };
  }

  // ─── Pairing wizard events ────────────────────────────────────────────────

  async onPairingConfirmed(pairings: ScreenCameraPairing[]) {
    this.showPairingWizard = false;
    await this.videoService.submitScreenCameraPairing(pairings);
    // Open a dedicated browser window per slot, positioned on the correct physical screen
    this.openSlotWindows();
  }

  /**
   * Opens one browser window per slot, positioned on the physical screen.
   * Uses the same direct srcObject injection as detachParticipant — no Angular routing needed.
   * Subscribes to slot changes to update the video when remotes are assigned/unassigned.
   */
  private openSlotWindows() {
    for (const slot of this.roomDeviceService.slotsSnapshot) {
      this.openSlotWindow(slot);
    }

    // Subscribe to slot changes and update windows reactively
    this.subs.push(
      this.roomDeviceService.slots.subscribe(slots => {
        for (const slot of slots) {
          this.updateSlotWindow(slot, this.participants);
        }
      })
    );

    // Also subscribe to participant changes to update streams when they arrive
    this.subs.push(
      this.videoService.getParticipants().subscribe(participants => {
        for (const slot of this.roomDeviceService.slotsSnapshot) {
          this.updateSlotWindow(slot, participants);
        }
      })
    );

    // Immediately update with current participants (may already be populated)
    setTimeout(() => {
      for (const slot of this.roomDeviceService.slotsSnapshot) {
        this.updateSlotWindow(slot, this.participants);
      }
    }, 500);
  }

  /**
   * Opens a plain HTML window for a slot, positioned on the correct physical screen.
   */
  private openSlotWindow(slot: SlotState) {
    const screen = this.roomDeviceService.screens.find(s => s.screenIndex === slot.screenIndex);
    const left = screen?.left ?? 0;
    const top = screen?.top ?? 0;
    const width = screen?.width ?? 1280;
    const height = screen?.height ?? 720;

    const win = window.open(
      '',
      `slot-${slot.slotId}`,
      `left=${left},top=${top},width=${width},height=${height},menubar=no,toolbar=no,location=no`
    );
    if (!win) {
      console.warn('[VideoRoomComponent] Could not open window for slot', slot.slotId);
      return;
    }

    // Write initial HTML
    win.document.write(this.buildSlotWindowHtml(slot));
    win.document.close();
    this.slotWindows.set(slot.slotId, win);
    console.log('[VideoRoomComponent] Opened slot window for', slot.slotId, slot.screenLabel);
  }

  /**
   * Updates the slot window's video elements when slot state or participants change.
   */
  private updateSlotWindow(slot: SlotState, participants?: Participant[]) {
    const win = this.slotWindows.get(slot.slotId);
    if (!win || win.closed) return;

    const currentParticipants = participants ?? this.participants;

    // Update slot label
    const labelEl = win.document.getElementById('slot-label');
    if (labelEl) labelEl.textContent = slot.screenLabel;

    // Update grid columns based on remote count
    const container = win.document.getElementById('video-container');
    if (container) {
      const count = slot.assignedRemotes.length;
      container.style.gridTemplateColumns = count <= 1 ? '1fr' : count <= 4 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)';
    }

    // Update status text
    const statusEl = win.document.getElementById('slot-status');

    if (slot.assignedRemotes.length === 0) {
      if (statusEl) {
        statusEl.style.display = 'flex';
        statusEl.innerHTML = `<p>No remote participant assigned to <strong>${slot.screenLabel}</strong></p>`;
      }
      // Hide all videos
      const container = win.document.getElementById('video-container');
      if (container) container.innerHTML = '';
      return;
    }

    if (statusEl) statusEl.style.display = 'none';

    if (!container) return;

    // For each assigned remote, find their stream and attach it
    for (const remote of slot.assignedRemotes) {
      // Find participant by socketId — the remote's video stream consumed by this room device
      const participant = currentParticipants.find(p => p.socketId === remote.socketId);
      if (!participant) {
        console.log('[VideoRoomComponent] Participant not yet available for remote', remote.socketId,
          '| available socketIds:', currentParticipants.map(p => p.socketId));
        continue;
      }

      let videoEl = win.document.getElementById(`video-${remote.socketId}`) as HTMLVideoElement;
      if (!videoEl) {
        // Create new video element
        const tile = win.document.createElement('div');
        tile.className = 'remote-tile';
        tile.id = `tile-${remote.socketId}`;

        videoEl = win.document.createElement('video');
        videoEl.id = `video-${remote.socketId}`;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.muted = false;
        videoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#000;';

        const nameEl = win.document.createElement('div');
        nameEl.className = 'remote-name';
        nameEl.textContent = participant.name;

        tile.appendChild(videoEl);
        tile.appendChild(nameEl);
        container.appendChild(tile);
      }

      // Attach stream if not already attached
      if (videoEl.srcObject !== participant.stream) {
        videoEl.srcObject = participant.stream;
        const tracks = participant.stream.getTracks();
        console.log('[VideoRoomComponent] Attached stream for', remote.socketId,
          'tracks:', tracks.map(t => `${t.kind}:${t.readyState}:enabled=${t.enabled}`));
        // Explicitly call play() since autoplay may not fire on dynamically created elements
        videoEl.play().catch(err => console.warn('[VideoRoomComponent] video.play() failed:', err));
      }
    }

    // Remove tiles for remotes that are no longer assigned
    const assignedIds = new Set(slot.assignedRemotes.map(r => r.socketId));
    const tiles = container.querySelectorAll('[id^="tile-"]');
    tiles.forEach(tile => {
      const socketId = tile.id.replace('tile-', '');
      if (!assignedIds.has(socketId)) {
        tile.remove();
      }
    });
  }

  /**
   * Builds the initial HTML for a slot window.
   */
  private buildSlotWindowHtml(slot: SlotState): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>${slot.screenLabel}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #fff; font-family: sans-serif; width: 100vw; height: 100vh; overflow: hidden; }
    #video-container { display: grid; grid-template-columns: 1fr; width: 100%; height: 100%; }
    .remote-tile { position: relative; background: #111; }
    .remote-name { position: absolute; bottom: 12px; left: 12px; background: rgba(0,0,0,0.6); padding: 4px 10px; border-radius: 4px; font-size: 0.9rem; }
    #slot-status { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; flex-direction: column; gap: 12px; color: #aaa; }
    #slot-info { position: fixed; bottom: 12px; right: 12px; background: rgba(0,0,0,0.5); padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; color: #ccc; }
  </style>
</head>
<body>
  <div id="slot-status" style="display:flex">
    <p>Waiting for remote participant…</p>
    <small>Slot: ${slot.screenLabel}</small>
  </div>
  <div id="video-container"></div>
  <div id="slot-info"><span id="slot-label">${slot.screenLabel}</span></div>
</body>
</html>`;
  }

  // ─── Participant view ─────────────────────────────────────────────────────

  setMainParticipant(participant: { id: string; stream: MediaStream; name: string }) {
    this.mainParticipant = participant;
    this.mainView = true;
  }

  removeMainParticipant() {
    if (this.participants.length < 12) {
      this.mainView = false;
    }
  }

  detachParticipant(participant: { id: string; stream: MediaStream; name: string }) {
    this.videoService.detachParticipant(participant.id);

    const detachedTab = window.open('', '_blank', 'width=800,height=600');
    if (detachedTab) {
      const videoHTML = `
        <html>
          <body style="margin:0;padding:0;display:flex;justify-content:center;align-items:center;background:black;">
            <video playsinline autoplay muted loop controls style="width:100%;height:100%;"></video>
          </body>
        </html>`;
      setTimeout(() => {
        detachedTab.document.write(videoHTML);
        const videoElement = detachedTab.document.querySelector('video') as HTMLVideoElement;
        videoElement.srcObject = participant.stream;
      }, 0);
      const interval = setInterval(() => {
        if (detachedTab.closed) {
          this.videoService.reattachParticipant(participant.id);
          clearInterval(interval);
        }
      }, 500);
    }
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  onSubmit() {
    this.messageForm.value &&
      this.videoService.sendMessage(
        this.messageForm.value.message as any,
        'YOU',
        this.roomName
      );
    this.messageForm.reset();
  }

  onSidebarToggle() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  // ─── Media controls ───────────────────────────────────────────────────────

  startScreenShare() {
    this.videoService.startScreenShare();
  }

  stopScreenShare() {
    this.videoService.stopScreenShare();
  }

  leaveCall() {
    this.videoService.leaveRoom();
    this.videoService.disconnectAndCleanUp();
  }
}
