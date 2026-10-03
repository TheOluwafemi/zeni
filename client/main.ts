import { PROTOCOL_VERSION } from "../shared/constants";

const status = document.querySelector<HTMLParagraphElement>("#status")!;

async function checkServer() {
  try {
    const res = await fetch("/api/health");
    const body: { ok: boolean; protocol: number } = await res.json();
    status.textContent =
      body.ok && body.protocol === PROTOCOL_VERSION
        ? "Server OK"
        : `Server protocol mismatch (${body.protocol} vs ${PROTOCOL_VERSION})`;
  } catch {
    status.textContent = "Offline";
  }
}

checkServer();
