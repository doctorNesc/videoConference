import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CameraSelectService } from '../../directives/camera-select.service';

const screenWidth = window.screen.width;

let k = screenWidth / 1920;

@Component({
  selector: 'app-classroom',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './classroom.component.html',
  styleUrl: './classroom.component.scss'
})

export class ClassroomComponent implements OnInit {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  cameras: MediaDeviceInfo[] = [];
  selectedCameraId: string | null = null;

  constructor(private cameraService: CameraSelectService) { }

  async ngOnInit() {

    this.cameras = await this.cameraService.getAvailableCameras();
    if (this.cameras.length > 0) {
      this.selectedCameraId = this.cameras[0].deviceId;
      this.startCamera();
    }
  }

  async startCamera() {
    if (!this.selectedCameraId) return;

    const stream = await this.cameraService.getCameraStream(this.selectedCameraId);
    this.videoElement.nativeElement.srcObject = stream;
  }

  async onCameraChange(event: Event) {
    this.selectedCameraId = (event.target as HTMLSelectElement).value;
    await this.startCamera();
  }
}

