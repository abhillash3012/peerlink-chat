const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const configuredOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const io = new Server(server, {
  maxHttpBufferSize: 15 * 1024 * 1024,
  cors: {
    origin: (origin, callback) => {
      // Allow command-line/local health checks with no Origin header.
      if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by PeerLink CORS configuration."));
    },
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => res.json({ ok: true, app: "PeerLink" }));

function cleanText(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

io.on("connection", (socket) => {
  socket.data.username = "";
  socket.data.room = "";

  socket.on("join-room", ({ username, room }, callback) => {
    username = cleanText(username, 24);
    room = cleanText(room, 40).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!username || !room) {
      if (typeof callback === "function") callback({ ok: false, error: "Enter a username and room ID." });
      return;
    }

    if (socket.data.room) {
      socket.leave(socket.data.room);
      socket.to(socket.data.room).emit("system-message", {
        text: `${socket.data.username} left the room.`,
        at: new Date().toISOString()
      });
      emitRoomUsers(socket.data.room);
    }

    socket.data.username = username;
    socket.data.room = room;
    socket.join(room);

    socket.to(room).emit("system-message", {
      text: `${username} joined the room.`,
      at: new Date().toISOString()
    });
    emitRoomUsers(room);

    if (typeof callback === "function") {
      callback({ ok: true, username, room, socketId: socket.id });
    }
  });

  socket.on("chat-message", ({ text }, callback) => {
    const room = socket.data.room;
    const message = cleanText(text, 2000);
    if (!room || !message) {
      if (typeof callback === "function") callback({ ok: false, error: "Join a room and enter a message first." });
      return;
    }
    const payload = {
      id: `${socket.id}-${Date.now()}`,
      username: socket.data.username,
      text: message,
      at: new Date().toISOString(),
      ownSocketId: socket.id
    };
    io.to(room).emit("chat-message", payload);
    if (typeof callback === "function") callback({ ok: true });
  });

  socket.on("share-file", ({ name, type, size, data }, callback) => {
    const room = socket.data.room;
    if (!room) {
      if (typeof callback === "function") callback({ ok: false, error: "Join a room before sharing files." });
      return;
    }
    if (!name || typeof data !== "string" || data.length > 14 * 1024 * 1024) {
      if (typeof callback === "function") callback({ ok: false, error: "File is too large for this demo. Try a file smaller than 8 MB." });
      return;
    }
    const payload = {
      id: `${socket.id}-${Date.now()}`,
      username: socket.data.username,
      name: cleanText(name, 180),
      type: cleanText(type || "application/octet-stream", 100),
      size: Number(size) || 0,
      data,
      at: new Date().toISOString(),
      ownSocketId: socket.id
    };
    // Relay to everyone else in the same room. The sender gets a success event.
    socket.to(room).emit("shared-file", payload);
    socket.emit("file-sent", {
      id: payload.id, name: payload.name, size: payload.size,
      at: payload.at, username: payload.username
    });
    if (typeof callback === "function") callback({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    if (room) {
      socket.to(room).emit("system-message", {
        text: `${socket.data.username || "A user"} disconnected.`,
        at: new Date().toISOString()
      });
      emitRoomUsers(room);
    }
  });
});

function emitRoomUsers(room) {
  const sockets = io.sockets.adapter.rooms.get(room);
  const users = [];
  if (sockets) {
    for (const id of sockets) {
      const s = io.sockets.sockets.get(id);
      if (s) users.push({ id, username: s.data.username || "User" });
    }
  }
  io.to(room).emit("room-users", users);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PeerLink is running at http://localhost:${PORT}`);
  console.log("Open the same URL in two browser tabs and join the same room.");
});
