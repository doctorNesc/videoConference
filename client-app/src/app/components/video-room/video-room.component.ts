import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { CommonModule } from '@angular/common';
import { ParticipantComponent } from '../participant/participant.component';
import { VideoOptionsComponent } from '../video-options/video-options.component';
import { ResizableDirective } from '../../directives/app-resizable.directive';
import { VideoRoomService } from '../../services/video-room.service';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [
    CommonModule,
    ParticipantComponent,
    VideoOptionsComponent,
    ResizableDirective,
  ],
  templateUrl: './video-room.component.html',
  styleUrls: ['./video-room.component.scss'],
})
export class VideoRoomComponent implements OnInit, OnDestroy {
  public participants: { id: string; stream: MediaStream }[] = [];
  public mainParticipant!: { id: string; stream: MediaStream };
  public mainView: boolean = false;
  public localVideo: any;

  constructor(
    private route: ActivatedRoute,
    protected videoService: VideoRoomService
  ) {}

  ngOnInit(): void {
    let roomName = this.route.snapshot.paramMap.get('roomName') || '';
    this.videoService.initializeSocket(roomName);

    this.videoService.getParticipants().subscribe((participants) => {
      this.participants = participants;
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
      // setTimeout(() => {
      //   const videoElement = detachedTab.document.querySelector(
      //     'video'
      //   ) as HTMLVideoElement;
      //   // videoElement.play();
      //   videoElement.muted = false;
      // }, 1000);

      detachedTab.onbeforeunload = () => {
        this.videoService.reattachParticipant(participant.id);
      };
    }
  }
}
