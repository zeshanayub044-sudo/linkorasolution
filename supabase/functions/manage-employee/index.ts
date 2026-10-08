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
    .select("id, session_id, action, attempts, updated_at")
    .is("synced_at", null)
    .lte("next_attempt_at", new Date().toISOString())
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  let failed = 0;
  for (const item of pending || []) {
    try {
      const capabilities = await notifySheet({ action: "capabilities" });
      if (capabilities.contractVersion !== 5)
        throw new SheetError("The attendance Sheet script must be updated before raw reconciliation.");
      const { data: session, error: sessionError } = await service
        .from("employee_activity_sessions")
        .select("session_id, employee_id, login_at, logout_at, status")
        .eq("session_id", item.session_id).single();
      if (sessionError || !session)
        throw new Error(sessionError?.message || "Attendance session is unavailable");
      const { data: account, error: accountError } =
        await service.auth.admin.getUserById(session.employee_id);
      if (accountError || !account.user) throw new Error("Employee account is unavailable");
      const { data: profile, error: profileError } = await service.from("employee_profiles")
        .select("full_name, employee_id, scheme, role").eq("id", session.employee_id).single();
      if (profileError || !profile) throw new Error("Employee profile is unavailable");
      const { data: policy, error: policyError } = await service.from("company_settings")
        .select("timezone").eq("id", true).single();
      if (policyError || !policy?.timezone) throw new Error("Attendance timezone is unavailable");
      await notifySheet({
        action: item.action, sessionId: item.session_id, loginAt: session.login_at,
        logoutAt: session.logout_at || "", timezone: policy.timezone,
        email: account.user.email || "", employeeName: profile.full_name,
        employeeId: profile.employee_id, scheme: profile.scheme, role: profile.role,
      });
      // The separate date queue handles the matrix, including manual corrections.
      const { error: updateError } = await service.from("attendance_sheet_sync_queue")
        .update({ synced_at: new Date().toISOString(), attempts: item.attempts + 1, last_error: null })
        .eq("id", item.id).eq("updated_at", item.updated_at);
      if (updateError) throw updateError;
    } catch (cause) {
      failed++;
      console.error("Attendance sheet sync failed", item.id, cause);
      const retryMinutes = Math.min(60, 2 ** Math.min(item.attempts, 6));
      await service.from("attendance_sheet_sync_queue").update({
        attempts: item.attempts + 1,
        next_attempt_at: new Date(Date.now() + retryMinutes * 60000).toISOString(),
        last_error: cause instanceof Error ? cause.message.slice(0, 240) : "Sync failed",
      }).eq("id", item.id).eq("updated_at", item.updated_at);
    }
  }
  return { attempted: (pending || []).length, failed };
}

async function syncMatrixDay(service: Service, day: string, timezone: string) {
  const { data: rows, error } = await service.rpc("portal_attendance_daily_v2", {
    p_from: day, p_to: day, p_employee: null,
  });
  if (error) throw error;
  await notifySheet({ action: "matrix-day", day, timezone,
    rows: JSON.stringify((rows || []).map((row: Record<string, unknown>) => ({
      userId: row.user_id, employeeId: row.employee_id, fullName: row.full_name,
      signIn: row.first_sign_in,
      signOut: row.attendance_status === "Signed In" ||
        row.attendance_status === "Missing Sign-Out" ? null : row.last_sign_out,
      status: row.attendance_status, isLate: row.is_late,
      activeOnDay: row.active_on_day, scheduled: row.scheduled,
    }))),
  });
}

async function flushMatrixQueue(service: Service, limit = 5) {
  const { data: pending, error } = await service.from("attendance_matrix_sync_queue")
    .select("attendance_date,attempts,updated_at").is("synced_at", null)
    .lte("next_attempt_at", new Date().toISOString())
    .order("attendance_date", { ascending: false }).limit(limit);
  if (error) throw error;
  const { data: policy, error: policyError } = await service.from("company_settings")
    .select("timezone").eq("id", true).single();
  if (policyError || !policy?.timezone) throw policyError || new Error("Timezone unavailable");
  let failed = 0;
  for (const item of pending || []) {
    try {
      await syncMatrixDay(service, item.attendance_date, policy.timezone);
      const { error: updateError } = await service.from("attendance_matrix_sync_queue")
        .update({ synced_at: new Date().toISOString(), attempts: item.attempts + 1,
          last_error: null }).eq("attendance_date", item.attendance_date)
          .eq("updated_at", item.updated_at);
      if (updateError) throw updateError;
    } catch (cause) {
      failed++;
      console.error("Attendance matrix sync failed", item.attendance_date, cause);
      const retryMinutes = Math.min(60, 2 ** Math.min(item.attempts, 6));
      await service.from("attendance_matrix_sync_queue").update({
        attempts: item.attempts + 1,
        next_attempt_at: new Date(Date.now() + retryMinutes * 60000).toISOString(),
        last_error: cause instanceof Error ? cause.message.slice(0, 240) : "Sync failed",
      }).eq("attendance_date", item.attendance_date)
        .eq("updated_at", item.updated_at);
    }
  }
  return { attempted: (pending || []).length, failed };
}

