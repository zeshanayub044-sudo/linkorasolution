# Google indexing recovery plan — 24 October 2026

## Actual diagnosis

Confirmed: About is unknown to Google, has never been crawled in the URL Inspection record, and has no detected referring sitemap. Two HTML page URLs were incorrectly submitted as sitemaps and show errors. Google's Page Indexing report last updated 16 October lists five excluded homepage variants; those canonical/redirect exclusions are normal. It does not establish that every service URL was crawled and rejected. The existing Blog template's initial noindex/client-only content is a separate code-confirmed indexing barrier.

Implemented: published-only static Blog pages and initial listing links, canonical sitemap regeneration, useful page-specific metadata/breadcrumbs, preserved homepage SEO and private noindex, and an owner-approved public-content publishing schedule. See TECHNICAL_SEO_AUDIT.md for static removal latency and host/HTTPS limits.

## Submission and validation

After production deployment is verified, submit only `https://linkorasolution.com/sitemap.xml` in the verified domain property's Sitemaps screen. HTML Blog/Article URLs are not sitemaps. Check the submission's real Success/Last read/discovered count; acceptance alone does not prove indexing. Historical invalid submissions do not need to be deleted to submit the correct XML.

Inspect About, Services and the current static article URL. Use Test live URL to confirm successful fetch, indexing allowed, rendered H1/content and the intended canonical. Request indexing for representative genuinely updated pages if Google's UI allows it. A queued request is not an indexed result. Do not click validation for the expected canonical/redirect aliases to try to make them index independently.

## Monitoring and owner actions

Review sitemap processing and URL Inspection over the next 2–4 weeks, prioritizing unknown/discovered URLs. Use the actual subsequent GSC reason for each affected URL, not assumptions. If Google crawls but does not index healthy unique pages, assess query intent, usefulness, duplication and real external discovery signals; never buy indexing or fabricate proof.

Investigate the disabled GitHub HTTPS enforcement control with the DNS/proxy/hosting owner and configure an approved server HTTP→HTTPS redirect. Keep domain, TLS and canonical policy consistent. Do not change DNS records without a verified plan. GSC currently has no field Core Web Vitals data; collect enough real traffic before claiming field LCP/INP/CLS results. No page's future indexing or ranking is guaranteed.

The delivery report records which deployment, submission and inspection actions were actually performed. The steps above remain the repeatable recovery procedure for future CMS changes, not a claim that Google has indexed the upgraded URLs.
