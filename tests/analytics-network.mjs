// Uses the real Google tag. Local capture fulfills collection requests; production send is explicit.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/ME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const root = resolve('_site'), out = process.env.QA_OUT || resolve('.tmp/ga4-qa');
mkdirSync(out, { recursive:true });
const server = createServer((request, response) => {
  try {
    const path = new URL(request.url, 'http://local').pathname;
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : extname(path) ? path : path + '.html'));
    assert.ok(file.startsWith(root + '/') || file.startsWith(root + '\\'));
    response.setHeader('Content-Type', ({ '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2' })[extname(file)] || 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:' + server.address().port;
const send = process.env.GA4_SEND === '1';
assert.ok(!send || base === 'https://linkorasolution.com', 'Only explicit public production verification may transmit real hits');
const browser = await chromium.launch({ headless:true, executablePath:process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const context = await browser.newContext({ viewport:{ width:1440,height:960 }, reducedMotion:'reduce' });
const records = [], statuses = [], requests = [], checks = [];
let tags = 0, tagResponses = [];
function decoded(request) {
  const shared = new URL(request.url()).searchParams;
  return (request.postData() || '').split('\n').map(line => {
    const params = new URLSearchParams(shared);
    for (const [key,value] of new URLSearchParams(line)) params.set(key,value);
    return params;
  });
}
async function until(predicate, message) {
  const deadline = Date.now() + 30000;
  while (!predicate() && Date.now() < deadline) await new Promise(done => setTimeout(done,100));
  assert.ok(predicate(), message);
}
try {
  await context.addInitScript(() => {
    window.open = () => null;
    document.addEventListener('click', event => { if (event.target.closest('a[href]')) event.preventDefault(); }, true);
  });
  await context.route(/https:\/\/[^/]*(?:google-analytics\.com|analytics\.google\.com)\/(?:g\/collect|collect)/, async route => {
    const request = route.request();
    for (const params of decoded(request)) {
      assert.equal(params.get('tid'), 'G-S30W1WLJL9', 'One approved destination only');
      assert.ok(![...params.values()].some(value => value.includes('network-private-canary')), 'No test query/form content in any Google collection field');
      records.push(Object.fromEntries(['tid','en','dl','dt','dr','gcs','ep.service_name','ep.source_page','ep.cta_location'].filter(key => params.has(key)).map(key => [key,params.get(key)])));
    }
    requests.push(request.url());
    if (send) await route.continue();
    else await route.fulfill({ status:204 });
  });
  context.on('request', request => { if (request.url().startsWith('https://www.googletagmanager.com/gtag/js?')) tags++; });
  context.on('response', response => {
    if (response.url().startsWith('https://www.googletagmanager.com/gtag/js?')) tagResponses.push(response.status());
    if (/google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect/.test(response.url())) statuses.push(response.status());
  });
  const page = await context.newPage();
  await page.goto(base + '/');
  await page.locator('[data-analytics-preferences]').waitFor();
  assert.equal(tags,0);
  assert.equal(records.length,0);
  await page.getByRole('button',{ name:'Decline analytics',exact:true }).click();
  await page.goto(base + '/about.html');
  assert.equal(tags,0,'Decline persists without a Google request');
  await page.locator('[data-analytics-preferences]').click();
  await page.getByRole('button',{ name:'Allow analytics',exact:true }).click();
  await until(() => records.some(row => row.en === 'page_view'), 'Real Google SDK generated a page view after opt-in');
  assert.ok(tagResponses.some(status => status >= 200 && status < 400));
  checks.push('Real Google script loads successfully only after opt-in; persistent decline sends no tag/collection request.');
  const sitemap = await (await page.request.get(base + '/sitemap.xml')).text();
  const paths = [...sitemap.matchAll(/<loc>https:\/\/linkorasolution\.com([^<]*)<\/loc>/g)].map(match => match[1] || '/');
  paths.push('/index.html', '/about');
  const pages = [];
  for (const path of paths) {
    const before = records.length, tagBefore = tags;
    await page.goto(base + path + (send ? '' : '?email=network-private-canary%40example.invalid&search=network-private-canary&utm_source=network-private-canary'));
    await until(() => records.slice(before).some(row => row.en === 'page_view'), path + ': page view');
    await page.waitForTimeout(350);
    const views = records.slice(before).filter(row => row.en === 'page_view');
    assert.equal(views.length,1,path + ': one page view');
    assert.equal(tags-tagBefore,1,path + ': one external Google loader');
    assert.equal(views[0].dl,base + path,path + ': safe actual URL');
    assert.equal(views[0].dt,await page.title(),path + ': actual final title');
    assert.equal(await page.locator('head script[data-linkora-analytics]').evaluate(element => element.async),true);
    pages.push({ path,title:views[0].dt,pageViews:views.length });
  }
  checks.push('One real-SDK page view with the correct URL/title and asynchronous head loader on every current sitemap page.');
  await page.goto(base + '/services.html');
  await until(() => records.at(-1)?.en === 'page_view', 'Services view is ready');
  const beforeClicks = records.length;
  await page.locator('.services-nav > a').hover();
  await page.locator('.services-dropdown a[href$="#web-development"]').click();
  await page.locator('header a[href*="wa.me"]').click();
  await until(() => records.slice(beforeClicks).some(row => row.en === 'service_cta_click') && records.slice(beforeClicks).some(row => row.en === 'whatsapp_click'),'Real SDK CTA and WhatsApp collection');
  assert.equal(records.slice(beforeClicks).filter(row => row.en === 'service_cta_click').length,1);
  assert.equal(records.slice(beforeClicks).filter(row => row.en === 'whatsapp_click').length,1);
  checks.push('Real SDK emits one Web Development CTA and one WhatsApp event, with controlled labels and no destination URL/contact text.');
  if (!send) {
    await page.route('**/functions/v1/marketing-lead',route => route.fulfill({ contentType:'application/json',body:'{"accepted":true}' }));
    await page.goto(base + '/contact.html?email=network-private-canary%40example.invalid');
    await page.locator('[name=name]').fill('network-private-canary');
    await page.locator('[name=email]').fill('network-private-canary@example.invalid');
    await page.locator('[name=message]').fill('network-private-canary');
    await page.locator('[name=service]').selectOption('Web Development');
    await page.locator('[data-lead-form] button[type=submit]').click();
    await page.locator('[data-lead-status]').filter({hasText:'Thank you'}).waitFor();
    await until(() => records.some(row => row.en === 'generate_lead') && records.some(row => row.en === 'quote_request'),'Real SDK confirmed-success lead/quote requests (intercepted)');
    assert.equal(records.filter(row => row.en === 'generate_lead').length,1);
    assert.equal(records.filter(row => row.en === 'quote_request').length,1);
    checks.push('Real SDK produces confirmed-only lead/quote requests without PII; both business and Google collection endpoints intercepted for synthetic form data.');
  }
  const beforeWithdrawal = records.length;
  await page.locator('[data-analytics-preferences]').click();
  await page.getByRole('button',{name:'Withdraw analytics',exact:true}).click();
  await page.locator('main a[href*="wa.me"]').first().click().catch(async () => page.locator('header a[href*="wa.me"]').click());
  await page.waitForTimeout(1200);
  assert.equal(records.length,beforeWithdrawal,'Withdrawal sends no further collection pings/events');
  assert.equal(await page.evaluate(() => window['ga-disable-G-S30W1WLJL9']),true);
  if (!send) {
    const viewCount = records.filter(row => row.en === 'page_view').length;
    await page.locator('[data-analytics-preferences]').click();
    await page.getByRole('button',{name:'Allow analytics',exact:true}).click();
    await page.waitForTimeout(1000);
    assert.equal(records.filter(row => row.en === 'page_view').length,viewCount,'Real SDK does not duplicate the page view after regrant');
    const beforeRegrantClick = records.filter(row => row.en === 'whatsapp_click').length;
    await page.locator('main a[href*="wa.me"]').first().click();
    await until(() => records.filter(row => row.en === 'whatsapp_click').length === beforeRegrantClick + 1,'Regrant restores a permitted event');
    checks.push('Real SDK regrant restores event collection without another page view.');
  }
  if (send) {
    await until(() => statuses.length >= requests.length,'Collection response statuses received');
    assert.ok(statuses.every(status => status >= 200 && status < 300),'Google accepted all collection requests over HTTP');
  }
  checks.push('Real SDK stops collection after withdrawal; no hidden denied-consent pings.');
  writeFileSync(resolve(out,send ? 'analytics-production-network.json' : 'analytics-real-sdk-capture.json'),JSON.stringify({ date:new Date().toISOString(),mode:send ? 'production requests sent to Google; no form submission' : 'real SDK, collection and business endpoints intercepted',measurementId:'G-S30W1WLJL9',checks,pages,tagResponses,collectionStatuses:statuses,events:records },null,2));
  console.log('Real Google SDK verified: ' + pages.length + ' public pages; ' + checks.length + ' network/privacy groups; mode=' + (send?'production':'intercepted'));
} finally {
  await context.close();
  await browser.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
