import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { combineLatest, Subscription, switchMap, of } from 'rxjs';

import { RoomDeviceService, SlotState } from '../../services/room-device.service';
import { ParticipantService } from '../../services/participant.service';
import { BroadcastChannelService } from '../../services/broadcast-channel.service';
import { Participant } from '../../utils/types';

export interface SlotRemote {
  socketId: string;
  name: string;
  stream: MediaStream;
}

/**
 * Room-device slot view — opened in a dedicated browser window per physical screen.
 *
 * URL: /slot-view?slotId=<id>&roomName=<name>
 *
 * Displays the video stream(s) of remote participant(s) assigned to this slot,
 * full-screen. When multiple remotes share a slot (overflow), they appear in a grid.
 */
@Component({
  selector: 'app-room-device-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './room-device-view.component.html',
  styleUrl: './room-device-view.component.scss',
})
export class RoomDeviceViewComponent implements OnInit, OnDestroy {
  slotId: string = '';
  roomName: string = '';

  /** Current slot state */
  slot: SlotState | null = null;

  /** Resolved remote streams for this slot */
  remotes: SlotRemote[] = [];

  private subs = new Subscription();

  constructor(
    private route: ActivatedRoute,
    private roomDeviceService: RoomDeviceService,
    private participantService: ParticipantService,
    private broadcastChannel: BroadcastChannelService,
  ) {}

  ngOnInit() {
    this.slotId = this.route.snapshot.queryParamMap.get('slotId') ?? '';
    this.roomName = this.route.snapshot.queryParamMap.get('roomName') ?? '';

    if (!this.slotId || !this.roomName) {
      console.error('[RoomDeviceView] Missing slotId or roomName in query params');
      return;
    }

    // Use BroadcastChannel to receive data from main window
    // Falls back to local services if BroadcastChannel is not available
    const slotsSource = this.broadcastChannel.slots.pipe(
      // Fallback to local service if broadcast is empty
      switchMap(slots => slots.length > 0 ? of(slots) : this.roomDeviceService.slots)
    );
    const participantsSource = this.broadcastChannel.participants.pipe(
      switchMap(participants => participants.length > 0 ? of(participants) : this.participantService.participants)
    );

    // Reactively combine slot state + participant list
    this.subs.add(
      combineLatest([
        slotsSource,
        participantsSource,
      ]).subscribe(([slots, participants]) => {
        this.slot = slots.find(s => s.slotId === this.slotId) ?? null;
        this.remotes = this.resolveRemotes(this.slot, participants);
      })
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }

  /** Returns a CSS grid-template-columns value based on participant count */
  get gridColumns(): string {
    const count = this.remotes.length;
    if (count <= 1) return '1fr';
    if (count <= 4) return 'repeat(2, 1fr)';
    return 'repeat(3, 1fr)';
  }

  /** Attaches a MediaStream to a <video> element */
  attachStream(video: HTMLVideoElement, stream: MediaStream) {
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private resolveRemotes(slot: SlotState | null, participants: Participant[]): SlotRemote[] {
    if (!slot) return [];
    const result: SlotRemote[] = [];
    for (const remote of slot.assignedRemotes) {
      // Participants are keyed by producerId (id), but also carry socketId
      const match = participants.find(p => p.socketId === remote.socketId);
      if (match) {
        result.push({ socketId: remote.socketId, name: match.name, stream: match.stream });
      }
    }
    return result;
  }
}
