import { Component, HostListener, OnDestroy, OnInit, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ParticipantComponent } from '../participant/participant.component';
import { VideoOptionsComponent } from '../video-options/video-options.component';
import { ResizableDirective } from '../../directives/app-resizable.directive';
import { SideBarComponent } from '../side-bar/side-bar.component';
import { RoomDeviceSetupComponent } from '../room-device-setup/room-device-setup.component';
import { RoomDeviceDisplayLinkerComponent } from '../room-device-display-linker/room-device-display-linker.component';
import {
  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators,
} from '@angular/forms';
import { ChatMessage, VideoRoomService } from '../../services/video-room.service';
import { ScreenCameraPairing, RoomConfig, DisplayConfig, RoomTopologyDTO, ScreenSlotDTO } from '../../utils/hybrid-types';
import { Subscription } from 'rxjs';
import { RoomDeviceService, SlotState } from '../../services/room-device.service';
import { BroadcastChannelService } from '../../services/broadcast-channel.service';
import { Participant } from '../../utils/types';
import * as THREE from 'three';
import { Viewer, SceneRevealMode, SceneFormat } from '@mkkellogg/gaussian-splats-3d';

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
    ReactiveFormsModule,
    FormsModule,
  ],
  templateUrl: './video-room.component.html',
  styleUrls: ['./video-room.component.scss'],
})
export class VideoRoomComponent implements OnInit, OnDestroy {
  @ViewChild('splatContainer', { static: false })
  splatContainerRef!: ElementRef<HTMLDivElement>;

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

  // ─── Display linker state (step 2 of wizard) ──────────────────────────────
  /** True while the display linker is shown (after pairing wizard) */
  public showDisplayLinker: boolean = false;
  /** Pairings from the wizard, held until display linker confirms */
  public pendingPairings: ScreenCameraPairing[] = [];

  // ─── Saved config state ───────────────────────────────────────────────────
  /** True when device joined with a saved config (shows reconfigure button) */
  public hasSavedConfig: boolean = false;

  // ─── Assignment label (remote participants) ───────────────────────────────
  public assignedScreenLabel: string | null = null;

  // ─── 3D Room visualization ────────────────────────────────────────────────
  public roomConfig: RoomConfig | null = null;
  public topology: RoomTopologyDTO | null = null;
  public showSplatViewer: boolean = false;
  public splatLoading: boolean = false;
  public splatLoadError: string | null = null;
  /** True while the user hasn't chosen a display yet (picker mode) */
  public displayPickerMode: boolean = false;
  /** The displayId the user clicked — shows "Connecting…" feedback */
  public selectedDisplayId: string | null = null;

  private viewer: Viewer | null = null;
  private threeScene!: THREE.Scene;
  private displayPlanes: Map<string, { mesh: THREE.Mesh; videoElement: HTMLVideoElement }> = new Map();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  /** Map of slotId → opened Window reference */
  private slotWindows = new Map<string, Window>();

  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    protected videoService: VideoRoomService,
    private roomDeviceService: RoomDeviceService,
    private broadcastChannel: BroadcastChannelService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.roomName = this.route.snapshot.paramMap.get('roomName') || '';
    this.name = this.route.snapshot.queryParamMap.get('userName') || 'Guest';
    this.isRoomDevice = this.route.snapshot.queryParamMap.get('inTheRoom')?.toLowerCase() === 'true' || false;

    // Override initializeSocket to intercept room device registration
    this.setupRoomDeviceRegistration();

    this.videoService.initializeSocket(this.roomName, this.name, this.isRoomDevice);

    // Load room config to check if 3D visualization is available
    // But wait for socket to be ready before redirecting to DisplayPicker
    this.loadRoomConfig();

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

