import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Participant } from '../utils/types';
import { SlotState } from './room-device.service';

/** Serialisable participant — no MediaStream (cannot be cloned via BroadcastChannel) */
export interface ParticipantRef {
  id: string;
  name: string;
  socketId?: string;
}

/**
 * Service to share participant and slot data across browser windows using BroadcastChannel.
 * Allows slot-view windows (opened via window.open) to receive real-time updates from the main window.
 *
 * NOTE: MediaStream objects cannot be transferred via BroadcastChannel (DataCloneError).
 * The slot-view window retrieves actual streams from window.opener.participantStreams map.
 */
@Injectable({ providedIn: 'root' })
export class BroadcastChannelService {
  private channel: BroadcastChannel | null = null;
  private participantRefs$ = new BehaviorSubject<ParticipantRef[]>([]);
  private slots$ = new BehaviorSubject<SlotState[]>([]);

  get participantRefs(): Observable<ParticipantRef[]> {
    return this.participantRefs$.asObservable();
  }

  /** @deprecated Use participantRefs — streams cannot be cloned across windows */
  get participants(): Observable<Participant[]> {
    
    return new BehaviorSubject<Participant[]>([]).asObservable();
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
        if (type === 'participant-refs-update') {
          this.participantRefs$.next(data);
        } else if (type === 'slots-update') {
          this.slots$.next(data);
        }
      };
    } catch (err) {
      console.warn('[BroadcastChannelService] BroadcastChannel not supported:', err);
    }
  }

  /**
   * Broadcast serialisable participant refs (no MediaStream) to all windows.
   * Slot-view windows use window.opener to get the actual MediaStream.
   */
  broadcastParticipants(participants: Participant[]) {
    const refs: ParticipantRef[] = participants.map(p => ({
      id: p.id,
      name: p.name,
      socketId: p.socketId,
    }));
    if (this.channel) {
      try {
        this.channel.postMessage({ type: 'participant-refs-update', data: refs });
      } catch (err) {
        console.warn('[BroadcastChannelService] postMessage failed:', err);
      }
    }
    this.participantRefs$.next(refs);
  }

  /**
   * Broadcast slot updates to all windows (called by main window).
   * SlotState contains only serialisable data (no MediaStream).
   */
  broadcastSlots(slots: SlotState[]) {
    if (this.channel) {
      try {
        this.channel.postMessage({ type: 'slots-update', data: slots });
      } catch (err) {
        console.warn('[BroadcastChannelService] postMessage slots failed:', err);
      }
    }
    this.slots$.next(slots);
  }

  ngOnDestroy() {
    if (this.channel) {
      this.channel.close();
    }
  }
}
