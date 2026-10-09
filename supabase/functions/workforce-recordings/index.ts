import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {createRecordingHandler} from './handler.ts';
const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// Custom verified Auth JWTs and a scoped server-only scheduled-worker capability.
Deno.serve(createRecordingHandler(service));
