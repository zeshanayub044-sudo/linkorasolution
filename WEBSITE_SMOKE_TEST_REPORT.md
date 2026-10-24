# Website smoke test report — 24 October 2026

## Scope and evidence

Audited all 18 root HTML templates: 13 public templates (11 static public pages plus two generic record-detail templates) and five protected/legacy management or employee templates. The current public API has one published Blog article, zero drafts and no open jobs. The artifact therefore has 12 canonical indexable public pages. It does not recreate previously removed articles or invent hiring data.

Baseline HTTP, metadata and schema: `docs/theme-seo/baseline.json`. Before/after per-URL metadata: `docs/theme-seo/before-after.json` and ON_PAGE_SEO_IMPLEMENTATION.md. Actual GSC observations: `docs/theme-seo/gsc-before.json`. Matrix and workflow results: `docs/theme-seo/local-smoke.json` and `docs/theme-seo/workflow-fixtures.json`. Baseline Lighthouse summary (raw report retained in the local visualization artifacts): `docs/theme-seo/lighthouse-before-summary.json`.

## Issues and fixes

| ID | Severity | Finding / root cause | Result |
|---|---|---|---|
| 1 | High | Blog initial HTML has noindex, no article text/metadata and no listing links | Published-only static detail/listing output; legacy reader retained; no-JS and simulated unpublish tested |
| 2 | High | Search Console received HTML page URLs as sitemaps; About is unknown with no crawl/referring sitemap | Correct XML generated and live submission/inspection performed during deployment verification; see delivery report for exact observed outcome |
| 3 | Medium | Source sitemap still lists three removed articles and misses the current published record | Current API drives clean canonical article routes and reliable lastmod; every publisher refresh rebuilds sitemap |
| 4 | Medium | About jumps H2→H4; footer headings jump to H5 | About values H3; footer navigation regions H2; styling preserved |
| 5 | Medium | CSS @import/font waterfall and extra blocking behavior scripts | Head font discovery and small early bootstrap; larger theme/intro behaviors deferred; actual lab baseline retained |
| 6 | Medium | Visually closed mobile navigation remains keyboard reachable; no Escape handling | Shared inert state, aria-expanded, breakpoint updates and Escape/focus return |
| 7 | Medium | During integration, duplicate public/admin menu handlers cancel the toggle | One shared handler; duplicates removed; admin signed-out fixtures retested |
| 8 | Medium / owner action | HTTP still serves 200 and GitHub HTTPS enforcement is disabled/unavailable for the domain | HTTPS canonical maintained; live host/DNS evidence documented; no unverified DNS/security change made |

No new critical security defect was found. The new light theme is a requested feature rather than an inflated baseline bug count. Eight issues are tracked; the delivery report distinguishes fixes, submission state and remaining infrastructure limitations.

## Executed tests

- Edge: both themes at 320, 375, 390, 768, 1024, 1440 and 1920px. Installed Chrome: both themes at 390 and 1440px. Twelve canonical public pages per combination: **216 checks**. Checks include H1/canonical/indexability/schema parsing, one preserved founder, image decoding, overflow, theme first visible frame, accessible control, token contrast, dropdown bounds and closed-menu state. Screenshots of desktop/mobile Home, Contact and an article were reviewed.
- Theme: default dark, saved light, keyboard toggle, refresh/navigation persistence, storage event synchronization, reopened browser context and denied-storage fallback.
- Forms: real browser native required/email validation, server-error display, retry idempotency, campaign attribution and success. Every write was intercepted locally; no fake production lead was sent.
- Careers: actual no-open-jobs state; general resume MIME rejection, PDF multipart and confirmation; job-specific detail/application using a synthetic API fixture. No actual applicant record or production job was created.
- Blog: actual published public data rendered; static text and unique metadata with JavaScript disabled; local simulated unpublish clears article/schema and sets noindex. Generic unavailable detail remains noindex. No new CMS content was created for this task.
- Admin: real signed-out Blog/Careers login panels stay protected, private dashboards hidden and noindex preserved. Theme/mobile controls checked. No passwords were requested or embedded. Fresh real signed-in admin/employee acceptance is not claimed.
- Backend: existing RLS enabled; anonymous Blog reads published-only and open-job policies preserve expiry. A rollback-only query verified ordinary Employee Blog edit/draft denial and anonymous lead privacy; no committed data changes.
- Existing navigation/new-tab/order tests passed at desktop/mobile, including the approved **$1,000 / Month — up to 12 websites**. Synthetic Employee Portal/recording UI regression suites passed; no real attendance, capture, playback or user deletion was performed.
- Repository validation: syntax, links, migration versions, conflict/secret guards, 27 Node tests and existing Google Sheets/matrix contract tests. Publisher also runs security-focused static-renderer tests before building.

## Limits and repeatable commands

Firefox/WebKit runtimes and physical Android/iOS devices were unavailable; no corresponding pass is claimed. Chromium width emulation is not Safari coverage. GSC has no field Core Web Vitals dataset. Lighthouse results are lab measurements under varying local load/network, not field INP or guaranteed speed. Real CRM receipt and GA4 receipt cannot be checked without configured accounts; their dormant configuration is unchanged. No real employee Clock In/Out or production resume submission was performed.

Run `node scripts/validate.mjs`, `node scripts/build-public-site.mjs`, `node tests/website-smoke.mjs`, `node tests/public-workflows-ui.mjs`, and the existing navigation/recording suites. Set PLAYWRIGHT_MODULE and EDGE_EXECUTABLE where required; tests default to this machine's installed runtime paths. `SMOKE_BASE=https://linkorasolution.com` runs the page matrix against production without form writes. SHA/deployment, live source and sitemap submission results are verified in the delivery report after publishing, not inferred from local passes.

Artifact validation also checked 620 initial HTML references/fragments and confirmed backend/docs/tests/draft sources are absent. The publisher runs this audit before upload.
