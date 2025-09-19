// import express from "express";
// import { getOrCreateRoom } from "../mediasoup/utils";
// import { sharedState } from "../server";
// const router = express.Router();


// router.post("/join-room", async (req, res) => {
//     try {
//         const { roomName, userName } = req.body;
//         const fakeSocketId = "http-" + Math.random().toString(36).slice(2);
//         const state = sharedState;
//         const { router, isAdmin } = await getOrCreateRoom(state, roomName, fakeSocketId);

//         res.json({
//             socketId: fakeSocketId,
//             routerRtpCapabilities: router.rtpCapabilities,
//             isAdmin,
//         });
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ error: "Failed to join room" });
//     }
// });

// export default router;
