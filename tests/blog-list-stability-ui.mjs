// Real browser, gated fixture API: never writes content or sends analytics.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { readPublicContent } from '../scripts/build-public-site.mjs';
const { posts } = await readPublicContent();
posts.sort((a,b) => new Date(b.published_at) - new Date(a.published_at));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/ME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const root=resolve('_site'), out=resolve(process.env.QA_OUT || '.tmp/blog-stability'); mkdirSync(out,{recursive:true});
const server=createServer((request,response)=>{try {
  const pathname=new URL(request.url,'http://local').pathname, file=resolve(root,'.'+pathname);
  assert.ok(file.startsWith(root+'/') || file.startsWith(root+'\\'));
  response.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)] || 'application/octet-stream');
  response.end(readFileSync(file));
} catch {response.writeHead(404);response.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}), checks=[];
try {
  for(const width of [390,768,1440]) for(const theme of ['dark','light']) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(({theme})=>{
      localStorage.setItem('linkora-theme',theme);localStorage.setItem('linkora.analytics.consent','denied');sessionStorage.setItem('linkora.brandIntroSeen','1');
      window.stabilityCls=0;new PerformanceObserver(list=>list.getEntries().forEach(e=>{if(!e.hadRecentInput)window.stabilityCls+=e.value;})).observe({type:'layout-shift',buffered:true});
    },{theme});
    await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2',route=>route.fulfill({contentType:'application/javascript',body:
      'window.supabase={createClient:()=>({from:()=>({select(){return this},eq(){return this},order(){return this},range(){return new Promise(resolve=>window.releaseBlogLoad=()=>resolve({data:'+JSON.stringify(posts)+',error:null}))}})})};'}));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/blog.html');
    await page.waitForFunction(()=>typeof window.releaseBlogLoad==='function');
    await page.evaluate(()=>document.fonts.ready);
    const geometry=()=>page.locator('#blog-grid .blog-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {top:r.top,height:r.height};}));
    const before=await geometry();assert.equal(before.length,posts.length,'Published cards remain visible while the API is pending');
    assert.equal(await page.locator('#blog-grid .blog-card__image').count(),posts.length,'Initial image space is reserved');
    for(const post of posts) assert.equal(await page.getByRole('link',{name:'Read '+post.title,exact:true}).count(),1,'Image link has an accessible name');
    await page.evaluate(()=>window.releaseBlogLoad());
    await page.locator('#blog-status').filter({hasText:posts.length+' article'+(posts.length===1?'':'s')+' published'}).waitFor();
    await page.waitForTimeout(300);
    const after=await geometry();assert.equal(after.length,before.length);
    for(const post of posts) assert.equal(await page.getByRole('link',{name:'Read '+post.title,exact:true}).count(),1,'Hydrated image link retains its accessible name');
    for(let i=0;i<before.length;i++) for(const field of ['top','height']) assert.ok(Math.abs(before[i][field]-after[i][field])<2,'Stable card '+i+' '+field+' at '+width);
    const cls=await page.evaluate(()=>window.stabilityCls);assert.ok(cls<=0.1,'Measured CLS at '+width+': '+cls);assert.deepEqual(errors,[]);
    checks.push({width,theme,cls,cards:after.length,productionWrites:0});await context.close();
  }
  writeFileSync(resolve(out,'blog-stability.json'),JSON.stringify({observedAt:new Date().toISOString(),checks},null,2));
  console.log('Blog initial-to-live layout passed: '+checks.length+' viewport/theme combinations.');
} finally {await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
