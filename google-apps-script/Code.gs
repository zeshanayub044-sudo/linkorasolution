// Linkora Solutions Google Sheet Login Activity backend. Bind this to the activity spreadsheet.
const SHEET_NAME = 'Login Activity';
const HEADERS = ['Record ID', 'User Name', 'User Email', 'Login Date', 'Login Time', 'Logout Date', 'Logout Time', 'Session Status', 'Created At', 'Updated At'];

function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', spreadsheet.getId());
}

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents || '{}');
    if (!['login', 'logout'].includes(String(request.action || ''))) throw new Error('Unsupported activity action.');
    const user = verifyCredential_(request.credential);
    if (!request.id || !/^[a-zA-Z0-9-]{16,80}$/.test(request.id)) throw new Error('Invalid session identifier.');
    const sheet = getSheet_();
    const now = new Date();
    const timezone = getRequiredProperty_('TIMEZONE');
    const row = findSessionRow_(sheet, request.id);
    if (request.action === 'login') {
      if (!row) {
        sheet.appendRow([request.id, user.name, user.email, format_(now, timezone, 'yyyy-MM-dd'), format_(now, timezone, 'hh:mm a'), '', '', 'Active', now, now]);
      } else {
        const loggedEmail = String(sheet.getRange(row, 3).getValue()).toLowerCase();
        if (loggedEmail !== user.email.toLowerCase()) throw new Error('Session ownership check failed.');
        sheet.getRange(row, 6, 1, 5).setValues([['', '', 'Active', sheet.getRange(row, 9).getValue(), now]]);
      }
    } else if (row) {
      const loggedEmail = String(sheet.getRange(row, 3).getValue()).toLowerCase();
      if (loggedEmail !== user.email.toLowerCase()) throw new Error('Session ownership check failed.');
      sheet.getRange(row, 6, 1, 5).setValues([[format_(now, timezone, 'yyyy-MM-dd'), format_(now, timezone, 'hh:mm a'), 'Completed', sheet.getRange(row, 9).getValue(), now]]);
    }
    return json_({ok:true});
  } catch (error) {
    console.error(error);
    return json_({ok:false, error:'Activity could not be saved.'});
  }
}

function verifyCredential_(credential) {
  if (!credential) throw new Error('Missing Google credential.');
  const clientId = getRequiredProperty_('GOOGLE_CLIENT_ID');
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), {muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw new Error('Google credential rejected.');
  const data = JSON.parse(response.getContentText());
  if (data.aud !== clientId || data.email_verified !== 'true') throw new Error('Google credential validation failed.');
  const allowed = (PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length || !allowed.includes(String(data.email).toLowerCase())) throw new Error('This Google account is not approved.');
  return {name:String(data.name || data.email), email:String(data.email)};
}

function getSheet_() {
  const sheet = SpreadsheetApp.openById(getRequiredProperty_('SHEET_ID')).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Login Activity sheet is missing. Run setup().');
  return sheet;
}
function findSessionRow_(sheet, id) {
  const cell = sheet.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}
function getRequiredProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Missing script configuration: ' + key);
  return value;
}
function format_(date, timezone, pattern) { return Utilities.formatDate(date, timezone, pattern); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
