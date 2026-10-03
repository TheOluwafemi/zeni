// Talking to the Zeni server, and remembering who this device is.
//
// The player code is the device's identity: stored here, sent as a Bearer token. If storage is
// unavailable (private mode), the player just has to paste their code again next visit.

const KEY = "zeni.code";

let memory: string | null = null; // fallback when localStorage can't be used

export const identity = {
  get code(): string | null {
    try {
      return localStorage.getItem(KEY) ?? memory;
    } catch {
      return memory;
    }
  },
  set(code: string): void {
    memory = code;
    try {
      localStorage.setItem(KEY, code);
    } catch {
      // Kept in memory for this visit only.
    }
  },
  clear(): void {
    memory = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason?: string,
  ) {
    super(code);
  }
}

/** Fired when the server says the stored code no longer works (for example it was replaced). */
export const SIGNED_OUT = "zeni:signed-out";

interface Options {
  method?: string;
  body?: unknown;
  /** Send the stored player code. */
  auth?: boolean;
}

export async function api<T>(path: string, { method = "GET", body, auth = false }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth && identity.code) headers.Authorization = `Bearer ${identity.code}`;

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "offline");
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && auth) {
      identity.clear();
      window.dispatchEvent(new Event(SIGNED_OUT));
    }
    throw new ApiError(res.status, String(data.error ?? "error"), typeof data.reason === "string" ? data.reason : undefined);
  }
  return data as T;
}

export interface Me {
  playerId: string;
  nickname: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  position: number | null;
}

export interface Created {
  playerId: string;
  nickname: string;
  code: string;
}
