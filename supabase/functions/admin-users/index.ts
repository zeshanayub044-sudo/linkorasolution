import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = (request: Request) => ({
  "Access-Control-Allow-Origin": (() => {
    const origin = request.headers.get("Origin");
    return origin === "https://linkorasolution.com" ||
      origin === "https://www.linkorasolution.com" ||
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "")
      ? origin! : "https://linkorasolution.com";
  })(),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Vary": "Origin",
});
const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server is missing ${name}`);
  return value;
};
class HttpError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const text = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const email = (value: unknown) => text(value, 320).toLowerCase();
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function fields(input: Record<string, unknown>, creating: boolean) {
  const result = {
    employeeId: text(input.employeeId, 80),
    fullName: text(input.fullName, 160),
    scheme: text(input.scheme, 120),
    role: text(input.role, 30),
    email: email(input.email),
    isActive: input.isActive === true,
    password: creating ? String(input.password || "") : "",
  };
  if (!result.employeeId || !result.fullName || !result.scheme ||
      !["Employee", "Co-CEO"].includes(result.role) || !validEmail(result.email) ||
      typeof input.isActive !== "boolean") throw new HttpError("Complete all user details with a valid email and role.");
  if (creating && result.password.length < 8) throw new HttpError("The temporary password must have at least 8 characters.");
  return result;
}

async function authUsers(service: ReturnType<typeof createClient>) {
  const users = new Map<string, { email?: string }>();
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) users.set(user.id, { email: user.email });
    if (data.users.length < 1000) return users;
  }
  throw new Error("Too many accounts to display at once");
}

declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;

function scheduleSheetSync(bearer: string) {
  if (typeof EdgeRuntime === "undefined") return;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) { console.error("Sheet queue pending: anon key unavailable for background retry"); return; }
  EdgeRuntime.waitUntil(fetch(`${env("SUPABASE_URL")}/functions/v1/manage-employee`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": bearer,
      "apikey": anonKey },
    body: JSON.stringify({ action: "sheet-sync", limit: 5 }),
  }).then((response) => {
    if (!response.ok) console.error("Background sheet sync returned", response.status);
  }).catch((error) => console.error("Background sheet sync failed", error)));
}

Deno.serve(async (request) => {
  const responseHeaders = corsHeaders(request);
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: responseHeaders });
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const bearer = request.headers.get("Authorization");
    if (!bearer?.startsWith("Bearer ")) throw new HttpError("Sign in is required.", 401);
    const service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await service.auth.getUser(bearer.slice(7));
    if (authError || !auth.user) throw new HttpError("Sign in is required.", 401);
    const { data: actor, error: actorError } = await service.from("employee_profiles")
      .select("id, full_name, role, is_active").eq("id", auth.user.id).maybeSingle();
    if (actorError || !actor?.is_active || actor.role.trim().toLowerCase() !== "co-ceo")
      throw new HttpError("Co-CEO access is required.", 403);

    const input = await request.json() as Record<string, unknown>;
    const action = text(input.action, 40);
    if (action === "list") {
      const [{ data: profiles, error: profileError }, { data: summaries, error: summaryError }, emails] = await Promise.all([
        service.from("employee_profiles").select("id, employee_id, full_name, scheme, role, is_active, created_at").order("full_name"),
        service.rpc("portal_admin_user_summary", { p_actor_id: actor.id }),
        authUsers(service),
      ]);
      if (profileError || summaryError) throw profileError || summaryError;
      const summaryMap = new Map((summaries || []).map((s: Record<string, unknown>) => [s.user_id, s]));
      return json({ users: (profiles || []).map((p) => ({
        id: p.id, employeeId: p.employee_id, fullName: p.full_name, scheme: p.scheme,
        role: p.role, isActive: p.is_active, createdAt: p.created_at,
        email: emails.get(p.id)?.email || "",
        signedIn: summaryMap.get(p.id)?.is_signed_in || false,
        lastSignIn: summaryMap.get(p.id)?.last_sign_in || null,
        lastSignOut: summaryMap.get(p.id)?.last_sign_out || null,
      })) });
    }
    if (action === "create") {
      const f = fields(input, true);
      const { data: existing, error: lookupError } = await service.from("employee_profiles")
        .select("id").eq("employee_id", f.employeeId).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) throw new HttpError("That employee ID is already in use.", 409);
      const { data: created, error: createError } = await service.auth.admin.createUser({
        email: f.email, password: f.password, email_confirm: true,
      });
      if (createError || !created.user) throw new HttpError(createError?.message || "Could not create account.", 409);
      const { error: profileError } = await service.rpc("portal_admin_create_profile", {
        p_actor_id: actor.id, p_user_id: created.user.id, p_employee_id: f.employeeId,
        p_full_name: f.fullName, p_scheme: f.scheme, p_role: f.role,
        p_is_active: f.isActive, p_email: f.email,
      });
      if (profileError) {
        const { error: cleanupError } = await service.auth.admin.deleteUser(created.user.id);
        if (cleanupError) console.error("Created Auth account requires cleanup", created.user.id, cleanupError);
        throw new HttpError(profileError.code === "23505" ? "That employee ID is already in use." : "Could not save the employee profile.", profileError.code === "23505" ? 409 : 500);
      }
      return json({ ok: true, id: created.user.id });
    }
    if (action === "edit" || action === "disable") {
      if (!uuid(input.userId)) throw new HttpError("Invalid user.");
      const { data: current, error: profileError } = await service.from("employee_profiles")
        .select("id, employee_id, full_name, scheme, role, is_active").eq("id", input.userId).maybeSingle();
      if (profileError || !current) throw new HttpError("User not found.", 404);
      const { data: authTarget, error: targetError } = await service.auth.admin.getUserById(current.id);
      if (targetError || !authTarget.user?.email) throw new HttpError("Login account not found.", 404);
      const oldEmail = authTarget.user.email.toLowerCase();
      const f = action === "disable"
        ? { employeeId: current.employee_id, fullName: current.full_name, scheme: current.scheme,
            role: current.role, isActive: false, email: oldEmail }
        : fields(input, false);
      if (current.id === actor.id && (!f.isActive || f.role !== "Co-CEO"))
        throw new HttpError("You cannot remove your own admin access.");
      if (action === "disable" && !current.is_active) throw new HttpError("This user is already disabled.");
      const emailChanged = f.email !== oldEmail;
      if (emailChanged) {
        const { error } = await service.auth.admin.updateUserById(current.id, { email: f.email, email_confirm: true });
        if (error) throw new HttpError(error.message, 409);
      }
      const { error: updateError } = await service.rpc("portal_admin_update_profile", {
        p_actor_id: actor.id, p_user_id: current.id, p_employee_id: f.employeeId,
        p_full_name: f.fullName, p_scheme: f.scheme, p_role: f.role,
        p_is_active: f.isActive, p_old_email: oldEmail, p_new_email: f.email,
      });
      if (updateError) {
        if (emailChanged) {
          const { error: rollbackError } = await service.auth.admin.updateUserById(current.id, { email: oldEmail, email_confirm: true });
          if (rollbackError) console.error("Email rollback requires attention", current.id, rollbackError);
        }
        throw new HttpError(updateError.code === "23505" ? "That employee ID is already in use." : updateError.message, updateError.code === "23505" ? 409 : 400);
      }
      if (current.is_active && !f.isActive) scheduleSheetSync(bearer);
      return json({ ok: true });
    }
    if (action === "attendance") {
      if (!uuid(input.userId)) throw new HttpError("Invalid user.");
      const desired = text(input.status, 20);
      const reason = text(input.reason, 500);
      if (!reason) throw new HttpError("Enter a reason for the attendance change.");
      const { data: target, error: targetError } = await service.from("employee_profiles")
        .select("id, employee_id, full_name, scheme, role, is_active").eq("id", input.userId).maybeSingle();
      if (targetError || !target) throw new HttpError("User not found.", 404);
      const { data: change, error: changeError } = await service.rpc("portal_admin_set_attendance", {
        p_actor_id: actor.id, p_target_id: target.id, p_new_status: desired, p_reason: reason,
      });
      if (changeError) throw new HttpError(changeError.message);
      scheduleSheetSync(bearer);
      return json({ ok: true, change });
    }
    if (action === "history") {
      if (!uuid(input.userId)) throw new HttpError("Invalid user.");
      const page = Math.max(0, Math.min(10000, Number(input.page) || 0));
      const { data: sessions, error, count } = await service.from("employee_activity_sessions")
        .select("session_id, login_at, logout_at, status, login_source, logout_source, login_actor_id, logout_actor_id, login_reason, logout_reason", { count: "exact" })
        .eq("employee_id", input.userId).order("login_at", { ascending: false }).range(page * 50, page * 50 + 49);
      if (error) throw error;
      return json({ sessions: sessions || [], count: count || 0, page });
    }
    if (action === "audit") {
      const { data, error } = await service.from("portal_admin_audit_log")
        .select("id, admin_name, action, target_name, created_at, before_state, after_state, reason")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json({ entries: data || [] });
    }
    throw new HttpError("Invalid request.");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("Admin user management failed", error);
    return json({ error: "User management is temporarily unavailable." }, 500);
  }
});
