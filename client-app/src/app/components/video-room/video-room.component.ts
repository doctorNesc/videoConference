import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { CommonModule } from '@angular/common';
import { ParticipantComponent } from '../participant/participant.component';

@Component({
  selector: 'app-video-room',
  standalone: true,
  imports: [CommonModule,ParticipantComponent],
  templateUrl: './video-room.component.html',
  styleUrls: ['./video-room.component.scss']
})
export class VideoRoomComponent implements OnInit {
  public participants: { id: string, stream: MediaStream }[] = [];
  // public localVideo: { id: string, stream: MediaStream }[] = [];

  private socket: any;
  private device: any;
  private producerTransport: any;
  private consumerTransports: any[] = [];
  private producer: any;
  private roomName: string;
  private rtpCapabilities: any;
  public isProducer: boolean = false;
  public localVideo: any;
  public params: any = {
    encodings: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 },
  };

  constructor(private route: ActivatedRoute) {
    this.roomName = this.route.snapshot.paramMap.get('roomName') || '';
  }

  ngOnInit(): void {
    this.initializeSocket();
    // this.getLocalStream();
  }

  initializeSocket() {
    this.socket = io('/mediasoup');

    this.socket.on('connection-success', ({ socketId }: any) => {
      console.log('Connected with socket ID:', socketId);
      this.getLocalStream();
    });

    this.socket.on('new-producer', ({ producerId }: any) => {
      this.signalNewConsumerTransport(producerId);
    });

    this.socket.on('producer-closed', ({ remoteProducerId }: any) => {
      this.handleProducerClosed(remoteProducerId);
    });
  }

  async getLocalStream() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { min: 640, max: 1920 },
          height: { min: 400, max: 1080 }
        }
      });

      this.localVideo = document.querySelector('#localVideo');
      if (this.localVideo) {
        this.localVideo.srcObject = stream;
      }
      const track = stream.getVideoTracks()[0];
      this.params = { track, ...this.params }

      this.joinRoom();
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  }

  joinRoom() {
    this.socket.emit('joinRoom', { roomName: this.roomName }, (data: any) => {
      console.log('Router RTP Capabilities:', data.rtpCapabilities);
      this.rtpCapabilities = data.rtpCapabilities;
      this.createDevice();
    });
  }

  async createDevice() {
    try {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
      console.log('Device RTP Capabilities:', this.device.rtpCapabilities);
      this.createSendTransport();
    } catch (error: any) {
      console.error('Error creating device:', error);
      if (error.name === 'UnsupportedError') {
        console.warn('Browser not supported');
      }
    }
  }

  createSendTransport() {
    this.socket.emit('createWebRtcTransport', { consumer: false }, ({ params }: any) => {
      if (params.error) {
        console.error(params.error);
        return;
      }

      console.log('Create WebRTC Transport params:', params);

      this.producerTransport = this.device.createSendTransport(params);

      this.producerTransport.on('connect', async ({ dtlsParameters }: any, callback: Function, errback: Function) => {
        try {
          await this.socket.emit('transport-connect', { dtlsParameters });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      this.producerTransport.on('produce', async (parameters: any, callback: Function, errback: Function) => {
        try {
          await this.socket.emit('transport-produce', {
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
            appData: parameters.appData,
          }, ({ id, producersExist }: any) => {
            callback({ id });
            if (producersExist) this.getProducers();
          });
        } catch (error) {
          errback(error);
        }
      });

      this.connectSendTransport();
    });
  }

  async connectSendTransport() {
    try {
      this.producer = await this.producerTransport.produce(this.params);
      this.producer.on('trackended', () => console.log('Track ended'));
      this.producer.on('transportclose', () => console.log('Transport closed'));
    } catch (error) {
      console.error('Error connecting send transport:', error);
    }
  }

  async signalNewConsumerTransport(remoteProducerId: string) {
    await this.socket.emit('createWebRtcTransport', { consumer: true }, ({ params }: any) => {
      if (params.error) {
        console.error(params.error);
        return;
      }

      let consumerTransport;
      try {
        consumerTransport = this.device.createRecvTransport(params);
      } catch (error) {
        console.error('Error creating receive transport:', error);
        return;
      }

      consumerTransport.on('connect', async ({ dtlsParameters }: any, callback: Function, errback: Function) => {
        try {
          await this.socket.emit('transport-recv-connect', {
            dtlsParameters,
            serverConsumerTransportId: params.id,
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      this.connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    });
  }

  async connectRecvTransport(consumerTransport: any, remoteProducerId: string, serverConsumerTransportId: string) {
    await this.socket.emit('consume', {
      rtpCapabilities: this.device.rtpCapabilities,
      remoteProducerId,
      serverConsumerTransportId,
    }, async ({ params }: any) => {
      if (params.error) {
        console.error('Cannot consume:', params.error);
        return;
      }

      const consumer = await consumerTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });

      this.consumerTransports.push({
        consumerTransport,
        serverConsumerTransportId: params.id,
        producerId: remoteProducerId,
        consumer,
      });

      // const newElem = document.createElement('div');
      // newElem.setAttribute('id', `td-${remoteProducerId}`);
      // newElem.setAttribute('class', 'remoteVideo');
      // newElem.innerHTML = `<video id="${remoteProducerId}" autoplay class="video"></video>`;
      // document.querySelector('#remote-video-container')?.appendChild(newElem);

      const { track } = consumer;
      this.addParticipant(remoteProducerId, new MediaStream([track]));

      this.socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId });
    });
  }

  handleProducerClosed(remoteProducerId: string) {
    const producerToClose = this.consumerTransports.find(transportData => transportData.producerId === remoteProducerId);
    if (producerToClose) {
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();
      this.consumerTransports = this.consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId);
      this.participants = this.participants.filter(particicipant => particicipant.id != remoteProducerId);
    }
  }

  getProducers() {
    this.socket.emit('getProducers', (producerIds: string[]) => {
      producerIds.forEach((id: string) => this.signalNewConsumerTransport(id));
    });
  }

  addParticipant(remoteProducerId: string, stream: MediaStream) {
    this.participants.push({ id: remoteProducerId, stream });
    // setTimeout(() => {
    //   const videoElement = document.getElementById(remoteProducerId) as HTMLVideoElement;
    //   if (videoElement) {
    //     videoElement.srcObject = stream;
    //   }
    // }, 0);
  }

}
