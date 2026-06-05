import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription, interval } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';
import * as THREE from 'three';
import { Viewer, SceneRevealMode } from '@mkkellogg/gaussian-splats-3d';

import { RoomTopologyDTO, ScreenSlotDTO } from '../../utils/hybrid-types';
import { VideoRoomService } from '../../services/video-room.service';

/** Colour used for screen-slot markers in the 3D overlay */
const SLOT_COLOUR_EMPTY = 0x4a90d9;
const SLOT_COLOUR_OCCUPIED = 0x3fb950;

@Component({
  selector: 'app-real-space',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './real-space.component.html',
  styleUrl: './real-space.component.scss',
})
export class RealSpaceComponent implements AfterViewInit, OnDestroy {
  @ViewChild('splatContainer', { static: true })
  containerRef!: ElementRef<HTMLDivElement>;

  /** Currently selected room for topology overlay */
  selectedRoom: string = '';
  topology: RoomTopologyDTO | null = null;
  allTopologies: RoomTopologyDTO[] = [];

  /** Loading / error state */
  loading = true;
  loadError: string | null = null;

  
  private threeScene!: THREE.Scene;
  private slotMarkers: Map<string, THREE.Mesh> = new Map();
  private slotLabels: Map<string, THREE.Sprite> = new Map();

  
  private viewer: Viewer | null = null;

  private subs = new Subscription();

  constructor(
    private http: HttpClient,
    private videoRoomService: VideoRoomService,
  ) {}

  async ngAfterViewInit() {
    await this.initViewer();
    this.startTopologyPolling();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    try { this.viewer?.dispose(); } catch { /* ignore */ }
  }

  
  private async initViewer() {
    try {
      
      this.threeScene = new THREE.Scene();

      
      this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 5);
      this.threeScene.add(dir);

      
      const roomConfig = this.videoRoomService['roomConfig$']?.value;
      const camPos = roomConfig?.cameraPosition?.position;
      const camLookAt = roomConfig?.cameraPosition?.lookAt;

      this.viewer = new Viewer({
        rootElement: this.containerRef.nativeElement,
        useBuiltInControls: true,          
        selfDrivenMode: true,              
        threeScene: this.threeScene,       
        cameraUp: [0, 1, 0],
        ...(camPos ? { initialCameraPosition: [camPos.x, camPos.y, camPos.z] as [number, number, number] } : {}),
        ...(camLookAt ? { initialCameraLookAt: [camLookAt.x, camLookAt.y, camLookAt.z] as [number, number, number] } : {}),
        sceneRevealMode: SceneRevealMode.Gradual,
      });

      await this.viewer.addSplatScene('assets/B405.splat', {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: false,
      });

      this.viewer.start();
      this.loading = false;
    } catch (err) {
      console.error('[RealSpace] Failed to initialise splat viewer:', err);
      this.loadError = String(err);
      this.loading = false;
    }
  }

  
  private startTopologyPolling() {
    this.subs.add(
      interval(5000).pipe(
        startWith(0),
        switchMap(() => this.http.get<RoomTopologyDTO[]>('/api/topology')),
      ).subscribe({
        next: (topologies) => {
          this.allTopologies = topologies;
          if (!this.selectedRoom && topologies.length > 0) {
            this.selectedRoom = topologies[0].roomName;
          }
          this.topology = topologies.find(t => t.roomName === this.selectedRoom) ?? null;
          this.updateOverlay();
        },
        error: (err) => console.warn('[RealSpace] topology poll failed:', err),
      })
    );
  }

  onRoomChange(roomName: string) {
    this.selectedRoom = roomName;
    this.topology = this.allTopologies.find(t => t.roomName === roomName) ?? null;
    this.updateOverlay();
  }

  
  /**
   * Rebuilds the Three.js overlay markers for each screen slot.
   * Slots are positioned using their screenIndex as a simple X offset
   * (until real 3D positions are set via position3D on the ScreenSlot).
   */
  private updateOverlay() {
    if (!this.threeScene) return;

    const slots = this.topology?.slots ?? [];

    
    const currentIds = new Set(slots.map(s => s.slotId));
    this.slotMarkers.forEach((mesh, id) => {
      if (!currentIds.has(id)) {
        this.threeScene.remove(mesh);
        this.slotMarkers.delete(id);
      }
    });
    this.slotLabels.forEach((sprite, id) => {
      if (!currentIds.has(id)) {
        this.threeScene.remove(sprite);
        this.slotLabels.delete(id);
      }
    });

    
    slots.forEach((slot, i) => {
      const position = slot.position3D
        ? new THREE.Vector3(slot.position3D.x, slot.position3D.y, slot.position3D.z)
        : new THREE.Vector3((i - (slots.length - 1) / 2) * 1.5, 1.2, 0);

      const occupied = slot.assignedRemoteIds.length > 0;
      const colour = occupied ? SLOT_COLOUR_OCCUPIED : SLOT_COLOUR_EMPTY;

      
      let mesh = this.slotMarkers.get(slot.slotId);
      if (!mesh) {
        const geo = new THREE.SphereGeometry(0.12, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.4 });
        mesh = new THREE.Mesh(geo, mat);
        this.threeScene.add(mesh);
        this.slotMarkers.set(slot.slotId, mesh);
      } else {
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(colour);
        (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(colour);
      }
      mesh.position.copy(position);

      
      let sprite = this.slotLabels.get(slot.slotId);
      if (!sprite) {
        sprite = this.makeTextSprite(this.slotLabel(slot));
        this.threeScene.add(sprite);
        this.slotLabels.set(slot.slotId, sprite);
      } else {
        this.updateSpriteTexture(sprite, this.slotLabel(slot));
      }
      sprite.position.set(position.x, position.y + 0.25, position.z);
    });
  }

  private slotLabel(slot: ScreenSlotDTO): string {
    const remotes = slot.assignedRemoteIds.length;
    const cam = slot.cameraLabel ? `📷 ${slot.cameraLabel}` : 'No camera';
    const who = remotes === 0 ? 'Empty' : `${remotes} remote(s)`;
    return `${slot.screenLabel}\n${cam}\n${who}`;
  }

  
  private makeTextSprite(text: string): THREE.Sprite {
    const canvas = this.renderTextCanvas(text);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2, 0.6, 1);
    return sprite;
  }

  private updateSpriteTexture(sprite: THREE.Sprite, text: string) {
    const canvas = this.renderTextCanvas(text);
    const mat = sprite.material as THREE.SpriteMaterial;
    if (mat.map) mat.map.dispose();
    mat.map = new THREE.CanvasTexture(canvas);
    mat.needsUpdate = true;
  }

  private renderTextCanvas(text: string): HTMLCanvasElement {
    const lines = text.split('\n');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 10);
    ctx.fill();
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    lines.forEach((line, i) => {
      ctx.font = i === 0 ? 'bold 18px sans-serif' : '14px sans-serif';
      ctx.fillText(line, canvas.width / 2, 28 + i * 22);
    });
    return canvas;
  }
}
