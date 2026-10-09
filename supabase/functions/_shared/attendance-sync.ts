import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Server is missing ${name}`); return value; };

export class SheetError extends Error {}

export async function notifySheet(payload: Record<string, string>) {
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

export type Service = SupabaseClient;
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;

export async function flushSheetQueue(service: Service, limit = 5) {
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
      if (![5, 6, 7].includes(Number(capabilities.contractVersion)))
        throw new SheetError("The attendance Sheet script must be updated before raw reconciliation.");
      const { data: session, error: sessionError } = await service
        .from("employee_activity_sessions")
        .select("session_id, employee_id, login_at, logout_at, status, auto_closed, estimated_logout, disconnect_reason")
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
      if (session.auto_closed && Number(capabilities.contractVersion) < 7) throw new SheetError("Auto-close raw sync requires Apps Script contract 7; authoritative Supabase attendance is preserved.");
      await notifySheet({
        action: item.action, sessionId: item.session_id, loginAt: session.login_at,
        logoutAt: session.logout_at || "", timezone: policy.timezone,
        logoutType: session.auto_closed ? (session.estimated_logout ? "auto_closed" : "auto_disconnect") : session.disconnect_reason === "portal_closed" ? "portal_closed" : "normal",
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

export async function syncMatrixDay(service: Service, day: string, timezone: string) {
  const { data: rows, error } = await service.rpc("portal_attendance_daily_v2", {
    p_from: day, p_to: day, p_employee: null,
  });
  if (error) throw error;
  const { data: closures, error: closureError } = await service.rpc("portal_sheet_auto_closed", { p_day: day });
  if (closureError) throw closureError;
  const estimated = new Set((closures || []).map((row: { user_id: string }) => row.user_id));
  await notifySheet({ action: "matrix-day", day, timezone,
    rows: JSON.stringify((rows || []).map((row: Record<string, unknown>) => ({
      userId: row.user_id, employeeId: row.employee_id, fullName: row.full_name,
      signIn: row.first_sign_in,
      signOut: row.attendance_status === "Signed In" ||
        row.attendance_status === "Missing Sign-Out" ? null : row.last_sign_out,
      status: estimated.has(String(row.user_id)) ? "Auto Closed / Automatic" : row.attendance_status, isLate: row.is_late,
      activeOnDay: row.active_on_day, scheduled: row.scheduled,
    }))),
  });
}

export async function flushMatrixQueue(service: Service, limit = 5) {
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
