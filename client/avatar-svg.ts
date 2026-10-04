// Draws an avatar as an SVG string: a friendly bust in a colourful shirt, with three expressions.
// No DOM needed, so it can be tested in Node and turned into a texture for the 3D table.

import type { Expression, Look, Pattern } from "../shared/avatar";

let uid = 0;

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function pattern(id: string, kind: Pattern, base: string, accent: string): string {
  const open = (size: number) => `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><rect width="${size}" height="${size}" fill="${base}"/>`;
  switch (kind) {
    case "solid":
      return `${open(10)}</pattern>`;
    case "stripes":
      return `${open(8)}<rect x="0" width="3" height="8" fill="${accent}" opacity="0.85"/></pattern>`;
    case "dots":
      return `${open(9)}<circle cx="4.5" cy="4.5" r="1.8" fill="${accent}"/></pattern>`;
    case "floral": {
      const petals = [0, 72, 144, 216, 288]
        .map((a) => {
          const t = (a * Math.PI) / 180;
          return `<circle cx="${(8 + Math.cos(t) * 2.6).toFixed(2)}" cy="${(8 + Math.sin(t) * 2.6).toFixed(2)}" r="1.9" fill="${accent}"/>`;
        })
        .join("");
      return `${open(16)}${petals}<circle cx="8" cy="8" r="1.4" fill="#ffd23f"/><circle cx="0" cy="0" r="1.2" fill="${accent}" opacity="0.7"/></pattern>`;
    }
    case "geometric":
      return `${open(12)}<path d="M0 12 L6 2 L12 12 Z" fill="${accent}" opacity="0.8"/><path d="M6 12 L9 7 L12 12 Z" fill="${shade(base, -0.15)}"/></pattern>`;
    case "print":
      return `${open(14)}<path d="M2 9 C 4 3, 9 3, 11 6 C 8 6, 5 8, 2 9 Z" fill="${accent}" opacity="0.85"/><circle cx="11" cy="12" r="1.2" fill="${accent}"/></pattern>`;
  }
}

function hairBack(look: Look): string {
  const c = look.hairColor;
  if (look.hair === "long") return `<path d="M30 44 C 28 70, 34 78, 38 80 L62 80 C 66 78, 72 70, 70 44 Z" fill="${c}"/>`;
  if (look.hair === "afro") return `<circle cx="50" cy="36" r="25" fill="${c}"/>`;
  if (look.hair === "bun") return `<circle cx="50" cy="18" r="8" fill="${c}"/>`;
  return "";
}

function hairFront(look: Look): string {
  const c = look.hairColor;
  switch (look.hair) {
    case "short":
      return `<path d="M33 42 C 32 26, 42 21, 51 22 C 61 22, 69 28, 67 42 C 64 34, 58 31, 50 31 C 42 31, 36 35, 33 42 Z" fill="${c}"/>`;
    case "sidepart":
      return `<path d="M33 43 C 31 25, 45 19, 55 22 C 64 24, 70 31, 67 43 C 63 33, 52 29, 44 33 C 40 35, 36 38, 33 43 Z" fill="${c}"/><path d="M44 24 C 41 29, 40 31, 39 34" stroke="${shade(c, 0.12)}" stroke-width="1.2" fill="none"/>`;
    case "curly":
      return [28, 36, 44, 52, 60, 68, 72]
        .map((x, i) => `<circle cx="${x * 0.86 + 7}" cy="${i % 2 ? 27 : 30}" r="6.5" fill="${c}"/>`)
        .join("");
    case "bun":
    case "long":
      return `<path d="M33 44 C 31 27, 41 21, 50 21 C 60 21, 69 27, 67 44 C 63 33, 56 29, 50 29 C 44 29, 37 33, 33 44 Z" fill="${c}"/>`;
    case "buzz":
      return `<path d="M34 38 C 35 27, 43 23, 50 23 C 58 23, 65 27, 66 38 C 62 32, 56 30, 50 30 C 44 30, 38 32, 34 38 Z" fill="${c}" opacity="0.85"/>`;
    case "afro":
      return `<path d="M33 40 C 34 30, 42 27, 50 27 C 58 27, 66 30, 67 40 C 62 35, 56 33, 50 33 C 44 33, 38 35, 33 40 Z" fill="${c}"/>`;
  }
}

