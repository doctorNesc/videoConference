import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
  Input,
  Output,
  EventEmitter,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import * as THREE from 'three';
import { Viewer, SceneRevealMode, SceneFormat } from '@mkkellogg/gaussian-splats-3d';

import { RoomConfig, DisplayConfig, ScreenCameraPairing } from '../../utils/hybrid-types';

export interface DisplayLinkResult {
  slotId: string;
  displayId: string | null;  // null = excluded
  excluded: boolean;
}

interface SlotLinkState {
  slotId: string;
  screenLabel: string;
  selectedDisplayId: string | null;
  excluded: boolean;
}

/**
 * Room Device Display Linker Component
 *
 * Step 2 of the room device setup wizard.
 * Shown after the pairing wizard (screen → camera) completes.
 * Allows the operator to link each physical screen/slot to a configured display position in the 3D room.
 *
 * UI: Split panel — 3D splat viewer on left, sidebar on right with slot list.
 * Operator clicks a display plane in 3D, then clicks a slot row to link them.
 * Or uses dropdown in sidebar to select display per slot.
 */
@Component({
  selector: 'app-room-device-display-linker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './room-device-display-linker.component.html',
  styleUrl: './room-device-display-linker.component.scss',
})
export class RoomDeviceDisplayLinkerComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('splatContainer', { static: true })
  splatContainerRef!: ElementRef<HTMLDivElement>;

  @Input() roomName: string = '';
  @Input() slots: ScreenCameraPairing[] = [];

  @Output() displayLinkingConfirmed = new EventEmitter<DisplayLinkResult[]>();
  @Output() cancelled = new EventEmitter<void>();

  roomConfig: RoomConfig | null = null;
  slotLinkStates: SlotLinkState[] = [];

  /** Index of the slot currently waiting for a display click. -1 = none. */
  activeSlotIndex: number = 0;

  loading = true;
  loadError: string | null = null;

  // Three.js and GaussianSplats3D
  private viewer: Viewer | null = null;
  private threeScene!: THREE.Scene;
  private displayPlanes: Map<string, { mesh: THREE.Mesh; label: THREE.Sprite }> = new Map();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private _boundModeListener: (() => void) | null = null;

  private subs = new Subscription();

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    if (!this.roomName) {
      this.loadError = 'No room name provided';
      this.loading = false;
      return;
    }

    // Initialize slot link states from input slots
    this.slotLinkStates = this.slots.map(s => ({
      slotId: s.slotId,
      screenLabel: `Screen ${this.slots.indexOf(s) + 1}`,
      selectedDisplayId: null,
      excluded: false,
    }));
  }

  ngAfterViewInit() {
    this.initViewer();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    try {
      this.viewer?.dispose();
    } catch { /* ignore */ }
  }

  // ─── Viewer initialization ────────────────────────────────────────────────

  private async initViewer() {
    try {
      // Check if container ref is available
      if (!this.splatContainerRef?.nativeElement) {
        this.loadError = 'Container not ready';
        this.loading = false;
        return;
      }

      // Load room config
      const configResponse = await this.http.get<RoomConfig>(`/api/rooms/${this.roomName}`).toPromise();
      if (configResponse) {
        this.roomConfig = configResponse;
      }

      if (!this.roomConfig || !this.roomConfig.displays || this.roomConfig.displays.length === 0) {
        this.loadError = 'No displays configured for this room';
        this.loading = false;
        return;
      }

      // Use saved camera position if available
      const camPos = this.roomConfig.cameraPosition?.position;
      const camLookAt = this.roomConfig.cameraPosition?.lookAt;

      // Create Three.js scene for overlay (passed to viewer so display planes render in same scene)
      this.threeScene = new THREE.Scene();
      this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 5);
      this.threeScene.add(dir);

      // Initialize GaussianSplats3D viewer — same options as room editor
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

      // Load splat via the same API route as room editor
      await this.viewer.addSplatScene(`/api/rooms/${this.roomName}/splat`, {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: false,
        format: SceneFormat.Splat,
      });

      // Render display planes into the shared threeScene
      this.renderDisplayPlanes();

      // Start the viewer render loop
      this.viewer.start();

      // Lock camera to saved position (no pan/zoom/orbit)
      this.lockCamera();

      // Setup click handler AFTER viewer.start() so canvas exists
      this.setupClickHandler();

      this.loading = false;
      this.cdr.detectChanges();
    } catch (err) {
      console.error('[RoomDeviceDisplayLinker] initViewer failed:', err);
      this.loadError = String(err);
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  // ─── Camera lock ─────────────────────────────────────────────────────────

  /**
   * Applies bound-mode controls: camera position is fixed, but allows rotation
   * around the Y axis (look around). Pan and zoom are disabled.
   * Also disables the viewer's click-to-set-orbit-target handler so our own
   * click handler can fire cleanly.
   */
  private lockCamera() {
    const controls = (this.viewer as any)?.controls;
    const camera = this.viewer?.camera;
    if (!controls || !camera) return;

    // Cancel any in-progress camera target transition
    (this.viewer as any).transitioningCameraTarget = false;

    // Disable pan and zoom (but allow rotation)
    controls.enablePan = false;
    controls.enableZoom = false;

    // Pin orbit target just ahead of camera so rotation pivots around camera position
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).addScaledVector(lookDir, 0.01);
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.update();

    // After every OrbitControls update, re-pin the target just ahead of camera
    // (only if distance hasn't changed, i.e., only during rotation, not zoom).
    // This keeps the orbit pivot glued to the camera (first-person look-around).
    let lastDistance = controls.target.distanceTo(camera.position);
    this._boundModeListener = () => {
      const currentDistance = controls.target.distanceTo(camera.position);
      // Only re-pin if distance is stable (rotation, not zoom)
      if (Math.abs(currentDistance - lastDistance) < 0.001) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        controls.target.copy(camera.position).addScaledVector(dir, 0.01);
      }
      lastDistance = currentDistance;
    };
    controls.addEventListener('change', this._boundModeListener);

    // Disable the viewer's built-in click-to-orbit-target handler
    (this.viewer as any).checkForFocalPointChange = () => { /* locked */ };
  }

  // ─── Display plane rendering ──────────────────────────────────────────────

  private renderDisplayPlanes() {
    if (!this.roomConfig || !this.threeScene) return;

    const displays = this.roomConfig.displays || [];
    displays.forEach((display) => {
      const geometry = new THREE.PlaneGeometry(display.widthM, display.heightM);
      const material = new THREE.MeshStandardMaterial({
        color: 0x333333,
        emissive: 0x444444,
        metalness: 0.3,
        roughness: 0.7,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(display.position3D.x, display.position3D.y, display.position3D.z);
      mesh.rotation.y = display.rotationY;
      mesh.userData = { displayId: display.displayId };

      this.threeScene.add(mesh);

      // Create label sprite
      const label = this.makeTextSprite(display.label);
      label.position.copy(mesh.position);
      label.position.y += display.heightM / 2 + 0.2;
      this.threeScene.add(label);

      this.displayPlanes.set(display.displayId, { mesh, label });
    });
  }

  private makeTextSprite(text: string): THREE.Sprite {
    const canvas = this.renderTextCanvas(text);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.3, 0.15, 1);
    return sprite;
  }

  private renderTextCanvas(text: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    return canvas;
  }

  // ─── Click handler ────────────────────────────────────────────────────────

  private setupClickHandler() {
    if (!this.splatContainerRef) return;

    const canvas = this.splatContainerRef.nativeElement.querySelector('canvas');
    if (!canvas) return;

    // Track pointer movement per pointer ID to detect clicks vs drags
    const pointerStartPos = new Map<number, { x: number; y: number }>();
    const MOVE_THRESHOLD = 5; // pixels

    canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      pointerStartPos.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });

    canvas.addEventListener('pointerup', (event: PointerEvent) => {
      const startPos = pointerStartPos.get(event.pointerId);
      pointerStartPos.delete(event.pointerId);

      // Only treat as click if pointer didn't move much
      if (startPos) {
        const dx = event.clientX - startPos.x;
        const dy = event.clientY - startPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < MOVE_THRESHOLD) {
          this.onCanvasClick(event);
        }
      }
    });
  }

  private onCanvasClick(event: PointerEvent | MouseEvent) {
    if (!this.viewer || !this.threeScene) return;

    const canvas = this.splatContainerRef.nativeElement.querySelector('canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Use the viewer's camera (not a cached reference)
    const camera = this.viewer.camera;
    if (!camera) return;

    this.raycaster.setFromCamera(this.mouse, camera);

    const displayMeshes = Array.from(this.displayPlanes.values()).map(p => p.mesh);
    const intersects = this.raycaster.intersectObjects(displayMeshes);

    if (intersects.length > 0) {
      const mesh = intersects[0].object as THREE.Mesh;
      const displayId = mesh.userData['displayId'];
      console.log('[DisplayLinker] Clicked display:', displayId);

      // Simply select the clicked display (last clicked wins)
      this.selectDisplayForActiveSlot(displayId);
    }
  }

  // ─── Slot linking ─────────────────────────────────────────────────────────

  /** Selects a display for the currently active slot. */
  private selectDisplayForActiveSlot(displayId: string) {
    // Skip excluded slots to find the next valid active slot
    while (
      this.activeSlotIndex < this.slotLinkStates.length &&
      this.slotLinkStates[this.activeSlotIndex].excluded
    ) {
      this.activeSlotIndex++;
    }

    // If all slots are assigned, just update the last one
    if (this.activeSlotIndex >= this.slotLinkStates.length) {
      this.activeSlotIndex = this.slotLinkStates.length - 1;
    }

    const state = this.slotLinkStates[this.activeSlotIndex];
    console.log('[DisplayLinker] Selected display', displayId, 'for slot', this.activeSlotIndex, state.screenLabel);
    state.selectedDisplayId = displayId;
    state.excluded = false;

    // Highlight the selected display plane
    this.highlightDisplayPlane(displayId);

    this.cdr.detectChanges();
  }

  /** Highlights the assigned display plane green; resets others to default grey. */
  private highlightDisplayPlane(assignedDisplayId: string) {
    console.log('[DisplayLinker] Highlighting display:', assignedDisplayId);
    this.displayPlanes.forEach(({ mesh }, displayId) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (displayId === assignedDisplayId) {
        console.log('[DisplayLinker] Setting', displayId, 'to green');
        mat.color.set(0x22c55e);   // green
        mat.emissive.set(0x166534);
      } else {
        // Check if this display is assigned to any slot
        const isAssigned = this.slotLinkStates.some(s => s.selectedDisplayId === displayId);
        if (!isAssigned) {
          mat.color.set(0x333333);
          mat.emissive.set(0x444444);
        }
      }
      mat.needsUpdate = true;
    });
  }

  /** Manually set the active slot index (called when user clicks a slot row in sidebar). */
  setActiveSlot(index: number) {
    this.activeSlotIndex = index;
    this.cdr.detectChanges();
  }

  onDisplayDropdownChange(slotId: string, displayId: string) {
    const state = this.slotLinkStates.find(s => s.slotId === slotId);
    if (state) {
      state.selectedDisplayId = displayId || null;
      state.excluded = false;
      if (displayId) {
        this.highlightDisplayPlane(displayId);
      }
      this.cdr.detectChanges();
    }
  }

  toggleExcluded(slotId: string) {
    const state = this.slotLinkStates.find(s => s.slotId === slotId);
    if (state) {
      state.excluded = !state.excluded;
      if (state.excluded) {
        state.selectedDisplayId = null;
      }
      this.cdr.detectChanges();
    }
  }

  // ─── Confirm / Cancel ─────────────────────────────────────────────────────

  confirm() {
    const results: DisplayLinkResult[] = this.slotLinkStates.map(state => ({
      slotId: state.slotId,
      displayId: state.excluded ? null : state.selectedDisplayId,
      excluded: state.excluded,
    }));

    this.displayLinkingConfirmed.emit(results);
  }

  onCancel() {
    this.cancelled.emit();
  }

  get canConfirm(): boolean {
    // All non-excluded slots must have a display selected
    return this.slotLinkStates.every(s => s.excluded || s.selectedDisplayId);
  }

  getDisplayLabel(displayId: string | null): string {
    if (!displayId || !this.roomConfig) return '— Select display —';
    const display = this.roomConfig.displays.find(d => d.displayId === displayId);
    return display?.label || displayId;
  }
}
