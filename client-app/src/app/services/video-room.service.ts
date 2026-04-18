import { inject, Injectable, Optional } from '@angular/core';
import {
  Transport,
  Consumer,
  DataConsumer,
  DataProducer,
  Producer,
  RtpCapabilities,
} from 'mediasoup-client/types';
import { Device } from 'mediasoup-client';
import { BehaviorSubject, Observable, take } from 'rxjs';
import { ACTIONS } from '../../../../server-app/src/config/actions';
import { Router } from '@angular/router';
import { ParticipantService } from './participant.service';
import { SocketService } from './socket.service';
import { JoinPreferencesService } from './join-preferences.service';
import { RoomDeviceService } from './room-device.service';
import { BroadcastChannelService } from './broadcast-channel.service';
import {
  RemoteAssignment,
  RoomConfig,
  RoomTopologyDTO,
  ScreenCameraPairing,
  SlotRemoteJoinedEvent,
  SlotRemoteLeftEvent,
} from '../utils/hybrid-types';

export interface ChatMessage {
  sender: string;
  message: string;
  timestamp: string;
}

export type streamType = 'video' | 'screen';

@Injectable({
  providedIn: 'root',
})
export class VideoRoomService {

  private router = inject(Router);

  // ─── Mode ─────────────────────────────────────────────────────────────────
  public isRoomDevice: boolean = false;

  // ─── Assignment (remote participants only) ────────────────────────────────
  /** The slot this remote participant is currently assigned to */
  public currentAssignment: RemoteAssignment | null = null;
  private assignment$ = new BehaviorSubject<RemoteAssignment | null>(null);
  public assignment = this.assignment$.asObservable();

  // ─── Topology (all peers) ─────────────────────────────────────────────────
  private topology$ = new BehaviorSubject<RoomTopologyDTO | null>(null);
  public topology = this.topology$.asObservable();

  // ─── Room config (display layout, camera position) ────────────────────────
  /** Populated from JOIN_ROOM callback and updated live via ROOM_CONFIG_UPDATE. */
  private roomConfig$ = new BehaviorSubject<RoomConfig | null>(null);
  public roomConfig = this.roomConfig$.asObservable();

  // ─── Mediasoup state ──────────────────────────────────────────────────────
  public mainView: boolean = false;
  private device!: Device;
  private producerTransport!: Transport;
  private consumerTransport!: Transport;

  /**
   * Producers keyed by slotId for room devices (one per camera/slot),
   * or a single entry for remote participants.
   * { id: producerId, producer, isScreen, slotId? }
   */
  protected producers: { id: string; producer: Producer; isScreen?: boolean; slotId?: string }[] = [];
  protected consumers: Consumer[] = [];

  private roomName!: string;
  private username!: string;
  private rtpCapabilities!: RtpCapabilities;
  private recv_params: any;
  public localVideo!: any;
  public videoStream!: MediaStream;

  // ─── Chat (DataChannel) ───────────────────────────────────────────────────
  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  public messages$: Observable<ChatMessage[]> = this.messagesSubject.asObservable();

  /** The local DataProducer used to send chat messages */
  private chatDataProducer: DataProducer | null = null;
  /** All active DataConsumers keyed by their server-side DataConsumer ID */
  private dataConsumers: Map<string, DataConsumer> = new Map();

