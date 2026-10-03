import { BOARD_SIZE, COIN_RADIUS } from "../../shared/constants";
import { mulberry32 } from "../../shared/rng";
import { RIM } from "./view";

// Everything here is drawn in code: no image files. Sprites are rendered once per
// canvas size at device resolution, then stamped each frame.

interface Metal {
  base: string;
  light: string;
  dark: string;
}

const METALS: Metal[] = [
  { base: "#b8733a", light: "#f0b47a", dark: "#5e3215" }, // copper
  { base: "#c49a45", light: "#f6dc94", dark: "#6b4d16" }, // brass
  { base: "#8f6d48", light: "#d1b08a", dark: "#3f2c18" }, // dark bronze
];

export const METAL_COUNT = METALS.length;

// Kan'ei Tsūhō, the classic Edo-era mon coin. Read top, bottom, right, left.
const LEGEND = ["寛", "永", "通", "寳"];
const LEGEND_FONT = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", serif';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return [c, c.getContext("2d")!];
}

/** A coin at device resolution, with the square hole cut out so the board shows through. */
export function makeCoinSprite(metal: number, scale: number): HTMLCanvasElement {
  const m = METALS[metal % METALS.length];
  const r = COIN_RADIUS * scale;
  const size = Math.ceil(r * 2) + 2;
  const [c, g] = canvas(size);
  const cx = size / 2;

  const body = g.createRadialGradient(cx - r * 0.35, cx - r * 0.4, r * 0.05, cx, cx, r);
  body.addColorStop(0, m.light);
  body.addColorStop(0.55, m.base);
  body.addColorStop(1, m.dark);
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cx, r, 0, Math.PI * 2);
  g.fill();

  // Raised outer rim.
  g.lineWidth = r * 0.09;
  g.strokeStyle = m.dark;
  g.globalAlpha = 0.55;
  g.beginPath();
  g.arc(cx, cx, r * 0.9, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 0.35;
  g.lineWidth = r * 0.04;
  g.strokeStyle = m.light;
  g.beginPath();
  g.arc(cx, cx, r * 0.84, 0, Math.PI * 2);
  g.stroke();

  // Embossed legend.
  const at = r * 0.56;
  const spots = [
    [0, -at],
    [0, at],
    [at, 0],
    [-at, 0],
  ];
  g.font = `600 ${r * 0.38}px ${LEGEND_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  LEGEND.forEach((ch, i) => {
    const [dx, dy] = spots[i];
    g.globalAlpha = 0.6;
    g.fillStyle = m.dark;
    g.fillText(ch, cx + dx + r * 0.03, cx + dy + r * 0.04);
    g.globalAlpha = 0.45;
    g.fillStyle = m.light;
    g.fillText(ch, cx + dx, cx + dy);
  });

  // Raised square rim around the hole.
  const hole = r * 0.2;
  const lip = r * 0.07;
  g.globalAlpha = 0.6;
  g.strokeStyle = m.dark;
  g.lineWidth = lip;
  g.strokeRect(cx - hole - lip / 2, cx - hole - lip / 2, (hole + lip / 2) * 2, (hole + lip / 2) * 2);

  // The hole itself.
  g.globalAlpha = 1;
  g.globalCompositeOperation = "destination-out";
  g.fillRect(cx - hole, cx - hole, hole * 2, hole * 2);

  return c;
}

/** Soft round shadow, drawn under each coin with a small offset. */
export function makeShadowSprite(scale: number): HTMLCanvasElement {
  const r = COIN_RADIUS * scale;
  const size = Math.ceil(r * 2.6);
  const [c, g] = canvas(size);
  const cx = size / 2;
  const grad = g.createRadialGradient(cx, cx, r * 0.6, cx, cx, r * 1.25);
  grad.addColorStop(0, "rgba(0,0,0,0.5)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** The whole board (rim plus walnut play area) at device resolution. */
export function makeBoardBackground(px: number, scale: number): HTMLCanvasElement {
  const [c, g] = canvas(px);
  const rng = mulberry32(7);
  const rim = RIM * scale;
  const play = BOARD_SIZE * scale;

  // Rim: dark lacquered frame.
  const frame = g.createLinearGradient(0, 0, px, px);
  frame.addColorStop(0, "#3a2414");
  frame.addColorStop(1, "#24160c");
  g.fillStyle = frame;
  g.fillRect(0, 0, px, px);
  g.strokeStyle = "rgba(255, 220, 170, 0.12)";
  g.lineWidth = Math.max(1, scale * 3);
  g.strokeRect(scale * 4, scale * 4, px - scale * 8, px - scale * 8);

  // Play area: walnut with grain.
  g.save();
  g.translate(rim, rim);
  const base = g.createLinearGradient(0, 0, play, play);
  base.addColorStop(0, "#6b4428");
  base.addColorStop(1, "#553420");
  g.fillStyle = base;
  g.fillRect(0, 0, play, play);

  g.beginPath();
  g.rect(0, 0, play, play);
  g.clip();
  for (let i = 0; i < 160; i++) {
    const y = rng() * play;
    const amp = (4 + rng() * 14) * scale;
    const freq = 0.002 + rng() * 0.004;
    const phase = rng() * Math.PI * 2;
    g.strokeStyle = rng() < 0.7 ? `rgba(40, 22, 10, ${0.06 + rng() * 0.12})` : `rgba(200, 150, 100, ${0.03 + rng() * 0.06})`;
    g.lineWidth = (0.8 + rng() * 3) * scale;
    g.beginPath();
    for (let x = -10; x <= play + 10; x += 12 * scale) {
      const yy = y + Math.sin(x / scale * freq * Math.PI * 2 + phase) * amp;
      if (x === -10) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }

  // Inner shadow where the play area meets the raised rim.
  const edge = 26 * scale;
  const sides: [number, number, number, number, number, number, number, number][] = [
    [0, 0, play, edge, 0, 0, 0, edge],
    [0, play - edge, play, edge, 0, play, 0, play - edge],
    [0, 0, edge, play, 0, 0, edge, 0],
    [play - edge, 0, edge, play, play, 0, play - edge, 0],
  ];
  for (const [x, y, w, h, x0, y0, x1, y1] of sides) {
    const s = g.createLinearGradient(x0, y0, x1, y1);
    s.addColorStop(0, "rgba(0,0,0,0.45)");
    s.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = s;
    g.fillRect(x, y, w, h);
  }

  // Gentle vignette to pull the eye to the middle.
  const v = g.createRadialGradient(play / 2, play / 2, play * 0.3, play / 2, play / 2, play * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.3)");
  g.fillStyle = v;
  g.fillRect(0, 0, play, play);
  g.restore();

  return c;
}
