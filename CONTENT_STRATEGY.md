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

At the initial audit, production contained zero Blog posts. Real owner dashboard sign-in was verified. Publication, editing, unpublication, image upload and logout acceptance will be recorded below only after those actions are observed; prepared files alone do not establish successful publishing.

## Publication acceptance record

Pending deployment of the upgraded editor and real signed-in CMS acceptance. Do not treat this section as a claim that the drafts are published.

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
