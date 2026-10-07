const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const headers = ['Email','Employee Name','Employee ID','Scheme','Role',
  'Login Date','Login Time','Logout Date','Logout Time','Status','Session ID'];
const rows = [headers,
  ['one@example.com','One Person','EMP001','SEO','Employee',
    '2026-10-07','09:00:00','2026-10-07','09:15:00','Logged Out','11111111-1111-1111-1111-111111111111'],
  ['two@example.com','Two Person','EMP002','SEO','Employee',
    '2026-10-07','10:00:00','','','Logged In','22222222-2222-2222-2222-222222222222']];
const sheet = {
  getLastRow: () => rows.length,
  appendRow: row => rows.push(row),
  getRange(row, col, height, width) {
    return {
      getValues: () => rows.slice(row - 1, row - 1 + height)
        .map(r => r.slice(col - 1, col - 1 + width)),
      getDisplayValues: () => rows.slice(row - 1, row - 1 + height)
        .map(r => r.slice(col - 1, col - 1 + width).map(v => String(v ?? ''))),
      setValues(values) {
        values.forEach((valuesRow, index) =>
          valuesRow.forEach((value, offset) => { rows[row - 1 + index][col - 1 + offset] = value; }));
      },
    };
  },
};
const format = (date, pattern) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return pattern === 'yyyy-MM-dd'
    ? [parts.year, parts.month, parts.day].join('-')
    : [parts.hour, parts.minute, parts.second].join(':');
};
const context = vm.createContext({
  Date, JSON, Math, Number, String, isNaN,
  console: {error() {}},
  SpreadsheetApp: {getActiveSpreadsheet: () => ({getSheetByName: name =>
    name === 'Tennis Portal Logs' ? sheet : null})},
  PropertiesService: {getScriptProperties: () => ({getProperty: name =>
    name === 'GOOGLE_SHEETS_WEBHOOK_SECRET' ? 'test-only-secret' : null})},
  LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
  Utilities: {
    formatDate: (date, _zone, pattern) => format(date, pattern),
    parseDate: value => new Date(value.replace(' ', 'T') + '+05:00'),
  },
  ContentService: {MimeType: {JSON: 'json'}, createTextOutput: value => ({
    setMimeType: () => ({getContent: () => value}),
  })},
});
vm.runInContext(fs.readFileSync('google-apps-script/Code.gs', 'utf8'), context);
function post(payload) {
  return JSON.parse(context.doPost({postData: {contents: JSON.stringify(payload)}}).getContent());
}
const secret = 'test-only-secret';
const id = '33333333-3333-3333-3333-333333333333';

assert.equal(post({action:'report'}).error, 'Unauthorized');
let report = post({secret, action:'report'});
assert.equal(report.source, 'google_sheet');
assert.equal(report.total, 2);
assert.equal(report.sessions[0].employeeId, 'EMP002');
assert.equal(report.sessions[1].workedMinutes, 15);
assert.equal(report.sessions[1].loginAt, '2026-10-07T04:00:00.000Z');
assert.equal(post({secret, action:'report', from:'2026-10-08'}).total, 0);
assert.equal(post({secret, action:'report', from:'bad-date'}).ok, false);

assert.equal(post({secret, action:'login', sessionId:id,
  email:'three@example.com', employeeName:'Three Person', employeeId:'EMP003'}).ok, true);
assert.equal(rows.length, 4);
assert.equal(post({secret, action:'login', sessionId:id,
  email:'three@example.com', employeeName:'Three Person', employeeId:'EMP003'}).duplicate, true);
assert.equal(rows.length, 4);
assert.equal(post({secret, action:'logout', sessionId:id}).ok, true);
const firstLogout = rows[3][8];
assert.equal(post({secret, action:'logout', sessionId:id}).duplicate, true);
assert.equal(rows[3][8], firstLogout);

const recovered = post({secret, action:'logout', sessionId:'44444444-4444-4444-4444-444444444444',
  email:'four@example.com', employeeName:'Four Person', employeeId:'EMP004',
  loginAt:'2026-10-06T04:00:00.000Z'});
assert.equal(recovered.recovered, true);
assert.equal(rows[4][5], '2026-10-06');
assert.equal(rows[4][9], 'Logged Out');
rows[0][0] = 'Wrong header';
assert.equal(post({secret, action:'report'}).ok, false);
console.log('Google Sheets attendance contract tests passed');
