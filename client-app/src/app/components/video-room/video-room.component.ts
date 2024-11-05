import { Component, ElementRef, Inject, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { MediasoupService } from '../../services/mediasoup.service';
import * as mediasoupClient from 'mediasoup-client';
import { Router } from '@angular/router';
import { io } from 'socket.io-client';
import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [],
  templateUrl: './video-room.component.html',
  styleUrl: './video-room.component.scss'
})

export class VideoRoomComponent implements OnInit {

  private socket: any;
  private device!: mediasoupClient.Device;
  private rtpCapabilities: any;
  private producerTransport: any;
  private producer: any;
  private consumerTransports: any[] = [];
  private roomName: string;
  public isBrowser: boolean;

  @ViewChild("localVideo") localVideo!: ElementRef;

  constructor(private mediasoupService: MediasoupService,private router: Router,@Inject(PLATFORM_ID) private platformId: Object) {
    this.roomName = this.router.url.split('/')[2];
    console.log('This roomname:', this.roomName);
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    this.socket = io('/mediasoup'); // Assumes SFU server is at the same domain/port


    this.socket.on('connection-success', ({ socketId }: any) => {
      console.log(`Connected with socket ID: ${socketId}`);
      mediasoupService.getLocalStream();
    });

    // Handle new producers joining
    this.socket.on('new-producer', ({ producerId }: any) => {
      console.log('New producer joined', producerId);
      mediasoupService.signalNewConsumerTransport(producerId);
    });

    // Handle when a producer is closed
    this.socket.on('producer-closed', ({ remoteProducerId }: any) => {
      console.log(`Producer closed: ${remoteProducerId}`);
      mediasoupService.closeConsumerTransport(remoteProducerId);
    });

   }

  ngOnInit(): void {
    if (this.mediasoupService.isBrowser) {
      // Only execute navigator-related code in the browser
      this.mediasoupService.getLocalStream();
    }
  }

}
