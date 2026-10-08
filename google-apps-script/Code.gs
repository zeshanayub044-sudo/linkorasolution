// Bound to the existing Tennis Portal Logs spreadsheet.
const SHEET_NAME = 'Tennis Portal Logs';
const TIME_ZONE = 'Asia/Karachi';
const MATRIX_NAME = 'Attendance Matrix';
const HEADERS = [
  'Email', 'Employee Name', 'Employee ID', 'Scheme', 'Role',
  'Login Date', 'Login Time', 'Logout Date', 'Logout Time', 'Status', 'Session ID'
];

// GET is a health check only. Attendance reads and writes require the POST secret.
function doGet() {
  return response_({ok: true, service: 'Tennis Portal Logs', method: 'POST required'});
}

function doPost(event) {
  try {
    const payload = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('GOOGLE_SHEETS_WEBHOOK_SECRET');
    if (!secret || payload.secret !== secret) return response_({ok: false, error: 'Unauthorized'});
    if (payload.action === 'capabilities') return response_({ok:true,contractVersion:6});
    if (payload.action === 'report') return report_(getLogSheet_(), payload);
    if (payload.action === 'matrix-day') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try { return updateMatrixDay_(payload); }
      finally { lock.releaseLock(); }
    }
    if (!payload.sessionId || !/^[0-9a-f-]{36}$/i.test(String(payload.sessionId)) ||
        !['login', 'logout'].includes(payload.action)) {
      return response_({ok: false, error: 'Invalid activity request'});
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getLogSheet_();
      return payload.action === 'login' ? recordLogin_(sheet, payload) : recordLogout_(sheet, payload);
    } finally { lock.releaseLock(); }
  } catch (error) {
    console.error(error);
    return response_({ok: false, error: 'Attendance sheet request failed'});
  }
}

function getLogSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet && spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 1) throw new Error('Tennis Portal Logs sheet is missing');
  const actual = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (actual.join('|') !== HEADERS.join('|')) throw new Error('Tennis Portal Logs headers do not match');
  return sheet;
}

function recordLogin_(sheet, payload) {
  const lastRow = sheet.getLastRow();
  let existingRow = 0;
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 11, lastRow - 1, 1).getValues().flat();
    const index = ids.lastIndexOf(payload.sessionId);
    if (index >= 0) existingRow = index + 2;
  }
  if (!payload.email || !payload.employeeId || !payload.employeeName)
    return response_({ok: false, error: 'Employee details are required'});
  const loginAt = payload.loginAt ? new Date(payload.loginAt) : new Date();
  if (isNaN(loginAt.getTime())) return response_({ok: false, error: 'Invalid sign-in time'});
  const zone = payload.timezone || TIME_ZONE;
  const prefix = [safeCell_(payload.email), safeCell_(payload.employeeName),
    safeCell_(payload.employeeId), safeCell_(payload.scheme), safeCell_(payload.role),
    Utilities.formatDate(loginAt, zone, 'yyyy-MM-dd'),
    Utilities.formatDate(loginAt, zone, 'HH:mm:ss')];
  if (existingRow) {
    sheet.getRange(existingRow, 1, 1, 7).setValues([prefix]);
    return response_({ok:true, updated:true});
  }
  sheet.appendRow([
    ...prefix,
    '', '', 'Logged In', payload.sessionId
  ]);
  return response_({ok: true});
}

