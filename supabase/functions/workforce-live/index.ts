import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { createWorkforceHandler } from "./handler.ts";
const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Custom authentication is mandatory: validated Auth JWTs, tab-close capability,
// or the narrowly scoped database worker token. There is no unauthenticated action.
Deno.serve(createWorkforceHandler(service));
