// A way of showing the table. The game, its rules and its physics are flat; only the drawing differs.
//   FlatView: the original top-down canvas. Shown while the 3D view loads, and if WebGL isn't available.
//   Table3D (table-3d.ts): a tilted table you can turn, with real light and depth.

import type { Expression, Look } from "../../shared/avatar";
import type { LocalGame } from "./local-game";
import { Renderer } from "./render";
import { BoardView, type Point } from "./view";

export interface TableView {
  /** The canvas this view draws into. */
  readonly element: HTMLCanvasElement;
  /** Match the container's size. True if anything changed (so draw again). */
  resize(): boolean;
  draw(game: LocalGame, now: number): void;
  /** A screen point to board units, or null if it isn't over the table's plane. */
  toBoard(clientX: number, clientY: number): Point | null;
  /** Board units to a screen point, for DOM effects over the table. */
  toClient(x: number, y: number): Point;
  /** Screen pixels per board unit around a board point. */
  cssScale(x: number, y: number): number;
  /** Start turning the table with this pointer, if the view can turn. */
  beginTurn(e: PointerEvent): boolean;
  /** Something is still moving by itself (the camera easing), so keep drawing. */
  moving(): boolean;
  /** Who sits across the table (null for nobody), their face, and whether it's their turn. */
  setOpponent(look: Look | null, face: Expression, theirTurn: boolean): void;
  /** Stop drawing for good (the view is being replaced). */
  dispose(): void;
}

export class FlatView implements TableView {
  private readonly board: BoardView;
  private readonly renderer: Renderer;

  constructor(
    readonly element: HTMLCanvasElement,
    container: HTMLElement,
  ) {
    this.board = new BoardView(element, container);
    this.renderer = new Renderer(this.board);
  }

  resize(): boolean {
    return this.board.resize();
  }
  draw(game: LocalGame, now: number): void {
    this.renderer.draw(game, now);
  }
  toBoard(clientX: number, clientY: number): Point {
    return this.board.toBoard(clientX, clientY);
  }
  toClient(x: number, y: number): Point {
    return this.board.toClient(x, y);
  }
  cssScale(): number {
    return this.board.cssScale();
  }
  beginTurn(): boolean {
    return false;
  }
  moving(): boolean {
    return false;
  }
  setOpponent(): void {}
  dispose(): void {}
}
