// Procedural walnut planks, generated pixel by pixel once and cached.
// Long grain comes from noise stretched along each plank; fine fibres and pores
// from higher-frequency noise; each plank gets its own offset and tint.

const TEXTURE_SIZE = 1024;
const PLANKS = 7;

/** Hash-based value noise on an integer lattice, smoothly interpolated. */
function makeNoise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  /** Fractal sum of `octaves` layers, roughly 0..1. */
  return (x: number, y: number, octaves: number) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * f, y * f) * amp;
      f *= 2;
      amp *= 0.5;
    }
    return sum;
  };
}

// Walnut palette: dark latewood, warm earlywood.
const DARK = [74, 44, 25];
const LIGHT = [138, 90, 54];

let cached: HTMLCanvasElement | null = null;

export function woodTexture(): HTMLCanvasElement {
  if (cached) return cached;

  const size = TEXTURE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(size, size);
  const px = img.data;

  const grain = makeNoise(11);
  const fibre = makeNoise(29);
  const pores = makeNoise(47);
  const plankH = size / PLANKS;

  const plank = Array.from({ length: PLANKS }, (_, i) => {
    const r = makeNoise(100 + i)(0.5, 0.5, 1);
    return { offset: r * 50, tint: 0.84 + r * 0.3, stretch: 0.7 + r * 0.7 };
  });

  for (let y = 0; y < size; y++) {
    const pi = Math.min(PLANKS - 1, Math.floor(y / plankH));
    const p = plank[pi];
    const yInPlank = y - pi * plankH;
    for (let x = 0; x < size; x++) {
      // Grain lines wander slowly along the plank's length.
      const warp = grain(x * 0.0018 * p.stretch, (y + p.offset * 20) * 0.01, 4);
      const v = (yInPlank * 0.09 + warp * 6.5 + p.offset) % 1;
      // Thin latewood lines that never go fully dark, with soft bands between.
      let t = 0.28 + 0.72 * Math.pow(Math.abs(Math.sin(v * Math.PI)), 0.5);
      // Fine fibres running with the grain, and scattered pores.
      t += (fibre(x * 0.03, y * 0.9, 2) - 0.5) * 0.25;
      const pore = pores(x * 0.35, y * 0.12, 1);
      if (pore > 0.87) t -= 0.15;
      t = Math.min(1, Math.max(0, t));

      const shade = p.tint * (0.86 + grain(x * 0.0012, y * 0.005, 3) * 0.28);
      const i = (y * size + x) * 4;
      px[i] = (DARK[0] + (LIGHT[0] - DARK[0]) * t) * shade;
      px[i + 1] = (DARK[1] + (LIGHT[1] - DARK[1]) * t) * shade;
      px[i + 2] = (DARK[2] + (LIGHT[2] - DARK[2]) * t) * shade;
      px[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // Seams between planks: a dark gap with a faint highlight on the lower lip.
  for (let i = 1; i < PLANKS; i++) {
    const y = Math.round(i * plankH);
    g.fillStyle = "rgba(20, 10, 4, 0.75)";
    g.fillRect(0, y - 1, size, 2);
    g.fillStyle = "rgba(255, 210, 160, 0.10)";
    g.fillRect(0, y + 1, size, 1);
  }

  cached = canvas;
  return canvas;
}
