// The Send feedback sheet. Messages go to our own server; no email app, no third party.

import { currentPlayer } from "./account";
import { api, ApiError, identity } from "./api";
import { BUILD, currentScreen } from "./diagnostics";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const sheet = $("#sheet-feedback");
const form = $<HTMLFormElement>("#feedback-form");
const message = $<HTMLTextAreaElement>("#feedback-message");
const contact = $<HTMLInputElement>("#feedback-contact");
const status = $("#feedback-status");
const send = $<HTMLButtonElement>("#feedback-send");

function describeAttachments(): string {
  const who = currentPlayer();
  return `Sent with: build ${BUILD}${who ? `, as ${who.nickname}` : ""}.`;
}

export function openFeedback(): void {
  status.textContent = "";
  status.className = "status";
  $("#feedback-attached").textContent = describeAttachments();
  send.disabled = message.value.trim() === "";
  form.hidden = false;
  $("#feedback-thanks").hidden = true;
  sheet.hidden = false;
  message.focus();
}

function close(): void {
  sheet.hidden = true;
}

message.addEventListener("input", () => (send.disabled = message.value.trim() === ""));
$("#feedback-cancel").addEventListener("click", close);
$("#feedback-done").addEventListener("click", close);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sheet.hidden) close();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = message.value.trim();
  if (!text) return;
  send.disabled = true;
  status.className = "status";
  status.textContent = "Sending…";
  try {
    await api("/api/feedback", {
      method: "POST",
      auth: identity.code !== null,
      body: { message: text, contact: contact.value.trim() || undefined, screen: currentScreen(), version: BUILD },
    });
    message.value = "";
    form.hidden = true;
    $("#feedback-thanks").hidden = false;
    $<HTMLButtonElement>("#feedback-done").focus();
  } catch (err) {
    status.className = "status bad";
    status.textContent =
      err instanceof ApiError && err.code === "rate_limited"
        ? "You've sent a few messages already. Try again a bit later."
        : err instanceof ApiError && err.code === "offline"
          ? "Can't reach the server. Your message is still here; try again when you're online."
          : "Couldn't send that. Your message is still here; try again.";
    send.disabled = false;
  }
});
