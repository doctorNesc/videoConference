"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webRtcTransport_options = exports.mediaCodecs = void 0;
exports.mediaCodecs = [
    { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: { "x-google-start-bitrate": 1000 },
    },
];
// https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
exports.webRtcTransport_options = {
    listenIps: [
        {
            ip: "0.0.0.0", // PRIVATE_IP_OF_INSTANCE : 172.31.37.220
            announcedIp: "192.168.1.241", //PUBLIC_IP_OF_INSTANCE : 147.175.123.135 / 192.168.1.250
        },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
};
