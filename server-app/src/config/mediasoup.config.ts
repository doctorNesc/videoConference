import { RtpCodecCapability } from "mediasoup/node/lib/types";
// import os from "os";

export const mediaCodecs: RtpCodecCapability[] = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
        preferredPayloadType: 97
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
            "x-google-start-bitrate": 1000
        },
        preferredPayloadType: 96
    }
];

// https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
// export const webRtcTransport_options: WebRtcTransportOptions = {
//     listenInfos: [
//         {
//             portRange: { min: 40000, max: 49999 },
//             protocol: "udp",
//             ip: "0.0.0.0",
//             announcedIp: "192.168.68.68"
//         },
//         {
//             portRange: { min: 40000, max: 49999 },
//             protocol: "tcp",
//             ip: "0.0.0.0",
//             announcedIp: "192.168.68.68"
//         }
//     ],
//     // listenIps: [
//     //     {
//     //         ip: "0.0.0.0",
//     //         announcedIp: "192.168.1.241"
//     //     }
//     // ],
//     enableUdp: true,
//     enableTcp: true,
//     preferUdp: true,
// };

export const systemConfig = {
    // numWorkers: Object.keys(os.cpus()).length,
    numWorkers: 4,
    workerSettings:
    {
        dtlsCertificateFile: process.env.WORKER_CERT_FULLCHAIN,
        dtlsPrivateKeyFile: process.env.WORKER_CERT_PRIVKEY,
        // logLevel: 'warn',
        // logTags:
        //     [
        //         'info',
        //         'ice',
        //         'dtls',
        //         'rtp',
        //         'srtp',
        //         'rtcp',
        //         'rtx',
        //         'bwe',
        //         'score',
        //         'simulcast',
        //         'svc',
        //         'sctp'
        //     ],
        // TODO change later
        disableLiburing: true
    },

}