function scheduleSheetFlush(service: Service) {
  // Supabase has already committed the session and its durable queue item.
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(Promise.all([flushSheetQueue(service), flushMatrixQueue(service)])
      .catch((error) => {
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
    if (!["start-session", "end-session", "get-activity-report", "sheet-sync", "matrix-sync"].includes(action))
      return response({ error: "Invalid request" }, 400);
    const { data: employee, error: profileError } = await service.from("employee_profiles")
      .select("id, employee_id, full_name, scheme, role, is_active")
      .eq("id", auth.user.id).maybeSingle();
    if (profileError || !employee || (!employee.is_active && action !== "end-session"))
      return response({ error: "Employee account is not active" }, 403);

    if (["get-activity-report", "sheet-sync", "matrix-sync"].includes(action)) {
      if (!employee.is_active || employee.role !== "Co-CEO")
        return response({ error: "Co-CEO authorization required" }, 403);
      if (action === "sheet-sync") {
        const limit = Math.min(20, Math.max(1, Number(body.limit) || 20));
        const [raw, matrix] = await Promise.all([
          flushSheetQueue(service, limit), flushMatrixQueue(service, limit),
        ]);
        const { count: rawPending } = await service.from("attendance_sheet_sync_queue")
          .select("id", { count: "exact", head: true }).is("synced_at", null);
        const { count: matrixPending } = await service.from("attendance_matrix_sync_queue")
          .select("attendance_date", { count: "exact", head: true }).is("synced_at", null);
        return response({ ok: true, pending: (rawPending || 0) + (matrixPending || 0),
          attempted: raw.attempted + matrix.attempted, failed: raw.failed + matrix.failed,
          rawPending: rawPending || 0, matrixPending: matrixPending || 0 });
      }
      if (action === "matrix-sync") {
        const from = String(body.from || ""), to = String(body.to || from);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
            to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 45)
          return response({ error: "Choose a valid range of at most 46 days" }, 400);
        const { data: policy, error: policyError } = await service.from("company_settings")
          .select("timezone").eq("id", true).single();
        if (policyError || !policy?.timezone) throw policyError || new Error("Timezone unavailable");
        let updated = 0;
        for (let cursor = Date.parse(from); cursor <= Date.parse(to); cursor += 86400000) {
          await syncMatrixDay(service, new Date(cursor).toISOString().slice(0, 10), policy.timezone);
          updated++;
        }
        return response({ ok: true, updated });
      }
      if (body.reportVersion !== 2) {
        // Keep already-published clients working until their cached JS updates.
        const legacy = await notifySheet({
          action: "report",
          limit: String(Math.min(500, Math.max(1, Number(body.limit) || 200))),
          offset: String(Math.max(0, Number(body.offset) || 0)),
          from: typeof body.from === "string" ? body.from : "",
          to: typeof body.to === "string" ? body.to : "",
          employeeId: typeof body.employeeId === "string" ? body.employeeId : "",
        });
        if (!Array.isArray(legacy.sessions) || !Number.isFinite(Number(legacy.total)))
          throw new SheetError("Google Sheets returned an invalid report.");
        return response({ source: "google_sheet", total: legacy.total,
          sessions: legacy.sessions.map((row: Record<string, unknown>) => ({
            ...row, login_at: row.loginAt || null, logout_at: row.logoutAt || null,
            status: row.status || "Unknown",
            employee_profiles: { full_name: row.employeeName || "",
              employee_id: row.employeeId || "", role: row.role || "", scheme: row.scheme || "" },
          })) });
      }
      const limit = Math.min(500, Math.max(1, Number(body.limit) || 200));
      const offset = Math.max(0, Number(body.offset) || 0);
      let query = service.from("employee_activity_sessions")
        .select("session_id,employee_id,login_at,logout_at,status,employee_profiles!employee_activity_sessions_employee_id_fkey(full_name,employee_id,role,scheme)", { count: "exact" })
        .order("login_at", { ascending: false }).range(offset, offset + limit - 1);
      if (typeof body.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.from)) query = query.gte("login_at", body.from);
      if (typeof body.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.to)) query = query.lt("login_at", new Date(Date.parse(body.to) + 86400000).toISOString());
      const { data: sessions, count, error: reportError } = await query;
      if (reportError) throw reportError;
      const { data: reportPolicy } = await service.from("company_settings")
        .select("timezone").eq("id", true).single();
      return response({ source: "supabase", timezone: reportPolicy?.timezone || "UTC",
        total: count || 0, sessions: (sessions || []).map((row) => ({
        ...row, workedMinutes: row.logout_at ? Math.max(0, Math.floor(
          (Date.parse(row.logout_at) - Date.parse(row.login_at)) / 60000)) : null,
      })) });
    }

    if (action === "start-session") {
      if (!validUuid(body.sessionId)) return response({ error: "Invalid session ID" }, 400);
      const { data, error } = await service.rpc("portal_employee_start_session", {
        p_user_id: employee.id, p_session_id: body.sessionId,
      });
      if (error) throw error;
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
