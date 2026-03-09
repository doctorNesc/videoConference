import { inject, Injectable } from '@angular/core';
import {
  Transport,
  Consumer,
  Producer,
  RtpCapabilities,
  TransportOptions,
} from 'mediasoup-client/types';
import { Device } from 'mediasoup-client';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable, take } from 'rxjs';
import { ACTIONS } from '../../../../server-app/src/config/actions'
import { Router } from '@angular/router';
import { ParticipantService } from './participant.service';
import { SocketService } from './socket.service';

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

  private router = inject(Router);

  // public mainParticipant = new BehaviorSubject<{ id: string, stream: MediaStream, name: string }>({} as { id: string, stream: MediaStream, name: string });
  public mainView: boolean = false;
  private socket!: Socket;
  private device!: Device;
  private producerTransport!: Transport;
  private consumerTransport!: Transport;
  // private screenProducerTransport!: Transport | undefined;
  // private consumerTransports: {
  //   consumerTransport: Transport;
  //   serverConsumerTransportId: string;
  //   producerId: string;
  //   consumer: Consumer;
  // }[] = [];
  protected producers: { id: string, producer: Producer, isScreen?: boolean }[] = [];
  protected consumers: Consumer[] = [];
  // private screenProducer!: Producer | undefined;
  private roomName!: string;
  private username!: string;
  // public isMainRoom: boolean = false;
  private rtpCapabilities!: RtpCapabilities;
  private recv_params: any;
  public localVideo!: any;
  // public localStream!: MediaStream;
  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  public messages$: Observable<ChatMessage[]> =
    this.messagesSubject.asObservable();
  public videoStream!: MediaStream;
  // private screenStream!: MediaStream;
  // private consumedProducerIds = new Set<string>();
  // private isSharingScreenSubject = new BehaviorSubject<boolean>(false);
  // isSharingScreen$ = this.isSharingScreenSubject.asObservable();
  public assignedDevice: string | undefined;// sockedId of device this client is displayed
  public params: any = {
    encodings: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 },
  };

  constructor(public participantService: ParticipantService, public socketService: SocketService) { }

  initializeSocket(roomName: string, userName: string, isMainRoom: boolean) {
    this.roomName = roomName;
    this.username = userName;

    // this.isMainRoom = isMainRoom;
    // this.socket = io('http://localhost:3000/mediasoup');

    this.socketService.on(ACTIONS.CONNECTION_SUCCESS, async ({ socketId }: any) => {
      console.log('Connected with socket ID:', socketId);
      await this.getLocalStream();
      await this.joinRoom();
      await this.createDevice();
      await this.createRecvTransport();
      await this.createSendTransport();
      await this.produceVideo();
    });

    this.socketService.on(ACTIONS.NEW_PRODUCER, async ({ producerId }: any) => {
      await this.connectRecvTransport(producerId, this.consumerTransport, this.recv_params.id);
    });

    this.socketService.on('receiveMessage', (msg: ChatMessage) => {
      const currentMessages = this.messagesSubject.value;
      this.messagesSubject.next([...currentMessages, msg]);
    });

    this.socketService.on(ACTIONS.PRODUCER_CLOSED, ({ remoteProducerId }: any) => {
      this.handleProducerClosed(remoteProducerId);
    });
  }

  async getLocalStream() {
    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,//TODO change to true
        video: {
          width: { min: 640, max: 1920 },
          height: { min: 400, max: 1080 },
        },
      });

      this.localVideo = document.querySelector('#localVideo');
      if (this.localVideo) {
        this.localVideo.srcObject = this.videoStream;
      }

      // this.joinRoom();
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  }

  // joinRoom() {
  //   this.socket.emit(ACTIONS.JOIN_ROOM, { roomName: this.roomName, userName: this.username }, async (data: any) => {
  //     console.log('Router RTP Capabilities:', data.rtpCapabilities);
  //     this.rtpCapabilities = data.rtpCapabilities;
  //     await this.createDevice();
  //     this.createRecvTransport();
  //     this.createSendTransport();
  //   });
  // }

  async joinRoom() {
    const data = await this.socketService.emit(ACTIONS.JOIN_ROOM, {
      roomName: this.roomName,
      userName: this.username
    });

    console.log('Router RTP Capabilities:', data.rtpCapabilities);
    this.rtpCapabilities = data.rtpCapabilities;

    return data;
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

  async createSendTransport() {
    try {
      const res = await this.socketService.emit(ACTIONS.CREATE_WEBRTC_TRANSPORT, { isConsumer: false, roomName: this.roomName })
      // ({ params }: { params: TransportOptions & ServerResponce }) => {
      this.producerTransport = this.device.createSendTransport(res.params);
      this.producerTransport.on(
        'connect',
        async (
          { dtlsParameters }: any,
          callback: Function,
        ) => {
          try {
            await this.socketService.emit(ACTIONS.CONNECT_SEND_TRANSPORT, {
              dtlsParameters,
            });
            callback();
          } catch (error) {
            callback(error);
          }
        }
      );

      this.producerTransport.on(ACTIONS.PRODUCE, async (parameters: any, callback: Function) => {
        try {
          const { id, producersExist } = await this.socketService.emit(ACTIONS.TRANSPORT_PRODUCE, {
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
          });
          if (producersExist) this.getProducers();
          callback({ id });
        } catch (error) {
          callback(error);
        }
      });
    } catch {
      console.error('Error creating send transport');
    }
  }

  async produceVideo() {
    try {
      const track = this.videoStream.getVideoTracks()[0];
      const cameraParams = {
        track,
        encodings: this.params.encodings,
        codecOptions: this.params.codecOptions,
      };

      // this.params = { track, ...this.params };
      const producer: Producer = await this.producerTransport.produce(cameraParams);
      // console.log('Producer created:', producer);
      producer.on('trackended', () => console.log('Track ended'));
      producer.on(ACTIONS.TRANSPORT_CLOSE, () => console.log('Transport closed'));
      this.producers.push({ id: producer.id, producer, isScreen: false });
    } catch (error) {
      console.error('Error connecting send transport:', error);
    }
  }

  async produceScreen() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const track = await screenStream.getVideoTracks()[0];
      const screenParams = {
        track,
        encodings: this.params.encodings,
        codecOptions: this.params.codecOptions,
      };

      // this.params = { track, ...this.params };
      const producer = await this.producerTransport.produce(screenParams);
      // console.log('Producer created:', producer);
      producer.on('trackended', () => console.log('Track ended'));
      producer.on(ACTIONS.TRANSPORT_CLOSE, () => console.log('Transport closed'));
      this.producers.push({ id: producer.id, producer, isScreen: true });
    } catch (error) {
      console.error('Error connecting send transport:', error);
    }
  }
  async createRecvTransport() {
    try {
      const { params } = await this.socketService.emit(ACTIONS.CREATE_WEBRTC_TRANSPORT, { isConsumer: true, roomName: this.roomName });

      console.log('Created Recv WebRTC Transport, params:', params);
      this.recv_params = params;
      this.consumerTransport = this.device.createRecvTransport(this.recv_params);
      this.consumerTransport.on('connect', async ({ dtlsParameters }: any, callback: Function) => {
        try {
          await this.socketService.emit(ACTIONS.TRANSPORT_RECV_CONNECT, {
            dtlsParameters: dtlsParameters,
            serverConsumerTransportId: params.id,
          });
          callback();
        } catch (error) {
          callback(error);
        }
      });
    } catch {
      console.error('Error creating recv transport');
    }
  }

  async connectRecvTransport(remoteProducerId: string, consumerTransport: Transport, serverConsumerTransportId: string,// assignedMainRoomDevice?: string,
    socketId?: string,
  ) {
    try {
      const { params } = await this.socketService.emit(ACTIONS.CONSUME, {
        rtpCapabilities: this.device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
        // mediaType,
      });
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
      const { track } = consumer!;
      this.addParticipant(
        remoteProducerId,
        new MediaStream([track]),
        params.userName || '',
        // assignedMainRoomDevice,
        socketId
      );

      this.socketService.emit(ACTIONS.CONSUMER_RESUME, {
        serverConsumerId: params.serverConsumerId,
      });

    } catch {
      console.error('Error connecting recv transport');
    }


    // this.consumerTransports.push({
    //   consumerTransport,
    //   serverConsumerTransportId: params.id,
    //   producerId: remoteProducerId,
    //   consumer,
    // });

  }
  //   );
  // }

  handleProducerClosed(remoteProducerId: string) {
    // Close and remove the consumer and its transport
    //closing the consumer
    const consumerToClose = this.consumers.find((item) => item.producerId == remoteProducerId);
    consumerToClose?.close();
    this.consumers.filter((item) => item.producerId != remoteProducerId);
    // Remove from participants
    this.participantService.remove(remoteProducerId);
    // Remove from detached participants as well
    this.participantService.removeDetached(remoteProducerId);
  }

  getParticipants(): Observable<{ socketId?: string | undefined; id: string; stream: MediaStream, name: string, assignedMainRoomDevice?: string, }[]> {
    return this.participantService.participants;
  }

  detachParticipant(id: string) {
    this.participantService.detach(id);
  }

  reattachParticipant(id: string) {
    this.participantService.reattach(id);
  }

  getDetachedParticipants(): Observable<{ id: string; stream: MediaStream }[]> {
    return this.participantService.detachedParticipants;
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

    this.participantService.cleanUp();
    // Clean up Mediasoup transports
    this.producers.forEach((item) => {
      item.producer.close();
    });
    this.consumers.forEach((consumer) => {
      consumer.close();
    });
    this.producerTransport && this.producerTransport.close();
    this.consumerTransport && this.consumerTransport.close();
  }

  async getProducers() {
    const response: { producerId: string, socketId: string }[] = await this.socketService.emit(ACTIONS.GET_PRODUCERS);
    // let producerList: any[] = response;
    // if (Array.isArray(response)) {
    // main room device
    // producerList = response;
    // } else {
    //   // remote user
    //   producerList = response.producerList;
    //   this.assignedDevice = response.myAssignedMainRoomDevice;
    // }

    response.forEach(async ({ producerId, socketId }) =>
      !this.producers.find((producer) => producer.id == producerId) && await this.connectRecvTransport(producerId, this.consumerTransport, this.recv_params.id, socketId)
    );
  }

  addParticipant(remoteProducerId: string, stream: MediaStream, name: string, assignedMainRoomDevice?: string, socketId?: string) {
    this.participantService.add({ id: remoteProducerId, stream, name, assignedMainRoomDevice, socketId });
    // this.participant$.next([
    //   ...this.participant$.value,
    //   { id: remoteProducerId, stream, name, assignedMainRoomDevice, socketId },

    // ]);
    this.participantService.participants.pipe(take(1)).subscribe(val => console.log('Added participant:', val));
  }

  toggleLocalVideo() {
    if (this.producers[0] && this.producers[0].producer.kind === 'video') {
      if (this.producers[0].producer?.paused) {
        // Resume video
        this.producers[0].producer?.resume();
        console.log('Video resumed');
      } else {
        // Pause video
        this.producers[0].producer?.pause();
        console.log('Video paused');
      }
    }
  }

  toggleLocalAudio() {
    if (this.producers[0].producer && this.producers[0].producer?.kind === 'audio') {
      if (this.producers[0].producer?.paused) {
        // Resume audio
        this.producers[0].producer?.resume();
        console.log('Audio resumed');
      } else {
        // Pause audio
        this.producers[0].producer?.pause();
        console.log('Audio paused');
      }
    }
  }

  async startScreenShare() {

    await this.produceScreen();
    // if (this.screenProducer) {
    //   try { this.screenProducer.close(); } catch { }
    //   this.screenProducer = undefined;
    // }
    // if (this.screenProducerTransport) {
    //   try { this.screenProducerTransport.close(); } catch { }
    //   this.screenProducerTransport = undefined;
    // }

    // this.createSendTransport();
    // this.isSharingScreenSubject.next(true);
  }

  async stopScreenShare() {
    //   this.socket.emit(ACTIONS.STOP_SCREEN_SHARE, {
    //     roomName: this.roomName,
    //     producerId: this.screenProducer?.id,
    //   });
    await this.producers.find(item => item.isScreen)?.producer?.close();
    this.producers.filter(item => item.isScreen == false);
    // this.participantService.remove('screen');
    //   // this.screenProducer?.close();
    //   // this.screenProducer = undefined;
    //   // this.screenProducerTransport?.close();
    //   // this.screenProducerTransport = undefined;

    //   if (this.screenProducer) {
    //     try { this.screenProducer.close(); } catch { }
    //     this.screenProducer = undefined;
    //   }
    //   if (this.screenProducerTransport) {
    //     try { this.screenProducerTransport.close(); } catch { }
    //     this.screenProducerTransport = undefined;
    //   }
    //   this.isSharingScreenSubject.next(false);

    //   const participants = this.participant$.value.filter(
    //     (particicipant) => particicipant.id != 'screen'
    //   );
    //   this.participant$.next(participants); //stop local video stream display
  }

  public leaveRoom() {
    this.socketService.emit(ACTIONS.LEAVE_ROOM, { roomName: this.roomName });
    this.router.navigate(['/']);
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


}
