// video.js - robust WebRTC client for your existing server
const localV = document.getElementById("local");
const remoteV = document.getElementById("remote");
const log = document.getElementById("log");
const input = document.getElementById("msg");
const sendBtn = document.getElementById("send");
const skipBtn = document.getElementById("skip");

let ws = createSocket();
let pc = null;
let localStream = null;
let remoteStream = null;

let makingOffer = false;
let polite = false; // polite = responder; initiator flag comes from server
let ignoreOffer = false;
let isSettingRemoteDesc = false;
let pendingCandidates = [];

// small debug helper
function dbg(...args) { try { console.log(...args); } catch(e) {} }

// Append messages
function append(text, cls = "") {
  const d = document.createElement("div");
  if (cls === "you") {
    d.innerHTML = `<span class="you-label">You:</span> <span class="message-text">${text.replace(/^You:\s*/, "")}</span>`;
  } else if (cls === "stranger") {
    d.innerHTML = `<span class="stranger-label">Stranger:</span> <span class="message-text">${text.replace(/^Stranger:\s*/, "")}</span>`;
  } else {
    d.textContent = text;
    d.className = "system";
  }
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

// Ensure ws handlers re-bound if resetWS used
ws.onopen = () => {
  dbg("WS open - joining video");
  ws.send(JSON.stringify({ type: "join", mode: "video" }));
};
ws.onmessage = (ev) => handleMsg(ev);

// Create PeerConnection with STUN+TURN fallback
function createPeerConnection() {
  if (pc) return pc;

  const config = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },

      // Public openrelay TURN (metered). Replace with your TURN if possible for production.
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      // You can add your own TURN server here for production.
    ]
  };

  pc = new RTCPeerConnection(config);

  // remote stream container
  remoteStream = new MediaStream();
  remoteV.srcObject = remoteStream;

  pc.ontrack = (e) => {
    dbg("ontrack, streams:", e.streams);
    // add tracks from incoming stream
    e.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      dbg("Sending ICE candidate");
      ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    dbg("PC state:", pc.connectionState, pc.iceConnectionState);
  };

  return pc;
}

// Setup local media (getUserMedia) and attach to PC
async function ensureLocalMediaAndAttach() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localV.srcObject = localStream;
  }
  // attach tracks to pc
  const p = createPeerConnection();
  localStream.getTracks().forEach((t) => {
    // avoid adding duplicate senders
    const exists = p.getSenders().some(s => s.track && s.track.kind === t.kind && s.track.id === t.id);
    if (!exists) p.addTrack(t, localStream);
  });
}

// Create and send offer (initiator)
async function makeAndSendOffer() {
  try {
    makingOffer = true;
    const p = createPeerConnection();
    await ensureLocalMediaAndAttach();
    const offer = await p.createOffer();
    await p.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", offer: p.localDescription }));
    dbg("Offer sent");
  } catch (err) {
    console.error("Error making offer:", err);
  } finally {
    makingOffer = false;
  }
}

// Handle incoming messages
async function handleMsg(ev) {
  const msg = JSON.parse(ev.data);
  dbg("WS message:", msg);

  switch (msg.type) {
    case "waiting":
      append("Looking for a stranger...", "sys");
      break;

    case "paired":
      // server informs who should initiate
      append("Connected with a stranger!", "sys");
      const initiator = !!msg.initiator;
      polite = !initiator; // non-initiator will be polite (accept offer)
      await ensureLocalMediaAndAttach();
      createPeerConnection();

      // Only initiator creates the offer
      if (initiator) {
        await makeAndSendOffer();
      }
      break;

    case "offer": {
      // collision detection
      const p = createPeerConnection();
      const offerCollision = makingOffer || p.signalingState !== "stable";
      ignoreOffer = !polite && offerCollision;
      if (ignoreOffer) {
        dbg("Ignoring incoming offer due to collision and not polite");
        return;
      }

      isSettingRemoteDesc = true;
      try {
        await ensureLocalMediaAndAttach();
        await p.setRemoteDescription(msg.offer);
        const answer = await p.createAnswer();
        await p.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", answer: p.localDescription }));
        dbg("Answered offer and sent answer");
      } catch (err) {
        console.error("Error handling offer:", err);
      } finally {
        isSettingRemoteDesc = false;
      }

      // flush any queued ICEs
      while (pendingCandidates.length) {
        const cand = pendingCandidates.shift();
        try { await p.addIceCandidate(cand); } catch (e) { console.warn("addIceCandidate failed:", e); }
      }
      break;
    }

    case "answer": {
      const p = createPeerConnection();
      try {
        // avoid setting remote description if we're in the middle of setting one
        if (!isSettingRemoteDesc) {
          await p.setRemoteDescription(msg.answer);
          dbg("Remote answer set");
        } else {
          // rare; queue or ignore based on your flow
          dbg("Ignored answer while setting remote description");
        }
      } catch (err) {
        console.error("Error handling answer:", err);
      }
      break;
    }

    case "ice": {
      const p = createPeerConnection();
      const candidate = msg.candidate;
      if (p && p.remoteDescription && p.remoteDescription.type) {
        try {
          await p.addIceCandidate(candidate);
          dbg("Added ICE candidate");
        } catch (err) {
          console.warn("Failed to add ICE candidate:", err);
        }
      } else {
        // queue until remote description is available
        pendingCandidates.push(candidate);
        dbg("Queued ICE candidate");
      }
      break;
    }

    case "chat":
      append(msg.text, "stranger");
      break;

    case "partner-left":
      append("Stranger disconnected.", "sys");
      cleanup();
      // optionally rejoin automatically:
      // ws.send(JSON.stringify({ type: "join", mode: "video" }));
      break;

    default:
      dbg("Unhandled message type", msg.type);
  }
}

// Cleanup peer and streams
function cleanup() {
  if (pc) {
    try { pc.ontrack = null; pc.onicecandidate = null; pc.close(); } catch {}
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    localV.srcObject = null;
  }
  if (remoteStream) {
    remoteStream.getTracks().forEach(t => t.stop());
    remoteStream = null;
    remoteV.srcObject = null;
  }
  makingOffer = false;
  ignoreOffer = false;
  isSettingRemoteDesc = false;
  pendingCandidates = [];
}

// UI: send chat
sendBtn.onclick = () => {
  const text = input.value.trim();
  if (!text) return;
  append("You: " + text, "you");
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "chat", text }));
  }
  input.value = "";
};
input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendBtn.onclick(); });

// Skip
skipBtn.onclick = () => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "leave" }));
  append("You skipped. Looking for a new stranger...", "sys");
  cleanup();
  // rejoin
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "join", mode: "video" }));
  }
};
