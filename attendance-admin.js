(function () {
  'use strict';
  const config = window.TENNIS_PORTAL_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const titles = {
    dashboard: ['Executive overview', 'A clear picture of your team, right now.'],
    workforce: ['Live Workforce', 'Portal presence and employee-approved work screen sharing.'],
    recordings: ['Screen Recordings', 'Private retained screen video and recording policy.'],
    live: ['Live attendance', 'Who is present and who needs attention.'],
    employees: ['Employees', 'Accounts, access and attendance history.'],
    today: ["Today's attendance", 'The complete workforce picture for the current company day.'],
    monthly: ['Monthly attendance', 'Presence, absences, late arrivals and hours.'],
    leaves: ['Employee leaves', 'Approve and review time away with a full audit trail.'],
    history: ['Attendance history', 'Search the authoritative session timeline.'],
    reports: ['Reports', 'Focused exports for management review.'],
    issues: ['Attendance issues', 'Reconcile old and incomplete sessions safely.'],
    audit: ['Audit log', 'Administrative changes with reasons and timestamps.'],
    settings: ['Attendance settings', 'Company time, workdays and policy thresholds.'],
  };
  let client;
  let workforce;
  let recordings;
  let currentUser = null;
  let currentView = 'dashboard';
  let settings = null;
  let users = [];
  let today = [];
  let liveSessions = [];
  let weekly = [];
  let monthly = [];
  let leaves = [];
  let history = [];
  let historyTotal = 0;
  let historyOffset = 0;
  let issues = [];
  let audit = [];
  let auditOffset = 0;
  let reportRows = [];
  let reportHeaders = [];
  let reportName = '';
  let sheetReportRows = [];
  let sheetReportTotal = 0;
  let detailUser = null;
  const pageSize = 50;

  function notice(message, kind, target = $('app-notice')) {
    target.textContent = message || '';
    target.dataset.kind = kind || '';
  }
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text != null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  }
  function button(label, handler, danger) {
    const el = node('button', label, 'table-action' + (danger ? ' danger' : ''));
    el.type = 'button'; el.addEventListener('click', handler); return el;
  }
  function cell(row, value, className) { const td = node('td', value, className); row.appendChild(td); return td; }
  function empty(body, columns, message) {
    body.replaceChildren();
    const tr = node('tr'); const td = cell(tr, message, 'empty-state'); td.colSpan = columns;
    body.appendChild(tr);
  }
  function statusBadge(value) {
    const klass = value === 'Signed In' || value === 'Logged In' || value === 'Present' || value === 'Active' ? 'good'
      : value === 'Signed Out' || value === 'Logged Out' || value === 'On Leave' || value === 'Approved' ? 'blue'
      : value === 'Absent' || value === 'Inactive' ? 'bad'
      : value === 'Incomplete' || value === 'Needs Review' || value === 'Late' ||
        value === 'Missing Sign-Out' || value === 'Pending' ? 'warn' : 'neutral';
    return node('span', value, 'badge ' + klass);
  }
  function attachBadge(td, value) { td.appendChild(statusBadge(value)); }
  function errorText(error) {
    if (error && error.code === '42501') return 'Access denied. Co-CEO authorization required.';
    if (error && error.code === '23505') return 'A matching employee, session or identifier already exists.';
    return error?.message || 'The request could not be completed. Please try again.';
  }
  function isAuthError(error) { return error?.status === 401 || error?.status === 403 || error?.code === '42501'; }
  async function rpc(name, args) {
    const result = await client.rpc(name, args || {});
    if (result.error) throw result.error;
    return result.data;
  }
  async function adminUsers(body) {
    const result = await client.functions.invoke('admin-users', { body });
    if (result.error) {
      let detail;
      try { detail = await result.error.context.json(); } catch (_) { /* fall through */ }
      const error = new Error(detail?.error || result.error.message || 'User management is unavailable.');
      error.status = result.error.context?.status;
      throw error;
    }
    if (result.data?.error) throw new Error(result.data.error);
    return result.data;
  }
  async function activity(body) {
    const result = await client.functions.invoke('manage-employee', { body });
    if (result.error) {
      let detail;
      try { detail = await result.error.context.json(); } catch (_) { /* fall through */ }
      throw new Error(detail?.error || result.error.message || 'Attendance service is unavailable.');
    }
    return result.data;
  }

  const tz = () => settings?.timezone || 'Asia/Karachi';
  function parts(value, options) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: tz(), ...options,
    }).formatToParts(new Date(value)).filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]));
  }
  function companyDay(value = new Date()) {
    const p = parts(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function monthStart(day) { return day.slice(0, 7) + '-01'; }
  function monthEnd(day) {
    const [y, m] = day.slice(0, 7).split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  function shiftDay(day, amount) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
  }
  function timestamp(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz(), day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
  }
  function timeOnly(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit' })
      .format(new Date(value));
  }
  function dateLabel(day) {
    if (!day) return '';
    const [y, m, d] = day.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  }
  function minutes(value) {
    if (value == null) return '—';
    const n = Math.max(0, Math.floor(Number(value) || 0));
    return Math.floor(n / 60) + 'h ' + String(n % 60).padStart(2, '0') + 'm';
  }
  async function loadDashboardSheet() {
    const list = $('dashboard-sheet');
    const status = $('dashboard-sheet-message');
    list.replaceChildren();
    status.textContent = 'Loading authoritative attendance records…';
    try {
      const report = await activity({ action: 'get-activity-report', reportVersion: 2, limit: 8 });
      if (report?.source !== 'supabase' || !Array.isArray(report.sessions) ||
          !Number.isFinite(Number(report.total)))
        throw new Error('Invalid attendance report response.');
      status.textContent = report.total
        ? report.total + ' attendance record(s) in Supabase.'
        : 'No attendance records found in Supabase.';
      report.sessions.forEach((session) => {
        const line = node('div', null, 'mini-row');
        line.append(node('span', (session.employee_profiles?.full_name || 'Unknown employee') + ' · ' +
          (session.employee_profiles?.employee_id || '—') + ' · ' +
          timestamp(session.login_at)),
        node('span', session.auto_closed ? (session.estimated_logout ? 'Auto Closed (estimated)' : 'Auto Closed') : session.status || 'Unknown'));
        list.append(line);
      });
    } catch (error) {
      status.textContent = 'Unable to load attendance records. Please check the backend connection. ' + errorText(error);
    }
  }
  async function loadSheetReport(reset = true) {
    const body = $('sheet-report-body');
    const status = $('sheet-report-message');
    const more = $('sheet-report-more');
    if (reset) { sheetReportRows = []; sheetReportTotal = 0; body.replaceChildren(); }
    more.disabled = true;
    status.textContent = 'Loading authoritative attendance records…';
    try {
      const report = await activity({
        action: 'get-activity-report', reportVersion: 2, limit: 200, offset: sheetReportRows.length,
      });
      if (report?.source !== 'supabase' || !Array.isArray(report.sessions) ||
          !Number.isFinite(Number(report.total)))
        throw new Error('Invalid attendance report response.');
      sheetReportTotal = Number(report.total);
      sheetReportRows.push(...report.sessions);
      report.sessions.forEach((session) => {
        const row = node('tr');
        const profile = session.employee_profiles || {};
        [
          profile.full_name || 'Unknown employee',
          profile.employee_id || '—',
          [profile.role, profile.scheme].filter(Boolean).join(' / ') || '—',
          companyDay(session.login_at), timeOnly(session.login_at),
          session.logout_at ? companyDay(session.logout_at) : '—', timeOnly(session.logout_at),
          minutes(session.workedMinutes),
        ].forEach((value) => cell(row, value));
        attachBadge(cell(row, ''), session.auto_closed ? (session.estimated_logout ? 'Auto Closed (estimated)' : 'Auto Closed') : session.status || 'Unknown');
        cell(row, timestamp(session.last_heartbeat_at)); cell(row, sessionSource(session));
        body.append(row);
      });
      if (!sheetReportRows.length) empty(body, 11, 'No attendance records found in Supabase.');
      status.textContent = sheetReportRows.length
        ? sheetReportRows.length + ' of ' + sheetReportTotal + ' Supabase records loaded.'
        : 'No attendance records found in Supabase.';
      more.hidden = sheetReportRows.length >= sheetReportTotal;
    } catch (error) {
      status.textContent = 'Unable to load attendance records. Please check the backend connection. ' + errorText(error);
      more.hidden = true;
      if (!sheetReportRows.length) empty(body, 11, 'Attendance records could not be loaded.');
    } finally { more.disabled = false; }
  }
  function sessionSource(row) {
    if (row.corrected_at || row.session_state === 'manually_closed' || row.disconnect_reason === 'manual_correction') return 'Manual correction';
    if (row.auto_closed || row.estimated_logout) return row.estimated_logout ? 'Automatic — estimated last heartbeat' : 'Automatic — server closure / ' + (row.disconnect_reason || 'disconnect');
    if (row.disconnect_reason === 'portal_closed') return 'Portal closed';
    if (row.disconnect_reason === 'manual_logout') return 'Normal logout';
    if (row.login_source === 'admin' && row.logout_source === 'admin') return 'Admin';
    if (row.login_source === 'admin') return 'Admin sign-in';
    if (row.logout_source === 'admin') return 'Employee + admin sign-out';
    return 'Employee';
  }
  function localInput(value) {
    if (!value) return '';
    const p = parts(value, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
  }
  function companyLocalToIso(value) {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) throw new Error('Enter a valid company-local date and time.');
    const desired = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
    let guess = desired;
    for (let attempt = 0; attempt < 4; attempt++) {
      const p = parts(guess, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      });
      const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
      guess += desired - shown;
    }
    if (localInput(guess) !== value) throw new Error('That local time is unavailable in the company timezone.');
    return new Date(guess).toISOString();
  }
  function eligiblePresent(row) { return row.session_count > 0; }
  function liveById(id) { return liveSessions.find((session) => session.user_id === id); }
  function currentlyPresent(row) { return Boolean(liveById(row.user_id)); }
  function userById(id) { return users.find((user) => user.id === id); }
  function todayById(id) { return today.find((row) => row.user_id === id); }

  async function confirmAction(title, description, label, requireReason = false) {
    const dialog = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-description').textContent = description;
    $('confirm-accept').textContent = label;
    let reasonField = $('confirm-reason-wrap');
    if (!reasonField) {
      reasonField = node('label', 'Reason', 'confirm-reason-wrap');
      const input = node('textarea'); input.id = 'confirm-reason'; input.minLength = 5; input.maxLength = 500;
      reasonField.appendChild(input);
      dialog.insertBefore(reasonField, dialog.querySelector('.form-actions'));
    }
    reasonField.hidden = !requireReason;
    const reasonInput = $('confirm-reason');
    reasonInput.value = '';
    reasonInput.required = requireReason;
    dialog.showModal();
    return await new Promise((resolve) => {
      const accept = $('confirm-accept'), cancel = $('confirm-cancel');
      function finish(value) {
        accept.removeEventListener('click', yes);
        cancel.removeEventListener('click', no);
        dialog.removeEventListener('cancel', no);
        dialog.close(); resolve(value);
      }
      function yes() {
        if (requireReason && reasonInput.value.trim().length < 5) {
          reasonInput.reportValidity(); reasonInput.focus(); return;
        }
        finish(requireReason ? reasonInput.value.trim() : true);
      }
      function no(event) { event?.preventDefault(); finish(false); }
      accept.addEventListener('click', yes); cancel.addEventListener('click', no);
      dialog.addEventListener('cancel', no);
    });
  }
  function closeDialog(id) { const dialog = $(id); if (dialog.open) dialog.close(); }
  async function actionRun(operation, success) {
    notice('Saving change…');
    try {
      await operation();
      notice(success, 'success');
      await refreshCore();
      activity({action:'sheet-sync',limit:5}).catch(()=>{ /* durable queue remains for retry */ });
      if (currentView === 'monthly') await loadMonthly();
      if (currentView === 'history') await loadHistory();
      if (currentView === 'audit') await loadAudit();
    } catch (error) {
      notice(errorText(error), 'error');
      if (isAuthError(error)) await checkAccess();
    }
  }

  async function enrichPresence(rows) {
    if (!rows?.length) return rows || [];
    const metadata = await rpc('portal_attendance_presence_metadata', { p_sessions: rows.map((row) => row.session_id) });
    const map = new Map((metadata || []).map((row) => [row.session_id, row]));
    return rows.map((row) => ({ ...row, ...map.get(row.session_id) }));
  }
  async function checkAccess() {
    recordings?.stop(); workforce?.stop();
    $('admin-app').hidden = true;
    $('access-screen').hidden = false;
    notice('Checking your access…', '', $('access-notice'));
    const identity = await client.auth.getUser();
    currentUser = identity.data?.user || null;
    $('access-signout').hidden = !currentUser;
    if (identity.error || !currentUser) {
      $('admin-login').hidden = false;
      notice('Sign in with an active Co-CEO account.', '', $('access-notice'));
      return;
    }
    const profile = await client.from('employee_profiles')
      .select('id,full_name,role,is_active').eq('id', currentUser.id).maybeSingle();
    if (profile.error || !profile.data?.is_active || profile.data.role !== 'Co-CEO') {
      $('admin-login').hidden = true;
      notice('Access denied. Co-CEO authorization required.', 'error', $('access-notice'));
      return;
    }
    try {
      settings = await rpc('portal_attendance_settings');
      const companyToday = companyDay();
      if (!$('month-select').dataset.touched) $('month-select').value = companyToday.slice(0, 7);
      if (!$('history-from').dataset.touched) {
        $('history-from').value = shiftDay(companyToday, -29);
        $('history-to').value = companyToday;
      }
      $('admin-identity').textContent = profile.data.full_name;
      $('access-screen').hidden = true;
      $('admin-app').hidden = false;
      $('admin-login').hidden = true;
      workforce.start();
      await refreshCore();
      recordings.start(users);
      showView(currentView);
    } catch (error) {
      recordings?.stop(); workforce?.stop();
      $('admin-app').hidden = true;
      $('access-screen').hidden = false;
      notice(errorText(error), 'error', $('access-notice'));
    }
  }
  async function refreshCore() {
    notice('Loading the admin dashboard…');
    const day = companyDay();
    const [userResult, todayRows, weekRows, issueRows, liveRows, leaveResult] = await Promise.all([
      adminUsers({ action: 'list' }),
      rpc('portal_attendance_daily_v2', { p_from: day, p_to: day }),
      rpc('portal_attendance_daily_v2', { p_from: shiftDay(day, -6), p_to: day }),
      rpc('portal_attendance_issues', { p_limit: 200 }),
      rpc('portal_attendance_live'),
      client.from('leave_requests').select('id,employee_id,leave_type,start_date,end_date,reason,status,created_at')
        .order('start_date',{ascending:false}).limit(500),
    ]);
    if (leaveResult.error) throw leaveResult.error;
    users = userResult.users || [];
    if (recordings?.running) recordings.setUsers(users);
    today = todayRows || [];
    weekly = weekRows || [];
    issues = issueRows || [];
    liveSessions = liveRows || [];
    leaves = leaveResult.data || [];
    populateEmployeeOptions();
    renderDashboard();
    renderLive();
    renderEmployees();
    renderToday();
    renderIssues();
    renderLeaves();
    await loadDashboardSheet();
    $('local-clock').textContent = 'Company time · ' + timestamp(new Date());
    notice('Updated ' + timeOnly(new Date()) + ' · ' + tz(), 'success');
  }
  function populateEmployeeOptions() {
    const select = $('history-employee'), selected = select.value;
    select.replaceChildren();
    const all = node('option', 'Everyone'); all.value = ''; select.appendChild(all);
    for (const user of users) {
      const option = node('option', user.fullName + ' · ' + user.employeeId);
      option.value = user.id; select.appendChild(option);
    }
    select.value = selected;
    const reportSelect = $('report-employee'), reportSelected = reportSelect.value;
    reportSelect.replaceChildren();
    const choose = node('option', 'Choose an employee'); choose.value = '';
    reportSelect.appendChild(choose);
    for (const user of users) {
      const option = node('option', user.fullName + ' · ' + user.employeeId);
      option.value = user.id; reportSelect.appendChild(option);
    }
    reportSelect.value = reportSelected;
    const scheme = $('month-scheme'), current = scheme.value;
    scheme.replaceChildren();
    const allSchemes = node('option', 'All schemes'); allSchemes.value = ''; scheme.appendChild(allSchemes);
    [...new Set(users.map((user) => user.scheme).filter(Boolean))].sort().forEach((name) => {
      const option = node('option', name); option.value = name; scheme.appendChild(option);
    });
    scheme.value = current;
  }
  function renderDashboard() {
    const active = users.filter((u) => u.isActive).length;
    const present = today.filter(eligiblePresent).length;
    const signedIn = today.filter(currentlyPresent).length;
    const signedOut = today.filter((r) => r.attendance_status === 'Signed Out').length;
    const absent = today.filter((r) => r.attendance_status === 'Absent').length;
    const onLeave = today.filter((r) => r.attendance_status === 'On Leave').length;
    const late = today.filter((r) => r.is_late).length;
    const missing = new Set(issues.filter((r) => r.status === 'Needs Review' ||
      ['Missing sign-out','Long open session','Multiple open sessions'].includes(r.issue))
      .map((r) => r.user_id)).size;
    const eligible = today.filter((r) => r.scheduled && r.active_on_day &&
      !['On Leave','Awaiting'].includes(r.attendance_status)).length;
    const items = [
      ['Active Employees', active, 'Portal access enabled'],
      ['Present Today', present, 'Recorded sessions'],
      ['Currently Signed In', signedIn, 'Valid live sessions'],
      ['Signed Out Today', signedOut, 'Completed today'],
      ['Absent Today', absent, 'Scheduled & active'],
      ['On Leave Today', onLeave, 'Approved leave'],
      ['Late Today', late, 'After grace period'],
      ['Missing Sign-Out', missing, 'Requires review'],
      ['Attendance Rate', eligible ? Math.round(100 * today.filter((r) =>
        r.scheduled && r.active_on_day && r.session_count > 0).length / eligible) + '%' : '—',
        'Approved leave excluded'],
    ];
    const grid = $('summary-grid'); grid.replaceChildren();
    for (const [label, value, sub] of items) {
      const card = node('div', null, 'metric');
      card.append(node('span', label), node('strong', value), node('small', sub)); grid.append(card);
    }
    $('live-number').textContent = String(signedIn);
    const chart = $('trend-chart'); chart.replaceChildren();
    const byDay = new Map();
    for (const row of weekly) {
      const value = byDay.get(row.attendance_date) || 0;
      byDay.set(row.attendance_date, value + (row.session_count > 0 ? 1 : 0));
    }
    const max = Math.max(1, ...byDay.values());
    for (let i = 6; i >= 0; i--) {
      const day = shiftDay(companyDay(), -i), count = byDay.get(day) || 0;
      const col = node('div', null, 'trend-column');
      const bar = node('i'); bar.style.height = Math.max(3, count / max * 125) + 'px';
      col.append(node('strong', count), bar, node('span', day.slice(5))); chart.append(col);
    }
    $('trend-label').textContent = 'Last 7 company days';
    const todayList = $('dashboard-today'); todayList.replaceChildren();
    const ordered = [...today].sort((a,b) => Number(eligiblePresent(b)) - Number(eligiblePresent(a))).slice(0,5);
    if (!ordered.length) todayList.append(node('p','No employees are available yet.','empty-state'));
    ordered.forEach((row) => {
      const line = node('div', null, 'mini-row');
      line.append(node('span', row.full_name + ' · ' + row.employee_id),
        node('span', row.attendance_status)); todayList.append(line);
    });
    const issueList = $('dashboard-issues'); issueList.replaceChildren();
    if (!issues.length) issueList.append(node('p','No attendance issues need review.','empty-state'));
    issues.slice(0,5).forEach((item) => {
      const line = node('div', null, 'mini-row');
      line.append(node('span', item.full_name), node('span', item.issue)); issueList.append(line);
    });
  }
  function renderPresentCards() {
    const present = today.filter(currentlyPresent), grid = $('present-cards');
    grid.replaceChildren();
    $('present-count').textContent = present.length + ' present';
    if (!present.length) {
      grid.append(node('p','No valid current-day open sessions. Review older open sessions under Attendance Issues.','empty-state'));
      return;
    }
    for (const row of present) {
      const activeSession = liveById(row.user_id);
      const card = node('article', null, 'present-card');
      card.append(node('div', row.full_name, 'person'), node('div', row.employee_id, 'code'));
      const dl = node('dl');
      for (const [label, value] of [
        ['Signed in', timeOnly(activeSession.login_at)],
        ['Present for', minutes((Date.now() - new Date(activeSession.login_at).getTime()) / 60000)],
        ['Role', row.role], ['Scheme', row.scheme],
      ]) { const wrap = node('div'); wrap.append(node('dt',label),node('dd',value)); dl.append(wrap); }
      card.append(dl); grid.append(card);
    }
  }
  function renderLive() {
    renderPresentCards();
    const body = $('live-body'); body.replaceChildren();
    if (!today.length) return empty(body,10,'No attendance records or employees today.');
    for (const row of today) {
      const tr = node('tr');
      cell(tr,row.full_name,'person').append(node('small',row.employee_id));
      cell(tr,row.role + ' · ' + row.scheme);
      cell(tr,timeOnly(row.first_sign_in)); cell(tr,timeOnly(row.last_sign_out));
       const activeSession = liveById(row.user_id);
       cell(tr,activeSession ? minutes((Date.now()-new Date(activeSession.login_at).getTime())/60000) + ' elapsed' : minutes(row.worked_minutes));
       attachBadge(cell(tr,''),activeSession ? 'Signed In' : row.attendance_status);
       cell(tr,row.leave_status === 'Approved' ? row.leave_type + ' · Approved' : '—');
       cell(tr,issues.filter((issue)=>issue.user_id===row.user_id).map((issue)=>issue.issue).join(', ') || '—');
       cell(tr,'').append(recordings.recordingBadge(row.user_id));
      cell(tr,'').append(button('Inspect',()=>openEmployee(row.user_id)));
      body.append(tr);
    }
  }
  function renderEmployees() {
    const term = $('employee-search').value.trim().toLowerCase();
    const status = $('employee-status-filter').value, role = $('employee-role-filter').value,
      attendance = $('employee-attendance-filter').value;
    const list = users.filter((u) =>
      (!term || [u.fullName,u.employeeId,u.email].join(' ').toLowerCase().includes(term)) &&
      (!status || (u.isActive ? 'active' : 'inactive') === status) &&
      (!role || u.role === role) &&
      (!attendance || (attendance === 'present' ? todayById(u.id)?.session_count > 0
        : attendance === 'late' ? todayById(u.id)?.is_late
          : todayById(u.id)?.attendance_status === attendance)));
    const body = $('employees-body'); body.replaceChildren();
    if (!list.length) return empty(body,8,'No employees match these filters.');
    for (const user of list) {
      const tr = node('tr'), daily = todayById(user.id);
      cell(tr,user.fullName,'person').append(node('small',user.employeeId));
      cell(tr,user.email || '—');
      cell(tr,user.role).append(node('small',user.scheme));
      attachBadge(cell(tr,''),user.isActive ? 'Active' : 'Inactive');
      attachBadge(cell(tr,''),daily?.attendance_status || 'Not Scheduled');
      cell(tr,timestamp(user.createdAt));
      cell(tr,timestamp(user.lastSignIn));
      const actions = cell(tr,'');
      actions.append(
        button('View',()=>openEmployee(user.id)),
        button('Edit',()=>editEmployee(user)),
        button(user.isActive ? 'Deactivate' : 'Reactivate',()=>toggleEmployee(user),user.isActive),
        button('Manual status',()=>changeManualStatus(user))
      );
      body.append(tr);
    }
  }
  function filteredToday() {
    const term = $('today-search').value.trim().toLowerCase(), filter = $('today-status-filter').value;
    return today.filter((row) => (!term || [row.full_name,row.employee_id].join(' ').toLowerCase().includes(term)) &&
      (!filter || (filter === 'present' ? row.session_count > 0
        : filter === 'late' ? row.is_late
          : row.attendance_status === filter)));
  }
  function renderToday() {
    $('today-date').textContent = dateLabel(companyDay()) + ' · ' + tz();
    const body = $('today-body'); body.replaceChildren();
    const list = filteredToday();
    if (!list.length) return empty(body,9,'No employees match this view.');
    for (const row of list) {
      const tr = node('tr');
      cell(tr,row.full_name,'person').append(node('small',row.employee_id));
      cell(tr,timeOnly(row.first_sign_in)); cell(tr,timeOnly(row.last_sign_out));
      cell(tr,minutes(row.worked_minutes));
      attachBadge(cell(tr,''),row.attendance_status);
      attachBadge(cell(tr,''),row.is_late ? 'Late' : 'On time');
      attachBadge(cell(tr,''),row.review_count ? 'Missing Sign-Out' : row.open_count > 1 ? 'Multiple open'
        : row.open_count > 0 && !currentlyPresent(row) ? 'Long open' : 'Clear');
      cell(tr,'').append(recordings.recordingBadge(row.user_id));
      cell(tr,'').append(button('Inspect',()=>openEmployee(row.user_id)));
      body.append(tr);
    }
  }
  async function loadMonthly() {
    notice('Calculating monthly attendance…');
    monthly = await rpc('portal_attendance_monthly_v2', { p_month: $('month-select').value + '-01' }) || [];
    renderMonthly();
    notice('Monthly report ready.', 'success');
  }
  function filteredMonthly() {
    const term = $('month-search').value.trim().toLowerCase(), scheme = $('month-scheme').value,
      status = $('month-status').value;
    return monthly.filter((r) => (!scheme || r.scheme === scheme) &&
      (!term || [r.full_name,r.employee_id].join(' ').toLowerCase().includes(term)) &&
      (!status || Number(r[status === 'present' ? 'present_days' : status === 'absent'
        ? 'absent_days' : status === 'leave' ? 'leave_days' : status === 'late'
          ? 'late_days' : 'missing_sign_out_days']) > 0));
  }
  function arrival(value) {
    if (value == null) return '—';
    const n = Number(value);
    return String(Math.floor(n/60)).padStart(2,'0') + ':' + String(Math.floor(n%60)).padStart(2,'0');
  }
  function renderMonthly() {
    const body = $('monthly-body'); body.replaceChildren();
    const list = filteredMonthly();
    if (!list.length) return empty(body,10,'No monthly attendance matches these filters.');
    for (const row of list) {
      const tr = node('tr');
      cell(tr,row.full_name,'person').append(node('small',row.employee_id));
      cell(tr,row.present_days); cell(tr,row.absent_days); cell(tr,row.leave_days);
      cell(tr,row.late_days); cell(tr,row.missing_sign_out_days);
      cell(tr,minutes(row.worked_minutes));
      cell(tr,row.average_hours == null ? '—' : row.average_hours + 'h');
      cell(tr,row.attendance_percent == null ? '—' : row.attendance_percent + '%');
      cell(tr,'').append(button('Breakdown',()=>openEmployee(row.user_id,$('month-select').value)));
      body.append(tr);
    }
  }
  function renderLeaves() {
    const body = $('leaves-body'); body.replaceChildren();
    const term = $('leave-search').value.trim().toLowerCase();
    const status = $('leave-status-filter').value;
    const list = leaves.filter((leave) => {
      const user = userById(leave.employee_id);
      return (!term || [user?.fullName,user?.employeeId].join(' ').toLowerCase().includes(term)) &&
        (!status || leave.status === status);
    });
    if (!list.length) return empty(body,7,'No leave records match these filters.');
    for (const leave of list) {
      const user = userById(leave.employee_id);
      const tr = node('tr');
      cell(tr,user?.fullName || 'Historical employee','person')
        .append(node('small',user?.employeeId || '—'));
      cell(tr,leave.leave_type); cell(tr,dateLabel(leave.start_date));
      cell(tr,dateLabel(leave.end_date));
      attachBadge(cell(tr,''),leave.status);
      cell(tr,leave.reason || '—');
      cell(tr,'').append(button('Edit',()=>openLeave(leave)));
      body.append(tr);
    }
  }
  function openLeave(leave) {
    const form = $('leave-form'); form.reset();
    const select = form.elements.namedItem('employeeId'); select.replaceChildren();
    users.forEach((user) => {
      const option = node('option',user.fullName + ' · ' + user.employeeId);
      option.value = user.id; select.append(option);
    });
    form.elements.namedItem('leaveId').value = leave?.id || '';
    select.value = leave?.employee_id || users[0]?.id || '';
    form.elements.namedItem('leaveType').value = leave?.leave_type || '';
    form.elements.namedItem('startDate').value = leave?.start_date || companyDay();
    form.elements.namedItem('endDate').value = leave?.end_date || companyDay();
    form.elements.namedItem('status').value = leave?.status || 'Pending';
    form.elements.namedItem('leaveReason').value = leave?.reason || '';
    $('leave-dialog-title').textContent = leave ? 'Edit leave' : 'Add leave';
    $('leave-dialog').showModal();
  }
  async function loadHistory() {
    notice('Loading session history…');
    const rows = await rpc('portal_attendance_sessions_filtered', {
      p_from: $('history-from').value, p_to: $('history-to').value,
      p_employee: $('history-employee').value || null,
      p_status: $('history-status').value || null,
      p_limit: pageSize, p_offset: historyOffset,
    });
    history = await enrichPresence(rows || []);
    historyTotal = Number(history[0]?.total_count || 0);
    renderHistory();
    notice('History ready.', 'success');
  }
  function renderHistory() {
    const body = $('history-body'); body.replaceChildren();
    if (!history.length) empty(body,8,'No sessions in this date range.');
    for (const row of history) {
      const tr = node('tr');
      cell(tr,row.full_name,'person').append(node('small',row.employee_id));
      cell(tr,timestamp(row.login_at)); cell(tr,timestamp(row.logout_at));
      cell(tr,minutes(row.worked_minutes));
      attachBadge(cell(tr,''),row.status);
      cell(tr,timestamp(row.last_heartbeat_at));
      cell(tr,sessionSource(row));
      cell(tr,'').append(button('Correct',()=>openCorrection(row)));
      body.append(tr);
    }
    $('history-page-label').textContent = history.length
      ? (historyOffset + 1) + '–' + (historyOffset + history.length) + ' of ' + historyTotal
      : 'No sessions';
    $('history-prev').disabled = historyOffset === 0;
    $('history-next').disabled = historyOffset + history.length >= historyTotal;
  }
  function renderIssues() {
    $('issues-count').textContent = issues.length
      ? issues.length + ' session(s) need review. No timestamps have been fabricated or removed.'
      : 'No attendance issues are currently detected.';
    const body = $('issues-body'); body.replaceChildren();
    if (!issues.length) return empty(body,6,'No attendance issues.');
    for (const item of issues) {
      const tr = node('tr');
      cell(tr,item.full_name,'person').append(node('small',item.employee_id));
      attachBadge(cell(tr,''),item.issue);
      cell(tr,timestamp(item.login_at)); cell(tr,item.open_count);
      attachBadge(cell(tr,''),item.status);
      cell(tr,'').append(button('Review',async()=>{
        const rows = await rpc('portal_attendance_sessions',{
          p_from: companyDay(new Date(new Date(item.login_at).getTime()-86400000)),
          p_to: companyDay(new Date(new Date(item.login_at).getTime()+86400000)),
          p_employee:item.user_id,p_limit:200,p_offset:0,
        });
        const session = rows?.find((row)=>row.session_id===item.session_id);
        if (session) openCorrection(session); else notice('Session could not be loaded. Use Attendance History.', 'error');
      }));
      body.append(tr);
    }
  }
  async function loadAudit() {
    notice('Loading audit history…');
    audit = await rpc('portal_attendance_audit',{p_limit:pageSize,p_offset:auditOffset}) || [];
    const body = $('audit-body'); body.replaceChildren();
    if (!audit.length) empty(body,5,'No audit entries on this page.');
    for (const entry of audit) {
      const tr = node('tr');
      cell(tr,timestamp(entry.created_at));
      cell(tr,entry.admin_name);
      cell(tr,entry.action.replaceAll('_',' '));
      cell(tr,entry.target_name);
      const summary = entry.reason || '';
      const changes = JSON.stringify(entry.after_state || {});
      cell(tr,summary + (changes && changes !== '{}' ? ' · ' + changes.slice(0,180) : ''));
      body.append(tr);
    }
    $('audit-page-label').textContent = audit.length
      ? (auditOffset+1) + '–' + (auditOffset+audit.length) : 'No entries';
    $('audit-prev').disabled = auditOffset===0;
    $('audit-next').disabled = audit.length<pageSize;
    notice('Audit history ready.', 'success');
  }
  function renderSettings() {
    const form = $('settings-form');
    form.elements.namedItem('timezone').value = settings.timezone;
    form.elements.namedItem('workday_start').value = settings.workday_start.slice(0,5);
    form.elements.namedItem('late_after_minutes').value = settings.late_after_minutes;
    form.elements.namedItem('expected_daily_hours').value = Number(settings.expected_daily_minutes)/60;
    form.elements.namedItem('max_session_hours').value = settings.max_session_hours;
    for (const box of $('workdays').querySelectorAll('input')) {
      box.checked = settings.workdays.includes(Number(box.value));
    }
  }
  function showView(view) {
    if (!titles[view]) return;
    currentView=view;
    document.querySelectorAll('.view').forEach((section)=>{section.hidden=section.id!=='view-'+view;});
    document.querySelectorAll('#admin-nav button').forEach((item)=>
      item.classList.toggle('active',item.dataset.view===view));
    $('view-title').textContent=titles[view][0];
    $('view-subtitle').textContent=titles[view][1];
    $('sidebar').classList.remove('open'); $('mobile-nav').setAttribute('aria-expanded','false');
    if (view==='workforce') workforce.refresh();
    if (view==='recordings') recordings.load().catch(fail);
    if (view==='monthly') loadMonthly().catch(fail);
    if (view==='history') loadHistory().catch(fail);
    if (view==='reports') loadSheetReport().catch(fail);
    if (view==='leaves') renderLeaves();
    if (view==='audit') loadAudit().catch(fail);
    if (view==='settings') renderSettings();
  }
  function fail(error) {
    notice(errorText(error),'error');
    if (isAuthError(error)) checkAccess();
  }

  function editEmployee(user) {
    const form=$('employee-form'); form.reset();
    $('employee-dialog-title').textContent=user ? 'Edit employee' : 'Add employee';
    $('initial-password-field').hidden=!!user;
    const fields={userId:user?.id||'',fullName:user?.fullName||'',
      employeeId:user?.employeeId||'',email:user?.email||'',scheme:user?.scheme||'',
      role:user?.role||'Employee',isActive:String(user?.isActive ?? true)};
    for (const [key,value] of Object.entries(fields)) form.elements.namedItem(key).value=value;
    form.elements.namedItem('password').required=!user;
    $('employee-dialog').showModal();
  }
  async function toggleEmployee(user) {
    const enabling=!user.isActive;
    const agreed=await confirmAction(
      enabling?'Reactivate employee?':'Deactivate employee?',
      enabling?'This restores the employee’s portal access.':
        'This ends future portal access. Existing attendance and audit history are preserved.',
      enabling?'Reactivate':'Deactivate');
    if (!agreed) return;
    await actionRun(async()=>{
      await adminUsers(enabling?{
        action:'edit',userId:user.id,employeeId:user.employeeId,fullName:user.fullName,
        scheme:user.scheme,role:user.role,email:user.email,isActive:true,
      }:{action:'disable',userId:user.id});
    },enabling?'Employee reactivated.':'Employee deactivated; history preserved.');
  }
  async function changeManualStatus(user) {
    const signedIn=Boolean(todayById(user.id)?.open_count) || user.signedIn;
    if (signedIn && issues.some((item)=>item.user_id===user.id && item.status==='Logged In')) {
      showView('issues');
      notice('Review this employee’s old or duplicate open sessions individually before marking them signed out.','error');
      return;
    }
    const next=signedIn?'Signed Out':'Signed In';
    const reason=await confirmAction('Mark '+user.fullName+' '+next+'?',
      'This administrative attendance change will be recorded with your name and reason.',
      'Mark '+next,true);
    if (!reason) return;
    await actionRun(async()=>{
      const result=await adminUsers({action:'attendance',userId:user.id,status:next,reason});
      if (result.warning) notice(result.warning,'error');
    },'Attendance status changed and audited.');
  }
  async function openEmployee(id,selectedMonth) {
    const user=userById(id); if (!user) return;
    detailUser=user;
    $('detail-name').textContent=user.fullName;
    $('detail-meta').textContent=[user.employeeId,user.email,user.role,user.scheme,
      user.isActive?'Active':'Inactive','Created '+timestamp(user.createdAt)].join(' · ');
    const month=selectedMonth||$('month-select').value||companyDay().slice(0,7);
    $('detail-dialog').showModal();
    recordings.employeeHistory(id).catch(fail);
    empty($('detail-days'),5,'Loading daily breakdown…');
    empty($('detail-sessions'),5,'Loading sessions…');
    try {
      const [days,sessions,summary]=await Promise.all([
        rpc('portal_attendance_daily_v2',{p_from:month+'-01',p_to:monthEnd(month+'-01'),p_employee:id}),
        rpc('portal_attendance_sessions',{p_from:shiftDay(companyDay(),-90),p_to:companyDay(),
          p_employee:id,p_limit:30,p_offset:0}),
        rpc('portal_attendance_monthly_v2',{p_month:month+'-01'}),
      ]);
      if (!$('detail-dialog').open || detailUser?.id!==id) return;
      const result=(summary||[]).find((row)=>row.user_id===id);
      const current=todayById(id);
      const completedDays=Math.max(1,Number(result?.present_days||0));
      const stats=$('detail-stats'); stats.replaceChildren();
      for (const [label,value] of [
        ['Today',current?.attendance_status||'—'],
        ['Today sign-in',timeOnly(current?.first_sign_in)],
        ['Today sign-out',timeOnly(current?.last_sign_out)],
        ['Today worked',minutes(current?.worked_minutes)],
        ['Present days',result?.present_days??0],
        ['Absent days',result?.absent_days??0],
        ['Leave days',result?.leave_days??0],
        ['Late days',result?.late_days??0],
        ['Missing sign-outs',result?.missing_sign_out_days??0],
        ['Worked',minutes(result?.worked_minutes??0)],
        ['Average daily hours',result?.average_hours == null ? '—' : result.average_hours + 'h'],
        ['Attendance rate',result?.attendance_percent == null ? '—' : result.attendance_percent + '%'],
      ]) {const card=node('div',null,'detail-stat');card.append(node('span',label),node('strong',value));stats.append(card);}
      const dayBody=$('detail-days'); dayBody.replaceChildren();
      if (!days?.length) empty(dayBody,5,'No daily records.');
      (days||[]).forEach((day)=>{
        const tr=node('tr');cell(tr,dateLabel(day.attendance_date));cell(tr,timeOnly(day.first_sign_in));
        cell(tr,timeOnly(day.last_sign_out));cell(tr,minutes(day.worked_minutes));
        attachBadge(cell(tr,''),day.attendance_status);dayBody.append(tr);
      });
      const sessionBody=$('detail-sessions');sessionBody.replaceChildren();
      if (!sessions?.length) empty(sessionBody,5,'No sessions in the last 90 days.');
      (sessions||[]).forEach((session)=>{
        const tr=node('tr');cell(tr,timestamp(session.login_at));cell(tr,timestamp(session.logout_at));
        cell(tr,sessionSource(session));attachBadge(cell(tr,''),session.status);
        cell(tr,'').append(button('Correct',()=>openCorrection(session)));sessionBody.append(tr);
      });
    } catch(error) { empty($('detail-days'),5,errorText(error)); }
  }
  function openCorrection(session) {
    closeDialog('detail-dialog');
    const form=$('correction-form');form.reset();
    form.elements.namedItem('sessionId').value=session.session_id;
    form.elements.namedItem('loginAt').value=localInput(session.login_at);
    form.elements.namedItem('logoutAt').value=localInput(session.logout_at);
    $('correction-person').textContent=session.full_name+' · '+session.employee_id+
      ' · All times shown in '+tz();
    $('correction-dialog').showModal();
  }
  function openManual(user) {
    closeDialog('detail-dialog');
    const form=$('manual-form');form.reset();
    form.elements.namedItem('employeeId').value=user.id;
    form.elements.namedItem('loginAt').value=localInput(new Date());
    $('manual-person').textContent=user.fullName+' · '+user.employeeId+
      ' · All times shown in '+tz();
    $('manual-dialog').showModal();
  }
  async function exportHistory() {
    notice('Preparing the selected history range…');
    const rows=[];
    for(let offset=0;offset<10000;offset+=200) {
      const page=await rpc('portal_attendance_sessions_filtered',{
        p_from:$('history-from').value,p_to:$('history-to').value,
        p_employee:$('history-employee').value||null,p_status:$('history-status').value||null,
        p_limit:200,p_offset:offset,
      })||[];
      rows.push(...await enrichPresence(page));
      if(page.length<200) break;
    }
    downloadCsv('attendance-history-'+$('history-from').value+'-to-'+$('history-to').value+'.csv',
      ['Employee','Employee ID','Sign in ('+tz()+')','Sign out ('+tz()+')','Minutes','Status','Last heartbeat ('+tz()+')','Logout type / source','Estimated logout','Correction reason'],
      rows.map((r)=>[r.full_name,r.employee_id,timestamp(r.login_at),timestamp(r.logout_at),r.worked_minutes,
        r.status,timestamp(r.last_heartbeat_at),sessionSource(r),r.estimated_logout?'Yes':'No',r.correction_reason]));
    notice('CSV prepared from '+rows.length+' Supabase sessions.','success');
  }
  function csvSafe(value) {
    let text=String(value??'');
    if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }
  function downloadCsv(name,headers,rows) {
    const lines=[headers,...rows].map((row)=>row.map(csvSafe).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+lines],{type:'text/csv;charset=utf-8'}));
    const link=node('a');link.href=url;link.download=name;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function selectReport(type) {
    if (type === 'employee' && !$('report-employee').value) {
      notice('Choose an employee for the individual report.', 'error'); return;
    }
    notice('Preparing report…');
    const month=$('month-select').value;
    if (type==='monthly' || type==='hours') {
      const rows=await rpc('portal_attendance_monthly_v2',{p_month:month+'-01'})||[];
      reportHeaders=type==='hours'
        ? ['Employee','Employee ID','Scheme','Worked minutes','Present days','Average hours']
        : ['Employee','Employee ID','Scheme','Present','Absent','Leave','Late','Missing sign-out','Worked minutes','Attendance %'];
      reportRows=rows.map((r)=>type==='hours'
        ? [r.full_name,r.employee_id,r.scheme,r.worked_minutes,r.present_days,r.average_hours]
        : [r.full_name,r.employee_id,r.scheme,r.present_days,r.absent_days,r.leave_days,r.late_days,
          r.missing_sign_out_days,r.worked_minutes,r.attendance_percent]);
    } else if (type==='issues') {
      const rows=await rpc('portal_attendance_issues',{p_limit:500})||[];
       reportHeaders=['Employee','Employee ID','Issue','Sign in ('+tz()+')','Status','Open count'];
       reportRows=rows.map((r)=>[r.full_name,r.employee_id,r.issue,timestamp(r.login_at),r.status,r.open_count]);
    } else {
      const from=type==='daily'?companyDay():month+'-01';
      const to=type==='daily'?companyDay():monthEnd(from);
       const rows=await rpc('portal_attendance_daily_v2',{p_from:from,p_to:to,
         p_employee:type==='employee' ? $('report-employee').value : null})||[];
      const selected=type==='late'?rows.filter((r)=>r.is_late)
        :type==='absence'?rows.filter((r)=>r.attendance_status==='Absent')
          :type==='leave'?rows.filter((r)=>r.attendance_status==='On Leave')
            :type==='missing'?rows.filter((r)=>r.attendance_status==='Missing Sign-Out'):rows;
       reportHeaders=['Date','Employee','Employee ID','Scheme','Sign in ('+tz()+')','Sign out ('+tz()+')',
        'Worked minutes','Attendance','Late'];
      reportRows=selected.map((r)=>[r.attendance_date,r.full_name,r.employee_id,r.scheme,
         timestamp(r.first_sign_in),timestamp(r.last_sign_out),r.worked_minutes,r.attendance_status,r.is_late?'Yes':'No']);
    }
    reportName=type+'-attendance-'+(type==='daily'?companyDay():month);
    const preview=$('report-preview');preview.replaceChildren();
    const table=node('table'),thead=node('thead'),headRow=node('tr');
    reportHeaders.forEach((h)=>headRow.append(node('th',h)));thead.append(headRow);
    const body=node('tbody');
    reportRows.slice(0,25).forEach((values)=>{const tr=node('tr');values.forEach((v)=>cell(tr,v??'—'));body.append(tr);});
    if (!reportRows.length) {const tr=node('tr'),td=cell(tr,'No records for this report.');td.colSpan=reportHeaders.length;body.append(tr);}
    table.append(thead,body);preview.append(table);preview.hidden=false;
    $('report-download').hidden=!reportRows.length;
    $('report-message').textContent=reportRows.length+' row(s). Preview shows up to 25; CSV includes all selected rows.';
    notice('Report ready.','success');
  }

  $('admin-login').addEventListener('submit',async(event)=>{
    event.preventDefault();
    const form=event.currentTarget;
    if(!form.reportValidity()) return;
    notice('Signing in…','',$('access-notice'));
    const result=await client.auth.signInWithPassword({
      email:form.elements.namedItem('email').value.trim(),
      password:form.elements.namedItem('password').value,
    });
    form.elements.namedItem('password').value='';
    if(result.error) {notice(errorText(result.error),'error',$('access-notice'));return;}
    await checkAccess();
  });
  for(const id of ['admin-signout','access-signout']) $(id).addEventListener('click',async()=>{
    workforce?.stop();
    await client.auth.signOut();
    currentUser=null;users=[];today=[];history=[];audit=[];
    $('admin-app').hidden=true;await checkAccess();
  });
  $('admin-nav').addEventListener('click',(event)=>{
    const target=event.target.closest('[data-view]');if(target) showView(target.dataset.view);
  });
  document.querySelectorAll('[data-go]').forEach((item)=>item.addEventListener('click',()=>showView(item.dataset.go)));
  $('mobile-nav').addEventListener('click',()=>{
    const open=$('sidebar').classList.toggle('open');
    $('mobile-nav').setAttribute('aria-expanded',String(open));
  });
  $('refresh-view').addEventListener('click',()=>{refreshCore().catch(fail);if(currentView==='recordings')recordings.load().catch(fail);});
  ['employee-search','employee-status-filter','employee-role-filter','employee-attendance-filter'].forEach((id)=>
    $(id).addEventListener(id.includes('search')?'input':'change',renderEmployees));
  ['today-search','today-status-filter'].forEach((id)=>
    $(id).addEventListener(id.includes('search')?'input':'change',renderToday));
  ['month-search','month-scheme','month-status'].forEach((id)=>
    $(id).addEventListener(id.includes('search')?'input':'change',renderMonthly));
  ['leave-search','leave-status-filter'].forEach((id)=>
    $(id).addEventListener(id.includes('search')?'input':'change',renderLeaves));
  $('add-leave').addEventListener('click',()=>openLeave(null));
  $('leave-form').addEventListener('submit',async(event)=>{
    event.preventDefault();
    const form=event.currentTarget;if(!form.reportValidity())return;
    const data=new FormData(form);
    const payload={
      p_leave_id:data.get('leaveId')||null,
      p_employee_id:data.get('employeeId'),
      p_leave_type:String(data.get('leaveType')).trim(),
      p_start_date:data.get('startDate'),p_end_date:data.get('endDate'),
      p_leave_reason:String(data.get('leaveReason')||'').trim(),
      p_status:data.get('status'),
      p_admin_reason:String(data.get('adminReason')).trim(),
    };
    if(payload.p_end_date<payload.p_start_date){notice('Leave end date must follow its start date.','error');return;}
    const approved=await confirmAction('Save leave record?',
      'Approved leave changes absence reporting. Your reason and the before/after record are audited.',
      'Save leave');
    if(!approved)return;
    closeDialog('leave-dialog');
    await actionRun(()=>rpc('portal_attendance_save_leave',payload),'Leave saved and audited.');
  });
  $('month-select').addEventListener('change',()=>{$('month-select').dataset.touched='true';loadMonthly().catch(fail);});
  $('add-employee').addEventListener('click',()=>editEmployee(null));
  $('employee-form').addEventListener('submit',async(event)=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()) return;
    const data=new FormData(form),id=data.get('userId');
    const payload={
      employeeId:String(data.get('employeeId')).trim(),fullName:String(data.get('fullName')).trim(),
      email:String(data.get('email')).trim(),scheme:String(data.get('scheme')).trim(),
      role:String(data.get('role')),isActive:data.get('isActive')==='true',
    };
    if((!id || userById(id)?.role!=='Co-CEO') && payload.role==='Co-CEO') {
      const approved=await confirmAction('Grant Co-CEO access?',
        'This role permits all protected admin panels and employee management.','Grant access');
      if(!approved) return;
    }
    const password=String(data.get('password')||'');
    closeDialog('employee-dialog');
    await actionRun(()=>adminUsers(id?{action:'edit',userId:id,...payload}:
      {action:'create',...payload,password}),id?'Employee updated.':'Employee created in Supabase Auth.');
    form.elements.namedItem('password').value='';
  });
  $('today-export').addEventListener('click',()=>{
    downloadCsv('attendance-today-'+companyDay()+'.csv',
      ['Employee','Employee ID','Date','Sign in ('+tz()+')','Sign out ('+tz()+')','Minutes','Status','Late'],
      filteredToday().map((r)=>[r.full_name,r.employee_id,r.attendance_date,
        timestamp(r.first_sign_in),timestamp(r.last_sign_out),r.worked_minutes,r.attendance_status,r.is_late?'Yes':'No']));
  });
  $('monthly-export').addEventListener('click',()=>{
    downloadCsv('attendance-monthly-'+$('month-select').value+'.csv',
      ['Employee','Employee ID','Scheme','Present','Absent','Leave','Late','Missing sign-out','Worked minutes','Average hours','Rate'],
      filteredMonthly().map((r)=>[r.full_name,r.employee_id,r.scheme,r.present_days,
        r.absent_days,r.leave_days,r.late_days,r.missing_sign_out_days,r.worked_minutes,
        r.average_hours,r.attendance_percent]));
  });
  $('history-apply').addEventListener('click',()=>{$('history-from').dataset.touched='true';historyOffset=0;loadHistory().catch(fail);});
  document.querySelectorAll('[data-range]').forEach((item)=>item.addEventListener('click',()=>{
    $('history-from').dataset.touched='true';
    const day=companyDay(),range=item.dataset.range;
    $('history-from').value=range==='month'?monthStart(day)
      :range==='previous'?monthStart(shiftDay(monthStart(day),-1))
      :shiftDay(day,1-Number(range));
    $('history-to').value=range==='previous'?shiftDay(monthStart(day),-1):day;
    historyOffset=0;loadHistory().catch(fail);
  }));
  $('history-prev').addEventListener('click',()=>{historyOffset=Math.max(0,historyOffset-pageSize);loadHistory().catch(fail);});
  $('history-next').addEventListener('click',()=>{historyOffset+=pageSize;loadHistory().catch(fail);});
  $('history-export').addEventListener('click',()=>exportHistory().catch(fail));
  $('issues-refresh').addEventListener('click',async()=>{
    try {issues=await rpc('portal_attendance_issues',{p_limit:200})||[];renderIssues();notice('Issues updated.','success');}
    catch(error){fail(error);}
  });
  $('audit-prev').addEventListener('click',()=>{auditOffset=Math.max(0,auditOffset-pageSize);loadAudit().catch(fail);});
  $('audit-next').addEventListener('click',()=>{auditOffset+=pageSize;loadAudit().catch(fail);});
  document.querySelectorAll('[data-report]').forEach((item)=>
    item.addEventListener('click',()=>selectReport(item.dataset.report).catch(fail)));
  $('report-download').addEventListener('click',()=>downloadCsv(reportName+'.csv',reportHeaders,reportRows));
  $('detail-add-session').addEventListener('click',()=>{if(detailUser) openManual(detailUser);});
  $('correction-form').addEventListener('submit',async(event)=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()) return;
    let login,logout;
    try {login=companyLocalToIso(form.elements.namedItem('loginAt').value);
      logout=companyLocalToIso(form.elements.namedItem('logoutAt').value);}
    catch(error){notice(errorText(error),'error');return;}
    const reason=form.elements.namedItem('reason').value.trim();
    const approved=await confirmAction('Apply attendance correction?',
      'This changes an authoritative Supabase session. Before/after times and your reason will be audited.',
      'Apply correction');
    if(!approved) return;
    const sessionId=form.elements.namedItem('sessionId').value;
    closeDialog('correction-dialog');
    await actionRun(()=>rpc('portal_attendance_correct_session',{
      p_session_id:sessionId,p_login_at:login,p_logout_at:logout,p_reason:reason,
    }),'Attendance corrected and audited.');
  });
  $('manual-form').addEventListener('submit',async(event)=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()) return;
    let login,logout;
    try {login=companyLocalToIso(form.elements.namedItem('loginAt').value);
      logout=companyLocalToIso(form.elements.namedItem('logoutAt').value);}
    catch(error){notice(errorText(error),'error');return;}
    const reason=form.elements.namedItem('reason').value.trim();
    const approved=await confirmAction('Add manual attendance session?',
      'This creates an authoritative Supabase record and an audit entry.','Add session');
    if(!approved) return;
    const employeeId=form.elements.namedItem('employeeId').value;
    closeDialog('manual-dialog');
    await actionRun(()=>rpc('portal_attendance_add_session',{
      p_employee_id:employeeId,p_login_at:login,p_logout_at:logout,p_reason:reason,
    }),'Manual session added and audited.');
  });
  $('settings-form').addEventListener('submit',async(event)=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()) return;
    const workdays=[...$('workdays').querySelectorAll('input:checked')].map((x)=>Number(x.value));
    if(!workdays.length){notice('Select at least one workday.','error');return;}
    const approved=await confirmAction('Save attendance policy?',
      'Changing timezone or workdays will affect future reporting and absence calculations. The change is audited.',
      'Save policy');
    if(!approved)return;
    await actionRun(async()=>{
      settings=await rpc('portal_attendance_update_settings',{
        p_timezone:form.elements.namedItem('timezone').value.trim(),
        p_workday_start:form.elements.namedItem('workday_start').value,
        p_late_after_minutes:Number(form.elements.namedItem('late_after_minutes').value),
        p_workdays:workdays,
        p_expected_daily_minutes:Math.round(Number(form.elements.namedItem('expected_daily_hours').value)*60),
        p_max_session_hours:Number(form.elements.namedItem('max_session_hours').value),
      });
      renderSettings();
    },'Attendance policy saved and audited.');
  });
  $('retry-sheet').addEventListener('click',async()=>{
    $('retry-sheet').disabled=true;
    try {const result=await activity({action:'sheet-sync'});
      $('sheet-status').textContent=result.pending+' pending · '+result.attempted+' attempted · '+result.failed+' failed';
      notice('Pending sheet deliveries checked.','success');
    }catch(error){notice(errorText(error),'error');}
    $('retry-sheet').disabled=false;
  });
  $('matrix-rebuild').addEventListener('click',async()=>{
    const from=$('matrix-from').value,to=$('matrix-to').value;
    if(!from||!to||to<from){notice('Choose a valid matrix date range.','error');return;}
    $('matrix-rebuild').disabled=true;
    try {const result=await activity({action:'matrix-sync',from,to});
      notice(result.updated+' matrix date(s) reconciled from Supabase.','success');}
    catch(error){notice(errorText(error),'error');}
    $('matrix-rebuild').disabled=false;
  });
  $('sheet-report-refresh').addEventListener('click',()=>loadSheetReport());
  $('sheet-report-more').addEventListener('click',()=>loadSheetReport(false));
  document.querySelectorAll('[data-close]').forEach((item)=>
    item.addEventListener('click',()=>closeDialog(item.dataset.close)));
  const day=new Date().toISOString().slice(0,10);
  $('month-select').value=day.slice(0,7);
  $('history-from').value=shiftDay(day,-29);$('history-to').value=day;
  $('matrix-from').value=shiftDay(day,-29);$('matrix-to').value=day;
  setInterval(()=>{if(!$('admin-app').hidden){
    if (!document.querySelector('dialog[open]')) refreshCore().catch(fail);
    else $('local-clock').textContent='Company time · '+timestamp(new Date());
  }},60000);
  try {
    if(!config.supabaseUrl||!config.supabaseAnonKey||config.supabaseUrl.includes('YOUR_'))
      throw new Error('The portal is not configured. Contact an administrator.');
    client=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},
    });
    recordings = new window.LinkoraRecordingsAdmin(client, {timestamp, day:companyDay, denied:fail, badges:()=>{renderToday();renderLive();workforce?.render();}});
    workforce = new window.LinkoraWorkforceAdmin(client, timestamp, fail, recordings);
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { recordings?.stop(); workforce.stop(); currentUser = null; $('admin-app').hidden = true;
        $('access-screen').hidden = false; $('admin-login').hidden = false;
        notice('Sign in with an active Co-CEO account.', '', $('access-notice')); }
    });
    window.addEventListener('pageshow', (event) => { if (event.persisted) checkAccess().catch(fail); });
    checkAccess().catch((error)=>notice(errorText(error),'error',$('access-notice')));
  }catch(error){notice(errorText(error),'error',$('access-notice'));}
}());
