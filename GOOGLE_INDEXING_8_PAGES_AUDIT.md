# Eight reported indexing exclusions — verified 30 October 2026

Authenticated Domain property: sc-domain:linkorasolution.com. The Pages report still shows 8 not indexed / 6 indexed, last updated 23 October 2026. All eight example URLs were extracted from its actual four categories and individually inspected. The current URL Inspection records disagree with that old summary: About and the published SEO article are already indexed.

| URL | GSC Status (23 October report) | Actual Problem | Root Cause | Fix | Current live status | Reindexing Status |
|---|---|---|---|---|---|---|
| https://linkorasolution.com/about.html | Crawled - currently not indexed | Current URL Inspection says Page is indexed. No current crawl/indexing defect. | The Pages summary is dated 23 October; URL-specific state is newer. | Preserved useful content, self-canonical and links. Footer integration updated. | 200; self-canonical; Google live test passed. | Not requested: already indexed. |
| https://linkorasolution.com/blog/what-is-seo-a-complete-guide-to-ranking-on-google.html | Crawled - currently not indexed | Current URL Inspection says Page is indexed. Initial HTML contains the complete article. | The summary predates the successful 27 October crawl. | Preserved published-only static rendering, article metadata, body and service links. | 200; self-canonical; Google live test passed. | Not requested: already indexed. |
| http://linkorasolution.com/ | Alternative page with proper canonical tag | An HTTP variant, not a separate public page. Current Inspection says Page with redirect. | HTTP now redirects to the preferred HTTPS root. | Verified existing 301 and root canonical; excluded from sitemap. | 301 → HTTPS root 200. | Not eligible: redirect. |
| https://linkorasolution.com/index.html | Alternative page with proper canonical tag | Duplicate homepage URL; current canonical exclusion is correct. | Root and index.html serve the same homepage with root canonical. | Preserved root canonical and sitemap exclusion. | 200; canonical HTTPS root. | Not eligible: duplicate canonical alternative. |
| http://linkorasolution.com/index.html | Alternative page with proper canonical tag | HTTP duplicate; current Inspection says Page with redirect. | HTTP redirects to HTTPS index.html, which canonicalizes to root. | Verified existing 301, final root canonical and sitemap exclusion. | 301 → HTTPS index.html 200 → canonical root. | Not eligible: redirect/duplicate. |
| http://www.linkorasolution.com/ | Page with redirect | Expected host/protocol alias. | HTTP upgrades to HTTPS; www redirects to non-www. | Verified two finite 301 hops ending at preferred root; no loop. | 301 → HTTPS www → 301 → HTTPS root 200. | Not eligible: redirect. |
| https://www.linkorasolution.com/ | Page with redirect | Expected hostname alias. | www redirects to preferred non-www root. | Verified existing 301 and sitemap exclusion. | 301 → HTTPS root 200. | Not eligible: redirect. |
| https://linkorasolution.com/cdn-cgi/l/email-protection | Not found (404) | Reserved Cloudflare endpoint was linked from Privacy; it is not a landing page. | Cloudflare rewrote the source mailto link into this crawlable URL. GSC identifies Privacy as the referrer. | Changed Privacy to the established Gmail compose link. Deployed HTML has no email-protection link. Kept reserved endpoint 404/noindex. | 404 retained; referring Privacy page 200 and live-test eligible. | Endpoint not submitted. Corrected Privacy recrawl accepted 2026-10-29T21:26:20.585Z. |

## Individual crawl and canonical evidence

