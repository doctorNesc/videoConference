import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class CameraSelectService {
  private stream: MediaStream | null = null;

  async getAvailableCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput');
  }

  async getCameraStream(deviceId: string): Promise<MediaStream> {
    // Stop the previous stream if exists
    this.stopStream();

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
    });
    return this.stream;
  }

  stopStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
