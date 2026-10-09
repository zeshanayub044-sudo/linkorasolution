(function () {
  'use strict';

  var config = window.TENNIS_PORTAL_CONFIG;
  var form = document.getElementById('login-form');
  var panel = document.getElementById('employee-panel');
  var resetPanel = document.getElementById('reset-password-panel');
  var loginMessage = document.getElementById('login-message');
  var resetPasswordMessage = document.getElementById('reset-password-message');
  var logoutMessage = document.getElementById('logout-message');
  var adminEntry = document.querySelector('.portal-admin-entry');
  var sessionKey = 'linkora.tennisPortal.activitySessionId';
  function storeSession(value) { try { if (value) sessionStorage.setItem(sessionKey, value); else sessionStorage.removeItem(sessionKey); } catch (_) { /* presence retains the ID in memory */ } }
  function currentSession() { if (presence.sessionId) return presence.sessionId; try { return sessionStorage.getItem(sessionKey); } catch (_) { return null; } }

  function isCoCeo(profile) {
    return String(profile.role || '').trim().toLowerCase() === 'co-ceo';
  }

  function message(element, text, type) {
    element.textContent = text;
    element.className = 'form-message' + (type ? ' ' + type : '');
  }
  function configured() {
    return config && config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('YOUR_');
  }
  if (!configured()) {
    message(loginMessage, 'The portal has not been configured yet. Please contact an administrator.', 'error');
    form.querySelector('button').disabled = true;
    return;
  }
  var supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var attendanceLoginAt = null;
  var recordingConfig = null;
  var recording = new window.LinkoraRecording.Recording(supabase, null, function (state) {
    var status = document.getElementById('recording-status');
    status.textContent = state.message || state.state;
    status.dataset.state = state.state;
    document.getElementById('recording-pending').textContent = state.pending ? state.pending + ' segment(s) awaiting upload.' : '';
    if (state.state === 'interrupted' && presence.active) {
      screenShare.stop('Screen sharing stopped. Your work session requires screen sharing. Resume screen sharing or Clock Out.');
    }
  });
  async function loadRecordingPolicy() {
    try {
      recordingConfig = await window.LinkoraRecording.api(supabase, 'config');
      document.getElementById('monitoring-notice').textContent = recordingConfig.notice;
      document.getElementById('monitoring-panel').hidden = !recordingConfig.enabled;
      document.getElementById('monitoring-ack').disabled = !recordingConfig.enabled;
      document.getElementById('recording-panel').hidden = !recordingConfig.enabled;
      document.getElementById('share-policy-copy').textContent = recordingConfig.enabled
        ? 'Entire Screen sharing and visible recording are required during Clock In. Your browser always asks for permission. Do not share content you do not intend management to review.'
        : 'Clock In requests optional live screen sharing. Your browser always asks for approval. Recording is not enabled.';
      document.getElementById('share-banner-copy').textContent = recordingConfig.enabled
        ? 'Your approved work screen is visible to authorized Co-CEOs and recorded while this session is active. Screen video only; no audio or webcam. You can stop sharing at any time.'
        : 'Authorized management can view the screen you selected. No audio or recording.';
    } catch (error) {
      recordingConfig = null;
      message(logoutMessage, 'The monitoring policy could not be checked. Retry before starting a work session.', 'error');
    }
  }
  function recordingRequired() { return !!recordingConfig?.enabled; }
  var presence = new window.LinkoraWorkforce.Presence(supabase, function (state) {
    var status = document.getElementById('presence-message');
    var resume = document.getElementById('resume-attendance');
    var clockOut = document.getElementById('clock-out-button');
    resume.hidden = !!state.active; clockOut.hidden = !state.active;
    document.getElementById('screen-share-start').hidden = !state.active || !!screenShare?.stream || !!screenShare?.pendingStream || !!screenShare?.starting || resume.disabled;
    if (state.error) {
      status.textContent = state.active ? 'Connection Lost · Attendance may end after 15 seconds without a heartbeat.' : 'Attendance could not be checked. Retry Clock In to resolve its status.';
      if (!state.active) screenShare.stop('Sharing stopped because portal authorization ended.');
    } else if (state.active) {
      attendanceLoginAt = state.loginAt || attendanceLoginAt;
      document.getElementById('clock-in-time').textContent = attendanceLoginAt ? new Date(attendanceLoginAt).toLocaleString() : '—';
      status.textContent = 'CLOCKED IN · Online · Last heartbeat ' + new Date(state.lastHeartbeatAt).toLocaleTimeString();
    } else {
      attendanceLoginAt = null; storeSession(null);
      status.textContent = state.autoClosed || state.sessionState === 'auto_closed'
        ? 'Previous attendance session ended because the portal connection was lost. Clock In when ready.'
        : state.sessionState === 'completed' ? 'CLOCKED OUT · You are still signed in.' : 'NOT CLOCKED IN';
      screenShare.stop('Screen Share Permission Required. Clock In to request sharing.');
    }
  });
  var screenShare = new window.LinkoraWorkforce.ScreenShare(supabase, presence, {
    start: document.getElementById('screen-share-start'), stop: document.getElementById('screen-share-stop'),
    banner: document.getElementById('screen-share-banner'), message: document.getElementById('screen-share-message'),
    viewers: document.getElementById('screen-share-viewers')
  }, {
    resume: function () { return startWork(true); },
    recordingEnabled: recordingRequired,
    stopped: function (reason) { if (recording.mode !== 'idle') return recording.stop(reason || 'screen_share_stopped'); }
  });
  recording.presence = presence;
  setInterval(function () {
    var elapsed = attendanceLoginAt && presence.active ? Math.max(0, Math.floor((Date.now() - new Date(attendanceLoginAt).getTime()) / 1000)) : 0;
    document.getElementById('working-duration').textContent = [Math.floor(elapsed / 3600),Math.floor(elapsed % 3600 / 60),elapsed % 60].map(function (n) { return String(n).padStart(2,'0'); }).join(':');
  }, 1000);
  async function startWork(resuming) {
    var button = document.getElementById(resuming ? 'screen-share-start' : 'resume-attendance');
    if (button.disabled) return;
    if (!recordingConfig) { await loadRecordingPolicy(); message(logoutMessage, 'Policy refreshed. Please press Clock In or Resume Screen Sharing again.', 'error'); return; }
    if (recordingRequired() && !document.getElementById('monitoring-ack').checked) {
      message(logoutMessage, 'Please acknowledge the Work Session Monitoring notice before sharing your screen.', 'error');
      document.getElementById('monitoring-ack').focus(); return;
    }
    button.disabled = true; button.textContent = resuming ? 'RESUMING…' : 'CLOCKING IN…';
    // Native permission is requested synchronously from the employee click, before any network await.
    var capture = screenShare.requestCapture();
    var began = false;
    try {
      var selected;
      var prepared;
      if (recordingRequired()) {
        selected = await capture;
        if (selected.error) throw new Error('Screen sharing is required to start your work session. Please share your entire screen to continue.');
        prepared = window.LinkoraRecording.prepare(selected.stream, recordingConfig);
      }
      var identity = await supabase.auth.getUser();
      if (!identity.data.user) throw new Error('Please sign in again.');
      var profile = await loadProfile(identity.data.user);
      var started;
      if (recordingRequired()) {
        var approved = await window.LinkoraRecording.api(supabase, 'begin', {
          acknowledged: true, noticeVersion: recordingConfig.notice_version,
          displaySurface: prepared.displaySurface, mimeType: prepared.mimeType, codec: prepared.codec,
          sessionId: crypto.randomUUID(), clientId: presence.clientId, tabId: presence.tabId, background: document.hidden
        });
        began = true;
        started = await presence.start(identity.data.user.id, false, approved.presence);
        await recording.start(prepared, approved);
      } else started = await presence.start(identity.data.user.id, !resuming);
      if (!started.active) throw new Error('Clock In was not confirmed. Please retry.');
      storeSession(started.sessionId); showEmployee(profile);
      var sharing = await screenShare.start(capture);
      if (recordingRequired() && !sharing) throw new Error('Live sharing could not start. The work session will end safely; try again.');
      if (prepared?.displaySurface === 'unknown') message(logoutMessage, 'This browser cannot verify the selected source. Select Entire Screen; management can review what you chose.', 'success');
      else message(logoutMessage, recordingRequired() ? 'Clocked In · Screen recording and live sharing active.' : 'Clock In saved.', 'success');
    } catch (error) {
      capture.then(function (selected) { selected.stream?.getTracks().forEach(function (track) { track.stop(); }); });
      if (began && presence.active) {
        recording.abort('recording_start_failed');
        try { await window.LinkoraWorkforce.api(supabase, 'clock-out', {sessionId: presence.sessionId}); presence.stop(); storeSession(null); }
        catch (_) { presence.stop(); storeSession(null); /* Server lease ends the interrupted attempt. */ }
      }
      screenShare.stopLocal('Screen sharing is required to start a recorded work session. Try again.');
      document.getElementById('presence-message').textContent = presence.active ? 'CLOCKED IN · Resume screen sharing or Clock Out.' : 'NOT CLOCKED IN';
      document.getElementById('resume-attendance').hidden = presence.active;
      document.getElementById('clock-out-button').hidden = !presence.active;
      message(logoutMessage, error.message, 'error');
    } finally { button.disabled = false; button.textContent = resuming ? 'RESUME SCREEN SHARING' : 'CLOCK IN / TRY AGAIN'; }
  }
  document.getElementById('resume-attendance').addEventListener('click', function () { startWork(false); });
  async function endWork() {
    var recordingResult = await recording.stop('clock_out', true);
    presence.stop();
    await window.LinkoraWorkforce.api(supabase, 'clock-out', {sessionId: presence.sessionId});
    presence.stop(); await screenShare.stop('Screen sharing stopped with Clock Out.');
    storeSession(null); attendanceLoginAt = null;
    document.getElementById('presence-message').textContent = 'CLOCKED OUT · You are still signed in.';
    document.getElementById('resume-attendance').hidden = false;
    document.getElementById('clock-out-button').hidden = true;
    document.getElementById('screen-share-start').hidden = true;
    document.getElementById('monitoring-ack').checked = false;
    if (recordingResult.status === 'finalizing') document.getElementById('recording-status').textContent = 'RECORDING COMPLETED · Verified stored segments.';
  }
  document.getElementById('clock-out-button').addEventListener('click', async function () {
    if (this.disabled || !presence.active) return;
    this.disabled = true; this.textContent = 'FINALIZING WORK SESSION…';
    try { await endWork(); message(logoutMessage, 'Clock Out saved. Your account remains signed in.', 'success'); }
    catch (error) {
      await screenShare.stop('Recording stopped. Clock Out connection failed; attendance will close under the server lease.');
      storeSession(null); attendanceLoginAt = null;
      document.getElementById('resume-attendance').hidden = false;
      document.getElementById('clock-out-button').hidden = true;
      document.getElementById('presence-message').textContent = 'Connection Lost · Work capture stopped. Attendance closes after its existing 15-second lease.';
      message(logoutMessage,error.message,'error');
    }
    finally { this.disabled = false; this.textContent = 'CLOCK OUT'; }
  });

  async function invokeActivity(action, activitySessionId) {
    var result = await supabase.functions.invoke('manage-employee', {
      body: { action: action, sessionId: activitySessionId,
        reportVersion: action === 'get-activity-report' ? 2 : undefined }
    });
    if (result.error) {
      // Read the safe backend error when a Supabase attendance action fails.
      var detail;
      try { detail = await result.error.context.json(); } catch (_) { /* use fallback below */ }
      throw new Error((detail && detail.error) || 'The attendance service is unavailable. Please try again or contact an administrator.');
    }
    return result.data;
  }
  function workedTime(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    var minutes = Math.max(0, Math.floor(Number(value)));
    return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
  }
  function renderActivityReport(sessions, timezone) {
    var body = document.getElementById('report-table-body');
    body.textContent = '';
    if (!sessions.length) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 9;
      emptyCell.className = 'report-empty';
      emptyCell.textContent = 'No attendance records found in Supabase.';
      emptyRow.appendChild(emptyCell); body.appendChild(emptyRow); return;
    }
    sessions.forEach(function (session) {
      var profile = session.employee_profiles || {};
      var values = [
        profile.full_name || 'Unknown employee',
        profile.employee_id || '—',
        [profile.role, profile.scheme].filter(Boolean).join(' / ') || '—',
        session.login_at ? new Date(session.login_at).toLocaleDateString('en-CA',{timeZone:timezone}) : '—',
        session.login_at ? new Date(session.login_at).toLocaleTimeString('en-GB',{timeZone:timezone}) : '—',
        session.logout_at ? new Date(session.logout_at).toLocaleDateString('en-CA',{timeZone:timezone}) : '—',
        session.logout_at ? new Date(session.logout_at).toLocaleTimeString('en-GB',{timeZone:timezone}) : '—',
        workedTime(session.workedMinutes), session.auto_closed ? (session.estimated_logout ? 'Auto Closed (estimated)' : 'Auto Closed') : session.disconnect_reason === 'portal_closed' ? 'Portal Closed' : session.status || '—'
      ];
      var row = document.createElement('tr');
      values.forEach(function (value, index) { var cell = document.createElement('td'); cell.textContent = value; if (index === 8) cell.className = 'report-status'; row.appendChild(cell); });
      body.appendChild(row);
    });
  }
  async function loadActivityReport() {
    var reportMessage = document.getElementById('report-message');
    var refreshButton = document.getElementById('report-refresh');
    refreshButton.disabled = true;
    message(reportMessage, 'Loading employee activity…');
    try {
      var report = await invokeActivity('get-activity-report');
      if (report?.source !== 'supabase' || !Array.isArray(report.sessions))
        throw new Error('Unable to load attendance records. Please check the backend connection.');
      renderActivityReport(report.sessions,report.timezone || 'UTC');
      message(reportMessage, report.sessions.length
        ? report.sessions.length + ' latest Supabase attendance record(s).'
        : 'No attendance records found in Supabase.', report.sessions.length ? 'success' : '');
    } catch (error) {
      var reportError = error.message || 'The activity report could not be loaded.';
      if (reportError === 'Invalid request') {
        reportError = 'The admin report service needs to be deployed. Please deploy the updated manage-employee Edge Function.';
      }
      message(reportMessage, reportError, 'error');
    }
    refreshButton.disabled = false;
  }
  function showLogin() {
    resetPanel.hidden = true;
    panel.hidden = true;
    form.hidden = false;
    adminEntry.hidden = false;
  }
  function showPasswordReset() {
    recording.abort('password_recovery'); presence.stop(); screenShare.stop('Sharing stopped for password recovery.');
    form.hidden = true;
    panel.hidden = true;
    resetPanel.hidden = false;
    adminEntry.hidden = true;
    document.getElementById('new-password').focus();
  }
  function showEmployee(profile) {
    document.getElementById('employee-name').textContent = profile.full_name;
    document.getElementById('employee-id').textContent = profile.employee_id;
    document.getElementById('employee-scheme').textContent = profile.scheme;
    document.getElementById('employee-role').textContent = profile.role;
    if (!recordingConfig) loadRecordingPolicy();
    var isExecutive = isCoCeo(profile);
    document.getElementById('ceo-panel').hidden = !isExecutive;
    if (isExecutive) loadActivityReport();
    form.hidden = true;
    panel.hidden = false;
    adminEntry.hidden = true;
  }
  async function loadProfile(user) {
    var result = await supabase.from('employee_profiles')
      .select('full_name, employee_id, scheme, role, is_active')
      .eq('id', user.id).maybeSingle();
    if (result.error) throw new Error('Your profile could not be checked. Please retry the connection.');
    if (!result.data || !result.data.is_active) {
      var denied = new Error('This account is not an active employee account.'); denied.authDenied = true; throw denied;
    }
    return result.data;
  }
  async function restoreSession() {
    if (resetPanel.hidden === false) return;
    var profile;
    var result = await supabase.auth.getUser();
    if (!result.data.user) return;
    try {
      profile = await loadProfile(result.data.user);
      var started = await presence.start(result.data.user.id);
      storeSession(started.sessionId);
      showEmployee(profile);
      if (started.warning) message(logoutMessage, started.warning, 'success');
    }
    catch (error) {
      if (error.authDenied) await supabase.auth.signOut();
      if (profile && !error.authDenied) {
        showEmployee(profile); message(logoutMessage, error.message, 'error');
        document.getElementById('presence-message').textContent = 'Attendance has not connected. Press Clock In to resolve your attendance status.';
        document.getElementById('resume-attendance').hidden = false;
      } else message(loginMessage, error.message, 'error');
    }
  }
  document.getElementById('forgot-password-button').addEventListener('click', async function () {
    var email = document.getElementById('email').value.trim();
    if (!email) { message(loginMessage, 'Enter your email address first, then select Forgot password.', 'error'); document.getElementById('email').focus(); return; }
    var button = document.getElementById('forgot-password-button');
    button.disabled = true;
    message(loginMessage, 'Sending password reset email…');
    var result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    if (result.error) message(loginMessage, 'Could not send a reset email: ' + result.error.message, 'error');
    else message(loginMessage, 'Password reset email sent. Open the link in that email to choose a new password.', 'success');
    button.disabled = false;
  });
  document.getElementById('reset-password-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var resetForm = event.currentTarget;
    if (!resetForm.reportValidity()) return;
    var newPassword = document.getElementById('new-password').value;
    if (newPassword !== document.getElementById('confirm-password').value) { message(resetPasswordMessage, 'The passwords do not match.', 'error'); return; }
    var button = resetForm.querySelector('button');
    button.disabled = true;
    message(resetPasswordMessage, 'Saving new password…');
    var result = await supabase.auth.updateUser({ password: newPassword });
    if (result.error) { message(resetPasswordMessage, result.error.message || 'Could not update password.', 'error'); button.disabled = false; return; }
    await supabase.auth.signOut();
    resetForm.reset(); showLogin();
    message(loginMessage, 'Password updated. You can now sign in with your new password.', 'success');
    button.disabled = false;
  });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    var button = form.querySelector('button');
    button.disabled = true;
    message(loginMessage, 'Signing in…');
    var data = new FormData(form);
    var result = await supabase.auth.signInWithPassword({ email: data.get('email'), password: data.get('password') });
    if (result.error) {
      var detail = result.error.message === 'Email not confirmed'
        ? 'Please confirm this account’s email address in Supabase before signing in.'
        : 'Unable to sign in: ' + (result.error.message || 'check your email and password.');
      message(loginMessage, detail, 'error'); button.disabled = false; return;
    }
    try {
      var profile = await loadProfile(result.data.user);
      await window.LinkoraWorkforce.api(supabase, 'portal-login', {});
      var started = await presence.start(result.data.user.id);
      storeSession(started.sessionId);
      form.reset();
      showEmployee(profile);
      message(logoutMessage, started.warning || 'You are signed in. Press Clock In to begin attendance.', 'success');
    } catch (error) {
      if (error.authDenied) await supabase.auth.signOut();
      form.reset();
      if (profile && !error.authDenied) {
        showEmployee(profile); message(logoutMessage, error.message || 'Attendance has not connected. Please retry.', 'error');
        document.getElementById('resume-attendance').hidden = false;
      } else message(loginMessage, error.message || 'Could not start the employee session. Please retry the connection.', 'error');
    }
    button.disabled = false;
  });
  document.getElementById('logout-button').addEventListener('click', async function () {
    var button = document.getElementById('logout-button');
    button.disabled = true;
    message(logoutMessage, 'Recording sign-out…');
    try {
      // A Supabase session can be restored after a refresh or on another tab,
      // while sessionStorage is intentionally browser-tab scoped. In that case
      // the server safely closes this employee's most recent active session.
      var activitySessionId = currentSession() || null;
      var ended = {};
      if (presence.active && activitySessionId) await endWork();
      presence.stop();
      await screenShare.stop('Screen sharing ended with sign-out.');
      storeSession(null);
      await supabase.auth.signOut();
      panel.hidden = true; form.hidden = false; form.reset();
      adminEntry.hidden = false;
      message(loginMessage, ended.warning || 'You have been signed out.', 'success');
    } catch (error) { message(logoutMessage, error.message || 'Sign-out could not be recorded. Please try again.', 'error'); }
    button.disabled = false;
  });
  document.getElementById('report-refresh').addEventListener('click', loadActivityReport);
  supabase.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') showPasswordReset();
    if (event === 'SIGNED_OUT') { recordingConfig = null; document.getElementById('monitoring-ack').checked = false; recording.abort('account_signed_out'); presence.stop(); screenShare.stopLocal('Screen sharing ended with sign-out.'); showLogin(); }
  });
  restoreSession();
}());
