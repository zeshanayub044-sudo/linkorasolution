import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const allowedOrigin = (origin: string | null) =>
  origin === "https://linkorasolution.com" ||
  origin === "https://www.linkorasolution.com" ||
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
const headers = (request: Request) => ({
  "Access-Control-Allow-Origin": allowedOrigin(request.headers.get("Origin"))
    ? request.headers.get("Origin")! : "https://linkorasolution.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Vary": "Origin",
});
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server is missing ${name}`);
  return value;
};
const validUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

class SheetError extends Error {}

async function notifySheet(payload: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(required("GOOGLE_APPS_SCRIPT_URL"), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ secret: required("GOOGLE_SHEETS_WEBHOOK_SECRET"), ...payload }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) { throw new SheetError("Google Sheets is unavailable."); }
  let result: Record<string, unknown>;
  try {
    result = await response.json();
  } catch (_) { throw new SheetError("Google Sheets returned an invalid response."); }
  if (!response.ok || result.ok !== true)
    throw new SheetError("Google Sheets rejected the attendance request.");
  return result;
}

type Service = ReturnType<typeof createClient>;
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;

async function flushSheetQueue(service: Service, limit = 5) {
  const { data: pending, error } = await service.from("attendance_sheet_sync_queue")
    .select("id, session_id, action, attempts")
    .is("synced_at", null)
    .lte("next_attempt_at", new Date().toISOString())
    .order("id")
    .limit(limit);
  if (error) throw error;
  let failed = 0;
  for (const item of pending || []) {
    try {
      const { data: session, error: sessionError } = await service
        .from("employee_activity_sessions")
        .select("session_id, employee_id, login_at")
        .eq("session_id", item.session_id).single();
      if (sessionError || !session)
        throw new Error(sessionError?.message || "Attendance session is unavailable");
      const { data: account, error: accountError } =
        await service.auth.admin.getUserById(session.employee_id);
      if (accountError || !account.user) throw new Error("Employee account is unavailable");
      const { data: profile, error: profileError } = await service.from("employee_profiles")
        .select("full_name, employee_id, scheme, role").eq("id", session.employee_id).single();
      if (profileError || !profile) throw new Error("Employee profile is unavailable");
      await notifySheet({
        action: item.action, sessionId: item.session_id, loginAt: session.login_at,
        email: account.user.email || "", employeeName: profile.full_name,
        employeeId: profile.employee_id, scheme: profile.scheme, role: profile.role,
      });
      const { error: updateError } = await service.from("attendance_sheet_sync_queue")
        .update({ synced_at: new Date().toISOString(), attempts: item.attempts + 1, last_error: null })
        .eq("id", item.id);
      if (updateError) throw updateError;
    } catch (cause) {
      failed++;
      console.error("Attendance sheet sync failed", item.id, cause);
      const retryMinutes = Math.min(60, 2 ** Math.min(item.attempts, 6));
      await service.from("attendance_sheet_sync_queue").update({
        attempts: item.attempts + 1,
        next_attempt_at: new Date(Date.now() + retryMinutes * 60000).toISOString(),
        last_error: cause instanceof Error ? cause.message.slice(0, 240) : "Sync failed",
      }).eq("id", item.id);
    }
  }
  return { attempted: (pending || []).length, failed };
}

function scheduleSheetFlush(service: Service) {
  // The queue is a retry safety net after the synchronous Sheet write.
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(flushSheetQueue(service).catch((error) => {
      console.error("Background attendance sheet sync failed", error);
    }));
  }
}

Deno.serve(async (request) => {
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: headers(request) });
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  try {
    const bearer = request.headers.get("Authorization");
    if (!bearer?.startsWith("Bearer ")) return response({ error: "Unauthorized" }, 401);
    const service = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await service.auth.getUser(bearer.slice(7));
    if (authError || !auth.user) return response({ error: "Unauthorized" }, 401);
    const body = await request.json();
    const action = body?.action;
    if (!["start-session", "end-session", "get-activity-report", "sheet-sync"].includes(action))
      return response({ error: "Invalid request" }, 400);
    const { data: employee, error: profileError } = await service.from("employee_profiles")
      .select("id, employee_id, full_name, scheme, role, is_active")
      .eq("id", auth.user.id).maybeSingle();
    if (profileError || !employee || (!employee.is_active && action !== "end-session"))
      return response({ error: "Employee account is not active" }, 403);

    if (action === "get-activity-report" || action === "sheet-sync") {
      if (!employee.is_active || employee.role !== "Co-CEO")
        return response({ error: "Co-CEO authorization required" }, 403);
      if (action === "sheet-sync") {
        const limit = Math.min(20, Math.max(1, Number(body.limit) || 20));
        const outcome = await flushSheetQueue(service, limit);
        const { count } = await service.from("attendance_sheet_sync_queue")
          .select("id", { count: "exact", head: true }).is("synced_at", null);
        return response({ ok: true, pending: count || 0, ...outcome });
      }
      const report = await notifySheet({
        action: "report",
        limit: String(Math.min(500, Math.max(1, Number(body.limit) || 200))),
        offset: String(Math.max(0, Number(body.offset) || 0)),
        from: typeof body.from === "string" ? body.from : "",
        to: typeof body.to === "string" ? body.to : "",
        employeeId: typeof body.employeeId === "string" ? body.employeeId : "",
      });
      if (!Array.isArray(report.sessions) || !Number.isFinite(Number(report.total)))
        throw new SheetError("Google Sheets returned an invalid report.");
      return response({ source: "google_sheet", total: report.total,
        sessions: report.sessions.map((row: Record<string, unknown>) => ({
          ...row, login_at: row.loginAt || null, logout_at: row.logoutAt || null,
          status: row.status || "Unknown",
          employee_profiles: { full_name: row.employeeName || "",
            employee_id: row.employeeId || "", role: row.role || "", scheme: row.scheme || "" },
        })) });
    }

    if (action === "start-session") {
      if (!validUuid(body.sessionId)) return response({ error: "Invalid session ID" }, 400);
      const { data, error } = await service.rpc("portal_employee_start_session", {
        p_user_id: employee.id, p_session_id: body.sessionId,
      });
      if (error) throw error;
      await notifySheet({
        action: "login", sessionId: data.sessionId,
        email: auth.user.email || "", employeeName: employee.full_name,
        employeeId: employee.employee_id, scheme: employee.scheme, role: employee.role,
      });
      scheduleSheetFlush(service);
      return response({ ok: true, sessionId: data.sessionId, alreadyOpen: data.alreadyOpen,
        warning: null });
    }

    if (body.sessionId != null && !validUuid(body.sessionId))
      return response({ error: "Invalid session ID" }, 400);
    const { data, error } = await service.rpc("portal_employee_end_session", {
      p_user_id: employee.id, p_session_id: body.sessionId || null,
    });
    if (error) throw error;
    if (!data.flaggedForReview) {
      const { data: session, error: sessionError } = await service
        .from("employee_activity_sessions").select("login_at")
        .eq("session_id", data.sessionId).single();
      if (sessionError || !session) throw sessionError || new Error("Attendance session unavailable");
      await notifySheet({
        action: "logout", sessionId: data.sessionId, loginAt: session.login_at,
        email: auth.user.email || "", employeeName: employee.full_name,
        employeeId: employee.employee_id, scheme: employee.scheme, role: employee.role,
      });
    }
    scheduleSheetFlush(service);
    return response({ ok: true, sessionId: data.sessionId, alreadyClosed: data.alreadyClosed,
      warning: data.flaggedForReview
        ? "You signed out. An older attendance session needs Co-CEO review; no historical sign-out time was invented."
        : null });
  } catch (error) {
    console.error("Attendance service failed", error);
    if (error instanceof SheetError)
      return response({ error: "Unable to load or save attendance in Google Sheets. Please check the backend connection." }, 502);
    return response({ error: "Attendance could not be recorded. Please try again." }, 500);
  }
});
