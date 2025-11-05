
// import { createWorker } from "mediasoup";
import { Router, WebRtcServer, WebRtcServerOptions, WebRtcTransport, } from "mediasoup/node/lib/types";

export const getWebRtcTransportOptionsForWorker = (workerIndex: number): WebRtcServerOptions => {
    const basePort = 40000 + workerIndex * 500;
    const portRange = { min: basePort, max: basePort + 499 };
    return {
        listenInfos: [
            {
                portRange,
                protocol: "udp",
                ip: "0.0.0.0",
                announcedIp: "192.168.1.250"
            },
            {
                portRange,
                protocol: "tcp",
                ip: "0.0.0.0",
                announcedIp: "192.168.1.250"
            }
        ],
        // enableUdp: true,
        // enableTcp: true,
        // preferUdp: true,
    };
}

export const createWebRtcTransport = async (
  router: Router,
  rtcServer: WebRtcServer
): Promise<WebRtcTransport> => {
  const transport = await router.createWebRtcTransport({
    webRtcServer: rtcServer,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  // console.log(`Created transport with id: ${transport.id}`);

  transport.on("dtlsstatechange", (dtlsState) => {
    // console.log(`transport ${transport.id} dtlsstatechange:`, dtlsState);
    if (dtlsState === "closed") {
      transport.close();
    }
  });

  // transport.on("icestatechange", (iceState) => {//debug purposes
  //   console.log(`transport ${transport.id} icestatechange:`, iceState);
  // });

  transport.on("@close", () => {
    console.log("transport closed");
  });

  return transport;
};
