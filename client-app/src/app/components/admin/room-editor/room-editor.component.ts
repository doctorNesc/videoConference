import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import * as THREE from 'three';
import { Viewer, SceneRevealMode, SceneFormat } from '@mkkellogg/gaussian-splats-3d';

import { RoomConfig, DisplayConfig, CameraPosition } from '../../../utils/hybrid-types';

@Component({
  selector: 'app-room-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './room-editor.component.html',
  styleUrl: './room-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('splatContainer', { static: false })
  containerRef?: ElementRef<HTMLDivElement>;

  roomName: string = '';
  roomConfig: RoomConfig | null = null;
  displays: DisplayConfig[] = [];
  selectedDisplayId: string | null = null;

  loading = true;
  loadError: string | null = null;
  saving = false;
  saveError: string | null = null;

  // Camera position state
  savedCameraPosition: CameraPosition | null = null;
  cameraPositionSaved = false; // flash feedback

  // Three.js scene and viewer
  private viewer: Viewer | null = null;
  private threeScene!: THREE.Scene;
  private camera!: THREE.Camera;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // Display marker meshes
  private displayMarkers: Map<string, THREE.Mesh> = new Map();
  private displayLabels: Map<string, THREE.Sprite> = new Map();

  // Raycasting plane (for click-to-place)
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Click-to-place mode
  clickToPlaceMode = false;

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.roomName = this.route.snapshot.paramMap.get('name') || '';
    if (!this.roomName) {
      this.loadError = 'Room name not provided';
      this.loading = false;
    }
  }

  async ngAfterViewInit() {
    if (!this.roomName) {
      return;
    }

    await this.loadRoomConfig();

    // Set loading = false so *ngIf reveals #splatContainer in the template
    this.loading = false;
    this.cdr.detectChanges();

    // Wait one microtask tick for Angular to render the now-visible container
    await new Promise(resolve => setTimeout(resolve, 0));

    await this.initViewer();
  }

  ngOnDestroy() {
    try {
      this.viewer?.dispose();
    } catch {
      /* ignore */
    }
  }

  // ─── Load room config ─────────────────────────────────────────────────────

  private async loadRoomConfig() {
    try {
      const response = await this.http
        .get<RoomConfig>(`/api/rooms/${this.roomName}`)
        .toPromise();
      if (response) {
        this.roomConfig = response;
        this.displays = response.displays || [];
        this.savedCameraPosition = response.cameraPosition || null;
      }
    } catch (err) {
      console.error('[RoomEditor] Failed to load room config:', err);
      this.loadError = `Failed to load room config: ${err}`;
    }
  }

  // ─── Initialize viewer ─────────────────────────────────────────────────────

  private async initViewer() {
    try {
      if (!this.containerRef?.nativeElement) {
        throw new Error('Splat container not found');
      }

      // Three.js scene for overlay markers
      this.threeScene = new THREE.Scene();

      // Lighting
      this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 5);
      this.threeScene.add(dir);

      const containerElement = this.containerRef.nativeElement;

      // Use saved camera position if available; otherwise let the library auto-fit
      const camPos = this.savedCameraPosition?.position;
      const camLookAt = this.savedCameraPosition?.lookAt;

      this.viewer = new Viewer({
        rootElement: containerElement,
        useBuiltInControls: true,
        selfDrivenMode: true,
        threeScene: this.threeScene,
        cameraUp: [0, -1, 0],
        ...(camPos ? { initialCameraPosition: [camPos.x, camPos.y, camPos.z] as [number, number, number] } : {}),
        ...(camLookAt ? { initialCameraLookAt: [camLookAt.x, camLookAt.y, camLookAt.z] as [number, number, number] } : {}),
        sceneRevealMode: SceneRevealMode.Gradual,
        sharedMemoryForWorkers: false,
      });

      // Load splat — pass explicit format since URL has no .splat extension
      await this.viewer.addSplatScene(`/api/rooms/${this.roomName}/splat`, {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: false,
        format: SceneFormat.Splat,
      });

      // Get camera from viewer
      this.camera = this.threeScene.getObjectByProperty('type', 'PerspectiveCamera') as THREE.Camera;
      if (!this.camera) {
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      }

      // Render existing displays
      this.renderDisplayMarkers();

      // Setup click handler
      this.setupClickHandler();

      this.viewer.start();

      // Set OrbitControls target = camera position → zero orbit radius → spins in place (first-person look-around)
      const controls = (this.viewer as any).controls;
      if (controls) {
        const cam = controls.object;
        if (cam) {
          controls.target.copy(cam.position);
          controls.update();
        }
      }
    } catch (err) {
      console.error('[RoomEditor] Failed to initialize viewer:', err);
      this.loadError = `Failed to load splat: ${err}`;
      this.cdr.detectChanges();
    }
  }

  // ─── Camera position capture ───────────────────────────────────────────────

  /**
   * Captures the current camera position and lookAt from the live viewer
   * and stores it as the default camera position for this room.
   */
  captureCurrentCameraPosition() {
    if (!this.camera) return;

    const pos = this.camera.position;

    // Compute lookAt: camera looks along its -Z axis in world space
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const lookAt = pos.clone().add(dir.multiplyScalar(5)); // 5 units ahead

    this.savedCameraPosition = {
      position: { x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), z: +pos.z.toFixed(3) },
      lookAt: { x: +lookAt.x.toFixed(3), y: +lookAt.y.toFixed(3), z: +lookAt.z.toFixed(3) },
    };

    this.cameraPositionSaved = true;
    this.cdr.detectChanges();

    // Clear the flash after 2 seconds
    setTimeout(() => {
      this.cameraPositionSaved = false;
      this.cdr.detectChanges();
    }, 2000);
  }

  // ─── Render display markers ────────────────────────────────────────────────

  private renderDisplayMarkers() {
    // Clear existing markers
    this.displayMarkers.forEach((mesh) => this.threeScene.remove(mesh));
    this.displayLabels.forEach((sprite) => this.threeScene.remove(sprite));
    this.displayMarkers.clear();
    this.displayLabels.clear();

    // Render each display
    this.displays.forEach((display) => {
      this.createDisplayMarker(display);
    });
  }

  private createDisplayMarker(display: DisplayConfig) {
    const geometry = new THREE.PlaneGeometry(
      display.widthM || 1,
      display.heightM || 1
    );
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      transparent: true,
      opacity: 0.6,
      emissive: 0x2a5a99,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      display.position3D.x,
      display.position3D.y,
      display.position3D.z
    );
    mesh.rotation.y = display.rotationY || 0;
    mesh.userData = { displayId: display.displayId };

    this.threeScene.add(mesh);
    this.displayMarkers.set(display.displayId, mesh);

    // Add label
    const label = this.makeTextSprite(display.label || 'Display');
    label.position.set(
      display.position3D.x,
      display.position3D.y + (display.heightM || 1) / 2 + 0.3,
      display.position3D.z
    );
    this.threeScene.add(label);
    this.displayLabels.set(display.displayId, label);
  }

  private makeTextSprite(text: string): THREE.Sprite {
    const canvas = this.renderTextCanvas(text);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2, 1, 1);
    return sprite;
  }

  private renderTextCanvas(text: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'Bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    return canvas;
  }

  // ─── Click handler for placement ───────────────────────────────────────────

  private setupClickHandler() {
    if (!this.containerRef?.nativeElement) return;
    const canvas = this.containerRef.nativeElement.querySelector('canvas');
    if (!canvas) return;

    canvas.addEventListener('click', (event) => {
      if (!this.clickToPlaceMode) return;

      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Find intersection with floor plane
      const point = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.floorPlane, point);

      // Create new display at this position
      this.createNewDisplay(point);
    });
  }

  private createNewDisplay(position: THREE.Vector3) {
    const newDisplay: DisplayConfig = {
      displayId: `display-${Date.now()}`,
      label: `Display ${this.displays.length + 1}`,
      position3D: { x: position.x, y: position.y, z: position.z },
      widthM: 0.33,
      heightM: 0.25,
      rotationY: 0,
    };

    this.displays.push(newDisplay);
    this.createDisplayMarker(newDisplay);
    this.selectedDisplayId = newDisplay.displayId;
    this.clickToPlaceMode = false;
  }

  // ─── Edit display ─────────────────────────────────────────────────────────

  toggleClickToPlace() {
    this.clickToPlaceMode = !this.clickToPlaceMode;
  }

  getSelectedDisplay(): DisplayConfig | undefined {
    return this.displays.find((d) => d.displayId === this.selectedDisplayId);
  }

  updateSelectedDisplay(field: keyof DisplayConfig, value: any) {
    const display = this.getSelectedDisplay();
    if (!display) return;

    (display as any)[field] = value;

    // Update marker if it's a visual property
    if (field === 'label') {
      const label = this.displayLabels.get(display.displayId);
      if (label) {
        this.threeScene.remove(label);
        const newLabel = this.makeTextSprite(value);
        newLabel.position.set(
          display.position3D.x,
          display.position3D.y + (display.heightM || 1) / 2 + 0.3,
          display.position3D.z
        );
        this.threeScene.add(newLabel);
        this.displayLabels.set(display.displayId, newLabel);
      }
    } else if (field === 'position3D') {
      // value is the whole position3D object — update mesh and label positions
      const mesh = this.displayMarkers.get(display.displayId);
      if (mesh) {
        mesh.position.set(display.position3D.x, display.position3D.y, display.position3D.z);
      }
      const label = this.displayLabels.get(display.displayId);
      if (label) {
        label.position.set(
          display.position3D.x,
          display.position3D.y + (display.heightM || 0.25) / 2 + 0.1,
          display.position3D.z
        );
      }
    } else if (
      field === 'widthM' ||
      field === 'heightM' ||
      field === 'rotationY'
    ) {
      const mesh = this.displayMarkers.get(display.displayId);
      if (mesh) {
        if (field === 'widthM' || field === 'heightM') {
          const geom = new THREE.PlaneGeometry(
            display.widthM || 0.33,
            display.heightM || 0.25
          );
          (mesh.geometry as THREE.PlaneGeometry).dispose();
          mesh.geometry = geom;
        }
        if (field === 'rotationY') {
          mesh.rotation.y = value;
        }
      }
    }
  }

  deleteDisplay(displayId: string) {
    const mesh = this.displayMarkers.get(displayId);
    if (mesh) this.threeScene.remove(mesh);
    const label = this.displayLabels.get(displayId);
    if (label) this.threeScene.remove(label);

    this.displayMarkers.delete(displayId);
    this.displayLabels.delete(displayId);
    this.displays = this.displays.filter((d) => d.displayId !== displayId);

    if (this.selectedDisplayId === displayId) {
      this.selectedDisplayId = this.displays[0]?.displayId || null;
    }
  }

  // ─── Save ─────────────────────────────────────────────────────────────────

  async saveRoomConfig() {
    if (!this.roomConfig) return;

    this.saving = true;
    this.saveError = null;

    try {
      const updated: RoomConfig = {
        ...this.roomConfig,
        displays: this.displays,
        cameraPosition: this.savedCameraPosition ?? undefined,
      };

      await this.http
        .put(`/api/rooms/${this.roomName}`, updated)
        .toPromise();

      this.roomConfig = updated;
      alert('Room configuration saved successfully!');
    } catch (err) {
      console.error('[RoomEditor] Failed to save:', err);
      this.saveError = `Failed to save: ${err}`;
    } finally {
      this.saving = false;
    }
  }

  goBack() {
    this.router.navigate(['/admin']);
  }
}
