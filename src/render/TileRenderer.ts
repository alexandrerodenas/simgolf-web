/**
 * TileRenderer — rendu isométrique du terrain
 *
 * Chaque tuile est un diamond (losange) coloré selon son type.
 * Utilise un Canvas 2D pour le rendu avec un tri painter's algorithm.
 *
 * Palette Parkland — inspirée des matériaux du jeu original :
 *   ambiante verte, diffuse douce, direction lumière NO.
 */

import Phaser from 'phaser';
import { TileType, Tile, TerrainData } from '../core/types';
import { TILE_W, TILE_H, HEIGHT_SCALE, mapToScreen } from './CoordinateSystem';

// ================================================================
// Palette Parkland (couleurs de base par type)
// ================================================================

const PALETTE: Record<TileType, string> = {
  [TileType.Rough]:        '#3a7d3a',
  [TileType.Fairway]:      '#4ea64e',
  [TileType.Green]:        '#2ecc40',
  [TileType.SandBunker]:   '#e8d5a0',
  [TileType.WaterShallow]: '#3388cc',
  [TileType.WaterMiddle]:  '#2277bb',
  [TileType.WaterDeep]:    '#1166aa',
  [TileType.DeepRough]:    '#2d5a1e',
  [TileType.GrassySand]:   '#c8b878',
  [TileType.GrassBunker]:  '#dcc890',
  [TileType.Tee]:          '#5cb85c',
  [TileType.Cliff]:        '#887766',
  [TileType.Path]:         '#c8b898',
  [TileType.Building]:     '#996644',
  [TileType.Tree]:         '#2d5a1e',
  [TileType.Flower]:       '#cc4488',
};

function pal(t: TileType): string {
  return PALETTE[t] ?? '#4a8f4a';
}

// ================================================================
// Utilitaires
// ================================================================

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Assombrit une couleur hex */
function darken(hex: string, f: number): string {
  const r = clamp(Math.round(parseInt(hex.slice(1, 3), 16) * (1 - f)), 0, 255);
  const g = clamp(Math.round(parseInt(hex.slice(3, 5), 16) * (1 - f)), 0, 255);
  const b = clamp(Math.round(parseInt(hex.slice(5, 7), 16) * (1 - f)), 0, 255);
  return `rgb(${r},${g},${b})`;
}

/** Éclaircit une couleur hex */
function lighten(hex: string, f: number): string {
  const r = clamp(Math.round(parseInt(hex.slice(1, 3), 16) * (1 + f)), 0, 255);
  const g = clamp(Math.round(parseInt(hex.slice(3, 5), 16) * (1 + f)), 0, 255);
  const b = clamp(Math.round(parseInt(hex.slice(5, 7), 16) * (1 + f)), 0, 255);
  return `rgb(${r},${g},${b})`;
}

// ================================================================
// Éclairage directionnel (soleil Nord-Ouest)
// ================================================================

const LIGHT_DIR: [number, number, number] = [-0.409, -0.613, 0.707];
const MIN_BRIGHTNESS = 0.65;
const STEP = 2; // pas pour le calcul des normales

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vertexBrightness(tiles: Tile[], w: number, vx: number, vy: number): number {
  const idx = (vy * w + vx);
  const getH = (x: number, y: number): number => {
    if (x < 0 || x >= w || y < 0 || y >= Math.ceil(tiles.length / w)) return 0;
    return tiles[y * w + x].elevation[0]; // approximation : coin TL
  };
  const hL = getH(vx - 1, vy);
  const hR = getH(vx + 1, vy);
  const hU = getH(vx, vy - 1);
  const hD = getH(vx, vy + 1);
  const dx: [number, number, number] = [STEP, 0, hR - hL];
  const dy: [number, number, number] = [0, STEP, hU - hD];
  const n = normalize(cross(dx, dy));
  const d = dot(n, LIGHT_DIR);
  return MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * (d + 1) / 2;
}

// ================================================================
// TileRenderer
// ================================================================

