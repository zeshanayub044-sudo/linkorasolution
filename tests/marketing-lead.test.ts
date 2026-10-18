import {createLeadHandler,validateLead} from '../supabase/functions/marketing-lead/handler.ts';
const assert=(ok:unknown,message='Assertion failed')=>{if(!ok)throw new Error(message)};
const payload=()=>({requestId:crypto.randomUUID(),name:'QA inquiry',email:'qa@example.invalid',service:'Backlinks',message:'Temporary test inquiry',source_page:'/contact.html',utm:{utm_source:'qa'}});
const request=(body:any,origin='https://linkorasolution.com',key='public-test')=>new Request('https://example.invalid',{method:'POST',headers:{origin,apikey:key,'Content-Type':'application/json','cf-connecting-ip':'192.0.2.1'},body:JSON.stringify(body)});
Deno.test('lead validation rejects invalid protocols, unapproved services and malformed payloads',()=>{
 for(const body of [{...payload(),website:'javascript:alert(1)'},{...payload(),website:'https://user:pass@example.com'},{...payload(),service:'invented'},{...payload(),email:'bad'},{...payload(),message:'x'.repeat(4001)},{...payload(),utm:{utm_source:['bad']}}]){let rejected=false;try{validateLead(body)}catch{rejected=true}assert(rejected)}
 assert(validateLead(payload()).email==='qa@example.invalid');
});
Deno.test('origin, method, public-key checks and honeypot never invoke the database',async()=>{
 let calls=0;const handler=createLeadHandler({rpc:async()=>{calls++;return{data:{},error:null}}},{publicKey:'public-test',hashSalt:'test-only-salt'});
 assert((await handler(request(payload(),'https://evil.invalid'))).status===403);
 assert((await handler(request(payload(),undefined,'bad'))).status===401);
 assert((await handler(request({...payload(),company_site:'bot'}))).status===200);assert(calls===0);
});
Deno.test('lead is saved before optional CRM; idempotent retries never resend; CRM failure remains tracked',async()=>{
 const calls:any[]=[];let duplicate=false;
 const service={rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:{id:'test-id',duplicate},error:null}}};
 let sends=0;const handler=createLeadHandler(service,{publicKey:'public-test',hashSalt:'test-only-salt',crmUrl:'https://crm.example.invalid',crmToken:'test-only-token'},async()=>{sends++;assert(calls[0].name==='marketing_submit_lead');return new Response('',{status:500})});
 assert((await handler(request(payload()))).status===200);assert(sends===1);assert(calls[1].args.p_delivered===false);
 assert(/^[a-f0-9]{64}$/.test(calls[0].args.p_rate_key));assert(!JSON.stringify(calls).includes('192.0.2.1'));
 duplicate=true;assert((await handler(request(payload()))).status===200);assert(sends===1);
});
Deno.test('rate limits, unavailable database and oversized requests produce truthful errors',async()=>{
 const handler=createLeadHandler({rpc:async()=>({data:null,error:{code:'54000'}})},{publicKey:'public-test',hashSalt:'test-only-salt'});
 assert((await handler(request(payload()))).status===429);assert((await handler(request({...payload(),message:'x'.repeat(15000)}))).status===413);
});
