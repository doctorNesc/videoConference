const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");

const socket = io("/mediasoup");

socket.on("connection-success", ({ socketId }) => {
  console.log(socketId);
});

const streamSuccess = async (stream) => {
    localVideo.srcObject = stream
    const track = stream.getVideoTracks()[0]
    params = {
      track,
      ...params
    }
  }
  
const getLocalStream = () => {
    navigator.getUserMedia({
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        }
      }
    }, streamSuccess, error => {
      console.log(error.message)
    })
  }
  
btnLocalVideo.addEventListener("click", getLocalStream());
