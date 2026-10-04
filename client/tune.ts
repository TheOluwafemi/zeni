import { DEFAULT_PHYSICS, type PhysicsConfig } from "../shared/constants";

interface Knob {
  key: keyof PhysicsConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}

const KNOBS: Knob[] = [
  { key: "maxSpeed", label: "Max speed", min: 600, max: 3000, step: 50 },
  { key: "friction", label: "Friction", min: 200, max: 2000, step: 25 },
  { key: "coinRestitution", label: "Coin bounce", min: 0.5, max: 1, step: 0.01 },
  { key: "cupRestitution", label: "Cup bounce", min: 0.1, max: 1, step: 0.05 },
  { key: "powerExponent", label: "Power curve", min: 1, max: 2.5, step: 0.05 },
  { key: "contactFriction", label: "Grip", min: 0, max: 0.5, step: 0.01 },
  { key: "softSpeed", label: "Soft taps below", min: 0, max: 800, step: 10 },
  { key: "driftSpeed", label: "Drift below", min: 0, max: 800, step: 10 },
  { key: "driftFriction", label: "Drift friction", min: 0.2, max: 1, step: 0.05 },
  { key: "spinDecay", label: "Spin decay", min: 1, max: 40, step: 1 },
];

/** Live sliders for the physics feel. Only shown with ?tune in the URL. */
export function mountTuning(panel: HTMLElement, physics: PhysicsConfig): void {
  panel.hidden = false;
  const inputs = new Map<keyof PhysicsConfig, [HTMLInputElement, HTMLOutputElement]>();

  for (const k of KNOBS) {
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = k.label;
    const out = document.createElement("output");
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(k.min);
    input.max = String(k.max);
    input.step = String(k.step);
    input.addEventListener("input", () => {
      physics[k.key] = Number(input.value);
      out.textContent = input.value;
    });
    label.append(name, out, input);
    panel.append(label);
    inputs.set(k.key, [input, out]);
  }

  const sync = () => {
    for (const [key, [input, out]] of inputs) {
      input.value = String(physics[key]);
      out.textContent = input.value;
    }
  };

  const row = document.createElement("div");
  row.className = "row";
  const copy = button("Copy values", async () => {
    await navigator.clipboard.writeText(JSON.stringify(physics, null, 2));
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy values"), 1200);
  });
  const reset = button("Reset", () => {
    Object.assign(physics, DEFAULT_PHYSICS);
    sync();
  });
  row.append(copy, reset);
  panel.append(row);
  sync();
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}
