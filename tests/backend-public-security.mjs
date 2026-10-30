// Production-safe denials only. No valid lead, application or attendance is submitted.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const config=readFileSync('blog-config.js','utf8'),base=config.match(/url:\s*'([^']+)'/)[1],key=config.match(/publishableKey:\s*'([^']+)'/)[1];
const checks=[];
async function request(path,options={}) {
  const response=await fetch(base+path,{...options,headers:{apikey:key,Origin:'https://linkorasolution.com',...options.headers},signal:AbortSignal.timeout(30000)});
  return {response,body:await response.json()};
}
for(const table of ['employee_profiles','career_applications','career_resume_submissions','marketing_leads']) {
  const {response}=await request('/rest/v1/'+table+'?select=id&limit=1');
  assert.ok([401,403].includes(response.status),'Anonymous read denied: '+table);
  checks.push({check:'Anonymous '+table+' read',status:response.status,passed:true});
}
const {response:drafts,body}=await request('/rest/v1/blog_posts?select=id&status=eq.draft');
assert.equal(drafts.status,200);assert.deepEqual(body,[]);checks.push({check:'Anonymous draft read filtered by RLS',status:200,visibleDrafts:0,passed:true});
for(const name of ['manage-employee','admin-users','workforce-live','workforce-recordings']) {
  const {response}=await request('/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.ok([401,403].includes(response.status),'Anonymous privileged Edge request denied: '+name);
  checks.push({check:'Anonymous '+name,status:response.status,passed:true});
}
for(const name of ['career-apply','marketing-lead']) {
  const {response}=await request('/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.ok([400,413,415,422].includes(response.status),'Empty public form rejected: '+name);
  checks.push({check:'Invalid empty '+name+' form',status:response.status,passed:true});
}
for(const bucket of ['career-resumes','employee-screen-recordings']) {
  const {response,body}=await request('/storage/v1/object/list/'+bucket,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix:'',limit:1})});
  assert.ok([400,401,403].includes(response.status) || (response.status===200 && Array.isArray(body) && body.length===0),'Private bucket returns no objects: '+bucket);
  checks.push({check:'Anonymous private bucket '+bucket,status:response.status,visibleObjects:0,passed:true});
}
const report={observedAt:new Date().toISOString(),checks,validBusinessSubmissions:0,productionDataChanges:0};
const index=process.argv.indexOf('--output');if(index>=0){const file=resolve(process.argv[index+1]);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(report,null,2));}
console.log('Public backend security passed: '+checks.length+' live denials/filter checks; no valid business data submitted.');
