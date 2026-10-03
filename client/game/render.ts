import { COIN_RADIUS, CUP_RADIUS, MIN_POWER } from "../../shared/constants";
import { GHOST_MS, type Ghost, type LocalGame } from "./local-game";
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

    if (game.aim) this.drawAim(game);
  }

  private drawGhost(g: Ghost, now: number): void {
    const { ctx } = this.view;
    const t = Math.min(1, (now - g.start) / GHOST_MS[g.kind]);
    if (g.kind === "capture") {
      // Lifts off the table into the player's tray.
      ctx.globalAlpha = 1 - t;
      this.stamp(g.metal, g.x, g.y - 40 * t, g.rotation, 1 + 0.5 * t);
      return;
    }
    // Tips over the edge and drops to the floor: keeps sliding, falls away and fades.
    const s = (t * GHOST_MS.fall) / 1000;
    const x = g.x + g.vx * s * 0.5;
    const y = g.y + g.vy * s * 0.5 + 120 * t * t;
    ctx.globalAlpha = 1 - t;
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

  private drawAim(game: LocalGame): void {
    const aim = game.aim!;
    const c = game.coinPosition(aim.coinId);
    if (!c) return;
    const { ctx } = this.view;
    const live = aim.power >= MIN_POWER;

    // Rubber band from the coin to the finger.
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 240, 220, 0.22)";
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

    const color = powerColor(aim.power);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(c.x, c.y, ringR, -Math.PI / 2, -Math.PI / 2 + aim.power * Math.PI * 2);
    ctx.stroke();

    // Direction: a short dashed line. Deliberately not a full trajectory preview.
    const dx = Math.cos(aim.angle);
    const dy = Math.sin(aim.angle);
    const start = ringR + 8;
    const end = start + 50 + aim.power * 260;
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255, 248, 235, 0.85)";
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

function powerColor(p: number): string {
  return `hsl(${45 - 45 * p} 92% ${62 - 10 * p}%)`;
}