        // Update display planes with new participant streams when they arrive
        if (this.showSplatViewer && this.displayPlanes.size > 0) {
          // Re-attach streams to existing planes when participants change
          this.reattachStreamsToPlanes();
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

    // ─── Topology subscription ─────────────────────────────────────────────
    this.subs.push(
      this.videoService.topology.subscribe((topology) => {
        if (topology) {
          this.topology = topology;
          if (this.showSplatViewer) {
            this.updateDisplayPlanes();
          }
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());

    // Clean up video elements first
    this.displayPlanes.forEach(({ videoElement }) => {
      try {
        videoElement.pause();
        videoElement.srcObject = null;
      } catch { /* ignore */ }
    });
    this.displayPlanes.clear();

    // Clear the splat container to prevent DOM errors during disposal
    if (this.splatContainerRef?.nativeElement) {
      try {
        this.splatContainerRef.nativeElement.innerHTML = '';
      } catch { /* ignore */ }
    }

    // Dispose viewer - suppress errors from library's internal cleanup
    if (this.viewer) {
      try {
        // Wrap dispose in setTimeout to let Angular finish cleanup first
        setTimeout(() => {
          try {
            this.viewer?.dispose();
          } catch { /* ignore */ }
        }, 0);
      } catch { /* ignore */ }
      this.viewer = null;
    }

    this.videoService.disconnectAndCleanUp();
  }

  // ─── 3D Room visualization ───────────────────────────────────────────────

  private async loadRoomConfig() {
    try {
      const configResponse = await this.http.get<RoomConfig>(`/api/rooms/${this.roomName}`).toPromise();
      if (configResponse) {
        this.roomConfig = configResponse;
        // Show splat viewer only for remote participants (not room devices)
        // Room devices use the pairing wizard instead
        if (!this.isRoomDevice && configResponse.displays && configResponse.displays.length > 0) {
          this.showSplatViewer = true;
          // Start in picker mode — user must click a display to choose their slot.
          // Switches to passive view once assignment is confirmed.
          this.displayPickerMode = true;
          // detectChanges() renders the @if (showSplatViewer) block and creates
          // the #splatContainer element in the DOM before initViewer() accesses it.
          this.cdr.detectChanges();
          // ngAfterViewInit already ran before showSplatViewer was set, so we
          // must call initViewer() explicitly here after the DOM is updated.
          await this.initViewer();
        }
      }
    } catch (err) {
      console.warn('[VideoRoomComponent] Failed to load room config:', err);
      // Continue without 3D visualization
    }
  }

  private async initViewer() {
    try {
      if (!this.splatContainerRef || !this.roomConfig) return;

      this.splatLoading = true;
      this.cdr.detectChanges();

      // Use saved camera position if available
      const camPos = this.roomConfig.cameraPosition?.position;
      const camLookAt = this.roomConfig.cameraPosition?.lookAt;

      // Create Three.js scene for overlay
      this.threeScene = new THREE.Scene();
      this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 5);
      this.threeScene.add(dir);

      // Initialize GaussianSplats3D viewer
      this.viewer = new Viewer({
        rootElement: this.splatContainerRef.nativeElement,
        useBuiltInControls: true,
        selfDrivenMode: true,
        threeScene: this.threeScene,
        cameraUp: [0, -1, 0],
        ...(camPos ? { initialCameraPosition: [camPos.x, camPos.y, camPos.z] as [number, number, number] } : {}),
        ...(camLookAt ? { initialCameraLookAt: [camLookAt.x, camLookAt.y, camLookAt.z] as [number, number, number] } : {}),
        sceneRevealMode: SceneRevealMode.Gradual,
        sharedMemoryForWorkers: false,
      });

      // Load splat file
      const splatUrl = `/api/rooms/${this.roomName}/splat`;
      await this.viewer.addSplatScene(splatUrl, {
        splatAlphaRemovalThreshold: 5,
        format: SceneFormat.Splat,
        showLoadingUI: false,
      });

      this.viewer.start();

      // Disable the library's built-in click-to-set-orbit-target behaviour
      (this.viewer as any).checkForFocalPointChange = () => { /* disabled */ };
      (this.viewer as any).transitioningCameraTarget = false;

      // Restrict to orbit-only: disable pan and zoom
      const controls = (this.viewer as any).controls;
      if (controls) {
        controls.enablePan = false;
        controls.enableZoom = false;
        const cam = controls.object;
        if (cam) {
          // Set target just in front of camera for first-person look-around
          const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          controls.target.copy(cam.position).addScaledVector(lookDir, 0.01);
          controls.minDistance = 0;
          controls.maxDistance = Infinity;
          controls.update();
          // Keep target pinned just ahead of camera on every update
          let lastDistance = controls.target.distanceTo(cam.position);
          controls.addEventListener('change', () => {
            const currentDistance = controls.target.distanceTo(cam.position);
            if (Math.abs(currentDistance - lastDistance) < 0.001) {
              const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
              controls.target.copy(cam.position).addScaledVector(dir, 0.01);
            }
            lastDistance = currentDistance;
          });
        }
      }

      // Create display planes
      this.updateDisplayPlanes();

      // Set up click handler for display selection (picker mode)
      this.splatContainerRef.nativeElement.addEventListener('click', (event: MouseEvent) => this.onCanvasClick(event));

      this.splatLoading = false;
      this.cdr.detectChanges();
    } catch (err) {
      console.error('[VideoRoomComponent] Failed to initialize viewer:', err);
      this.splatLoadError = String(err);
      this.splatLoading = false;
      this.cdr.detectChanges();
    }
  }

  // ─── Display picker interaction ───────────────────────────────────────────

  private onCanvasClick(event: MouseEvent) {
    // Only handle clicks in picker mode and when not already selecting
    if (!this.displayPickerMode || this.selectedDisplayId || !this.viewer || !this.threeScene) return;

    const canvas = this.splatContainerRef?.nativeElement.querySelector('canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = (this.viewer as any).camera;
    this.raycaster.setFromCamera(this.mouse, camera);

    const planes = Array.from(this.displayPlanes.values()).map(p => p.mesh);
    const intersects = this.raycaster.intersectObjects(planes);

    if (intersects.length > 0) {
      const clicked = intersects[0].object as THREE.Mesh;
      const displayId = clicked.userData['displayId'];
      if (displayId) this.selectDisplay(displayId);
    }
  }

  async selectDisplay(displayId: string) {
    this.selectedDisplayId = displayId;
    this.cdr.detectChanges();
    console.log('[VideoRoomComponent] Selecting display:', displayId);

    try {
      const result = await this.videoService.chooseDisplay(displayId);
      if (result && result.success) {
        console.log('[VideoRoomComponent] Display choice confirmed');
        this.displayPickerMode = false;
        this.selectedDisplayId = null;
        this.cdr.detectChanges();
      } else {
        console.error('[VideoRoomComponent] Server rejected display choice:', result?.error);
        this.selectedDisplayId = null;
        this.cdr.detectChanges();
      }
    } catch (err) {
      console.error('[VideoRoomComponent] Failed to choose display:', err);
      this.selectedDisplayId = null;
      this.cdr.detectChanges();
    }
  }

  private updateDisplayPlanes() {
    if (!this.roomConfig || !this.topology || !this.threeScene) return;

    const displays = this.roomConfig.displays || [];

    // Remove old planes
    this.displayPlanes.forEach(({ mesh, videoElement }) => {
      this.threeScene.remove(mesh);
      videoElement.pause();
      videoElement.srcObject = null;
    });
    this.displayPlanes.clear();

    // Create new planes for each display
    displays.forEach((display) => {
      // Find the slot linked to this display
      const slot = this.topology!.slots.find((s) => s.displayId === display.displayId);
      if (!slot || slot.excluded) return;

      // Create video element for this display's camera feed
      const videoElement = document.createElement('video');
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      videoElement.style.display = 'none';

      // Create plane geometry
      const geometry = new THREE.PlaneGeometry(display.widthM, display.heightM);

      // Create video texture
      const texture = new THREE.VideoTexture(videoElement);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(display.position3D.x, display.position3D.y, display.position3D.z);
      mesh.rotation.y = display.rotationY;
      mesh.userData = { displayId: display.displayId, slotId: slot.slotId };

      this.threeScene.add(mesh);
      this.displayPlanes.set(display.displayId, { mesh, videoElement });

      // Try to attach the camera stream from the consumer
      this.attachCameraStreamToPlane(display.displayId, slot);
    });
  }

  private attachCameraStreamToPlane(displayId: string, slot: ScreenSlotDTO) {
    const planeData = this.displayPlanes.get(displayId);
    if (!planeData) return;

    const { videoElement } = planeData;

    // Try to get the stream from participants by producer ID
    try {
      const participant = this.participants.find(p => p.id === slot.cameraProducerId);
      if (participant && participant.stream) {
        videoElement.srcObject = participant.stream;
        videoElement.play().catch((err) => console.warn('[VideoRoomComponent] video.play() failed:', err));
        console.log('[VideoRoomComponent] Attached stream to display', displayId, 'from participant', slot.cameraProducerId);
        return;
      }
    } catch (err) {
      console.warn('[VideoRoomComponent] Failed to attach stream:', err);
    }

    console.log('[VideoRoomComponent] No stream available yet for display', displayId, 'waiting for producer', slot.cameraProducerId);
  }

  /**
   * Re-attaches streams to existing display planes when participants change.
   * This ensures that when a remote participant's stream arrives, it gets attached to the plane.
   */
  private reattachStreamsToPlanes() {
    if (!this.topology) return;

    this.displayPlanes.forEach(({ videoElement }, displayId) => {
      const slot = this.topology!.slots.find((s) => s.displayId === displayId);
      if (!slot) return;

      // Only re-attach if the video element doesn't already have a stream
      if (!videoElement.srcObject) {
        this.attachCameraStreamToPlane(displayId, slot);
      }
    });
  }

  /**
   * Handles the race condition where a participant's stream arrives before
   * SLOT_REMOTE_JOINED has populated assignedRemotes.
   * Iterates all open slot windows and tries to attach any participant whose
   * socketId matches a remote that is now in the slot's assignedRemotes.
   * Also handles the case where assignedRemotes is populated but the stream
   * wasn't available yet when the slot subscription fired.
   */
  private tryAttachOrphanedParticipants(participants: { id: string; stream: MediaStream; name: string; socketId?: string }[]) {
    for (const [slotId, win] of this.slotWindows) {
      if (win.closed) continue;
      const slot = this.roomDeviceService.slotsSnapshot.find(s => s.slotId === slotId);
      if (!slot) continue;

      const container = win.document.getElementById('video-container');
      if (!container) continue;

      // For each participant, check if they are assigned to this slot
      for (const participant of participants) {
        if (!participant.socketId) continue;

        // Check if this participant is in the slot's assignedRemotes
        const isAssigned = slot.assignedRemotes.some(r => r.socketId === participant.socketId);
        if (!isAssigned) continue;

        // Check if video element already exists and has stream
        let videoEl = win.document.getElementById(`video-${participant.socketId}`) as HTMLVideoElement;
        if (videoEl && videoEl.srcObject === participant.stream) continue; // already attached

        if (!videoEl) {
          // Create tile
          const tile = win.document.createElement('div');
          tile.className = 'remote-tile';
          tile.id = `tile-${participant.socketId}`;

          videoEl = win.document.createElement('video');
          videoEl.id = `video-${participant.socketId}`;
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

          // Hide the "waiting" status overlay
          const statusEl = win.document.getElementById('slot-status');
          if (statusEl) statusEl.style.display = 'none';
        }

        // Attach stream
        videoEl.srcObject = participant.stream;
        videoEl.play().catch(err => console.warn('[VideoRoomComponent] orphan video.play() failed:', err));
        console.log('[VideoRoomComponent] Attached orphaned participant', participant.socketId, 'to slot window', slotId);
      }
    }
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
      const result = await originalRegister();
      const slotIds = result.slots || [];
      const savedConfig = result.hasSavedConfig || false;

      console.log('[VideoRoomComponent] Device registered:', { slotIds, hasSavedConfig: savedConfig });

      if (slotIds.length > 0 && !savedConfig) {
        // Only show wizard if no saved config was applied
        console.log('[VideoRoomComponent] Showing pairing wizard');
        this.pendingSlotIds = slotIds;
        this.showPairingWizard = true;
      } else if (savedConfig) {
        console.log('[VideoRoomComponent] Saved config applied, opening slot windows');
        this.hasSavedConfig = true;
        this.cdr.detectChanges();
        // Saved config was applied on the server side
        // The pairings are already active, just open the slot windows
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

    // Close any open slot windows
    this.slotWindows.forEach(w => { try { w.close(); } catch { /* ignore */ } });
    this.slotWindows.clear();

    // Show the pairing wizard again with the current slot IDs
    const slots = this.roomDeviceService.slotsSnapshot;
    this.pendingSlotIds = slots.map(s => s.slotId);
    this.showPairingWizard = true;
    this.cdr.detectChanges();
  }

  // ─── Pairing wizard events ────────────────────────────────────────────────

  async onPairingConfirmed(pairings: ScreenCameraPairing[]) {
    this.showPairingWizard = false;
    this.pendingPairings = pairings;

    // Ensure roomConfig is loaded before checking for displays
    if (!this.roomConfig) {
      await this.loadRoomConfig();
    }

    // If room has configured displays, show the display linker (step 2)
    // Otherwise, go straight to submitting pairings and opening slot windows
    if (this.roomConfig?.displays && this.roomConfig.displays.length > 0) {
      this.showDisplayLinker = true;
      this.cdr.detectChanges();
    } else {
      // No displays configured, skip linker and go straight to submission
      await this.submitPairingsAndOpenSlots(pairings);
    }
  }

  async onDisplayLinkingConfirmed(links: any[]) {
    this.showDisplayLinker = false;

    // Merge display links into pending pairings
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
    // This is critical for showing remote users when they connect
    this.subs.push(
      this.videoService.getParticipants().subscribe(participants => {
        // Use latest slot snapshot (may have been updated by SLOT_REMOTE_JOINED)
        const latestSlots = this.roomDeviceService.slotsSnapshot;
        for (const slot of latestSlots) {
          this.updateSlotWindow(slot, participants);
        }

        // Also handle participants that may not yet be in assignedRemotes
        // by checking all open slot windows for any unattached streams
        this.tryAttachOrphanedParticipants(participants);
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
   * Handles both normal slots and excluded (reserved) screens.
   */
  private buildSlotWindowHtml(slot: SlotState): string {
    const isExcluded = (slot as any).excluded === true;

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
    #excluded-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 20px; z-index: 1000; }
    #excluded-overlay h2 { font-size: 32px; font-weight: 600; color: #fff; }
    #excluded-overlay p { font-size: 18px; color: #aaa; }
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
