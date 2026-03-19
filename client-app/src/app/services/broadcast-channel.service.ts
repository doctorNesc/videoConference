import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Participant } from '../utils/types';
import { SlotState } from './room-device.service';

/**
 * Service to share participant and slot data across browser windows using BroadcastChannel.
 * Allows slot-view windows (opened via window.open) to receive real-time updates from the main window.
 */
@Injectable({ providedIn: 'root' })
export class BroadcastChannelService {
  private channel: BroadcastChannel | null = null;
  private participants$ = new BehaviorSubject<Participant[]>([]);
  private slots$ = new BehaviorSubject<SlotState[]>([]);

  get participants(): Observable<Participant[]> {
    return this.participants$.asObservable();
  }

  get slots(): Observable<SlotState[]> {
    return this.slots$.asObservable();
  }

  constructor() {
    this.initChannel();
  }

  private initChannel() {
    try {
      this.channel = new BroadcastChannel('video-conference-hybrid');
      this.channel.onmessage = (event) => {
        const { type, data } = event.data;
        if (type === 'participants-update') {
          this.participants$.next(data);
        } else if (type === 'slots-update') {
          this.slots$.next(data);
        }
      };
    } catch (err) {
      console.warn('[BroadcastChannelService] BroadcastChannel not supported:', err);
    }
  }

  /**
   * Broadcast participant updates to all windows (called by main window)
   */
  broadcastParticipants(participants: Participant[]) {
    if (this.channel) {
      this.channel.postMessage({ type: 'participants-update', data: participants });
    }
    // Also update local state
    this.participants$.next(participants);
  }

  /**
   * Broadcast slot updates to all windows (called by main window)
   */
  broadcastSlots(slots: SlotState[]) {
    if (this.channel) {
      this.channel.postMessage({ type: 'slots-update', data: slots });
    }
    // Also update local state
    this.slots$.next(slots);
  }

  ngOnDestroy() {
    if (this.channel) {
      this.channel.close();
    }
  }
}
