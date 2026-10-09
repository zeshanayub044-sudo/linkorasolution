(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const element = (tag, text, klass) => {
    const el = document.createElement(tag); if (text != null) el.textContent = text;
    if (klass) el.className = klass; return el;
  };
  const label = (row) => row.autoClosed ? (row.estimatedLogout ? 'Auto Closed (estimated)' : 'Auto Closed')
    : row.sessionState === 'manually_closed' ? 'Manual Correction'
    : row.sessionState === 'connection_lost' ? 'Connection Lost'
    : row.attendanceStatus === 'Logged In' ? (row.lastHeartbeatAt ? 'Online' : 'Untracked open session')
    : row.attendanceStatus === 'Needs Review' ? 'Needs Review' : row.logoutAt ? 'Clocked Out' : 'Not Clocked In';
  class WorkforceAdmin {
    constructor(client, timestamp, onDenied) {
      this.client = client; this.timestamp = timestamp; this.onDenied = onDenied;
      this.rows = []; this.running = false; this.epoch = 0; this.viewerEpoch = 0;
      this.viewer = null; this.cursor = 0; this.refreshing = false; this.polling = false;
      $('workforce-search').addEventListener('input', () => this.render());
      $('workforce-refresh').addEventListener('click', () => this.refresh());
      $('screen-viewer-close').addEventListener('click', () => this.closeViewer());
      $('screen-viewer').addEventListener('cancel', () => this.closeViewer());
      window.addEventListener('pagehide', () => { this.closeViewer(); this.stop(); });
    }
    async api(action, payload) { return window.LinkoraWorkforce.api(this.client, action, payload); }
    start() {
      if (this.running) return;
      this.running = true; ++this.epoch;
      this.timer = setInterval(() => this.refresh(), 5000); this.refresh();
    }
    stop() {
      ++this.epoch; this.running = false; clearInterval(this.timer); this.timer = null;
      this.closeViewer(); this.rows = []; $('workforce-body').replaceChildren();
    }
    async refresh() {
      if (!this.running || this.refreshing) return;
      this.refreshing = true; const epoch = this.epoch;
      try {
        const data = await this.api('workforce', {});
        if (epoch !== this.epoch) return;
        this.rows = data.rows; this.render();
        $('workforce-message').textContent = 'Updated ' + this.timestamp(data.serverTime) +
          ' · Status refreshes every 5 seconds. Sharing requires employee approval.';
        const sharing = this.rows.find((row) => row.shareId === this.viewer?.shareId);
        if (this.viewer && !sharing) this.endViewer('Screen sharing ended by employee or portal session.');
      } catch (error) {
        if (epoch !== this.epoch) return;
        $('workforce-message').textContent = error.message;
        // Close media immediately when management authorization cannot be checked.
        this.endViewer('Viewer closed: its connection or authorization could not be verified.');
        if (error.status === 401 || error.status === 403) { this.stop(); this.onDenied(error); }
      } finally { this.refreshing = false; }
    }
    render() {
      const query = $('workforce-search').value.trim().toLowerCase();
      const body = $('workforce-body'); body.replaceChildren();
      for (const row of this.rows.filter((r) => (r.fullName + ' ' + r.employeeId).toLowerCase().includes(query))) {
        const tr = element('tr');
        const person = element('td', row.fullName, 'person'); person.append(element('small', row.employeeId));
        tr.append(person, element('td', row.scheme || '—'));
        const status = element('td');
        status.append(element('span', label(row), 'badge ' + (row.sessionState === 'connection_lost' ||
          row.autoClosed ? 'warn' : row.attendanceStatus === 'Logged In' ? 'good' : 'neutral')));
        tr.append(status, element('td', this.timestamp(row.loginAt)), element('td', this.timestamp(row.lastHeartbeatAt)));
        const logout = element('td', this.timestamp(row.logoutAt));
        if (row.estimatedLogout) logout.append(element('small', 'Estimated from last heartbeat'));
        const seconds = row.loginAt ? Math.max(0,Math.floor(((row.logoutAt ? new Date(row.logoutAt).getTime() : Date.now()) - new Date(row.loginAt).getTime()) / 1000)) : 0;
        tr.append(logout, element('td', Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm'), element('td', row.autoClosed ? 'Automatic / disconnected' : row.logoutAt ? 'Manual / ' + (row.disconnectReason || 'recorded') : '—'), element('td', row.shareId ? 'SHARING' : (row.screenState || 'permission_required').replaceAll('_',' ').toUpperCase()), element('td', this.timestamp(row.sharingStarted)));
        const actions = element('td');
        if (row.shareId) {
          const view = element('button', 'View', 'table-action'); view.type = 'button';
          view.addEventListener('click', () => this.openViewer(row)); actions.append(view);
        } else actions.textContent = '—';
        tr.append(actions); body.append(tr);
      }
      if (!body.children.length) {
        const td = element('td', 'No matching employees.', 'empty-state'); td.colSpan = 11;
        const tr = element('tr'); tr.append(td); body.append(tr);
      }
    }
    async openViewer(row) {
      await this.closeViewer();
      const epoch = ++this.viewerEpoch;
      $('screen-viewer-person').textContent = row.fullName + ' · ' + row.employeeId;
      $('screen-viewer-started').textContent = 'Sharing started: ' + this.timestamp(row.sharingStarted);
      $('screen-viewer-status').textContent = 'Checking Co-CEO authorization…';
      $('screen-viewer').showModal();
      try {
        const joined = await this.api('viewer-join', { shareId: row.shareId });
        if (epoch !== this.viewerEpoch) {
          this.api('peer-leave', { peerId: joined.peerId, generation: joined.generation }).catch(() => {}); return;
        }
        this.viewer = { ...joined };
        const ice = await this.api('ice', {});
        if (epoch !== this.viewerEpoch) return;
        this.peer = new window.LinkoraWorkforce.VideoPeer(this.client, joined.peerId, joined.generation, ice,
          (stream) => { if (epoch === this.viewerEpoch) $('screen-viewer-video').srcObject = stream; },
          (state) => {
            if (epoch !== this.viewerEpoch) return;
            $('screen-viewer-status').textContent = state === 'connected' ? 'Connected · Live video only'
              : state === 'failed' ? 'Connection failed. Close and retry; this network may require TURN.'
              : 'Connection: ' + state;
            if (state === 'failed') this.endViewer('Connection failed. Close and retry; this network may require TURN.');
          });
        this.cursor = 0; $('screen-viewer-status').textContent = 'Waiting for employee video…';
        this.viewerTimer = setInterval(() => this.pollViewer(), 2000); await this.pollViewer();
      } catch (error) { if (epoch === this.viewerEpoch) this.endViewer(error.message); }
    }
    async pollViewer() {
      if (!this.viewer || this.polling) return;
      this.polling = true; const epoch = this.viewerEpoch;
      try {
        const data = await this.api('poll-viewer', {
          peerId: this.viewer.peerId, generation: this.viewer.generation, afterId: this.cursor,
        });
        if (epoch !== this.viewerEpoch) return;
        if (!data.active) { this.endViewer(data.reason || 'Screen sharing ended by employee.'); return; }
        for (const signal of data.signals) {
          await this.peer.receive(signal); this.cursor = Math.max(this.cursor, Number(signal.id));
        }
      } catch (_) { if (epoch === this.viewerEpoch) this.endViewer('Viewer closed: authorization or connection could not be verified.'); }
      finally { this.polling = false; }
    }
    endViewer(reason) {
      const viewer = this.viewer; this.viewer = null; ++this.viewerEpoch;
      clearInterval(this.viewerTimer); this.viewerTimer = null;
      this.peer?.close(); this.peer = null;
      $('screen-viewer-video').srcObject = null; $('screen-viewer-status').textContent = reason;
      if (viewer) this.api('peer-leave', { peerId: viewer.peerId, generation: viewer.generation }).catch(() => {});
    }
    async closeViewer() {
      this.endViewer('Viewer closed.'); if ($('screen-viewer').open) $('screen-viewer').close();
    }
  }
  window.LinkoraWorkforceAdmin = WorkforceAdmin;
}());
