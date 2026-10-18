# Buyer-intent content strategy

## Initial editorial set

Three prepared articles contain approximately 875–900 words each, practical scope/evaluation advice, logical headings, buyer questions, responsible limits, relevant service links and a quote CTA. No invented statistics, customer results, experience claims or research are included.

| Prepared draft | Search intent / primary topic | Service links |
|---|---|---|
| `evaluate-backlink-quality-before-outreach` | Compare outreach providers and evaluate backlink quality before committing budget | Backlinks, Guest Posting, Contact |
| `on-page-seo-checklist-business-websites` | Plan or commission on-page SEO with explicit acceptance criteria | On-Page SEO, Services packages, Contact |
| `google-business-profile-optimization-checklist` | Assess local profile readiness and choose a realistic optimization scope | GBP, On-Page SEO, Contact |

Source files: `content/blog-drafts/*.json`. They include intent and primary keyword notes plus the CMS fields. These are original editorial drafts, not evidence of past client performance. Public Pages excludes this directory; the GitHub repository itself is public, so do not put confidential editorial material there.

## Legitimate CMS workflow

Sign in to the existing Blog Admin as an authorized active Co-CEO. Use **Load prepared draft** to select a JSON file. The importer populates the existing form, forces draft state and does not write to the database. Review the title, slug, content and SEO fields, then use normal Save. Publish through the normal confirmation action; backend authorization/RLS remains authoritative. Primary keyword and intent are planning notes, not injected keywords or public claims.

The renderer supports headings, lists and safe `[label](https://...)` or relative document links using DOM text nodes. Stored HTML is not executed and unsafe URL protocols/credential URLs remain plain text. Blog featured images remain restricted to the existing public blog-images bucket and authorized upload rules.

At the initial audit, production contained zero Blog posts. Real owner dashboard sign-in was verified. Creation, editing, publishing, unpublishing, featured-image upload and logout were exercised through the real signed-in CMS. Prepared files alone were not used as publication evidence.

## Publication acceptance record

Verified on 18 October 2026 as muneebansari1993@gmail.com (active Co-CEO → Blog Admin), with no password or role changes:

- Saved the outreach article as a draft with the supplied lion mark uploaded through the normal featured-image control; the image URL returned HTTP 200.
- Edited and saved its excerpt, published it, verified public API access, unpublished through the editor, verified the public API returned zero rows, then republished.
- Imported/reviewed and published the on-page and GBP articles through the same editor. All three database rows are published and the public listing shows three articles.
- Verified all three real public pages at 1366px and 390px: content, featured image where supplied, author, dates, SEO title/description/canonical/OG, Article schema, safe internal links and CTA. A missing/unpublished URL remains noindex.
- View counts increased during actual browser acceptance; these include internal QA visits and are not customer-performance proof.
- Verified Sign out returns to the protected sign-in form with the dashboard hidden.
- Rollback-only SQL tests verified ordinary Employee denial for management INSERT/UPDATE/DELETE and draft reads, anonymous draft denial, and authorized draft deletion. No disposable CMS post was left behind. Actual destructive UI deletion was not performed; real articles were retained.
- Standardized the existing corporate author display name from LINKORA SOLUTIONS to LINKORA SOLUTION, preserving its Auth UUID and every permission. Corporate authors use Organization schema; personal authors retain Person.

Published URLs:

- https://linkorasolution.com/blog-post.html?slug=evaluate-backlink-quality-before-outreach
- https://linkorasolution.com/blog-post.html?slug=on-page-seo-checklist-business-websites
- https://linkorasolution.com/blog-post.html?slug=google-business-profile-optimization-checklist

The public-API sitemap refresh includes these three published URLs. Future publication/unpublication still requires the documented sitemap refresh; no automatic CMS-to-GitHub webhook is configured.

## Indexing and promotion

After publishing, run `node scripts/update-blog-sitemap.mjs`, review the published-only URLs and publish the sitemap through the normal PR workflow. Repeat after unpublishing to remove stale entries. There is no configured CMS-to-GitHub rebuild webhook. Public articles have canonical/title/description/OG/Article metadata after JavaScript rendering; actual Google indexing requires crawling and is not guaranteed. Review indexing in the owner’s Search Console property when access is available.

## Next editorial priorities

1. Link-building cost: explain scope drivers, qualification, content and reporting rather than inventing market prices.
2. Guest posts versus niche edits: compare editorial context, commercial disclosure, risk and audience fit; avoid selling ranking credit.
3. SEO retainer versus a one-time project: help a buyer decide based on recurring work, implementation capacity and measurement.
4. Choosing an SEO agency: evaluate deliverables, access management, reporting and substantiated evidence.
5. Traffic without conversions: distinguish intent, offer, usability, form reliability and attribution; use verified first-party examples only.
6. Professional SEO audit deliverables: tie findings to implementation ownership and validation.

Each new brief should specify the buyer decision, questions it answers, evidence/source requirements, service destination and an appropriate CTA. Review actual inquiry quality and Search Console queries before increasing volume. Maintain facts, broken links and screenshots; obtain publication permission for any future client evidence.
