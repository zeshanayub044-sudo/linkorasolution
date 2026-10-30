# Technical SEO re-audit — 31 October 2026

Fresh production inventory: 13 canonical public pages, 7 root application/detail-template exclusions and 7 known aliases/retired paths (27 endpoints total). Public pages returned 200, have one H1, unique nonempty title/description, one preferred canonical, parseable structured data and crawlable initial content. Live SEO audit passed with zero errors. Current sitemap includes both published articles and no private routes or closed jobs.

The new article publication defect was a CMS canonical override, not a robots or Auth failure. Its static URL now returns 200, is self-canonical and appears in the 13-URL sitemap. The authenticated editor can no longer publish with an unreachable/noindex/alternate local canonical without an actionable error; blank canonical uses the generated URL. The existing build safety check remains enabled.

All 701 initial references/fragments passed in the repaired build. Runtime Services hover/focus, mobile nav and new-tab/opener protections passed. Published article body text is available without JavaScript; generic readers remain intentionally noindex. BlogPosting, BreadcrumbList and Organization/WebSite JSON-LD were parsed; no review stars, invented employment openings or fabricated claims were added. Google live smartphone tests passed for the corrected article and Services, including crawl/fetch/index permission and self-canonical.

HTTP apex redirects 301 to HTTPS. HTTPS www redirects 301 to apex; HTTP www takes two 301 hops. /index.html remains a 200 alternate canonicalizing to /. This is supported on Pages and excluded from the sitemap; no false server-301 claim is made. The reserved /cdn-cgi/l/email-protection and erroneous /what-is-guest-post/ remain 404, unlinked and absent from the sitemap. Do not request their indexing.

Performance: local 234-run lab LCP p50 492 ms, p75 700 ms, max 7064 ms; these unthrottled, variable-load readings are not field CWV or evidence of universal fast loads. Blog CLS improved from max 0.3123 to 0.02449 in the broad runs; a gated API test separately measured max 0.04552. A one-off GMB 375-px CLS 0.1300 was investigated: three cold-context probes measured 0.06967, 0.05690 and 0.05690, with font/header/hero sources. No unproven global font redesign was applied. Search Console shows no mobile/desktop field CWV data, so field INP/CWV pass cannot be claimed.

The 1.33 MB original logo remains a brand asset; critical headers use the existing 32.6 KB mark. Local WOFF2 requests passed and no Google Fonts waterfall was observed. No claim of a Lighthouse score or third-party tool score was invented.

The sections below are historical evidence from prior releases, not current execution results.

---

# Technical SEO audit — 24 October 2026

## Verified baseline and Google evidence

`docs/theme-seo/baseline.json` contains actual HTTP/initial-HTML records for all 18 root pages and host/path variants. Eleven canonical static public pages were reachable with one H1 and healthy self-canonicals; five private/management templates had intentional noindex. The two generic detail templates had no initial H1/canonical and noindex. The Blog listing had no initial article links or excerpts. Initial noindex on the Blog template is a real rendering/indexability barrier: Google may skip rendering it, so a later JavaScript change cannot be assumed to rescue it.

Search Console was accessed on the verified domain property. Its 16 October report showed 1 indexed URL and 5 excluded homepage aliases: 3 alternate canonicals and 2 www redirects. Those exclusions are expected, not broken canonicals on About/Services. About URL Inspection explicitly reported unknown to Google, no last crawl, no referring sitemap and no referring page. The Sitemaps report contained two HTML URLs, both Unknown/1 error/0 discovered URLs; the real XML sitemap was not submitted. See `docs/theme-seo/gsc-before.json`. There was no mobile/desktop field Core Web Vitals data. Do not label all public pages crawled-but-not-indexed based on this evidence.

## Repairs implemented

The artifact builder reads only the public, published/open Supabase API with the existing publishable key. It emits static Blog HTML at `/blog/<slug>.html`, initial listing links/excerpts, unique title/description/social/canonical metadata, real author/date/image information, and BlogPosting JSON-LD. Generic legacy query URLs remain functional and resolve the same canonical route when it exists. This is a small route extension with backward compatibility, not a blanket URL rewrite; GitHub Pages cannot provide a query-specific server 301. New posts fall back to the existing query reader until a static route has been built.

Every build creates a fresh output directory after a successful content fetch, removes obsolete article/job snapshots, and regenerates sitemap.xml from canonical static pages plus current published/open records. Reliable database updated_at values supply dynamic lastmod; no fake static modification dates are generated. Private, draft, closed and generic no-parameter detail routes are excluded. No draft text is written to Git or the artifact. The publisher is owner-approved after merges and on an approximately five-minute GitHub schedule. Scheduler/deployment delays are possible. Builds fail closed without replacing the previous deployment when the API fails.

Live reader revalidation removes an unpublished/closed snapshot and its content schema and sets noindex. A no-JavaScript client or crawler can see a formerly public snapshot until the next successful deployment. This is not instantaneous removal or a confidential draft store. Strict immediate withdrawal would require request-time hosting; the static-host delay is explicitly disclosed in CMS notices and this documentation.

Public breadcrumbs, intent-specific metadata and social metadata are maintained in `content/seo-pages.json` and `scripts/apply-public-seo.mjs`. Homepage SEO/hero content is preserved. Existing Organization/WebSite/Service schema is retained. JSON-LD is parsed during smoke testing; no ratings, reviews, addresses or credentials were invented. There are currently no open jobs. Future JobPosting rich-result eligibility still depends on accurate editor-supplied location and hiring details; no physical address or remote-applicant country was invented.

## Robots, security and duplicate hosts

robots.txt intentionally allows crawling so search engines can read noindex on private templates; it is not an authorization mechanism. Auth/RLS/private resume and recording protections remain unchanged. Every generated artifact uses an explicit file allowlist: public frontend files/assets only; no .env, backend source, tests, documentation, draft JSON or Git metadata. Public Blog/lead RLS and ordinary-user denial were checked without committed database changes.

Preferred host remains `https://linkorasolution.com`. www redirects correctly; /index.html and extensionless variants use the existing canonical signal. HTTP returned 200 in the baseline. GitHub Pages shows HTTPS enforcement unavailable because the custom domain is not configured for that control, despite successful DNS check and working live HTTPS. No DNS, proxy, certificate or security setting was changed blindly. Hosting/DNS-owner investigation is required to enforce HTTP→HTTPS server redirects. Canonicals are not represented as a replacement for transport security.

## Performance and evidence

The baseline Lighthouse mobile About run recorded performance 70, accessibility 98 and SEO 100, LCP/FCP about 4.0 seconds, CLS 0.001 and TBT 180ms. These are one lab run, not field INP/CrUX, a guarantee or statistically controlled performance results. It identified the font/CSS waterfall, blocking intro and heading skips. Font discovery, small early bootstraps with deferred behavior and semantic heading fixes were implemented. Raw baseline and final smoke/performance evidence are stored under docs/theme-seo; post-deployment results belong to the delivery report. Original logo/portrait images remain unaltered; below-fold portraits stay lazy with dimensions. No ranking/indexing guarantee is made.

Official references: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics ; https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag ; https://developers.google.com/search/docs/appearance/structured-data/article ; https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages .

The publisher compares a digest of the reviewed commit and public content (excluding view counts). Unchanged snapshots skip deployment. The five-minute schedule is approximate; GitHub queues and CDN/browser caching can extend propagation.
