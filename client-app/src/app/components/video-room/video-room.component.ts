import { Component, HostListener, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ParticipantComponent } from '../participant/participant.component';
import { VideoOptionsComponent } from '../video-options/video-options.component';
import { ResizableDirective } from '../../directives/app-resizable.directive';
import { SideBarComponent } from '../side-bar/side-bar.component';
import { RoomDeviceSetupComponent } from '../room-device-setup/room-device-setup.component';
import { RoomDeviceDisplayLinkerComponent } from '../room-device-display-linker/room-device-display-linker.component';
import { DisplayPickerComponent } from '../display-picker/display-picker.component';
import {
  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators,
} from '@angular/forms';
import { ChatMessage, VideoRoomService } from '../../services/video-room.service';
import { ScreenCameraPairing, RoomConfig } from '../../utils/hybrid-types';
import { combineLatest, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
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
    RoomDeviceDisplayLinkerComponent,
    DisplayPickerComponent,
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

  /** Optimal column count so all tiles fill the stage at maximum size. */
  get gridCols(): number {
    return Math.ceil(Math.sqrt(this.participants.length));
  }

  /** Row count derived from column count. */
  get gridRows(): number {
    return Math.ceil(this.participants.length / this.gridCols);
  }
  public roomName!: string;
  public name!: string;
  public isRoomDevice: boolean = false;
  public messages: ChatMessage[] = [];
  public newMessage: string = '';
  public isSidebarCollapsed = true;
  public messageForm = new FormGroup({
    message: new FormControl('', Validators.min(1)),
  });


  /** True while the room device setup wizard is shown */
  public showPairingWizard: boolean = false;
  /** Slot IDs returned by server after REGISTER_ROOM_DEVICE */
  public pendingSlotIds: string[] = [];


  /** True while the display linker is shown (after pairing wizard) */
  public showDisplayLinker: boolean = false;
  /** Pairings from the wizard, held until display linker confirms */
  public pendingPairings: ScreenCameraPairing[] = [];


  /** True when device joined with a saved config (shows reconfigure button) */
  public hasSavedConfig: boolean = false;


  public assignedScreenLabel: string | null = null;


  /** True while the display picker overlay is shown */
  public showDisplayPicker: boolean = false;

  /** Map of slotId → opened Window reference */
  private slotWindows = new Map<string, Window>();

  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    protected videoService: VideoRoomService,
    private roomDeviceService: RoomDeviceService,
    private broadcastChannel: BroadcastChannelService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.roomName = this.route.snapshot.paramMap.get('roomName') || '';
    this.name = this.route.snapshot.queryParamMap.get('userName') || 'Guest';
    this.isRoomDevice = this.route.snapshot.queryParamMap.get('inTheRoom')?.toLowerCase() === 'true' || false;


    this.setupRoomDeviceRegistration();

    this.videoService.initializeSocket(this.roomName, this.name, this.isRoomDevice);

    if (!this.isRoomDevice) {
      this.subs.push(
        combineLatest([
          this.videoService.setupReady.pipe(filter(ready => ready)),
          this.videoService.roomConfig.pipe(filter(c => !!c)),
        ]).pipe(take(1)).subscribe(([_, config]) => {
          if (config!.displays?.length > 0) {
            this.showDisplayPicker = true;
            this.cdr.detectChanges();
          }
        })
      );
    }

    this.subs.push(
      this.videoService.getParticipants().subscribe((participants) => {
        this.participants = participants;

        if (!this.isRoomDevice && this.videoService.currentAssignment?.cameraProducerId) {
          const assignedCam = participants.find(
            p => p.id === this.videoService.currentAssignment!.cameraProducerId
          );
          if (assignedCam) {
            this.setMainParticipant(assignedCam);
          }
        }

        if (this.slotWindows.size > 0) {
          const latestSlots = this.roomDeviceService.slotsSnapshot;
          for (const slot of latestSlots) {
            this.updateSlotWindow(slot, participants);
          }
        }
      })
    );


    this.subs.push(
      this.videoService.assignment.subscribe((assignment) => {
        if (assignment) {
          this.assignedScreenLabel = assignment.screenLabel;

          if (assignment.cameraProducerId) {
            const cam = this.participants.find(p => p.id === assignment.cameraProducerId);
            if (cam) this.setMainParticipant(cam);
          }
        }
      })
    );


    this.subs.push(
      this.roomDeviceService.slots.subscribe(slots => {
        if (this.slotWindows.size === 0) return;
        for (const slot of slots) {
          this.updateSlotWindow(slot, this.participants);
        }
      })
    );


    this.subs.push(
      this.videoService.getMessages().subscribe((messages) => {
        this.messages = messages;
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());


    this.slotWindows.forEach(w => { try { w.close(); } catch { /* ignore */ } });
    this.slotWindows.clear();

    this.videoService.disconnectAndCleanUp();
  }

  /** Called by DisplayPickerComponent when the user has successfully chosen a display. */
  onDisplayChosen() {
    this.showDisplayPicker = false;
    this.cdr.detectChanges();
  }


  /**
   * Monkey-patches registerAsRoomDevice to show the wizard after registration.
   * The wizard emits pairingConfirmed which calls submitScreenCameraPairing.
   */
  private setupRoomDeviceRegistration() {
    if (!this.isRoomDevice) return;

    const originalRegister = this.videoService.registerAsRoomDevice.bind(this.videoService);
    this.videoService.registerAsRoomDevice = async () => {
      const result = await originalRegister();
      const slotIds = result.slots || [];
      const savedConfig = result.hasSavedConfig || false;

      console.log('[VideoRoomComponent] Device registered:', { slotIds, hasSavedConfig: savedConfig });

      if (slotIds.length > 0 && !savedConfig) {

        console.log('[VideoRoomComponent] Showing pairing wizard');
        this.pendingSlotIds = slotIds;
        this.showPairingWizard = true;
      } else if (savedConfig) {
        console.log('[VideoRoomComponent] Saved config applied, opening slot windows');
        this.hasSavedConfig = true;
        this.cdr.detectChanges();


        this.openSlotWindows();
      }
      return result;
    };
  }

  /**
   * Clears the saved device config and re-runs the full pairing + display linker wizard.
   * Called when the operator clicks "Reconfigure" after joining with a saved config.
   */
  async reconfigure() {
    const fingerprint = this.roomDeviceService.generateFingerprint();
    await this.roomDeviceService.deleteSavedConfig(this.roomName, fingerprint);
    this.hasSavedConfig = false;


    this.slotWindows.forEach(w => { try { w.close(); } catch { /* ignore */ } });
    this.slotWindows.clear();


    const slots = this.roomDeviceService.slotsSnapshot;
    this.pendingSlotIds = slots.map(s => s.slotId);
    this.showPairingWizard = true;
    this.cdr.detectChanges();
  }


  async onPairingConfirmed(pairings: ScreenCameraPairing[]) {
    this.showPairingWizard = false;
    this.pendingPairings = pairings;


    const roomConfig = await new Promise<RoomConfig | null>(resolve => {
      this.videoService.roomConfig.pipe(take(1)).subscribe(c => resolve(c));
    });


    if (roomConfig?.displays && roomConfig.displays.length > 0) {
      this.showDisplayLinker = true;
      this.cdr.detectChanges();
    } else {

      await this.submitPairingsAndOpenSlots(pairings);
    }
  }

  async onDisplayLinkingConfirmed(links: any[]) {
    this.showDisplayLinker = false;


    const merged = this.pendingPairings.map(p => {
      const link = links.find(l => l.slotId === p.slotId);
      return {
        ...p,
        displayId: link?.displayId ?? undefined,
        excluded: link?.excluded ?? false,
      };
    });

    await this.submitPairingsAndOpenSlots(merged);
  }

  onDisplayLinkingCancelled() {
    this.showDisplayLinker = false;
    this.pendingPairings = [];
    this.showPairingWizard = true;
    this.cdr.detectChanges();
  }

  private async submitPairingsAndOpenSlots(pairings: ScreenCameraPairing[]) {
    await this.videoService.submitScreenCameraPairing(pairings);

    this.openSlotWindows();
  }

  /**
   * Opens one browser window per slot, positioned on the correct physical screen.
   * Slot/participant subscriptions are set up in ngOnInit (always active) so they
   * fire immediately when windows open — no setTimeout or duplicate subscriptions needed.
   */
  private openSlotWindows() {
    for (const slot of this.roomDeviceService.slotsSnapshot) {

      if (slot.excluded) {
        console.log('[VideoRoomComponent] Skipping excluded slot window for', slot.slotId, slot.screenLabel);
        continue;
      }
      this.openSlotWindow(slot);
    }


    for (const slot of this.roomDeviceService.slotsSnapshot) {
      this.updateSlotWindow(slot, this.participants);
    }
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


    const labelEl = win.document.getElementById('slot-label');
    if (labelEl) labelEl.textContent = slot.screenLabel;


    const container = win.document.getElementById('video-container');
    if (container) {
      const count = slot.assignedRemotes.length;
      const cols = Math.ceil(Math.sqrt(count || 1));
      const rows = Math.ceil((count || 1) / cols);
      container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    }


    const statusEl = win.document.getElementById('slot-status');

    if (slot.assignedRemotes.length === 0) {
      if (statusEl) {
        statusEl.style.display = 'flex';
        statusEl.innerHTML = `<p>No remote participant assigned to <strong>${slot.screenLabel}</strong></p>`;
      }

      const container = win.document.getElementById('video-container');
      if (container) container.innerHTML = '';
      return;
    }

    if (statusEl) statusEl.style.display = 'none';

    if (!container) return;


    for (const remote of slot.assignedRemotes) {

      const participant = currentParticipants.find(p => p.socketId === remote.socketId);
      if (!participant) {
        console.log('[VideoRoomComponent] Participant not yet available for remote', remote.socketId,
          '| available socketIds:', currentParticipants.map(p => p.socketId));
        continue;
      }

      let videoEl = win.document.getElementById(`video-${remote.socketId}`) as HTMLVideoElement;
      if (!videoEl) {

        const tile = win.document.createElement('div');
        tile.className = 'remote-tile';
        tile.id = `tile-${remote.socketId}`;

        videoEl = win.document.createElement('video');
        videoEl.id = `video-${remote.socketId}`;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;';

        const nameEl = win.document.createElement('div');
        nameEl.className = 'remote-name';
        nameEl.textContent = participant.name;

        tile.appendChild(videoEl);
        tile.appendChild(nameEl);
        container.appendChild(tile);
      }


      if (videoEl.srcObject !== participant.stream) {
        videoEl.srcObject = participant.stream;
        const tracks = participant.stream.getTracks();
        console.log('[VideoRoomComponent] Attached stream for', remote.socketId,
          'tracks:', tracks.map(t => `${t.kind}:${t.readyState}:enabled=${t.enabled}`));

        videoEl.play().catch(err => console.warn('[VideoRoomComponent] video.play() failed:', err));
      }
    }


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
   * Handles both normal slots and excluded (reserved) screens.
   */
  private buildSlotWindowHtml(slot: SlotState): string {
    const isExcluded = slot.excluded === true;

    return `<!DOCTYPE html>
<html>
<head>
  <title>${slot.screenLabel}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0a0a0a; color: #fff; font-family: sans-serif; overflow: hidden; }
    /* Full-screen grid container for remote video tiles */
    #video-container {
      position: fixed;
      inset: 0;
      display: grid;
      grid-template-columns: 1fr;
      grid-template-rows: 1fr;
    }
    /* Each tile fills its grid cell completely */
    .remote-tile {
      position: relative;
      width: 100%;
      height: 100%;
      background: #111;
      overflow: hidden;
    }
    .remote-tile video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      background: #000;
    }
    .remote-name {
      position: absolute;
      bottom: 12px;
      left: 12px;
      background: rgba(0,0,0,0.6);
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    /* Waiting overlay — shown until a remote is assigned */
    #slot-status {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      color: #aaa;
      z-index: 10;
    }
    #slot-info {
      position: fixed;
      bottom: 12px;
      right: 12px;
      background: rgba(0,0,0,0.5);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      color: #ccc;
      z-index: 20;
    }
    #excluded-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 20px;
      z-index: 100;
    }
    #excluded-overlay h2 { font-size: 32px; font-weight: 600; color: #fff; }
    #excluded-overlay p  { font-size: 18px; color: #aaa; }
  </style>
</head>
<body>
  ${isExcluded ? `
  <div id="excluded-overlay">
    <h2>Screen Reserved</h2>
    <p>This screen is reserved for local work</p>
  </div>
  ` : `
  <div id="slot-status" style="display:flex">
    <p>Waiting for remote participant…</p>
    <small>Slot: ${slot.screenLabel}</small>
  </div>
  <div id="video-container"></div>
  `}
  <div id="slot-info"><span id="slot-label">${slot.screenLabel}</span></div>
</body>
</html>`;
  }


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
