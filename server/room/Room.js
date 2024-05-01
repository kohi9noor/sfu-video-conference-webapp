const config = require("../config/config");

// create room obejct with methods

function createRoom(room_id, worker, io) {
  const room = {
    id: room_id,
    router: null,
    peers: new Map(),
  };

  // create router it to the room obejct when ready

  const mediaCodecs = config.mediasoup.router.mediaCodecs;

  worker.createRouter({ mediaCodecs }).then((router) => {
    room.router = router;
  });

  // function to add user (peer) to the room

  const addPeer = (peer) => {
    room.peers.set(peer.id, peer);
  };

  const getProducerListForPeer = () => {
    let producerList = [];

    room.peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        producerList.push({ producer_id: producer.id });
      });
    });
    return producerList;
  };

  // Get RTP capabilities of the router

  const getRTpCapabilites = () => {
    return room.router.rtpCapabilities;
  };

  const createWebRTCTransport = async (socket_id) => {
    const { maxIncomingBitrate, initialAvailableOutgoingBitrate } =
      config.mediasoup.webRtcTransport;

    const transport = await room.router.createWebRtcTransport({
      listenIps: config.mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    if (maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(maxIncomingBitrate);
      } catch (error) {}
    }

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        console.log(`Transport lcose, `, {
          name: room.peers.get(socket_id).name,
        });
        transport.close();
      }
    });

    transport.on("close", () => {
      console.log(`Transport clsoed`, {
        name: room.peers.get(socket_id).name,
      });
    });

    console.log(`ading transport`, {
      transportId: transport.id,
    });

    room.peers.get(socket_id).addTransport(transport);
    return {
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  };

  // connect a user (peer) transport;

  const connectPeertransport = async (
    socket_id,
    transport_id,
    dtlsParameters
  ) => {
    if (!room.peers.has(socket_id)) return;
    await room.peers
      .get(socket_id)
      .connectTransport(transport_id, dtlsParameters);
  };

  // produce media

  const produce = async (
    socket_id,
    producerTransportId,
    rtpParameters,
    kind
  ) => {
    return new Promise(async (resolve, reject) => {
      let producer = await room.peers
        .get(socket_id)
        .createProducer(producerTransportId, rtpParameters, kind);
      resolve(producer.id);
      broadCast(socket_id, "newProducers", [
        { producer_id: producer.id, producer_socket_id: socket_id },
      ]);
    });
  };

  // consume media

  const consume = async (
    socket_id,
    consumer_transport_id,
    producer_id,
    rtpCapabilities
  ) => {
    if (!room.router.canConsume({ producerId: producer_id, rtpCapabilities })) {
      console.error("can not consume");
      return;
    }
    let { consumer, params } = await room.peers
      .get(socket_id)
      .createConsumer(consumer_transport_id, producer_id, rtpCapabilities);

    consumer.on("producerclose", () => {
      console.log("Consumer closed due to producerclose event", {
        name: `${room.peers.get(socket_id).name}`,
        consumer_id: `${consumer.id}`,
      });
      room.peers.get(socket_id).removeConsumer(consumer.id);
      room.io
        .to(socket_id)
        .emit("consumerClosed", { consumer_id: consumer.id });
    });

    return params;
  };

  // remove to peer from the room

  const removePeer = (socket_id) => {
    room.peers.get(socket_id).close();
    room.peers.delete(socket_id);
  };

  const closeProducer = (socket_id, producer_id) => {
    room.peers.get(socket_id).closeProducer(producer_id);
  };

  const broadCast = (socket_id, name, data) => {
    for (let otherID of Array.from(room.peers.keys()).filter(
      (id) => id !== socket_id
    )) {
      send(otherID, name, data);
    }
  };

  // send the message spcific user (peer);

  const send = (socket_id, name, data) => {
    room.io.to(socket_id).emit(name, data);
  };

  const getPeers = () => {
    return room.peers;
  };

  const toJson = () => {
    return {
      id: room.id,
      peers: JSON.stringify([...room.peers]),
    };
  };

  return {
    addPeer,
    getProducerListForPeer,
    getRTpCapabilites,
    createWebRTCTransport,
    connectPeertransport,
    produce,
    removePeer,
    consume,
    closeProducer,
    send,
    broadCast,
    getPeers,
    toJson,
  };
}

module.exports = createRoom;
