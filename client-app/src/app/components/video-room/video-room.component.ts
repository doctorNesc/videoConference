import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ParticipantComponent } from '../participant/participant.component';
import { VideoOptionsComponent } from '../video-options/video-options.component';
import { ResizableDirective } from '../../directives/app-resizable.directive';
import { SideBarComponent } from '../side-bar/side-bar.component';
import { RoomDeviceSetupComponent } from '../room-device-setup/room-device-setup.component';
import {
  FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators,
} from '@angular/forms';
import { ChatMessage, VideoRoomService } from '../../services/video-room.service';
import { ScreenCameraPairing } from '../../utils/hybrid-types';
import { Subscription } from 'rxjs';
import { RoomDeviceService } from '../../services/room-device.service';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [
    CommonModule,
    ParticipantComponent,
    VideoOptionsComponent,
    ResizableDirective,
    SideBarComponent,
    RoomDeviceSetupComponent,
    ReactiveFormsModule,
    FormsModule,
  ],
  templateUrl: './video-room.component.html',
  styleUrls: ['./video-room.component.scss'],
})
export class VideoRoomComponent implements OnInit, OnDestroy {
  public participants: { id: string; stream: MediaStream; name: string; isAssignedCamera?: boolean }[] = [];
  public mainParticipant!: { id: string; stream: MediaStream; name: string };
  public mainView: boolean = false;
  public roomName!: string;
  public name!: string;
  public isRoomDevice: boolean = false;
  public messages: ChatMessage[] = [];
  public newMessage: string = '';
  public isSidebarCollapsed = true;
  public messageForm = new FormGroup({
    message: new FormControl('', Validators.min(1)),
  });

  // ─── Pairing wizard state ─────────────────────────────────────────────────
  /** True while the room device setup wizard is shown */
  public showPairingWizard: boolean = false;
  /** Slot IDs returned by server after REGISTER_ROOM_DEVICE */
  public pendingSlotIds: string[] = [];

  // ─── Assignment label (remote participants) ───────────────────────────────
  public assignedScreenLabel: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    protected videoService: VideoRoomService,
    private roomDeviceService: RoomDeviceService,
  ) { }

  ngOnInit(): void {
    this.roomName = this.route.snapshot.paramMap.get('roomName') || '';
    this.name = this.route.snapshot.queryParamMap.get('userName') || 'Guest';
    this.isRoomDevice = this.route.snapshot.queryParamMap.get('inTheRoom')?.toLowerCase() === 'true' || false;

    // Override initializeSocket to intercept room device registration
    this.setupRoomDeviceRegistration();

    this.videoService.initializeSocket(this.roomName, this.name, this.isRoomDevice);

    // ─── Participants subscription ──────────────────────────────────────────
    this.subs.push(
      this.videoService.getParticipants().subscribe((participants) => {
        this.participants = participants;

        // Phase 7: For remote participants, auto-set main view to assigned camera
        if (!this.isRoomDevice && this.videoService.currentAssignment?.cameraProducerId) {
          const assignedCam = participants.find(
            p => p.id === this.videoService.currentAssignment!.cameraProducerId
          );
          if (assignedCam) {
            this.setMainParticipant(assignedCam);
          }
        }
      })
    );

    // ─── Assignment subscription ────────────────────────────────────────────
    this.subs.push(
      this.videoService.assignment.subscribe((assignment) => {
        if (assignment) {
          this.assignedScreenLabel = assignment.screenLabel;
          // Update main view when assignment changes
          if (assignment.cameraProducerId) {
            const cam = this.participants.find(p => p.id === assignment.cameraProducerId);
            if (cam) this.setMainParticipant(cam);
          }
        }
      })
    );

    // ─── Messages subscription ──────────────────────────────────────────────
    this.subs.push(
      this.videoService.getMessages().subscribe((messages) => {
        this.messages = messages;
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.videoService.disconnectAndCleanUp();
  }

  // ─── Room device setup interception ──────────────────────────────────────

  /**
   * Monkey-patches registerAsRoomDevice to show the wizard after registration.
   * The wizard emits pairingConfirmed which calls submitScreenCameraPairing.
   */
  private setupRoomDeviceRegistration() {
    if (!this.isRoomDevice) return;

    const originalRegister = this.videoService.registerAsRoomDevice.bind(this.videoService);
    this.videoService.registerAsRoomDevice = async () => {
      const slotIds = await originalRegister();
      if (slotIds.length > 0) {
        this.pendingSlotIds = slotIds;
        this.showPairingWizard = true;
      }
      return slotIds;
    };
  }

  // ─── Pairing wizard events ────────────────────────────────────────────────

  async onPairingConfirmed(pairings: ScreenCameraPairing[]) {
    this.showPairingWizard = false;
    await this.videoService.submitScreenCameraPairing(pairings);
    // Open a dedicated browser window per slot, positioned on the correct physical screen
    this.openSlotWindows();
  }

  /**
   * Opens one browser window per slot, positioned on the physical screen
   * that corresponds to that slot (using Window Management API coordinates).
   */
  private openSlotWindows() {
    for (const slot of this.roomDeviceService.slotsSnapshot) {
      const url = `/slot-view?slotId=${encodeURIComponent(slot.slotId)}&roomName=${encodeURIComponent(this.roomName)}`;
      this.roomDeviceService.openSlotWindow(slot, url);
    }
  }

  // ─── Participant view ─────────────────────────────────────────────────────

  setMainParticipant(participant: { id: string; stream: MediaStream; name: string }) {
    this.mainParticipant = participant;
    this.mainView = true;
  }

  removeMainParticipant() {
    if (this.participants.length < 12) {
      this.mainView = false;
    }
  }

  detachParticipant(participant: { id: string; stream: MediaStream; name: string }) {
    this.videoService.detachParticipant(participant.id);

    const detachedTab = window.open('', '_blank', 'width=800,height=600');
    if (detachedTab) {
      const videoHTML = `
        <html>
          <body style="margin:0;padding:0;display:flex;justify-content:center;align-items:center;background:black;">
            <video playsinline autoplay muted loop controls style="width:100%;height:100%;"></video>
          </body>
        </html>`;
      setTimeout(() => {
        detachedTab.document.write(videoHTML);
        const videoElement = detachedTab.document.querySelector('video') as HTMLVideoElement;
        videoElement.srcObject = participant.stream;
      }, 0);
      const interval = setInterval(() => {
        if (detachedTab.closed) {
          this.videoService.reattachParticipant(participant.id);
          clearInterval(interval);
        }
      }, 500);
    }
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  onSubmit() {
    this.messageForm.value &&
      this.videoService.sendMessage(
        this.messageForm.value.message as any,
        'YOU',
        this.roomName
      );
    this.messageForm.reset();
  }

  onSidebarToggle() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  // ─── Media controls ───────────────────────────────────────────────────────

  startScreenShare() {
    this.videoService.startScreenShare();
  }

  stopScreenShare() {
    this.videoService.stopScreenShare();
  }

  leaveCall() {
    this.videoService.leaveRoom();
    this.videoService.disconnectAndCleanUp();
  }
}
