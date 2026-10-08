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
        workedTime(session.workedMinutes), session.status || '—'
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
      .eq('id', user.id).single();
    if (result.error || !result.data || !result.data.is_active) throw new Error('This account is not an active employee account.');
    return result.data;
  }
  async function restoreSession() {
    var result = await supabase.auth.getUser();
    if (!result.data.user) return;
    try {
      var profile = await loadProfile(result.data.user);
      var started = await invokeActivity('start-session', crypto.randomUUID());
      sessionStorage.setItem(sessionKey, started.sessionId);
      showEmployee(profile);
      if (started.warning) message(logoutMessage, started.warning, 'success');
    }
    catch (error) { await supabase.auth.signOut(); message(loginMessage, error.message, 'error'); }
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
      var activitySessionId = crypto.randomUUID();
      var started = await invokeActivity('start-session', activitySessionId);
      sessionStorage.setItem(sessionKey, started.sessionId || activitySessionId);
      showEmployee(profile);
      message(logoutMessage, started.warning || 'Your login has been recorded.', 'success');
    } catch (error) {
      await supabase.auth.signOut();
      message(loginMessage, error.message || 'Could not start the employee session.', 'error');
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
      var activitySessionId = sessionStorage.getItem(sessionKey) || null;
      var ended = await invokeActivity('end-session', activitySessionId);
      sessionStorage.removeItem(sessionKey);
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
  });
  restoreSession();
}());
