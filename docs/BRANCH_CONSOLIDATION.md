# Branch consolidation — 2026-10-08

Production baseline: `4013f4fecbbbbcdf2d27535072db287d07030334`.
Safety tag: `pre-consolidation-20261008-branch-cleanup`.
Historical Tennis snapshot: `archive-tennis-phase1-20261008` at `cde348876c046b65717c1880308a6d1ecb59d643`.

## Audit and disposition

| Remote branch | Classification | Disposition after validated consolidation |
| --- | --- | --- |
| codex/attendance-leave-matrix | Fully merged, PR #9 | Delete |
| codex/attendance-report-fk | Fully merged, PR #10 | Delete |
| codex/careers-resume-inbox | Fully merged, PR #8 | Delete |
| feature/blog-cms | Fully merged, PR #3 | Delete |
| feature/branding-intro | Fully merged, PR #2 | Delete |
| feature/careers-system | Fully merged, PR #4 | Delete |
| feature/services-dropdown | Superseded by PR #7; PR #6 closed | Delete; equivalent dropdown differs only by a blank line |
| feature/services-dropdown-rebased | Fully merged, PR #7 | Delete |
| feature/services-expansion | Fully merged, PR #5 | Delete |
| feature/tennis-user-management | Old UI superseded; deployed migration files missing | Restore four exact migration files; preserve historical snapshot tag; close obsolete PR #1 and delete |
| integration/final-consolidation | Temporary consolidation branch | Merge validated PR and delete |

The eight fully merged branches were confirmed with Git ancestry. The old dropdown's first three commits were patch-equivalent to main; its dropdown implementation matches the merged replacement ignoring line endings and one blank line. The older Tennis admin UI, old branding asset and earlier Edge Function implementations must not replace the current production code.

The historical Tennis tag preserves all original audit reports, schema catalogs, schema dump, generated config, historical SQL tests and the unused quick-responder sample. Those artifacts are evidence of a prior deployment, not current setup instructions or active CI tests. In particular, historical security tests assume policies that have since changed. No live schema object, function or data was removed.

## Supabase reconciliation

The production migration history contained 22 versions at audit. Main lacked these four:
- `20260912000000_tennis_portal.sql`
- `20260930203350_security_hardening.sql`
- `20261003222422_admin_user_management.sql`
- `20261003223321_admin_user_management_indexes.sql`

Their original contents were restored from the historical branch without rewriting or executing them. Later main migrations depend on this history. Production RLS, Auth, RPCs, data and deployed functions were not changed by consolidation.

This is a history reconciliation, not a fresh-database baseline. Legacy tables existed before these recorded migrations; do not assume that replaying the historical files provisions a blank database. Do not run the historical schema dump or standalone attendance SQL against production.

## Local branches

The older OneDrive checkout also contained `backup-local-main-20261004`, whose two commits are ancestors of the preserved Tennis snapshot. Its local Blog, Careers and Services branches use older rebased commit IDs; their patches were superseded by the merged implementations. Clean both known checkouts and return them to main only after integration has been verified.