function recordLogout_(sheet, payload) {
  const lastRow = sheet.getLastRow();
  const ids = lastRow > 1 ? sheet.getRange(2, 11, lastRow - 1, 1).getValues().flat() : [];
  const index = ids.lastIndexOf(payload.sessionId);
  const logoutAt = payload.logoutAt ? new Date(payload.logoutAt) : new Date();
  if (isNaN(logoutAt.getTime())) return response_({ok: false, error: 'Invalid sign-out time'});
  const zone = payload.timezone || TIME_ZONE;
  const logoutStatus = payload.logoutType === 'auto_closed' ? 'Auto Closed (estimated)'
    : payload.logoutType === 'portal_closed' ? 'Portal Closed' : 'Logged Out';
  const logoutDate = Utilities.formatDate(logoutAt, zone, 'yyyy-MM-dd');
  const logoutTime = Utilities.formatDate(logoutAt, zone, 'HH:mm:ss');
  if (index < 0) {
    // A queued login may still be waiting. Use its original timestamp, never now.
    const loginAt = payload.loginAt && new Date(payload.loginAt);
    if (!loginAt || isNaN(loginAt.getTime()) || !payload.email || !payload.employeeId)
      return response_({ok: false, error: 'Session ID was not found'});
    sheet.appendRow([
      safeCell_(payload.email), safeCell_(payload.employeeName), safeCell_(payload.employeeId),
      safeCell_(payload.scheme), safeCell_(payload.role),
      Utilities.formatDate(loginAt, zone, 'yyyy-MM-dd'),
      Utilities.formatDate(loginAt, zone, 'HH:mm:ss'),
      logoutDate, logoutTime, logoutStatus, payload.sessionId
    ]);
    return response_({ok: true, recovered: true});
  }
  const row = index + 2;
  const loginAt = payload.loginAt ? new Date(payload.loginAt) : null;
  if (loginAt && !isNaN(loginAt.getTime())) {
    sheet.getRange(row, 1, 1, 7).setValues([[
      safeCell_(payload.email),safeCell_(payload.employeeName),safeCell_(payload.employeeId),
      safeCell_(payload.scheme),safeCell_(payload.role),
      Utilities.formatDate(loginAt, zone, 'yyyy-MM-dd'),
      Utilities.formatDate(loginAt, zone, 'HH:mm:ss')]]);
  }
  sheet.getRange(row, 8, 1, 3).setValues([[logoutDate, logoutTime, logoutStatus]]);
  return response_({ok: true});
}

// Supabase sends one authoritative day snapshot. UUID notes keep employee groups
// stable even when names or employee IDs change. The existing raw log is untouched.
function updateMatrixDay_(payload) {
  const day = String(payload.day || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    return response_({ok: false, error: 'Invalid matrix date'});
  let people;
  try { people = JSON.parse(payload.rows || '[]'); }
  catch (_) { return response_({ok:false, error:'Invalid matrix rows'}); }
  if (!Array.isArray(people) || people.length > 2000 || people.some(person =>
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(person.userId || ''))))
    return response_({ok: false, error: 'Invalid employee mapping'});
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(MATRIX_NAME);
  if (!sheet) {
    sheet = book.insertSheet(MATRIX_NAME);
    sheet.getRange(1, 1, 2, 1).setValues([['Attendance date'], ['Date']]);
    sheet.setFrozenRows(2);
    sheet.setFrozenColumns(1);
    sheet.setColumnWidth(1, 115);
  }
  const lastCol = sheet.getLastColumn();
  const ids = lastCol > 1 ? sheet.getRange(1, 2, 1, lastCol - 1).getNotes()[0] : [];
  const columns = {};
  for (let i = 0; i < ids.length; i += 3) {
    if (ids[i]) columns[ids[i]] = i + 2;
  }
  people.forEach(person => {
    const id = String(person.userId);
    if (!columns[id]) {
      const col = sheet.getLastColumn() + 1;
      if (col + 2 > sheet.getMaxColumns())
        sheet.insertColumnsAfter(sheet.getMaxColumns(), col + 2 - sheet.getMaxColumns());
      sheet.getRange(1, col, 1, 3).setValues([[
        safeCell_(person.fullName) + ' (' + safeCell_(person.employeeId) + ')', '', ''
      ]]);
      sheet.getRange(1, col).setNote(id);
      sheet.getRange(2, col, 1, 3).setValues([['Sign In', 'Sign Out', 'Status']]);
      sheet.setColumnWidths(col, 3, 110);
      sheet.setColumnWidth(col + 2, 155);
      columns[id] = col;
    } else {
      sheet.getRange(1, columns[id]).setValue(
        safeCell_(person.fullName) + ' (' + safeCell_(person.employeeId) + ')');
    }
  });
  const lastRow = sheet.getLastRow();
  const dates = lastRow > 2 ? sheet.getRange(3, 1, lastRow - 2, 1).getDisplayValues().flat() : [];
  let row = dates.indexOf(day) + 3;
  if (row === 2) {
    row = lastRow + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    sheet.getRange(row, 1).setNumberFormat('@').setValue(day);
  }
  const zone = payload.timezone || TIME_ZONE;
  people.forEach(person => {
    const col = columns[String(person.userId)];
    const signIn = person.signIn ? Utilities.formatDate(new Date(person.signIn), zone, 'HH:mm') : '—';
    const signOut = person.signOut ? Utilities.formatDate(new Date(person.signOut), zone, 'HH:mm') : '—';
    let status = String(person.status || '');
    if (status === 'On Leave') status = 'Leave';
    else if (status === 'Incomplete' || status === 'Missing Sign-Out' ||
      (status === 'Signed In' && day < Utilities.formatDate(new Date(), zone, 'yyyy-MM-dd')))
      status = 'Missing Sign-Out';
    else if (status === 'Signed Out') status = person.isLate ? 'Late' : 'Present';
    else if (status === 'Signed In') status = 'Signed In';
    else if (status === 'Not Scheduled') status = '—';
    sheet.getRange(row, col, 1, 3).setValues([[signIn, signOut, status]]);
  });
  sheet.getRange(1, 1, 2, sheet.getLastColumn()).setFontWeight('bold')
    .setBackground('#0b1f3a').setFontColor('#ffffff');
  sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).setWrap(true);
  return response_({ok: true, day, employees: people.length});
}

