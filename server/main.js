const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// Initialize Mediasoup Worker
const worker = await mediasoup.createWorker();

// Configure Mediasoup Router
const router = await worker.createRouter({
  mediaCodecs: [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
  ],
});

// Map of rooms and their associated transports
const rooms = new Map();

// Listen for Socket.io connections
io.on("connection", (socket) => {
  console.log(`User ${socket.id} connected`);

  // Handle client disconnection
  socket.on("disconnect", () => {
    console.log(`User ${socket.id} disconnected`);
    for (const [roomId, room] of rooms) {
      if (room.transports.has(socket.id)) {
        room.transports.get(socket.id).close();
        room.transports.delete(socket.id);
        console.log(`User ${socket.id} left room ${roomId}`);
        break;
      }
    }
  });

  // Handle client requests to join a room
  socket.on("joinRoom", async (roomId) => {
    try {
      // Create Mediasoup Transport for client
      const transport = await router.createPlainTransport();

      // Send client the transport parameters
      socket.emit("transportParameters", {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });

      // Store the transport associated with the client
      if (!rooms.has(roomId)) {
        rooms.set(roomId, { transports: new Map() });
      }
      rooms.get(roomId).transports.set(socket.id, transport);
      console.log(`User ${socket.id} joined room ${roomId}`);
    } catch (error) {
      console.error("Failed to create transport:", error);
    }
  });

  // Handle client requests to produce audio
  socket.on("produceAudio", async ({ roomId, kind, rtpParameters }) => {
    try {
      // Get room and associated transport
      const room = rooms.get(roomId);
      const transport = room.transports.get(socket.id);

      // Create audio producer
      const producer = await transport.produce({ kind, rtpParameters });

      // Broadcast audio to all clients in the room
      socket.broadcast.to(roomId).emit("newProducer", {
        producerId: producer.id,
        producerKind: producer.kind,
      });
    } catch (error) {
      console.error("Failed to produce audio:", error);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
