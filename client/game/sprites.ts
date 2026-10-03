import { COIN_RADIUS, CUP_RADIUS, TABLE_RADIUS } from "../../shared/constants";
import { woodTexture } from "./wood";

/** Same as the page background, so the table floats in the room. */
const FLOOR = "#1c120b";

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

/** Soft round shadow for something of radius `radius` (board units). */
export function makeShadowSprite(radius: number, scale: number): HTMLCanvasElement {
  const r = radius * scale;
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

/** A tea cup seen from above: glazed ceramic rim around green tea. */
export function makeCupSprite(scale: number): HTMLCanvasElement {
  const r = CUP_RADIUS * scale;
  const size = Math.ceil(r * 2) + 2;
  const [c, g] = canvas(size);
  const cx = size / 2;

  const glaze = g.createRadialGradient(cx - r * 0.4, cx - r * 0.45, r * 0.1, cx, cx, r);
  glaze.addColorStop(0, "#f4efe2");
  glaze.addColorStop(0.6, "#d9d1bd");
  glaze.addColorStop(1, "#8f8672");
  g.fillStyle = glaze;
  g.beginPath();
  g.arc(cx, cx, r, 0, Math.PI * 2);
  g.fill();

  // Indigo band just inside the lip, like a hand-painted yunomi.
  g.strokeStyle = "rgba(44, 62, 110, 0.75)";
  g.lineWidth = r * 0.05;
  g.beginPath();
  g.arc(cx, cx, r * 0.9, 0, Math.PI * 2);
  g.stroke();

  // Inside wall shading, then the tea.
  const inner = r * 0.76;
  const wall = g.createRadialGradient(cx, cx, inner * 0.8, cx, cx, inner * 1.05);
  wall.addColorStop(0, "rgba(0,0,0,0.35)");
  wall.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = wall;
  g.beginPath();
  g.arc(cx, cx, inner * 1.05, 0, Math.PI * 2);
  g.fill();

  const tea = g.createRadialGradient(cx + inner * 0.2, cx + inner * 0.25, inner * 0.1, cx, cx, inner);
  tea.addColorStop(0, "#9aa63c");
  tea.addColorStop(0.7, "#6f7a22");
  tea.addColorStop(1, "#424a12");
  g.fillStyle = tea;
  g.beginPath();
  g.arc(cx, cx, inner * 0.92, 0, Math.PI * 2);
  g.fill();

  // Light catching the surface of the tea.
  g.fillStyle = "rgba(255, 255, 230, 0.28)";
  g.beginPath();
  g.ellipse(cx - inner * 0.3, cx - inner * 0.35, inner * 0.32, inner * 0.14, -0.6, 0, Math.PI * 2);
  g.fill();

  return c;
}

/** The floor plus the round walnut table, at device resolution. */
export function makeBoardBackground(px: number, scale: number): HTMLCanvasElement {
  const [c, g] = canvas(px);
  const cx = px / 2;
  const r = TABLE_RADIUS * scale;
  const edge = 14 * scale; // visible thickness of the table top

  // Floor: matches the page so the table seems to float in the room's shadow.
  g.fillStyle = FLOOR;
  g.fillRect(0, 0, px, px);

  // Soft shadow the table casts on the floor.
  g.save();
  g.shadowColor = "rgba(0, 0, 0, 0.85)";
  g.shadowBlur = 40 * scale;
  g.shadowOffsetY = 22 * scale;
  g.fillStyle = "#1a0e06";
  g.beginPath();
  g.arc(cx, cx + edge, r, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Table edge: the side of the slab, visible below the top.
  const side = g.createLinearGradient(0, cx - r, 0, cx + r + edge);
  side.addColorStop(0, "#2a170b");
  side.addColorStop(1, "#4a2a15");
  g.fillStyle = side;
  g.beginPath();
  g.arc(cx, cx + edge, r, 0, Math.PI * 2);
  g.fill();

  // Table top: the wood texture clipped to a circle, grain turned slightly for interest.
  g.save();
  g.beginPath();
  g.arc(cx, cx, r, 0, Math.PI * 2);
  g.clip();
  g.translate(cx, cx);
  g.rotate(-0.12);
  const wood = woodTexture();
  const span = r * 2.2;
  g.drawImage(wood, -span / 2, -span / 2, span, span);
  g.setTransform(1, 0, 0, 1, 0, 0);

  // Varnish: a broad soft sheen from the top-left, and darker toward the rim.
  const sheen = g.createRadialGradient(cx - r * 0.35, cx - r * 0.45, r * 0.05, cx - r * 0.2, cx - r * 0.25, r * 1.1);
  sheen.addColorStop(0, "rgba(255, 236, 205, 0.16)");
  sheen.addColorStop(0.5, "rgba(255, 236, 205, 0.04)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, px, px);

  const rim = g.createRadialGradient(cx, cx, r * 0.72, cx, cx, r);
  rim.addColorStop(0, "rgba(0, 0, 0, 0)");
  rim.addColorStop(1, "rgba(0, 0, 0, 0.32)");
  g.fillStyle = rim;
  g.fillRect(0, 0, px, px);
  g.restore();

  // Rounded-over lip: lit along the top-left, in shade along the bottom-right.
  const lip = g.createLinearGradient(cx - r, cx - r, cx + r, cx + r);
  lip.addColorStop(0, "rgba(255, 220, 175, 0.45)");
  lip.addColorStop(0.5, "rgba(255, 220, 175, 0.08)");
  lip.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  g.strokeStyle = lip;
  g.lineWidth = 4 * scale;
  g.beginPath();
  g.arc(cx, cx, r - 2 * scale, 0, Math.PI * 2);
  g.stroke();

  return c;
}
