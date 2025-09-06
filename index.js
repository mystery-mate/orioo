const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

let chatQueue = [];
let videoQueue = [];
let pairs = new Map(); // ws -> partner

// Pair two clients and tell who is initiator
function pairClients(a, b, mode) {
  pairs.set(a, b);
  pairs.set(b, a);

  // decide initiator deterministically (e.g., a will be initiator)
  // you could randomize or alternate if you prefer
  a.send(JSON.stringify({ type: "paired", initiator: true }));
  b.send(JSON.stringify({ type: "paired", initiator: false }));
}

wss.on("connection", (ws) => {
  // heartbeat
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === "join") {
      ws.mode = msg.mode;
      if (ws.mode === "chat") {
        if (chatQueue.length > 0) {
          const partner = chatQueue.shift();
          pairClients(ws, partner, "chat");
        } else {
          chatQueue.push(ws);
          ws.send(JSON.stringify({ type: "waiting" }));
        }
      } else if (ws.mode === "video") {
        if (videoQueue.length > 0) {
          const partner = videoQueue.shift();
          pairClients(ws, partner, "video");
        } else {
          videoQueue.push(ws);
          ws.send(JSON.stringify({ type: "waiting" }));
        }
      }
    }

    if (msg.type === "chat") {
      const partner = pairs.get(ws);
      if (partner && partner.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify({ type: "chat", text: msg.text }));
      }
    }

    if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
      const partner = pairs.get(ws);
      if (partner && partner.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify(msg));
      }
    }

    if (msg.type === "leave") {
      const partner = pairs.get(ws);
      if (partner) {
        pairs.delete(ws);
        pairs.delete(partner);
        if (partner.readyState === WebSocket.OPEN) {
          partner.send(JSON.stringify({ type: "partner-left" }));
        }
      }
    }
  });

  ws.on("close", () => {
    const partner = pairs.get(ws);
    if (partner) {
      pairs.delete(ws);
      pairs.delete(partner);
      if (partner.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify({ type: "partner-left" }));
      }
    }
    if (chatQueue.includes(ws)) chatQueue = chatQueue.filter((c) => c !== ws);
    if (videoQueue.includes(ws)) videoQueue = videoQueue.filter((c) => c !== ws);
  });
});

// Heartbeat to terminate stale/pending sockets
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {}); // ping the client, expecting pong handler
  });
}, 30000);

wss.on("close", () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on " + PORT));
