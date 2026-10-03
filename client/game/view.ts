import { BOARD_SIZE } from "../../shared/constants";

/** Width of the wooden rim drawn around the play area, in board units. */
export const RIM = 32;
const VIEW_SIZE = BOARD_SIZE + RIM * 2;

export interface Point {
  x: number;
  y: number;
}

/** Owns the canvas and maps between screen pixels and board units. */
export class BoardView {
  readonly ctx: CanvasRenderingContext2D;
  /** Device pixels per board unit. */
  scale = 1;
  /** Bumped on every resize so cached sprites know to rebuild. */
  generation = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): boolean {
    const cssSize = Math.floor(Math.min(this.container.clientWidth, this.container.clientHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.max(1, Math.round(cssSize * dpr));
    if (px === this.canvas.width) return false;

    this.canvas.style.width = `${cssSize}px`;
    this.canvas.style.height = `${cssSize}px`;
    this.canvas.width = px;
    this.canvas.height = px;
    this.scale = px / VIEW_SIZE;
    this.generation++;
    return true;
  }

  /** Screen point (clientX/clientY) to board units. */
  toBoard(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_SIZE - RIM,
      y: ((clientY - rect.top) / rect.height) * VIEW_SIZE - RIM,
    };
  }

  /** Draw in raw device pixels (for the cached background). */
  pixelSpace(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Draw in board units, with (0, 0) at the play area's top-left corner. */
  boardSpace(): void {
    const s = this.scale;
    this.ctx.setTransform(s, 0, 0, s, RIM * s, RIM * s);
  }
}
