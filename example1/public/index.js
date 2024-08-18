const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");

const socket = io("/mediasoup");

socket.on("connection-success", ({ socketId }) => {
  console.log(socketId);
});
const params = {
  // mediasoup params
};
let rtpCapabilities;
let device;

const streamSuccess = async (stream) => {
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track,
    ...params,
  };
};

const getLocalStream = () => {
  navigator.getUserMedia(
    {
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        },
      },
    },
    streamSuccess,
    (error) => {
      console.log(error.message);
    }
  );
};

// A device is an endpoint connecting to a Router on the
// server side to send/recive media
const createDevice = async () => {
  try {
    device = new mediasoupClient.Device();

    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
    // Loads the device with RTP capabilities of the Router (server side)
    await device.load({
      // see getRtpCapabilities() below
      routerRtpCapabilities: rtpCapabilities,
    });

    console.log("RTP Capabilities", device.rtpCapabilities);
  } catch (error) {
    console.log(error);
    if (error.name === "UnsupportedError")
      console.warn("browser not supported");
  }
};

getRtpCapabilities = () => {
  socket.emit("getRtpCapabilities", (data) => {
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);

    // we assign to local variable and will be used when
    // loading the client Device (see createDevice above)
    rtpCapabilities = data.rtpCapabilities;
  });
};
btnLocalVideo.addEventListener("click", getLocalStream());
btnRtpCapabilities.addEventListener("click", getRtpCapabilities);
btnDevice.addEventListener('click', createDevice)
