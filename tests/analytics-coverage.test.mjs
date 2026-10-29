import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { seo } from '../scripts/build-public-site.mjs';

const htmlFiles = readdirSync('.').filter(file => file.endsWith('.html'));
const templates = new Set(['blog-post.html', 'career-job.html']);
function integration(html, name) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  for (const source of ['marketing-config.js?v=2', 'marketing.js?v=5']) {
    assert.equal(html.split('src="' + source + '"').length - 1, 1, name + ': one ' + source);
    assert.ok(head.includes('src="' + source + '" defer'), name + ': deferred head integration');
  }
  assert.ok(head.indexOf('marketing-config.js') < head.indexOf('marketing.js?v='), name + ': config first');
  assert.doesNotMatch(html, /googletagmanager\.com\/(?:gtag|gtm)/, name + ': shared loader owns the Google tag');
}
test('Every indexable public document and public CMS template has one shared head integration', () => {
  let count = 0;
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    const indexable = /<link rel="canonical" href="https:\/\/linkorasolution\.com\//.test(html) && !/<meta name="robots" content="[^"]*noindex/.test(html);
    if (!indexable && !templates.has(file)) continue;
    integration(html, file); count++;
  }
  assert.equal(count, 13);
  assert.match(readFileSync('marketing-config.js', 'utf8'), /ga4MeasurementId: 'G-S30W1WLJL9'/);
});
test('Sensitive application documents exclude marketing and Google tags', () => {
  const privateFiles = htmlFiles.filter(file => /admin|portal|attendance|recording|auth|employee/i.test(file));
  assert.ok(privateFiles.length >= 5);
  for (const file of privateFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), /marketing(?:-config)?\.js|googletagmanager\.com|google-analytics\.com/, file);
});
test('Generated article and job metadata preserve the shared integration', () => {
  for (const file of templates) {
    const html = seo(readFileSync(file, 'utf8'), { title: 'Public fixture | LINKORA SOLUTION', description: 'Published public fixture.', url: 'https://linkorasolution.com/' + (file.startsWith('blog') ? 'blog' : 'jobs') + '/fixture.html' });
    integration(html, file);
  }
  integration(readFileSync('scripts/build-service-pages.mjs', 'utf8'), 'Service generator');
});
