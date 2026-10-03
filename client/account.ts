// The player card on Home and the sheets behind it: create, restore, settings.

import { api, ApiError, identity, SIGNED_OUT, type Created, type Me } from "./api";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// --- Wording ------------------------------------------------------------------

const NICKNAME_PROBLEMS: Record<string, string> = {
  length: "Use 3 to 16 characters.",
  characters: "Letters, numbers and _ only.",
  reserved: "That name isn't available.",
  blocked: "That name isn't available.",
  taken: "That name is taken.",
};

function explain(e: unknown): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Try again.";
  if (e.code === "offline") return "Can't reach the server. Check your connection.";
  if (e.code === "rate_limited") return "Too many tries. Wait a few minutes and try again.";
  if (e.code === "nickname_taken") return NICKNAME_PROBLEMS.taken;
  if (e.code === "invalid_nickname") return NICKNAME_PROBLEMS[e.reason ?? "length"] ?? NICKNAME_PROBLEMS.length;
  if (e.code === "unknown_code") return "No player has that code. Check it and try again.";
  return "Something went wrong. Try again.";
}

// --- Sheets (modal dialogs) ---------------------------------------------------

const sheets = ["#sheet-create", "#sheet-restore", "#sheet-settings"].map((s) => $(s));
let opener: HTMLElement | null = null;

function openSheet(sheet: HTMLElement, focus?: HTMLElement): void {
  opener = document.activeElement as HTMLElement | null;
  for (const s of sheets) s.hidden = s !== sheet;
  (focus ?? sheet.querySelector<HTMLElement>("input, button"))?.focus();
}

function closeSheets(): void {
  for (const s of sheets) s.hidden = true;
  opener?.focus();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheets.some((s) => !s.hidden)) closeSheets();
});

function setStatus(el: HTMLElement, text: string, tone: "ok" | "bad" | "" = ""): void {
  el.textContent = text;
  el.className = `status ${tone}`.trim();
}

async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select and copy";
  }
  setTimeout(() => (button.textContent = label), 1500);
}

// --- Player card ----------------------------------------------------------------

let me: Me | null = null;

export function currentPlayer(): Me | null {
  return me;
}

function renderCard(): void {
  $("#player-out").hidden = me !== null;
  $("#player-in").hidden = me === null;
  if (me) {
    $("#player-name").textContent = me.nickname;
    $("#player-rating").textContent =
      me.games === 0 ? "Rating 1000 · no games yet" : `Rating ${me.rating} · ${me.wins}W ${me.losses}L${me.position ? ` · #${me.position}` : ""}`;
  }
}

/** Load the signed-in player, if this device has a code. */
export async function refreshPlayer(): Promise<void> {
  if (!identity.code) {
    me = null;
  } else {
    try {
      me = await api<Me>("/api/me", { auth: true });
    } catch (e) {
      // Offline or server trouble: keep what we had. A 401 already cleared the code.
      if (e instanceof ApiError && e.status === 401) me = null;
    }
  }
  renderCard();
}

window.addEventListener(SIGNED_OUT, () => {
  me = null;
  renderCard();
});

// --- Create ---------------------------------------------------------------------

const createForm = $<HTMLFormElement>("#create-form");
const createInput = $<HTMLInputElement>("#create-nickname");
const createStatus = $("#create-status");
const createSubmit = $<HTMLButtonElement>("#create-submit");
let checkTimer = 0;
let checkSeq = 0;
let nameOk = false;

function showCreate(): void {
  createInput.value = "";
  setStatus(createStatus, "");
  createSubmit.disabled = true;
  nameOk = false;
  $("#create-done").hidden = true;
  createForm.hidden = false;
  openSheet($("#sheet-create"), createInput);
}

createInput.addEventListener("input", () => {
  nameOk = false;
  createSubmit.disabled = true;
  clearTimeout(checkTimer);
  const name = createInput.value.trim();
  if (name === "") return setStatus(createStatus, "");

  // Check the rules locally first so most typing needs no request.
  if (name.length < 3) return setStatus(createStatus, NICKNAME_PROBLEMS.length, "bad");
  if (!/^[A-Za-z0-9_]+$/.test(name)) return setStatus(createStatus, NICKNAME_PROBLEMS.characters, "bad");

  setStatus(createStatus, "Checking…");
  const seq = ++checkSeq;
  checkTimer = window.setTimeout(async () => {
    try {
      const r = await api<{ available: boolean; reason?: string }>(`/api/nickname/${encodeURIComponent(name)}`);
      if (seq !== checkSeq) return; // a newer keystroke superseded this one
      nameOk = r.available;
      createSubmit.disabled = !r.available;
      setStatus(createStatus, r.available ? "Available" : (NICKNAME_PROBLEMS[r.reason ?? ""] ?? "That name isn't available."), r.available ? "ok" : "bad");
    } catch (e) {
      if (seq === checkSeq) setStatus(createStatus, explain(e), "bad");
    }
  }, 300);
});

createForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!nameOk) return;
  createSubmit.disabled = true;
  try {
    const player = await api<Created>("/api/register", { method: "POST", body: { nickname: createInput.value.trim() } });
    identity.set(player.code);
    $("#done-name").textContent = player.nickname;
    $<HTMLInputElement>("#done-code").value = player.code;
    createForm.hidden = true;
    $("#create-done").hidden = false;
    $("#done-close").focus();
    await refreshPlayer();
  } catch (err) {
    setStatus(createStatus, explain(err), "bad");
    createSubmit.disabled = false;
  }
});

$("#create-player").addEventListener("click", showCreate);
$("#create-cancel").addEventListener("click", closeSheets);
$("#done-close").addEventListener("click", closeSheets);
$("#done-copy").addEventListener("click", (e) => copy($<HTMLInputElement>("#done-code").value, e.currentTarget as HTMLButtonElement));
$("#create-to-restore").addEventListener("click", showRestore);

// --- Restore --------------------------------------------------------------------

const restoreForm = $<HTMLFormElement>("#restore-form");
const restoreInput = $<HTMLInputElement>("#restore-code");
const restoreStatus = $("#restore-status");

function showRestore(): void {
  restoreInput.value = "";
  setStatus(restoreStatus, "");
  openSheet($("#sheet-restore"), restoreInput);
}

restoreForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = restoreInput.value.trim();
  if (!code) return;
  const submit = $<HTMLButtonElement>("#restore-submit");
  submit.disabled = true;
  setStatus(restoreStatus, "Checking…");
  try {
    const player = await api<Created>("/api/restore", { method: "POST", body: { code } });
    identity.set(player.code);
    await refreshPlayer();
    closeSheets();
  } catch (err) {
    setStatus(restoreStatus, explain(err), "bad");
  } finally {
    submit.disabled = false;
  }
});

$("#restore-player").addEventListener("click", showRestore);
$("#restore-cancel").addEventListener("click", closeSheets);

// --- Settings -------------------------------------------------------------------

const renameForm = $<HTMLFormElement>("#rename-form");
const renameInput = $<HTMLInputElement>("#rename-nickname");
const renameStatus = $("#rename-status");
const codeInput = $<HTMLInputElement>("#settings-code");
const codeShow = $<HTMLButtonElement>("#code-show");
const codeStatus = $("#code-status");

function setCodeVisible(visible: boolean): void {
  codeInput.type = visible ? "text" : "password";
  codeShow.textContent = visible ? "Hide" : "Show";
  codeShow.setAttribute("aria-pressed", String(visible));
}

$("#open-settings").addEventListener("click", () => {
  if (!me) return;
  renameInput.value = me.nickname;
  codeInput.value = identity.code ?? "";
  setCodeVisible(false);
  setStatus(renameStatus, "");
  setStatus(codeStatus, "");
  openSheet($("#sheet-settings"));
});

renameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nickname = renameInput.value.trim();
  if (!me || nickname === me.nickname) return setStatus(renameStatus, "");
  try {
    await api("/api/me/nickname", { method: "PUT", auth: true, body: { nickname } });
    setStatus(renameStatus, "Saved", "ok");
    await refreshPlayer();
  } catch (err) {
    setStatus(renameStatus, explain(err), "bad");
  }
});

codeShow.addEventListener("click", () => setCodeVisible(codeInput.type === "password"));
$("#code-copy").addEventListener("click", (e) => copy(codeInput.value, e.currentTarget as HTMLButtonElement));

$("#code-rotate").addEventListener("click", async () => {
  if (!confirm("Get a new code? The old one will stop working on every device, including this one until it picks up the new code.")) return;
  try {
    const { code } = await api<{ code: string }>("/api/me/code", { method: "POST", auth: true });
    identity.set(code);
    codeInput.value = code;
    setCodeVisible(true);
    setStatus(codeStatus, "New code ready. Save it. The old one no longer works.", "ok");
  } catch (err) {
    setStatus(codeStatus, explain(err), "bad");
  }
});

$("#settings-close").addEventListener("click", closeSheets);
