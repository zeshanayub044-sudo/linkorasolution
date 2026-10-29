# Analytics footer repair — 30 October 2026

## Actual root cause and change

marketing.js registered a DOMContentLoaded handler and setTimeout that created an analytics-settings button and appended it to .footer-bottom (or footer). script.js renders the shared footer dynamically. The delayed append ran after that footer render, producing the outlined Analytics preferences control and extra footer row shown in the owner screenshot.

Removed the creation/append code at its source and removed the unused analytics-settings CSS from growth.css. Nothing is hidden with display:none. The footer now contains its original copyright and social area. The existing Privacy link is labeled Privacy & cookies. privacy.html#analytics contains one Change analytics settings button in main content, wired to the existing showChoices controller. Privacy copy explains how to reopen settings. Shared script/CSS cache versions were advanced on all public documents and templates.

## Consent and tracking preserved

GA4 remains G-S30W1WLJL9. Unknown visitors still choose Allow or Decline. Persistent decline sends no Google loader or collection request. The Privacy control reopens choices by keyboard; withdrawal disables collection, clears accessible first-party GA cookies and synchronizes other tabs. Regrant does not create another configuration/page view. Blocked storage and blocked SDK behavior remain covered. Ads storage, ad user data, personalization and signals stay disabled. No employee/admin/recording/resume content or form fields are added to analytics.

## Verification

- Repository validation: 36 tests plus existing Google Sheets attendance and matrix contracts passed; syntax, links, migration-version and credential checks passed.
- Analytics UI: seven groups, including cross-tab withdrawal, cookie cleanup, singleton configuration, private-page defense, CMS readiness, controlled CTA data and confirmed-only/idempotent conversions.
- Real Google SDK capture: 14 public URLs, six groups; synthetic form requests and collection intercepted. No canary query/form data in Google parameters.
- Production real SDK: 14 public URLs, four groups. All 18 observed collection responses were HTTP 2xx (17 HTTP 204 and one HTTP 200); 19 event acknowledgements including batched events. One view per tested navigation, one tag loader, CTA/WhatsApp delivery and withdrawal verified. No synthetic lead/application was submitted.
- Chromium reported net::ERR_ABORTED completion signals for beacon requests after successful responses; required event acknowledgements were explicitly verified. This is not reported as zero network signals.
- Footer suite: 48 public page × width × theme combinations passed locally and again on production, including keyboard access through the actual footer Privacy link, absent footer control, clean bottom row, contact/social links and no horizontal overflow.
- Full local Edge/Chrome matrix: 216 checks, widths 320–1920, dark/light. Navigation/order pricing, no-JavaScript service/article rendering and seven safe public workflow groups passed. One workflow run timed out on full load; a clean rerun passed. The production analytics harness also hit a full-load timeout, then passed using document readiness plus actual SDK/event acknowledgement checks. No product tracking assertions were removed.

## Deployment and limits

PR #24 merged as 9673fa4fc461cebd7274661cb0c45a04bee0882d. Required Repository validation passed on head 8dfebbef757a0f62a6a04ffa03a7dd1c22188f8f. Pages run 40955635512 succeeded and public-build.json confirmed that merge SHA. Four shared assets matched local main by SHA-256. Production Privacy HTML contains the new settings control and no Cloudflare email-protection link. The completed implementation branch was deleted locally/remotely.

No Supabase schema/Auth/RLS, employee, attendance, recordings, Careers data or Blog CMS design was changed. Private HTML is byte-identical. Existing public conversion and role protections remain covered by source/fixture checks; no authenticated private-account mutation or live form submission was performed. Production screenshots and network evidence accompany the delivery.

## Account-side confirmation

Authenticated GA4 Realtime for property 540329171 was checked at 2026-10-29T21:33:13.766Z. It displayed one active user, three page views with the actual Privacy/Home/Services titles and one service_cta_click from the normal public verification visit. This account-side observation is separate from HTTP acknowledgement. No form/order was submitted; the temporary browser visit’s consent was withdrawn afterwards and its tab closed. Existing Enhanced measurement settings were not changed.
