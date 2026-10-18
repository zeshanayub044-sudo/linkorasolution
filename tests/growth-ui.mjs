import {createServer} from 'node:http';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {resolve,extname} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),root=process.cwd();
const server=createServer((q,r)=>{try{const f=resolve(root,'.'+new URL(q.url,'http://local').pathname);if(!f.startsWith(root))throw Error();r.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[extname(f)]||'application/octet-stream');r.end(readFileSync(f))}catch{r.writeHead(404);r.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_EXECUTABLE});
const out=process.env.QA_OUT; if(out)mkdirSync(out,{recursive:true});const report=[];
try{
 for(const width of [1366,390]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.events=[];document.addEventListener('linkora:conversion',e=>events.push(e.detail));window.metrics={cls:0,lcp:0};new PerformanceObserver(l=>l.getEntries().forEach(e=>{if(!e.hadRecentInput)metrics.cls+=e.value})).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>l.getEntries().forEach(e=>metrics.lcp=e.startTime)).observe({type:'largest-contentful-paint',buffered:true});});
  for(const file of ['index.html','about.html','services.html','contact.html','blog.html','careers.html','backlinks.html','guest-posting.html','on-page-seo.html','gmb.html','privacy.html']){
   await page.goto(base+'/'+file);await page.locator('footer .footer-grid').waitFor();await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.locator('h1').count(),1,file+' H1');assert.equal(await page.locator('link[rel=canonical]').count(),1,file+' canonical');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,file+' overflow '+width);
   assert.equal(await page.locator('a[href="#"]').count(),0,file+' fake href');
   assert.equal(await page.evaluate(()=>document.body.innerText.includes('LINKORA SOLUTIONS')),false);
   const schema=await page.locator('script[type="application/ld+json"]').allTextContents();for(const json of schema)assert.equal(JSON.parse(json)['@context'],'https://schema.org');
   const bad=await page.locator('a[target="_blank"]').evaluateAll(links=>links.filter(a=>!a.rel.includes('noopener')||!a.rel.includes('noreferrer')).map(a=>a.href));assert.deepEqual(bad,[],file);
   assert.equal(await page.locator('img:not([alt])').count(),0,file+' alt');
   report.push({page:file,width,...await page.evaluate(()=>metrics)});
   if(out&&((file==='index.html'&&width===1366)||(file==='backlinks.html'&&width===390)||(file==='contact.html'&&width===390))){await page.locator('img').evaluateAll(async images=>{images.forEach(i=>i.loading='eager');await Promise.all(images.map(i=>i.decode().catch(()=>{})))});await page.screenshot({path:resolve(out,file.replace('.html','')+'-'+width+'.png'),fullPage:true});}
  }
  let saved;await page.route('**/functions/v1/marketing-lead',r=>{saved=r.request().postDataJSON();return r.fulfill({status:200,contentType:'application/json',body:'{"accepted":true}'})});
  await page.goto(base+'/contact.html?utm_source=growth-qa&utm_campaign=acceptance&service=Backlinks');
  await page.fill('[name=name]','QA inquiry');await page.fill('[name=email]','qa@example.invalid');await page.fill('[name=message]','A disposable form behavior test.');await page.click('[data-lead-form] button[type=submit]');await page.locator('[data-lead-status]').filter({hasText:'Thank you'}).waitFor();
  assert.equal(saved.utm.utm_source,'growth-qa');assert.equal(saved.service,'Backlinks');assert.equal(saved.source_page,'/contact.html');assert.ok(saved.requestId);
  const events=await page.evaluate(()=>events);assert.deepEqual(events.map(e=>e.name),['lead_form_start','lead_form_submit','lead_form_success']);assert.equal(JSON.stringify(events).includes('qa@example.invalid'),false);assert.equal(await page.locator('[data-linkora-analytics]').count(),0);
  await page.goto(base+'/index.html?utm_source=cross-tab-qa&utm_campaign=handoff');
  if(width<600)await page.click('.nav-toggle');
  const popupEvent=context.waitForEvent('page');await page.locator('nav.links > a').filter({hasText:'Contact'}).click();const popup=await popupEvent;await popup.waitForLoadState();
  assert.equal(new URL(popup.url()).searchParams.get('utm_source'),'cross-tab-qa');assert.equal(await popup.evaluate(()=>window.opener),null);assert.equal(await popup.locator('[name=service]').count(),1);await popup.close();
  assert.equal(await page.locator('a.tennis-portal-link').getAttribute('href'),'tennis-portal.html');
  // Public CMS renderer supports useful links without executing stored markup or unsafe URLs.
  await page.addScriptTag({path:'blog-common.js'});const result=await page.evaluate(()=>{const host=document.createElement('div');document.body.append(host);LinkoraBlog.renderContent(host,'# Test heading\n\nA [safe](backlinks.html) reference. <img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))');return {links:host.querySelectorAll('a').length,images:host.querySelectorAll('img').length,text:host.textContent,url:host.querySelector('a')?.href}});assert.equal(result.links,1);assert.equal(result.images,0);assert.ok(result.url.endsWith('/backlinks.html'));
  const localLink=await page.evaluate(()=>{const host=document.createElement('div');LinkoraBlog.renderContent(host,'[Local quote](contact.html?service=Google%20Business%20Profile%20(GMB))');return host.querySelector('a')?.href});assert.equal(new URL(localLink).searchParams.get('service'),'Google Business Profile (GMB)');
  assert.deepEqual(errors,[]);await context.close();
 }
 if(out)writeFileSync(resolve(out,'mobile-desktop-metrics.json'),JSON.stringify(report,null,2));
 console.log('Public page SEO, schema parsing, mobile overflow, safe navigation, lead/UTM/events and safe Blog links passed at 1366px and 390px.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