function face(e: Expression): string {
  const ink = "#2b1d14";
  const eyes =
    e === "pleased"
      ? `<path d="M40 47 Q 43 43.5 46 47" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M54 47 Q 57 43.5 60 47" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
      : `<ellipse cx="43" cy="46.5" rx="2" ry="2.4" fill="${ink}"/><ellipse cx="57" cy="46.5" rx="2" ry="2.4" fill="${ink}"/>`;
  const brows =
    e === "dismayed"
      ? `<path d="M39 40 L46 38.5" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/><path d="M61 40 L54 38.5" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`
      : `<path d="M39 40 Q 43 38 47 39.5" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M53 39.5 Q 57 38 61 40" stroke="${ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
  const mouth =
    e === "pleased"
      ? `<path d="M43 55 Q 50 62 57 55 Z" fill="#7a2e22"/><path d="M45 55.6 Q 50 57.5 55 55.6" stroke="#fff" stroke-width="1.2" fill="none"/>`
      : e === "dismayed"
        ? `<path d="M44 59 Q 50 54 56 59" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
        : `<path d="M45 56.5 Q 50 58.5 55 56.5" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  const cheeks = e === "pleased" ? `<circle cx="38.5" cy="53" r="3" fill="#f08c8c" opacity="0.45"/><circle cx="61.5" cy="53" r="3" fill="#f08c8c" opacity="0.45"/>` : "";
  return eyes + brows + mouth + cheeks;
}

/**
 * The avatar as an SVG string. For the cut-out across the 3D table, `cutout` drops the round frame and
 * background, leaving just the person.
 */
export function avatarSvg(look: Look, expression: Expression = "neutral", opts: { cutout?: boolean; size?: number } = {}): string {
  const id = `av${++uid}`;
  const { cutout = false, size = 100 } = opts;
  const skinShade = shade(look.skin, -0.08);
  const glasses = look.glasses
    ? `<g stroke="#20262e" stroke-width="1.6" fill="rgba(255,255,255,0.18)"><rect x="37" y="42" width="11" height="9" rx="3"/><rect x="52" y="42" width="11" height="9" rx="3"/><path d="M48 46 L52 46" fill="none"/></g>`
    : "";
  const cap = look.cap
    ? `<path d="M32 38 C 32 24, 42 19, 50 19 C 59 19, 68 24, 68 38 Z" fill="${look.accent === "#ffffff" ? "#24313f" : look.accent}"/><path d="M50 36 C 60 35, 72 36, 78 39 C 70 41, 58 40, 50 39 Z" fill="${shade(look.accent === "#ffffff" ? "#24313f" : look.accent, -0.12)}"/>`
    : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">`,
    `<defs><clipPath id="${id}c"><circle cx="50" cy="50" r="50"/></clipPath>${pattern(`${id}p`, look.pattern, look.shirt, look.accent)}</defs>`,
    cutout ? `<g>` : `<g clip-path="url(#${id}c)">`,
    cutout ? "" : `<rect width="100" height="100" fill="#f3e3c8"/>`,
    hairBack(look),
    // Shoulders in the shirt, with an open collar.
    `<path d="M8 104 C 10 80, 28 71, 50 71 C 72 71, 90 80, 92 104 Z" fill="url(#${id}p)"/>`,
    `<path d="M8 104 C 10 80, 28 71, 50 71 C 72 71, 90 80, 92 104 Z" fill="none" stroke="${shade(look.shirt, -0.25)}" stroke-width="1.2"/>`,
    `<rect x="44" y="58" width="12" height="15" rx="4" fill="${skinShade}"/>`,
    `<path d="M42 71 L50 82 L58 71" fill="${look.skin}" stroke="${shade(look.shirt, -0.25)}" stroke-width="1.2"/>`,
    // Head.
    `<circle cx="33.5" cy="48" r="4" fill="${skinShade}"/><circle cx="66.5" cy="48" r="4" fill="${skinShade}"/>`,
    `<ellipse cx="50" cy="45" rx="17" ry="19.5" fill="${look.skin}"/>`,
    hairFront(look),
    cap,
    face(expression),
    glasses,
    `</g></svg>`,
  ].join("");
}
