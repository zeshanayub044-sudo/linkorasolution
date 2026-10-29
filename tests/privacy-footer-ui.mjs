// Shared footer and the relocated consent entry point, without real analytics or business writes.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/ME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const root = resolve('_site'), out = process.env.QA_OUT || resolve('.tmp/privacy-footer');
mkdirSync(out, { recursive:true });
const server = createServer((request,response) => {
  try {
    const path = new URL(request.url,'http://local').pathname;
    const file = resolve(root,'.' + (path === '/' ? '/index.html' : path));
    assert.ok(file.startsWith(root + '/') || file.startsWith(root + '\\'));
    response.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)] || 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true,executablePath:process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const results = [];
try {
  const paths = [...readFileSync(resolve(root,'sitemap.xml'),'utf8').matchAll(/<loc>https:\/\/linkorasolution\.com([^<]*)<\/loc>/g)].map(match => match[1] || '/');
  for (const width of [1440,390]) for (const theme of ['dark','light']) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(theme => {localStorage.setItem('linkora.analytics.consent','denied');localStorage.setItem('linkora-theme',theme);sessionStorage.setItem('linkora.brandIntroSeen','1');},theme);
    const page = await context.newPage(), errors = [], google = [];
    page.on('pageerror',error => errors.push(error.message));
    context.on('request',request => {if (/googletagmanager\.com|google-analytics\.com/.test(request.url())) google.push(request.url());});
    for (const path of paths) {
      await page.goto(base + path);
      await page.getByRole('link',{name:'Privacy & cookies',exact:true}).waitFor();
      assert.equal(await page.locator('footer [data-analytics-preferences], footer .analytics-settings, footer button').count(),0,path);
      assert.equal(await page.locator('.footer-bottom > *').count(),2,'Copyright and social links only');
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      assert.ok(await page.locator('footer a[href*="mail.google.com"]').isVisible());
      if (path === '/privacy.html') {
        assert.equal(await page.locator('main a[href^="https://mail.google.com/mail/"]').count(),1,'Privacy contact uses the established compose link rather than a Cloudflare-rewritten mailto target');
        const html = await (await page.request.get(base + path)).text();
        assert.ok(!html.includes('/cdn-cgi/l/email-protection'),'No crawlable Cloudflare email-protection URL');
      }
      assert.ok(await page.locator('.footer-social a').isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),path + ': no horizontal overflow');
      results.push({path,width,theme,footerControlAbsent:true});
      if (path === '/') {
        await page.locator('footer').scrollIntoViewIfNeeded();
        await page.screenshot({path:resolve(out,'footer-' + width + '-' + theme + '.png')});
      }
    }
    await page.goto(base + '/');
    const popup = context.waitForEvent('page');
    await page.getByRole('link',{name:'Privacy & cookies',exact:true}).press('Enter');
    const privacy = await popup;
    await privacy.waitForLoadState('domcontentloaded');
    assert.equal(new URL(privacy.url()).pathname,'/privacy.html');
    assert.equal(await privacy.locator('main [data-analytics-preferences]').count(),1);
    await privacy.getByRole('button',{name:'Change analytics settings',exact:true}).press('Enter');
    await privacy.getByRole('button',{name:'Allow analytics',exact:true}).waitFor();
    assert.equal(await privacy.getByRole('button',{name:'Allow analytics',exact:true}).evaluate(element => document.activeElement === element),true,'Keyboard focus enters choices');
    await privacy.getByRole('button',{name:'Decline analytics',exact:true}).press('Enter');
    assert.equal(await privacy.locator('.analytics-choice').count(),0);
    assert.deepEqual(google,[],'Persistent decline never loads Google');
    assert.deepEqual(errors,[]);
    await privacy.getByRole('button',{name:'Change analytics settings',exact:true}).scrollIntoViewIfNeeded();
    if (width === 390 && theme === 'light') await privacy.screenshot({path:resolve(out,'privacy-settings-mobile.png')});
    await context.close();
  }
  writeFileSync(resolve(out,'privacy-footer-ui.json'),JSON.stringify({date:new Date().toISOString(),base,results,keyboardPrivacyEntry:true,persistentDecline:true},null,2));
  console.log('Privacy/footer passed: ' + results.length + ' public page/viewport/theme combinations; keyboard entry and declined consent.');
} finally {
  await browser.close();server.closeAllConnections();await new Promise(done => server.close(done));
}