function safeCell_(value) {
  const text = String(value || '').trim();
  return /^[=+@-]/.test(text) ? "'" + text : text;
}

function report_(sheet, payload) {
  const lastRow = sheet.getLastRow();
  const values = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getDisplayValues() : [];
  const from = String(payload.from || '');
  const to = String(payload.to || '');
  const employeeId = String(payload.employeeId || '').trim().toLowerCase();
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) ||
      (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to))
    return response_({ok: false, error: 'Invalid report dates'});
  const filtered = values.filter(row => {
    const day = String(row[5] || '').trim();
    return (row[0] || row[10]) && (!from || day >= from) && (!to || day <= to) &&
      (!employeeId || String(row[2] || '').trim().toLowerCase() === employeeId);
  }).reverse();
  const offset = Math.max(0, Math.min(50000, Math.floor(Number(payload.offset) || 0)));
  const limit = Math.max(1, Math.min(500, Math.floor(Number(payload.limit) || 200)));
  const sessions = filtered.slice(offset, offset + limit).map(row => {
    const loginDate = String(row[5] || '').trim(), loginTime = String(row[6] || '').trim();
    const logoutDate = String(row[7] || '').trim(), logoutTime = String(row[8] || '').trim();
    const loginAt = parseSheetTime_(loginDate, loginTime);
    const logoutAt = parseSheetTime_(logoutDate, logoutTime);
    return {
      email: String(row[0] || ''), employeeName: String(row[1] || ''),
      employeeId: String(row[2] || ''), scheme: String(row[3] || ''),
      role: String(row[4] || ''), loginDate, loginTime, logoutDate, logoutTime,
      status: String(row[9] || ''), sessionId: String(row[10] || ''), loginAt, logoutAt,
      workedMinutes: loginAt && logoutAt
        ? Math.max(0, Math.floor((new Date(logoutAt) - new Date(loginAt)) / 60000)) : null
    };
  });
  return response_({ok: true, source: 'google_sheet', total: filtered.length, offset, sessions});
}

function parseSheetTime_(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) return null;
  try {
    return Utilities.parseDate(day + ' ' + time, TIME_ZONE,
      time.length === 5 ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd HH:mm:ss').toISOString();
  } catch (_) { return null; }
}

function response_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
