import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function harness(storage = new Map(), responder) {
  const handlers = {}, docHandlers = {}, timers = new Map(), requests = [], beacons = [];
  let nextTimer = 0, captureCalls = 0;
  class Channel { postMessage() {} close() {} }
  const document = { hidden: false, addEventListener(name, fn) { docHandlers[name] = fn; } };
  const window = { BroadcastChannel: Channel, RTCPeerConnection: function () {},
    TENNIS_PORTAL_CONFIG: { supabaseUrl: 'https://test.invalid' },
    addEventListener(name, fn) { (handlers[name] ||= []).push(fn); } };
  const navigator = { sendBeacon(url, body) { beacons.push({ url, body }); return true; },
    mediaDevices: { async getDisplayMedia(options) { captureCalls++; return capture(options); } } };
  let capture = async () => { throw Object.assign(new Error('Cancelled'), { name: 'NotAllowedError' }); };
  const client = { functions: { async invoke(_name, options) {
    requests.push(options.body);
    return responder ? responder(options.body) : { data: { active: true, sessionId: 'same-session',
      closeToken: 'a'.repeat(72), lastHeartbeatAt: new Date().toISOString(), heartbeatSeconds: 30 } };
  } } };
  const context = vm.createContext({ window, document, navigator, crypto: webcrypto, Date, JSON, Math,
    Map, Set, Blob, Promise, BroadcastChannel: Channel, RTCPeerConnection: window.RTCPeerConnection,
    fetch: async () => {}, localStorage: { getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    setInterval(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  vm.runInContext(readFileSync('workforce-common.js', 'utf8'), context);
  const control = () => ({ hidden: true, disabled: false, textContent: '', listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; } });
  const ui = { start: control(), stop: control(), banner: control(), message: control(), viewers: control() };
  return { ...window.LinkoraWorkforce, client, document, handlers, docHandlers, requests, beacons, timers,
    ui, captureCalls: () => captureCalls, setCapture: (fn) => { capture = fn; } };
}
test('restoration and a second tab reuse server session; close uses scoped capability only', async () => {
  const storage = new Map(), a = harness(storage), b = harness(storage);
  const first = new a.Presence(a.client), second = new b.Presence(b.client);
  await first.start('user'); await second.start('user');
  assert.equal(first.sessionId, second.sessionId);
  assert.notEqual(first.tabId, second.tabId);
  assert.equal(first.primary(), true); assert.equal(second.primary(), false);
  first.closing(); assert.equal(second.primary(), true); assert.equal(second.active, true);
  const body = JSON.parse(await a.beacons[0].body.text());
  assert.deepEqual(Object.keys(body).sort(), ['action', 'closeToken', 'sessionId', 'tabId']);
  assert.equal(body.action, 'closing');
  // A BFcache restore reconnects and cancels a pending close server-side.
  await a.handlers.pageshow[0]({ persisted: true }); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.requests.filter((r) => r.action === 'connect').length, 2);
});
test('hidden visibility sends background heartbeat, never closes attendance', async () => {
  const h = harness(), state = new h.Presence(h.client); await state.start('user');
  h.document.hidden = true; await h.docHandlers.visibilitychange();
  assert.equal(state.active, true); assert.equal(h.beacons.length, 0);
  assert.equal(h.requests.at(-1).background, true);
  assert.equal(h.handlers.blur, undefined); assert.equal(h.handlers.beforeunload, undefined);
});
test('brief network errors keep attendance; server expiry stops heartbeat', async () => {
  let mode = 'okay';
  const h = harness(new Map(), () => mode === 'network'
    ? { error: new Error('Offline') } : { data: { active: mode !== 'expired', sessionId: 'same',
      heartbeatSeconds: 30, lastHeartbeatAt: new Date().toISOString() } });
  const state = new h.Presence(h.client); await state.start('user');
  mode = 'network'; await state.heartbeat(true); assert.equal(state.active, true);
  mode = 'expired'; await state.heartbeat(true); assert.equal(state.active, false); assert.equal(h.timers.size, 0);
});
test('screen capture is never automatic; cancel leaves attendance running', async () => {
  const h = harness(), presence = { active: true };
  const share = new h.ScreenShare(h.client, presence, h.ui);
  assert.equal(h.captureCalls(), 0);
  await h.ui.start.listeners.click();
  assert.equal(h.captureCalls(), 1); assert.equal(share.stream, null);
  assert.equal(presence.active, true); assert.equal(h.requests.length, 0);
});
test('chosen video has persistent notice and explicit/native stop immediately stops tracks', async () => {
  let videoStops = 0, audioStops = 0, onEnded;
  const video = { stop() { videoStops++; }, addEventListener(_name, fn) { onEnded = fn; } };
  const audio = { stop() { audioStops++; } };
  const stream = { getTracks: () => [video, audio], getVideoTracks: () => [video], getAudioTracks: () => [audio] };
  const h = harness(new Map(), (body) => ({ data: body.action === 'share-start' ? { shareId: 'share' }
    : body.action === 'poll-owner' ? { active: true, peers: [], signals: [] } : { ok: true } }));
  h.setCapture(async (options) => { assert.equal(options.audio, false); return stream; });
  const presence = { active: true, sessionId: 'session', tabId: 'tab' };
  const share = new h.ScreenShare(h.client, presence, h.ui);
  await share.start(); assert.equal(h.ui.banner.hidden, false); assert.equal(audioStops, 1);
  await onEnded(); assert.equal(h.ui.banner.hidden, true); assert.equal(videoStops, 1);
  assert.equal(presence.active, true); assert.equal(h.requests.at(-1).action, 'share-stop');
});
test('failed sharing authorization stops capture while keeping attendance separate', async () => {
  let stops = 0;
  const video = { stop() { stops++; }, addEventListener() {} };
  const h = harness(new Map(), (body) => body.action === 'poll-owner' ? { error: new Error('Denied') }
    : { data: body.action === 'share-start' ? { shareId: 'share' } : { ok: true } });
  h.setCapture(async () => ({ getTracks: () => [video], getVideoTracks: () => [video], getAudioTracks: () => [] }));
  const share = new h.ScreenShare(h.client, { active: true }, h.ui);
  await share.start(); assert.equal(stops, 1); assert.equal(h.ui.banner.hidden, true);
});
test('ICE candidates received before SDP are buffered and viewer sends answer only', async () => {
  const h = harness(); const candidates = [];
  h.client.functions.invoke = async (_name, options) => { h.requests.push(options.body); return { data: { active: true } }; };
  class Peer {
    async addIceCandidate(candidate) { candidates.push(candidate); }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async createAnswer() { return { type: 'answer' }; }
    async setLocalDescription(value) { this.localDescription = { ...value, toJSON: () => value }; }
    close() { this.closed = true; }
  }
  const context = vm.createContext({ ...globalThis, window: {}, RTCPeerConnection: Peer, Map, Set, Promise });
  // Re-evaluate with an injectable peer without any browser access.
  vm.runInContext(readFileSync('workforce-common.js', 'utf8'), context);
  const peer = new context.window.LinkoraWorkforce.VideoPeer(h.client, 'peer', 3, {}, null);
  await peer.receive({ kind: 'ice', payload: { candidate: 'temporary' } });
  assert.equal(candidates.length, 0);
  await peer.receive({ kind: 'offer', payload: { type: 'offer', sdp: 'test' } });
  assert.equal(candidates.length, 1); assert.equal(h.requests[0].kind, 'answer'); assert.equal(h.requests[0].generation, 3);
  peer.close(); assert.equal(peer.closed, true);
});
