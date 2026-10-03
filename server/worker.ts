import { PROTOCOL_VERSION } from "../shared/constants";
import { handleAccounts } from "./accounts";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
    }

    const accounts = await handleAccounts(request, url, env.DB, (p) => ctx.waitUntil(p));
    if (accounts) return accounts;

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
