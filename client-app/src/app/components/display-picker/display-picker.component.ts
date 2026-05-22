import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';
import { filter, distinctUntilChanged } from 'rxjs/operators';
import * as THREE from 'three';
import { Viewer, SceneRevealMode, SceneFormat } from '@mkkellogg/gaussian-splats-3d';

import { RoomConfig, DisplayConfig, RoomTopologyDTO, ScreenSlotDTO } from '../../utils/hybrid-types';
import { VideoRoomService } from '../../services/video-room.service';

/**
 * Display Picker Component
 *
 * Shown to remote participants after joining a room with a configured 3D layout.
 * Displays the 3D room with live camera feeds on display planes.
 * User clicks a display plane to choose where they want to appear.
 *
 * Design principles:
 *  - Single combineLatest subscription drives all state updates.
 *  - Display planes are created ONCE (createDisplayPlanes) and only their
 *    materials/streams are updated on subsequent topology changes (updatePlaneStates).
 *  - No retry timers — participant stream updates trigger updatePlaneStates reactively.
 */
@Component({
  selector: 'app-display-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './display-picker.component.html',
  styleUrl: './display-picker.component.scss',
})
export class DisplayPickerComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('splatContainer', { static: true })
  containerRef!: ElementRef<HTMLDivElement>;

  roomName: string = '';
  roomConfig: RoomConfig | null = null;
  topology: RoomTopologyDTO | null = null;

  loading = true;
  loadError: string | null = null;
  selectedDisplayId: string | null = null;

  // Three.js and GaussianSplats3D
  private viewer: Viewer | null = null;
  private threeScene!: THREE.Scene;

  /**
   * Per-display plane data. Created once in createDisplayPlanes(), updated in updatePlaneStates().
   * Key: displayId
   */
  private displayPlanes: Map<string, {
    mesh: THREE.Mesh;
    videoElement: HTMLVideoElement;
    borderMesh: THREE.Mesh | null;
    currentState: 'unavailable' | 'no_slot' | 'available' | 'has_remote';
  }> = new Map();

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private subs = new Subscription();
  /** True once createDisplayPlanes() has run for the current roomConfig */
  private planesCreated = false;
  /** Latest snapshot of consumed participants — updated by the combineLatest subscription */
  private latestParticipants: any[] = [];

  constructor(
    private videoService: VideoRoomService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    this.roomName = this.route.snapshot.paramMap.get('roomName') || this.videoService['roomName'] || '';
    if (!this.roomName) {
      this.loadError = 'No room name provided';
      this.loading = false;
      return;
    }

    // ─── Single reactive subscription ────────────────────────────────────────
    // Combines roomConfig + topology + participants into one stream.
    // roomConfig drives plane creation (once); topology + participants drive state updates.
    this.subs.add(
      combineLatest([
        this.videoService.roomConfig.pipe(filter(c => !!c)),
        this.videoService.topology,          // may be null initially
        this.videoService.getParticipants(), // fires whenever a stream is consumed
      ]).subscribe(([config, topology, participants]) => {
        this.roomConfig = config;
        this.topology = topology;
        this.latestParticipants = participants;

        // Initialize viewer once we have room config (first time only)
        if (!this.viewer) {
          this.initViewer();
          return; // initViewer will call createDisplayPlanes() when ready
        }

        if (!this.planesCreated) {
          // First time: create geometry for every display in the config
          this.createDisplayPlanes();
        }

        // Every update: refresh materials and stream attachments
        this.updatePlaneStates(participants);
      })
    );

    // Track assignment so we can highlight the chosen display
    this.subs.add(
      this.videoService.assignment.pipe(
        filter(a => !!a),
        distinctUntilChanged((a, b) => a?.slotId === b?.slotId),
      ).subscribe(() => {
        if (this.planesCreated) {
          this.updatePlaneStates(this.latestParticipants);
        }
      })
    );
  }

  ngAfterViewInit() {
    // Viewer is initialised inside the roomConfig subscription once config arrives.
    // Nothing to do here — avoids a race between AfterViewInit and the first config emission.
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    try { this.viewer?.dispose(); } catch { /* ignore */ }
    this.displayPlanes.forEach(({ videoElement }) => {
      videoElement.pause();
      videoElement.srcObject = null;
    });
  }

  // ─── Viewer initialization ────────────────────────────────────────────────

  private async initViewer() {
    try {
      const camPos = this.roomConfig?.cameraPosition?.position;
      const camLookAt = this.roomConfig?.cameraPosition?.lookAt;

      this.threeScene = new THREE.Scene();
      this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 5);
      this.threeScene.add(dir);

      this.viewer = new Viewer({
        rootElement: this.containerRef.nativeElement,
        useBuiltInControls: true,
        selfDrivenMode: true,
        threeScene: this.threeScene,
        cameraUp: [0, -1, 0],
        ...(camPos ? { initialCameraPosition: [camPos.x, camPos.y, camPos.z] as [number, number, number] } : {}),
        ...(camLookAt ? { initialCameraLookAt: [camLookAt.x, camLookAt.y, camLookAt.z] as [number, number, number] } : {}),
        sceneRevealMode: SceneRevealMode.Gradual,
        sharedMemoryForWorkers: false,
      });

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

      // Restrict to orbit-only (no pan/zoom) — first-person look-around
      const controls = (this.viewer as any).controls;
      if (controls) {
        controls.enablePan = false;
        controls.enableZoom = false;
        const cam = controls.object;
        if (cam) {
          const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          controls.target.copy(cam.position).addScaledVector(lookDir, 0.01);
          controls.minDistance = 0;
          controls.maxDistance = Infinity;
          controls.update();
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

      this.containerRef.nativeElement.addEventListener('click', (event) => this.onCanvasClick(event));

      this.loading = false;

      // Now that the scene is ready, trigger plane creation if config + topology arrived already
      if (this.roomConfig && !this.planesCreated) {
        this.createDisplayPlanes();
      }
      if (this.planesCreated) {
        this.updatePlaneStates(this.latestParticipants);
      }
    } catch (err) {
      console.error('[DisplayPicker] Failed to initialize viewer:', err);
      this.loadError = String(err);
      this.loading = false;
    }
  }

  // ─── Display plane management ─────────────────────────────────────────────

  /**
   * Creates Three.js plane geometry for every display in the room config.
   * Called ONCE per room config. Subsequent topology/participant changes call
   * updatePlaneStates() instead — no geometry is destroyed or recreated.
   */
  private createDisplayPlanes() {
    if (!this.roomConfig || !this.threeScene) return;

    const displays = this.roomConfig.displays || [];

    displays.forEach((display) => {
      if (this.displayPlanes.has(display.displayId)) return; // already created

      // Off-screen video element — needed for THREE.VideoTexture to work
      const videoElement = document.createElement('video');
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      videoElement.crossOrigin = 'anonymous';
      videoElement.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:640px;height:480px;opacity:1;';
      this.containerRef.nativeElement.appendChild(videoElement);

      // Geometry
      const geometry = new THREE.PlaneGeometry(display.widthM, display.heightM);

      // Start with a placeholder blue material — updatePlaneStates() will switch to video texture
      const material = new THREE.MeshBasicMaterial({
        color: 0x0055cc,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(display.position3D.x, display.position3D.y, display.position3D.z);
      mesh.rotation.y = display.rotationY;
      mesh.userData = { displayId: display.displayId, displayState: 'available' };

      this.threeScene.add(mesh);

      // Border mesh (updated in updatePlaneStates)
      const borderMesh = this.buildBorderMesh(display, 'available');
      if (borderMesh) this.threeScene.add(borderMesh);

      this.displayPlanes.set(display.displayId, {
        mesh,
        videoElement,
        borderMesh,
        currentState: 'available',
      });
    });

    this.planesCreated = true;
    console.log('[DisplayPicker] Created', this.displayPlanes.size, 'display plane(s)');
  }

  /**
   * Updates materials, borders, and stream attachments for all existing planes.
   * Called on every topology or participant change — never destroys geometry.
   */
  private updatePlaneStates(participants: any[]) {
    if (!this.roomConfig || !this.threeScene || !this.planesCreated) return;

    const mySocketId = (this.videoService as any).socketService?.socket?.id;

    for (const display of (this.roomConfig.displays || [])) {
      const planeData = this.displayPlanes.get(display.displayId);
      if (!planeData) continue;

      const slot = this.topology?.slots.find(s => s.displayId === display.displayId);
      const newState = this.getDisplayState(slot);

      // Update userData so raycasting reads the latest state
      planeData.mesh.userData['displayState'] = newState;
      if (planeData.borderMesh) planeData.borderMesh.userData['displayState'] = newState;

      if (newState === 'unavailable') {
        // Hide excluded planes entirely
        planeData.mesh.visible = false;
        if (planeData.borderMesh) planeData.borderMesh.visible = false;
        continue;
      }

      planeData.mesh.visible = true;
      if (planeData.borderMesh) planeData.borderMesh.visible = true;

      // Update border colour when state changes
      if (newState !== planeData.currentState) {
        this.updateBorderColor(planeData.borderMesh, newState);
        planeData.currentState = newState;
      }

      // Attach stream if slot has a remote assigned
      if (newState === 'has_remote' && slot) {
        this.tryAttachStream(display.displayId, slot, planeData, participants, mySocketId);
      } else if (newState !== 'has_remote') {
        // Revert to colour material if no remote is assigned (e.g. remote left)
        this.revertToColorMaterial(planeData.mesh, newState);
        if (planeData.videoElement.srcObject) {
          planeData.videoElement.pause();
          planeData.videoElement.srcObject = null;
        }
      }
    }
  }

  // ─── Display state helpers ────────────────────────────────────────────────

  /**
   * Determines the visual state of a display based on its linked slot.
   *
   *   'unavailable' – slot exists but is excluded from the conference
   *   'no_slot'     – no physical device has been linked to this virtual display
   *   'available'   – slot exists, not excluded, no remote assigned yet
   *   'has_remote'  – slot has at least one remote participant assigned
   */
  private getDisplayState(slot: ScreenSlotDTO | undefined): 'unavailable' | 'no_slot' | 'available' | 'has_remote' {
    if (!slot) return 'no_slot';
    if (slot.excluded) return 'unavailable';
    if (slot.assignedRemoteIds && slot.assignedRemoteIds.length > 0) return 'has_remote';
    return 'available';
  }

  /**
   * Reverts a plane's material to a solid colour (blue = available, dark = no_slot).
   * Called when a remote leaves and the plane should no longer show video.
   */
  private revertToColorMaterial(mesh: THREE.Mesh, state: 'no_slot' | 'available' | 'has_remote') {
    const mat = mesh.material as THREE.MeshBasicMaterial | THREE.ShaderMaterial;
    // Handle both MeshBasicMaterial (with VideoTexture) and ShaderMaterial
    if (mat instanceof THREE.ShaderMaterial) {
      const texture = mat.uniforms?.['map']?.value;
      if (texture instanceof THREE.VideoTexture) {
        texture.dispose();
      }
    } else if (mat instanceof THREE.MeshBasicMaterial) {
      if (mat.map instanceof THREE.VideoTexture) {
        mat.map.dispose();
      }
    }
    if (state === 'no_slot') {
      mesh.material = new THREE.MeshBasicMaterial({
        color: 0x111111, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
      });
    } else {
      mesh.material = new THREE.MeshBasicMaterial({
        color: 0x0055cc, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      });
    }
    if (mat instanceof THREE.MeshBasicMaterial) {
      mat.dispose();
    }
  }

  /**
   * Updates the border mesh colour to match the new display state.
   */
  private updateBorderColor(
    borderMesh: THREE.Mesh | null,
    state: 'unavailable' | 'no_slot' | 'available' | 'has_remote',
  ) {
    if (!borderMesh) return;
    const mat = borderMesh.material as THREE.MeshBasicMaterial;
    if (state === 'available') mat.color.setHex(0x0099ff);
    else if (state === 'has_remote') mat.color.setHex(0x00cc88);
    else mat.color.setHex(0x333333);
  }

  /**
   * Builds a slightly-larger border mesh placed just behind the display plane.
   * Blue border for 'available', teal for 'has_remote', dark for 'no_slot'.
   */
  private buildBorderMesh(display: DisplayConfig, state: 'unavailable' | 'no_slot' | 'available' | 'has_remote'): THREE.Mesh | null {
    const borderColor =
      state === 'available' ? 0x0099ff :
      state === 'has_remote' ? 0x00cc88 :
      state === 'no_slot' ? 0x333333 : null;
    if (!borderColor) return null;

    const borderPad = 0.04;
    const borderGeo = new THREE.PlaneGeometry(display.widthM + borderPad, display.heightM + borderPad);
    const borderMat = new THREE.MeshBasicMaterial({ color: borderColor, side: THREE.DoubleSide });
    const borderMesh = new THREE.Mesh(borderGeo, borderMat);

    const offset = new THREE.Vector3(0, 0, -0.005);
    offset.applyEuler(new THREE.Euler(0, display.rotationY, 0));

    borderMesh.position.set(
      display.position3D.x + offset.x,
      display.position3D.y + offset.y,
      display.position3D.z + offset.z,
    );
    borderMesh.rotation.y = display.rotationY;
    borderMesh.userData = { displayId: display.displayId, displayState: state, isBorder: true };

    return borderMesh;
  }

  // ─── Stream attachment ────────────────────────────────────────────────────

  /**
   * Tries to attach a consumed remote stream to a display plane.
   * If the stream is already attached and live, this is a no-op.
   * If the stream is not yet available, the next participant update will retry.
   */
  private tryAttachStream(
    displayId: string,
    slot: ScreenSlotDTO,
    planeData: { mesh: THREE.Mesh; videoElement: HTMLVideoElement; borderMesh: THREE.Mesh | null; currentState: string },
    participants: any[],
    mySocketId: string | undefined,
  ) {
    const { videoElement, mesh } = planeData;

    // Skip if a live stream is already attached
    if (videoElement.srcObject) {
      const existing = videoElement.srcObject as MediaStream;
      if (existing.getTracks().some(t => t.readyState === 'live')) return;
    }

    for (const remoteSocketId of slot.assignedRemoteIds) {
      if (remoteSocketId === mySocketId) continue; // never show own stream

      const participant = participants.find((p: any) => p.socketId === remoteSocketId);
      if (!participant?.stream) continue;

      this.attachStreamToVideoElement(videoElement, participant.stream);
      this.switchMeshToVideoTexture(mesh, videoElement);
      console.log('[DisplayPicker] Attached remote', remoteSocketId, 'to display', displayId);
      return;
    }

    // Streams not yet consumed — next participant update will call updatePlaneStates again
    console.log('[DisplayPicker] Slot', slot.slotId, 'has remote(s) but streams not yet available');
  }

  /**
   * Switches a display plane's material to a live VideoTexture.
   * Called once a real stream is available so the plane transitions from its
   * status colour (blue / dark) to the actual video feed.
   */
  private switchMeshToVideoTexture(mesh: THREE.Mesh, videoElement: HTMLVideoElement) {
    const oldMat = mesh.material as THREE.MeshBasicMaterial;
    if (oldMat.map instanceof THREE.VideoTexture) return; // already showing video

    const texture = new THREE.VideoTexture(videoElement);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // Fix upside-down video
    texture.needsUpdate = true;

    // Use a shader material to add margins around the video
    const margin = 0.03; // 3% margin on each side
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const fragmentShader = `
      uniform sampler2D map;
      uniform float margin;
      varying vec2 vUv;
      void main() {
        // Apply margin by clamping UV coordinates
        vec2 uv = vec2(
          clamp(vUv.x, margin, 1.0 - margin),
          clamp(vUv.y, margin, 1.0 - margin)
        );
        // Scale to account for margin (remove black bars)
        vec2 scaledUv = (uv - margin) / (1.0 - 2.0 * margin);
        vec4 color = texture2D(map, scaledUv);
        // Add black background for margin area
        if (vUv.x < margin || vUv.x > 1.0 - margin || vUv.y < margin || vUv.y > 1.0 - margin) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        } else {
          gl_FragColor = color;
        }
      }
    `;

    const newMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        margin: { value: margin },
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
    });

    mesh.material = newMat;
    oldMat.dispose();
  }

  /**
   * Safely attaches a MediaStream to a video element and starts playback.
   * Idempotent: skips if the same stream is already attached.
   */
  private attachStreamToVideoElement(videoElement: HTMLVideoElement, stream: MediaStream) {
    try {
      if (videoElement.srcObject === stream) return;

      videoElement.srcObject = stream;

      const onLoadedMetadata = () => {
        videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.play().catch((err) => {
          console.warn('[DisplayPicker] video.play() failed:', err.name);
          setTimeout(() => videoElement.play().catch(() => {}), 200);
        });
      };
      videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
      videoElement.play().catch(() => { /* expected before metadata loads */ });
    } catch (err) {
      console.error('[DisplayPicker] Failed to attach stream to video element:', err);
    }
  }

  // ─── User interaction ─────────────────────────────────────────────────────

  private onCanvasClick(event: MouseEvent) {
    if (!this.viewer || !this.threeScene) return;

    const canvas = this.containerRef.nativeElement.querySelector('canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = (this.viewer as any).camera;
    this.raycaster.setFromCamera(this.mouse, camera);

    const planes = Array.from(this.displayPlanes.values()).flatMap((p) =>
      p.borderMesh ? [p.mesh, p.borderMesh] : [p.mesh]
    );
    const intersects = this.raycaster.intersectObjects(planes);

    if (intersects.length > 0) {
      const clicked = intersects[0].object as THREE.Mesh;
      const displayId = clicked.userData['displayId'];
      const displayState = clicked.userData['displayState'];

      if (displayState === 'no_slot') {
        console.log('[DisplayPicker] Clicked display has no physical device linked — ignoring');
        return;
      }

      this.selectDisplay(displayId);
    }
  }

  /**
   * Selects a display and emits CHOOSE_DISPLAY to the server.
   */
  async selectDisplay(displayId: string) {
    this.selectedDisplayId = displayId;
    console.log('[DisplayPicker] Selected display:', displayId);

    try {
      const result = await this.videoService.chooseDisplay(displayId);
      if (result && result.success) {
        console.log('[DisplayPicker] Display choice confirmed by server');
        this.onDisplayChosen();
      } else {
        console.error('[DisplayPicker] Server rejected display choice:', result?.error);
        this.selectedDisplayId = null;
      }
    } catch (err) {
      console.error('[DisplayPicker] Failed to choose display:', err);
      this.selectedDisplayId = null;
    }
  }

  /** Emitted when the user has successfully chosen a display and the server confirmed it. */
  @Output() displayChosen = new EventEmitter<void>();

  onDisplayChosen() {
    console.log('[DisplayPicker] Display choice confirmed, hiding picker');
    this.displayChosen.emit();
  }

  // ─── Fallback list view ───────────────────────────────────────────────────

  get availableDisplays(): DisplayConfig[] {
    if (!this.roomConfig) return [];
    return this.roomConfig.displays.filter((d) => {
      const slot = this.topology?.slots.find((s) => s.displayId === d.displayId);
      return slot && !slot.excluded;
    });
  }

  selectDisplayFromList(displayId: string) {
    this.selectDisplay(displayId);
  }
}
