// "Install Zeni": a button where the browser offers one (Android, desktop Chrome/Edge),
// and a one-time "Add to Home Screen" hint on iOS, which has no install prompt.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const HINT_KEY = "zeni.iosHint";

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function hintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setupInstall(button: HTMLButtonElement, iosHint: HTMLElement, dismiss: HTMLButtonElement): void {
  if (isStandalone()) return; // already installed and running as an app

  let deferred: InstallPromptEvent | null = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    button.hidden = false;
  });

  button.addEventListener("click", async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    button.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    button.hidden = true;
    iosHint.hidden = true;
  });

  if (isIos() && !hintDismissed()) iosHint.hidden = false;
  dismiss.addEventListener("click", () => {
    iosHint.hidden = true;
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Not persisted; the hint may show again next visit.
    }
  });
}
