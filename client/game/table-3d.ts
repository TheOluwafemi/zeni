// The 3D table: the same flat game, seen at an angle you can turn, with real light and depth.
//
// Everything is made in code (no models or image files): the walnut top reuses the 2D wood texture,
// the coins are extruded discs with the square hole cut through and v1's coin art on their faces, and
// the cups are spun from a profile line. Aim, power ring and arrows are drawn by the same 2D code as
// the flat view, onto a transparent layer lying on the table.
//
// Board units are world units: board (x, y) is world (x - 500, z = y - 500), and the table top is y = 0.

import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from "three";
import { BOARD_SIZE, COIN_RADIUS, CUP_RADIUS, TABLE_RADIUS } from "../../shared/constants";
import { FALL_MS, type LocalGame } from "./local-game";
import { drawAim, drawForcedRing } from "./overlay";
import { makeCoinSprite, METAL_COUNT } from "./sprites";
import type { TableView } from "./table-view";
import type { Point } from "./view";
import { woodTexture } from "./wood";

const HALF = BOARD_SIZE / 2;
const FLOOR = 0x1c120b;
const COIN_THICK = 5;
/** Height the pointer is projected onto: about the middle of a coin. */
const PICK_Y = 3;

/** Tilted view: how far the camera looks down from the horizontal. */
const TILT = (55 * Math.PI) / 180;
/** Straight down, nearly: exactly 90° would leave the camera without a sense of which way is up. */
const TOP = (89.5 * Math.PI) / 180;
const FOV = 30;
/** The radius that must stay in view: the table, its lip and some room for a coin going over the edge. */
const FIT_RADIUS = TABLE_RADIUS + 70;
/** How quickly the camera eases to where it's going (per second). */
const EASE = 9;

/** The aim layer covers the table and a margin around it, so long pulls and arrows still show. */
const OVERLAY_MARGIN = 220;
const OVERLAY_UNITS = BOARD_SIZE + OVERLAY_MARGIN * 2;
const OVERLAY_PX = 1024;

const VIEW_KEY = "zeni.view";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const toWorld = (x: number, y: number, h = 0) => new Vector3(x - HALF, h, y - HALF);

function radialTexture(inner: string, outer: string, size = 128): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A coin lying flat: a disc with the square hole cut through, bottom at y = 0. */
function coinGeometry(): ExtrudeGeometry {
  const shape = new Shape();
  shape.absarc(0, 0, COIN_RADIUS - 1, 0, Math.PI * 2, false);
  const h = COIN_RADIUS * 0.2; // same hole as the coin art
  const hole = new Shape();
  hole.moveTo(-h, -h);
  hole.lineTo(-h, h);
  hole.lineTo(h, h);
  hole.lineTo(h, -h);
  hole.lineTo(-h, -h);
  shape.holes.push(hole);
  const g = new ExtrudeGeometry(shape, { depth: COIN_THICK - 2, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 2, curveSegments: 40 });
  g.rotateX(-Math.PI / 2); // lie flat: the coin's face points up, its top edge toward the far side of the table
  g.translate(0, 1, 0);
  return g;
}

/** A ceramic cup with tea in it, spun from a profile. Wide at the rim, where coins bounce off it. */
function makeCup(): Group {
  const r = CUP_RADIUS;
  const profile = [
    [0, 0],
    [r * 0.86, 0],
    [r * 0.9, 2],
    [r * 0.93, 6],
    [r * 0.99, 30],
    [r, 44],
    [r * 0.98, 47],
    [r * 0.9, 46],
    [r * 0.88, 42],
    [r * 0.82, 14],
    [0, 12],
  ].map(([x, y]) => new Vector2(x, y));
  const cup = new Group();
  const body = new Mesh(new LatheGeometry(profile, 56), new MeshStandardMaterial({ color: 0xf1ebdd, roughness: 0.32, metalness: 0, side: DoubleSide }));
  // An indigo band below the lip, like a hand-painted cup.
  const band = new Mesh(new TorusGeometry(r * 0.995, 1.6, 8, 56), new MeshStandardMaterial({ color: 0x2c3e6e, roughness: 0.4 }));
  band.rotation.x = Math.PI / 2;
  band.position.y = 38;
  const tea = new Mesh(new CircleGeometry(r * 0.86, 40), new MeshStandardMaterial({ color: 0x6f7a22, roughness: 0.4, metalness: 0 }));
  tea.rotation.x = -Math.PI / 2;
  tea.position.y = 36;
  cup.add(body, band, tea);
  return cup;
}

interface CoinMesh {
  mesh: Mesh;
  face: MeshStandardMaterial;
  edge: MeshStandardMaterial;
  shadow: Mesh;
}

