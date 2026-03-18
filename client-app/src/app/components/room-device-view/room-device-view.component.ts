import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { combineLatest, Subscription } from 'rxjs';

import { RoomDeviceService, SlotState } from '../../services/room-device.service';
import { ParticipantService } from '../../services/participant.service';
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
  ) {}

  ngOnInit() {
    this.slotId = this.route.snapshot.queryParamMap.get('slotId') ?? '';
    this.roomName = this.route.snapshot.queryParamMap.get('roomName') ?? '';

    // Reactively combine slot state + participant list
    this.subs.add(
      combineLatest([
        this.roomDeviceService.slots,
        this.participantService.participants,
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
