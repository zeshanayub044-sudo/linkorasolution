import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = { "Access-Control-Allow-Origin": "https://linkorasolution.com", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Server is missing ${name}`); return value; };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

async function notifyAppsScript(payload: Record<string, string>) {
  const response = await fetch(required("GOOGLE_APPS_SCRIPT_URL"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: required("GOOGLE_SHEETS_WEBHOOK_SECRET"), ...payload }) });
  const responseText = await response.text();
  if (!response.ok) { console.error("Apps Script activity webhook failed", response.status, responseText); throw new Error("The attendance sheet did not accept this activity"); }
  try { const result = JSON.parse(responseText); if (result.success === false || result.ok === false) { console.error("Apps Script activity webhook rejected request", result); throw new Error("The attendance sheet rejected this activity"); } } catch (error) { if (error instanceof SyntaxError) return; throw error; }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const service = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"));
    const token = authorization.slice(7);
    const { data: auth, error: authError } = await service.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Unauthorized" }, 401);
    const { action, sessionId } = await request.json();
    if (!['start-session', 'end-session', 'get-activity-report'].includes(action)) return json({ error: "Invalid request" }, 400);
    if (action === 'start-session' && !/^[0-9a-f-]{36}$/i.test(sessionId || '')) return json({ error: "Invalid request" }, 400);
    if (action === 'end-session' && sessionId && !/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ error: "Invalid request" }, 400);
    const { data: employee, error: employeeError } = await service.from("employee_profiles").select("id, employee_id, full_name, scheme, role, is_active").eq("id", auth.user.id).single();
    if (employeeError || !employee || (!employee.is_active && action !== 'end-session')) return json({ error: "Employee account is not active" }, 403);
    if (action === 'get-activity-report') {
      if (employee.role.trim().toLowerCase() !== 'co-ceo') return json({ error: "Only Co-CEO accounts can view the activity report" }, 403);
      const { data: sessions, error: reportError } = await service.from("employee_activity_sessions").select("login_at, logout_at, status, employee_profiles(full_name, employee_id)").order("login_at", { ascending: false }).limit(200);
      if (reportError) throw new Error("Could not load activity report");
      return json({ sessions: sessions || [] });
    }
    if (action === "start-session") {
      const loginAt = new Date().toISOString();
      const { error } = await service.from("employee_activity_sessions").insert({ session_id: sessionId, employee_id: employee.id, login_at: loginAt, status: "Logged In" });
      if (error) throw new Error("Could not save activity session");
      try { await notifyAppsScript({ action: "login", sessionId, email: auth.user.email || "", employeeName: employee.full_name, employeeId: employee.employee_id, scheme: employee.scheme, role: employee.role }); } catch (webhookError) { await service.from("employee_activity_sessions").delete().eq("session_id", sessionId); throw webhookError; }
      return json({ ok: true, sessionId });
    }
    let activityQuery = service.from("employee_activity_sessions").select("session_id, status").eq("employee_id", employee.id).eq("status", "Logged In");
    if (sessionId) activityQuery = activityQuery.eq("session_id", sessionId);
    else activityQuery = activityQuery.order("login_at", { ascending: false }).limit(1);
    const { data: activity, error: activityError } = await activityQuery.maybeSingle();
    if (activityError) throw new Error("Could not load activity session");
    if (!activity) {
      // An admin may have already closed this exact session. Let the employee
      // finish signing out without altering the preserved attendance record.
      if (sessionId) {
        const { data: closed } = await service.from("employee_activity_sessions")
          .select("session_id").eq("employee_id", employee.id).eq("session_id", sessionId)
          .eq("status", "Logged Out").maybeSingle();
        if (closed) return json({ ok: true, alreadyClosed: true });
      }
      if (!sessionId) return json({ ok: true, alreadyClosed: true });
      return json({ error: "Active session not found" }, 404);
    }
    const logoutAt = new Date().toISOString();
    await notifyAppsScript({ action: "logout", sessionId: activity.session_id });
    const { error } = await service.from("employee_activity_sessions").update({ logout_at: logoutAt, status: "Logged Out", logout_source: "user" }).eq("session_id", activity.session_id).eq("employee_id", employee.id).eq("status", "Logged In");
    if (error) throw new Error("Could not close activity session");
    return json({ ok: true });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error && error.message.startsWith("The attendance sheet") ? error.message : "Activity could not be recorded";
    return json({ error: message }, 500);
  }
});
