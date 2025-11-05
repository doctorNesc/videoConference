import { Injectable } from '@angular/core';
import {
  Transport,
  Consumer,
  Producer,
  RtpCapabilities,
  TransportOptions,
} from 'mediasoup-client/types';
import { Device } from 'mediasoup-client';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable } from 'rxjs';
import { ACTIONS } from '../../../../server-app/src/config/actions'

export interface ChatMessage {
  sender: string;
  message: string;
  timestamp: string;
}

type ServerResponce = { res: any, success: boolean, error: string };
export type streamType = 'video' | 'screen';
@Injectable({
  providedIn: 'root',
})
export class VideoRoomService {
  private participant$ = new BehaviorSubject<{ id: string; stream: MediaStream, name: string, assignedMainRoomDevice?: string, socketId?: string }[]>([]);
  private detachedParticipant$ = new BehaviorSubject<{ id: string; stream: MediaStream, name: string }[]>([]);
  public mainParticipant = new BehaviorSubject<{ id: string, stream: MediaStream, name: string }>({} as { id: string, stream: MediaStream, name: string });
  public mainView: boolean = false;
  private socket!: Socket;
  private device!: Device;
  private producerTransport!: Transport;
  private consumerTransport!: Transport;
  private recv_params: any;
  private screenProducerTransport!: Transport | undefined;
  // private consumerTransports: {
  //   consumerTransport: Transport;
  //   serverConsumerTransportId: string;
  //   producerId: string;
  //   consumer: Consumer;
  // }[] = [];
  protected producers: Producer[] = [];
  protected consumers: Consumer[] = [];
  private screenProducer!: Producer | undefined;
  private roomName!: string;
  private username!: string;
  public isMainRoom: boolean = false;
  private rtpCapabilities!: RtpCapabilities;
  public isProducer: boolean = false;
  public localVideo!: any;
  public localStream!: MediaStream;
  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  public messages$: Observable<ChatMessage[]> =
    this.messagesSubject.asObservable();
  public videoStream!: MediaStream;
  // private screenStream!: MediaStream;
  // private consumedProducerIds = new Set<string>();
  private isSharingScreenSubject = new BehaviorSubject<boolean>(false);
  isSharingScreen$ = this.isSharingScreenSubject.asObservable();
  public assignedDevice: string | undefined;// sockedId of device this client is displayed
  public params: any = {
    encodings: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 },
  };

  constructor() { }

  initializeSocket(roomName: string, userName: string, isMainRoom: boolean) {
    this.roomName = roomName;
    this.username = userName;
    this.isMainRoom = isMainRoom;
    this.socket = io('http://localhost:3000/mediasoup');

    this.socket.on(ACTIONS.CONNECTION_SUCCESS, ({ socketId }: any) => {
      console.log('Connected with socket ID:', socketId);
      this.getLocalStream();
    });

    this.socket.on(ACTIONS.NEW_PRODUCER, ({ producerId }: any) => {
      // this.signalNewConsumer(producerId);
      this.connectRecvTransport(producerId, this.consumerTransport, this.recv_params.id);
    });

    this.socket.on('receiveMessage', (msg: ChatMessage) => {
      const currentMessages = this.messagesSubject.value;
      this.messagesSubject.next([...currentMessages, msg]);
    });

    this.socket.on(ACTIONS.PRODUCER_CLOSED, ({ remoteProducerId }: any) => {
      this.handleProducerClosed(remoteProducerId);
    });
  }

  async getLocalStream() {
    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { min: 640, max: 1920 },
          height: { min: 400, max: 1080 },
        },
      });

      this.localVideo = document.querySelector('#localVideo');
      if (this.localVideo) {
        this.localVideo.srcObject = this.videoStream;
      }

      this.joinRoom();
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  }

  joinRoom() {
    this.socket.emit(ACTIONS.JOIN_ROOM, { roomName: this.roomName, userName: this.username }, async (data: any) => {
      console.log('Router RTP Capabilities:', data.rtpCapabilities);
      this.rtpCapabilities = data.rtpCapabilities;
      await this.createDevice();
      await this.createRecvTransport();
      await this.createSendTransport();
    });
  }

  async createDevice() {
    try {
      this.device = new Device();
      await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
      // console.log('Device RTP Capabilities:', this.device.rtpCapabilities);
    } catch (error: any) {
      console.error('Error creating device:', error);
      if (error.name === 'UnsupportedError') {
        console.warn('Browser not supported');
      }
    }
  }

  createSendTransport() {
    this.socket.emit(
      ACTIONS.CREATE_WEBRTC_TRANSPORT,
      { isConsumer: false, roomName: this.roomName },
      ({ params }: { params: TransportOptions & ServerResponce }) => {
        if (params.error) {
          console.error(params.error);
          return;
        }

        this.producerTransport = this.device.createSendTransport(params);
        this.producerTransport.on(
          'connect',
          async (
            { dtlsParameters }: any,
            callback: Function,
            errback: Function
          ) => {
            try {
              await this.socket.emit(ACTIONS.CONNECT_SEND_TRANSPORT, {
                dtlsParameters,
              });
              callback();
            } catch (error) {
              errback(error);
            }
          }
        );

        this.producerTransport.on(
          ACTIONS.PRODUCE,
          async (parameters: any, callback: Function, errback: Function) => {
            try {
              await this.socket.emit(
                ACTIONS.TRANSPORT_PRODUCE,
                {
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                },
                ({ id, producersExist }: any) => {
                  if (producersExist) this.getProducers();
                  callback({ id });
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
      const track = await this.videoStream.getVideoTracks()[0];
      const cameraParams = {
        track,
        encodings: this.params.encodings,
        codecOptions: this.params.codecOptions,
      };

      // this.params = { track, ...this.params };
      const producer = await this.producerTransport.produce(cameraParams);
      producer.on('trackended', () => console.log('Track ended'));
      producer.on(ACTIONS.TRANSPORT_CLOSE, () => console.log('Transport closed'));
      this.producers.push(producer);
    } catch (error) {
      console.error('Error connecting send transport:', error);
    }
  }

  // async signalNewConsumer(
  //   remoteProducerId: string,
  //   // mediaType: streamType,
  //   assignedMainRoomDevice?: string,
  //   socketId?: string,
  //   name?: string
  // ) {
  //   if (this.consumedProducerIds.has(remoteProducerId)) return;
  //   this.consumedProducerIds.add(remoteProducerId);

  //   await this.socket.emit(
  //     ACTIONS.CREATE_WEBRTC_TRANSPORT,
  //     { isConsumer: true, roomName: this.roomName },
  //     async ({ params }: any) => {
  //       if (params.error) {
  //         console.error(params.error);
  //         return;
  //       }
  //       let consumerTransport = this.device.createRecvTransport(params);


  //       this.connectRecvTransport(
  //         consumerTransport,
  //         remoteProducerId,
  //         consumerTransport.id,
  //         // mediaType,
  //         // assignedMainRoomDevice,
  //         socketId,
  //         name
  //       );
  //     });
  // }

  createRecvTransport() {
    this.socket.emit(
      ACTIONS.CREATE_WEBRTC_TRANSPORT,
      { isConsumer: true, roomName: this.roomName },
      ({ params }: { params: TransportOptions & ServerResponce }) => {
        if (params.error) {
          console.error(params.error);
          return;
        }

        console.log('Created Recv WebRTC Transport, params:', params);
        this.recv_params = params;
        this.consumerTransport = this.device.createRecvTransport(params);
        this.consumerTransport.on('connect', async ({ dtlsParameters }: any, callback: Function, errback: Function) => {
          try {
            await this.socket.emit(ACTIONS.TRANSPORT_RECV_CONNECT, {
              dtlsParameters: dtlsParameters,
              serverConsumerTransportId: params.id,
            });
            callback();
          } catch (error) {
            errback(error);
          }
        }
        );
      }
    );
  }

  connectRecvTransport(
    remoteProducerId: string,
    consumerTransport: Transport,
    serverConsumerTransportId: string,
    // assignedMainRoomDevice?: string,
    socketId?: string,
    name?: string
  ) {
    this.socket.emit(
      ACTIONS.CONSUME,
      {
        rtpCapabilities: this.device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
        // mediaType,
      },
      async ({ params }: any) => {
        if (params.error) {
          console.error('Cannot consume:', params.error);
          return;
        }
        let consumer;
        try {
          consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
          });
        } catch (e) {
          console.error('[Client] consume() failed:', e);
        }

        // this.consumerTransports.push({
        //   consumerTransport,
        //   serverConsumerTransportId: params.id,
        //   producerId: remoteProducerId,
        //   consumer,
        // });

        const { track } = consumer!;
        this.addParticipant(
          remoteProducerId,
          new MediaStream([track]),
          params.userName || name || '',
          // assignedMainRoomDevice,
          socketId
        );

        this.socket.emit(ACTIONS.CONSUMER_RESUME, {
          serverConsumerId: params.serverConsumerId,
        });
      }
    );
  }

  sendMessage(message: string, sender: string, roomName: string) {
    const chatMessage: ChatMessage = {
      sender,
      message,
      timestamp: new Date().toISOString(),
    };

    this.socket.emit('sendMessage', { roomName, message });

    const currentMessages = this.messagesSubject.value;
    this.messagesSubject.next([...currentMessages, chatMessage]);
  }

  getMessages(): Observable<ChatMessage[]> {
    return this.messages$;
  }

  handleProducerClosed(remoteProducerId: string) {
    // Close and remove the consumer and its transport
    // const producerToClose = this.consumerTransports.find(
    //   (transportData) => transportData.producerId === remoteProducerId
    // );
    // if (producerToClose) {
    //   producerToClose.consumerTransport.close();
    //   producerToClose.consumer.close();
    //   this.consumerTransports = this.consumerTransports.filter(
    //     (transportData) => transportData.producerId !== remoteProducerId
    //   );
    // }
    // Remove from participants
    const updatedParticipants = this.participant$.value.filter(
      (participant) => participant.id !== remoteProducerId
    );
    this.participant$.next(updatedParticipants);
    // Remove from detached participants as well
    const updatedDetached = this.detachedParticipant$.value.filter(
      (participant) => participant.id !== remoteProducerId
    );
    this.detachedParticipant$.next(updatedDetached);
    // console.log('After producer-closed:', {
    //   participants: this.participant$.value,
    //   detached: this.detachedParticipant$.value,
    //   closedId: remoteProducerId
    // });
  }

  getParticipants(): Observable<{ socketId?: string | undefined; id: string; stream: MediaStream, name: string, assignedMainRoomDevice?: string, }[]> {
    return this.participant$.asObservable();
  }

  detachParticipant(id: string) {
    const participants = this.participant$.value.filter((p) => p.id !== id);
    const detached = this.participant$.value.find((p) => p.id === id);

    // console.log('participants:', participants, '/nDetached: ', detached);
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
    // console.log('Detached:', detached, '/n id: ', id);
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
      // console.log('Socket disconnected');
    }
    // Stop local media tracks
    if (this.localVideo?.srcObject) {
      const stream = this.localVideo.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }

    // Clean up Mediasoup transports
    this.producers.forEach((producer) => {
      producer.close();
    });
    this.consumers.forEach((consumer) => {
      consumer.close();
    });
    this.producerTransport && this.producerTransport.close();
    this.consumerTransport && this.consumerTransport.close();
  }

  getProducers() {
    this.socket.emit(ACTIONS.GET_PRODUCERS, (response: any) => {
      let producerList: any[] = response;
      // if (Array.isArray(response)) {
      // main room device
      // producerList = response;
      // } else {
      //   // remote user
      //   producerList = response.producerList;
      //   this.assignedDevice = response.myAssignedMainRoomDevice;
      // }

      producerList.forEach(({ id, socketId, name }) =>
        // this.signalNewConsumer(id, socketId, name);
        this.connectRecvTransport(id, this.consumerTransport, this.recv_params.id, socketId, name)
      )
    });
  }

  addParticipant(remoteProducerId: string, stream: MediaStream, name: string, assignedMainRoomDevice?: string, socketId?: string) {
    this.participant$.next([
      ...this.participant$.value,
      { id: remoteProducerId, stream, name, assignedMainRoomDevice, socketId },

    ]);
    // console.log('Participants:', this.participant$.value);
  }

  toggleLocalVideo() {
    //   if (this.producer && this.producer.kind === 'video') {
    //     if (this.producer.paused) {
    //       // Resume video
    //       this.producer.resume();
    //       console.log('Video resumed');
    //     } else {
    //       // Pause video
    //       this.producer.pause();
    //       console.log('Video paused');
    //     }
    //   }

    //   // Stop the video track in the local MediaStream (optional)
    //   const videoTrack = this.localVideo?.srcObject?.getVideoTracks()[0];
    //   if (videoTrack) {
    //     videoTrack.enabled = !videoTrack.enabled; // Toggle video track
    //   }
  }

  toggleLocalAudio() {
    //   if (this.producer && this.producer.kind === 'audio') {
    //     if (this.producer.paused) {
    //       // Resume audio
    //       this.producer.resume();
    //       console.log('Audio resumed');
    //     } else {
    //       // Pause audio
    //       this.producer.pause();
    //       console.log('Audio paused');
    //     }
    //   }

    // Stop the audio track in the local MediaStream (optional)
    //   const audioTrack = this.localVideo?.srcObject?.getAudioTracks()[0];
    //   if (audioTrack) {
    //     audioTrack.enabled = !audioTrack.enabled; // Toggle audio track
    //   }
  }

  // async connectScreenSendTransport() {
  //   try {
  //     this.screenStream = await navigator.mediaDevices.getDisplayMedia({
  //       video: true,
  //       audio: true,
  //     });
  //     const track = await this.screenStream.getVideoTracks()[0];
  //     const screenParams = {
  //       track,
  //       encodings: this.params.encodings,
  //       codecOptions: this.params.codecOptions,
  //     };
  //     this.screenProducer = await this.screenProducerTransport?.produce(
  //       screenParams
  //     );
  //     this.addParticipant('screen', this.screenStream, 'Screen Share');
  //     this.screenProducer?.on('trackended', () =>
  //       console.log('Screen track ended')
  //     );
  //     this.screenProducer?.on(ACTIONS.TRANSPORT_CLOSE, () =>
  //       console.log('Screen transport closed')
  //     );
  //   } catch (error) {
  //     console.error('Error connecting screen send transport:', error);
  //   }
  // }

  async startScreenShare() {
    if (this.screenProducer) {
      try { this.screenProducer.close(); } catch { }
      this.screenProducer = undefined;
    }
    if (this.screenProducerTransport) {
      try { this.screenProducerTransport.close(); } catch { }
      this.screenProducerTransport = undefined;
    }

    this.createSendTransport();
    this.isSharingScreenSubject.next(true);
  }

  stopScreenShare() {
    this.socket.emit(ACTIONS.STOP_SCREEN_SHARE, {
      roomName: this.roomName,
      producerId: this.screenProducer?.id,
    });
    // this.screenProducer?.close();
    // this.screenProducer = undefined;
    // this.screenProducerTransport?.close();
    // this.screenProducerTransport = undefined;

    if (this.screenProducer) {
      try { this.screenProducer.close(); } catch { }
      this.screenProducer = undefined;
    }
    if (this.screenProducerTransport) {
      try { this.screenProducerTransport.close(); } catch { }
      this.screenProducerTransport = undefined;
    }
    this.isSharingScreenSubject.next(false);

    const participants = this.participant$.value.filter(
      (particicipant) => particicipant.id != 'screen'
    );
    this.participant$.next(participants); //stop local video stream display
  }
}
