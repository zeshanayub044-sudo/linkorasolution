# Full website smoke test — 31 October 2026

Scope: existing production architecture at https://linkorasolution.com. Baseline source: 3d4cf7e3bbc9df1207e5b613d5c1862f2959b426. Current public content: 2 published articles, 0 open jobs. The route audit records 27 endpoints; 13 are canonical indexable pages. No fake applicants, leads, employees or attendance sessions were committed.

## URL inventory

| URL | HTTP | Classification | Canonical | Robots | Sitemap |
|---|---:|---|---|---|---|
| https://linkorasolution.com/ | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/ | default; canonical consolidates aliases | Yes |
| https://linkorasolution.com/about.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/about.html | default; canonical consolidates aliases | Yes |
| https://linkorasolution.com/services.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/services.html | default; canonical consolidates aliases | Yes |
| https://linkorasolution.com/backlinks.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/backlinks.html | index,follow | Yes |
| https://linkorasolution.com/guest-posting.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/guest-posting.html | index,follow | Yes |
| https://linkorasolution.com/on-page-seo.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/on-page-seo.html | index,follow | Yes |
| https://linkorasolution.com/gmb.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/gmb.html | index,follow | Yes |
| https://linkorasolution.com/contact.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/contact.html | default; canonical consolidates aliases | Yes |
| https://linkorasolution.com/blog.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/blog.html | default; canonical consolidates aliases | Yes |
| https://linkorasolution.com/careers.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/careers.html | default; canonical consolidates aliases | Yes |
| https://linkorasolution.com/privacy.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/privacy.html | default; canonical consolidates aliases | Yes |
| https://linkorasolution.com/blog/what-is-guest-post-a-complete-beginner-s-guide.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/blog/what-is-guest-post-a-complete-beginner-s-guide.html | index,follow | Yes |
| https://linkorasolution.com/blog/what-is-seo-a-complete-guide-to-ranking-on-google.html | 200 | PUBLIC INDEXABLE | https://linkorasolution.com/blog/what-is-seo-a-complete-guide-to-ranking-on-google.html | index,follow | Yes |
| https://linkorasolution.com/attendance-admin.html | 200 | AUTHENTICATED / PRIVATE | — | noindex, nofollow | No |
| https://linkorasolution.com/attendance.html | 200 | AUTHENTICATED / PRIVATE | — | noindex, nofollow | No |
| https://linkorasolution.com/blog-admin.html | 200 | AUTHENTICATED / PRIVATE | — | noindex,nofollow | No |
| https://linkorasolution.com/blog-post.html | 200 | PUBLIC NON-INDEXABLE | — | noindex,follow | No |
| https://linkorasolution.com/career-job.html | 200 | PUBLIC NON-INDEXABLE | — | noindex,follow | No |
| https://linkorasolution.com/careers-admin.html | 200 | AUTHENTICATED / PRIVATE | — | noindex,nofollow | No |
| https://linkorasolution.com/tennis-portal.html | 200 | AUTHENTICATED / PRIVATE | — | noindex, nofollow | No |
| http://linkorasolution.com/ | 301 → 200 | REDIRECT | https://linkorasolution.com/ | default; canonical consolidates aliases | No |
| https://linkorasolution.com/index.html | 200 | PUBLIC NON-INDEXABLE | https://linkorasolution.com/ | default; canonical consolidates aliases | No |
| http://linkorasolution.com/index.html | 301 → 200 | REDIRECT | https://linkorasolution.com/ | default; canonical consolidates aliases | No |
| http://www.linkorasolution.com/ | 301 → 301 → 200 | REDIRECT | https://linkorasolution.com/ | default; canonical consolidates aliases | No |
| https://www.linkorasolution.com/ | 301 → 200 | REDIRECT | https://linkorasolution.com/ | default; canonical consolidates aliases | No |
| https://linkorasolution.com/cdn-cgi/l/email-protection | 404 | BROKEN / REMOVED | — | noindex, nofollow | No |
| https://linkorasolution.com/what-is-guest-post/ | 404 | BROKEN / REMOVED | — | default; canonical consolidates aliases | No |

The inventory also records each initial title, H1/heading sequence, description, internal links, images, structured data, content word count and response headers in the private audit artifact route-inventory.json. Runtime navigation, footer, Services dropdown, focus, mobile behavior, theme contrast, overflow and missing images are checked by the browser suites. Web Development and the monthly plan remain Services sections.

## Executed tests

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

Edge widths: 320, 375, 390, 768, 1024, 1440, 1920; Chrome: 390, 1440. Both themes, reduced-motion browser runs. Firefox and WebKit runtimes were unavailable; no Safari/Firefox pass is claimed. Intro lifecycle/reduced motion/blocked-storage behavior also has automated regression coverage.

## Failures and retests

- P1: a newly published article returned 404, was absent from the deployed sitemap, and blocked five scheduled builds. Its CMS canonical pointed to an ungenerated root URL. Cleared the override through the authenticated existing Blog Editor, retaining the published article. The manual main refresh succeeded; its generated URL is now 200 and self-canonical, and the sitemap grew from 12 to 13. Seven publication-guard groups prevent the corresponding bad input through both Publish and Save-published paths.
- P2: Blog listing CLS reached 0.3123 because short initial cards were cleared and replaced by full cards. Pre-render the existing full card layout and retain it until the public API completes. The final matrix Blog maximum was 0.02449; gated-API tests passed with maximum 0.04552.
- P2: Supabase advisor reported mutable search_path on the shared invoker timestamp trigger. A new migration pins pg_catalog; before/after rollback tests passed and the warning disappeared.
- One old SEO browser assertion required multiple paragraphs. The new article uses single line breaks. The assertion now checks full initial body text over 100 words without JavaScript. This was a test assumption, not a production content rewrite.

No uncaught page exceptions failed the completed browser matrix. All 701 built initial references/fragments passed. Expected 401/403 backend denials and intentional 404 URLs are recorded separately from failures. Production post-release browser and exact deployment evidence is supplied in the final release receipt.

## Safe authenticated checks and limits

- Blog: owner sign-in reached Blog Editor ready; existing published article edit/save succeeded through normal UI. No credential or role changed.
- Attendance Admin: actual Co-CEO dashboard loaded; reports loaded all 67 of 67 records. Only notices, counts and controls were inspected. No employee rows were exported or copied into reports.
- Careers Admin: pending owner sign-in at report preparation; signed-out protection and public Careers fixtures passed.
- Employee clock in/out, capture chooser, screen recordings, actual resume/application submission and external CRM delivery were not exercised against production. Their fixtures/contracts do not prove a human permission prompt or third-party delivery.
- An additional rollback-only Blog publish/unpublish SQL scenario could not be executed because connector confirmations expired twice. It is not claimed as passed. Existing draft/RLS SQL and fixture publish tests did pass.
