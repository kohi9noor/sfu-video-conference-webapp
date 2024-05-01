const express = require("express");
const fs = require("fs");
const mediasoup = require("mediasoup");
const config = require("./config/config");
const Room = require("./room/Room");
const http = require("http");
const { Server } = require("socket.io");
const Peer = require("./room/Peer");

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

server.listen(config.listenPort, () => {
  console.log(`Running on http://localhost:${config.listenPort}`);
});

let workers = [];

let nextMediasoupWorkerIdx = 0;

let roomList = new Map();

async function createWorker() {
  const { numWorkers } = config.mediasoup;

  for (let i = 0; i < numWorkers; i++) {
    let worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel,
      logTags: config.mediasoup.worker.logTags,
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });
    worker.on("died", () => {
      console.error(
        `Mediasoup worker died exiting in 2 seconds.. ${worker.pid}`
      );
      setTimeout(() => process.exit(1), 2000);
    });

    worker.push(worker);
  }
}

function getMediasoupWorker() {
  const worker = workers[nextMediasoupWorkerIdx];
  if (++nextMediasoupWorkerIdx === worker.length) nextMediasoupWorkerIdx = 0;
  return worker;
}

io.on("connection", (socket) => {
  // creating a new room

  socket.on(`createRoom`, async ({ room_id }, callback) => {
    if (roomList.has(room_id)) {
      callback("alreadu exists");
    } else {
      console.log(`Created room,`, { room_id: room_id });
      let worker = await getMediasoupWorker();
      roomList.set(room_id, Room(room_id, worker, io));
    }
  });

  socket.on(`join`, ({ room_id, name }, cb) => {
    console.log(`user joined`, { room_id: room_id, name: name });
    if (!roomList.has(room_id)) {
      return cb({ error: "Room dose not exits" });
    }
    roomList.get(room_id).addPeer(Peer(socket.id, name));
    socket.room_id = room_id;
    cb(roomList.get(room_id).toJson());
  });

  socket.on(`getproducers`, () => {
    if (!roomList.has(socket.room_id)) return;

    console.log(`Get producers`, {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
    });

    // sending all the current producers to newly joined members;

    let producerList = roomList.get(socket.room_id).getProducerListForPeer();

    socket.emit(`emitProducers`, producerList);
  });

  socket.on("getRouterRtpCapabilities", (_, callback) => {
    console.log("Get RouterRtpCapabilities", {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
    });

    try {
      callback(roomList.get(socket.room_id).getRtpCapabilities());
    } catch (e) {
      callback({
        error: e.message,
      });
    }
  });

  socket.on(`createWebRtcTransport`, async (_, callback) => {
    console.log(`create webrtc transport`);

    try {
      const { params } = await roomList
        .get(socket.room_id)
        .createWebRtcTransport(socket.id);

      callback(params);
    } catch (error) {
      console.warn(error);
      callback({
        error: error.message,
      });
    }
  });

  socket.on(
    "connectTransport",
    async ({ transport_id, dtlsParameters }, callback) => {
      console.log(`connching transport,`, {
        name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
      });

      if (!roomList.has(socket.room_id)) return;

      await roomList
        .get(socket.room_id)
        .connectPeerTransport(socket.id, transport_id, dtlsParameters);

      callback(`done`);
    }
  );

  socket.on(
    `produce`,
    async ({ kind, rtpParameters, producerTransportId }, callback) => {
      if (!roomList.has(socket.room_id)) {
        return callback({ error: "not is a room" });
      }

      let producer_id = await roomList
        .get(socket.room_id)
        .produce(socket.id, producerTransportId, rtpParameters, kind);
      console.log(`produce`, {
        type: `${kind}`,
        name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
        id: `${producer_id}`,
      });

      callback({
        producer_id,
      });
    }
  );

  socket.on(
    `consume`,
    async ({ consumerTransportId, producerId, rtpCapabilities }, callback) => {
      let params = await roomList
        .get(socket.room_id)
        .consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

      console.log(`consming`),
        {
          name: `${
            roomList.get(socket.room_id) &&
            roomList.get(socket.room_id).getPeers().get(socket.id).name
          }`,
          producer_id: `${producerId}`,
          consumer_id: `${params.id}`,
        };

      callback(params);
    }
  );

  socket.on(`resume`, async (data, callback) => {
    await consumers.resume();
    callback();
  });

  socket.on(`getMyRoomInfo`, (_, callback) => {
    callback(roomList.get(socket.room_id).toJson());
  });

  socket.on("disconnect", () => {
    console.log(`Disconnect`, {
      name: `${
        roomList.get(socket.room_id) &&
        roomList.get(socket.room_id).getPeers().get(socket.id).name
      }`,
    });
    if (!socket.room_id) return;
    roomList.get(socket.room_id).removePeer(socket.id);
  });

  socket.on(`producerClosed`, ({ producer_id }) => {
    console.log(`Producer close`, {
      name: `${
        roomList.get(socket.room_id) &&
        roomList.get(socket.room_id).getPeers().get(socket.id).name
      }`,
    });

    roomList.get(socket.room_id).closeProducer(socket.id, producer_id);
  });

  socket.on("exitRoom", async (_, callback) => {
    console.log(`exit room`, {
      name: `${
        roomList.get(socket.room_id) &&
        roomList.get(socket.room_id).getPeers().get(socket.id).name
      }`,
    });

    if (!roomList.has(socket.room_id)) {
      callback({
        error: " not currently in a room",
      });
      return;
    }

    // close transport

    await roomList.get(socket.room_id).removePeer(socket.id);
    if (roomList.get(socket.room_id).getPeers().size === 0) {
      roomList.delete(socket.room_id);
    }
    socket.room_id = null;
    callback("successfully exited room");
  });
});
