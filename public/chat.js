const log = document.getElementById("log");
const input = document.getElementById("msg");
const sendBtn = document.getElementById("send");
const skipBtn = document.getElementById("skip");

let ws = createSocket();

function append(text, cls = "") {
  const d = document.createElement("div");

  if (cls === "you") {
    d.innerHTML = `<span class="you-label">You:</span> <span class="message-text">${text.replace(/^You:\s*/, "")}</span>`;
  } else if (cls === "stranger") {
    d.innerHTML = `<span class="stranger-label">Stranger:</span> <span class="message-text">${text.replace(/^Stranger:\s*/, "")}</span>`;
  } else {
    d.textContent = text; // system messages
    d.className = "system";
  }

  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}


function createSocket() {
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  return new WebSocket(proto + location.host);
}

function resetWS() {
  ws.close();
  ws = createSocket();
  ws.onopen = () => ws.send(JSON.stringify({ type: "join", mode: "chat" }));
  ws.onmessage = (ev) => handleMsg(ev);
}

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "join", mode: "chat" }));
};

ws.onmessage = (ev) => handleMsg(ev);

function handleMsg(ev) {
  const msg = JSON.parse(ev.data);
  if (msg.type === "waiting") {
    append("Looking for a stranger...", "sys");
  } else if (msg.type === "paired") {
    log.innerHTML = ""; // clear old chat
    append("Connected with a stranger!", "sys");
  } else if (msg.type === "chat") {
    append("Stranger: " + msg.text, "stranger");
  } else if (msg.type === "partner-left") {
    append("Stranger disconnected.", "sys");
    resetWS();
  }
}

sendBtn.onclick = () => {
  const text = input.value.trim();
  if (!text) return;
  append("You: " + text, "you");
  ws.send(JSON.stringify({ type: "chat", text }));
  input.value = "";
};

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.onclick();
});

skipBtn.onclick = () => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leave" }));
  }
  log.innerHTML = "";
  append("You skipped. Looking for a new stranger...", "sys");
  resetWS();
};
