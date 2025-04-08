import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import mediasoup from "mediasoup";

const app = express();
const __dirname = path.resolve();

app.use(
  express.static(path.join(__dirname, "../client-app/dist/client-app/browser"))
);

app.get("/api/roomUsers", (req, res) => {
  // Optional: Parse room name from query params, e.g., /roomUsers?room=room1
  const room = req.query.room;
  const allRooms = Object.values(peers).reduce((rooms, peer) => {
    const { roomName, transports, producers, consumers, peerDetails } = peer;

    if (!rooms[roomName]) {
      rooms[roomName] = {
        room: roomName,
        userCount: 0,
        peers: [],
      };
    }

    rooms[roomName].userCount += 1;
    rooms[roomName].peers.push({
      transports,
      producers,
      consumers,
      peerDetails,
      socketId: peer.socket.id,
    });

    return rooms;
  }, {});

  if (room && allRooms[room]) {
    res.json(Object.values(allRooms[room]));
  } else {
    res.json(Object.values(allRooms));
  }
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../client-app/dist/client-app/browser/index.html")
  );
});

// Media codecs configuration
const mediaCodecs = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 1000 },
  },
];

const httpServer = http.createServer(app);
httpServer.listen(3000, () => {
  console.log("listening on port: " + 3000);
});

const io = new Server(httpServer,
  {
    cors: {
      origin: "http://localhost:4200",
      // methods: ["GET", "POST"],
      // credentials: true,
    },
  }
);

// socket.io namespace for connecting server and client sockets
const connections = io.of("/mediasoup");

let worker;
let rooms = {}; // { roomName1: { Router, rooms: [ socketId1, ... ] }, ...}
let peers = {}; // { socketId1: { roomName1, socket, transports = [id1, id2,], producers = [id1, id2,], consumers = [id1, id2,], peerDetails }, ...}
let transports = []; // [ { socketId1, roomName1, transport, isConsumer }, ... ]
let producers = []; // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []; // [ { socketId1, roomName1, consumer, }, ... ]

const createWorker = async () => {
  try {
    const worker = await mediasoup.createWorker();

    console.log(`worker pid ${worker.pid}`);

    worker.on("died", (error) => {
      //something serious happened, so kill the application
      console.error("mediasoup worker has died");
      setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });

    return worker;
  } catch (error) {
    console.error("Failed to create Mediasoup worker:", error);
  }
};

//create a Worker as soon as our application starts
(async () => {
  worker = await createWorker();
})();

