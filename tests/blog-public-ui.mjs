// Real public production API/rendering acceptance; no Auth/session credentials.
import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';import {mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_EXECUTABLE});
const slugs=['evaluate-backlink-quality-before-outreach','on-page-seo-checklist-business-websites','google-business-profile-optimization-checklist'];
try{for(const width of [1366,390]){const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://linkorasolution.com/blog.html');await page.locator('.blog-card').first().waitFor();assert.ok(await page.locator('.blog-card').count()>=3);
 for(const slug of slugs){await page.goto('https://linkorasolution.com/blog-post.html?slug='+slug);await page.locator('#blog-article h1').waitFor();assert.equal(await page.locator('meta[name=robots]').getAttribute('content'),'index,follow');assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://linkorasolution.com/blog-post.html?slug='+slug);assert.ok(await page.locator('.blog-article__content a').count()>=3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 const json=await page.locator('script[type="application/ld+json"]').allTextContents();assert.ok(json.map(JSON.parse).some(x=>x['@type']==='Article'&&x.publisher.name==='LINKORA SOLUTION'));
 assert.equal(await page.locator('#blog-article').innerText().then(t=>t.includes('LINKORA SOLUTIONS')),false);
 if(slug===slugs[0]){await page.locator('.blog-article__image').waitFor();assert.equal(await page.locator('.blog-article__image').evaluate(i=>i.complete&&i.naturalWidth>0),true);}
 }
 if(process.env.QA_OUT&&width===1366){mkdirSync(process.env.QA_OUT,{recursive:true});await page.screenshot({path:resolve(process.env.QA_OUT,'published-blog-desktop.png'),fullPage:false});}
 await page.goto('https://linkorasolution.com/blog-post.html?slug=unpublished-acceptance-missing');await page.locator('#blog-article-status').filter({hasText:'unavailable'}).waitFor();assert.equal(await page.locator('meta[name=robots]').getAttribute('content'),'noindex,follow');assert.deepEqual(errors,[]);await context.close();}
 console.log('Three real published articles: public list/rendering/image/metadata/schema/internal links and missing-post noindex passed at desktop/mobile widths.');
}finally{await browser.close()}