  // ─── Encoding params ──────────────────────────────────────────────────────
  public params: any = {
    encodings: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 },
  };

  constructor(
    public participantService: ParticipantService,
    public socketService: SocketService,
    private joinPrefs: JoinPreferencesService,
    public roomDeviceService: RoomDeviceService,
    @Optional() private broadcastChannel: BroadcastChannelService,
  ) { }

  // ─── Initialisation ───────────────────────────────────────────────────────

  initializeSocket(roomName: string, userName: string, isRoomDevice: boolean) {
    this.roomName = roomName;
    this.username = userName;
    this.isRoomDevice = isRoomDevice;

    this.socketService.on(ACTIONS.CONNECTION_SUCCESS, async ({ socketId }: any) => {
      // All users need local stream for display
      await this.getLocalStream();

      await this.joinRoom();
      await this.createDevice();
      await this.createRecvTransport();
      await this.createSendTransport();

      // Create the chat DataProducer on the send transport (all peers)
      await this.createChatDataProducer();

      if (this.isRoomDevice) {
        // Phase 4: advertise capabilities, then show pairing wizard
        await this.registerAsRoomDevice();
      } else {
        // Remote participant: produce video immediately
        await this.produceVideo();
      }
    });

    this.socketService.on(ACTIONS.NEW_PRODUCER, async ({ producerId, socketId }: any) => {
      console.log('[VideoRoomService] NEW_PRODUCER event received — producerId:', producerId, '| socketId from event:', socketId, '| isRoomDevice:', this.isRoomDevice);
      if (!this.producers.find((p) => p.id === producerId)) {
        await this.connectRecvTransport(producerId, this.consumerTransport, this.recv_params.id, socketId);
      }
    });

    // ─── Hybrid: assignment update (remote participants) ──────────────────
    this.socketService.on(ACTIONS.ASSIGNMENT_UPDATE, (assignment: RemoteAssignment) => {
      this.currentAssignment = assignment;
      this.assignment$.next(assignment);
      console.log('[VideoRoomService] Assignment updated:', assignment);
    });

    // ─── Hybrid: topology update (all peers) ─────────────────────────────
    this.socketService.on(ACTIONS.ROOM_TOPOLOGY_UPDATE, (topology: RoomTopologyDTO) => {
      this.topology$.next(topology);
      if (this.isRoomDevice) {
        // Update room device slot state
        const mySocketId = this.getMySocketId();
        if (mySocketId) {
          // On first topology update (after REGISTER_ROOM_DEVICE), initialize slots from topology
          if (this.roomDeviceService.slotsSnapshot.length === 0) {
            this.roomDeviceService.initSlotsFromTopology(topology, mySocketId);
            if (this.broadcastChannel) {
              console.log('[VideoRoomService] Broadcasting initial slots to slot windows');
              this.broadcastChannel.broadcastSlots(this.roomDeviceService.slotsSnapshot);
            }
          } else {
            // Subsequent updates: just update existing slots
            this.roomDeviceService.onTopologyUpdate(topology, mySocketId);
            if (this.broadcastChannel) {
              console.log('[VideoRoomService] Broadcasting updated slots to slot windows');
              this.broadcastChannel.broadcastSlots(this.roomDeviceService.slotsSnapshot);
            }
          }
        }
      }
    });

    // ─── Hybrid: slot notifications (room devices) ────────────────────────
    this.socketService.on(ACTIONS.SLOT_REMOTE_JOINED, (event: SlotRemoteJoinedEvent) => {
      this.roomDeviceService.onRemoteJoined(event);
      if (this.broadcastChannel) {
        console.log('[VideoRoomService] SLOT_REMOTE_JOINED for slot', event.slotId, 'remote', event.remoteSocketId);
        this.broadcastChannel.broadcastSlots(this.roomDeviceService.slotsSnapshot);
      }
    });

    this.socketService.on(ACTIONS.SLOT_REMOTE_LEFT, (event: SlotRemoteLeftEvent) => {
      this.roomDeviceService.onRemoteLeft(event);
      if (this.broadcastChannel) {
        console.log('[VideoRoomService] SLOT_REMOTE_LEFT for slot', event.slotId, 'remote', event.remoteSocketId);
        this.broadcastChannel.broadcastSlots(this.roomDeviceService.slotsSnapshot);
      }
    });

    // ─── Producer closed ──────────────────────────────────────────────────
    this.socketService.on(ACTIONS.PRODUCER_CLOSED, ({ remoteProducerId }: any) => {
      this.handleProducerClosed(remoteProducerId);
    });

    // ─── DataChannel: new remote DataProducer available ──────────────────
    this.socketService.on(ACTIONS.NEW_DATA_PRODUCER, async ({ dataProducerId, socketId, userName }: any) => {
      console.log('[VideoRoomService] NEW_DATA_PRODUCER — id:', dataProducerId, 'from:', userName);
      await this.consumeDataProducer(dataProducerId, userName);
    });

    // ─── Room config live update (admin saved new display layout) ─────────
    this.socketService.on(ACTIONS.ROOM_CONFIG_UPDATE, (config: RoomConfig) => {
      this.roomConfig$.next(config);
      console.log('[VideoRoomService] ROOM_CONFIG_UPDATE received for room:', config.roomName);
    });
  }

  // ─── Room join ────────────────────────────────────────────────────────────

  async joinRoom() {
    const data = await this.socketService.emit(ACTIONS.JOIN_ROOM, {
      roomName: this.roomName,
      userName: this.username,
      isRoomDevice: this.isRoomDevice,
    });

    this.rtpCapabilities = data.rtpCapabilities;

    // If server already assigned us a slot (room had paired devices before we joined)
    if (data.assignment && !this.isRoomDevice) {
      this.currentAssignment = data.assignment;
      this.assignment$.next(data.assignment);
      console.log('[VideoRoomService] Initial assignment from JOIN_ROOM:', data.assignment);
    }

    // Seed the room config observable so components have it immediately on join
    if (data.roomConfig) {
      this.roomConfig$.next(data.roomConfig);
      console.log('[VideoRoomService] Initial roomConfig from JOIN_ROOM:', data.roomConfig.roomName);
    }

    return data;
  }

  // ─── Local stream ─────────────────────────────────────────────────────────

  async getLocalStream() {
    try {
      const prefs = this.joinPrefs.snapshot;
      const videoConstraint: MediaTrackConstraints = {
        width: { min: 640, max: 1920 },
        height: { min: 400, max: 1080 },
      };

      // Use pre-selected camera if available
      if (prefs.selectedCameraId) {
        videoConstraint.deviceId = { exact: prefs.selectedCameraId };
      }

      this.videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false, // TODO: enable audio
        video: videoConstraint,
      });

      this.localVideo = document.querySelector('#localVideo');
      if (this.localVideo) {
        this.localVideo.srcObject = this.videoStream;
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  }

  // ─── Hybrid: room device registration ────────────────────────────────────

  /**
   * Phase 4: Enumerates screens and cameras, sends capabilities to server.
   * Attempts to load saved pairing config. If found, sends it with registration.
   * Otherwise, the pairing wizard component will call submitScreenCameraPairing() after
   * the operator assigns cameras to screens.
   */
  async registerAsRoomDevice(): Promise<{ slots: string[]; hasSavedConfig: boolean }> {
    await this.roomDeviceService.enumerateScreens();
    await this.roomDeviceService.enumerateCameras();

    const capabilities = this.roomDeviceService.getCapabilities();
    const fingerprint = this.roomDeviceService.generateFingerprint();

    // Try to load saved pairing config
    let savedPairings: { slotId?: string; screenIndex: number; cameraDeviceId: string; cameraLabel: string; displayId?: string; excluded?: boolean }[] | null = null;
    let hasSavedConfig = false;
    try {
      const savedConfig = await this.roomDeviceService.loadSavedConfig(this.roomName, fingerprint);
      if (savedConfig && savedConfig.pairings) {
        savedPairings = savedConfig.pairings;
        hasSavedConfig = true;
        console.log('[VideoRoomService] Loaded saved pairing config for device', fingerprint);
      }
    } catch (err) {
      console.warn('[VideoRoomService] Failed to load saved config:', err);
    }

    const payload: any = { capabilities, fingerprint };
    if (savedPairings) {
      payload.savedPairings = savedPairings;
    }

    const result = await this.socketService.emit(ACTIONS.REGISTER_ROOM_DEVICE, payload);

    console.log('[VideoRoomService] Registered as room device, slot IDs:', result?.slots, 'hasSavedConfig:', hasSavedConfig);

    // When saved config is applied, the server already paired the slots.
    // We must produce camera streams now (same as submitScreenCameraPairing does),
    // because the component skips the wizard and never calls submitScreenCameraPairing.
    if (hasSavedConfig && savedPairings && result?.slots) {
      // The server creates slots in the same order as capabilities.screens (screenIndex 0, 1, 2...).
      // result.slots is newSlots.map(s => s.slotId) — index i corresponds to screen i.
      // Saved pairings may not have screenIndex (older saves), so match by array position.
      const slotIds: string[] = result.slots;

      for (let i = 0; i < savedPairings.length; i++) {
        const pairing = savedPairings[i];
        if (!pairing.cameraDeviceId || pairing.excluded) continue;

        // Match by screenIndex if present, otherwise fall back to positional index
        let slotId: string | undefined;
        if (pairing.screenIndex !== undefined) {
          slotId = slotIds[pairing.screenIndex];
        } else {
          slotId = slotIds[i];
        }

        if (!slotId) {
          console.warn(`[VideoRoomService] No slotId found for pairing index ${i}, skipping`);
          continue;
        }

        console.log(`[VideoRoomService] Producing camera for saved slot ${slotId} (index ${i}, camera: ${pairing.cameraLabel})`);
        await this.produceCameraForSlot(slotId, pairing.cameraDeviceId);
      }
      // Now consume any existing producers from other peers
      await this.getProducers();
    }

    return { slots: result?.slots ?? [], hasSavedConfig };
  }

  /**
   * Phase 5: Called by the pairing wizard after the operator assigns cameras.
   * Sends pairings to server, saves config locally, then starts producing camera streams.
   */
  async submitScreenCameraPairing(pairings: ScreenCameraPairing[]): Promise<void> {
    // Apply locally for immediate UI feedback
    pairings.forEach(p => {
      this.roomDeviceService.applyPairing(p.slotId, p.cameraDeviceId, p.cameraLabel);
    });

    // Send to server
    await this.socketService.emit(ACTIONS.SCREEN_CAMERA_PAIRING, { pairings });

    // Save pairing config to server for future joins.
    // Enrich each pairing with screenIndex (looked up from local slot state) so the
    // saved config can be matched back to the correct slot on the next session.
    const fingerprint = this.roomDeviceService.generateFingerprint();
    const enrichedPairings = pairings.map(p => {
      const slot = this.roomDeviceService.slotsSnapshot.find(s => s.slotId === p.slotId);
      return { ...p, screenIndex: slot?.screenIndex };
    });
    const saved = await this.roomDeviceService.savePairingConfig(this.roomName, fingerprint, enrichedPairings as any);
    if (saved) {
      console.log('[VideoRoomService] Saved pairing config for device', fingerprint);
    }

    // Start producing a camera stream for each paired slot
    for (const pairing of pairings) {
      await this.produceCameraForSlot(pairing.slotId, pairing.cameraDeviceId);
    }

    // Now consume existing producers from other peers
    await this.getProducers();
  }

  /**
   * Emits CHOOSE_DISPLAY to server when a remote participant selects a display.
   */
  chooseDisplay(displayId: string): Promise<any> {
    return this.socketService.emit(ACTIONS.CHOOSE_DISPLAY, { displayId });
  }

  /**
   * Produces a video stream for a specific camera/slot.
   * Notifies the server which producer corresponds to which slot.
   */
  async produceCameraForSlot(slotId: string, cameraDeviceId: string): Promise<void> {
    try {
      console.log(`[VideoRoomService] produceCameraForSlot() starting for slot ${slotId}, cameraDeviceId: ${cameraDeviceId}`);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: cameraDeviceId } },
        audio: false,
      });
      console.log(`[VideoRoomService] Got media stream for slot ${slotId}`);
      const track = stream.getVideoTracks()[0];
      console.log(`[VideoRoomService] Got video track for slot ${slotId}, calling producerTransport.produce()`);
      const producer = await this.producerTransport.produce({
        track,
        encodings: this.params.encodings,
        codecOptions: this.params.codecOptions,
        appData: { slotId, cameraDeviceId },
      });

      console.log(`[VideoRoomService] producerTransport.produce() returned producer ${producer.id} for slot ${slotId}`);
      producer.on('trackended', () => console.log(`[Slot ${slotId}] Track ended`));
      producer.on(ACTIONS.TRANSPORT_CLOSE, () => console.log(`[Slot ${slotId}] Transport closed`));

      this.producers.push({ id: producer.id, producer, isScreen: false, slotId });

      // Tell server which producer belongs to which slot
      await this.socketService.emit(ACTIONS.CAMERA_PRODUCER_REGISTERED, {
        slotId,
        producerId: producer.id,
      });

      this.roomDeviceService.updateSlotProducer(slotId, producer.id);
      console.log(`[VideoRoomService] Camera producer for slot ${slotId}: ${producer.id}`);
    } catch (error) {
      console.error(`[VideoRoomService] Error producing camera for slot ${slotId}:`, error);
    }
  }

  // ─── Mediasoup transport & producer setup ─────────────────────────────────

  async createDevice() {
    try {
      this.device = new Device();
      await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
    } catch (error: any) {
      console.error('Error creating device:', error);
      if (error.name === 'UnsupportedError') {
        console.warn('Browser not supported');
      }
    }
  }

  async createSendTransport() {
    try {
      const res = await this.socketService.emit(ACTIONS.CREATE_WEBRTC_TRANSPORT, {
        isConsumer: false,
        roomName: this.roomName,
      });
      this.producerTransport = this.device.createSendTransport(res.params);

      this.producerTransport.on('connect', async ({ dtlsParameters }: any, callback: Function) => {
        try {
          await this.socketService.emit(ACTIONS.CONNECT_SEND_TRANSPORT, { dtlsParameters, roomName: this.roomName });
          callback();
        } catch (error) {
          callback(error);
        }
      });

      this.producerTransport.on(ACTIONS.PRODUCE, async (parameters: any, callback: Function) => {
        try {
          console.log('[VideoRoomService] PRODUCE event triggered, kind:', parameters.kind);
          const { id, producersExist } = await this.socketService.emit(ACTIONS.TRANSPORT_PRODUCE, {
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
            roomName: this.roomName,
          });
          console.log('[VideoRoomService] TRANSPORT_PRODUCE returned id:', id, 'producersExist:', producersExist);
          if (producersExist) this.getProducers();
          callback({ id });
        } catch (error) {
          console.error('[VideoRoomService] Error in PRODUCE handler:', error);
          callback(error);
        }
      });

      // ─── DataChannel: producedata event ────────────────────────────────
      // Fired by producerTransport.produceData(); we signal the server and
      // return the server-assigned DataProducer ID via callback.
      // The server also returns existingDataProducers so we can consume peers
      // who joined before us (late-joiner fix).
      this.producerTransport.on('producedata', async (parameters: any, callback: Function) => {
        try {
          console.log('[VideoRoomService] producedata event triggered');
          const { id, error, existingDataProducers } = await this.socketService.emit(ACTIONS.PRODUCE_DATA, {
            sctpStreamParameters: parameters.sctpStreamParameters,
            label: parameters.label,
            protocol: parameters.protocol,
            appData: parameters.appData,
          });
          if (error) {
            console.error('[VideoRoomService] PRODUCE_DATA server error:', error);
            callback(new Error(error));
            return;
          }
          console.log('[VideoRoomService] DataProducer created on server, id:', id,
            '| existing DataProducers:', existingDataProducers?.length ?? 0);

          // Consume all DataProducers that already existed before we joined
          if (Array.isArray(existingDataProducers)) {
            for (const { dataProducerId, userName } of existingDataProducers) {
              await this.consumeDataProducer(dataProducerId, userName);
            }
          }

          callback({ id });
        } catch (err) {
          console.error('[VideoRoomService] Error in producedata handler:', err);
          callback(err);
        }
      });
    } catch {
      console.error('Error creating send transport');
    }
  }

  async createRecvTransport() {
    try {
      const { params } = await this.socketService.emit(ACTIONS.CREATE_WEBRTC_TRANSPORT, {
        isConsumer: true,
        roomName: this.roomName,
      });
      this.recv_params = params;
      this.consumerTransport = this.device.createRecvTransport(this.recv_params);

      this.consumerTransport.on('connect', async ({ dtlsParameters }: any, callback: Function) => {
        try {
          await this.socketService.emit(ACTIONS.TRANSPORT_RECV_CONNECT, {
            dtlsParameters,
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

  /** Produces the local camera stream (for remote participants) */
  async produceVideo() {
    try {
      const track = this.videoStream.getVideoTracks()[0];
      const producer: Producer = await this.producerTransport.produce({
        track,
        encodings: this.params.encodings,
        codecOptions: this.params.codecOptions,
      });
      producer.on('trackended', () => console.log('Track ended'));
      producer.on(ACTIONS.TRANSPORT_CLOSE, () => console.log('Transport closed'));
      this.producers.push({ id: producer.id, producer, isScreen: false });
    } catch (error) {
      console.error('Error producing video:', error);
    }
  }

  async produceScreen() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const track = screenStream.getVideoTracks()[0];
      const producer = await this.producerTransport.produce({
        track,
        encodings: this.params.encodings,
        codecOptions: this.params.codecOptions,
      });
      producer.on('trackended', () => console.log('Screen track ended'));
      producer.on(ACTIONS.TRANSPORT_CLOSE, () => console.log('Screen transport closed'));
      this.producers.push({ id: producer.id, producer, isScreen: true });
    } catch (error) {
      console.error('Error producing screen:', error);
    }
  }

  // ─── Consumer ─────────────────────────────────────────────────────────────

  async connectRecvTransport(
    remoteProducerId: string,
    consumerTransport: Transport,
    serverConsumerTransportId: string,
    socketId?: string,
  ) {
    console.log('[VideoRoomService] connectRecvTransport() — producerId:', remoteProducerId, '| socketId:', socketId);
    try {
      const { params } = await this.socketService.emit(ACTIONS.CONSUME, {
        rtpCapabilities: this.device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
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
        return;
      }

      const { track } = consumer!;

      // Determine if this producer is the assigned camera for this remote participant
      const isAssignedCamera = !this.isRoomDevice &&
        this.currentAssignment?.cameraProducerId === remoteProducerId;

      this.addParticipant(
        remoteProducerId,
        new MediaStream([track]),
        params.userName || '',
        socketId,
        isAssignedCamera,
      );

      this.socketService.emit(ACTIONS.CONSUMER_RESUME, {
        serverConsumerId: params.serverConsumerId,
      });
    } catch {
      console.error('Error connecting recv transport');
    }
  }

  // ─── Producers list ───────────────────────────────────────────────────────

  async getProducers(retryCount: number = 0, maxRetries: number = 5) {
    const response: { producerId: string; socketId: string }[] =
      await this.socketService.emit(ACTIONS.GET_PRODUCERS);

    console.log('[VideoRoomService] getProducers() response:', JSON.stringify(response), 'attempt:', retryCount + 1);

    // If no producers found and we haven't exceeded max retries, retry with exponential backoff
    if (response.length === 0 && retryCount < maxRetries) {
      const delayMs = Math.min(1000 * Math.pow(2, retryCount), 10000); // exponential backoff, max 10s
      console.log(`[VideoRoomService] No producers found, retrying in ${delayMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
      setTimeout(() => this.getProducers(retryCount + 1, maxRetries), delayMs);
      return;
    }

    response.forEach(async ({ producerId, socketId }) => {
      console.log('[VideoRoomService] getProducers() — consuming producerId:', producerId, '| socketId:', socketId);
      if (!this.producers.find((p) => p.id === producerId)) {
        await this.connectRecvTransport(producerId, this.consumerTransport, this.recv_params.id, socketId);
      }
    });
  }

  // ─── Participant management ───────────────────────────────────────────────

  addParticipant(
    remoteProducerId: string,
    stream: MediaStream,
    name: string,
    socketId?: string,
    isAssignedCamera?: boolean,
  ) {
    this.participantService.add({
      id: remoteProducerId,
      stream,
      name,
      socketId,
      isAssignedCamera,
    });

    // Expose streams on window so slot-view windows can access via window.opener
    // (MediaStream cannot be transferred via BroadcastChannel)
    this.exposeStreamsOnWindow(remoteProducerId, stream, socketId);

    this.participantService.participants.pipe(take(1)).subscribe(
      val => {
        console.log('Added participant:', val);
        // Broadcast serialisable refs (no MediaStream) to slot-view windows
        if (this.broadcastChannel) {
          this.broadcastChannel.broadcastParticipants(val);
        }
      }
    );
  }

  /**
   * Exposes participant streams on window so slot-view windows can access them
   * via window.opener.__participantStreams__ (by producerId) and
   * window.opener.__participantStreamsBySocketId__ (by socketId).
   */
  private exposeStreamsOnWindow(producerId: string, stream: MediaStream, socketId?: string) {
    const win = window as any;
    if (!win.__participantStreams__) {
      win.__participantStreams__ = new Map<string, MediaStream>();
    }
    if (!win.__participantStreamsBySocketId__) {
      win.__participantStreamsBySocketId__ = new Map<string, MediaStream>();
    }
    win.__participantStreams__.set(producerId, stream);
    if (socketId) {
      win.__participantStreamsBySocketId__.set(socketId, stream);
    }
    console.log('[VideoRoomService] Exposed stream for producerId', producerId, 'socketId', socketId);
  }

  handleProducerClosed(remoteProducerId: string) {
    const consumerToClose = this.consumers.find((item) => item.producerId === remoteProducerId);
    consumerToClose?.close();
    this.consumers = this.consumers.filter((item) => item.producerId !== remoteProducerId);

    // Remove from window stream maps
    const win = window as any;
    if (win.__participantStreams__) {
      win.__participantStreams__.delete(remoteProducerId);
    }

    this.participantService.remove(remoteProducerId);
    this.participantService.removeDetached(remoteProducerId);

    // Broadcast updated refs after removal
    this.participantService.participants.pipe(take(1)).subscribe(val => {
      if (this.broadcastChannel) {
        this.broadcastChannel.broadcastParticipants(val);
      }
    });
  }

  getParticipants(): Observable<{ socketId?: string; id: string; stream: MediaStream; name: string; assignedMainRoomDevice?: string; isAssignedCamera?: boolean }[]> {
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

  // ─── Media controls ───────────────────────────────────────────────────────

  toggleLocalVideo() {
    const videoProducer = this.producers.find(p => !p.isScreen && !p.slotId);
    if (videoProducer?.producer) {
      if (videoProducer.producer.paused) {
        videoProducer.producer.resume();
      } else {
        videoProducer.producer.pause();
      }
    }
  }

  toggleLocalAudio() {
    // Audio producer toggle — extend when audio is enabled
  }

  async startScreenShare() {
    await this.produceScreen();
  }

  async stopScreenShare() {
    try {
      const screenProducer = this.producers.find(item => item.isScreen);
      if (screenProducer) {
        const producerId = screenProducer.id;
        await screenProducer.producer?.close();
        this.producers = this.producers.filter(item => !item.isScreen);
        await this.socketService.emit(ACTIONS.STOP_SCREEN_SHARE, {
          roomName: this.roomName,
          producerId,
        });
      }
    } catch (error) {
      console.error('Error stopping screen share:', error);
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  public leaveRoom() {
    this.socketService.emit(ACTIONS.LEAVE_ROOM, { roomName: this.roomName });
    this.router.navigate(['/']);
  }

  disconnectAndCleanUp() {
    if (this.localVideo?.srcObject) {
      const stream = this.localVideo.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }

    this.participantService.cleanUp();
    this.producers.forEach((item) => item.producer.close());
    this.consumers.forEach((consumer) => consumer.close());
    this.chatDataProducer?.close();
    this.dataConsumers.forEach((dc) => dc.close());
    this.producerTransport && this.producerTransport.close();
    this.consumerTransport && this.consumerTransport.close();

    this.roomDeviceService.reset();
    this.currentAssignment = null;
    this.assignment$.next(null);
    this.topology$.next(null);
    this.roomConfig$.next(null);
    this.producers = [];
    this.consumers = [];
    this.chatDataProducer = null;
    this.dataConsumers.clear();
  }

  // ─── Chat (DataChannel) ───────────────────────────────────────────────────

  /**
   * Creates a mediasoup DataProducer on the send transport.
   * This is the local "write end" of the chat DataChannel.
   */
  private async createChatDataProducer(): Promise<void> {
    try {
      if (!this.producerTransport) {
        console.warn('[VideoRoomService] createChatDataProducer: send transport not ready');
        return;
      }

      // producerTransport.produceData() fires the 'producedata' event on the transport,
      // which is handled in createSendTransport() above. That handler signals the server
      // via PRODUCE_DATA and returns the server-assigned DataProducer ID via callback.
      this.chatDataProducer = await this.producerTransport.produceData({
        ordered: true,
        label: 'chat',
        protocol: 'json',
        appData: { type: 'chat' },
      });

      console.log('[VideoRoomService] Chat DataProducer created:', this.chatDataProducer.id);
    } catch (err) {
      console.error('[VideoRoomService] Error creating chat DataProducer:', err);
    }
  }

  /**
   * Consumes a remote peer's chat DataProducer.
   * Attaches a message listener that pushes received messages into messagesSubject.
   */
  private async consumeDataProducer(dataProducerId: string, senderName: string): Promise<void> {
    try {
      if (!this.consumerTransport || !this.recv_params?.id) {
        console.warn('[VideoRoomService] consumeDataProducer: recv transport not ready');
        return;
      }

      const params = await this.socketService.emit(ACTIONS.CONSUME_DATA, {
        dataProducerId,
        serverConsumerTransportId: this.recv_params.id,
      });

      if (params.error) {
        console.error('[VideoRoomService] CONSUME_DATA error:', params.error);
        return;
      }

      const dataConsumer: DataConsumer = await this.consumerTransport.consumeData({
        id: params.id,
        dataProducerId: params.dataProducerId,
        sctpStreamParameters: params.sctpStreamParameters,
        label: params.label,
        protocol: params.protocol,
      });

      this.dataConsumers.set(dataConsumer.id, dataConsumer);

      dataConsumer.on('message', (data: any) => {
        try {
          const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);
          const parsed: { message: string; timestamp: string } = JSON.parse(raw);
          const chatMessage: ChatMessage = {
            sender: senderName,
            message: parsed.message,
            timestamp: parsed.timestamp,
          };
          const current = this.messagesSubject.value;
          this.messagesSubject.next([...current, chatMessage]);
        } catch (e) {
          console.warn('[VideoRoomService] Failed to parse DataChannel message:', e);
        }
      });

      // Resume the DataConsumer
      await this.socketService.emit(ACTIONS.DATA_CONSUMER_RESUME, {
        serverDataConsumerId: dataConsumer.id,
      });

      console.log('[VideoRoomService] DataConsumer ready for', senderName, '— id:', dataConsumer.id);
    } catch (err) {
      console.error('[VideoRoomService] Error consuming DataProducer:', err);
    }
  }

  /**
   * Sends a chat message via the local DataProducer (SCTP DataChannel).
   * Also appends the message locally so the sender sees it immediately.
   */
  sendMessage(message: string, sender: string, _roomName: string) {
    const chatMessage: ChatMessage = {
      sender,
      message,
      timestamp: new Date().toISOString(),
    };

    if (this.chatDataProducer && !this.chatDataProducer.closed) {
      const payload = JSON.stringify({ message: chatMessage.message, timestamp: chatMessage.timestamp });
      this.chatDataProducer.send(payload);
    } else {
      console.warn('[VideoRoomService] Chat DataProducer not ready — message not sent over DataChannel');
    }

    // Always show the message locally
    const current = this.messagesSubject.value;
    this.messagesSubject.next([...current, chatMessage]);
  }

  getMessages(): Observable<ChatMessage[]> {
    return this.messages$;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private getMySocketId(): string | null {
    return this.socketService.socketId ?? null;
  }
}
