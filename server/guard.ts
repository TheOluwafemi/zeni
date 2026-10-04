// The front door: checks that run before any route, and headers on everything the Worker answers.
// No Cloudflare-only imports, so it can be tested in Node.

/** The slice of a Workers rate-limit binding used here. */
interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
export interface Limits {
  API_LIMIT: Limiter;
  SOCKET_LIMIT: Limiter;
  PRESENCE_LIMIT: Limiter;
}

const tooMany = () =>
  Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });

/**
 * Checks before any route runs: per-address rate limits (API calls, new WebSockets, presence pings),
 * and WebSockets only from our own pages, so another site can't use its visitors' browsers to open
 * games or flood the queue. Returns a response to send instead, or null to carry on.
 */
export async function guard(request: Request, env: Limits): Promise<Response | null> {
  const url = new URL(request.url);
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (url.pathname.startsWith("/ws/")) {
    const origin = request.headers.get("Origin");
    if (origin !== null && !sameHost(origin, url.host)) return Response.json({ error: "forbidden" }, { status: 403 });
    return (await env.SOCKET_LIMIT.limit({ key: ip })).success ? null : tooMany();
  }
  if (url.pathname === "/api/presence") return (await env.PRESENCE_LIMIT.limit({ key: ip })).success ? null : tooMany();
  if (url.pathname.startsWith("/api/")) return (await env.API_LIMIT.limit({ key: ip })).success ? null : tooMany();
  return null;
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Headers for everything the Worker answers itself (static files get theirs from public/_headers). */
export function withSecurityHeaders(response: Response): Response {
  if (response.status === 101) return response; // a WebSocket handshake: leave it exactly as it is
  const out = new Response(response.body, response);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  out.headers.set("X-Frame-Options", "DENY");
  out.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  return out;
}
