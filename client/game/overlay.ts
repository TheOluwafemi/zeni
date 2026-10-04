// What's drawn on top of the table in board units: the aim (rubber band, power ring, arrow) and the
// ring around a coin that must be shot. Shared by the 2D view and the 3D view, which paints it onto a
// transparent layer lying on the table.

import { COIN_RADIUS, MIN_POWER } from "../../shared/constants";
import type { Aim } from "./local-game";
import type { Point } from "./view";

/** During a run, the coin that must be shot next. */
export function drawForcedRing(ctx: CanvasRenderingContext2D, c: Point): void {
  ctx.strokeStyle = "rgba(232, 184, 90, 0.9)";
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(c.x, c.y, COIN_RADIUS + 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** `theirs`: the other player's live aim, in their colour with a dashed ring (a shape cue, not just colour). */
export function drawAim(ctx: CanvasRenderingContext2D, c: Point, aim: Aim, theirs: boolean): void {
  const live = aim.power >= MIN_POWER;

  // Rubber band from the coin to the finger.
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.strokeStyle = theirs ? OPPONENT_BAND : "rgba(255, 240, 220, 0.22)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(aim.pointer.x, aim.pointer.y);
  ctx.stroke();

  // Power ring around the coin.
  const ringR = COIN_RADIUS + 10;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.beginPath();
  ctx.arc(c.x, c.y, ringR, 0, Math.PI * 2);
  ctx.stroke();
  if (!live) return;

  const color = theirs ? OPPONENT_COLOR : powerColor(aim.power);
  ctx.strokeStyle = color;
  if (theirs) ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.arc(c.x, c.y, ringR, -Math.PI / 2, -Math.PI / 2 + aim.power * Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Direction: a short dashed line. Deliberately not a full trajectory preview.
  const dx = Math.cos(aim.angle);
  const dy = Math.sin(aim.angle);
  const start = ringR + 8;
  const end = start + 50 + aim.power * 260;
  ctx.setLineDash([14, 10]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = theirs ? OPPONENT_COLOR : "rgba(255, 248, 235, 0.85)";
  ctx.beginPath();
  ctx.moveTo(c.x + dx * start, c.y + dy * start);
  ctx.lineTo(c.x + dx * end, c.y + dy * end);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead.
  const tipX = c.x + dx * (end + 14);
  const tipY = c.y + dy * (end + 14);
  const px = -dy;
  const py = dx;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - dx * 20 + px * 11, tipY - dy * 20 + py * 11);
  ctx.lineTo(tipX - dx * 20 - px * 11, tipY - dy * 20 - py * 11);
  ctx.closePath();
  ctx.fill();
}

/** The other player's aim. Stands in for their shirt colour until avatars arrive. */
const OPPONENT_COLOR = "#6cc8e0";
const OPPONENT_BAND = "rgba(108, 200, 224, 0.3)";

function powerColor(p: number): string {
  return `hsl(${45 - 45 * p} 92% ${62 - 10 * p}%)`;
}
