# Website error fix report — 31 October 2026

## Confirmed production repairs

| ID / severity | Root cause | Correction | Verification |
|---|---|---|---|
| PUB-01 / P1 | Published Guest Post article had canonical https://linkorasolution.com/what-is-guest-post/, which is 404 and not generated. Artifact link validation stopped five scheduled refreshes; source SHA alone concealed stale CMS output. | Cleared only its canonical override in the existing authenticated editor. Added publication preflight in blog-common.js and blog-admin.js, an inline field hint, and a read-only content-fingerprint/route freshness audit using the existing public content loader. | Manual refresh run 41127366712 succeeded on main. Article 404 → 200; 12 → 13 sitemap URLs; 2 published posts in deployment; live freshness audit passed; 7 publication UI and 3 fingerprint regression groups passed. |
| PERF-01 / P2 | Static Blog listing cards omitted image/category/meta/read-more layout, then blog-list.js emptied the grid before its API result. | scripts/build-public-site.mjs emits the existing full card markup with reserved image dimensions, matching newest-first order. Image links receive an accessible article name in both initial and live markup. blog-list.js keeps initial cards during loading and retains its failure/empty-state handling. | 234 final browser checks passed; Blog CLS max 0.3123 → 0.02449 in the broad lab runs. Six delayed-API combinations checked card geometry and CLS. |
| DB-01 / P2 | public.set_updated_at() had an unrestricted search_path. | New migration 20261030212455_pin_updated_at_search_path.sql sets pg_catalog. Existing body, invoker security and grants retained. | Production migration applied; temporary table insert/update tests passed before/after; advisor warning removed; all 20 public tables retain RLS. |

## Supporting reliability changes

- The browser matrix tests every current published article and open job, replacing the first-article-only assumption; per-slug screenshots avoid overwrites.
- Workflow-fixture output is timestamped at execution and goes to QA_OUT or ignored .tmp, preserving historical committed evidence.
- Reusable read-only route inventory and anonymous backend security checks were added. No new CMS, authentication system, public route redesign or permissions were introduced.
- Healthy public titles, descriptions and copy remain unchanged; the suspected repeated brand suffix was not present in before/after evidence and no title modification was retained.

## Remaining security review

1. Supabase advisor reports leaked-password protection disabled. Account/security settings and credentials were not changed during smoke testing. Owner security review is required; do not infer a breach from this setting alone.
2. A redacted scan of 123 Git commits found password literals in removed legacy attendance seed data in three historical revisions. Exact commit/file identifiers are retained only in the private redacted audit evidence. No values are reproduced. Current source validation found no credentials. Current validity/reuse of those historical values was not tested. Owner should rotate any reused credentials and review historical exposure; no history rewrite or password reset was attempted.

Other advisor notices concern intentionally server-only RLS tables, published-only view counting and guarded authenticated RPCs, plus small-table/unused-index performance notices. These were reviewed without blindly dropping indexes, revoking working RPC grants or weakening RLS.

The publication preflight is a quality guard for the existing editor; backend RLS remains the authorization boundary. A privileged direct database write can still bypass a frontend quality check, and the artifact link audit continues to fail closed.
