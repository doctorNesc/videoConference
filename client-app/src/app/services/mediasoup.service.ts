import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { Socket } from 'socket.io';

@Injectable({
  providedIn: 'root',
})
export class MediasoupService {
  private socket: Socket;
  private device!: mediasoupClient.Device;
  private rtpCapabilities: any;
  private producerTransport: any;
  private producer: any;
  private consumerTransports: any[] = [];
  private roomName: string;
  public isBrowser: boolean;
  private params = {
    // mediasoup params
    encodings: [
      {
        rid: 'r0',
        maxBitrate: 100000,
        scalabilityMode: 'S1T3',
      },
      {
        rid: 'r1',
        maxBitrate: 300000,
        scalabilityMode: 'S1T3',
      },
      {
        rid: 'r2',
        maxBitrate: 900000,
        scalabilityMode: 'S1T3',
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000
    }
  }

  constructor(private router: Router,@Inject(PLATFORM_ID) private platformId: Object) {
    this.roomName = this.router.url.split('/')[2];
    console.log('This roomname:', this.roomName);
    this.isBrowser = isPlatformBrowser(this.platformId);

    this.socket = io('http://localhost:3000'); // Assumes SFU server is at the same domain/port


    this.socket.on('connection-success', ({ socketId }: any) => {
      console.log(`Connected with socket ID: ${socketId}`);
      // this.getLocalStream();
    });

    // Handle new producers joining
    this.socket.on('new-producer', ({ producerId }: any) => {
      console.log('New producer joined', producerId);
      this.signalNewConsumerTransport(producerId);
    });

    // Handle when a producer is closed
    this.socket.on('producer-closed', ({ remoteProducerId }: any) => {
      console.log(`Producer closed: ${remoteProducerId}`);
      this.closeConsumerTransport(remoteProducerId);
    });
  }
  
  async getLocalStream() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { min: 640, max: 1920 }, height: { min: 400, max: 1080 } },
      });
      this.handleStream(stream);
    } catch (error) {
      console.error('Error getting local stream', error);
    }
  }

  private handleStream(stream: MediaStream) {
    const localVideo = document.getElementById('local-video') as HTMLVideoElement;
    localVideo.srcObject = stream;
    const track = stream.getVideoTracks()[0];

    this.joinRoom(track);
  }

  private joinRoom(track: MediaStreamTrack) {
    // const roomName = 'your-room-name'; // Set your desired room name
    this.socket.emit('joinRoom', { roomName: this.roomName }, async (data: any) => {
      console.log(`Router RTP Capabilities: ${data.rtpCapabilities}`);
      this.rtpCapabilities = data.rtpCapabilities;
      await this.createDevice();
      this.createSendTransport(track);
    });
  }

  private async createDevice() {
    try {
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
      console.log('Device loaded successfully');
    } catch (error) {
      console.error('Failed to create device', error);
    }
  }

  private createSendTransport(track: MediaStreamTrack) {
    this.socket.emit('createWebRtcTransport', { consumer: false }, ({ params }: any) => {
      if (params.error) {
        console.error(params.error);
        return;
      }

      this.producerTransport = this.device.createSendTransport(params);
      this.producerTransport.on('connect', async ({ dtlsParameters }: any, callback: any) => {
        try {
          await this.socket.emit('transport-connect', { dtlsParameters });
          callback();
        } catch (error) {
          console.error(error);
        }
      });

      this.producerTransport.on('produce', async (parameters: any, callback: any) => {
        try {
          await this.socket.emit(
            'transport-produce',
            { kind: parameters.kind, rtpParameters: parameters.rtpParameters },
            ({ id, producersExist }: any) => {
              callback({ id });
              if (producersExist) this.getProducers();
            }
          );
        } catch (error) {
          console.error(error);
        }
      });

      this.createProducer(track);
    });
  }

  private async createProducer(track: MediaStreamTrack) {
    try {
      this.producer = await this.producerTransport.produce({ track });
      console.log('Producer created:', this.producer);
    } catch (error) {
      console.error('Error creating producer', error);
    }
  }

  private getProducers() {
    this.socket.emit('getProducers', (producerIds: any) => {
      producerIds.forEach((id: string) => this.signalNewConsumerTransport(id));
    });
  }

  public signalNewConsumerTransport(remoteProducerId: string) {
    this.socket.emit('createWebRtcTransport', { consumer: true }, ({ params }: any) => {
      if (params.error) {
        console.error('Error creating consumer transport:', params.error);
        return;
      }

      const consumerTransport = this.device.createRecvTransport(params);
      consumerTransport.on('connect', async ({ dtlsParameters }: any, callback: any) => {
        try {
          await this.socket.emit('transport-recv-connect', {
            dtlsParameters,
            serverConsumerTransportId: params.id,
          });
          callback();
        } catch (error) {
          console.error(error);
        }
      });

      this.connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    });
  }

  private async connectRecvTransport(
    consumerTransport: any,
    remoteProducerId: string,
    serverConsumerTransportId: string
  ) {
    this.socket.emit(
      'consume',
      {
        rtpCapabilities: this.device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }: any) => {
        if (params.error) {
          console.error(params.error);
          return;
        }

        const consumer = await consumerTransport.consume(params);
        const remoteVideo = document.getElementById(`remote-video-${remoteProducerId}`) as HTMLVideoElement;
        remoteVideo.srcObject = new MediaStream([consumer.track]);

        this.consumerTransports = [
          ...this.consumerTransports,
          {
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ];
      }
    );
  }

  public closeConsumerTransport(remoteProducerId: string) {
    const producerToClose = this.consumerTransports.find(
      (transportData) => transportData.producerId === remoteProducerId
    );

    if (producerToClose) {
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();
      this.consumerTransports = this.consumerTransports.filter(
        (transportData) => transportData.producerId !== remoteProducerId
      );

      const videoContainer = document.getElementById(`remote-video-container`);
      const videoElement = document.getElementById(`remote-video-${remoteProducerId}`);
      if (videoContainer && videoElement) {
        videoContainer.removeChild(videoElement);
      }
    }
  }
}
