# Technical SEO audit — 18 October 2026

## Public architecture and indexability

The static public sitemap includes Home, Services, About, Blog, Careers, Contact, Privacy and four new service landing pages. Employee Portal, Attendance, Blog Admin, Careers Admin and Attendance Admin are excluded. Private templates carry noindex/nofollow; robots.txt allows crawling so search engines can read those directives. Robots is not authorization. Auth/RLS continue to enforce access.

New routes: `/backlinks.html`, `/guest-posting.html`, `/on-page-seo.html`, `/gmb.html`. Existing `services.html#...` fragment routes remain present for old inbound links. Header dropdown, service cards, Services detail links and footer route to the dedicated pages. Web Development and the 12-Website plan remain linked to their existing sections.

Important static public pages have one H1, a title, description, canonical, Open Graph metadata, image alt attributes, protected new-tab links, mobile layouts and CTAs. Service pages add Service and BreadcrumbList JSON-LD matching visible content. Organization/WebSite data uses only existing company name, website, phone, email and supplied lion mark. No ratings, invented reviews, address or legal registration schema is published. Buyer FAQs are visible; no Google FAQ rich-result eligibility is claimed.

## Blog and Careers

Blog articles are rendered from the existing public API with `status=published`, title, excerpt, author, dates, featured image, SEO fields, canonical and Article JSON-LD. Initial/missing/unpublished article templates remain noindex. Published articles switch to index/follow after a successful published-row response. Google must render JavaScript for this architecture; no server-rendered social-card response or guaranteed Google indexing is claimed. Careers retains its existing JobPosting metadata and open-job filtering. Blog post rows in draft state remain private; the existing blog-images bucket is public, so uploaded images are public assets even before a post is published. Do not use it for confidential drafts or client evidence.

`scripts/update-blog-sitemap.mjs` reads only published slugs through the browser-safe API and refreshes Blog URLs in the public sitemap. Run it after publication/unpublication and publish the reviewed sitemap through the repository workflow. The current architecture has no authenticated CMS-to-GitHub rebuild webhook; automatic immediate sitemap synchronization remains a configuration/automation gap. Drafts are never read by this tool. Prepared editorial source JSON is excluded from the Pages build using `_config.yml`; the public GitHub repository is not a confidential draft store.

## Performance/mobile work

- Replaced references to the 1,326,546-byte plural full-logo asset in public intro/social metadata with the existing 32,566-byte lion mark (about 97.5% smaller). Original owner image retained. No branding was regenerated or invented.
- Added logo dimensions, image decoding hints, Blog image dimensions/aspect ratio and lazy loading where appropriate; leadership portraits keep their existing small assets and lazy loading.
- Added font-origin preconnects. Existing font request already uses display=swap. No extra animation library or marketing framework added.
- Quote forms use responsive grids, dark input styling, clear focus rings, bounded fields and visible feedback. Reduced-motion users see reveal content without waiting for scrolling animation.
- Public browser QA at 1366px and 390px checks horizontal overflow, console exceptions, safe links, required metadata and JSON parsing. Lab PerformanceObserver values are recorded as diagnostic artifacts; they vary with font/network/cache state and collection timing. Zero/early observations are not a performance score. No CrUX, field INP or Search Console access was supplied, so real-user LCP/CLS/INP remains unverified. The existing first-visit intro is retained; review field data before further animation changes.

## QA matrix

| Route | Title/description/H1/canonical | Schema | Responsive/navigation/form |
|---|---|---|---|
| `/` | Static; canonical root | Organization, WebSite | Desktop/mobile checked; service cards and quote CTA |
| `/services.html` | Static | Organization, WebSite | Dropdown/order modal preserved; approved plan price |
| `/about.html` | Static | Organization, WebSite | Verified leadership; proof host disabled |
| `/contact.html` | Static | Organization, WebSite | Lead success/UTM/events checked; direct contact retained |
| `/backlinks.html` | Static | Service, BreadcrumbList, Organization, WebSite | Full content/FAQ/lead form |
| `/guest-posting.html` | Static | Service, BreadcrumbList, Organization, WebSite | Full content/FAQ/lead form |
| `/on-page-seo.html` | Static | Service, BreadcrumbList, Organization, WebSite | Existing package prices preserved |
| `/gmb.html` | Static | Service, BreadcrumbList, Organization, WebSite | Accurate local-service scope and FAQs |
| `/blog.html` | Static listing metadata | Organization, WebSite | Three real articles listed; desktop/mobile rendering verified |
| `/blog-post.html?slug=...` | Dynamic published metadata; noindex otherwise | Article | Published-only API; safe links; CTA; real CMS acceptance passed; see CONTENT_STRATEGY.md |
| `/careers.html` | Static listing metadata | Organization, WebSite | Existing applications preserved; event contains no applicant details |
| `/career-job.html?slug=...` | Existing dynamic open-job metadata | JobPosting | Existing secure application flow retained |
| `/privacy.html` | Static | Organization, WebSite | Inquiry/analytics data notice |

## Validation and remaining gaps

Run `node scripts/validate.mjs`, Deno tests/checks, `tests/growth-ui.mjs`, `tests/public-navigation-ui.mjs` and the existing Employee/Admin recording browser regressions. JSON-LD parsing and internal-link checks pass locally; this does not equal a Google Rich Results or Search Console validation result. Confirm Pages returns the exact merged public assets, all new routes return HTTP 200 and private/draft source paths return 404 after deployment.

Existing project security warnings outside this marketing scope include mutable search_path on set_updated_at, intentionally callable legacy SECURITY DEFINER RPCs, and disabled leaked-password protection. The new private rate table has RLS with no client policies intentionally. The new management predicate is a reviewed authenticated-only boolean API, documented in LEAD_TRACKING_SETUP.md. No unrelated security policies or deployed migrations were rewritten.

Sources reviewed: [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [spam policies](https://developers.google.com/search/docs/essentials/spam-policies), [local ranking guidance](https://support.google.com/business/answer/7091), and [business representation guidelines](https://support.google.com/business/answer/3038177). No ranking outcomes are promised.
