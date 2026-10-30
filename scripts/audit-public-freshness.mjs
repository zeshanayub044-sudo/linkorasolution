import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicContent, publicSnapshotDigest, canonicalUrl, origin } from './build-public-site.mjs';
import { inspectHtml } from './audit-public-seo.mjs';

export function comparePublicSnapshot(receipt, routes, posts, open) {
  const issues=[];
  if(receipt.publishedPosts!==posts.length)issues.push('Published article count differs: deployed '+receipt.publishedPosts+', API '+posts.length+'.');
  if(receipt.openJobs!==open.length)issues.push('Open job count differs: deployed '+receipt.openJobs+', API '+open.length+'.');
  for(const [kind,expected] of [['blog',posts.map(p=>p.slug)],['jobs',open.map(j=>j.slug)]]) {
    const actual=routes[kind];
    if(!Array.isArray(actual)) { issues.push('Invalid '+kind+' route manifest.');continue; }
    for(const slug of expected)if(!actual.includes(slug))issues.push('Missing published '+kind+' route: '+slug);
    for(const slug of actual)if(!expected.includes(slug))issues.push('Stale '+kind+' route still deployed: '+slug);
  }
  if(!receipt.commit || receipt.digest!==publicSnapshotDigest(receipt.commit,posts,open))issues.push('Published content fingerprint differs from the deployed snapshot.');
  return issues;
}

async function main() {
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
  const base=(arg('--base')||origin).replace(/\/$/,'');
  const get=async path=>{
    const url=new URL(path,base+'/');url.searchParams.set('health-check',Date.now());
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(path+' returned HTTP '+response.status);
    return response;
  };
  const [{posts,open},receipt,manifest]=await Promise.all([
    readPublicContent(),get('/public-build.json').then(r=>r.json()),get('/public-routes.js').then(r=>r.text())
  ]);
  const match=manifest.match(/Object\.freeze\((.*)\)/);
  if(!match)throw Error('Invalid public route manifest.');
  const routes=JSON.parse(match[1]),issues=comparePublicSnapshot(receipt,routes,posts,open),pages=[];
  for(const [kind,rows] of [['blog',posts],['jobs',open]])for(const row of rows) {
    const path='/'+kind+'/'+row.slug+'.html',response=await fetch(base+path,{signal:AbortSignal.timeout(30000)}),html=await response.text();
    const canonical=inspectHtml(html,origin+path,response.status).canonicals[0];
    const expected=canonicalUrl(row.canonical_url,origin+path);
    pages.push({path,status:response.status,canonical});
    if(response.status!==200)issues.push(path+' returned HTTP '+response.status);
    if(canonical!==expected)issues.push(path+' canonical differs from current published content.');
  }
  const report={observedAt:new Date().toISOString(),base,deployed:receipt,expected:{publishedPosts:posts.length,openJobs:open.length},pages,issues};
  const output=arg('--output');if(output){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));}
  console.log(JSON.stringify({publishedPosts:posts.length,openJobs:open.length,issues},null,2));
  if(issues.length)process.exitCode=1;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