connections.on("connection", async (socket) => {
  //The "connection" event is triggered whenever a client successfully connects to the /mediasoup namespace
  //after connection, new socket object is created for that specific client connection
  console.log(socket.id);

  socket.emit("connection-success", {
    socketId: socket.id,
  });

  socket.on("joinRoom", async ({ roomName }, callback) => {
    // const router = rooms[roomName] && rooms[roomName].get('data').router || await ceateRoom(roomName, socket.id)
    const { router, isAdmin } = await getOrCreateRoom(roomName, socket.id);

    console.log("Joined room " + roomName);
    peers[socket.id] = {
      socket,
      roomName, // name for the Router this Peer joined
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: "",
        isAdmin, //admin if joined the room first
      },
    };

    // call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities: router.rtpCapabilities });
  });

  const getOrCreateRoom = async (roomName, socketId) => {
    // creates router for the roomName using worker.createRouter(options)
    let router;
    let isAdmin = false;
    let peers = [];
    if (rooms[roomName]) {
      router = rooms[roomName].router;
      peers = rooms[roomName].peers || [];
    } else {
      router = await worker.createRouter({ mediaCodecs });
      isAdmin = true; //if room is new, first user to create it will be an admin
    }

    console.log(`Router ID: ${router.id}`, peers.length);

    rooms[roomName] = {
      router,
      peers: [...peers, socketId],
    };

    return { router, isAdmin };
  };

  // client emits a request to create server side Transport
  // need to differentiate between the producer and consumer transports
  socket.on("createWebRtcTransport", async ({ isConsumer }, callback) => {
    try {
      // get room name from peer's props
      const roomName = peers[socket.id].roomName;
      const router = rooms[roomName].router;

      const transport = await createWebRtcTransport(router);
      // add transport to Peer's props
      addTransport(transport, roomName, isConsumer);

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    } catch (error) {
      console.error("Error creating WebRTC transport:", error);
    }
  });

  const addTransport = (transport, roomname, isConsumer) => {
    transports = [
      ...transports,
      { socketId: socket.id, transport, roomname, isConsumer },
    ];

    peers[socket.id] = {
      ...peers[socket.id],
      transports: [...peers[socket.id].transports, transport.id],
    };
  };

  const addProducer = (producer, roomName) => {
    producers = [...producers, { socketId: socket.id, producer, roomName }];

    peers[socket.id] = {
      ...peers[socket.id],
      producers: [...peers[socket.id].producers, producer.id],
    };
  };

  const addConsumer = (consumer, roomName) => {
    // add the consumer to the consumers list
    consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

    // add the consumer id to the peers list
    peers[socket.id] = {
      ...peers[socket.id],
      consumers: [...peers[socket.id].consumers, consumer.id],
    };
  };

  socket.on("getProducers", (callback) => {
    //return all producer transports
    const { roomName } = peers[socket.id];

    let producerList = [];

    producers.forEach((producerData) => {
      //exclude clients, that are making the call
      if (
        producerData.socketId != socket.id &&
        producerData.roomName == roomName
      ) {
        producerList = [...producerList, producerData.producer.id];
      }
    });
    // return the producer list back to the client
    callback(producerList);
  });

  const informConsumers = (roomName, socketId, id) => {
    console.log(`just joined, id ${id} ${roomName}, ${socketId}`);
    // A new producer just joined
    // let all consumers to consume this producer
    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socketId &&
        producerData.roomName === roomName
      ) {
        const producerSocket = peers[producerData.socketId].socket;
        // use socket to send producer id to producer
        producerSocket.emit("new-producer", { producerId: id });
      }
    });
  };

  const getTransport = (socketId) => {
    const producerTransport = transports.find(
      (transport) => transport.socketId === socketId && !transport.consumer
    );
    return producerTransport?.transport; // Optional chaining to avoid errors if not found
  };

  // see client's socket.emit('transport-connect', ...)
  socket.on("transport-connect", async ({ dtlsParameters }) => {
    try {
      const transport = getTransport(socket.id);
      await transport.connect({ dtlsParameters });
    } catch (error) {
      console.error("Error connecting transport:", error);
    }
  });

  // see client's socket.emit('transport-produce', ...)
  socket.on("transport-produce", async ({ kind, rtpParameters }, callback) => {
    // call produce based on the prameters from the client
    const transport = getTransport(socket.id);
    const producer = await transport.produce({ kind, rtpParameters });
    const roomName = peers[socket.id].roomName;

    console.log("Producer ID: ", producer.id, producer.kind);

    addProducer(producer, roomName);
    informConsumers(roomName, socket.id, producer.id);
    // Send back to the client the Producer's id
    callback({
      id: producer.id,
      producersExist: producers.length > 1 ? true : false,
    });
  });

  socket.on(
    "consume",
    async (
      { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
      callback
    ) => {
      try {
        const roomName = peers[socket.id].roomName;
        const router = rooms[roomName].router;
        let consumerTransport = transports.find(
          (transportData) =>
            transportData.isConsumer &&
            transportData.transport.id == serverConsumerTransportId
        )?.transport;

        // check if the router can consume the specified producer
        if (
          router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities,
          })
        ) {
          // transport can now consume and return a consumer
          const consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
            socket.emit("producer-closed", { remoteProducerId });

            consumerTransport.close([]);
            transports = transports.filter(
              (transportData) =>
                transportData.transport.id !== consumerTransport.id
            );
            consumer.close();
            consumers = consumers.filter(
              (consumerData) => consumerData.consumer.id !== consumer.id
            );
          });

          addConsumer(consumer, roomName);

          // from the consumer extract the following params
          // to send back to the Client
          const params = {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
          };

          // send the parameters to the client
          callback({ params });
        }
      } catch (error) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    }
  );

  socket.on("consumer-resume", async ({ serverConsumerId }) => {
    // console.log("consumer resume");
    try {
      const { consumer } = consumers.find(
        (consumerData) => consumerData.consumer.id === serverConsumerId
      );
      await consumer.resume();
    } catch (error) {
      console.error("Error resuming consumer:", error);
    }
  });

  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      console.log(`DTLS PARAMS: ${dtlsParameters}`);
      const consumerTransport = transports.find(
        (transportData) =>
          transportData.isConsumer &&
          transportData.transport.id == serverConsumerTransportId
      ).transport;
      await consumerTransport.connect({ dtlsParameters });
    }
  );

  socket.on("sendMessage", ({ roomName, message }) => {
    if (!roomName || !peers[socket.id]) return;

    const senderName = peers[socket.id].peerDetails.name || "Unknown";

    for (let peer of Object.values(peers)) {
        if (peer.roomName === roomName) {
          peer.socket.id != socket.id && connections.to(peer.socket.id).emit("receiveMessage", {
                sender: senderName,
                message,
                timestamp: new Date().toISOString(),
            });
        }
    }
});


  socket.on("disconnect", () => {
    console.log("peer disconnected");

    if (peers[socket.id]) {
      const { roomName } = peers[socket.id];
      delete peers[socket.id];
      // remove socket from room
      rooms[roomName] = {
        router: rooms[roomName].router,
        peers: rooms[roomName].peers.filter(
          (socketId) => socketId !== socket.id
        ),
      };
    }

    consumers = removeItems(consumers, socket.id, "consumer");
    producers = removeItems(producers, socket.id, "producer");
    transports = removeItems(transports, socket.id, "transport");
  });

  const removeItems = (items, socketId, type) => {
    items.forEach((item) => {
      if (item.socketId === socket.id) {
        item[type].close();
      }
    });
    items = items.filter((item) => item.socketId !== socket.id);

    return items;
  };
});

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: "0.0.0.0", // PRIVATE_IP_OF_INSTANCE : 172.31.37.220
            announcedIp: "192.168.1.250", //PUBLIC_IP_OF_INSTANCE : 16.170.244.236
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await router.createWebRtcTransport(
        webRtcTransport_options
      );
      console.log(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        console.log("transport closed");
      });

      resolve(transport);
    } catch (error) {
      reject(error);
    }
  });
};
