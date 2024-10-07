import express from 'express';
const app = express();

import https from 'https';
import fs from 'fs';
import path from 'path';
const __dirname = path.resolve();

import { Server } from 'socket.io';
import mediasoup from 'mediasoup';

app.get('*', (req, res, next) => {
  const path = '/sfu/';

  if (req.path.indexOf(path) == 0 && req.path.length > path.length)
    return next();

  res.send(
    `You need to specify a room name in the path e.g. 'https://127.0.0.1/sfu/room'`
  );
});

app.use('/sfu/:room', express.static(path.join(__dirname, 'public')));

// SSL cert for HTTPS access
const options = {
  key: fs.readFileSync('./ssl/key.pem', 'utf-8'),
  cert: fs.readFileSync('./ssl/cert.pem', 'utf-8'),
};
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

const httpsServer = https.createServer(options, app);
httpsServer.listen(3000, () => {
  console.log('listening on port ' + 3000);
});

const io = new Server(httpsServer);

// socket.io namespace for connecting server and client sockets
const connections = io.of('/mediasoup');

let worker: any;
let rooms: any = {}; // { roomName1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers: any = {}; // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports: any = []; // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers: any = []; // [ { socketId1, roomName1, producer, }, ... ]
let consumers: any = []; // [ { socketId1, roomName1, consumer, }, ... ]

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 3000,
  });

  console.log(`worker pid ${worker.pid}`);

  worker.on('died', (error: any) => {
    //something serious happened, so kill the application
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

//create a Worker as soon as our application starts
worker = createWorker();

connections.on('connection', async (socket) => {
  //The "connection" event is triggered whenever a client successfully connects to the /mediasoup namespace
  //after connection, new socket object is created for that specific client connection
  console.log(socket.id);

  socket.emit('connection-success', {
    socketId: socket.id,
  });

  socket.on('joinRoom', async ({ roomName }, callback) => {
    // const router1 = rooms[roomName] && rooms[roomName].get('data').router || await createRoom(roomName, socket.id)
    const router1 = await createRoom(roomName, socket.id);

    console.log('Joined room ' + roomName);
    peers[socket.id] = {
      socket,
      roomName, // name for the Router this Peer joined
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: '',
        isAdmin: false,
      },
    };

    const rtpCapabilities = router1.rtpCapabilities;

    // call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities });
  });

  const createRoom = async (roomName: string, socketId: string) => {
    // creates router for the roomName using worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - not supplying any
    // none of the two are required
    let router1;
    let peers = [];
    if (rooms[roomName]) {
      router1 = rooms[roomName].router;
      peers = rooms[roomName].peers || [];
    } else {
      router1 = await worker.createRouter({ mediaCodecs });
    }

    console.log(`Router ID: ${router1.id}`, peers.length);

    rooms[roomName] = {
      router: router1,
      peers: [...peers, socketId],
    };

    return router1;
  };

  // client emits a request to create server side Transport
  // need to differentiate between the producer and consumer transports
  socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
    //     // get room name from peer's props
    const roomName = peers[socket.id].roomName;
    const router = rooms[roomName].router;

    createWebRtcTransport(router).then(
      (transport: any) => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });
        // add transport to Peer's props
        addTransport(transport, roomName, consumer);
      },
      (error) => {
        console.log(error);
      }
    );
  });

  const addTransport = (transport: any, roomname: string, consumer: any) => {
    transports = [
      ...transports,
      { socketId: socket.id, transport, roomname, consumer },
    ];

    peers[socket.id] = {
      ...peers[socket.id],
      transports: [...peers[socket.id].transports, transport.id],
    };
  };

  const addProducer = (producer: any, roomName: any) => {
    producers = [...producers, { socketId: socket.id, producer, roomName }];

    peers[socket.id] = {
      ...peers[socket.id],
      producers: [...peers[socket.id].producers, producer.id],
    };
  };

  const addConsumer = (consumer: any, roomName: string) => {
    // add the consumer to the consumers list
    consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

    // add the consumer id to the peers list
    peers[socket.id] = {
      ...peers[socket.id],
      consumers: [...peers[socket.id].consumers, consumer.id],
    };
  };

  socket.on('getProducers', (callback) => {
    //return all producer transports
    const { roomName } = peers[socket.id];

    let producerList: any = [];

    producers.forEach((producerData: any) => {
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

  const informConsumers = (roomName: string, socketId: string, id: string) => {
    console.log(`just joined, id ${id} ${roomName}, ${socketId}`);
    // A new producer just joined
    // let all consumers to consume this producer
    producers.forEach((producerData: any) => {
      if (
        producerData.socketId !== socketId &&
        producerData.roomName === roomName
      ) {
        const producerSocket = peers[producerData.socketId].socket;
        // use socket to send producer id to producer
        producerSocket.emit('new-producer', { producerId: id });
      }
    });
  };

  const getTransport = (socketId: string) => {
    const [producerTransport] = transports.filter(
      (transport: any) => transport.socketId === socketId && !transport.consumer
    );
    return producerTransport.transport;
  };

  // see client's socket.emit('transport-connect', ...)
  socket.on('transport-connect', ({ dtlsParameters }) => {
    console.log('DTLS PARAMS... ', { dtlsParameters });

    getTransport(socket.id).connect({ dtlsParameters });
  });

  // see client's socket.emit('transport-produce', ...)
  socket.on(
    'transport-produce',
    async ({ kind, rtpParameters, appData }, callback) => {
      // call produce based on the prameters from the client
      const producer = await getTransport(socket.id).produce({
        kind,
        rtpParameters,
      });

      // add producer to the producers array
      const { roomName } = peers[socket.id];

      addProducer(producer, roomName);

      informConsumers(roomName, socket.id, producer.id);

      console.log('Producer ID: ', producer.id, producer.kind);

      producer.on('transportclose', () => {
        console.log('transport for this producer closed ');
        producer.close();
      });

      // Send back to the client the Producer's id
      callback({
        id: producer.id,
        producersExist: producers.length > 1 ? true : false,
      });
    }
  );

  socket.on(
    'transport-recv-connect',
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      console.log(`DTLS PARAMS: ${dtlsParameters}`);
      const consumerTransport = transports.find(
        (transportData:any) =>
          transportData.consumer &&
          transportData.transport.id == serverConsumerTransportId
      ).transport;
      await consumerTransport.connect({ dtlsParameters });
    }
  );

  socket.on(
    'consume',
    async (
      { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
      callback
    ) => {
      try {
        const { roomName } = peers[socket.id];
        const router = rooms[roomName].router;
        let consumerTransport = transports.find(
          (transportData:any) =>
            transportData.consumer &&
            transportData.transport.id == serverConsumerTransportId
        ).transport;

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

          consumer.on('transportclose', () => {
            console.log('transport close from consumer');
          });

          consumer.on('producerclose', () => {
            console.log('producer of consumer closed');
            socket.emit('producer-closed', { remoteProducerId });

            consumerTransport.close([]);
            transports = transports.filter(
              (transportData:any) =>
                transportData.transport.id !== consumerTransport.id
            );
            consumer.close();
            consumers = consumers.filter(
              (consumerData:any) => consumerData.consumer.id !== consumer.id
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
      } catch (error:any) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    }
  );

  socket.on('consumer-resume', async ({ serverConsumerId }) => {
    console.log('consumer resume');
    const { consumer } = consumers.find(
      (consumerData:any) => consumerData.consumer.id === serverConsumerId
    );
    await consumer.resume();
  });

  const removeItems = (items:any, socketId:string, type:string) => {
    items.forEach((item:any) => {
      if (item.socketId === socket.id) {
        item[type].close();
      }
    });
    items = items.filter((item:any) => item.socketId !== socket.id);

    return items;
  };

  socket.on('disconnect', () => {
    console.log('peer disconnected');

    if (peers[socket.id]) {
      const { roomName } = peers[socket.id];
      delete peers[socket.id];
      // remove socket from room
      rooms[roomName] = {
        router: rooms[roomName].router,
        peers: rooms[roomName].peers.filter(
          (socketId:any) => socketId !== socket.id
        ),
      };
    }

    consumers = removeItems(consumers, socket.id, 'consumer');
    producers = removeItems(producers, socket.id, 'producer');
    transports = removeItems(transports, socket.id, 'transport');
  });
});

const createWebRtcTransport = async (router:any) => {
  return new Promise(async (resolve, reject) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: '0.0.0.0', // replace with relevant IP address
            announcedIp: '192.168.56.1',
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

      transport.on('dtlsstatechange', (dtlsState:any) => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      });

      transport.on('close', () => {
        console.log('transport closed');
      });

      resolve(transport);
    } catch (error) {
      reject(error);
    }
  });
};
