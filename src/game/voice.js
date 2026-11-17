/* ---------- voice chat ----------
   Every player is connected to every other by WebRTC (audio only, peer to peer: the game server just passes the
   handshake). The microphone is a push-to-talk key. What a player hears is decided here, by the listener: a teammate
   at any distance (a radio), an enemy only within 30 m, fading with the distance (a voice in the street).
   The lower id of a pair makes the offer. There is no TURN server, only STUN: behind a strict NAT two players may not
   reach each other and then simply do not hear each other. */
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const HEAR = 30;   // metres an enemy can be heard from

function createVoice({ myId, send, info, onSpeaking }) {
  const peers = new Map(); let track = null, ctx = null, talking = false, acc = 0;
  const audio = () => { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; ctx = new A(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
  async function offer(p) { const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o); send(p.id, { sdp: { type: o.type, sdp: p.pc.localDescription.sdp } }); }
  function attach(p, stream) {
    const a = new Audio(); a.srcObject = stream; a.muted = true; a.play().catch(() => {});   // Chrome only lets a remote stream flow when an element holds it
    const c = audio(), src = c.createMediaStreamSource(stream), g = c.createGain(), an = c.createAnalyser(); an.fftSize = 256; g.gain.value = 0;
    src.connect(an); src.connect(g); g.connect(c.destination); p.gain = g; p.an = an; p.buf = new Uint8Array(an.fftSize); p.el = a;
  }
  function ensure(id) {
    let p = peers.get(id); if (p) return p;
    const pc = new RTCPeerConnection(ICE); p = { id, pc, pend: [], remoteSet: false, gain: null, an: null, buf: null, el: null, speaking: false };
    p.sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender; if (track) p.sender.replaceTrack(track).catch(() => {});   // the microphone joins later without a new handshake
    pc.onicecandidate = e => { if (e.candidate) send(id, { c: e.candidate.toJSON() }); };
    pc.ontrack = e => attach(p, e.streams[0] || new MediaStream([e.track]));
    peers.set(id, p);
    if (myId() < id) offer(p).catch(() => {});
    return p;
  }
  async function signal(from, d) {
    if (!d || typeof d !== 'object') return; const p = ensure(from);
    try {
      if (d.sdp && typeof d.sdp.sdp === 'string' && (d.sdp.type === 'offer' || d.sdp.type === 'answer')) {
        await p.pc.setRemoteDescription({ type: d.sdp.type, sdp: d.sdp.sdp }); p.remoteSet = true;
        for (const c of p.pend.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === 'offer') { const an = await p.pc.createAnswer(); await p.pc.setLocalDescription(an); send(from, { sdp: { type: an.type, sdp: p.pc.localDescription.sdp } }); }
      } else if (d.c && typeof d.c === 'object') { if (p.remoteSet) await p.pc.addIceCandidate(d.c).catch(() => {}); else p.pend.push(d.c); }
    } catch (e) { /* a broken handshake: that pair just stays silent */ }
  }
  function setPeers(ids) {
    const want = new Set(ids);
    for (const [id, p] of peers) if (!want.has(id)) { try { p.pc.close(); if (p.el) p.el.srcObject = null; } catch (e) {} peers.delete(id); }
    for (const id of want) ensure(id);
  }
  async function enableMic() {
    if (track) return true;
    try {
      audio(); const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      track = s.getAudioTracks()[0]; track.enabled = talking;
      for (const p of peers.values()) p.sender.replaceTrack(track).catch(() => {});
      return true;
    } catch (e) { return false; }
  }
  function talk(on) { talking = on; if (track) track.enabled = on; if (on) audio(); }
  // every frame: who is audible now (gain by the distance), and who of those is speaking
  function update(dt) {
    if ((acc += dt) < 0.12) return; acc = 0; const speaking = [];
    for (const p of peers.values()) {
      if (!p.gain) continue; const i = info(p.id) || { mate: false, dist: 1e9 };
      const want = i.mate ? 1 : i.dist < HEAR ? Math.pow(1 - i.dist / HEAR, 1.5) : 0;
      p.gain.gain.value += (want - p.gain.gain.value) * 0.6;
      p.an.getByteTimeDomainData(p.buf); let s = 0; for (let k = 0; k < p.buf.length; k++) { const v = (p.buf[k] - 128) / 128; s += v * v; }
      p.speaking = Math.sqrt(s / p.buf.length) > 0.02 && want > 0.02; if (p.speaking) speaking.push(p.id);
    }
    onSpeaking(speaking, talking && !!track);
  }
  function close() { for (const p of peers.values()) { try { p.pc.close(); } catch (e) {} } peers.clear(); if (track) track.stop(); track = null; }
  const status = () => [...peers.values()].map(p => ({ id: p.id, conn: p.pc.connectionState, ice: p.pc.iceConnectionState, signaling: p.pc.signalingState, track: !!p.gain, gain: p.gain ? +p.gain.gain.value.toFixed(2) : 0, speaking: p.speaking, ctx: ctx && ctx.state }));
  return { close, status, enableMic, signal, setPeers, talk, update, get hasMic() { return !!track; } };
}

export { HEAR, createVoice };
