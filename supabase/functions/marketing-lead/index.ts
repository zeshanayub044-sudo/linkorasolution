import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import { createLeadHandler } from './handler.ts';
const service = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createLeadHandler(service,{
  publicKey:'sb_publishable_5qYFSQZctSIVupj5_nGg3g_v_E5fVNA',
  // Existing server-only secret salts short-lived IP hashes; it never leaves this function.
  hashSalt:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  crmUrl:Deno.env.get('MARKETING_CRM_URL'),crmToken:Deno.env.get('MARKETING_CRM_TOKEN')
}));