| URL | Current URL Inspection | Last crawl shown by GSC | User canonical / Google canonical | Sitemap and discovery |
|---|---|---|---|---|
| https://linkorasolution.com/about.html | Page is indexed | 24 Oct 2026, 21:49:36 | Self / Inspected URL | GSC says Temporary processing error for sitemap association; no referring page detected. The live XML sitemap is separately successful and contains this URL. |
| https://linkorasolution.com/blog/what-is-seo-a-complete-guide-to-ranking-on-google.html | Page is indexed | 27 Oct 2026, 13:03:28 | Self / Inspected URL | sitemap.xml reported both as sitemap and referring page. |
| http://linkorasolution.com/ | Page with redirect | 29 Oct 2026, 15:05:38 | HTTPS root / HTTP root as reported in this record | Temporary processing error for sitemap association; root/www referrers. Independent live check confirms the actual 301. |
| https://linkorasolution.com/index.html | Alternative page with proper canonical tag | 30 Oct 2026, 01:04:14 | HTTPS root / Same as user-declared | Temporary processing error for sitemap association; root/www referrers. |
| http://linkorasolution.com/index.html | Page with redirect | 27 Oct 2026, 09:54:43 | HTTPS root / Same as user-declared | No referring sitemaps; root and HTTP root referrers. |
| http://www.linkorasolution.com/ | Page with redirect | 29 Oct 2026, 04:21:29 | HTTPS root / Same as user-declared | No referring sitemaps; root and HTTP root referrers. |
| https://www.linkorasolution.com/ | Page with redirect | 29 Oct 2026, 04:21:29 | HTTPS root / Same as user-declared | Temporary processing error for sitemap association; root referrer. |
| https://linkorasolution.com/cdn-cgi/l/email-protection | Not found (404) | 23 Oct 2026, 23:03:15 | N/A / N/A | No referring sitemaps; referring page privacy.html. |

GSC crawl/indexing permission fields are Yes and fetch Successful for the seven non-404 records. The endpoint reports Failed: Not found (404), indexing allowed N/A. GSC display times are retained verbatim; evidence capture timestamps use UTC. A sitemap association processing message on an individual record is not evidence that the XML sitemap fetch is failing.

## Post-deployment Google live tests

| URL | Google result | Crawl / fetch / indexing | Canonical | Request |
|---|---|---|---|---|
| https://linkorasolution.com/about.html | Available to Google; 30 Oct 02:14:32 | Yes / Successful / Yes | Self | None: already indexed. |
| https://linkorasolution.com/blog/what-is-seo-a-complete-guide-to-ranking-on-google.html | Available to Google; 30 Oct 02:18:53 | Yes / Successful / Yes | Self | None: already indexed. |
| https://linkorasolution.com/privacy.html | Available to Google; 30 Oct 02:24:55 | Yes / Successful / Yes | Self | Accepted 2026-10-29T21:26:20.585Z (02:26 PKT). |

All eight URLs also received independent production HTTP/redirect, canonical, robots-header and sitemap checks. No Google live indexing request was run for aliases or the reserved 404; they should stay excluded. A live test does not determine Google-selected canonical or guarantee indexing. The already-indexed conclusion for About/article comes from the Google Index view, not the live test.

## Sitemap repair

Search Console XML sitemap: Success; 12 discovered pages; last read 27 October. Removed two mistaken HTML sitemap registrations: https://linkorasolution.com/blog.html and http://linkorasolution.com/blog-post.html?slug=what-is-seo-a-complete-guide-to-ranking-on-google. Both showed Sitemap is HTML with zero discovered pages. Removing these registrations did not remove website pages. The final list contains only the successful XML sitemap. Its canonical URL inventory remains unchanged and it was not resubmitted.

## Scope and remaining Google processing

The confirmed source defect was the Cloudflare-rewritten Privacy email link. No new robots, canonical, sitemap inventory, heading, schema, article-rendering or metadata defect was found in the 12-page live audit. Healthy homepage SEO was retained. Google may continue listing the historical email endpoint and duplicates; a zero-exclusion count is not a valid target. No failed validation or unsubmitted request is represented as accepted.

Evidence: authenticated category and per-URL captures, eight-live-before/after.json, live-seo-before/after.json, gsc-live-tests.json, gsc-indexing-request.json and screenshots in the delivered footer-gsc-repair artifact directory. Implementation: PR #24, squash 9673fa4fc461cebd7274661cb0c45a04bee0882d.

References: [Google Page indexing report](https://support.google.com/webmasters/answer/7440203?hl=en) and [requesting recrawls](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl).
