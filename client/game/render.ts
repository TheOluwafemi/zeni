import { COIN_RADIUS, CUP_RADIUS } from "../../shared/constants";
import { FALL_MS, type Ghost, type LocalGame } from "./local-game";
import { drawAim, drawForcedRing } from "./overlay";
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
    if (fc) drawForcedRing(ctx, fc);

    for (const g of game.ghosts) this.drawGhost(g, now);
    ctx.globalAlpha = 1;

    for (const [aim, theirs] of [[game.remoteAim, true], [game.aim, false]] as const) {
      const c = aim && game.coinPosition(aim.coinId);
      if (aim && c) drawAim(ctx, c, aim, theirs);
    }
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
}
