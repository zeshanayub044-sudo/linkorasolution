import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectHtml, validatePages, privatePages, robotsAllows } from '../scripts/audit-public-seo.mjs';
const url = 'https://linkorasolution.com/';
const html = `<head><title>Example &amp; Topic</title><META content='Useful public description' NAME='description'><link href='${url}' rel='canonical'><meta property='og:title' content='Example'><meta property='og:description' content='Description'><meta property='og:url' content='${url}'><meta property='og:image' content='https://linkorasolution.com/assets/linkora-mark.png'></head><main><h1>Topic</h1><h2>Scope</h2><h3>Details</h3></main>`;
test('robots audit respects crawler groups and the most specific matching path', () => {
  assert.equal(robotsAllows('User-agent: *\nAllow: /\nUser-agent: SomeAIbot\nDisallow: /', '/about.html'), true);
  assert.equal(robotsAllows('User-agent: *\nAllow: /\nUser-agent: Googlebot\nDisallow: /', '/about.html'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /services.html', '/services.html'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /admin/\n# Disallow: /', '/about.html'), true);
});
test('SEO audit reads reordered attributes and ignores commented directives', () => {
  const p = inspectHtml(html.replace('</head>', '<!-- <meta name="robots" content="noindex"> --></head>'), url);
  assert.equal(p.title, 'Example & Topic'); assert.deepEqual(validatePages([p]), []);
});
test('public noindex cannot hide in alternate attribute order or HTTP headers', () => {
  const p = inspectHtml(html.replace('</head>', "<meta content='noindex,follow' name='Googlebot'></head>"), url);
  assert.ok(validatePages([p]).some(e => e.includes('indexing blocked')));
  assert.ok(validatePages([{ ...inspectHtml(html, url), xRobots: 'noindex' }]).some(e => e.includes('indexing blocked')));
});
test('audit rejects broken public metadata, private sitemap entries and heading gaps', () => {
  const p = inspectHtml(html.replace('<h3>Details</h3>', '<h4>Details</h4>').replace("rel='canonical'", "rel='alternate'"), url);
  assert.ok(validatePages([p]).some(e => e.includes('self-canonical')));
  assert.ok(validatePages([p]).some(e => e.includes('Skipped heading')));
  assert.ok(validatePages([{ ...p, url: url + 'blog-admin.html' }]).some(e => e.includes('Private/generic')));
});
test('audit catches duplicate metadata and invalid schema without executing scripts', () => {
  const p = inspectHtml(html.replace('</head>', '<script type="application/ld+json">not JSON</script></head>'), url);
  const errors = validatePages([p, { ...p, url: url + 'about.html' }]);
  assert.ok(errors.some(e => e.includes('Duplicate title'))); assert.ok(errors.some(e => e.includes('Duplicate description'))); assert.ok(errors.some(e => e.includes('Invalid JSON-LD')));
});
test('actual static public pages retain unique, crawlable initial metadata', () => {
  const files = ['index.html', ...Object.keys(JSON.parse(readFileSync('content/seo-pages.json', 'utf8')))];
  const pages = files.map(file => inspectHtml(readFileSync(file, 'utf8'), url + (file === 'index.html' ? '' : file)));
  assert.deepEqual(validatePages(pages), []);
  for (const file of privatePages) assert.match(inspectHtml(readFileSync(file, 'utf8'), url + file).robots, /noindex/);
});
