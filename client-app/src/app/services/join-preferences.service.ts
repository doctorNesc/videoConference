import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface JoinPreferences {
  /** MediaDeviceInfo.deviceId of the selected camera, or null for default */
  selectedCameraId: string | null;
  /** Human-readable label of the selected camera */
  selectedCameraLabel: string;
  /** Whether this client is joining as a physical room device */
  isRoomDevice: boolean;
  /** User's display name */
  userName: string;
}

const DEFAULT_PREFERENCES: JoinPreferences = {
  selectedCameraId: null,
  selectedCameraLabel: 'Default camera',
  isRoomDevice: false,
  userName: '',
};

@Injectable({ providedIn: 'root' })
export class JoinPreferencesService {
  private prefs$ = new BehaviorSubject<JoinPreferences>({ ...DEFAULT_PREFERENCES });

  get preferences() {
    return this.prefs$.asObservable();
  }

  get snapshot(): JoinPreferences {
    return this.prefs$.value;
  }

  setCamera(deviceId: string | null, label: string) {
    this.prefs$.next({ ...this.prefs$.value, selectedCameraId: deviceId, selectedCameraLabel: label });
  }

  setIsRoomDevice(isRoomDevice: boolean) {
    this.prefs$.next({ ...this.prefs$.value, isRoomDevice });
  }

  setUserName(userName: string) {
    this.prefs$.next({ ...this.prefs$.value, userName });
  }

  reset() {
    this.prefs$.next({ ...DEFAULT_PREFERENCES });
  }
}
