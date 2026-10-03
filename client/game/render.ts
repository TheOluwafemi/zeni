import { COIN_RADIUS, MIN_POWER } from "../../shared/constants";
import { GHOST_MS, type LocalGame } from "./local-game";
import { makeBoardBackground, makeCoinSprite, makeShadowSprite, METAL_COUNT } from "./sprites";
import type { BoardView } from "./view";

const SHADOW_OFFSET = { x: 3, y: 6 };

export class Renderer {
  private generation = -1;
  private background!: HTMLCanvasElement;
  private coinSprites: HTMLCanvasElement[] = [];
  private shadow!: HTMLCanvasElement;

  constructor(private readonly view: BoardView) {}

  private rebuild(): void {
    const { scale, canvas } = this.view;
    this.background = makeBoardBackground(canvas.width, scale);
    this.coinSprites = Array.from({ length: METAL_COUNT }, (_, i) => makeCoinSprite(i, scale));
    this.shadow = makeShadowSprite(scale);
    this.generation = this.view.generation;
  }

  draw(game: LocalGame, now: number): void {
    if (this.generation !== this.view.generation) this.rebuild();
    const { ctx, scale } = this.view;

    this.view.pixelSpace();
    ctx.drawImage(this.background, 0, 0);
    this.view.boardSpace();

    const coins = game.coins();
    const shadowSize = this.shadow.width / scale;
    for (const c of coins) {
      ctx.drawImage(
        this.shadow,
        c.x - shadowSize / 2 + SHADOW_OFFSET.x,
        c.y - shadowSize / 2 + SHADOW_OFFSET.y,
        shadowSize,
        shadowSize,
      );
    }

    for (const c of coins) {
      ctx.globalAlpha = c.dimmed ? 0.45 : 1;
      this.stamp(c.metal, c.x, c.y, c.rotation, 1);
    }
    ctx.globalAlpha = 1;

    for (const g of game.ghosts) {
      const t = Math.min(1, (now - g.start) / GHOST_MS);
      ctx.globalAlpha = 1 - t;
      this.stamp(g.metal, g.x, g.y - 40 * t, g.rotation, 1 + 0.5 * t);
    }
    ctx.globalAlpha = 1;

    if (game.aim) this.drawAim(game);
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
