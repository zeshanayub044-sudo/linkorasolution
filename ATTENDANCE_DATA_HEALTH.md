# Attendance data health

Production snapshot: 2026-10-06 Pacific / 2026-10-07 UTC. The migrations did not rewrite existing sessions. A real CEO001 portal sign-in happened later, so the live count differs from the immediate post-migration count.

| Metric | Before | Immediately after migration | Latest live check |
| --- | ---: | ---: | ---: |
| Supabase Auth users | 6 | 6 | 6 |
| Employee profiles | 6 | 6 | 6 |
| Active employee profiles | 6 | 6 | 6 |
| Active Co-CEO profiles | 2 | 2 | 2 |
| Attendance sessions | 47 | 47 | 48 |
| Open (`Logged In`) | 30 | 30 | 25 |
| Completed (`Logged Out`) | 17 | 17 | 17 |
| `Needs Review` | 0 | 0 | 6 |
| Employees with multiple open sessions | 4 | 4 | 3 |
| Open sessions older than 16 hours | 30 | 30 | 24 |
| Negative-duration sessions | 0 | 0 | 0 |
| Pending Sheets queue rows | — | 0 | 1 |

The initial 30 old open sessions needed review. Four employees had more than one open record. The later CEO001 login flagged six of those old sessions `Needs Review`, added six system audit events, and created one fresh open session. Twenty-four old sessions remain `Logged In`. The Issues module lists the affected sessions, prioritizing the duplicate-open label where applicable. No logout timestamp was invented, and no attendance history was deleted.

The new login queued one secondary Sheets mirror item. Its first attempt failed on an ambiguous profile lookup; `manage-employee` version 20 corrects that lookup. The item remains pending for the next eligible retry. The authoritative Supabase sign-in succeeded despite the mirror failure.

Recommended remediation: Have a Co-CEO review each old session against reliable evidence, enter the actual logout time and a reason where known, and leave uncertain records in `Needs Review` until evidence is available. Do not bulk-close these sessions at the current time. Confirm a sample of corrected rows in History, Monthly, and Audit. Use the Settings retry button to deliver the pending mirror row, then confirm the Apps Script receiver deduplicates repeated `(session_id, action)` deliveries.
