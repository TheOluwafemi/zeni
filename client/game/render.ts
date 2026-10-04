import { COIN_RADIUS, CUP_RADIUS, MIN_POWER } from "../../shared/constants";
import { FALL_MS, type Aim, type Ghost, type LocalGame } from "./local-game";
import { makeBoardBackground, makeCoinSprite, makeCupSprite, makeShadowSprite, METAL_COUNT } from "./sprites";
import type { BoardView } from "./view";

const SHADOW_OFFSET = { x: 3, y: 6 };

export class Renderer {
  private generation = -1;
  private background!: HTMLCanvasElement;
  private coinSprites: HTMLCanvasElement[] = [];
  private cup!: HTMLCanvasElement;
  private coinShadow!: HTMLCanvasElement;
  private cupShadow!: HTMLCanvasElement;

  constructor(private readonly view: BoardView) {}

  private rebuild(): void {
    const { scale, canvas } = this.view;
    this.background = makeBoardBackground(canvas.width, scale);
    this.coinSprites = Array.from({ length: METAL_COUNT }, (_, i) => makeCoinSprite(i, scale));
    this.cup = makeCupSprite(scale);
    this.coinShadow = makeShadowSprite(COIN_RADIUS, scale);
    this.cupShadow = makeShadowSprite(CUP_RADIUS, scale);
    this.generation = this.view.generation;
  }

  draw(game: LocalGame, now: number): void {
    if (this.generation !== this.view.generation) this.rebuild();
    const { ctx } = this.view;

    this.view.pixelSpace();
    ctx.drawImage(this.background, 0, 0);
    this.view.boardSpace();

    const coins = game.coins();
    const cups = game.state.cups;
    for (const cup of cups) this.centered(this.cupShadow, cup.x + SHADOW_OFFSET.x * 2, cup.y + SHADOW_OFFSET.y * 2);
    for (const c of coins) this.centered(this.coinShadow, c.x + SHADOW_OFFSET.x, c.y + SHADOW_OFFSET.y);
    for (const cup of cups) this.centered(this.cup, cup.x, cup.y);

    for (const c of coins) {
      ctx.globalAlpha = c.dimmed ? 0.45 : 1;
      this.stamp(c.metal, c.x, c.y, c.rotation, 1);
    }
    ctx.globalAlpha = 1;

    // During a run, ring the coin that must be shot next.
    const forced = game.aim ? null : game.forcedCoin;
    const fc = forced === null ? undefined : coins.find((c) => c.id === forced);
    if (fc) {
      ctx.strokeStyle = "rgba(232, 184, 90, 0.9)";
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, COIN_RADIUS + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const g of game.ghosts) this.drawGhost(g, now);
    ctx.globalAlpha = 1;

    if (game.remoteAim) this.drawAim(game, game.remoteAim, true);
    if (game.aim) this.drawAim(game, game.aim, false);
  }

  /** A coin tipping over the edge: keeps sliding, drops away and fades. */
  private drawGhost(g: Ghost, now: number): void {
    const t = Math.min(1, (now - g.start) / FALL_MS);
    const s = (t * FALL_MS) / 1000;
    const x = g.x + g.vx * s * 0.5;
    const y = g.y + g.vy * s * 0.5 + 120 * t * t;
    this.view.ctx.globalAlpha = 1 - t;
    this.stamp(g.metal, x, y, g.rotation + t * 2, 1 - 0.45 * t);
  }

  private centered(sprite: HTMLCanvasElement, x: number, y: number): void {
    const size = sprite.width / this.view.scale;
    this.view.ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  private stamp(metal: number, x: number, y: number, rotation: number, zoom: number): void {
    const { ctx, scale } = this.view;
    const sprite = this.coinSprites[metal];
    const size = (sprite.width / scale) * zoom;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  /** `theirs`: the other player's live aim, in their colour with a dashed ring (a shape cue, not just colour). */
  private drawAim(game: LocalGame, aim: Aim, theirs: boolean): void {
    const c = game.coinPosition(aim.coinId);
    if (!c) return;
    const { ctx } = this.view;
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
}

/** The other player's aim. Stands in for their shirt colour until avatars arrive. */
const OPPONENT_COLOR = "#6cc8e0";
const OPPONENT_BAND = "rgba(108, 200, 224, 0.3)";

function powerColor(p: number): string {
  return `hsl(${45 - 45 * p} 92% ${62 - 10 * p}%)`;
}
