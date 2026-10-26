import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/ME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const root = resolve('_site');
const server = createServer((q, r) => {
  try {
    const path = new URL(q.url, 'http://local').pathname, file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) throw Error('Outside site');
    r.setHeader('Content-Type', ({ '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.woff2':'font/woff2' })[extname(file)] || 'application/octet-stream');
    r.end(readFileSync(file));
  } catch { r.writeHead(404); r.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless:true, executablePath:process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const nojs = await browser.newContext({ javaScriptEnabled:false, viewport:{ width:390, height:844 } });
  const p = await nojs.newPage();
  await p.goto(base + '/');
  for (const path of ['on-page-seo.html','backlinks.html','guest-posting.html','services.html#technical-seo','services.html#web-development','services.html#multi-site-seo']) assert.ok(await p.locator('main a[href="' + path + '"]').count(), 'Initial service link ' + path);
  await p.goto(base + '/services.html');
  assert.ok(await p.locator('#technical-seo').getByText('What you receive from a technical review').count());
  assert.match(await p.locator('#multi-site-seo').innerText(), /\$1,000/);
  const sitemap = await (await p.request.get(base + '/sitemap.xml')).text();
  const articles = [...sitemap.matchAll(/<loc>https:\/\/linkorasolution.com(\/blog\/[^<]+)<\/loc>/g)].map(m => m[1]);
  for (const path of articles) {
    await p.goto(base + path);
    assert.equal(await p.locator('#blog-article h1').count(), 1);
    assert.ok(await p.locator('#blog-article .blog-article__content p').count() > 1, 'Readable article paragraphs');
    assert.ok(await p.locator('#blog-article nav[aria-label="Project next steps"] a[href="services.html"]').count());
  }
  await nojs.close();
  const context = await browser.newContext({ viewport:{ width:390, height:844 } });
  await context.addInitScript(() => { sessionStorage.setItem('linkora.brandIntroSeen','1'); });
  const page = await context.newPage(), requests = [], failures = [];
  page.on('request', r => requests.push(r.url()));
  page.on('response', r => { if (r.url().includes('/assets/fonts/') && r.status() !== 200) failures.push(r.status()); });
  await page.goto(base + '/about.html');
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return Promise.all(['Inter','Space Grotesk','JetBrains Mono'].map(async f => ({ family:f, loaded:(await document.fonts.load('400 16px "' + f + '"')).length }))); });
  assert.ok(fonts.every(f => f.loaded > 0), 'Original font faces load');
  assert.ok(requests.some(u => /assets\/fonts\/.*\.woff2/.test(u)), 'Local WOFF2 requested');
  assert.equal(requests.some(u => /fonts\.(googleapis|gstatic)\.com/.test(u)), false, 'No Google font request waterfall');
  assert.deepEqual(failures, []);
  assert.equal(await page.locator('footer').getByText('WhatsApp: +92 321 6308339', { exact:true }).count(), 1);
  await context.close();
  console.log('No-JavaScript service/article links, readable articles, approved pricing, local fonts and public phone passed (' + articles.length + ' published articles).');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
