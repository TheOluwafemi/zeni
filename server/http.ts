// Small HTTP helpers shared by the routes.

/** The largest request body any route accepts. Real ones are far smaller (feedback is the biggest). */
export const MAX_BODY_BYTES = 8 * 1024;

/**
 * Read a JSON body, refusing anything over `max` bytes without reading the rest, so an oversized
 * request can't tie up the Worker. Null if it's too big, empty or not JSON.
 */
export async function readJson(request: Request, max = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > max) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
