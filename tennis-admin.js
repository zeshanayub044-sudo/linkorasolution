(function () {
  'use strict';
  var client;
  var users = [];
  var editingId = null;
  var historyId = null;
  var historyPage = 0;
  var historyCount = 0;
  var initialized = false;
  var $ = function (id) { return document.getElementById(id); };

  function message(id, value, type) {
    var node = $(id);
    node.textContent = value;
    node.className = 'form-message' + (type ? ' ' + type : '');
  }
  function cell(row, value, className) {
    var node = document.createElement('td');
    node.textContent = value == null ? '—' : String(value);
    if (className) node.className = className;
    row.appendChild(node);
    return node;
  }
  function dateTime(value) {
    return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  }
  function datePart(value) {
    return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
  }
  function timePart(value) {
    return value ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(value)) : '—';
  }
  function duration(start, end) {
    if (!start || !end) return '—';
    var minutes = Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
    return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
  }
  async function invoke(action, data) {
    var result = await client.functions.invoke('admin-users', { body: Object.assign({ action: action }, data || {}) });
    if (result.error) {
      var detail;
      try { detail = await result.error.context.json(); } catch (_) { /* use fallback */ }
      throw new Error((detail && detail.error) || 'The request could not be completed.');
    }
    return result.data;
  }
  function renderFilters() {
    [['user-role-filter', 'role'], ['user-scheme-filter', 'scheme']].forEach(function (entry) {
      var select = $(entry[0]);
      var chosen = select.value;
      while (select.options.length > 1) select.remove(1);
      Array.from(new Set(users.map(function (user) { return user[entry[1]]; }).filter(Boolean))).sort().forEach(function (value) {
        var option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
      select.value = chosen;
    });
  }
  function actionButton(label, action, id, danger) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.id = id;
    button.className = 'table-action' + (danger ? ' danger' : '');
    return button;
  }
  function renderUsers() {
    var term = $('user-search').value.trim().toLowerCase();
    var attendance = $('user-attendance-filter').value;
    var account = $('user-account-filter').value;
    var role = $('user-role-filter').value;
    var scheme = $('user-scheme-filter').value;
    var shown = users.filter(function (user) {
      return (!term || user.fullName.toLowerCase().includes(term) || user.employeeId.toLowerCase().includes(term)) &&
        (!attendance || (attendance === 'in') === user.signedIn) &&
        (!account || (account === 'active') === user.isActive) &&
        (!role || user.role === role) && (!scheme || user.scheme === scheme);
    });
    var body = $('users-table-body');
    body.textContent = '';
    if (!shown.length) {
      var empty = document.createElement('tr');
      var td = cell(empty, 'No users match these filters.', 'report-empty');
      td.colSpan = 10;
      body.appendChild(empty);
    }
    shown.forEach(function (user) {
      var row = document.createElement('tr');
      cell(row, user.fullName, 'user-name');
      cell(row, user.employeeId);
      cell(row, user.email || '—');
      cell(row, user.role);
      cell(row, user.scheme);
      cell(row, user.signedIn ? 'Signed In' : 'Signed Out', user.signedIn ? 'status-in' : 'status-out');
      cell(row, dateTime(user.lastSignIn));
      cell(row, dateTime(user.lastSignOut));
      cell(row, user.isActive ? 'Active' : 'Disabled', user.isActive ? 'status-in' : 'status-out');
      var actions = document.createElement('td');
      actions.className = 'user-actions';
      actions.appendChild(actionButton('History', 'history', user.id));
      actions.appendChild(actionButton('Edit', 'edit', user.id));
      if (user.isActive) {
        actions.appendChild(actionButton('Remove', 'disable', user.id, true));
        actions.appendChild(actionButton(user.signedIn ? 'Mark Signed Out' : 'Mark Signed In',
          user.signedIn ? 'out' : 'in', user.id));
      }
      row.appendChild(actions);
      body.appendChild(row);
    });
    message('users-message', shown.length + ' of ' + users.length + ' portal user(s) shown.', 'success');
  }
  async function loadUsers() {
    message('users-message', 'Loading users…');
    try {
      users = (await invoke('list')).users || [];
      renderFilters();
      renderUsers();
    } catch (error) { message('users-message', error.message, 'error'); }
  }
  function formValues() {
    var data = new FormData($('user-form'));
    return {
      fullName: String(data.get('fullName') || '').trim(),
      employeeId: String(data.get('employeeId') || '').trim(),
      email: String(data.get('email') || '').trim(),
      password: String(data.get('password') || ''),
      role: String(data.get('role') || ''),
      scheme: String(data.get('scheme') || '').trim(),
      isActive: data.get('isActive') === 'active',
    };
  }
  function openForm(user) {
    editingId = user ? user.id : null;
    $('user-form').reset();
    $('user-form-title').textContent = user ? 'Edit User' : 'Add New User';
    $('user-form-submit').textContent = user ? 'Save changes' : 'Create user';
    $('user-password-label').hidden = Boolean(user);
    $('user-form').elements.password.required = !user;
    if (user) {
      var fields = $('user-form').elements;
      fields.fullName.value = user.fullName;
      fields.employeeId.value = user.employeeId;
      fields.email.value = user.email;
      fields.role.value = user.role;
      fields.scheme.value = user.scheme;
      fields.isActive.value = user.isActive ? 'active' : 'disabled';
    }
    message('user-form-message', '');
    $('user-form-dialog').showModal();
    $('user-form').elements.fullName.focus();
  }
  async function saveForm(event) {
    event.preventDefault();
    var form = $('user-form');
    if (!form.reportValidity()) return;
    var values = formValues();
    var duplicateId = users.find(function (user) { return user.id !== editingId && user.employeeId.toLowerCase() === values.employeeId.toLowerCase(); });
    var duplicateEmail = users.find(function (user) { return user.id !== editingId && user.email.toLowerCase() === values.email.toLowerCase(); });
    if (duplicateId || duplicateEmail) { message('user-form-message', duplicateId ? 'That employee ID is already in use.' : 'That email is already in use.', 'error'); return; }
    var button = $('user-form-submit');
    button.disabled = true;
    message('user-form-message', editingId ? 'Saving changes…' : 'Creating account…');
    try {
      var result = await invoke(editingId ? 'edit' : 'create', Object.assign(values, editingId ? { userId: editingId } : {}));
      $('user-form-dialog').close();
      form.reset();
      await Promise.all([loadUsers(), loadAudit()]);
      message('users-message', result.warning || (editingId ? 'User updated.' : 'New user created. They can sign in with the email and temporary password.'), result.warning ? 'error' : 'success');
    } catch (error) { message('user-form-message', error.message, 'error'); }
    button.disabled = false;
  }
  async function disableUser(user) {
    if (!window.confirm('Are you sure you want to remove ' + user.fullName + '? Their account will be disabled and attendance history kept.')) return;
    message('users-message', 'Disabling user…');
    try {
      var result = await invoke('disable', { userId: user.id });
      await Promise.all([loadUsers(), loadAudit()]);
      message('users-message', result.warning || (user.fullName + ' was disabled. Attendance history was kept.'), result.warning ? 'error' : 'success');
    } catch (error) { message('users-message', error.message, 'error'); }
  }
  async function changeAttendance(user, signedIn) {
    var status = signedIn ? 'Signed In' : 'Signed Out';
    var reason = window.prompt('Reason for marking ' + user.fullName + ' as ' + status + ':');
    if (reason === null) return;
    if (!reason.trim()) { message('users-message', 'A reason is required for manual attendance changes.', 'error'); return; }
    if (!window.confirm('Mark ' + user.fullName + ' as ' + status + '? This will be recorded in the audit log.')) return;
    message('users-message', 'Recording attendance change…');
    try {
      var result = await invoke('attendance', { userId: user.id, status: status, reason: reason.trim() });
      await Promise.all([loadUsers(), loadAudit()]);
      message('users-message', result.warning || (user.fullName + ' marked ' + status + '.'), result.warning ? 'error' : 'success');
    } catch (error) { message('users-message', error.message, 'error'); }
  }
  function source(session) {
    var names = [];
    if (session.login_source === 'admin') {
      var loginAdmin = users.find(function (user) { return user.id === session.login_actor_id; });
      names.push('Sign-in: admin' + (loginAdmin ? ' (' + loginAdmin.fullName + ')' : ''));
    } else names.push('Sign-in: user');
    if (session.logout_at) {
      if (session.logout_source === 'admin') {
        var logoutAdmin = users.find(function (user) { return user.id === session.logout_actor_id; });
        names.push('Sign-out: admin' + (logoutAdmin ? ' (' + logoutAdmin.fullName + ')' : ''));
      } else names.push('Sign-out: user');
    }
    if (session.login_reason) names.push('In reason: ' + session.login_reason);
    if (session.logout_reason) names.push('Out reason: ' + session.logout_reason);
    return names.join(' · ');
  }
  async function loadHistory() {
    message('history-message', 'Loading attendance history…');
    try {
      var result = await invoke('history', { userId: historyId, page: historyPage });
      var body = $('history-table-body');
      if (historyPage === 0) body.textContent = '';
      (result.sessions || []).forEach(function (session) {
        var row = document.createElement('tr');
        cell(row, datePart(session.login_at));
        cell(row, timePart(session.login_at));
        cell(row, datePart(session.logout_at));
        cell(row, timePart(session.logout_at));
        cell(row, duration(session.login_at, session.logout_at));
        cell(row, source(session));
        body.appendChild(row);
      });
      historyCount = result.count || 0;
      if (!historyCount) {
        var empty = document.createElement('tr');
        var td = cell(empty, 'No attendance history has been recorded.', 'report-empty');
        td.colSpan = 6;
        body.appendChild(empty);
      }
      $('history-more').hidden = (historyPage + 1) * 50 >= historyCount;
      message('history-message', Math.min((historyPage + 1) * 50, historyCount) + ' of ' + historyCount + ' session(s).', 'success');
    } catch (error) { message('history-message', error.message, 'error'); }
  }
  function openHistory(user) {
    historyId = user.id;
    historyPage = 0;
    $('user-history-title').textContent = 'Attendance history · ' + user.fullName;
    $('history-table-body').textContent = '';
    $('user-history-dialog').showModal();
    loadHistory();
  }
  function auditDetails(entry) {
    if (entry.reason) return entry.reason;
    var before = entry.before_state || {};
    var after = entry.after_state || {};
    return Object.keys(after).filter(function (key) { return JSON.stringify(before[key]) !== JSON.stringify(after[key]); })
      .map(function (key) { return key.replaceAll('_', ' ') + ': ' + String(after[key]); }).join(' · ') || '—';
  }
  async function loadAudit() {
    message('audit-message', 'Loading admin activity…');
    try {
      var entries = (await invoke('audit')).entries || [];
      var body = $('audit-table-body');
      body.textContent = '';
      entries.forEach(function (entry) {
        var row = document.createElement('tr');
        cell(row, dateTime(entry.created_at));
        cell(row, entry.admin_name);
        cell(row, entry.action.replaceAll('_', ' '));
        cell(row, entry.target_name);
        cell(row, auditDetails(entry));
        body.appendChild(row);
      });
      if (!entries.length) {
        var empty = document.createElement('tr');
        var td = cell(empty, 'No admin activity yet.', 'report-empty');
        td.colSpan = 5;
        body.appendChild(empty);
      }
      message('audit-message', entries.length + ' recent admin action(s).', 'success');
    } catch (error) { message('audit-message', error.message, 'error'); }
  }
  function init(nextClient) {
    client = nextClient;
    if (!initialized) {
      initialized = true;
      $('add-user-button').addEventListener('click', function () { openForm(null); });
      $('user-form').addEventListener('submit', saveForm);
      $('audit-refresh').addEventListener('click', loadAudit);
      $('history-more').addEventListener('click', function () { historyPage++; loadHistory(); });
      ['user-search', 'user-attendance-filter', 'user-account-filter', 'user-role-filter', 'user-scheme-filter'].forEach(function (id) {
        $(id).addEventListener(id === 'user-search' ? 'input' : 'change', renderUsers);
      });
      document.querySelectorAll('[data-close-dialog]').forEach(function (button) {
        button.addEventListener('click', function () { button.closest('dialog').close(); });
      });
      $('users-table-body').addEventListener('click', function (event) {
        var button = event.target.closest('button[data-action]');
        if (!button) return;
        var user = users.find(function (item) { return item.id === button.dataset.id; });
        if (!user) return;
        if (button.dataset.action === 'history') openHistory(user);
        if (button.dataset.action === 'edit') openForm(user);
        if (button.dataset.action === 'disable') disableUser(user);
        if (button.dataset.action === 'in') changeAttendance(user, true);
        if (button.dataset.action === 'out') changeAttendance(user, false);
      });
    }
    loadUsers();
    loadAudit();
  }
  window.TennisAdmin = { init: init };
}());
