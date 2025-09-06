let socket;
let reconnectTimeout = null;
let lastJoinMode = null; // remember whether user chose chat or video

function createSocket() {
  let protocol = location.protocol === "https:" ? "wss://" : "ws://";
  socket = new WebSocket(protocol + location.host);

  socket.onopen = () => {
    console.log("✅ Connected to server");
    if (lastJoinMode) {
      // Auto rejoin the mode user was in before disconnect
      socket.send(JSON.stringify({ type: "join", mode: lastJoinMode }));
    }
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "waiting") {
      console.log("⏳ Waiting for a partner...");
    }

    if (msg.type === "paired") {
      console.log("🎉 Paired with a partner!");
    }

    if (msg.type === "chat") {
      // Display incoming chat
      appendMessage("Stranger", msg.text, "green");
    }

    if (msg.type === "partner-left") {
      console.log("⚠️ Partner left. Rejoining queue...");
      if (lastJoinMode) {
        socket.send(JSON.stringify({ type: "join", mode: lastJoinMode }));
      }
    }

    // Handle WebRTC messages (offer/answer/ice)
    if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
      handleWebRTCMessage(msg);
    }
  };

  socket.onclose = () => {
    console.warn("❌ Disconnected. Reconnecting in 3s...");
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => {
      createSocket();
    }, 3000);
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
    socket.close();
  };

  return socket;
}

// Send chat messages
function sendChatMessage(text) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "chat", text }));
    appendMessage("You", text, "red");
  }
}

// Join chat or video mode
function joinMode(mode) {
  lastJoinMode = mode;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "join", mode }));
  }
}

// Example UI helper
function appendMessage(sender, text, color) {
  const chatBox = document.getElementById("chat");
  if (!chatBox) return;
  const div = document.createElement("div");
  div.innerHTML = `<b style="color:${color}">${sender}:</b> <span style="color:black">${text}</span>`;
  chatBox.appendChild(div);
}

// Placeholder for WebRTC handling
function handleWebRTCMessage(msg) {
  console.log("📡 WebRTC message:", msg);
}

// Initialize socket
createSocket();
