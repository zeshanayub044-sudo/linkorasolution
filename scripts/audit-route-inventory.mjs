// Read-only production inventory, including deliberate exclusions and known GSC aliases.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { audit, inspectHtml, origin, privatePages } from './audit-public-seo.mjs';

const report = await audit({ live:true });
const sitemap = new Set(report.pages.map(page => page.url));
const rows = report.pages.map(page => ({ ...page, classification:'PUBLIC INDEXABLE', sitemap:true }));
for (const excluded of report.exclusions) {
  const url = origin + '/' + excluded.file;
  const response = await fetch(url, { signal:AbortSignal.timeout(30000) });
  rows.push({ ...inspectHtml(await response.text(), url, response.status),
    classification:privatePages.includes(excluded.file) ? 'AUTHENTICATED / PRIVATE' : 'PUBLIC NON-INDEXABLE', sitemap:false });
}
const aliases = ['http://linkorasolution.com/', origin + '/index.html', 'http://linkorasolution.com/index.html',
  'http://www.linkorasolution.com/', 'https://www.linkorasolution.com/',
  origin + '/cdn-cgi/l/email-protection', origin + '/what-is-guest-post/'];
for (const url of aliases) {
  let current = url;
  const chain = [];
  for (let hop = 0; hop < 6; hop++) {
    const response = await fetch(current, { redirect:'manual', signal:AbortSignal.timeout(30000) });
    const location = response.headers.get('location');
    chain.push({ url:current, status:response.status, location });
    if (response.status >= 300 && response.status < 400 && location) { current = new URL(location,current).href; continue; }
    rows.push({ ...inspectHtml(await response.text(),url,response.status), chain, finalUrl:current,
      classification:chain.length > 1 ? 'REDIRECT' : response.status >= 400 ? 'BROKEN / REMOVED' : 'PUBLIC NON-INDEXABLE', sitemap:sitemap.has(url) });
    break;
  }
  if (chain.length===6 && chain[5].location) report.errors.push(url+': redirect limit exceeded');
}
const result = { observedAt:new Date().toISOString(), rows, errors:report.errors, robots:report.robots,
  note:'Initial HTML inventory; rendered navigation, browser errors and layout are covered by website-smoke.mjs. HTTP-200 private documents are application shells protected by backend authorization.' };
const index = process.argv.indexOf('--output');
if (index >= 0) { const file=resolve(process.argv[index+1]); mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,JSON.stringify(result,null,2)+'\n'); }
console.log(JSON.stringify({ routes:rows.length, classifications:rows.reduce((counts,row)=>(counts[row.classification]=(counts[row.classification]||0)+1,counts),{}), errors:report.errors },null,2));
if (report.errors.length) process.exitCode=1;
