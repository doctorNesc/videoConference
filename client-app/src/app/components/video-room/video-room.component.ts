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

  detachParticipant(participant: { id: string; stream: MediaStream }){
    console.log('id: ',participant.id)
  }
}
