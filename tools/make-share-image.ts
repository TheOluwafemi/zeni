// Renders the 1200x630 picture shown when a link to the game is shared in chat or on social media.
//
//   npm run share-image
//
// The result (public/og.png) is committed, so a normal build doesn't need sharp or any fonts.

import sharp from "sharp";

const W = 1200;
const H = 630;

// A mon coin: gold body with a square hole, drawn the same way as the app icon.
const coin = (cx: number, cy: number, r: number) => {
  const hole = r * 0.27;
  return `
  <g filter="url(#drop)">
    <mask id="cut"><rect width="${W}" height="${H}" fill="#fff"/><rect x="${cx - hole}" y="${cy - hole}" width="${hole * 2}" height="${hole * 2}" fill="#000"/></mask>
    <g mask="url(#cut)">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#metal)"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 0.9}" fill="none" stroke="#6b4d16" stroke-opacity="0.6" stroke-width="${r * 0.045}"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 0.84}" fill="none" stroke="#f6dc94" stroke-opacity="0.35" stroke-width="${r * 0.02}"/>
    </g>
    <rect x="${cx - hole - r * 0.04}" y="${cy - hole - r * 0.04}" width="${(hole + r * 0.04) * 2}" height="${(hole + r * 0.04) * 2}" fill="none" stroke="#6b4d16" stroke-opacity="0.65" stroke-width="${r * 0.04}"/>
  </g>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a2414"/>
      <stop offset="1" stop-color="#1c120b"/>
    </linearGradient>
    <radialGradient id="metal" cx="38%" cy="32%" r="75%">
      <stop offset="0" stop-color="#f6dc94"/>
      <stop offset="0.55" stop-color="#c49a45"/>
      <stop offset="1" stop-color="#6b4d16"/>
    </radialGradient>
    <radialGradient id="table" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#8a5a36"/>
      <stop offset="1" stop-color="#4a2c19"/>
    </radialGradient>
    <filter id="drop" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <clipPath id="frame"><rect width="${W}" height="${H}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wood)"/>
  <g clip-path="url(#frame)">
    <!-- the round table, running off the left edge -->
    <circle cx="300" cy="330" r="430" fill="url(#table)"/>
    <circle cx="300" cy="330" r="430" fill="none" stroke="#f0c890" stroke-opacity="0.18" stroke-width="5"/>
    ${[...Array(9)].map((_, i) => `<path d="M-120 ${130 + i * 62} C 120 ${100 + i * 62}, 380 ${160 + i * 62}, 720 ${120 + i * 62}" fill="none" stroke="#2a160a" stroke-opacity="0.16" stroke-width="${2 + (i % 3)}"/>`).join("")}
    <!-- a few coins scattered on it -->
    ${coin(430, 360, 118)}
    ${coin(215, 215, 70)}
    ${coin(250, 470, 64)}
    ${coin(95, 335, 48)}
  </g>
  <text x="660" y="330" font-family="Georgia, 'Times New Roman', serif" font-size="190" font-weight="600" letter-spacing="14" fill="#f3e6d3">Zeni</text>
  <text x="668" y="400" font-family="Georgia, 'Times New Roman', serif" font-size="46" fill="#e8b85a">Flick the coins.</text>
  <text x="668" y="462" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#b39a7e">Hit exactly one to keep it.</text>
  <text x="668" y="506" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#b39a7e">Play online or the computer.</text>
  <text x="668" y="575" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#8a7a64">Free · No sign-up email</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile("public/og.png");
console.log("public/og.png");
