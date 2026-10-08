const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const tabs = new Map();
let lockCount = 0;
function makeSheet() {
  const cells = [], notes = [];
  const at = (r,c) => cells[r-1]?.[c-1] ?? '';
  const sheet = {
    getLastRow() { return cells.reduce((last,row,i) => row.some(Boolean) ? i+1 : last,0); },
    getLastColumn() { return Math.max(0,...cells.map(row =>
      row.reduce((last,value,i) => value ? i+1 : last,0))); },
    getMaxRows() { return 1000; }, getMaxColumns() { return 26; },
    setFrozenRows() {}, setFrozenColumns() {}, setColumnWidth() {}, setColumnWidths() {},
    insertColumnsAfter() {}, insertRowsAfter() {},
    getRange(row,col,height=1,width=1) {
      const range = {
        getDisplayValues() { return Array.from({length:height},(_,i) =>
          Array.from({length:width},(_,j) => String(at(row+i,col+j)))); },
        getNotes() { return Array.from({length:height},(_,i) =>
          Array.from({length:width},(_,j) => notes[row+i-1]?.[col+j-1] ?? '')); },
        setNote(value) { (notes[row-1] ||= [])[col-1] = value; return range; },
        setValues(values) { values.forEach((line,i) => line.forEach((value,j) =>
          { (cells[row+i-1] ||= [])[col+j-1] = value; })); return range; },
        setValue(value) { (cells[row-1] ||= [])[col-1] = value; return range; },
        setNumberFormat() { return range; }, setFontWeight() { return range; },
        setBackground() { return range; }, setFontColor() { return range; },
        setWrap() { return range; },
      };
      return range;
    },
    cells, notes,
  };
  return sheet;
}
const spreadsheet = {
  getSheetByName: name => tabs.get(name),
  insertSheet(name) { const tab=makeSheet();tabs.set(name,tab);return tab; },
};
const context=vm.createContext({
  Date,JSON,Math,Number,String,isNaN,console:{error(){}},
  SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-secret'})},
  LockService:{getScriptLock:()=>({waitLock(){lockCount++;},releaseLock(){}})},
  Utilities:{formatDate(date,_zone,pattern){
    const iso=date.toISOString();
    return pattern==='yyyy-MM-dd' ? iso.slice(0,10) : iso.slice(11,16);
  }},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({
    setMimeType:()=>({getContent:()=>value}),
  })},
});
vm.runInContext(fs.readFileSync('google-apps-script/Code.gs','utf8'),context);
const a='11111111-1111-1111-1111-111111111111';
const b='22222222-2222-2222-2222-222222222222';
function post(day,people) {
  return JSON.parse(context.doPost({postData:{contents:JSON.stringify({
    secret:'test-secret',action:'matrix-day',day,timezone:'UTC',rows:JSON.stringify(people),
  })}}).getContent());
}
const first=[{userId:a,employeeId:'EMP001',fullName:'One Person',
  signIn:'2026-10-07T09:00:00Z',signOut:null,status:'Signed In'}];
assert.equal(post('2026-10-07',first).ok,true);
let matrix=tabs.get('Attendance Matrix');
assert.equal(matrix.cells[2][0],'2026-10-07');
assert.equal(matrix.cells[2][3],'Missing Sign-Out');
assert.equal(matrix.notes[0][1],a);
assert.equal(post('2026-10-07',[{...first[0],signOut:'2026-10-07T18:00:00Z',status:'Signed Out'}]).ok,true);
assert.equal(matrix.getLastRow(),3);
assert.equal(matrix.cells[2][2],'18:00');
assert.equal(matrix.cells[2][3],'Present');
assert.equal(post('2026-10-07',[{...first[0],fullName:'Renamed Person',
  status:'Missing Sign-Out'}, {userId:b,employeeId:'EMP002',fullName:'Two Person',
  signIn:null,signOut:null,status:'On Leave'}]).ok,true);
assert.equal(matrix.getLastColumn(),7);
assert.equal(matrix.cells[0][1],'Renamed Person (EMP001)');
assert.equal(matrix.cells[2][3],'Missing Sign-Out');
assert.equal(matrix.cells[2][6],'Leave');
assert.equal(matrix.notes[0][4],b);
assert.equal(post('2026-10-08',[{...first[0],signIn:null,status:'Absent'},
  {userId:b,employeeId:'EMP002',fullName:'Two Person',status:'Not Scheduled'}]).ok,true);
assert.equal(matrix.getLastRow(),4);
assert.equal(matrix.cells[3][3],'Absent');
assert.equal(matrix.cells[3][6],'—');
assert.equal(lockCount,4);
console.log('Attendance matrix idempotency, mapping and statuses passed');
