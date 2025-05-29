import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { CommonModule } from '@angular/common';
import { ParticipantComponent } from '../participant/participant.component';
import { VideoOptionsComponent } from '../video-options/video-options.component';
import { ResizableDirective } from '../../directives/app-resizable.directive';
import { ChatMessage, VideoRoomService} from '../../services/video-room.service';
import { SideBarComponent } from '../side-bar/side-bar.component';
import {
  FormControl,FormGroup,FormsModule,ReactiveFormsModule,Validators,
} from '@angular/forms';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [
    CommonModule,
    ParticipantComponent,
    VideoOptionsComponent,
    ResizableDirective,
    SideBarComponent,
    ReactiveFormsModule,
  ],
  templateUrl: './video-room.component.html',
  styleUrls: ['./video-room.component.scss'],
})
export class VideoRoomComponent implements OnInit, OnDestroy {
  public participants: { id: string; stream: MediaStream }[] = [];
  public mainParticipant!: { id: string; stream: MediaStream };
  public mainView: boolean = false;
  // public localVideo: any;
  public roomName!: string;
  public messages: ChatMessage[] = [];
  public newMessage: string = '';
  public isSidebarCollapsed = true;
  public messageForm = new FormGroup({
    message: new FormControl('', Validators.min(1)),
  });
  constructor(
    private route: ActivatedRoute,
    protected videoService: VideoRoomService
  ) {}

  ngOnInit(): void {
    this.roomName = this.route.snapshot.paramMap.get('roomName') || '';
    this.videoService.initializeSocket(this.roomName);

    this.videoService.getParticipants().subscribe((participants) => {
      this.participants = participants;
    });

    this.videoService.getMessages().subscribe((messages) => {
      this.messages = messages;
    });
  }

  ngOnDestroy(): void {
    this.videoService.disconnectAndCleanUp();
  }

  setMainParticipant(participant: { id: string; stream: MediaStream }) {
    this.mainParticipant = participant;
    this.mainView = true;
  }
  removeMainParticipant() {
    if (this.participants.length < 12) {
      this.mainView = false;
    }
  }

  detachParticipant(participant: { id: string; stream: MediaStream }) {
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
        const videoElement = detachedTab.document.querySelector(
          'video'
        ) as HTMLVideoElement;
        videoElement.srcObject = participant.stream;
        // videoElement.play();
        // videoElement.muted = false;
      }, 0);
      const interval = setInterval(() => {
        if (detachedTab.closed) {
          console.log('reattached');
          this.videoService.reattachParticipant(participant.id);
          clearInterval(interval);
        }
      }, 500);
    }
  }

  onSubmit() {
    this.messageForm.value &&
      this.videoService.sendMessage(
        this.messageForm.value.message as any,
        'Me',
        this.roomName
      );
    this.messageForm.reset();
  }

  onSidebarToggle() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  startScreenShare() {
    this.videoService.startScreenShare();
  }

  stopScreenShare() {
    this.videoService.stopScreenShare();
  }
}
