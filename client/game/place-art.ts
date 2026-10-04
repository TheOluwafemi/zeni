// The look of each place, drawn in code in one flat, friendly illustration style: a backdrop that
// stands behind the opponent like a stage set, the floor around the table, the table's finish, and
// the colour of the light.

import type { PlaceId } from "../../shared/places";
import { OAK, WALNUT, woodTexture } from "./wood";

export interface PlaceLight {
  /** Hemisphere light: sky colour, ground colour, intensity. */
  sky: number;
  ground: number;
  fill: number;
  /** The warm key light. */
  key: number;
  keyIntensity: number;
}

export interface PlaceArt {
  backdrop: HTMLCanvasElement;
  floor: HTMLCanvasElement;
  /** How many times the floor texture repeats across the floor. */
  floorRepeat: number;
  tableTop: HTMLCanvasElement;
  /** Colour of the table's edge and pedestal. */
  tableSide: number;
  light: PlaceLight;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A potted plant: a pot and a fan of leaves. */
function plant(g: CanvasRenderingContext2D, x: number, y: number, s: number, pot: string): void {
  g.fillStyle = "#3f7d4a";
  for (let i = -3; i <= 3; i++) {
    g.save();
    g.translate(x, y - 40 * s);
    g.rotate(i * 0.32);
    g.beginPath();
    g.ellipse(0, -55 * s, 16 * s, 58 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.fillStyle = "#5c9a5a";
  for (let i = -2; i <= 2; i++) {
    g.save();
    g.translate(x, y - 40 * s);
    g.rotate(i * 0.4 + 0.15);
    g.beginPath();
    g.ellipse(0, -40 * s, 11 * s, 40 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.fillStyle = pot;
  g.beginPath();
  g.moveTo(x - 38 * s, y - 50 * s);
  g.lineTo(x + 38 * s, y - 50 * s);
  g.lineTo(x + 28 * s, y);
  g.lineTo(x - 28 * s, y);
  g.closePath();
  g.fill();
}

/** A mug, side on. */
function mug(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  g.fillStyle = color;
  roundRect(g, x, y - 46 * s, 40 * s, 46 * s, 6 * s);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 7 * s;
  g.beginPath();
  g.arc(x + 42 * s, y - 24 * s, 11 * s, -Math.PI / 2, Math.PI / 2);
  g.stroke();
}

// --- Kitchen: morning sun, a window over the counter --------------------------

function kitchenBackdrop(): HTMLCanvasElement {
  const W = 2048;
  const H = 1024;
  const [c, g] = canvas(W, H);

  // Warm cream wall, a touch brighter where the sun comes in.
  const wall = g.createLinearGradient(0, 0, W, 0);
  wall.addColorStop(0, "#f2dfc0");
  wall.addColorStop(0.45, "#fbeed6");
  wall.addColorStop(1, "#efd8b6");
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);

  // The window, with a morning sky, sun, a cloud and a tree outside.
  const wx = 720;
  const wy = 120;
  const ww = 620;
  const wh = 430;
  const sky = g.createLinearGradient(0, wy, 0, wy + wh);
  sky.addColorStop(0, "#8fd0f2");
  sky.addColorStop(1, "#dff3fb");
  g.fillStyle = sky;
  g.fillRect(wx, wy, ww, wh);
  g.fillStyle = "#ffe7a3";
  g.beginPath();
  g.arc(wx + 470, wy + 120, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.9)";
  for (const [dx, dy, r] of [
    [140, 120, 38],
    [185, 105, 46],
    [235, 122, 36],
  ]) {
    g.beginPath();
    g.arc(wx + dx, wy + dy, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#6fae63";
  g.beginPath();
  g.arc(wx + 110, wy + wh - 40, 120, 0, Math.PI * 2);
  g.arc(wx + 250, wy + wh + 10, 110, 0, Math.PI * 2);
  g.arc(wx + 560, wy + wh, 95, 0, Math.PI * 2);
  g.fill();
  // Frame and glazing bars.
  g.strokeStyle = "#ffffff";
  g.lineWidth = 22;
  g.strokeRect(wx, wy, ww, wh);
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(wx + ww / 2, wy);
  g.lineTo(wx + ww / 2, wy + wh);
  g.moveTo(wx, wy + wh * 0.45);
  g.lineTo(wx + ww, wy + wh * 0.45);
  g.stroke();
  // Sunlight falling into the room.
  g.fillStyle = "rgba(255, 236, 190, 0.35)";
  g.beginPath();
  g.moveTo(wx, wy + wh);
  g.lineTo(wx + ww, wy + wh);
  g.lineTo(wx + ww + 260, H);
  g.lineTo(wx - 120, H);
  g.closePath();
  g.fill();

  // Open shelf with mugs and jars, left of the window.
  g.fillStyle = "#c69462";
  g.fillRect(150, 330, 430, 18);
  mug(g, 190, 330, 1, "#f2743c");
  mug(g, 270, 330, 1, "#2bb3a3");
  g.fillStyle = "#f2c230";
  roundRect(g, 360, 262, 56, 68, 10);
  g.fill();
  g.fillStyle = "#e8547a";
  roundRect(g, 440, 280, 50, 50, 10);
  g.fill();
  plant(g, 1650, 340, 0.9, "#e8547a");
  g.fillStyle = "#c69462";
  g.fillRect(1520, 340, 300, 18);

  // Tiled splash-back, then the counter and sage cabinets.
  const top = 640;
  g.fillStyle = "#ffffff";
  g.fillRect(0, top - 80, W, 80);
  g.strokeStyle = "rgba(170, 160, 140, 0.45)";
  g.lineWidth = 2;
  for (let row = 0; row < 3; row++) {
    const y = top - 80 + row * 27;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
    for (let x = row % 2 ? 0 : 40; x < W; x += 80) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 27);
      g.stroke();
    }
  }
  // A kettle and a fruit bowl on the counter.
  g.fillStyle = "#e8547a";
  g.beginPath();
  g.ellipse(560, top - 50, 70, 55, 0, Math.PI, 0);
  g.fillRect(490, top - 52, 140, 52);
  g.fill();
  g.fillStyle = "#222";
  g.fillRect(545, top - 122, 30, 14);
  g.fillStyle = "#f2c230";
  for (const dx of [-30, 0, 30]) {
    g.beginPath();
    g.arc(1480 + dx, top - 30, 22, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(1480, top - 12, 80, 22, 0, 0, Math.PI);
  g.fill();

  g.fillStyle = "#c69462";
  g.fillRect(0, top, W, 26);
  g.fillStyle = "#9cc6a8";
  g.fillRect(0, top + 26, W, H - top - 26);
  g.strokeStyle = "rgba(60, 100, 70, 0.35)";
  g.lineWidth = 4;
  for (let x = 0; x < W; x += 256) {
    g.strokeRect(x + 14, top + 48, 228, H - top - 70);
    g.fillStyle = "#f3e9d2";
    roundRect(g, x + 120, top + 70, 16, 46, 8);
    g.fill();
  }
  return c;
}

function tiles(base: string, grout: string, size = 512, n = 4): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const t = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = base;
      g.fillRect(x * t, y * t, t, t);
      // A little variation tile to tile.
      g.fillStyle = (x + y) % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
      g.fillRect(x * t, y * t, t, t);
    }
  }
  g.strokeStyle = grout;
  g.lineWidth = size / 128;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * t, 0);
    g.lineTo(i * t, size);
    g.moveTo(0, i * t);
    g.lineTo(size, i * t);
    g.stroke();
  }
  return c;
}

// --- Café: brick, a chalkboard and pendant lamps -----------------------------

function cafeBackdrop(): HTMLCanvasElement {
  const W = 2048;
  const H = 1024;
  const [c, g] = canvas(W, H);

  // Brick wall.
  g.fillStyle = "#a9553d";
  g.fillRect(0, 0, W, H);
  const bw = 96;
  const bh = 40;
  for (let row = 0; row * bh < H; row++) {
    for (let col = -1; col * bw < W; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0);
      const shade = ((row * 7 + col * 13) % 5) / 5;
      g.fillStyle = `rgb(${165 + shade * 30}, ${78 + shade * 18}, ${56 + shade * 12})`;
      g.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
    }
  }

