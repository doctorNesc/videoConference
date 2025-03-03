import { Injectable } from '@angular/core';
import * as mediasoupClient from 'mediasoup-client';
import { io } from 'socket.io-client';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class VideoRoomService {
  private participant$ = new BehaviorSubject<
    { id: string; stream: MediaStream }[]
  >([]);
  private detachedParticipant$ = new BehaviorSubject<
    { id: string; stream: MediaStream }[]
  >([]);

  public mainParticipant = new BehaviorSubject<{
    id: string;
    stream: MediaStream;
  }>({} as { id: string; stream: MediaStream });
  public mainView: boolean = false;
  private socket: any;
  private device: any;
  private producerTransport: any;
  private consumerTransports: any[] = [];
  protected producer: any;
  private roomName!: string;
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

  constructor() {}

  initializeSocket(roomName: string) {
    this.roomName = roomName;
    this.socket = io('http://localhost:3000/mediasoup');

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
          height: { min: 400, max: 1080 },
        },
      });

      this.localVideo = document.querySelector('#localVideo');
      if (this.localVideo) {
        this.localVideo.srcObject = stream;
      }
      const track = stream.getVideoTracks()[0];
      this.params = { track, ...this.params };

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
    this.socket.emit(
      'createWebRtcTransport',
      { consumer: false },
      ({ params }: any) => {
        if (params.error) {
          console.error(params.error);
          return;
        }

        console.log('Create WebRTC Transport params:', params);

        this.producerTransport = this.device.createSendTransport(params);

        this.producerTransport.on(
          'connect',
          async (
            { dtlsParameters }: any,
            callback: Function,
            errback: Function
          ) => {
            try {
              await this.socket.emit('transport-connect', { dtlsParameters });
              callback();
            } catch (error) {
              errback(error);
            }
          }
        );

        this.producerTransport.on(
          'produce',
          async (parameters: any, callback: Function, errback: Function) => {
            try {
              await this.socket.emit(
                'transport-produce',
                {
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                },
                ({ id, producersExist }: any) => {
                  callback({ id });
                  if (producersExist) this.getProducers();
                }
              );
            } catch (error) {
              errback(error);
            }
          }
        );

        this.connectSendTransport();
      }
    );
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
    await this.socket.emit(
      'createWebRtcTransport',
      { consumer: true },
      ({ params }: any) => {
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

        consumerTransport.on(
          'connect',
          async (
            { dtlsParameters }: any,
            callback: Function,
            errback: Function
          ) => {
            try {
              await this.socket.emit('transport-recv-connect', {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });
              callback();
            } catch (error) {
              errback(error);
            }
          }
        );

        this.connectRecvTransport(
          consumerTransport,
          remoteProducerId,
          params.id
        );
      }
    );
  }

  async connectRecvTransport(
    consumerTransport: any,
    remoteProducerId: string,
    serverConsumerTransportId: string
  ) {
    await this.socket.emit(
      'consume',
      {
        rtpCapabilities: this.device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }: any) => {
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

        const { track } = consumer;
        this.addParticipant(remoteProducerId, new MediaStream([track]));

        this.socket.emit('consumer-resume', {
          serverConsumerId: params.serverConsumerId,
        });
      }
    );
  }

  handleProducerClosed(remoteProducerId: string) {
    const producerToClose = this.consumerTransports.find(
      (transportData) => transportData.producerId === remoteProducerId
    );
    if (producerToClose) {
      producerToClose.consumerTransport.close();
      producerToClose.consumer.close();
      this.consumerTransports = this.consumerTransports.filter(
        (transportData) => transportData.producerId !== remoteProducerId
      );
      const participant = this.participant$.value.filter(
        (particicipant) => particicipant.id != remoteProducerId
      );
      this.participant$.next(participant);
    }
  }

  getParticipants(): Observable<{ id: string; stream: MediaStream }[]> {
    return this.participant$.asObservable();
  }

  detachParticipant(id: string) {
    const participants = this.participant$.value.filter((p) => p.id !== id);
    const detached = this.participant$.value.find((p) => p.id === id);

    console.log('participants:', participants, '/nDetached: ', detached);
    if (detached) {
      this.detachedParticipant$.next([
        ...this.detachedParticipant$.value,
        detached,
      ]);
      this.participant$.next(participants);
    }
  }

  reattachParticipant(id: string) {
    const detached = this.detachedParticipant$.value.find((p) => p.id === id);
    console.log('Detached:', detached, '/n id: ', id);
    if (detached) {
      const updatedDetached = this.detachedParticipant$.value.filter(
        (p) => p.id !== id
      );
      this.detachedParticipant$.next(updatedDetached);
      this.participant$.next([...this.participant$.value, detached]);
    }
  }

  getDetachedParticipants(): Observable<{ id: string; stream: MediaStream }[]> {
    return this.detachedParticipant$.asObservable();
  }

  disconnectAndCleanUp() {
    // Clean up socket connection
    if (this.socket) {
      this.socket.disconnect();
      console.log('Socket disconnected');
    }
    // Stop local media tracks
    if (this.localVideo?.srcObject) {
      const stream = this.localVideo.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }

    // Clean up Mediasoup transports
    if (this.producerTransport) {
      this.producerTransport.close();
    }
    this.consumerTransports.forEach((transportData) => {
      transportData.consumerTransport.close();
      transportData.consumer.close();
    });
  }

  getProducers() {
    this.socket.emit('getProducers', (producerIds: string[]) => {
      producerIds.forEach((id: string) => this.signalNewConsumerTransport(id));
    });
  }

  addParticipant(remoteProducerId: string, stream: MediaStream) {
    const participant = this.participant$.value;
    this.participant$.next([...participant, { id: remoteProducerId, stream }]);
    // if (this.participant.length > 12 && !this.mainParticipant) {
    //   this.mainParticipant = this.participant[0];
    //   this.mainView = true;
    // }
    console.log('Participants:', this.participant$.value);
  }

  toggleLocalVideo() {
    if (this.producer && this.producer.kind === 'video') {
      if (this.producer.paused) {
        // Resume video
        this.producer.resume();
        console.log('Video resumed');
      } else {
        // Pause video
        this.producer.pause();
        console.log('Video paused');
      }
    }

    // Stop the video track in the local MediaStream (optional)
    const videoTrack = this.localVideo?.srcObject?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled; // Toggle video track
    }
  }

  toggleLocalAudio() {
    if (this.producer && this.producer.kind === 'audio') {
      if (this.producer.paused) {
        // Resume audio
        this.producer.resume();
        console.log('Audio resumed');
      } else {
        // Pause audio
        this.producer.pause();
        console.log('Audio paused');
      }
    }

    // Stop the audio track in the local MediaStream (optional)
    const audioTrack = this.localVideo?.srcObject?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled; // Toggle audio track
    }
  }
}
