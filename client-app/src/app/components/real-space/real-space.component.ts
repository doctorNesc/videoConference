import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';


@Component({
  selector: 'app-real-space',
  standalone: true,
  imports: [],
  templateUrl: './real-space.component.html',
  styleUrl: './real-space.component.scss'
})
export class RealSpaceComponent implements AfterViewInit {
  @ViewChild('threeCanvas', { static: true }) canvasRef!: ElementRef;
  @ViewChild('videoElement', { static: true }) videoRef!: ElementRef;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private videoTexture!: THREE.VideoTexture;
  private splatPoints!: THREE.Points;

  ngAfterViewInit(): void {
    this.initThreeJS();
    this.setupVideoStream();
    this.loadSplatFile("assets/B405.splat"); // Load the .splat file
    this.animate();
  }

  private initThreeJS(): void {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvasRef.nativeElement, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);
    
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.camera.position.set(0, 2, 5);
    this.controls.update();
    
    const light = new THREE.AmbientLight(0xffffff);
    this.scene.add(light);
  }

  private setupVideoStream(): void {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((stream) => {
      const video = this.videoRef.nativeElement as HTMLVideoElement;
      video.srcObject = stream;
      this.videoTexture = new THREE.VideoTexture(video);
      
      const videoMaterial = new THREE.MeshBasicMaterial({ map: this.videoTexture });
      const videoPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), videoMaterial);
      videoPlane.position.set(0, 1, -2);
      this.scene.add(videoPlane);
    }).catch(console.error);
  }

  private async loadSplatFile(path: string): Promise<void> {
    try {
      const response = await fetch(path);
      const buffer = (await response.arrayBuffer()).slice(3);
      // console.log('splat buffer:', buffer);
      const data = new Float32Array(buffer);
      
      const numSplats = data.length / 7; // Assuming each splat has (x, y, z, r, g, b, size)
      const positions = new Float32Array(numSplats * 3);
      const colors = new Float32Array(numSplats * 3);
      const sizes = new Float32Array(numSplats);

      for (let i = 0; i < numSplats; i++) {
        positions.set(data.slice(i * 7, i * 7 + 3), i * 3);
        colors.set(data.slice(i * 7 + 3, i * 7 + 6), i * 3);
        sizes[i] = data[i * 7 + 6];
      }

      this.createSplatRenderer(positions, colors, sizes);
    } catch (error) {
      console.error("Failed to load splat file:", error);
    }
  }

  private createSplatRenderer(positions: Float32Array, colors: Float32Array, sizes: Float32Array): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { pointSize: { value: 5.0 } },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          gl_PointSize = size;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
      vertexColors: true,
      transparent: true,
    });

    this.splatPoints = new THREE.Points(geometry, material);
    this.scene.add(this.splatPoints);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}