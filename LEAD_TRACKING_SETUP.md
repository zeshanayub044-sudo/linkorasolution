# Lead capture, CRM and analytics

## Form and server architecture

Contact and the four new service pages use the same static `data-lead-form` contract from `scripts/build-service-pages.mjs`. Required: name, email, service, message. Optional: phone, company, website, budget. Submission remains in-page, disables concurrent sends, retains an idempotency UUID on network retry, and only acknowledges success after the server reports accepted. The Services order modal continues to compose a WhatsApp message; it does not claim an inquiry has been stored.

`marketing.js` posts to `marketing-lead`. The endpoint is intentionally public: gateway JWT verification is disabled because visitors are anonymous, while the handler checks the browser-safe publishable key, approved Origin, method, bounded 14 KB stream, field types/lengths, website scheme, honeypot and per-IP rate limit. A public key/Origin is not a secret or a replacement for abuse controls. CORS cannot prevent a determined non-browser sender. Add an approved challenge provider if observed abuse warrants it.

Migration `20261017225622_marketing_leads.sql` adds `public.marketing_leads`, private rate buckets and service-only write/result RPCs. INSERT/UPDATE/DELETE are unavailable to public and authenticated browser roles. SELECT is allowed only through the existing active Co-CEO predicate. No new authorization role is invented. The read-only `marketing_management_access()` wrapper is deliberately callable by authenticated users and returns only whether the current UUID is an active Co-CEO. Its SECURITY DEFINER advisory is reviewed and intentional; it does not accept a target UUID or expose a lead.

Rate buckets use an atomic row update, five new submissions/hour, salted daily IP hashes, and prune expired buckets on ingestion. The raw IP is not stored. The service-role secret supplies a server-only hash salt and never enters browser code, logs or stored records. If the platform does not supply its client-IP header, the endpoint conservatively shares an “unknown” bucket. Idempotency locks prevent duplicate rows for retries of an already committed request ID.

Management can read the lead table through authenticated Supabase access with its active Co-CEO account. Database administrators may use the Supabase Dashboard. This task does not add an unrelated lead-management dashboard or promise email notifications.

## CRM adapter — awaiting owner configuration

No CRM account, endpoint or credential was supplied or found. Supabase is the working lead inbox. Set these **server-side Edge Function secrets only** when approved:

- `MARKETING_CRM_URL`: HTTPS webhook endpoint accepting the documented lead JSON.
- `MARKETING_CRM_TOKEN`: Bearer credential for that endpoint.

The adapter forwards the saved lead ID, request ID and validated fields; it sends an Idempotency-Key, rejects redirects, times out after five seconds, and records delivered/failed status. No CRM response body, token or lead contents are logged. Missing configuration leaves `crm_status=pending`. Failures retain the lead with `crm_status=failed`; there is no automatic background retry worker. Management must reconcile/replay pending/failed leads through its approved server-side CRM tooling, preserving the lead ID for deduplication. Confirm the provider’s webhook contract before enabling. Never report an HTTP-mocked adapter test as real CRM integration.

Real production acceptance: endpoint returned accepted twice for one disposable request; database contained exactly one row with source and UTM. CRM remained pending, confirming no delivery attempt. Test inquiry removed afterward. Actual CRM delivery is **blocked by missing approved configuration**.

## Campaign attribution

The five standard UTM fields are captured from the public page URL, limited to 120 characters each, kept in session storage across public navigation, and sent only with an inquiry. A newly tagged campaign replaces the prior campaign. Source is pathname only. UTM/query strings and form values are excluded from analytics event payloads. Storage denial falls back to current-page attribution without breaking the form.

## Conversion events

`linkora:conversion` CustomEvents expose only an allowlisted event name, public pathname and controlled context. Events: lead_form_start, lead_form_submit, lead_form_success, whatsapp_click, phone_click, email_click, service_view, service_cta_click, contact_cta_click, blog_cta_click, career_application. Application events fire only after a successful Careers API result; they carry no applicant data. No marketing scripts run on Employee/Admin pages. No passwords, attendance, recordings, form values, UTM values or private sessions enter marketing analytics.

`marketing-config.js` contains a blank GA4 ID. No analytics platform tag is loaded by default. Add an owner-approved `G-...` ID to activate the optional consent UI; a tag loads only after permission. Advertising consent/signals are disabled. Page URL excludes query and fragment; page title/referrer are omitted from the explicit event. Before activation, disable GA4 Enhanced Measurement features that could automatically collect forms, outbound URLs or search parameters. Do not add a second tag or a generic portal-wide snippet. Browser event dispatch is tested; real GA4 receipt cannot be verified without the ID/property access.

## Verification commands

Run repository validation; `npx --yes deno@2.5.6 test tests/marketing-lead.test.ts`; rollback-only SQL `tests/marketing-leads-integration.sql`; and `tests/growth-ui.mjs` with installed Playwright/Edge paths. The SQL test must run inside BEGIN/ROLLBACK and must never retain synthetic inquiries. Verify a real CRM submission and receipt after configuring a provider. Establish an owner-approved inquiry retention policy and review/delete stale leads through authorized management tooling.
