import { RtpCodecCapability, WebRtcTransportOptions } from "mediasoup/node/lib/types";


export const mediaCodecs: RtpCodecCapability[] = [
    { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: { "x-google-start-bitrate": 1000 },
    },
];

// https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
export const webRtcTransport_options: WebRtcTransportOptions = {
    listenInfos: [
        {
            portRange: { min: 40000, max: 49999 },
            protocol: "udp",
            ip: "0.0.0.0",
            announcedIp: "192.168.1.241"
        }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
};

