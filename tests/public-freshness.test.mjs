import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePublicSnapshot } from '../scripts/audit-public-freshness.mjs';
import { readPublicContent, publicSnapshotDigest } from '../scripts/build-public-site.mjs';

test('A matching Git SHA cannot conceal an unpublished static snapshot',()=>{
  const old=[{slug:'old-post',canonical_url:null}],current=[...old,{slug:'new-post',canonical_url:null}];
  const receipt={commit:'same-code',publishedPosts:1,openJobs:0,digest:publicSnapshotDigest('same-code',old,[])};
  const issues=comparePublicSnapshot(receipt,{blog:['old-post'],jobs:[]},current,[]);
  assert.ok(issues.some(s=>s.includes('Missing published blog route: new-post')));
  assert.ok(issues.some(s=>s.includes('fingerprint')));
});
test('Published metadata edits and withdrawn articles are detected even when code is unchanged',()=>{
  const old=[{slug:'post',canonical_url:'https://example.test/original'}];
  const receipt={commit:'same-code',publishedPosts:1,openJobs:0,digest:publicSnapshotDigest('same-code',old,[])};
  assert.ok(comparePublicSnapshot(receipt,{blog:['post'],jobs:[]},[{slug:'post',canonical_url:null}],[]).some(s=>s.includes('fingerprint')));
  assert.ok(comparePublicSnapshot(receipt,{blog:['post'],jobs:[]},[],[]).some(s=>s.includes('Stale blog route')));
  assert.deepEqual(comparePublicSnapshot(receipt,{blog:['post'],jobs:[]},old,[]),[]);
});
test('Snapshot reads retain published/open API filters and never use a signed-in session',async()=>{
  const original=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,options)=>{requests.push({url:new URL(url),headers:options.headers});return {ok:true,json:async()=>[]};};
  try {
    const result=await readPublicContent();assert.deepEqual(result,{posts:[],open:[]});
    assert.equal(requests.length,2);
    assert.equal(requests.find(r=>r.url.pathname.endsWith('blog_posts')).url.searchParams.get('status'),'eq.published');
    assert.equal(requests.find(r=>r.url.pathname.endsWith('career_jobs')).url.searchParams.get('status'),'eq.open');
    for(const request of requests){assert.ok(request.headers.apikey.startsWith('sb_publishable_'));assert.equal(request.headers.Authorization,undefined);}
  } finally { globalThis.fetch=original; }
});