export class Table3D implements TableView {
  readonly element: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 10, 8000);
  private readonly raycaster = new Raycaster();
  private readonly pickPlane = new Plane(new Vector3(0, 1, 0), -PICK_Y);

  private readonly coinGeo = coinGeometry();
  private readonly faceMaps: Texture[];
  private readonly edgeColors: Color[];
  private readonly coins = new Map<number, CoinMesh>();
  private readonly ghosts: CoinMesh[] = [];
  private readonly cups: Group[] = [];
  private readonly cupShadows: Mesh[] = [];
  private readonly shadowTex = radialTexture("rgba(0,0,0,0.55)", "rgba(0,0,0,0)");
  private readonly shadowGeo = new PlaneGeometry(1, 1);

  private readonly overlayCanvas = document.createElement("canvas");
  private readonly overlayTex: CanvasTexture;
  private overlayKey = "";

  private width = 0;
  private height = 0;
  private yaw = 0;
  private yawTarget = 0;
  private elev: number;
  private elevTarget: number;
  private lastDraw = 0;
  private turning: { id: number; x: number } | null = null;

  constructor(container: HTMLElement) {
    this.element = document.createElement("canvas");
    this.element.className = "board-3d";
    this.element.setAttribute("aria-label", "Game table");
    // Throws if WebGL isn't available; the caller keeps the flat view then.
    this.renderer = new WebGLRenderer({ canvas: this.element, antialias: true });
    this.renderer.setClearColor(FLOOR);
    container.append(this.element);

    this.elevTarget = this.elev = this.topDown ? TOP : TILT;

    // Light: a warm key from the top-left (where the 2D sheen comes from) and a soft room fill.
    this.scene.add(new HemisphereLight(0xfff3e0, 0x3a2414, 1.6));
    const key = new DirectionalLight(0xffe3bd, 2.2);
    key.position.set(-500, 1100, -450);
    this.scene.add(key);

    this.buildTable();

    // Coin faces: v1's coin art, one texture per metal, placed so it lines up with the cut hole.
    const spriteScale = 4;
    this.faceMaps = Array.from({ length: METAL_COUNT }, (_, i) => {
      const sprite = makeCoinSprite(i, spriteScale);
      const t = new CanvasTexture(sprite);
      t.colorSpace = SRGBColorSpace;
      const span = sprite.width / spriteScale; // board units the sprite covers
      t.repeat.set(1 / span, 1 / span);
      t.offset.set(0.5, 0.5);
      t.anisotropy = 4;
      return t;
    });
    this.edgeColors = ["#8a5528", "#9a7632", "#6b5034"].map((c) => new Color(c));

    // The aim layer.
    this.overlayCanvas.width = this.overlayCanvas.height = OVERLAY_PX;
    this.overlayTex = new CanvasTexture(this.overlayCanvas);
    this.overlayTex.colorSpace = SRGBColorSpace;
    const overlay = new Mesh(
      new PlaneGeometry(OVERLAY_UNITS, OVERLAY_UNITS),
      new MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthTest: false, depthWrite: false }),
    );
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.y = COIN_THICK + 1;
    overlay.renderOrder = 10; // always on top, as in the flat view
    this.scene.add(overlay);
  }

  private buildTable(): void {
    const wood = new CanvasTexture(woodTexture());
    wood.colorSpace = SRGBColorSpace;
    wood.anisotropy = 8;
    const top = new MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0 });
    const side = new MeshStandardMaterial({ color: 0x3b2213, roughness: 0.6 });
    const slab = new Mesh(new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS - 8, 34, 120), [side, top, side]);
    slab.position.y = -17;
    // A rounded-over lip around the top.
    const lip = new Mesh(new TorusGeometry(TABLE_RADIUS - 3, 4, 10, 120), new MeshStandardMaterial({ color: 0x5a3519, roughness: 0.45 }));
    lip.rotation.x = Math.PI / 2;
    lip.position.y = -3;
    const pedestal = new Mesh(new CylinderGeometry(70, 150, 420, 48), side);
    pedestal.position.y = -244;

    // The table's shadow on the floor, which is the same colour as the page.
    const floorShadow = new Mesh(
      new PlaneGeometry(TABLE_RADIUS * 3, TABLE_RADIUS * 3),
      new MeshBasicMaterial({ map: radialTexture("rgba(0,0,0,0.75)", "rgba(0,0,0,0)"), transparent: true, depthWrite: false }),
    );
    floorShadow.rotation.x = -Math.PI / 2;
    floorShadow.position.y = -454;
    this.scene.add(slab, lip, pedestal, floorShadow);
  }

  // --- The view ---------------------------------------------------------------

  get topDown(): boolean {
    try {
      return localStorage.getItem(VIEW_KEY) === "top";
    } catch {
      return false;
    }
  }

  /** Switch between the tilted view and looking straight down. Remembered on this device. */
  setTopDown(on: boolean): void {
    try {
      localStorage.setItem(VIEW_KEY, on ? "top" : "tilt");
    } catch {
      // Private mode: it just isn't remembered.
    }
    this.elevTarget = on ? TOP : TILT;
    if (reducedMotion()) this.elev = this.elevTarget;
  }

  /** Turn so this side of the table faces the player (radians; 0 is the near side of the board). */
  faceSide(yaw: number): void {
    this.yawTarget = yaw;
    if (reducedMotion()) this.yaw = yaw;
  }

  resize(): boolean {
    const parent = this.element.parentElement;
    if (!parent) return false;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === this.width && h === this.height) return false;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    return true;
  }

  moving(): boolean {
    return this.turning !== null || Math.abs(this.elev - this.elevTarget) > 1e-4 || Math.abs(this.yaw - this.yawTarget) > 1e-4;
  }

  private placeCamera(dt: number): void {
    const k = 1 - Math.exp(-EASE * dt);
    this.elev += (this.elevTarget - this.elev) * k;
    this.yaw += (this.yawTarget - this.yaw) * k;
    if (Math.abs(this.elev - this.elevTarget) < 1e-4) this.elev = this.elevTarget;
    if (Math.abs(this.yaw - this.yawTarget) < 1e-4) this.yaw = this.yawTarget;

    // Far enough back that the whole table fits, whichever way the screen is shaped.
    const v = (FOV * Math.PI) / 180 / 2;
    const hHalf = Math.atan(Math.tan(v) * this.camera.aspect);
    // The table is a flat disc: from above it must fit both ways; tilted, it's shorter on screen, so
    // only the width limits it, and the margin in FIT_RADIUS is more than enough, so come in a little.
    const across = Math.tan(hHalf);
    const down = Math.tan(v) / Math.max(Math.sin(this.elev), 0.01);
    const d = (FIT_RADIUS * (1 - 0.13 * Math.cos(this.elev))) / Math.min(across, down);
    const flat = d * Math.cos(this.elev);
    this.camera.position.set(flat * Math.sin(this.yaw), d * Math.sin(this.elev), flat * Math.cos(this.yaw));
    this.camera.lookAt(0, 0, 0);
  }

  beginTurn(e: PointerEvent): boolean {
    if (this.turning) return false;
    this.turning = { id: e.pointerId, x: e.clientX };
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; turning still works while over the table.
    }
    const move = (ev: PointerEvent) => {
      if (!this.turning || ev.pointerId !== this.turning.id) return;
      const dx = ev.clientX - this.turning.x;
      this.turning.x = ev.clientX;
      // Drag the table round under your finger: right turns it clockwise as seen from above.
      this.yawTarget -= (dx / Math.max(1, this.width)) * Math.PI * 1.2;
      this.yaw = this.yawTarget;
    };
    const end = (ev: PointerEvent) => {
      if (!this.turning || ev.pointerId !== this.turning.id) return;
      this.turning = null;
      this.element.removeEventListener("pointermove", move);
      this.element.removeEventListener("pointerup", end);
      this.element.removeEventListener("pointercancel", end);
    };
    this.element.addEventListener("pointermove", move);
    this.element.addEventListener("pointerup", end);
    this.element.addEventListener("pointercancel", end);
    return true;
  }

  // --- Between the screen and the table -----------------------------------------

  toBoard(clientX: number, clientY: number): Point | null {
    const rect = this.element.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.pickPlane, new Vector3());
    return hit ? { x: hit.x + HALF, y: hit.z + HALF } : null;
  }

  toClient(x: number, y: number): Point {
    const rect = this.element.getBoundingClientRect();
    const p = toWorld(x, y, PICK_Y).project(this.camera);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  cssScale(x: number, y: number): number {
    const a = this.toClient(x - 10, y);
    const b = this.toClient(x + 10, y);
    const c = this.toClient(x, y - 10);
    const d = this.toClient(x, y + 10);
    return (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(d.x - c.x, d.y - c.y)) / 40;
  }

  // --- Drawing ------------------------------------------------------------------

  draw(game: LocalGame, now: number): void {
    const dt = this.lastDraw ? Math.min(0.1, (now - this.lastDraw) / 1000) : 0;
    this.lastDraw = now;
    this.placeCamera(dt);
    this.syncCups(game);
    this.syncCoins(game);
    this.syncGhosts(game, now);
    this.drawOverlay(game);
    this.renderer.render(this.scene, this.camera);
  }

  private newCoin(metal: number, ghost: boolean): CoinMesh {
    const face = new MeshStandardMaterial({ map: this.faceMaps[metal % METAL_COUNT], roughness: 0.42, metalness: 0.35, transparent: ghost });
    const edge = new MeshStandardMaterial({ color: this.edgeColors[metal % METAL_COUNT], roughness: 0.38, metalness: 0.55, transparent: ghost });
    const mesh = new Mesh(this.coinGeo, [face, edge]);
    const shadow = this.blob(COIN_RADIUS);
    this.scene.add(mesh, shadow);
    return { mesh, face, edge, shadow };
  }

  private blob(radius: number): Mesh {
    const m = new Mesh(this.shadowGeo, new MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(radius * 2.7, radius * 2.7, 1);
    return m;
  }

  private syncCoins(game: LocalGame): void {
    const seen = new Set<number>();
    for (const c of game.coins()) {
      seen.add(c.id);
      let cm = this.coins.get(c.id);
      if (!cm || cm.face.map !== this.faceMaps[c.metal % METAL_COUNT]) {
        if (cm) this.removeCoin(cm);
        cm = this.newCoin(c.metal, false);
        this.coins.set(c.id, cm);
      }
      cm.mesh.position.copy(toWorld(c.x, c.y));
      cm.mesh.rotation.y = -c.rotation;
      // Coins that can't be shot right now are shown darker, as in the flat view.
      const shade = c.dimmed ? 0.5 : 1;
      cm.face.color.setScalar(shade);
      cm.edge.color.copy(this.edgeColors[c.metal % METAL_COUNT]).multiplyScalar(shade);
      cm.shadow.position.copy(toWorld(c.x + 3, c.y + 6, 0.3));
    }
    for (const [id, cm] of this.coins) {
      if (!seen.has(id)) {
        this.removeCoin(cm);
        this.coins.delete(id);
      }
    }
  }

  private removeCoin(cm: CoinMesh): void {
    this.scene.remove(cm.mesh, cm.shadow);
    cm.face.dispose();
    cm.edge.dispose();
    (cm.shadow.material as Material).dispose();
  }

  /** Coins going over the edge: they slide on, tip over the lip and drop away. */
  private syncGhosts(game: LocalGame, now: number): void {
    while (this.ghosts.length > game.ghosts.length) this.removeCoin(this.ghosts.pop()!);
    game.ghosts.forEach((g, i) => {
      let cm = this.ghosts[i];
      if (!cm || cm.face.map !== this.faceMaps[g.metal % METAL_COUNT]) {
        if (cm) this.removeCoin(cm);
        cm = this.newCoin(g.metal, true);
        this.ghosts[i] = cm;
      }
      const t = Math.min(1, (now - g.start) / FALL_MS);
      const s = (t * FALL_MS) / 1000;
      const x = g.x + g.vx * s * 0.5;
      const y = g.y + g.vy * s * 0.5;
      cm.mesh.position.copy(toWorld(x, y, -260 * t * t));
      // Tip over, away from the table's centre.
      const out = Math.atan2(y - HALF, x - HALF);
      cm.mesh.rotation.set(0, -g.rotation, 0);
      cm.mesh.rotateOnWorldAxis(new Vector3(-Math.sin(out), 0, Math.cos(out)), -t * 2.2);
      cm.face.opacity = cm.edge.opacity = 1 - t;
      cm.shadow.visible = false;
    });
  }

  private syncCups(game: LocalGame): void {
    const cups = game.state.cups;
    while (this.cups.length < cups.length) {
      const cup = makeCup();
      const shadow = this.blob(CUP_RADIUS * 1.1);
      this.cups.push(cup);
      this.cupShadows.push(shadow);
      this.scene.add(cup, shadow);
    }
    this.cups.forEach((cup, i) => {
      const c = cups[i];
      cup.visible = this.cupShadows[i].visible = !!c;
      if (!c) return;
      cup.position.copy(toWorld(c.x, c.y));
      this.cupShadows[i].position.copy(toWorld(c.x + 6, c.y + 12, 0.2));
    });
  }

  /** Aim, power ring, arrows and the forced-coin ring, drawn by the flat view's code onto the table. */
  private drawOverlay(game: LocalGame): void {
    const forced = game.aim ? null : game.forcedCoin;
    const fc = forced === null ? undefined : game.coins().find((c) => c.id === forced);
    const aims = [
      [game.remoteAim, true],
      [game.aim, false],
    ] as const;
    const key = JSON.stringify([fc && [fc.x, fc.y], game.remoteAim, game.aim]);
    if (key === this.overlayKey) return;
    this.overlayKey = key;

    const g = this.overlayCanvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, OVERLAY_PX, OVERLAY_PX);
    const s = OVERLAY_PX / OVERLAY_UNITS;
    g.setTransform(s, 0, 0, s, OVERLAY_MARGIN * s, OVERLAY_MARGIN * s);
    if (fc) drawForcedRing(g, fc);
    for (const [aim, theirs] of aims) {
      const c = aim && game.coinPosition(aim.coinId);
      if (aim && c) drawAim(g, c, aim, theirs);
    }
    this.overlayTex.needsUpdate = true;
  }

  dispose(): void {
    this.renderer.dispose();
    this.element.remove();
  }
}
