# Website growth audit — 18 October 2026

## Scope and architecture

Production: https://linkorasolution.com; repository: zeshanayub044-sudo/linkorasolution. Work uses the actual attached checkout at `C:/Users/ME/OneDrive/Desktop/linkorasolution-main`, not the stale `C:/Dev/linkorasolution` path in the brief. Existing static GitHub Pages, Supabase Blog/Careers and attendance architecture retained. No attendance, recording, Auth or employee role schema changes.

## Findings and changes

- Public pages, generated footer/leadership, WhatsApp copy, schema and manifest used LINKORA SOLUTIONS and mixed-case variants. Visible name is now **LINKORA SOLUTION**. Technical identifiers, URL, email, Auth records and deployed migration history retain their existing names. The supplied lion mark replaces the old plural wordmark in public intro/social images; the original image asset remains intact.
- Home/About advertised 600+ publisher relationships without supporting evidence, fake-looking publisher domains/DRs appeared as proof, the leadership copy asserted 9+ years without a verified source, authority-score arrows suggested predetermined results, and Contact promised a 24-hour response. Removed or qualified these claims. Leadership names/roles and contact details come from existing owner-supplied repository content. No client logos, results, testimonials, certifications, office address or legal entity details invented.
- Dedicated Backlinks, Guest Posting, On-Page SEO and Google Business Profile pages now provide problems, scope, deliverables, process, suitability, realistic benefits, buyer FAQs and quote forms. Existing Services anchors remain valid. Header dropdown, cards, Services detail links and generated footer connect the pages; new-tab navigation is preserved for document links.
- No verified testimonials, case studies or portfolio evidence found. `content/proof.json`, `content/proof.schema.json` and `proof.js` provide a disabled, reviewed-data structure. An entry requires evidence, verification and publication approval. Do not put confidential information in this public repository, even in disabled configuration.
- Contact previously opened WhatsApp without saving an inquiry. Contact plus four service-page quote forms now use a validated server-side Supabase lead path, UTM capture, truthful success/errors, idempotency, honeypot and atomic rate limiting. The older Services order modal intentionally remains a WhatsApp order action, not a falsely acknowledged database submission.
- No CRM or analytics account configuration found. Secure CRM adapter and consent-controlled GA4 hook are implemented; actual third-party delivery remains unconfigured and unverified until approved settings are supplied. See LEAD_TRACKING_SETUP.md.
- Blog had zero posts at audit. Real owner sign-in was observed: muneebansari1993@gmail.com, Blog Admin, “Blog Editor ready.” Existing production authorization resolves active Co-CEO profiles to blog_admin; no roles changed. Prepared-draft import populates the existing editor and requires normal Save/Publish actions. Plain-text rendering now supports safe hyperlinks without HTML execution.

## Package and claim checklist

| Package | Existing approved repository price | Locations after upgrade | Action |
|---|---|---|---|
| On-Page Starter, up to 5 pages | PKR 15,000 one-time | Services; On-Page buyer FAQ | Preserved |
| On-Page Growth, up to 15 pages | PKR 35,000 one-time | Services; On-Page buyer FAQ | Preserved |
| On-Page Authority, 30+ pages/full site | PKR 70,000 one-time or PKR 25,000/month | Services; On-Page buyer FAQ | Preserved |
| 12-Website Monthly SEO Plan | $1,000 / Month, up to 12 websites | Home; Services price/order attribute; Contact and service forms; generated order text | Owner-approved price preserved; old PKR 100,000 absent from public code |
| Backlinks Starter/Growth/Authority | No public price | Services package scopes; dedicated landing page | No price invented; existing scope counts remain proposal scopes, not proven results |
| Off-Page, Guest Posting, Blog Writing, DA Increase, Guest Post Sites Sheet, Technical SEO, GBP, Web Development | No public price | Services; relevant landing pages | No price invented |

The audit uses existing repository values as the source for unchanged packages. The owner should review future commercial terms; this task does not invent new approval history or guarantees.

## Verification and limitations

Repository syntax/link/conflict/secret validation, Deno handler validation and SQL rollback tests cover the added backend. Real production API acceptance verified one stored disposable inquiry with source/UTM fields and no duplicate on retry; its CRM status was pending, and the test lead was deleted after verification. This proves Supabase capture, not an external CRM delivery.

Browser QA covers 1366px/390px public pages, H1/canonical/schema parsing, navigation protection, form success, UTM and privacy-safe event signals, plus existing Employee/Admin recording regressions using synthetic identities. Tests do not prove real-user Core Web Vitals or fresh real employee/recording acceptance.

Three articles were created and published through the real CMS; editing, draft privacy, unpublication/republishing, featured-image upload and logout passed. See CONTENT_STRATEGY.md for evidence and exact limits. PR #17 merged as 6ecfd0b0debce177c359bb60dd84e61808f3c2a0 and its Pages deployment succeeded. Follow-up acceptance/sitemap changes use the same validated publishing lifecycle. A OneDrive checkout lock was recovered using a preservation stash and a clean fast-forward; no unique work was discarded.

## Owner input and next priorities

1. Supply approved CRM destination and server-side credentials; approve a GA4 measurement ID and configure enhanced-measurement settings before activation.
2. Supply publication-approved customer evidence, references and anonymization permissions before enabling proof.
3. Supply verified social profiles and any desired office/legal information. No empty social placeholders are rendered.
4. Monitor qualified inquiries and follow-up quality before expanding content volume. Use Search Console and real-user performance data to prioritize future work; no ranking or lead-volume outcome is promised.
