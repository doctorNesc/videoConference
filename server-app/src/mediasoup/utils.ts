
import { createWorker } from "mediasoup";
import { Router, WebRtcServerOptions, WebRtcTransport, WebRtcTransportOptions, Worker } from "mediasoup/node/lib/types";
import { SharedState } from "../types";
import { mediaCodecs, systemConfig, webRtcTransport_options } from "../config/mediasoup.config";
import { SocketId } from "socket.io-adapter";
import { AppData } from "mediasoup-client/lib/types";

export const creatMediasoupWorker = async (): Promise<Worker | undefined> => {
    try {
        const worker = await createWorker(systemConfig.workerSettings);
        console.log(`worker pid ${worker.pid}`);
        worker.on("died", () => {
            console.error("mediasoup worker has died");
            setTimeout(() => process.exit(1), 2000);
        });
        return worker;
    } catch (error) {
        console.error("Failed to create Mediasoup worker:", error);
    }
};

export const getWebRtcTransportOptionsForWorker = (workerIndex: number): WebRtcServerOptions => {
    const basePort = 40000 + workerIndex * 500;
    const portRange = { min: basePort, max: basePort + 499 };
    return {
        listenInfos: [
            {
                portRange,
                protocol: "udp",
                ip: "0.0.0.0",
                announcedIp: "192.168.1.241"
            },
            {
                portRange,
                protocol: "tcp",
                ip: "0.0.0.0",
                announcedIp: "192.168.1.241"
            }
        ],
        // enableUdp: true,
        // enableTcp: true,
        // preferUdp: true,
    };
}

export const getOrCreateRoom = async (state: SharedState, roomName: string, socketId: string) => {
    // creates router for the roomName using worker.createRouter(options)
    let router;
    let isAdmin = false;
    let peers: string[] = [];
    if (state.rooms[roomName]) {
        router = state.rooms[roomName].router;
        peers = state.rooms[roomName].peers || [];
    } else {
        router = await state.worker!.createRouter({ mediaCodecs });
        isAdmin = true; //if room is new, first user to create it will be an admin
    }

    state.rooms[roomName] = {
        router,
        peers: [...peers, socketId],
    };

    return { router, isAdmin };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const removeItems = (items: any, socketId: SocketId, type: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items.forEach((item: any) => {
        if (item.socketId === socketId) {
            item[type].close();
        }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items = items.filter((item: any) => item.socketId !== socketId);

    return items;
};


export const createWebRtcTransport = async (router: Router): Promise<WebRtcTransport> => {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<WebRtcTransport>(async (resolve, reject) => {
        try {
            // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
            const transport: WebRtcTransport = await router.createWebRtcTransport(webRtcTransport_options);
            console.log(`Created tranport with id: ${transport.id}`);

            transport.on("dtlsstatechange", (dtlsState) => {
                if (dtlsState === "closed") {
                    transport.close();
                }
            });

            transport.on("@close", () => {
                console.log("transport closed");
            });

            resolve(transport);
        } catch (error) {
            reject(error);
        }
    });
};

