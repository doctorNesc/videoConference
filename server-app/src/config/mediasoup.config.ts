import { RtpCodecCapability } from "mediasoup/node/lib/types";


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


export const systemConfig = {
    
    numWorkers: 4,
    workerSettings:
    {
        dtlsCertificateFile: process.env.WORKER_CERT_FULLCHAIN,
        dtlsPrivateKeyFile: process.env.WORKER_CERT_PRIVKEY,
        
        
        disableLiburing: true
    },

}
