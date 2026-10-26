# Technical SEO validation - 26 October 2026

Reusable checks: node scripts/validate.mjs; node scripts/build-public-site.mjs; node tests/public-link-audit.mjs; node scripts/audit-public-seo.mjs --output docs/seoptimer-repair/local-audit.json. Add --live for HTTP/initial production metadata and header verification. The auditor validates canonical sitemap entries, duplicates, H1/heading hierarchy, descriptions, OG, JSON-LD syntax, image alt attributes, public noindex (including response header) and excluded application/template noindex. It does not pretend to determine Google indexing.

## Live baseline

12 sitemap URLs return 200, with valid initial content and metadata. Root/index raw HTML is byte-identical and self-canonicalized to root. HTTP root/About return 200 without TLS forwarding. www returns 301 to the same protocol on non-www. /about is a 200 alias with .html canonical; /about.html/ returns 404. Healthy extension URLs remain. robots.txt allows public crawling and references the actual sitemap.

After the authorized Cloudflare repair, HTTP root/About redirect with 301 to HTTPS. HTTP www reaches HTTPS non-www through two hops. Query preservation and final 200/no-loop were verified. Baseline status above remains historical evidence.

## Artifact and rendering

12 intended canonical routes and seven excluded application/generic templates. No public sitemap entries for private admin/employee/resume/recording/draft resources. Auth is enforced by backend policies, not robots. JSON-LD parses and existing Organization, Service, BreadcrumbList and BlogPosting remain truthful. No fake LocalBusiness location, rating or JobPosting was added. No open job currently exists. The article format is verified both without JavaScript and after API replacement.

## Performance and assets

Original Inter/Space Grotesk/JetBrains Mono are self-hosted with all 16 original variable-font subsets, font-display swap, a body-font preload and hash filenames. Licenses and upstream sources/hashes are in assets/fonts. Total stored subsets 332,744 bytes; the three Latin subsets total 101,976 bytes. Unicode ranges prevent unnecessary subset downloads. Public pages no longer wait on Google font CSS or font-host handshakes. Tiny early theme bootstrap and necessary critical CSS remain. Existing logos/portraits are already compact in the page (mark 32,566 bytes; founder 22,567); the large original logo file is not the rendered header asset. Footer logo dimensions/lazy behavior are explicit.

SEOptimer remote lab reports mobile 92 / desktop 99. Local Lighthouse lab before/after is measured separately and warnings/CPU variability must be disclosed. There is no sufficient field CWV dataset; lab TBT is not field INP. No unmeasured performance claim.

## Security and scope

RLS remains enabled for six checked Blog/Careers/employee/lead tables. Existing public Blog policy restricts reads to published posts, Career job policy to open/unexpired roles, and applicant reads to authorized admins. No schema, grant, Auth or permission change. The only production data edit is formatting the existing published article/excerpt and adding primary references. Original body-text preservation was verified. No production junk lead, applicant, attendance event, user deletion or recording is created for tests.

The security advisor also reports pre-existing review items: one mutable function search path, anonymous/authenticated SECURITY DEFINER RPC warnings, no-policy internal tables (RLS enabled, default denial), and disabled leaked-password protection. These are not silently treated as cleared. The SEO task does not alter private access functions or Auth settings. Review through the existing security workflow: https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Test limits

Edge/Chrome responsive and safe workflow fixtures are used; no Firefox/Safari/physical-device pass or fresh real employee login is claimed. No credentials are hardcoded. Publishing and final production checks are recorded in the delivery receipt.
