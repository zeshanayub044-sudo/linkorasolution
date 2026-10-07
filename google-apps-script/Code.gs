// Bound to the existing Tennis Portal Logs spreadsheet.
const SHEET_NAME = 'Tennis Portal Logs';
const TIME_ZONE = 'Asia/Karachi';
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
    if (payload.action === 'report') return report_(getLogSheet_(), payload);
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
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 11, lastRow - 1, 1).getValues().flat();
    if (ids.includes(payload.sessionId)) return response_({ok: true, duplicate: true});
  }
  if (!payload.email || !payload.employeeId || !payload.employeeName)
    return response_({ok: false, error: 'Employee details are required'});
  const now = new Date();
  sheet.appendRow([
    payload.email, payload.employeeName, payload.employeeId, payload.scheme || '', payload.role || '',
    Utilities.formatDate(now, TIME_ZONE, 'yyyy-MM-dd'),
    Utilities.formatDate(now, TIME_ZONE, 'HH:mm:ss'),
    '', '', 'Logged In', payload.sessionId
  ]);
  return response_({ok: true});
}

function recordLogout_(sheet, payload) {
  const lastRow = sheet.getLastRow();
  const ids = lastRow > 1 ? sheet.getRange(2, 11, lastRow - 1, 1).getValues().flat() : [];
  const index = ids.lastIndexOf(payload.sessionId);
  const now = new Date();
  const logoutDate = Utilities.formatDate(now, TIME_ZONE, 'yyyy-MM-dd');
  const logoutTime = Utilities.formatDate(now, TIME_ZONE, 'HH:mm:ss');
  if (index < 0) {
    // A queued login may still be waiting. Use its original timestamp, never now.
    const loginAt = payload.loginAt && new Date(payload.loginAt);
    if (!loginAt || isNaN(loginAt.getTime()) || !payload.email || !payload.employeeId)
      return response_({ok: false, error: 'Session ID was not found'});
    sheet.appendRow([
      payload.email, payload.employeeName || '', payload.employeeId, payload.scheme || '', payload.role || '',
      Utilities.formatDate(loginAt, TIME_ZONE, 'yyyy-MM-dd'),
      Utilities.formatDate(loginAt, TIME_ZONE, 'HH:mm:ss'),
      logoutDate, logoutTime, 'Logged Out', payload.sessionId
    ]);
    return response_({ok: true, recovered: true});
  }
  const row = index + 2;
  const existing = sheet.getRange(row, 8, 1, 3).getDisplayValues()[0];
  if (existing[2] === 'Logged Out' && existing[0] && existing[1])
    return response_({ok: true, duplicate: true});
  sheet.getRange(row, 8, 1, 3).setValues([[logoutDate, logoutTime, 'Logged Out']]);
  return response_({ok: true});
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
