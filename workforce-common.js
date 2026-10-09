(function () {
  'use strict';
  const liveApi = async (client, action, body) => {
    const result = await client.functions.invoke('workforce-live', { body: { ...body, action }, timeout: action === 'heartbeat' ? 4000 : 12000 });
    if (result.error) {
      let detail; try { detail = await result.error.context.json(); } catch (_) { /* safe fallback */ }
      const error = new Error(detail?.error || 'The workforce connection is unavailable.');
      error.status = result.error.context?.status;
      throw error;
    }
    return result.data;
  };
  class Presence {
    constructor(client, onState) {
      this.client = client; this.onState = onState || (() => {});
      this.tabId = crypto.randomUUID(); this.sessionId = null; this.active = false;
      this.closeToken = null; this.timer = null; this.busy = false; this.epoch = 0;
      this.interval = 5; this.lastSent = 0; this.userId = null;
      try {
        this.clientId = localStorage.getItem('linkora.portal.client.v1') || crypto.randomUUID();
        localStorage.setItem('linkora.portal.client.v1', this.clientId);
      } catch (_) { this.clientId = crypto.randomUUID(); }
      window.addEventListener('pagehide', () => this.closing());
      window.addEventListener('pageshow', (event) => {
        if (event.persisted && this.active) this.start(this.userId).catch((error) => this.onState({ error }));
      });
      window.addEventListener('online', () => this.heartbeat(true));
      // A hidden page is still working attendance. This event only updates its lease allowance.
      document.addEventListener('visibilitychange', () => this.heartbeat(true));
    }
    api(action, body) { return liveApi(this.client, action, body); }
    primary() {
      if (!this.userId) return true;
      const key = 'linkora.portal.primary.' + this.userId;
      try {
        const owner = JSON.parse(localStorage.getItem(key) || 'null');
        if (!owner || owner.until < Date.now() || owner.tab === this.tabId) {
          localStorage.setItem(key, JSON.stringify({ tab: this.tabId, until: Date.now() + 7500 }));
          return true;
        }
        return false;
      } catch (_) { return true; } // Server-side uniqueness still protects storage-restricted browsers.
    }
    async start(userId, clockIn = false) {
      const epoch = ++this.epoch;
      clearInterval(this.timer); this.timer = null;
      this.userId = userId;
      if (this.channel) this.channel.close();
      if (window.BroadcastChannel) {
        this.channel = new BroadcastChannel('linkora.portal.presence.' + userId);
        this.channel.onmessage = (event) => { if (event.data?.type === 'leaving') this.heartbeat(true); };
      }
      const result = await this.api(clockIn ? 'clock-in' : 'connect', {
        sessionId: crypto.randomUUID(), clientId: this.clientId, tabId: this.tabId, background: document.hidden,
      });
      if (epoch !== this.epoch) return result;
      if (!result.active) { this.stop(); this.onState(result); return result; }
      this.sessionId = result.sessionId; this.closeToken = result.closeToken; this.active = true;
      this.interval = Math.max(5, Math.min(60, Number(result.heartbeatSeconds) || 5));
      this.lastSent = Date.now(); this.primary();
      this.timer = setInterval(() => this.heartbeat(), this.interval * 1000);
      this.onState(result); return result;
    }
    async heartbeat(force) {
      if (!this.active || this.busy) return;
      // Each live tab renews its own server lease; closing one cannot close another.
      this.primary(); // Every tab renews its own lease every five seconds.
      this.busy = true; const epoch = this.epoch;
      try {
        const result = await this.api('heartbeat', {
          sessionId: this.sessionId, clientId: this.clientId, tabId: this.tabId, background: document.hidden,
        });
        if (epoch !== this.epoch) return;
        this.lastSent = Date.now();
        if (!result.active) this.stop();
        this.onState(result);
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (error.status === 401 || error.status === 403) this.stop();
        this.onState({ active: this.active, error, connectionLost: true });
      } finally { this.busy = false; }
    }
    closing() {
      if (!this.active || !this.closeToken) return;
      this.channel?.postMessage({ type: 'leaving' });
      this.releasePrimary();
      const body = new Blob([JSON.stringify({ action: 'closing', sessionId: this.sessionId,
        tabId: this.tabId, closeToken: this.closeToken })], { type: 'text/plain;charset=UTF-8' });
      const url = window.TENNIS_PORTAL_CONFIG.supabaseUrl + '/functions/v1/workforce-live';
      let sent = false;
      try { sent = !!navigator.sendBeacon?.(url, body); } catch (_) { /* fallback */ }
      if (!sent) fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
    }
    releasePrimary() {
      try {
        const key = 'linkora.portal.primary.' + this.userId;
        if (JSON.parse(localStorage.getItem(key) || 'null')?.tab === this.tabId) localStorage.removeItem(key);
      } catch (_) { /* no storage coordination needed for correctness */ }
    }
    stop() {
      ++this.epoch; this.active = false; this.closeToken = null;
      clearInterval(this.timer); this.timer = null; this.releasePrimary();
      this.channel?.close(); this.channel = null;
    }
  }

  class VideoPeer {
    constructor(client, id, generation, ice, onTrack, onState) {
      this.client = client; this.id = id; this.generation = generation;
      this.pc = new RTCPeerConnection(ice); this.pendingIce = []; this.queue = Promise.resolve(); this.closed = false;
      this.pc.onicecandidate = (event) => { if (event.candidate) this.send('ice', event.candidate.toJSON()).catch(() => this.close()); };
      this.pc.ontrack = (event) => { if (event.track.kind === 'video' && onTrack) onTrack(event.streams[0] || new MediaStream([event.track])); };
      this.pc.onconnectionstatechange = () => onState?.(this.pc.connectionState);
    }
    send(kind, payload) {
      if (this.closed) return Promise.resolve();
      this.queue = this.queue.then(async () => {
        if (this.closed) return;
        const result = await liveApi(this.client, 'signal', { peerId: this.id, generation: this.generation, kind, payload });
        if (result.active === false) this.close();
      });
      return this.queue;
    }
    async offer(stream) {
      stream.getVideoTracks().forEach((track) => this.pc.addTrack(track, stream));
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this.send('offer', this.pc.localDescription.toJSON());
    }
    async receive(message) {
      if (this.closed) return;
      if (message.kind === 'ice') {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(message.payload);
        else this.pendingIce.push(message.payload);
      } else {
        await this.pc.setRemoteDescription(message.payload);
        for (const candidate of this.pendingIce.splice(0)) await this.pc.addIceCandidate(candidate);
        if (message.kind === 'offer') {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          await this.send('answer', this.pc.localDescription.toJSON());
        }
      }
    }
    close() { if (!this.closed) { this.closed = true; this.pc.close(); } }
  }

  class ScreenShare {
    constructor(client, presence, ui) {
      this.client = client; this.presence = presence; this.ui = ui;
      this.stream = null; this.shareId = null; this.peers = new Map(); this.cursor = 0;
      this.timer = null; this.polling = false; this.epoch = 0; this.starting = false;
      this.ui.start.addEventListener('click', () => this.start());
      this.ui.stop.addEventListener('click', () => this.stop('Screen sharing ended by employee.'));
      window.addEventListener('pagehide', () => this.stopLocal('Screen sharing ended.'));
      if (!navigator.mediaDevices?.getDisplayMedia || !window.RTCPeerConnection) {
        this.ui.start.disabled = true;
        this.ui.message.textContent = 'Live screen sharing is unavailable in this browser. Attendance works independently.';
      }
    }
    requestCapture() {
      // Must run before awaiting Auth/network, while Clock In has transient activation.
      if (!navigator.mediaDevices?.getDisplayMedia || !window.RTCPeerConnection)
        return Promise.resolve({ error: Object.assign(new Error('Screen sharing unsupported.'), { name: 'NotSupportedError' }) });
      const generation = this.captureGeneration || 0;
      this.ui.message.textContent = 'Permission required: choose Entire Screen in the browser chooser.';
      try {
        return navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: { ideal: 10, max: 15 } }, audio: false })
          .then(stream => {
            if (generation !== (this.captureGeneration || 0)) {
              stream.getTracks().forEach(track => track.stop());
              return { error: Object.assign(new Error('Sharing request ended.'), { name: 'AbortError' }) };
            }
            this.pendingStream = stream; this.ui.banner.hidden = false;
            return { stream };
          }, error => ({ error }));
      } catch (error) { return Promise.resolve({ error }); }
    }
    async screenState(state) {
      if (this.presence.active) try {
        await liveApi(this.client, 'screen-state', { sessionId: this.presence.sessionId, state });
      } catch (_) { this.ui.message.textContent += ' Sharing status could not be confirmed by the server.'; }
    }
    async start(capture) {
      if (this.stream || this.starting) { capture?.then(selected => selected.stream?.getTracks().forEach(track => track.stop())); return; }
      if (!this.presence.active) { capture?.then(selected => selected.stream?.getTracks().forEach(track => track.stop())); this.ui.message.textContent = 'Clock In before sharing.'; return; }
      this.starting = true; this.ui.start.disabled = true; const epoch = ++this.epoch;
      let stream;
      try {
        // The native chooser is invoked directly from this click. No remote action invokes capture.
        const request = capture || this.requestCapture();
        await this.screenState('requested');
        const selected = await request;
        if (selected.error) throw selected.error;
        stream = selected.stream;
        if (stream.getVideoTracks().some(track => track.readyState === 'ended')) throw Object.assign(new Error('Sharing stopped before attendance connected.'), { name: 'AbortError' });
        if (epoch !== this.epoch) { stream.getTracks().forEach((track) => track.stop()); return; }
        stream.getAudioTracks().forEach((track) => track.stop());
        this.pendingStream = null; this.stream = stream;
        this.ui.banner.hidden = false; this.ui.start.hidden = true; this.ui.stop.disabled = false;
        this.ui.viewers.textContent = 'No connected viewers.';
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => this.stop('Screen sharing ended by employee.')));
        const result = await liveApi(this.client, 'share-start', { sessionId: this.presence.sessionId, tabId: this.presence.tabId });
        if (epoch !== this.epoch) { liveApi(this.client, 'share-stop', { shareId: result.shareId }).catch(() => {}); return; }
        this.shareId = result.shareId;
        this.ice = await liveApi(this.client, 'ice', {});
        if (epoch !== this.epoch) return;
        this.ui.message.textContent = 'Sharing your selected screen/window/tab. No audio or recording.';
        this.cursor = 0; this.timer = setInterval(() => this.poll(), 2000); await this.poll();
      } catch (error) {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        const cancelled = error.name === 'NotAllowedError' || error.name === 'AbortError';
        await this.stop(cancelled ? 'Screen Share Declined. Attendance remains active. Re-enable sharing when ready.' : error.message);
        await this.screenState(cancelled ? 'declined' : error.name === 'NotSupportedError' ? 'unsupported' : 'stopped');
      } finally { this.starting = false; this.ui.start.disabled = false; }
    }
    async poll() {
      if (!this.shareId || this.polling) return;
      this.polling = true; const epoch = this.epoch;
      try {
        const data = await liveApi(this.client, 'poll-owner', { shareId: this.shareId, afterId: this.cursor });
        if (epoch !== this.epoch) return;
        if (!data.active) { await this.stop(data.reason || 'Screen sharing ended.'); return; }
        const ids = new Set(data.peers.map((peer) => peer.id));
        for (const [id, peer] of this.peers) if (!ids.has(id)) { peer.close(); this.peers.delete(id); }
        for (const row of data.peers) {
          let peer = this.peers.get(row.id);
          if (peer && peer.generation !== row.generation) { peer.close(); this.peers.delete(row.id); peer = null; }
          if (!peer) {
            peer = new VideoPeer(this.client, row.id, row.generation, this.ice, null,
              (state) => { if (state === 'failed') peer.close(); });
            this.peers.set(row.id, peer);
            await peer.offer(this.stream);
          }
        }
        for (const signal of data.signals) {
          await this.peers.get(signal.peer_id)?.receive(signal);
          this.cursor = Math.max(this.cursor, Number(signal.id));
        }
        this.ui.viewers.textContent = data.peers.length
          ? 'Authorized viewers: ' + data.peers.map((peer) => peer.viewerName).join(', ') : 'No connected viewers.';
      } catch (error) {
        if (epoch === this.epoch) await this.stop('Sharing stopped because its authorization or connection could not be verified.');
      } finally { this.polling = false; }
    }
    stopLocal(reason) {
      this.captureGeneration = (this.captureGeneration || 0) + 1;
      this.pendingStream?.getTracks().forEach(track => track.stop()); this.pendingStream = null;
      ++this.epoch; clearInterval(this.timer); this.timer = null;
      this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null;
      for (const peer of this.peers.values()) peer.close(); this.peers.clear();
      this.ui.banner.hidden = true; this.ui.start.hidden = !this.presence.active; this.ui.start.disabled = this.starting;
      this.ui.message.textContent = reason || 'Not sharing.';
    }
    async stop(reason) {
      const shareId = this.shareId; this.shareId = null;
      this.stopLocal(reason);
      if (shareId) try { await liveApi(this.client, 'share-stop', { shareId }); } catch (_) {
        this.ui.message.textContent += ' Server cleanup will follow the sharing lease.';
      }
    }
  }
  window.LinkoraWorkforce = { Presence, ScreenShare, VideoPeer, api: liveApi };
}());
