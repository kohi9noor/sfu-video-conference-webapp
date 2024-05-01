function createPeer(socket_id, name) {
  const peer = {
    id: socket_id,
    name: name,
    transports: new Map(),
    consumers: new Map(),
    producers: new Map(),
  };

  const addTransport = (transport) => {
    peer.transports.set(transport.id, transport);
  };

  const connectTransport = async (transport_id, dtlsParameters) => {
    if (!peer.transports.has(transport_id)) return;

    await peer.transports.get(transport_id).connect({
      dtlsParameters: dtlsParameters,
    });
  };

  const createProducer = async (producerTransportId, rtpParameters, kind) => {
    let producer = await peer.transports.get(producerTransportId).produce({
      kind,
      rtpParameters,
    });

    peer.producers.set(producer.id, producer);

    producer.on(`transportclose`, () => {
      console.log(`producer transport close,`, {
        name: `${peer.name}`,
        consumer_id: `${producer.id}`,
      });
    });

    return producer;
  };

  const createconumer = async (
    consumer_transport_id,
    producer_id,
    rtpCapabilities
  ) => {
    let consumerTransport = peer.transports.get(consumer_transport_id);
    let consumer = null;

    try {
      consumer = await consumerTransport.consume({
        producerId: producer_id,
        rtpCapabilities,
        paused: false,
      });
    } catch (error) {
      console.log(`consume faeild`, error);
      return;
    }

    if (consumer.type === "simulcast") {
      await consumer.setPreferredLayers({
        spatialLayer: 2,
        temporalLayer: 2,
      });
    }

    peer.consumers.set(consumer.id, consumer);

    consumer.on("transportclose", () => {
      console.log(`consumer transport close`, {
        name: `${peer.name}`,
        consumer_id: `${consumer.id}`,
      });
    });

    return {
      consumer,
      params: {
        producerId: producer_id,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused,
      },
    };
  };

  const closeProducer = (producer_id) => {
    try {
      peer.producers.get(producer_id).close();
    } catch (error) {
      console.warn(error);
    }

    peer.producers.delete(producer_id);
  };

  const getProducer = (producer_id) => {
    return peer.producers.get(producer_id);
  };

  const close = () => {
    peer.transports.forEach((transport) => transport.close());
  };
  const removeConsumer = (consumer_id) => {
    peer.consumers.delete(consumer_id);
  };

  return {
    addTransport,
    connectTransport,
    createProducer,
    createconumer,
    closeProducer,
    getProducer,
    close,
    removeConsumer,
  };
}
