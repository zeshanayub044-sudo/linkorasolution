import { createWorkforceHandler, iceConfig } from "../supabase/functions/workforce-live/handler.ts";
import type { Service } from "../supabase/functions/_shared/attendance-sync.ts";
const equal = (a: unknown, b: unknown) => { if (a !== b) throw new Error("Assertion failed: " + String(a) + " !== " + String(b)); };
const user = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const jwt = "test." + btoa(JSON.stringify({ session_id: session })) + ".verified-by-mock";
function fixture(accepted = true, rpcError: { code: string } | null = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service = { auth: { async getUser(token: string) {
    return accepted && token === jwt ? { data: { user: { id: user } }, error: null }
      : { data: { user: null }, error: new Error("Invalid token") };
  } }, async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args }); return { data: { active: true }, error: rpcError };
  } } as unknown as Service;
  return { calls, handle: createWorkforceHandler(service, () => undefined) };
}
function request(body: unknown, token?: string, origin = "https://linkorasolution.com") {
  return new Request("https://test.invalid", { method: "POST", headers: {
    Origin: origin, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}),
  }, body: JSON.stringify(body) });
}
Deno.test("anonymous/forged token/foreign origin cannot invoke privileged RPC", async () => {
  const f = fixture();
  equal((await f.handle(request({ action: "workforce" }))).status, 401);
  equal((await f.handle(request({ action: "workforce" }, "forged"))).status, 401);
  equal((await f.handle(request({ action: "workforce" }, jwt, "https://foreign.invalid"))).status, 403);
  equal(f.calls.length, 0);
});
Deno.test("identity and Auth session come from verified JWT, never browser actor/role", async () => {
  const f = fixture();
  equal((await f.handle(request({ action: "workforce", userId: "spoof", role: "Co-CEO" }, jwt))).status, 200);
  equal(f.calls[0].args.p_user_id, user); equal(f.calls[0].args.p_auth_session, session);
});
Deno.test("database denies non-Co-CEO and handler preserves rejection", async () => {
  const f = fixture(true, { code: "42501" });
  equal((await f.handle(request({ action: "viewer-join", shareId: session }, jwt))).status, 403);
});
Deno.test("closing only accepts its scoped capability and never permits data reads", async () => {
  const f = fixture();
  equal((await f.handle(request({ action: "closing", sessionId: session, tabId: user, closeToken: "short" }))).status, 401);
  equal(f.calls.length, 0);
  const closeToken = user + session;
  equal((await f.handle(request({ action: "closing", sessionId: session, tabId: user, closeToken }))).status, 200);
  equal(f.calls[0].name, "portal_presence_close"); equal(String(f.calls[0].args.p_hash).length, 64);
  equal(f.calls[0].args.p_hash === closeToken, false);
  equal((await f.handle(request({ action: "workforce", closeToken }))).status, 401);
});
Deno.test("invalid requests and stale rate-limit codes return safe statuses", async () => {
  const f = fixture(true, { code: "54000" });
  equal((await f.handle(request({ action: "heartbeat" }, jwt))).status, 429);
  equal((await f.handle(request({ action: "remote-capture" }, jwt))).status, 400);
  equal((await f.handle(request({ action: "signal", payload: "x".repeat(100001) }, jwt))).status, 413);
});
Deno.test("TURN is short-lived HMAC credential, never the shared secret", async () => {
  const config = await iceConfig(user, (name) => ({
    ATTENDANCE_TURN_URLS: "turn:relay.example.com:3478?transport=udp",
    ATTENDANCE_TURN_SHARED_SECRET: "local-test-only-value", ATTENDANCE_ICE_POLICY: "relay",
  } as Record<string, string>)[name]);
  equal(config.iceTransportPolicy, "relay");
  equal(config.iceServers.length, 2);
  equal(config.iceServers[1].credential === "local-test-only-value", false);
  const expiry = Number(config.iceServers[1].username?.split(":")[0]);
  equal(expiry > Date.now() / 1000 + 590 && expiry < Date.now() / 1000 + 610, true);
  let denied = false;
  try { await iceConfig(user, (name) => name === "ATTENDANCE_ICE_POLICY" ? "relay" : undefined); }
  catch { denied = true; }
  equal(denied, true);
});
