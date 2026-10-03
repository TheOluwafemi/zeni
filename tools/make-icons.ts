// Renders the app icons from one SVG of the coin.
//
//   npm run icons
//
// Outputs go to public/ and are committed, so a normal build doesn't need sharp.

import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const BG = "#1c120b";

/** The coin on a dark background. `scale` shrinks the coin for maskable icons' safe zone. */
function svg(scale: number, rounded: boolean): string {
  const r = 190 * scale;
  const hole = 52 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="metal" cx="38%" cy="32%" r="75%">
      <stop offset="0" stop-color="#f6dc94"/>
      <stop offset="0.55" stop-color="#c49a45"/>
      <stop offset="1" stop-color="#6b4d16"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="45%" r="60%">
      <stop offset="0" stop-color="#3a2414"/>
      <stop offset="1" stop-color="${BG}"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="${10 * scale}" stdDeviation="${14 * scale}" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <mask id="cut">
      <rect width="512" height="512" fill="#fff"/>
      <rect x="${256 - hole}" y="${256 - hole}" width="${hole * 2}" height="${hole * 2}" fill="#000"/>
    </mask>
  </defs>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="url(#glow)"/>
  <g filter="url(#shadow)" mask="url(#cut)">
    <circle cx="256" cy="256" r="${r}" fill="url(#metal)"/>
    <circle cx="256" cy="256" r="${r * 0.9}" fill="none" stroke="#6b4d16" stroke-opacity="0.6" stroke-width="${9 * scale}"/>
    <circle cx="256" cy="256" r="${r * 0.84}" fill="none" stroke="#f6dc94" stroke-opacity="0.35" stroke-width="${4 * scale}"/>
  </g>
  <rect x="${256 - hole - 8 * scale}" y="${256 - hole - 8 * scale}" width="${(hole + 8 * scale) * 2}" height="${(hole + 8 * scale) * 2}"
        fill="none" stroke="#6b4d16" stroke-opacity="0.65" stroke-width="${8 * scale}"/>
</svg>`;
}

async function png(source: string, size: number, file: string): Promise<void> {
  await sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  console.log(`public/${file.replace(/^public\//, "")}`);
}

await mkdir("public/icons", { recursive: true });
const standard = svg(1, true);
// Maskable icons get cropped to a circle or squircle: keep the artwork in the middle 80%
// and let the background fill the whole square.
const maskable = svg(0.78, false);

await png(standard, 192, "public/icons/icon-192.png");
await png(standard, 512, "public/icons/icon-512.png");
await png(maskable, 512, "public/icons/maskable-512.png");
await png(svg(0.9, false), 180, "public/icons/apple-touch-icon.png"); // iOS rounds the corners itself
await writeFile("public/favicon.svg", standard);
console.log("public/favicon.svg");
