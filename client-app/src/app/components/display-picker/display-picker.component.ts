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
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
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
  private displayPlanes: Map<string, { mesh: THREE.Mesh; videoElement: HTMLVideoElement }> = new Map();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private subs = new Subscription();

  constructor(
    private videoService: VideoRoomService,
    private http: HttpClient,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    // Get room name from route parameter first, then fall back to VideoRoomService
    this.roomName = this.route.snapshot.paramMap.get('roomName') || this.videoService['roomName'] || '';
    if (!this.roomName) {
      this.loadError = 'No room name provided';
      this.loading = false;
      return;
    }

    // Subscribe to topology updates
    this.subs.add(
      this.videoService.topology.subscribe((topology) => {
        if (topology) {
          this.topology = topology;
          this.updateDisplayPlanes();
        }
      })
    );
  }

  ngAfterViewInit() {
    this.initViewer();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    try {
      this.viewer?.dispose();
    } catch { /* ignore */ }
    // Clean up video elements
    this.displayPlanes.forEach(({ videoElement }) => {
      videoElement.pause();
      videoElement.srcObject = null;
    });
  }

  // ─── Viewer initialization ────────────────────────────────────────────────

  private async initViewer() {
    try {
      // Load room config first so we can use the saved camera position
      const configResponse = await this.http.get<RoomConfig>(`/api/rooms/${this.roomName}`).toPromise();
      if (configResponse) {
        this.roomConfig = configResponse;
      }

      // Use saved camera position if available; otherwise let the library auto-fit
      const camPos = this.roomConfig?.cameraPosition?.position;
      const camLookAt = this.roomConfig?.cameraPosition?.lookAt;

      // Create Three.js scene for overlay
      this.threeScene = new THREE.Scene();
      this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 5);
      this.threeScene.add(dir);

      // Initialize GaussianSplats3D viewer
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

      // Load splat file
      const splatUrl = `/api/rooms/${this.roomName}/splat`;
      await this.viewer.addSplatScene(splatUrl, {
        splatAlphaRemovalThreshold: 5,
        format: SceneFormat.Splat,
        showLoadingUI: false,
      });

      this.viewer.start();

      // Create display planes immediately if we have room config and topology
      // Don't wait for topology subscription to fire
      if (this.roomConfig && this.topology) {
        this.updateDisplayPlanes();
      } else if (this.roomConfig && !this.topology) {
        // If we have room config but no topology yet, create placeholder planes
        // They will be updated when topology arrives
        this.updateDisplayPlanes();
      }

      // Disable the library's built-in click-to-set-orbit-target behaviour entirely.
      (this.viewer as any).checkForFocalPointChange = () => { /* disabled */ };
      // Cancel any in-progress camera target transition
      (this.viewer as any).transitioningCameraTarget = false;

      // Restrict common users to orbit-only: disable pan and zoom on the built-in OrbitControls
      // Set target just in front of camera (tiny distance) for first-person look-around
      const controls = (this.viewer as any).controls;
      if (controls) {
        controls.enablePan = false;
        controls.enableZoom = false;
        const cam = controls.object;
        if (cam) {
          // Compute a point 0.01 units ahead of the camera along its look direction
          const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          controls.target.copy(cam.position).addScaledVector(lookDir, 0.01);
          controls.minDistance = 0;
          controls.maxDistance = Infinity; // don't let OrbitControls snap the camera
          controls.update();
          // Keep target pinned just ahead of camera on every update (first-person look-around),
          // but only if distance is stable (rotation, not zoom).
          let lastDistance = controls.target.distanceTo(cam.position);
          controls.addEventListener('change', () => {
            const currentDistance = controls.target.distanceTo(cam.position);
            // Only re-pin if distance is stable (rotation, not zoom)
            if (Math.abs(currentDistance - lastDistance) < 0.001) {
              const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
              controls.target.copy(cam.position).addScaledVector(dir, 0.01);
            }
            lastDistance = currentDistance;
          });
        }
      }

      // Set up click handler for display selection
      this.containerRef.nativeElement.addEventListener('click', (event) => this.onCanvasClick(event));

      this.loading = false;
    } catch (err) {
      console.error('[DisplayPicker] Failed to initialize viewer:', err);
      this.loadError = String(err);
      this.loading = false;
    }
  }

  // ─── Display plane management ─────────────────────────────────────────────

  /**
   * Creates or updates display planes based on room config and topology.
   * Each plane shows the live camera feed from that display's paired camera.
   */
  private updateDisplayPlanes() {
    if (!this.roomConfig || !this.threeScene) return;

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
      // Find the slot linked to this display (if topology is available)
      const slot = this.topology?.slots.find((s) => s.displayId === display.displayId);
      if (slot && slot.excluded) return; // Skip excluded slots

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
      mesh.userData = { displayId: display.displayId, slotId: slot?.slotId };

      this.threeScene.add(mesh);
      this.displayPlanes.set(display.displayId, { mesh, videoElement });

      // Try to attach the camera stream from the consumer (if slot is available)
      if (slot) {
        this.attachCameraStreamToPlane(display.displayId, slot);
      }
    });
  }

  /**
   * Attaches the camera stream from a slot's producer to the display plane.
   * The stream comes from the mediasoup consumer for that producer.
   */
  private attachCameraStreamToPlane(displayId: string, slot: ScreenSlotDTO) {
    const planeData = this.displayPlanes.get(displayId);
    if (!planeData) return;

    const { videoElement } = planeData;

    // Try to get the stream from the VideoRoomService's consumers
    // The consumer's track is attached to a MediaStream
    try {
      const consumers = (this.videoService as any).consumers || [];
      for (const consumer of consumers) {
        // Check if this consumer's producer matches the slot's camera producer
        if (consumer.producerId === slot.cameraProducerId) {
          const stream = new MediaStream([consumer.track]);
          videoElement.srcObject = stream;
          videoElement.play().catch((err) => console.warn('[DisplayPicker] video.play() failed:', err));
          console.log('[DisplayPicker] Attached stream to display', displayId);
          return;
        }
      }
    } catch (err) {
      console.warn('[DisplayPicker] Failed to attach stream:', err);
    }

    // Fallback: show placeholder
    console.log('[DisplayPicker] No stream available yet for display', displayId);
  }

  // ─── User interaction ─────────────────────────────────────────────────────

  /**
   * Handles canvas click to select a display.
   */
  private onCanvasClick(event: MouseEvent) {
    if (!this.viewer || !this.threeScene) return;

    const canvas = this.containerRef.nativeElement.querySelector('canvas');
    if (!canvas) return;

    // Get mouse position in normalized device coordinates
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycaster from camera
    const camera = (this.viewer as any).camera;
    this.raycaster.setFromCamera(this.mouse, camera);

    // Find intersections with display planes
    const planes = Array.from(this.displayPlanes.values()).map((p) => p.mesh);
    const intersects = this.raycaster.intersectObjects(planes);

    if (intersects.length > 0) {
      const clicked = intersects[0].object as THREE.Mesh;
      const displayId = clicked.userData['displayId'];
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
        // Hide picker overlay (parent component will handle this)
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

  /**
   * Called when display choice is confirmed. Emits displayChosen so the parent can hide this overlay.
   */
  onDisplayChosen() {
    console.log('[DisplayPicker] Display choice confirmed, hiding picker');
    this.displayChosen.emit();
  }

  // ─── Fallback list view ───────────────────────────────────────────────────

  /**
   * Returns available displays for fallback list view (if 3D viewer fails).
   */
  get availableDisplays(): DisplayConfig[] {
    if (!this.roomConfig) return [];
    return this.roomConfig.displays.filter((d) => {
      const slot = this.topology?.slots.find((s) => s.displayId === d.displayId);
      return slot && !slot.excluded;
    });
  }

  /**
   * Fallback: user clicks a display in the list.
   */
  selectDisplayFromList(displayId: string) {
    this.selectDisplay(displayId);
  }
}
