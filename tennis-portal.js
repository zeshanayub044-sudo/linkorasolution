(function () {
  'use strict';

  var config = window.TENNIS_PORTAL_CONFIG;
  var form = document.getElementById('login-form');
  var panel = document.getElementById('employee-panel');
  var loginMessage = document.getElementById('login-message');
  var logoutMessage = document.getElementById('logout-message');
  var sessionKey = 'linkora.tennisPortal.activitySessionId';

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
      body: { action: action, sessionId: activitySessionId }
    });
    if (result.error) {
      // Supabase exposes a non-2xx Function response as a generic error. Read
      // the safe JSON error returned by the function so the employee knows
      // that attendance was not saved instead of seeing a misleading success.
      var detail;
      try { detail = await result.error.context.json(); } catch (_) { /* use fallback below */ }
      throw new Error((detail && detail.error) || 'The attendance sheet could not record this activity. Please try again or contact an administrator.');
    }
    return result.data;
  }
  function showEmployee(profile) {
    document.getElementById('employee-name').textContent = profile.full_name;
    document.getElementById('employee-id').textContent = profile.employee_id;
    document.getElementById('employee-scheme').textContent = profile.scheme;
    document.getElementById('employee-role').textContent = profile.role;
    form.hidden = true;
    panel.hidden = false;
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
    try { showEmployee(await loadProfile(result.data.user)); }
    catch (error) { await supabase.auth.signOut(); message(loginMessage, error.message, 'error'); }
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    var button = form.querySelector('button');
    button.disabled = true;
    message(loginMessage, 'Signing in…');
    var data = new FormData(form);
    var result = await supabase.auth.signInWithPassword({ email: data.get('email'), password: data.get('password') });
    if (result.error) { message(loginMessage, 'Unable to sign in. Check your email and password.', 'error'); button.disabled = false; return; }
    try {
      var profile = await loadProfile(result.data.user);
      var activitySessionId = crypto.randomUUID();
      await invokeActivity('start-session', activitySessionId);
      sessionStorage.setItem(sessionKey, activitySessionId);
      showEmployee(profile);
      message(logoutMessage, 'Your login has been recorded.', 'success');
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
      var activitySessionId = sessionStorage.getItem(sessionKey);
      if (!activitySessionId) throw new Error('This browser session has no activity record. Please contact an administrator.');
      await invokeActivity('end-session', activitySessionId);
      sessionStorage.removeItem(sessionKey);
      await supabase.auth.signOut();
      panel.hidden = true; form.hidden = false; form.reset();
      message(loginMessage, 'You have been signed out.', 'success');
    } catch (error) { message(logoutMessage, error.message || 'Sign-out could not be recorded. Please try again.', 'error'); }
    button.disabled = false;
  });
  restoreSession();
}());
