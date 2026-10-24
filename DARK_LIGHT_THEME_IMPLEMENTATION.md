# Dark/light theme implementation — 24 October 2026

## Architecture and coverage

`theme-init.js` creates one sun/moon button in `.site-header .header-actions`, with an appropriate label and pressed state. A small inline bootstrap before CSS sets `data-theme` and `color-scheme`; the external interaction code is deferred. `theme.css` maps the existing shared CSS tokens to white/off-white surfaces, dark type, restrained teal/blue/gold accents, subtle borders/shadows and readable forms. Images are not inverted. Default remains dark regardless of OS preference; only a stored explicit `light` value changes it.

The 13 public templates and the two compatible Blog/Careers admin headers inherit it. Employee/Attendance applications have independent styles and remain dark; importing public theme tokens into those application layouts was deliberately avoided. Their noindex/Auth/RLS controls are unchanged.

## Persistence and accessibility

The functional preference key is `linkora-theme` with `dark`/`light`. It persists in localStorage across refresh, tabs and subsequent visits. Storage events synchronize tabs. If storage is blocked, switching still works in memory and no login or form depends on storage success. This preference is not sent to analytics. The button is a real `type=button`, supports Enter/Space, has visible focus, accessible next-action labels and `aria-pressed`. Reduced motion disables nonessential animation. Dark/light normal-text token contrast on the main card surface is checked against 4.5:1; this is not a blanket independent accessibility certification.

`header-nav.js` owns header menu state for public and compatible admin pages. Closed small-screen menus are inert; Escape closes the menu and restores focus. Duplicate handlers were removed from public/Blog/Careers scripts. Form, authentication, publication and attendance action semantics are retained.

## Performance and maintenance

Font stylesheets are discovered in the HTML head instead of an additional CSS `@import` waterfall. Theme and intro bootstraps run synchronously in a few hundred bytes; larger behavior scripts are deferred. The intro still respects its once-per-session key and reduced motion. No page reload or duplicate theme stylesheet is used when switching.

For new public pages include the early bootstrap, `theme-init.js`, `header-nav.js` and `theme.css` after component styles. Use semantic custom properties rather than new fixed dark text/background pairs. `scripts/build-service-pages.mjs` preserves the shared theme/font includes; `scripts/apply-public-seo.mjs` reapplies public metadata and breadcrumbs.

Run `node scripts/build-public-site.mjs`, then `node tests/website-smoke.mjs`. The matrix covers 320, 375, 390, 768, 1024, 1440 and 1920px in both themes on Edge; installed Chrome also runs representative mobile/desktop widths. Read the evidence JSON for actual browser availability and results. Firefox/WebKit/physical Android/iOS testing must not be inferred from Chromium viewport emulation.

The publisher compares a digest of the reviewed commit and public content (excluding view counts). Unchanged snapshots skip deployment. The five-minute schedule is approximate; GitHub queues and CDN/browser caching can extend propagation.