  // Chalkboard menu.
  const bx = 1180;
  const by = 120;
  g.fillStyle = "#6b4a2f";
  roundRect(g, bx - 18, by - 18, 560 + 36, 380 + 36, 12);
  g.fill();
  g.fillStyle = "#2f3a33";
  g.fillRect(bx, by, 560, 380);
  g.fillStyle = "rgba(255,255,255,0.88)";
  g.font = "600 46px 'Trebuchet MS', system-ui, sans-serif";
  g.fillText("Today", bx + 40, by + 70);
  g.font = "34px 'Trebuchet MS', system-ui, sans-serif";
  ["Flat white", "Matcha latte", "Iced tea", "Cinnamon bun"].forEach((item, i) => {
    g.fillText(item, bx + 40, by + 135 + i * 56);
    g.fillText(["3.2", "3.8", "2.9", "2.5"][i], bx + 440, by + 135 + i * 56);
  });

  // Pendant lamps with a warm glow.
  for (const lx of [420, 820]) {
    const glow = g.createRadialGradient(lx, 330, 10, lx, 330, 320);
    glow.addColorStop(0, "rgba(255, 214, 140, 0.55)");
    glow.addColorStop(1, "rgba(255, 214, 140, 0)");
    g.fillStyle = glow;
    g.fillRect(lx - 340, 0, 680, 700);
    g.strokeStyle = "#1d1d1d";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(lx, 0);
    g.lineTo(lx, 250);
    g.stroke();
    g.fillStyle = "#1f2b2e";
    g.beginPath();
    g.moveTo(lx - 80, 330);
    g.lineTo(lx + 80, 330);
    g.lineTo(lx + 30, 250);
    g.lineTo(lx - 30, 250);
    g.closePath();
    g.fill();
    g.fillStyle = "#ffe1a1";
    g.beginPath();
    g.ellipse(lx, 330, 80, 12, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Counter with an espresso machine, cups and a plant.
  const top = 660;
  g.fillStyle = "#cfd6d2";
  roundRect(g, 220, top - 190, 300, 190, 18);
  g.fill();
  g.fillStyle = "#9aa3a0";
  g.fillRect(250, top - 150, 240, 24);
  g.fillStyle = "#3b3b3b";
  g.fillRect(300, top - 120, 30, 50);
  g.fillRect(410, top - 120, 30, 50);
  mug(g, 600, top, 0.9, "#ffffff");
  mug(g, 680, top, 0.9, "#2bb3a3");
  plant(g, 1850, top, 1.1, "#2f3a33");
  g.fillStyle = "#5a3820";
  g.fillRect(0, top, W, 30);
  g.fillStyle = "#3a2516";
  g.fillRect(0, top + 30, W, H - top - 30);
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 3;
  for (let x = 0; x < W; x += 64) {
    g.beginPath();
    g.moveTo(x, top + 30);
    g.lineTo(x, H);
    g.stroke();
  }
  return c;
}

/** A painted table top: flat colour with the wood grain just showing through. */
function paintedTop(color: string): HTMLCanvasElement {
  const wood = woodTexture(OAK);
  const [c, g] = canvas(wood.width, wood.height);
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalAlpha = 0.16;
  g.globalCompositeOperation = "multiply";
  g.drawImage(wood, 0, 0);
  return c;
}

/**
 * A table top as it's seen from above, like the flat view's: the grain turned slightly, a broad soft
 * sheen from the top-left where the light is, and a little darker toward the rim. The cylinder's cap
 * maps this square onto the round top.
 */
function varnished(surface: HTMLCanvasElement): HTMLCanvasElement {
  const size = 1024;
  const [c, g] = canvas(size, size);
  const mid = size / 2;
  g.translate(mid, mid);
  g.rotate(-0.12);
  const span = size * 1.15;
  g.drawImage(surface, -span / 2, -span / 2, span, span);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const sheen = g.createRadialGradient(mid - size * 0.18, mid - size * 0.22, size * 0.02, mid - size * 0.1, mid - size * 0.12, size * 0.55);
  sheen.addColorStop(0, "rgba(255, 236, 205, 0.14)");
  sheen.addColorStop(0.5, "rgba(255, 236, 205, 0.04)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, size, size);
  const rim = g.createRadialGradient(mid, mid, size * 0.36, mid, mid, size * 0.5);
  rim.addColorStop(0, "rgba(0, 0, 0, 0)");
  rim.addColorStop(1, "rgba(0, 0, 0, 0.3)");
  g.fillStyle = rim;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Dark floorboards. */
function planks(): HTMLCanvasElement {
  const wood = woodTexture(WALNUT);
  const [c, g] = canvas(512, 512);
  g.drawImage(wood, 0, 0, 512, 512);
  g.fillStyle = "rgba(20, 10, 4, 0.35)";
  g.fillRect(0, 0, 512, 512);
  return c;
}

const built = new Map<PlaceId, PlaceArt>();

export function placeArt(id: PlaceId): PlaceArt {
  const done = built.get(id);
  if (done) return done;
  const art: PlaceArt =
    id === "cafe"
      ? {
          backdrop: cafeBackdrop(),
          floor: planks(),
          floorRepeat: 8,
          tableTop: varnished(paintedTop("#8fd3bf")),
          tableSide: 0x4f8f7e,
          light: { sky: 0xffe6c2, ground: 0x3a2414, fill: 1.4, key: 0xffd59a, keyIntensity: 2.0 },
        }
      : {
          backdrop: kitchenBackdrop(),
          floor: tiles("#d9b48c", "#b8916b"),
          floorRepeat: 10,
          tableTop: varnished(woodTexture(WALNUT)),
          tableSide: 0x3b2213,
          light: { sky: 0xfff3e0, ground: 0x4a2e1a, fill: 1.5, key: 0xffe7c4, keyIntensity: 2.2 },
        };
  built.set(id, art);
  return art;
}
