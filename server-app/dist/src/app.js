"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const socket_io_1 = require("socket.io");
const mediasoup_1 = require("mediasoup");
const dotenv_1 = __importDefault(require("dotenv"));
const app = (0, express_1.default)();
dotenv_1.default.config();
app.use(express_1.default.static(path_1.default.join(__dirname, "../../client-app/dist/client-app/browser")));
app.get("/api/roomUsers", (req, res) => {
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
    }
    else {
        res.json(Object.values(allRooms));
    }
});
app.get("/", (req, res) => {
    res.sendFile(path_1.default.join(__dirname, "../client-app/dist/client-app/browser/index.html"));
});
const mediaCodecs = [
    { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: { "x-google-start-bitrate": 1000 },
    },
];
const httpServer = http_1.default.createServer(app);
httpServer.listen(process.env.PORT, () => {
    console.log("listening on port: " + process.env.PORT);
});
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: "http://localhost:4200",
    },
});
const connections = io.of("/mediasoup");
let worker = undefined;
let rooms = {};
let peers = {};
let transports = [];
let producers = [];
let consumers = [];
let _screenProducerTransports = {};
const creatMediasoupeWorker = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const worker = yield (0, mediasoup_1.createWorker)();
        console.log(`worker pid ${worker.pid}`);
        worker.on("died", (error) => {
            console.error("mediasoup worker has died");
            setTimeout(() => process.exit(1), 2000);
        });
        return worker;
    }
    catch (error) {
        console.error("Failed to create Mediasoup worker:", error);
    }
});
(() => __awaiter(void 0, void 0, void 0, function* () {
    worker = (yield creatMediasoupeWorker());
}))();
connections.on("connection", (socket) => __awaiter(void 0, void 0, void 0, function* () {
    //The "connection" event is triggered whenever a client successfully connects to the /mediasoup namespace
    //after connection, new socket object is created for that specific client connection
    console.log("connected to socket:", socket.id);
    socket.emit("connection-success", {
        socketId: socket.id,
    });
    socket.on("joinRoom", (_a, callback_1) => __awaiter(void 0, [_a, callback_1], void 0, function* ({ roomName }, callback) {
        // const router = rooms[roomName] && rooms[roomName].get('data').router || await ceateRoom(roomName, socket.id)
        const { router, isAdmin } = yield getOrCreateRoom(roomName, socket.id);
        console.log("Socket ", socket.id, " joined room " + roomName);
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
    }));
    const getOrCreateRoom = (roomName, socketId) => __awaiter(void 0, void 0, void 0, function* () {
        // creates router for the roomName using worker.createRouter(options)
        let router;
        let isAdmin = false;
        let peers = [];
        if (rooms[roomName]) {
            router = rooms[roomName].router;
            peers = rooms[roomName].peers || [];
        }
        else {
            router = yield worker.createRouter({ mediaCodecs });
            isAdmin = true; //if room is new, first user to create it will be an admin
        }
        // console.log(`Router ID: ${router.id}`, peers.length);
        rooms[roomName] = {
            router,
            peers: [...peers, socketId],
        };
        return { router, isAdmin };
    });
    // client emits a request to create server side Transport
    // need to differentiate between the producer and consumer transports
    socket.on("createWebRtcTransport", (_a, callback_1) => __awaiter(void 0, [_a, callback_1], void 0, function* ({ isConsumer, isScreenShare }, callback) {
        try {
            // get room name from peer's props
            const roomName = peers[socket.id].roomName;
            const router = rooms[roomName].router;
            const transport = yield createWebRtcTransport(router);
            // add transport to Peer's props
            addTransport(transport, roomName, isConsumer, isScreenShare);
            callback({
                params: {
                    id: transport === null || transport === void 0 ? void 0 : transport.id,
                    iceParameters: transport.iceParameters,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters,
                },
            });
        }
        catch (error) {
            console.error("Error creating WebRTC transport:", error);
        }
    }));
    const addTransport = (transport, roomname, isConsumer, isScreen) => {
        console.log("added transport:\ntransport id:", transport.id, 
        // '\niceParameters:', transport.iceParameters,
        // '\niceCandidates:', transport.iceCandidates,
        // '\ndtlsParameters:', transport.dtlsParameters,
        "isConsumer:", isConsumer, "isScreen:", isScreen);
        transports = [
            ...transports,
            { socketId: socket.id, transport, roomname, isConsumer, isScreen },
        ];
        // screenTransports = [
        //   ...screenTransports,
        //   { socketId: socket.id, transport, roomname, isConsumer },
        // ];
        peers[socket.id] = Object.assign(Object.assign({}, peers[socket.id]), { transports: [...peers[socket.id].transports, transport.id] });
    };
    const addProducer = (producer, roomName, mediaType) => {
        producers = [...producers, { socketId: socket.id, producer, roomName, mediaType }];
        peers[socket.id] = Object.assign(Object.assign({}, peers[socket.id]), { producers: [...peers[socket.id].producers, producer.id] });
    };
    const addConsumer = (consumer, roomName) => {
        // add the consumer to the consumers list
        consumers = [...consumers, { socketId: socket.id, consumer, roomName }];
        // add the consumer id to the peers list
        peers[socket.id] = Object.assign(Object.assign({}, peers[socket.id]), { consumers: [...peers[socket.id].consumers, consumer.id] });
    };
    socket.on("getProducers", (callback) => {
        //return all producer transports
        const { roomName } = peers[socket.id];
        let producerList = [];
        producers.forEach((producerData) => {
            //exclude clients, that are making the call
            if (producerData.socketId != socket.id && producerData.roomName == roomName) {
                producerList = [
                    ...producerList,
                    {
                        id: producerData.producer.id,
                        mediaType: producerData.mediaType,
                    },
                ];
            }
        });
        // return the producer list back to the client
        callback(producerList);
    });
    const informConsumers = (roomName, socketId, id, mediaType) => {
        console.log(`New ${mediaType} producer joined in room ${roomName}, socket ${socketId}:`, id);
        // A new producer just joined
        // let all consumers to consume this producer
        producers.forEach((producerData) => {
            if (producerData.socketId !== socketId &&
                producerData.roomName === roomName) {
                const producerSocket = peers[producerData.socketId].socket;
                // use socket to send producer id to producer
                producerSocket.emit("new-producer", { producerId: id, mediaType });
            }
        });
    };
    const getTransport = (socketId) => {
        const producerTransport = transports.find((transport) => transport.socketId === socketId &&
            !transport.isConsumer &&
            !transport.isScreen);
        return producerTransport === null || producerTransport === void 0 ? void 0 : producerTransport.transport;
    };
    const getScreenTransport = (socketId) => {
        const producerTransport = transports.find((transport) => transport.socketId === socketId &&
            !transport.isConsumer &&
            transport.isScreen);
        return producerTransport === null || producerTransport === void 0 ? void 0 : producerTransport.transport;
    };
    // see client's socket.emit('transport-connect', ...)
    socket.on("transport-connect", (_a) => __awaiter(void 0, [_a], void 0, function* ({ dtlsParameters, isScreen }) {
        try {
            let transport;
            if (isScreen) {
                transport = getScreenTransport(socket.id);
            }
            else {
                transport = getTransport(socket.id);
            }
            yield (transport === null || transport === void 0 ? void 0 : transport.connect({ dtlsParameters }));
        }
        catch (error) {
            console.error("Error connecting transport:", error);
        }
    }));
    // see client's socket.emit('transport-produce', ...)
    socket.on("transport-produce", (_a, callback_1) => __awaiter(void 0, [_a, callback_1], void 0, function* ({ kind, rtpParameters, isScreen }, callback) {
        // call produce based on the prameters from the client
        // const transport = getTransport(socket.id);
        let transport;
        if (isScreen) {
            transport = getScreenTransport(socket.id);
        }
        else {
            transport = getTransport(socket.id);
        }
        console.log("Returned transport with id:", transport === null || transport === void 0 ? void 0 : transport.id);
        const producer = yield transport.produce({ kind, rtpParameters });
        const roomName = peers[socket.id].roomName;
        console.log("Created Producer, ID: ", producer === null || producer === void 0 ? void 0 : producer.id, producer === null || producer === void 0 ? void 0 : producer.kind);
        if (isScreen && producer) {
            _screenProducerTransports[producer === null || producer === void 0 ? void 0 : producer.id] = {
                socketId: socket.id,
                transport: transport,
            };
        }
        addProducer(producer, roomName, isScreen ? "screen" : "camera");
        informConsumers(roomName, socket.id, producer.id, isScreen ? "screen" : "camera");
        // Send back to the client the Producer's id
        callback({
            id: producer.id,
            producersExist: producers.length > 1 ? true : false,
        });
    }));
    socket.on("consume", (_a, callback_1) => __awaiter(void 0, [_a, callback_1], void 0, function* ({ rtpCapabilities, remoteProducerId, serverConsumerTransportId, mediaType, }, callback) {
        try {
            const roomName = peers[socket.id].roomName;
            const router = rooms[roomName].router;
            let consumerTransport = transports.find((transportData) => transportData.isConsumer &&
                transportData.transport.id == serverConsumerTransportId &&
                transportData.isScreen == (mediaType == "screen")).transport;
            console.log("Consumer transport id: ", consumerTransport === null || consumerTransport === void 0 ? void 0 : consumerTransport.id);
            // check if the router can consume the specified producer
            if (router.canConsume({
                producerId: remoteProducerId,
                rtpCapabilities,
            })) {
                // transport can now consume and return a consumer
                const consumer = yield (consumerTransport === null || consumerTransport === void 0 ? void 0 : consumerTransport.consume({
                    producerId: remoteProducerId,
                    rtpCapabilities,
                    paused: true,
                }));
                consumer === null || consumer === void 0 ? void 0 : consumer.on("transportclose", () => {
                    console.log("transport close from consumer");
                });
                consumer === null || consumer === void 0 ? void 0 : consumer.on("producerclose", () => {
                    console.log("producer of consumer closed");
                    socket.emit("producer-closed", { remoteProducerId });
                    consumerTransport === null || consumerTransport === void 0 ? void 0 : consumerTransport.close();
                    transports = transports.filter((transportData) => transportData.transport.id !== (consumerTransport === null || consumerTransport === void 0 ? void 0 : consumerTransport.id));
                    consumer.close();
                    consumers = consumers.filter((consumerData) => consumerData.consumer.id !== consumer.id);
                });
                addConsumer(consumer, roomName);
                // from the consumer extract the following params
                // to send back to the Client
                const params = {
                    id: consumer === null || consumer === void 0 ? void 0 : consumer.id,
                    producerId: remoteProducerId,
                    kind: consumer === null || consumer === void 0 ? void 0 : consumer.kind,
                    rtpParameters: consumer === null || consumer === void 0 ? void 0 : consumer.rtpParameters,
                    serverConsumerId: consumer === null || consumer === void 0 ? void 0 : consumer.id,
                };
                // send the parameters to the client
                callback({ params });
            }
        }
        catch (error) {
            console.log(error.message);
            callback({
                params: {
                    error: error,
                },
            });
        }
    }));
    socket.on("consumer-resume", (_a) => __awaiter(void 0, [_a], void 0, function* ({ serverConsumerId }) {
        var _b;
        // console.log("consumer resume");
        try {
            const consumer = (_b = consumers.find((consumerData) => consumerData.consumer.id == serverConsumerId)) === null || _b === void 0 ? void 0 : _b.consumer;
            yield (consumer === null || consumer === void 0 ? void 0 : consumer.resume());
        }
        catch (error) {
            console.error("Error resuming consumer:", error);
        }
    }));
    socket.on("transport-recv-connect", (_a) => __awaiter(void 0, [_a], void 0, function* ({ dtlsParameters, serverConsumerTransportId, mediaType }) {
        var _b;
        console.log(`DTLS PARAMS: ${dtlsParameters}`);
        const consumerTransport = (_b = transports.find((transportData) => transportData.isConsumer &&
            transportData.transport.id == serverConsumerTransportId &&
            transportData.isScreen == (mediaType == "screen"))) === null || _b === void 0 ? void 0 : _b.transport;
        yield (consumerTransport === null || consumerTransport === void 0 ? void 0 : consumerTransport.connect({ dtlsParameters }));
    }));
    socket.on("sendMessage", ({ roomName, message }) => {
        if (!roomName || !peers[socket.id])
            return;
        const senderName = peers[socket.id].peerDetails.name || "Unknown";
        for (let peer of Object.values(peers)) {
            if (peer.roomName === roomName) {
                peer.socket.id != socket.id &&
                    peer.socket.emit("receiveMessage", {
                        sender: senderName,
                        message,
                        timestamp: new Date().toISOString(),
                    });
            }
        }
    });
    socket.on("stopScreenShare", ({ producerId }) => {
        const entry = _screenProducerTransports[producerId];
        if (!entry) {
            console.warn("No such screen producer:", producerId);
            return;
        }
        const { socketId: sharerSocketId, transport: screenTransport } = entry;
        // 2) Close and remove that Producer object
        producers = producers.filter((p) => {
            if (p.producer.id === producerId) {
                console.log("closed producer:", p.producer.id);
                p.producer.close();
                return false;
            }
            return true;
        });
        console.log("closed screen transport:", screenTransport === null || screenTransport === void 0 ? void 0 : screenTransport.id);
        // 3) Close and remove its send‐Transport
        screenTransport === null || screenTransport === void 0 ? void 0 : screenTransport.close();
        transports = transports.filter((t) => {
            // `t.transport` is the actual transport object you stored earlier
            if (t.transport.id === (screenTransport === null || screenTransport === void 0 ? void 0 : screenTransport.id)) {
                return false;
            }
            return true;
        });
        // 4) Close & remove any Consumer that is consuming this producerId
        // consumers = consumers.filter((c) => {
        //   if (c.consumer.producerId === producerId) {
        //     console.log("closed consumer:", c.consumer.id);
        //     c.consumer.close();
        //     return false;
        //   }
        //   return true;
        // });
        // 5) Clean up our lookup map
        delete _screenProducerTransports[producerId];
        // 6) Inform everyone else in the room that this screen share ended:
        const roomName = peers[sharerSocketId].roomName;
        socket.to(roomName).emit("screenShareStopped", { producerId });
    });
    socket.on("disconnect", () => {
        console.log("peer disconnected");
        if (peers[socket.id]) {
            const { roomName } = peers[socket.id];
            delete peers[socket.id];
            // remove socket from room
            rooms[roomName] = {
                router: rooms[roomName].router,
                peers: rooms[roomName].peers.filter((socketId) => socketId !== socket.id),
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
}));
const createWebRtcTransport = (router) => __awaiter(void 0, void 0, void 0, function* () {
    return new Promise((resolve, reject) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
            const webRtcTransport_options = {
                listenIps: [
                    {
                        ip: "0.0.0.0", // PRIVATE_IP_OF_INSTANCE : 172.31.37.220
                        announcedIp: "192.168.1.199", //PUBLIC_IP_OF_INSTANCE : 147.175.123.135 / 192.168.1.250
                    },
                ],
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
            };
            // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
            let transport = yield router.createWebRtcTransport(webRtcTransport_options);
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
        }
        catch (error) {
            reject(error);
        }
    }));
});
