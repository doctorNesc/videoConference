import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { combineLatest, Subscription, interval } from 'rxjs';
import { startWith } from 'rxjs/operators';

import { RoomDeviceService, SlotState } from '../../services/room-device.service';
import { BroadcastChannelService, ParticipantRef } from '../../services/broadcast-channel.service';

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
 *
 * Architecture note:
 *   MediaStream objects cannot be transferred via BroadcastChannel (DataCloneError).
 *   This window uses window.opener to access the parent window's Angular services
 *   and retrieve the actual MediaStream for each participant.
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
    private broadcastChannel: BroadcastChannelService,
  ) {}

  ngOnInit() {
    this.slotId = this.route.snapshot.queryParamMap.get('slotId') ?? '';
    this.roomName = this.route.snapshot.queryParamMap.get('roomName') ?? '';

    if (!this.slotId || !this.roomName) {
      console.error('[RoomDeviceView] Missing slotId or roomName in query params');
      return;
    }

    console.log('[RoomDeviceView] Initialised for slot', this.slotId);

    // Combine slot state (from BroadcastChannel) with participant refs,
    // then resolve streams from window.opener's ParticipantService.
    this.subs.add(
      combineLatest([
        this.broadcastChannel.slots,
        this.broadcastChannel.participantRefs,
        // Poll every 500ms as a fallback to catch stream availability after refs arrive
        interval(500).pipe(startWith(0)),
      ]).subscribe(([slots, refs]) => {
        const slot = slots.find(s => s.slotId === this.slotId) ?? null;
        if (slot !== this.slot) {
          this.slot = slot;
          console.log('[RoomDeviceView] Slot updated:', slot);
        }
        this.remotes = this.resolveRemotes(slot, refs);
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

  /**
   * Resolves MediaStream objects for assigned remotes.
   * Since MediaStream cannot cross BroadcastChannel, we look up streams from:
   * 1. window.opener's participantStreams map (if available)
   * 2. window.opener's Angular ParticipantService (via __ngParticipantService__)
   */
  private resolveRemotes(slot: SlotState | null, refs: ParticipantRef[]): SlotRemote[] {
    if (!slot || slot.assignedRemotes.length === 0) return [];

    const result: SlotRemote[] = [];

    for (const remote of slot.assignedRemotes) {
      // Find the participant ref for this remote
      const ref = refs.find(r => r.socketId === remote.socketId);
      const name = ref?.name ?? remote.name ?? 'Unknown';

      // Try to get the MediaStream from the opener window
      const stream = this.getStreamFromOpener(remote.socketId, ref?.id);
      if (stream) {
        result.push({ socketId: remote.socketId, name, stream });
      } else {
        console.log('[RoomDeviceView] Stream not yet available for remote', remote.socketId);
      }
    }

    return result;
  }

  /**
   * Retrieves a MediaStream from the parent (opener) window.
   * The main window exposes participant streams via window.__participantStreams__
   * which is a Map<socketId, MediaStream> populated by VideoRoomService.
   */
  private getStreamFromOpener(socketId: string, producerId?: string): MediaStream | null {
    try {
      const opener = window.opener as any;
      if (!opener) return null;

      // Primary: look up by socketId in the exposed streams map
      const streamsBySocketId: Map<string, MediaStream> = opener.__participantStreamsBySocketId__;
      if (streamsBySocketId instanceof Map) {
        const stream = streamsBySocketId.get(socketId);
        if (stream) return stream;
      }

      // Fallback: look up by producerId (the participant's id in ParticipantService)
      if (producerId) {
        const streamsByProducerId: Map<string, MediaStream> = opener.__participantStreams__;
        if (streamsByProducerId instanceof Map) {
          const stream = streamsByProducerId.get(producerId);
          if (stream) return stream;
        }
      }
    } catch (err) {
      console.warn('[RoomDeviceView] Cannot access opener:', err);
    }
    return null;
  }
}
