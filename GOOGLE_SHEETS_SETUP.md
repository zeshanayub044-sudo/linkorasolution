# Linkora simple activity log

This replaces Supabase with:

`Google work account → Google Apps Script → private Login Activity Google Sheet`

The spreadsheet remains private to its owner. The public website contains only a Google OAuth Client ID and an Apps Script URL; these are not secrets. Apps Script validates each Google ID token before it writes or closes a session row.

## Sheet columns

`Record ID | User Name | User Email | Login Date | Login Time | Logout Date | Logout Time | Session Status | Created At | Updated At`

## One-time setup

1. Create a Google Sheet named **Linkora Login Activity**.
2. In the Sheet, click **Extensions**, then **Apps Script**.
3. Delete the editor contents and paste `google-apps-script/Code.gs`.
4. In the left sidebar click **Project Settings**, then under **Script properties** click **Add script property**. Add these three entries:
   - `GOOGLE_CLIENT_ID`: the client ID created in step 8
   - `TIMEZONE`: `Asia/Karachi`
   - `ALLOWED_EMAILS`: approved staff Gmail/Google Workspace emails separated by commas. This is required; only listed accounts can write activity rows.
5. At the top of Apps Script select the function named `setup`, click **Run**, and approve the Google permission prompt. The Sheet receives its formatted headers.
6. Click **Deploy → New deployment**. Click the gear beside **Select type**, choose **Web app**, select **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**. Copy the URL ending in `/exec`.
7. Open [Google Cloud Console credentials](https://console.cloud.google.com/apis/credentials), click **Create credentials → OAuth client ID → Web application**. Under **Authorized JavaScript origins**, click **Add URI**, enter `https://linkorasolution.com`, and click **Create**. Copy the generated Client ID.
8. In `activity-config.js`, paste the `/exec` URL after `apiUrl` and the Client ID after `googleClientId`. Upload `attendance.html`, `attendance.js`, `attendance.css`, and `activity-config.js` to the website.

## Day-to-day management

Open the Google Sheet to view active and completed sessions. To add or remove a staff member, edit only the `ALLOWED_EMAILS` Script Property. Normal logout updates the existing session row. Browser close/navigation sends a best-effort logout signal; a row marked **Active** indicates that the browser closed before logout could be confirmed.
