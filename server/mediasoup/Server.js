const mediasoup = require("mediasoup");

const config = require("../config/config");
// const { DtlsState } = require("mediasoup/node/lib/fbs/web-rtc-transport.js");

let worker;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });

  console.log("worker pid", worker.pid);
  console.log(worker);
  worker.on("died", (err) => {
    console.log(`mediasoup worker process died`);
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });

  return worker;
};

const createWebRTCTransport = async (router, callback) => {
  try {
    let transport = await router.createWebRtcTransport(config.transport);
    console.log(`Transport id: `, transport.id);

    transport.on(`dtlsstatechange`, (dtlsState) => {
      if (dtlsState === "closed") {
        console.log(`Transport closed`);
        transport.close();
      }
    });

    transport.on("close", () => {
      console.log("transport closed");
    });

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });

    return transport;
  } catch (error) {
    console.log(`Failed to createWEBTCTransport`, error);
    callback({
      params: {
        params: {
          error: error,
        },
      },
    });
  }
};

module.exports = {
  createWorker,
  createWebRTCTransport,
};