export class TileRenderer {
  private scene: Phaser.Scene;
  private image: Phaser.GameObjects.Image | null = null;
  private canvasKey = 'terrain_canvas';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  render(data: TerrainData): void {
    this.clear();

    const { width: w, height: h, tiles } = data;

    // ---- 1. Projeter tous les sommets ----
    const origins = tiles.map(t => {
      const [hTL, , , ] = t.elevation;
      return mapToScreen(t.x, t.y, t.elevation[0]);
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const quadVerts = tiles.map(t => {
      const [hTL, hTR, hBR, hBL] = t.elevation;
      const pTL = mapToScreen(t.x,     t.y,     hTL);
      const pTR = mapToScreen(t.x + 1, t.y,     hTR);
      const pBR = mapToScreen(t.x + 1, t.y + 1, hBR);
      const pBL = mapToScreen(t.x,     t.y + 1, hBL);
      for (const p of [pTL, pTR, pBR, pBL]) {
        if (p.screenX < minX) minX = p.screenX;
        if (p.screenY < minY) minY = p.screenY;
        if (p.screenX > maxX) maxX = p.screenX;
        if (p.screenY > maxY) maxY = p.screenY;
      }
      return { type: t.type, pTL, pTR, pBR, pBL, idx: t.y * w + t.x };
    });

    // ---- 2. Tri painter's ----
    quadVerts.sort((a, b) => {
      const da = (a.idx % w) + Math.floor(a.idx / w);
      const db = (b.idx % w) + Math.floor(b.idx / w);
      return da - db;
    });

    // ---- 3. Canvas ----
    const margin = 2;
    const cw = Math.ceil(maxX - minX) + margin * 2;
    const ch = Math.ceil(maxY - minY) + margin * 2;
    if (cw <= 0 || ch <= 0) return;

    const ox = minX - margin;
    const oy = minY - margin;

    const canvas = this.scene.textures.createCanvas(this.canvasKey, cw, ch);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(-ox, -oy);

    // ---- 4. Dessiner les quads ----
    for (const q of quadVerts) {
      const { pTL, pTR, pBR, pBL } = q;
      const baseColor = pal(q.type);
      const vari = 1 + ((q.idx * 31 + Math.floor(q.idx / w) * 17) % 5);

      // Dégradé diagonal pour le relief
      const grad = ctx.createLinearGradient(pTL.screenX, pTL.screenY, pBR.screenX, pBR.screenY);
      grad.addColorStop(0, lighten(baseColor, 0.12 + vari * 0.01));
      grad.addColorStop(0.5, baseColor);
      grad.addColorStop(1, darken(baseColor, 0.15));

      ctx.fillStyle = grad;
      this.fillQuad(ctx, pTL, pTR, pBR, pBL);
    }

    // ---- 5. Lightmap (Gouraud) ----
    this.renderLightmap(ctx, cw, ch, ox, oy, tiles, w, h);

    canvas.refresh();

    // ---- 6. Image Phaser ----
    this.image = this.scene.add.image(ox, oy, this.canvasKey);
    this.image.setOrigin(0, 0);
    this.image.setDepth(0);
  }

  private renderLightmap(
    ctx: CanvasRenderingContext2D,
    cw: number, ch: number,
    ox: number, oy: number,
    tiles: Tile[], w: number, h: number,
  ): void {
    const subdiv = 4;
    const lmCanvas = document.createElement('canvas');
    lmCanvas.width = cw;
    lmCanvas.height = ch;
    const lctx = lmCanvas.getContext('2d')!;
    lctx.fillStyle = '#ffffff';
    lctx.fillRect(0, 0, cw, ch);
    lctx.translate(-ox, -oy);

    for (const tile of tiles) {
      const [hTL, hTR, hBR, hBL] = tile.elevation;
      const pTL = mapToScreen(tile.x,     tile.y,     hTL);
      const pTR = mapToScreen(tile.x + 1, tile.y,     hTR);
      const pBR = mapToScreen(tile.x + 1, tile.y + 1, hBR);
      const pBL = mapToScreen(tile.x,     tile.y + 1, hBL);

      // Brightness aux 4 coins
      const bTL = vertexBrightness(tiles, w, tile.x,     tile.y);
      const bTR = vertexBrightness(tiles, w, tile.x + 1, tile.y);
      const bBR = vertexBrightness(tiles, w, tile.x + 1, tile.y + 1);
      const bBL = vertexBrightness(tiles, w, tile.x,     tile.y + 1);

      const n = subdiv;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const u0 = sx / n, u1 = (sx + 1) / n;
          const v0 = sy / n, v1 = (sy + 1) / n;
          const subTL = this.lerp2D(pTL, pTR, pBL, pBR, u0, v0);
          const subTR = this.lerp2D(pTL, pTR, pBL, pBR, u1, v0);
          const subBR = this.lerp2D(pTL, pTR, pBL, pBR, u1, v1);
          const subBL = this.lerp2D(pTL, pTR, pBL, pBR, u0, v1);

          const bAvg = (
            lerp(lerp(bTL, bTR, u0), lerp(bBL, bBR, u0), v0) +
            lerp(lerp(bTL, bTR, u1), lerp(bBL, bBR, u1), v1) +
            lerp(lerp(bTL, bTR, u0), lerp(bBL, bBR, u0), v0) +
            lerp(lerp(bTL, bTR, u1), lerp(bBL, bBR, u1), v1)
          ) / 4;
          const gray = Math.round(bAvg * 255);
          lctx.fillStyle = `rgb(${gray},${gray},${gray})`;
          lctx.beginPath();
          lctx.moveTo(subTL.screenX, subTL.screenY);
          lctx.lineTo(subTR.screenX, subTR.screenY);
          lctx.lineTo(subBR.screenX, subBR.screenY);
          lctx.lineTo(subBL.screenX, subBL.screenY);
          lctx.closePath();
          lctx.fill();
        }
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lmCanvas, 0, 0);
    ctx.restore();
  }

  private lerp2D(
    pTL: { screenX: number; screenY: number },
    pTR: { screenX: number; screenY: number },
    pBL: { screenX: number; screenY: number },
    pBR: { screenX: number; screenY: number },
    u: number, v: number,
  ): { screenX: number; screenY: number } {
    const lx = lerp(pTL.screenX, pBL.screenX, v);
    const ly = lerp(pTL.screenY, pBL.screenY, v);
    const rx = lerp(pTR.screenX, pBR.screenX, v);
    const ry = lerp(pTR.screenY, pBR.screenY, v);
    return { screenX: lerp(lx, rx, u), screenY: lerp(ly, ry, u) };
  }

  private fillQuad(
    ctx: CanvasRenderingContext2D,
    pTL: { screenX: number; screenY: number },
    pTR: { screenX: number; screenY: number },
    pBR: { screenX: number; screenY: number },
    pBL: { screenX: number; screenY: number },
  ): void {
    ctx.beginPath();
    ctx.moveTo(pTL.screenX, pTL.screenY);
    ctx.lineTo(pTR.screenX, pTR.screenY);
    ctx.lineTo(pBR.screenX, pBR.screenY);
    ctx.lineTo(pBL.screenX, pBL.screenY);
    ctx.closePath();
    ctx.fill();
  }

  clear(): void {
    if (this.image) {
      this.image.destroy();
      this.image = null;
    }
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }
  }
}
