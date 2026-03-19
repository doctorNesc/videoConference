import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import { JoinPreferencesService } from '#app/services/join-preferences.service.js';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterModule, CommonModule, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {

  roomName: string = '';
  inTheRoom: boolean = false;
  userName: string = '';

  /** Available camera devices */
  cameras: MediaDeviceInfo[] = [];
  /** Currently selected camera deviceId (empty string = default) */
  selectedCameraId: string = '';
  /** Whether camera enumeration is supported */
  cameraEnumSupported: boolean = false;
  /** Whether we're loading the camera list */
  loadingCameras: boolean = false;

  constructor(
    private router: Router,
    private joinPrefs: JoinPreferencesService,
  ) {}

  async ngOnInit() {
    // Restore previously saved preferences
    const snap = this.joinPrefs.snapshot;
    this.inTheRoom = snap.isRoomDevice;
    this.userName = snap.userName;
    this.selectedCameraId = snap.selectedCameraId ?? '';

    // Enumerate cameras if the API is available
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      this.cameraEnumSupported = true;
      await this.loadCameras();
    }
  }

  /** Enumerate video-input devices. Requests permission first so labels are populated. */
  async loadCameras() {
    this.loadingCameras = true;
    try {
      // Request a brief stream so the browser populates device labels
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameras = devices.filter(d => d.kind === 'videoinput');
    } catch {
      // Permission denied or no camera — silently degrade
      this.cameras = [];
    } finally {
      this.loadingCameras = false;
    }
  }

  /** Called when the user picks a camera from the dropdown */
  onCameraChange() {
    const selected = this.cameras.find(c => c.deviceId === this.selectedCameraId);
    this.joinPrefs.setCamera(
      this.selectedCameraId || null,
      selected?.label || 'Default camera',
    );
  }

  /** Called when the "room device" checkbox changes */
  onRoomDeviceChange() {
    this.joinPrefs.setIsRoomDevice(this.inTheRoom);
  }

  /** Called when the user name input changes */
  onUserNameChange() {
    this.joinPrefs.setUserName(this.userName);
  }

  // Redirect to the entered room
  joinConference() {
    if (this.roomName.trim()) {
      this.joinPrefs.setUserName(this.userName);
      this.joinPrefs.setIsRoomDevice(this.inTheRoom);
      this.router.navigate([`/sfu`, this.roomName.trim()], {
        queryParams: { userName: this.userName, inTheRoom: this.inTheRoom },
      });
    } else {
      alert('Please enter a room name!');
    }
  }

  // Generate a random 8-character room name and navigate to it
  createNewConference() {
    const generatedRoomName = this.generateRoomName();
    this.joinPrefs.setUserName(this.userName);
    this.joinPrefs.setIsRoomDevice(this.inTheRoom);
    this.router.navigate([`/sfu/${generatedRoomName}`], {
      queryParams: { userName: this.userName, inTheRoom: this.inTheRoom },
    });
  }

  // Helper function to generate an 8-character random room name
  private generateRoomName(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let roomName = '';
    for (let i = 0; i < 8; i++) {
      roomName += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return roomName;
  }
}
