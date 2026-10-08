import { flushSheetQueue, flushMatrixQueue, type Service } from "../_shared/attendance-sync.ts";

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const browserOrigin = (origin: string | null) => origin === "https://linkorasolution.com" ||
  origin === "https://www.linkorasolution.com" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");
const actions = new Set(["connect", "heartbeat", "workforce", "ice", "share-start", "share-stop",
  "viewer-join", "poll-owner", "poll-viewer", "peer-leave", "signal"]);
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void } | undefined;

export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function iceConfig(userId: string, env: (name: string) => string | undefined) {
  const urls = (env("ATTENDANCE_TURN_URLS") || "").split(",").map((url) => url.trim()).filter(Boolean);
  const secret = env("ATTENDANCE_TURN_SHARED_SECRET");
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [{ urls: "stun:stun.cloudflare.com:3478" }];
  if (urls.length && secret) {
    if (urls.some((url) => !/^turns?:[a-zA-Z0-9.[\]:?=&_-]+$/.test(url))) throw new Error("Invalid TURN configuration");
    const username = Math.floor(Date.now() / 1000 + 600) + ":" + userId;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username)));
    iceServers.push({ urls, username, credential: btoa(String.fromCharCode(...signed)) });
  }
  const relayConfigured = urls.length > 0 && !!secret;
  if (env("ATTENDANCE_ICE_POLICY") === "relay" && !relayConfigured) throw new Error("TURN relay is required but unavailable");
  return { iceServers, iceTransportPolicy: env("ATTENDANCE_ICE_POLICY") === "relay" ? "relay" : "all", relayConfigured };
}

export function createWorkforceHandler(service: Service, env = (name: string) => Deno.env.get(name)) {
  return async (request: Request) => {
    const origin = request.headers.get("Origin");
    const headers = {
      "Access-Control-Allow-Origin": browserOrigin(origin) ? origin! : "https://linkorasolution.com",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json",
      "Cache-Control": "no-store", "Vary": "Origin",
    };
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !browserOrigin(origin)) return response({ error: "Origin denied" }, 403);
    if (request.method === "OPTIONS") return new Response("ok", { headers });
    if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
    try {
      const text = await request.text();
      if (text.length > 100000) return response({ error: "Request too large" }, 413);
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { return response({ error: "Invalid request" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "Invalid request" }, 400);
      const action = body.action;
      if (action === "closing") {
        // sendBeacon cannot set Authorization. This unguessable capability has
        // exactly one permission: close its registered tab, never read or extend a session.
        if (!browserOrigin(origin) || !uuid(body.sessionId) || !uuid(body.tabId) ||
            typeof body.closeToken !== "string" || !/^[0-9a-f-]{72}$/.test(body.closeToken)) {
          return response({ error: "Unauthorized" }, 401);
        }
        const { data, error } = await service.rpc("portal_presence_close", {
          p_session: body.sessionId, p_tab: body.tabId, p_hash: await digest(body.closeToken),
        });
        if (error || !data) return response({ error: "Unauthorized" }, 401);
        return response({ ok: true });
      }
      const bearer = request.headers.get("Authorization");
      if (!bearer?.startsWith("Bearer ")) return response({ error: "Unauthorized" }, 401);
      const token = bearer.slice(7);
      if (action === "maintenance") {
        const { data, error } = await service.rpc("portal_maintenance_authorize", { p_token: token });
        if (error || !data) return response({ error: "Unauthorized" }, 401);
        const task = Promise.all([flushSheetQueue(service, 5), flushMatrixQueue(service, 5)])
          .then(([raw, matrix]) => ({ raw, matrix }));
        if (typeof EdgeRuntime !== "undefined") {
          EdgeRuntime.waitUntil(task.catch(() => { console.error("Attendance mirror retry deferred"); }));
          return response({ ok: true, queued: true }, 202);
        }
        return response({ ok: true, ...(await task) });
      }
      if (typeof action !== "string" || !actions.has(action)) return response({ error: "Invalid action" }, 400);
      const { data: auth, error: authError } = await service.auth.getUser(token);
      if (authError || !auth.user) return response({ error: "Unauthorized" }, 401);
      // Decode session_id only after Auth has verified this token. No role comes from the payload.
      let authSession: unknown;
      try { authSession = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id; } catch { /* reject */ }
      if (!uuid(authSession)) return response({ error: "Active Auth session required" }, 401);
      const payload = { ...body };
      delete payload.action;
      let closeToken: string | undefined;
      if (action === "connect") {
        closeToken = crypto.randomUUID() + crypto.randomUUID();
        payload.closeTokenHash = await digest(closeToken);
      }
      const rpc = action === "connect" || action === "heartbeat" ? "portal_presence_action" : "portal_workforce_action";
      const { data, error } = await service.rpc(rpc, {
        p_user_id: auth.user.id, p_auth_session: authSession, p_action: action, p_payload: payload,
      });
      if (error) {
        if (error.code === "42501") return response({ error: "Access denied. Active portal authorization is required." }, 403);
        if (error.code === "23505") return response({ error: "Another portal tab is already sharing. Stop it first." }, 409);
        if (error.code === "54000") return response({ error: "Please wait before trying again." }, 429);
        if (["22023", "22P02", "22003", "P0002"].includes(error.code)) return response({ error: "The requested session is unavailable or invalid." }, 400);
        return response({ error: "The workforce service is temporarily unavailable." }, 500);
      }
      if (action === "ice") return response(await iceConfig(auth.user.id, env));
      return response({ ...data, ...(closeToken ? { closeToken } : {}) });
    } catch {
      // Never log tokens, SDP, ICE, close capabilities or request bodies.
      return response({ error: "The workforce service is temporarily unavailable." }, 500);
    }
  };
}
