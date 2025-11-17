import { Injectable } from "@angular/core";
import { RtpCapabilities, Transport, TransportOptions } from "mediasoup-client/types";
import { Device } from 'mediasoup-client';

@Injectable({ providedIn: 'root' })
export class MediasoupService {
    private device!: Device;
    private producerTransport!: Transport;
    private consumerTransport!: Transport;

    // async loadDevice() {
    //     this.device = new Device();
    //     await this.device.load({ routerRtpCapabilities: rtpCapabilities });
    // }
    async createDevice(rtpCapabilities: RtpCapabilities) {
        try {
            this.device = new Device();
            await this.device.load({ routerRtpCapabilities: rtpCapabilities });
            // console.log('Device RTP Capabilities:', this.device.rtpCapabilities);
        } catch (error: any) {
            console.error('Error creating device:', error);
            if (error.name === 'UnsupportedError') {
                console.warn('Browser not supported');
            }
        }
    }


    createSendTransport(params: TransportOptions) {
        this.producerTransport = this.device.createSendTransport(params);
        return this.producerTransport;
    }

    createRecvTransport(params: TransportOptions) {
        this.consumerTransport = this.device.createRecvTransport(params);
        return this.consumerTransport;
    }

    async produceVideo(stream: MediaStream, params: any) {
        const track = stream.getVideoTracks()[0];
        const producer = await this.producerTransport.produce({
            track,
            ...params,
        });
        return producer;
    }

    async consume(consumerTransport: Transport, params: any) {
        const consumer = await consumerTransport.consume(params);
        return consumer;
    }
}
