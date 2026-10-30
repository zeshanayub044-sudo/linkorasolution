# Production QA report — 31 October 2026

## Overall website health

27 endpoints inventoried; all 13 canonical indexable pages tested in the final 234-check local browser matrix. No P0 was identified. Three confirmed production defects repaired: one P1 publishing/canonical defect, one P2 Blog layout shift and one P2 timestamp-trigger search-path warning. Two security review items remain: disabled leaked-password protection and removed legacy seed-password history with unknown current reuse. Authenticated Careers acceptance and native capture/clock workflows require owner testing; these are coverage limits, not asserted defects.

## Errors and repairs

See WEBSITE_ERROR_FIX_REPORT.md for root causes, files, tests and limitations. Content correction is already live through successful workflow 41127366712 on baseline main SHA 3d4cf7e3bbc9df1207e5b613d5c1862f2959b426: two published posts, zero open jobs, 13 sitemap URLs. Source hardening/layout changes follow the repository’s reviewed PR lifecycle; their final merge SHA/deployment checks and live retest are recorded in the final release receipt outside this self-referential source commit. Do not mistake a local build for deployed source.

## Local and regression evidence

| Check | Result |
|---|---|
| Repository validation | 39 Node tests + Sheets/matrix contracts; passed |
| Full local browser matrix | 234 checks; 13 public pages × 18 browser/width/theme combinations; passed |
| Publication guard | 7 real-browser fixture groups; passed; no production writes |
| Blog layout | 6 gated-API browser combinations at 390/768/1440, both themes; passed |
| Contact/Careers/theme workflow fixtures | 7 groups; passed; intercepted submissions only |
| Navigation / pricing / opener | 1366 and 390 px; passed; $1,000 / Month, up to 12 websites preserved |
| No-JavaScript SEO / fonts | 2 published articles, service links, local WOFF2; passed |
| Analytics UI | 7 consent/privacy/conversion fixture groups; passed |
| Footer / privacy | 52 combinations; passed; declined consent and keyboard entry verified |
| Real Google SDK | 15 public/alias paths, 6 groups; intercepted collection mode passed; not a GA4 delivery claim |
| Backend handlers | 17 Deno tests; passed with mocks and no network permissions |
| Anonymous production security | 13 live denial/filter checks; passed; no valid business submissions |
| Production database RLS | Rollback-only Blog draft insert/delete, employee/anonymous denials and marketing idempotency/rate/CRM-state tests passed |
| Timestamp trigger | Temporary-table insert/update checks before and after migration passed; rolled back |

No browser page exceptions failed the suites. Actual business delivery was intercepted in workflow fixtures; no CRM/email delivery claim is made. Rollback-only SQL tests left no inquiry or draft in production. A separate publish/unpublish SQL confirmation expired twice and is not included in the pass count. No passwords, sessions or role assignments were changed.

## Performance evidence

234 unthrottled local measurements: LCP p50 492 ms, p75 700 ms, max 7064 ms. Broad-run Blog CLS max improved from 0.3123 to 0.02449; dedicated delayed-API maximum 0.04552. One GMB outlier 0.1300 was investigated with three cold runs (0.06967, 0.05690, 0.05690). These are lab readings under variable machine/network load; no field INP/LCP/CLS or Lighthouse score is fabricated. Firefox/WebKit are unavailable.

## Backend regression and privacy

Production project nbvylffxmjmovyfhbytu remains active; 20/20 public tables have RLS. Blog image bucket remains public; career resumes and employee recordings remain private. Browser roles cannot update employee role columns. Live anonymous draft reads returned no rows, private table reads were denied, all four privileged Edge handlers denied anonymous requests, empty public forms were rejected, and private bucket listings exposed no objects (13 checks total).

Actual owner Blog login and existing published-article save succeeded. Actual Co-CEO Attendance dashboard and reports loaded 67/67 records. Careers Admin remained signed out at preparation; no authenticated Careers pass is claimed. Employee clock-in/out, screen chooser/recording and application/resume submissions were tested with fixtures/contracts rather than production mutations. No employee/applicant details were copied into public reports or artifacts.

Production migration 20261030212455_pin_updated_at_search_path was created with official CLI, applied through the authorized connector, verified and aligned to the deployed migration version. Historical versions were not edited/replayed. The trigger remains invoker-security with the same body and grants.

## Release checklist and remaining work

- COMPLETED: source repairs, local regression tests, live canonical/content repair, read-only backend security, authenticated Blog and Attendance checks, 13-page SEO inventory, supported Google requests and 13-page sitemap success.
- PARTIALLY COMPLETED: overall authenticated acceptance; Careers requires owner login, actual draft/publish UI flow and employee/native screen permissions were not exercised live.
- OWNER ACTION REQUIRED: review historical seed credential reuse and the disabled leaked-password protection setting without exposing values; complete safe human-only permission/login acceptance when available.
- GOOGLE-CONTROLLED: crawl/index decisions for five eligible non-indexed pages after accepted requests/sitemap.
- RELEASE GATE: publish only after final diff/secret review and current-head Repository validation; squash with expected SHA, delete task branches, synchronize clean main and verify exact Pages source SHA plus public content fingerprint. Final receipt records actual outcome.

Reports: FULL_WEBSITE_SMOKE_TEST.md, WEBSITE_ERROR_FIX_REPORT.md, TECHNICAL_SEO_AUDIT.md, GOOGLE_INDEXING_RECOVERY.md, GOOGLE_INDEXING_RECOVERY_AUDIT.md, ON_PAGE_SEO_IMPLEMENTATION.md. Browser/data evidence stays in the private production-health-2026-10-31 artifact directory and is excluded from Pages.
