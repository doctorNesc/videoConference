import { Injectable } from '@angular/core';
import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

@Injectable({
  providedIn: 'root'
})
export class MediasoupService {
  private socket: any;
  private device: any;
  private rtpCapabilities: any;
  private producerTransport: any;
  private consumerTransports: any[] = [];
  private producer: any;
  private roomName: string = '';

  constructor() {
    console.log('Mediasoup service instantiated');
    this.roomName = window.location.pathname.split('/')[2];
    this.socket = io('/mediasoup');

    this.socket.on('connection-success', ({ socketId }: any) => {
      console.log(socketId);
      this.getLocalStream();
    });
  }

  getLocalStream() {
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { min: 640, max: 1920 },
        height: { min: 400, max: 1080 },
      }
    }).then(this.streamSuccess.bind(this))
      .catch((error) => {
        console.log(error.message);
      });
  }

  streamSuccess(stream: MediaStream) {
    const track = stream.getVideoTracks()[0];
    let params = {
      track,
      encodings: [
        { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
        { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
        { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
      ],
      codecOptions: {
        videoGoogleStartBitrate: 1000
      }
    };

    this.joinRoom(params);
  }

  joinRoom(params: any) {
    this.socket.emit('joinRoom', { roomName: this.roomName }, (data: any) => {
      this.rtpCapabilities = data.rtpCapabilities;
      this.createDevice(params);
    });
  }

  async createDevice(params: any) {
    try {
      this.device = new mediasoupClient.Device();
      await this.device.load({
        routerRtpCapabilities: this.rtpCapabilities
      });
      console.log('Device RTP Capabilities', this.device.rtpCapabilities);
      this.createSendTransport(params);
    } catch (error: any) {
      console.error(error);
      if (error.name === 'UnsupportedError') {
        console.warn('browser not supported');
      }
    }
  }

  createSendTransport(params: any) {
    this.socket.emit('createWebRtcTransport', { consumer: false }, ({ params }: any) => {
      if (params.error) {
        console.log(params.error);
        return;
      }

      this.producerTransport = this.device.createSendTransport(params);

      this.producerTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
        try {
          await this.socket.emit('transport-connect', { dtlsParameters });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      this.producerTransport.on('produce', async (parameters: any, callback: any, errback: any) => {
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

      this.connectSendTransport(params);
    });
  }

  async connectSendTransport(params: any) {
    this.producer = await this.producerTransport.produce(params);
    this.producer.on('trackended', () => {
      console.log('track ended');
    });

    this.producer.on('transportclose', () => {
      console.log('transport ended');
    });
  }

  getProducers() {
    this.socket.emit('getProducers', (producerIds: any) => {
      producerIds.forEach((id: any) => this.signalNewConsumerTransport(id));
    });
  }

  signalNewConsumerTransport(remoteProducerId: any) {
    this.socket.emit('createWebRtcTransport', { consumer: true }, async ({ params }: any) => {
      if (params.error) {
        console.log(params.error);
        return;
      }

      let consumerTransport;
      try {
        consumerTransport = this.device.createRecvTransport(params);
      } catch (error) {
        console.log(error);
        return;
      }

      consumerTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
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

  async connectRecvTransport(consumerTransport: any, remoteProducerId: any, serverConsumerTransportId: any) {
    this.socket.emit('consume', {
      rtpCapabilities: this.device.rtpCapabilities,
      remoteProducerId,
      serverConsumerTransportId,
    }, async ({ params }: any) => {
      if (params.error) {
        console.log('Cannot Consume');
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

      // Play the remote stream
      const videoElement = document.getElementById(remoteProducerId) as HTMLVideoElement;
      videoElement.srcObject = new MediaStream([consumer.track]);

      this.socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId });
    });
  }
}
