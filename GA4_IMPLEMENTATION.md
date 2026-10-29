# Public GA4 integration

Measurement ID: **G-S30W1WLJL9**. Reuses the existing marketing-config.js / marketing.js integration in the head of all 13 public source documents. The Google SDK is appended to the head asynchronously only after analytics opt-in. No Tag Manager container or second analytics system was installed.

## Coverage and future pages

- Homepage, About, Services, four dedicated service pages, Contact, Blog listing, Careers and Privacy.
- Web Development, Technical SEO and the 12-Website plan remain sections on Services.
- Article/job templates pass the same head integration into the existing published-only static builder. Future published posts/open jobs inherit it.
- Runtime article/job pages announce readiness after loading valid public content and setting the final title. Missing/unpublished/closed content does not initialize analytics.
- Existing extensionless aliases for approved public documents are allowed. Actual public paths and final titles are reported. The query/hash is stripped, except a verified public slug on the older article/job detail routes.
- For a new standalone public page, include the same two deferred head scripts in config-first order and add the document to the centralized public allowlist in marketing.js. Run the coverage check. Do not include them in internal pages.

## Events

| Event | Trigger |
|---|---|
| page_view | One normal Google config-generated view after consent and content readiness. No additional manual page view. |
| whatsapp_click | WhatsApp link or preparing a valid service order in the existing modal. No destination URL/message is transmitted. |
| email_click | Existing email/Gmail compose link. No address is transmitted. |
| phone_click | A tel link, when present. Existing WhatsApp phone links remain WhatsApp interactions. |
| service_cta_click | Service navigation/card, quote CTA, service order button or package button. |
| generate_lead | Only an accepted response from the existing inquiry endpoint, once per request ID. |
| quote_request | The same accepted response, only on forms explicitly marked data-quote-request. |

Existing controlled events (lead_form_start, lead_form_submit, lead_form_success, service_view, public contact/blog CTA events and the non-personal application-success signal) remain compatible. Opening a form, invalid submission, failed/unaccepted response and preparing a WhatsApp message never become a confirmed lead or quote conversion. The existing backend intentionally acknowledges filled honeypot fields without saving a record; those decoy acknowledgements are also excluded from success/conversion events.

Parameters are constructed from controlled enums: service_name, source_page, cta_location, existing page_path and context. Unknown fields are ignored. No input values, names, addresses, phone numbers, messages, applicant fields, files, request IDs, raw link URLs or commercial prices are sent. Service names normalize known package labels; the price/plan option suffix is discarded.

Use generate_lead as the primary lead key event if configuring business conversion reports. Marking generate_lead, quote_request and legacy lead_form_success all as key events would count the same successful inquiry multiple times. Custom parameters may need event-scoped custom definitions to appear in custom reports. These property-wide settings are separate from website emission.

## Consent and privacy

- Basic opt-in behavior worldwide: no Google SDK/collection before permission or after a persisted decline.
- Consent Mode defaults denied before configuration; the opt-in grants analytics storage only. Ads storage, ad user data and ad personalization remain denied; Google signals/ad personalization features are disabled.
- Footer **Analytics preferences** remains available after either choice. Withdrawal disables collection before the consent update and clears accessible first-party GA cookies. Other tabs synchronize the saved choice. Regrant does not repeat config/page views.
- Blocked local storage falls back to current-tab choice; subsequent loads default to denied. A blocked analytics script does not block rendering or business forms.
- Query strings, fragments, private referrer paths and arbitrary campaign parameters are excluded from GA events. External referrers retain the origin only. Existing optional UTM attribution to an actual inquiry remains in the separate first-party form workflow.
- This intentionally limits GA URL/campaign attribution. Google still receives normal request/device metadata after opt-in; no claim of anonymity, legal compliance or retroactive deletion is made.
- The owner explicitly approved turning off **Enhanced measurement** for LINKORA web stream **16231251011**. The saved setting was verified off. Standard page views remain; automatic outbound/search/form/download/video/history events are not enabled alongside controlled events. Do not re-enable without reviewing PII and duplication.
- Employee/Attendance/Recording/Admin/Auth documents are excluded from markup and rejected by the public-route allowlist even if accidentally included.
- Privacy copy is at privacy.html#analytics. No Supabase schema, permissions, Auth, job/application, attendance or recording backend was modified.

## Verification and operation

- node scripts/validate.mjs: includes three public/template/private coverage tests and existing repository/feature checks.
- node scripts/build-public-site.mjs, link audit and public SEO audit.
- node tests/analytics-ui.mjs: consent, denied storage, duplicate includes, cross-tab withdrawal, cookie deletion, service/order metadata, success-only/idempotent forms, public CMS readiness and private-page defense. Google and business endpoints are fixtures.
- node tests/analytics-network.mjs: real Google SDK, interception of collection and synthetic business submissions; verifies actual transport fields and absence of canary PII on every current sitemap page.
- GA4_SEND=1 SMOKE_BASE=https://linkorasolution.com node tests/analytics-network.mjs: explicit post-deploy public page-view/CTA transport check. Sends real permitted public analytics; never submits synthetic production leads. Set environment variables using the platform's shell syntax.
- Production transport uses read-only request/response observers, with no Fetch routing of live beacons. Each tested page view and CTA must receive a Google acknowledgement before navigating or withdrawing consent; otherwise rapid navigation can cancel an intercepted keepalive request and produce a false failure.
- Existing navigation, theme, Blog/Careers and safe workflow regression checks apply.

The deployment receipt supplied with delivery records actual checks, expected-head PR/squash merge, Pages source SHA, live requests and account-side Realtime/DebugView results. HTTP success alone is not evidence that a report displayed data. Ads blockers/tracking prevention and visitors declining analytics cause intentional measurement gaps.

## References

- [Google page-view measurement and duplicate prevention](https://developers.google.com/analytics/devguides/collection/ga4/views?technology=websites)
- [Google consent implementation](https://developers.google.com/tag-platform/security/guides/consent)
- [GA4 configuration fields](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [Enhanced measurement settings](https://support.google.com/analytics/answer/9216061?hl=en)
- [Google's GA4 opt-out implementation guidance](https://github.com/google/site-kit-wp/issues/7262)
