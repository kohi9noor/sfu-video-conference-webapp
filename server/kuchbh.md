// import io from "socket.io-client";
// import { Device } from "mediasoup-client";
import { kucbhi } from "./counter";
// const socket = io("http:localhost:3000");

// const device = new Device();

console.log(kucbhi);

// console.log(device);

document.getElementById("createRoomBtn").addEventListener("click", () => {
roomId = generateRoomId();
console.log(roomId);
joinRoom(roomId);
});

document.getElementById("joinRoomBtn").addEventListener("click", () => {
roomId = document.getElementById("roomIdInput").value.trim();
if (roomId) {
joinRoom(roomId);
} else {
alert("Please enter a room ID.");
}
});

function generateRoomId() {
return Math.random().toString(36).substr(2, 8);
}

async function joinRoom(roomId) {
socket.emit("joinRoom", roomId);

document.getElementById("roomSetup").style.display = "none";

document.getElementById("shareAudioBtn").style.display = "block";

const transport = await createTransport(roomId);
producer = await createProducer(transport);
}

async function createTransport(roomId) {
const { data: transportOptions } = await socket.emit(
"createTransport",
roomId
);

const transport = await device.createSendTransport(transportOptions);

await transport.connect({
dtlsParameters: transportOptions.dtlsParameters,
iceCandidates: transportOptions.iceCandidates,
iceParameters: transportOptions.iceParameters,
});

return transport;
}

async function createProducer(transport) {
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const audioTrack = stream.getAudioTracks()[0];
const producer = await transport.produce({ track: audioTrack });
return producer;
}

document.getElementById("shareAudioBtn").addEventListener("click", async () => {
if (!producer) return;
producer.resume();
});

socket.on("newParticipant", (participantId) => {
console.log("new participants joined");
});

socket.on("disconnect", () => {
console.log("Disconnected from server");
});

<!-- index.html -->
