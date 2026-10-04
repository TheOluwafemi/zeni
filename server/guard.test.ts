import { describe, expect, test } from "vitest";
import { guard } from "./guard";

/** A rate limiter that allows `allowed` calls per key, recording which keys were checked. */
function limiter(allowed: number) {
  const counts = new Map<string, number>();
  return {
    keys: [] as string[],
    async limit({ key }: { key: string }) {
      this.keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= allowed };
    },
  };
}

function env(api = 100, socket = 100, presence = 100) {
  return { API_LIMIT: limiter(api), SOCKET_LIMIT: limiter(socket), PRESENCE_LIMIT: limiter(presence) };
}

const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://zeni.example${path}`, { headers: { "CF-Connecting-IP": "203.0.113.7", ...headers } });

describe("the front door", () => {
  test("WebSockets opened from another site are refused", async () => {
    const r = await guard(req("/ws/queue/easy", { Origin: "https://evil.example" }), env());
    expect(r?.status).toBe(403);
  });

  test("WebSockets from our own pages, or from apps with no Origin, are let through", async () => {
    expect(await guard(req("/ws/room/K7QXM", { Origin: "https://zeni.example" }), env())).toBeNull();
    expect(await guard(req("/ws/room/K7QXM"), env())).toBeNull();
  });

  test("each kind of request has its own per-address limit", async () => {
    const e = env(2, 1, 1);
    expect(await guard(req("/api/me"), e)).toBeNull();
    expect(await guard(req("/api/leaderboard"), e)).toBeNull();
    expect((await guard(req("/api/me"), e))?.status).toBe(429);
    expect(await guard(req("/ws/queue/easy"), e)).toBeNull(); // sockets counted separately
    expect((await guard(req("/ws/queue/easy"), e))?.status).toBe(429);
    expect(await guard(req("/api/presence"), e)).toBeNull(); // and presence
    expect(e.API_LIMIT.keys.every((k) => k === "203.0.113.7")).toBe(true);
  });

  test("a refused request says when to try again", async () => {
    const e = env(0);
    const r = (await guard(req("/api/me"), e))!;
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });

  test("static pages aren't limited here", async () => {
    expect(await guard(req("/"), env(0, 0, 0))).toBeNull();
  });
});
