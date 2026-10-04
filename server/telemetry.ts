// Feedback, error logging and anonymous usage counts. Everything here is deliberately small:
// capped sizes, per-address rate limits, and nothing that tracks a person across visits.

import { allow, authenticate, type Db } from "./accounts";
import { bump, dayOf } from "./stats";

export { bump, dayOf, markActive } from "./stats";

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, error: string): Response => json({ error }, status);

const clip = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

export const LIMITS = {
  feedback: [5, 3600], // messages per address per hour
  log: [40, 3600], // client error reports per address per hour
  event: [120, 3600], // anonymous counter pings per address per hour
} as const;

/** Anonymous counters a client may bump. Anything else is ignored, so the table can't be filled with junk. */
export const CLIENT_EVENTS = ["open", "computer_game", "daily_puzzle"] as const;

// --- Errors --------------------------------------------------------------------

export interface ErrorReport {
  source: "client" | "server" | "room" | "matchmaker";
  message: string;
  stack?: string | null;
  screen?: string | null;
  version?: string | null;
  userAgent?: string | null;
}

/** A short stable id for "the same error": the message plus the first line of the stack. */
export async function fingerprint(source: string, message: string, stack: string | null): Promise<string> {
  const firstFrame = (stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
  const data = new TextEncoder().encode(`${source}|${message}|${firstFrame.replace(/:\d+:\d+\)?$/, "")}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function logError(db: Db, report: ErrorReport, now = Date.now()): Promise<void> {
  const message = report.message.slice(0, 300);
  const stack = report.stack ? report.stack.slice(0, 1500) : null;
  const id = await fingerprint(report.source, message, stack);
  await db
    .prepare(
      `INSERT INTO error_log (day, fingerprint, source, message, stack, screen, version, user_agent, first_at, last_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
       ON CONFLICT(day, fingerprint) DO UPDATE SET count = count + 1, last_at = ?9`,
    )
    .bind(dayOf(now), id, report.source, message, stack, report.screen ?? null, report.version ?? null, report.userAgent ?? null, now)
    .run();
}

/** Log an error from our own server code without ever letting logging itself throw. */
export async function logServerError(db: Db, source: ErrorReport["source"], error: unknown): Promise<void> {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    await logError(db, { source, message: e.message || e.name, stack: e.stack ?? null });
  } catch {
    // If the database is the problem, there's nowhere left to write to.
  }
}

// --- Routes ----------------------------------------------------------------------

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

/** POST /api/feedback, /api/log and /api/event. Returns null for any other path. */
export async function handleTelemetry(request: Request, url: URL, db: Db): Promise<Response | null> {
  const { pathname } = url;
  if (request.method !== "POST" || !["/api/feedback", "/api/log", "/api/event"].includes(pathname)) return null;

  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const userAgent = (request.headers.get("User-Agent") ?? "").slice(0, 200) || null;
  const now = Date.now();
  const body = await readBody(request);
  if (!body) return fail(400, "bad_request");

  if (pathname === "/api/feedback") {
    if (!(await allow(db, `feedback:${ip}`, LIMITS.feedback))) return fail(429, "rate_limited");
    const message = clip(body.message, 2000);
    if (!message) return fail(400, "empty");
    const player = await authenticate(db, request.headers.get("Authorization")); // optional: anonymous is fine
    await db
      .prepare("INSERT INTO feedback (at, message, contact, player_id, nickname, version, screen, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(now, message, clip(body.contact, 120), player?.id ?? null, player?.nickname ?? null, clip(body.version, 40), clip(body.screen, 40), userAgent)
      .run();
    return json({ ok: true }, 201);
  }

  if (pathname === "/api/log") {
    if (!(await allow(db, `log:${ip}`, LIMITS.log))) return fail(429, "rate_limited");
    const message = clip(body.message, 300);
    if (!message) return fail(400, "empty");
    await logError(
      db,
      { source: "client", message, stack: clip(body.stack, 1500), screen: clip(body.screen, 40), version: clip(body.version, 40), userAgent },
      now,
    );
    return json({ ok: true }, 201);
  }

  // /api/event
  if (!(await allow(db, `event:${ip}`, LIMITS.event))) return fail(429, "rate_limited");
  const name = body.name;
  if (typeof name === "string" && (CLIENT_EVENTS as readonly string[]).includes(name)) await bump(db, name, now);
  return json({ ok: true }, 202); // unknown names are quietly ignored
}
