// Publication quality checks use a fixture Auth/API client and never write production posts.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/ME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const root=resolve('_site'), out=process.env.QA_OUT || resolve('.tmp/blog-publication');
mkdirSync(out,{recursive:true});
const server=createServer((request,response)=>{
  try {
    const file=resolve(root,'.'+new URL(request.url,'http://local').pathname);
    assert.ok(file.startsWith(root+'/') || file.startsWith(root+'\\'));
    response.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.writeHead(404);response.end(); }
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
function installFixture() {
  const post={id:'fixture-post',title:'Fixture article',slug:'future-article',category:'SEO',excerpt:'A useful fixture excerpt.',content:'## Useful section\n\nFixture content.',status:'draft',canonical_url:'https://linkorasolution.com/missing-original/',blog_authors:{display_name:'Fixture author'}};
  window.publicationFixture={posts:[post],saves:[],uploads:0};
  window.supabase={createClient:()=>({
    auth:{getUser:async()=>({data:{user:{id:'fixture-admin',email:'fixture@example.invalid'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    rpc:async()=>({data:'blog_admin'}),
    from:()=>({
      select:()=>({order:()=>({range:async()=>({data:[post]})})}),
      update:payload=>({eq:()=>({select:()=>({single:async()=>{window.publicationFixture.saves.push(payload);Object.assign(post,payload);return {data:{id:post.id}};}})})})
    }),
    storage:{from:()=>({upload:async()=>{window.publicationFixture.uploads++;return {data:{}};},getPublicUrl:()=>({data:{publicUrl:'fixture-image'}})})}
  })};
}
const checks=[];
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@**',route=>route.fulfill({contentType:'application/javascript',body:'('+installFixture.toString()+')();'}));
  const probes=[];
  await context.route('https://linkorasolution.com/**',route=>{
    const path=new URL(route.request().url()).pathname;probes.push(path);
    if(path==='/network-error/')return route.abort();
    if(path==='/missing-original/')return route.fulfill({status:404,contentType:'text/html',body:'Not found'});
    const privatePage=path==='/private.html',preferred=path==='/canonical-alternative.html'?'https://linkorasolution.com/':'https://linkorasolution.com'+path;
    return route.fulfill({contentType:'text/html',body:'<!doctype html><head><title>Fixture original</title>'+(privatePage?'<meta name="Robots" content="NOINDEX,follow">':'')+'<link rel="canonical" href="'+preferred+'"></head><body>Public fixture original</body>'});
  });
  const page=await context.newPage();
  const notice=page.locator('#blog-admin-notice');
  async function load() { await page.goto(base+'/blog-admin.html',{waitUntil:'domcontentloaded'});await notice.filter({hasText:'Blog Editor ready.'}).waitFor(); }
  async function edit(canonical,status='published') {
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await page.locator('[name=canonical_url]').fill(canonical);
    await page.locator('[name=status]').selectOption(status);
  }
  async function noWrite() {
    assert.deepEqual(await page.evaluate(()=>({saves:publicationFixture.saves.length,uploads:publicationFixture.uploads})),{saves:0,uploads:0});
    assert.equal(await page.locator('#blog-save').isEnabled(),true);
  }
  await load();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Publish',exact:true}).click();
  await notice.filter({hasText:'HTTP 404'}).waitFor();await noWrite();
  checks.push('List Publish rejects an unavailable same-site canonical before any database write.');
  await edit('https://linkorasolution.com/private.html');
  await page.getByRole('button',{name:'Save article',exact:true}).click();
  await notice.filter({hasText:'not indexable'}).waitFor();await noWrite();
  checks.push('Save as published rejects a noindex canonical, including mixed-case robots markup.');
  for(const value of ['http://example.test/article','https://person:credential@example.test/article','https://example.test/article#fragment']) {
    await page.locator('[name=canonical_url]').fill(value);
    await page.getByRole('button',{name:'Save article',exact:true}).click();
    await notice.filter({hasText:'Use an HTTPS canonical'}).waitFor();await noWrite();
  }
  checks.push('HTTP, credential-bearing and fragment canonicals are rejected.');
  for(const [path,message] of [['/canonical-alternative.html','preferred canonical URL'],['/network-error/','could not be verified']]) {
    await page.locator('[name=canonical_url]').fill('https://linkorasolution.com'+path);
    await page.getByRole('button',{name:'Save article',exact:true}).click();
    await notice.filter({hasText:message}).waitFor();await noWrite();
  }
  checks.push('Canonical alternatives and unavailable verification are explained without publishing or leaving Save disabled.');
  const beforeFuture=probes.length;
  await page.locator('[name=canonical_url]').fill('https://linkorasolution.com/blog/future-article.html');
  await page.getByRole('button',{name:'Save article',exact:true}).click();
  await notice.filter({hasText:'Article saved successfully.'}).waitFor();
  assert.equal(await page.evaluate(()=>publicationFixture.saves.length),1);
  assert.equal(probes.length,beforeFuture,'A future article URL is allowed before the static build exists');
  checks.push('The generated URL of a new article can publish without an erroneous pre-deployment 404 check.');
  for(const canonical of ['', 'https://original.example.test/article', 'https://linkorasolution.com/public-original.html']) {
    await load();await edit(canonical);
    await page.getByRole('button',{name:'Save article',exact:true}).click();
    await notice.filter({hasText:'Article saved successfully.'}).waitFor();
    assert.equal(await page.evaluate(()=>publicationFixture.saves.length),1);
  }
  checks.push('Default canonical, external original and an existing self-canonical public original remain supported.');
  await load();await edit('https://linkorasolution.com/missing-original/','draft');
  const beforeDraft=probes.length;
  await page.getByRole('button',{name:'Save article',exact:true}).click();
  await notice.filter({hasText:'Article saved successfully.'}).waitFor();
  assert.equal(await page.evaluate(()=>publicationFixture.saves[0].status),'draft');
  assert.equal(probes.length,beforeDraft);
  checks.push('Draft saving remains available while an original URL is unfinished.');
  await context.close();
  writeFileSync(resolve(out,'blog-publication-ui.json'),JSON.stringify({observedAt:new Date().toISOString(),checks,productionWrites:0},null,2));
  console.log('Blog publication checks passed: '+checks.length+' validation/workflow groups.');
} finally { await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done)); }
