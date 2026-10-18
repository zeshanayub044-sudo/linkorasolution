export interface LeadService {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
}
const services = new Set(['On-Page SEO','Off-Page SEO','Backlinks','Guest Posting','Blog Writing','DA Increase','Guest Post Sites Sheet','Technical SEO','Google Business Profile (GMB)','Web Development','12-Website Monthly SEO Plan — $1,000/month','Not sure yet']);
const fields: Record<string, number> = { name: 120, email: 254, phone: 40, company: 160, website: 500, service: 120, budget: 120, message: 4000, source_page: 120 };
export function validateLead(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request');
  const lead: Record<string, any> = {};
  for (const [field, limit] of Object.entries(fields)) {
    if (body[field] !== undefined && typeof body[field] !== 'string') throw new Error('Invalid field');
    const value = (body[field] || '').trim();
    if (value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('Invalid field');
    lead[field] = value;
  }
  if (!lead.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || !lead.message || !services.has(lead.service)) throw new Error('Please complete the required fields');
  lead.email = lead.email.toLowerCase();
  if (lead.website) { const url = new URL(lead.website); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid website'); }
  if (!/^\/(?:[a-z0-9-]+\.html)?$/.test(lead.source_page)) throw new Error('Invalid source page');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || '')) throw new Error('Invalid request ID');
  lead.request_id = body.requestId;
  lead.utm = {};
  for (const key of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content']) {
    const value = body.utm?.[key]; if (value !== undefined) { if (typeof value !== 'string' || value.length > 120) throw new Error('Invalid campaign'); lead.utm[key] = value; }
  }
  return lead;
}
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2,'0')).join('');
}
export function createLeadHandler(service: LeadService, options: { publicKey: string; hashSalt: string; crmUrl?: string; crmToken?: string }, send = fetch) {
  return async (request: Request) => {
    const origin = request.headers.get('origin') || '';
    const allowed = ['https://linkorasolution.com','https://www.linkorasolution.com'].includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    const headers = { 'Access-Control-Allow-Origin': allowed ? origin : 'https://linkorasolution.com', 'Access-Control-Allow-Headers':'content-type, apikey', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Cache-Control':'no-store', 'Content-Type':'application/json', 'Vary':'Origin' };
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!allowed) return reply({ error: 'Origin denied' },403);
    if (request.method === 'OPTIONS') return new Response('ok',{headers});
    if (request.method !== 'POST') return reply({error:'Method not allowed'},405);
    if (!options.publicKey || request.headers.get('apikey') !== options.publicKey) return reply({error:'Unauthorized'},401);
    if (!options.hashSalt) return reply({error:'Lead service unavailable'},503);
    try {
      if (Number(request.headers.get('content-length') || 0) > 14000) return reply({error:'Request too large'},413);
      // Read a bounded stream rather than buffering an unlimited request body.
      const reader = request.body?.getReader(); if (!reader) return reply({error:'Invalid request'},400);
      let size = 0, text = ''; const decoder = new TextDecoder();
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 14000) { await reader.cancel(); return reply({error:'Request too large'},413); } text += decoder.decode(part.value,{stream:true}); }
      text += decoder.decode(); let body; try { body = JSON.parse(text); } catch { return reply({error:'Invalid request'},400); }
      if (body?.company_site) return reply({accepted:true}); // Honeypot: do not create a lead.
      let lead; try { lead = validateLead(body); } catch { return reply({error:'Please check the required fields and website URL'},400); }
      // Trust the platform's client-IP header, never a browser-supplied x-forwarded-for value.
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const rateKey = await digest(options.hashSalt + ':' + ip + ':' + new Date().toISOString().slice(0,10));
      const saved = await service.rpc('marketing_submit_lead',{p_lead:lead,p_rate_key:rateKey});
      if (saved.error) return reply({error:saved.error.code === '54000' ? 'Too many requests' : 'Lead could not be saved'},saved.error.code === '54000' ? 429 : 503);
      // Saved first. CRM failures never lose the inquiry or fabricate a successful delivery.
      if (!saved.data.duplicate && options.crmUrl && options.crmToken) {
        let delivered = false;
        try {
          const url = new URL(options.crmUrl); if (url.protocol !== 'https:') throw new Error('HTTPS required');
          const response = await send(url, {method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+options.crmToken,'Idempotency-Key':saved.data.id},body:JSON.stringify({id:saved.data.id,...lead}),signal:AbortSignal.timeout(5000)});
          delivered = response.ok;
        } catch { /* Leave a retryable failure status. Never log tokens, lead contents or upstream bodies. */ }
        await service.rpc('marketing_crm_result',{p_id:saved.data.id,p_delivered:delivered});
      }
      return reply({accepted:true});
    } catch { return reply({error:'Lead service unavailable. Please retry or contact us directly.'},503); }
  };
}
