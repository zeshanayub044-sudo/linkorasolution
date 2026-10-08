# Attendance Google Sheet specification

The existing spreadsheet retains its `Tennis Portal Logs` tab with columns `Email | Employee Name | Employee ID | Scheme | Role | Login Date | Login Time | Logout Date | Logout Time | Status | Session ID`. The tab is a session-level mirror. Existing rows remain in place; missing Supabase sessions can be recovered by queued idempotent delivery.

The new `Attendance Matrix` tab is the management view. Row 1 contains `Attendance date` followed by a three-column group per employee, such as `Muneeb (actual employee ID)`. Row 2 contains `Date | Sign In | Sign Out | Status` for each group. Row 3 onward contains exactly one ISO company-local date per row. Top-level employee cells hold the stable Auth/employee UUID in a cell note. Sync uses that UUID rather than the display name, so renaming or duplicate names do not remap history. New employees append a group. Deactivated employees retain their group and historical cells.

| Date | Example employee Sign In | Example employee Sign Out | Example employee Status | Second employee Sign In | Second employee Sign Out | Second employee Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-01 | 09:01 | 18:03 | Present | 09:16 | 18:20 | Late |
| 2026-10-02 | 09:05 | — | Missing Sign-Out | — | — | Leave |

These names are examples only. Production groups come from `employee_profiles` in the Supabase daily snapshot. Sign-in is the earliest session start on that date; sign-out is the latest completed session end. Multiple sessions remain separately accessible in Supabase. Completed attendance is `Present` or `Late`; a current open session is `Signed In`; an old open or review session is `Missing Sign-Out`; approved leave with no attendance is `Leave`; an elapsed scheduled active day without either is `Absent`; an inactive/unscheduled day is `—`. No sign-out time is fabricated. Times use `company_settings.timezone` and `HH:mm` format. The first two rows and date column are frozen; headings are bold and employee UUIDs stay in notes.

The Edge `matrix-day` request contains `day`, `timezone` and a JSON array of rows with `userId`, employee display fields, earliest sign-in, latest sign-out, status and late flag. It is authenticated with the existing webhook secret and guarded by `LockService`. Repeating the same date snapshot updates existing cells; it does not append duplicate dates or groups. Session/leave/profile triggers queue changed dates, and a Co-CEO can retry or rebuild a 46-day range. The old `report` action remains for compatibility but admin reports read Supabase directly.
