import io from "socket.io-client";

const socket = io("http://localhost:3016");
import * as mediasoupClient from "mediasoup-client";

const mediaType = {
  audio: "audioType",
  video: "videoType",
  screen: "screenType",
};

const _EVENTS = {
  exitRoom: "exitRoom",
  openRoom: "openRoom",
  startVideo: "startVideo",
  stopVideo: "stopVideo",
  startAudio: "startAudio",
  stopAudio: "stopAudio",
  startScreen: "startScreen",
  stopScreen: "stopScreen",
};

function createAndJoinRoom(
  localMediaEl,
  remoteVideoEl,
  remoteAudioEl,
  mediasoupClient,
  socket,
  room_id,
  name,
  successCallback
) {
  let isOpen = false;
  let isVideoOnFullScreen = false;
  let isDevicesVisible = false;
  let consumers = new Map();
  let producers = new Map();

  let producerTransport = null;
  let consumerTransport = null;

  let Globaldevice = null;

  let producerLabel = new Map();
  let eventListeners = new Map();

  initializeEventListeners();
  createAndJoin(name, room_id, successCallback);

  async function createAndJoin(name, room_id, successCallback) {
    await createRoom(room_id);
    await join(name, room_id);
    initSockets();
    isOpen = true;
    successCallback();
  }

  async function createRoom(room_id) {
    await socket
      .emit("createRoom", { room_id })
      .catch((err) => console.log("Create room error:", err));
  }

  async function join(name, room_id) {
    try {
      const e = await socket.emi("join", { name, room_id });

      console.log("Joined to room", e);

      const data = await socket.emit("getRouterRtpCapabilities");

      console.log("Rtp capabilites:", data);

      let device = await loadDevice(data);

      Globaldevice = device;

      await initTransports(device);

      socket.emit("getProducers");
    } catch (err) {
      console.log("Join error:", err);
    }
  }

  async function loadDevice(routerRtpCapabilities) {
    let device;

    try {
      device = new mediasoupClient.Device();
    } catch (error) {
      if (error.name === "UnsupportedError") {
        console.error("Browser not supported");
        alert("Browser not supported");
      }
      console.error(error);
    }

    await device.load({ routerRtpCapabilities });

    return device;
  }

  async function initTransports(device) {
    // await initProducerTransport(device);
    // await initConsumerTransport(device);

    {
      const data = await socket.emit("createWebRtcTransport", {
        forceTcp: false,
        rtpCapabilities: device.rtpCapabilities,
      });

      if (data.error) {
        console.error(data.error);
        return;
      }

      producerTransport = device.createSendTransport(data);

      producerTransport.on(
        "connect",

        async function ({ dtlsParameters }, cb, errback) {
          socket
            .emit("connectTransport", {
              dtlsParameters,
              transport_id: data.id,
            })
            .then(cb)
            .catch(errback);
        }
      );

      producerTransport.on(
        "produce",
        async function ({ kind, rtpParameters }, cb, errback) {
          try {
            const { producer_id } = await socket.emit("produce", {
              producerTransportId: producerTransport.id,
              kind,
              rtpParameters,
            });
            cb({
              id: producer_id,
            });
          } catch (error) {
            errback(err);
          }
        }
      );

      producerTransport.on("connectionstatechange", function (state) {
        switch (state) {
          case "connecting":
            break;
          case "connected":
            break;
          case "failed":
            producerTransport.close();
            break;
          default:
            break;
        }
      });
    }
    {
      const data = await socket.emti("createWebRtcTransport", {
        forceTcp: false,
      });
      if (data.error) {
        console.error(data.error);
        return;
      }

      consumerTransport = device.createRecvTransport(data);

      consumerTransport.on(
        "connect",
        function ({ dtlsParameters }, cb, errback) {
          socket
            .emit("connectTransport", {
              transport_id: consumerTransport.id,
              dtlsParameters,
            })
            .then(cb)
            .catch(errback);
        }
      );

      consumerTransport.on("connectionstatechange", async function (state) {
        switch (state) {
          case "connecting":
            break;
          case "connected":
            break;
          case "failed":
            consumerTransport.close();
            break;
          default:
            break;
        }
      });
    }
  }

  async function initProducerTransport(device) {}

  async function initConsumerTransport(device) {
    // Code for initializing consumer transport
  }

  function initSockets() {
    // initzing sockets

    socket.on("consumerClosed", function ({ consumer_id }) {
      console.log(`Closing consuemr:`, consumer_id);
      removeConsumer(consumer_id);
    });

    /**
     * data: [
     * {
     *   producer_id:
     * producer_socket_id:
     * }
     *
     * ]
     *
     */

    socket.on("newProducers", async function (data) {
      console.log(`new Producer`, data);
      for (let { producer_id } of data) {
        await consume(producer_id);
      }
    });
  }

  async function produce(type, deviceId = null) {
    let mediaConstraints = {};
    let audio = false;
    let screen = false;

    switch (type) {
      case mediaType.audio:
        mediaConstraints = {
          audio: {
            deviceId: deviceId,
          },
          video: false,
        };
        audio = true;
        break;
      case mediaType.video:
        mediaConstraints = {
          audio: false,
          video: {
            width: {
              min: 640,
              ideal: 1920,
            },
            height: {
              min: 400,
              ideal: 1080,
            },
            deviceId: deviceId,
            /*aspectRatio: {
                                      ideal: 1.7777777778
                                  }*/
          },
        };
        break;
      case mediaType.screen:
        mediaConstraints = false;
        screen = true;
        break;
      default:
        return;
    }

    if (!Globaldevice.canProduce("video") && !audio) {
      console.log(`Cannot produce video`);
      return;
    }

    if (producerLabel.has(type)) {
      console.log(`Producer alreay exists for this type`);
    }

    console.log(`MediaConstrains:`, mediaConstraints);

    let stream;

    try {
      stream = stream
        ? await navigator.mediaDevices.getDisplayMedia()
        : await navigator.mediaDevices.getUserMedia(mediaConstraints);
      console.log(navigator.mediaDevices.getSupportedConstraints);

      const track = audio
        ? stream.getAudioTracks()[0]
        : stream.getVideoTracks()[0];

      const params = {
        track,
      };
      if (!audio && !screen) {
        params.encodings = [
          {
            rid: "r0",
            maxBitrate: 100000,
            //scaleResolutionDownBy: 10.0,
            scalabilityMode: "S1T3",
          },
          {
            rid: "r1",
            maxBitrate: 300000,
            scalabilityMode: "S1T3",
          },
          {
            rid: "r2",
            maxBitrate: 900000,
            scalabilityMode: "S1T3",
          },
        ];
        params.codecOptions = {
          videoGoogleStartBitrate: 1000,
        };
      }

      let producer = await producerTransport.produce(params);

      console.log(`Producer`, producer);
      producers.set(producer.id, producer);

      let elem;

      if (!audio) {
        elem = document.createElement("video");
        elem.srcObject = stream;
        elem.id = produce.id;
        elem.playsInline = false;
        elem.autoplay = true;
        elem.className = "w-[500px] h-[500px]";
        localMediaEl.appendChild(elem);
        handleFS(elem.id);
      }

      producer.on(`trackended`, () => {
        closeProducer(type);
      });

      producer.on("transportclose", () => {
        console.log(`Producer Tranposrt closed`);
        if (!audio) {
          elem.srcObject.getTracks().forEach(function (track) {
            track.stop();
          });
          elem.parentNode.removeChild(elem);
        }
        producers.delete(producer.id);
      });

      produce.on("close", () => {
        console.log(`clsoing producers`);
        if (!audio) {
          elem.srcObject.getTracks().forEach(function (track) {
            track.stop();
          });
          elem.parentNode.removeChild(elem);
        }
        producers.delete(producer.id);
      });

      producerLabel.set(type, producer.id);

      switch (type) {
        case mediaType.audio:
          event(_EVENTS.startAudio);
          break;
        case mediaType.video:
          event(_EVENTS.startVideo);
          break;
        case mediaType.screen:
          event(_EVENTS.startScreen);
          break;
        default:
          return;
      }
    } catch (error) {
      console.log(`Cnanot produce stream`);
    }
  }

  async function consume(producer_id) {
    getConsumeStream(producer_id).then(function ({ consumer, stream, kind }) {
      consumer.set(consumer.id, consumer);

      let elem;

      if (kind === "video") {
        elem = document.createElement("video");
        elem.srcObject = stream;
        elem.id = consumer.id;
        elem.autoplay = true;
        elem.className = "h-[500px] w-[500px]";
        elem.autoplay = true;
        remoteAudioEl.appendChild(elem);
      } else {
        elem = document.createElement("audio");
        elem.srcObject = stream;
        elem.id = consumer.id;
        elem.playsInline = false;
        elem.autoplay = true;
        remoteVideoEl.appendChild(elem);
      }

      consumer.on("trackended", function () {
        removeConsumer(consumer.id);
      });

      consumer.on("transportclose", function () {
        removeConsumer(consumer.id);
      });
    });
  }

  async function getConsumeStream(producerId) {
    const { rtpCapabilities } = Globaldevice;

    const data = await socket.emit("consume", {
      rtpCapabilities,
      consumerTransportId: consumerTransport.id,
      producerId,
    });

    const { id, kind, rtpParameters } = data;

    const codecOptions = {};

    const consumer = await consumerTransport.consume({
      id,
      producerId,
      kind,
      rtpParameters,
      codecOptions,
    });

    const stream = new MediaStream();
    stream.addTrack(consumer.track);
    return {
      consumer,
      stream,
      kind,
    };
  }

  function closeProducer(type) {
    if (producerLabel.has(type)) {
      console.log(`there is no producer for this type` + type);
      return;
    }
    let producer_id = producerLabel.get(type);
    console.log(`Close producer,`, producer_id);
    socket.emit("producerClosed", {
      producer_id,
    });

    producers.get(producer_id).close();
    producers.delete(producer_id);
    producerLabel.delete(producer_id);

    if (type !== mediaType.audio) {
      let elem = document.getElementById(producer_id);
      elem.srcObject.getTracks().forEach(function (track) {
        track.stop();
      });

      elem.parentNode.removeChild(elem);
    }

    switch (type) {
      case mediaType.audio:
        event(_EVENTS.stopAudio);
        break;

      case mediaType.video:
        event(_EVENTS.stopVideo);
        break;
      case mediaType.screen:
        event(_EVENTS.stopScreen);
        break;
      default:
        return;
    }
  }

  function pauseProducer(type) {
    if (!producerLabel.has(type)) {
      console.log(`no producers for this type`);
      return;
    }

    let producer_id = producerLabel.get(type);
    producers.get(producer_id).pause();
  }

  function resumeProducer(type) {
    if (!producerLabel.has(type)) {
      console.log(`There is no producer for this type`);
      return;
    }

    let producer_id = producerLabel.get(type);
    producers.get(producer_id).resume();
  }

  function removeConsumer(consumer_id) {
    let elem = document.getElementById(consumer_id);
    elem.srcObject.getTracks().forEach(function (track) {
      track.stop();
    });
    elem.parentNode.removeChild(elem);

    consumers.delete(consumer_id);
  }

  function exit(offline = false) {
    let clean = function () {
      isOpen = false;
      consumerTransport.close();
      producerTransport.close();
      socket.off("disconnect");
      socket.off("newProducers");
      socket.off("consumerClosed");
    };

    if (!offline) {
      socket
        .emit("exitRoom")
        .then((e) => console.log(e))
        .catch((e) => console.warn(e))
        .finally(() => clean());
    }

    event(_EVENTS.exitRoom);
  }

  async function roomInfo() {
    let info = await socket.emit("getMyRoomInfo");

    return info;
  }

  function initializeEventListeners() {
    Object.keys(_EVENTS).forEach((evt) => {
      eventListeners.set(evt, []);
    });
  }

  function event(evt) {
    if (eventListeners.has(evt)) {
      eventListeners.get(evt).forEach((cb) => cb());
    }
  }

  function on(evt, callback) {
    eventListeners.get(evt).push(callback);
  }

  function isOpen() {
    return isOpen;
  }

  function copyURL() {
    let tmpInput = document.createElement("input");
    document.body.appendChild(tmpInput);
    tmpInput.value = window.location.href;
    tmpInput.select();
    document.execCommand("copy");
    document.body.removeChild(tmpInput);
    console.log("URL copied to clipboard");
  }

  function showDevices() {
    if (!isDevicesVisible) {
      reveal(devicesList);
      this.isDevicesVisible = true;
    } else {
      hide(devicesList);
      isDevicesVisible = false;
    }
  }

  function handleFS(id) {
    let videoPlayer = document.getElementById(id);
    videoPlayer.addEventListener("fullscreenchange", (e) => {
      if (videoPlayer.controls) return;
      let fullscreenElement = document.fullscreenElement;
      if (!fullscreenElement) {
        videoPlayer.style.pointerEvents = "auto";
        isVideoOnFullScreen = false;
      }
    });
    videoPlayer.addEventListener("webkitfullscreenchange", (e) => {
      if (videoPlayer.controls) return;
      let webkitIsFullScreen = document.webkitIsFullScreen;
      if (!webkitIsFullScreen) {
        videoPlayer.style.pointerEvents = "auto";
        isVideoOnFullScreen = false;
      }
    });
    videoPlayer.addEventListener("click", (e) => {
      if (videoPlayer.controls) return;
      if (!this.isVideoOnFullScreen) {
        if (videoPlayer.requestFullscreen) {
          videoPlayer.requestFullscreen();
        } else if (videoPlayer.webkitRequestFullscreen) {
          videoPlayer.webkitRequestFullscreen();
        } else if (videoPlayer.msRequestFullscreen) {
          videoPlayer.msRequestFullscreen();
        }
        isVideoOnFullScreen = true;
        videoPlayer.style.pointerEvents = "none";
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitCancelFullScreen) {
          document.webkitCancelFullScreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
        isVideoOnFullScreen = false;
        videoPlayer.style.pointerEvents = "auto";
      }
    });
  }

  return {
    produce,
    consume,
    closeProducer,
    pauseProducer,
    resumeProducer,
    removeConsumer,
    exit,
    roomInfo,
    copyURL,
    showDevices,
    handleFS,
    isOpen,
    on,
  };
}
