import { flushSheetQueue, flushMatrixQueue, type Service } from '../_shared/attendance-sync.ts';
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const allowedOrigin = (v: string | null) => ['https://linkorasolution.com','https://www.linkorasolution.com'].includes(v || '') || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(v || '');
const actions = new Set(['config','settings','begin','activate','pulse','reserve','commit','issue','interrupt','finalize','list','detail','playback','delete','statuses']);
declare const EdgeRuntime: {waitUntil(task: Promise<unknown>): void} | undefined;

export async function cleanup(service: Service) {
  const sweep = await service.rpc('portal_recording_maintenance',{p_action:'sweep'});
  if (sweep.error) throw new Error('Recording reconciliation failed');
  const candidates = await service.rpc('portal_recording_maintenance',{p_action:'candidates'});
  if (candidates.error) throw new Error('Recording cleanup unavailable');
  let deleted = 0, removed = 0, deferred = 0;
  const deadline = Date.now() + 45000;
  for (const row of candidates.data.rows) {
    // Only server-derived paths. Storage API removes the physical object, not just its DB row.
    for (let i=0; i<row.paths.length; i+=100) {
      if (removed >= 1000 || Date.now() >= deadline) { deferred++; return {deleted,deferred}; }
      const batch = row.paths.slice(i,i+Math.min(100,1000-removed));
      const result = await service.storage.from('employee-screen-recordings').remove(batch);
      removed += batch.length;
      if (result.error) throw new Error('Recording deletion deferred');
    }
    const done = await service.rpc('portal_recording_maintenance',{p_action:'deleted',p_payload:{recordingId:row.id}});
    if (done.error) throw new Error('Recording deletion unverified');
    deleted++;
  }
  return {deleted,deferred};
}
export function createRecordingHandler(service: Service) {
 return async(request: Request) => {
  const origin=request.headers.get('Origin');
  const headers={'Access-Control-Allow-Origin':allowedOrigin(origin)?origin!:'https://linkorasolution.com',
   'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',
   'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  const reply=(body: unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!allowedOrigin(origin))return reply({error:'Origin denied'},403);
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  try {
   const text=await request.text();if(text.length>16000)return reply({error:'Request too large'},413);
   let body;try{body=JSON.parse(text)}catch{return reply({error:'Invalid request'},400)}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Invalid request'},400);
   const bearer=request.headers.get('Authorization');if(!bearer?.startsWith('Bearer '))return reply({error:'Unauthorized'},401);
   const token=bearer.slice(7);
   if(body.action==='maintenance'){
    const auth=await service.rpc('portal_maintenance_authorize',{p_token:token});
    if(auth.error||!auth.data)return reply({error:'Unauthorized'},401);
    const task=cleanup(service);
    if(typeof EdgeRuntime!=='undefined'){EdgeRuntime.waitUntil(task.catch(()=>{console.error('Recording cleanup deferred; retry scheduled')}));return reply({queued:true},202)}
    return reply(await task);
   }
   if(!actions.has(body.action))return reply({error:'Invalid action'},400);
   const auth=await service.auth.getUser(token);if(auth.error||!auth.data.user)return reply({error:'Unauthorized'},401);
   let session;try{session=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id}catch{ /* rejected below */ }
   if(!uuid(session))return reply({error:'Active Auth session required'},401);
   const payload={...body};delete payload.action;
   let closeToken;
   if(body.action==='begin'){
    closeToken=crypto.randomUUID()+crypto.randomUUID();
    payload.closeTokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(closeToken)))).map(x=>x.toString(16).padStart(2,'0')).join('');
   }
   const result=await service.rpc('portal_recording_action',{p_user_id:auth.data.user.id,p_auth_session:session,p_action:body.action,p_payload:payload});
   if(result.error){
    const code=result.error.code;
    return reply({error:code==='42501'?'Access denied. Active portal authorization is required.':code==='23505'?'Another portal tab owns this recording. Stop it before resuming here.':code==='54000'?'Recording upload connection issue or storage budget reached.':['22023','22P02','22003','23514','P0002'].includes(code)?'Invalid, unavailable or changed recording. Please refresh and retry.':'Recording service unavailable.'},code==='42501'?403:code==='23505'?409:code==='54000'?429:['22023','22P02','22003','23514','P0002'].includes(code)?400:500);
   }
   if(body.action==='playback'){
    // Authorization is fresh for every segment; signed credentials never enter logs or the database.
    const signed=await service.storage.from('employee-screen-recordings').createSignedUrl(result.data.path,result.data.ttl);
    if(signed.error)return reply({error:'Playback unavailable'},503);
    return reply({url:signed.data.signedUrl,expiresIn:result.data.ttl});
   }
   if(body.action==='begin'&&typeof EdgeRuntime!=='undefined')EdgeRuntime.waitUntil(Promise.all([flushSheetQueue(service,5),flushMatrixQueue(service,5)]).catch(()=>{}));
   if(body.action==='delete'&&typeof EdgeRuntime!=='undefined')EdgeRuntime.waitUntil(cleanup(service).catch(()=>{console.error('Recording deletion deferred; retry scheduled')}));
   return reply({...result.data,...(closeToken?{presence:{...result.data.presence,closeToken}}:{})});
  }catch{return reply({error:'Recording service unavailable'},500)}
 };
}
