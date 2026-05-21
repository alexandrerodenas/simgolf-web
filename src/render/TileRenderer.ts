/**
 * TileRenderer — rendu isométrique avec textures WebP originales
 *
 * Chaque tuile est un quadrilatère rempli par ctx.createPattern(texture, 'repeat').
 * Éclairage Gouraud par lightmap tessellé en mode multiply.
 * Tri painter's par profondeur (x+y).
 */

import Phaser from 'phaser';
import { TileType, Tile, TerrainData } from '../core/types';
import { TILE_W, TILE_H, HEIGHT_SCALE, mapToScreen } from './CoordinateSystem';

// ================================================================
// Aide-mémoire : clé de texture → subdir
// ================================================================

const TEXTURE_MAP: Record<TileType, { prefix: string; subdir: string }> = {
  [TileType.Rough]:        { prefix: 'Rough',        subdir: 'rough' },
  [TileType.Fairway]:      { prefix: 'Fairway',      subdir: 'fairway' },
  [TileType.Green]:        { prefix: 'PuttingGreen', subdir: 'green' },
  [TileType.SandBunker]:   { prefix: 'SandBunker',   subdir: 'sand' },
  [TileType.WaterShallow]: { prefix: 'WaterShallow', subdir: 'water' },
  [TileType.WaterMiddle]:  { prefix: 'WaterMiddle',  subdir: 'water-middle' },
  [TileType.WaterDeep]:    { prefix: 'WaterDeep',    subdir: 'water-deep' },
  [TileType.DeepRough]:    { prefix: 'DeepRough',    subdir: 'deeprough' },
  [TileType.GrassySand]:   { prefix: 'GrassySand',   subdir: 'rough' },
  [TileType.GrassBunker]:  { prefix: 'GrassBunker',  subdir: 'rough' },
  [TileType.Tee]:          { prefix: 'Tee',           subdir: 'tee' },
  [TileType.Cliff]:        { prefix: 'Cliff',        subdir: 'rough' },
  [TileType.Path]:         { prefix: 'Path',         subdir: 'rough' },
  [TileType.Building]:     { prefix: 'Building',     subdir: 'rough' },
  [TileType.Tree]:         { prefix: 'Woods',        subdir: 'woods' },
  [TileType.Flower]:       { prefix: 'Flower',       subdir: 'rough' },
};

function textureKey(type: TileType, variation: number): string {
  const info = TEXTURE_MAP[type];
  const group = type === TileType.SandBunker ? '1A' : 'A';
  // Fallback direct : RoughA0001 etc.
  return `${info.prefix}${group}${String(variation).padStart(4, '0')}`;
}

// ================================================================
// Éclairage
// ================================================================

const LIGHT_DIR: [number, number, number] = [-0.409, -0.613, 0.707];
const MIN_B = 0.65;
const STEP = 2;

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  return l === 0 ? [0,0,1] : [v[0]/l, v[1]/l, v[2]/l];
}
function cross(a: [number,number,number], b: [number,number,number]): [number,number,number] {
  return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
}
function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

interface Quad {
  pTL: { screenX: number; screenY: number };
  pTR: { screenX: number; screenY: number };
  pBR: { screenX: number; screenY: number };
  pBL: { screenX: number; screenY: number };
}

// ================================================================
// TileRenderer
// ================================================================

export class TileRenderer {
  private scene: Phaser.Scene;
  private image: Phaser.GameObjects.Image | null = null;
  private canvasKey = 'terrain_canvas';
  private patternCache = new Map<string, CanvasPattern | null>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  render(data: TerrainData): void {
    this.clear();

    const { width: w, height: h, tiles } = data;

    // ---- 1. Projeter les quads ----
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const quadTiles: { quad: Quad; type: TileType; vari: number; z: number }[] = [];

    for (const tile of tiles) {
      const [hTL, hTR, hBR, hBL] = tile.elevation;
      const q: Quad = {
        pTL: mapToScreen(tile.x,     tile.y,     hTL),
        pTR: mapToScreen(tile.x + 1, tile.y,     hTR),
        pBR: mapToScreen(tile.x + 1, tile.y + 1, hBR),
        pBL: mapToScreen(tile.x,     tile.y + 1, hBL),
      };
      for (const p of Object.values(q)) {
        if (p.screenX < minX) minX = p.screenX;
        if (p.screenY < minY) minY = p.screenY;
        if (p.screenX > maxX) maxX = p.screenX;
        if (p.screenY > maxY) maxY = p.screenY;
      }
      quadTiles.push({ quad: q, type: tile.type, vari: tile.variation, z: tile.x + tile.y });
    }

    // ---- 2. Tri painter's ----
    quadTiles.sort((a, b) => a.z - b.z);

    // ---- 3. Canvas unique ----
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

    // ---- 4. Remplir les quads avec les textures ----
    for (const qt of quadTiles) {
      const { quad: q, type, vari } = qt;
      const key = textureKey(type, vari);

      // Fond opaque de la couleur dominante de la texture
      ctx.fillStyle = '#3a5a2a';
      ctx.beginPath();
      ctx.moveTo(q.pTL.screenX, q.pTL.screenY);
      ctx.lineTo(q.pTR.screenX, q.pTR.screenY);
      ctx.lineTo(q.pBR.screenX, q.pBR.screenY);
      ctx.lineTo(q.pBL.screenX, q.pBL.screenY);
      ctx.closePath();
      ctx.fill();

      // Pattern texture
      const pattern = this.getPattern(ctx, key);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.beginPath();
        ctx.moveTo(q.pTL.screenX, q.pTL.screenY);
        ctx.lineTo(q.pTR.screenX, q.pTR.screenY);
        ctx.lineTo(q.pBR.screenX, q.pBR.screenY);
        ctx.lineTo(q.pBL.screenX, q.pBL.screenY);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ---- 5. Lightmap ----
    this.renderLightmap(ctx, cw, ch, ox, oy, tiles, w, h);

    canvas.refresh();

    // ---- 6. Image Phaser ----
    this.image = this.scene.add.image(ox, oy, this.canvasKey);
    this.image.setOrigin(0, 0);
    this.image.setDepth(0);
  }

  private getPattern(ctx: CanvasRenderingContext2D, key: string): CanvasPattern | null {
    const cached = this.patternCache.get(key);
    if (cached !== undefined) return cached;

    const tex = this.scene.textures.get(key);
    const src = tex?.getSourceImage() as CanvasImageSource | null;

    if (src) {
      try {
        const p = ctx.createPattern(src, 'repeat');
        this.patternCache.set(key, p);
        return p;
      } catch {}
    }
    this.patternCache.set(key, null);
    return null;
  }

  private renderLightmap(
    ctx: CanvasRenderingContext2D,
    cw: number, ch: number,
    ox: number, oy: number,
    tiles: Tile[], w: number, h: number,
  ): void {
    const sub = 4;
    const lmc = document.createElement('canvas');
    lmc.width = cw; lmc.height = ch;
    const lctx = lmc.getContext('2d')!;
    lctx.fillStyle = '#fff';
    lctx.fillRect(0, 0, cw, ch);
    lctx.translate(-ox, -oy);

    const getH = (x: number, y: number): number => {
      if (x < 0 || x >= w || y < 0 || y >= h) return 0;
      return tiles[y * w + x].elevation[0];
    };
    const vb = (vx: number, vy: number): number => {
      const hL = getH(vx - 1, vy), hR = getH(vx + 1, vy);
      const hU = getH(vx, vy - 1), hD = getH(vx, vy + 1);
      const dx: [number,number,number] = [STEP, 0, hR - hL];
      const dy: [number,number,number] = [0, STEP, hU - hD];
      const n = normalize(cross(dx, dy));
      const d = dot(n, LIGHT_DIR);
      return MIN_B + (1 - MIN_B) * (d + 1) / 2;
    };

    for (const t of tiles) {
      const [hTL, hTR, hBR, hBL] = t.elevation;
      const pTL = mapToScreen(t.x, t.y, hTL);
      const pTR = mapToScreen(t.x + 1, t.y, hTR);
      const pBR = mapToScreen(t.x + 1, t.y + 1, hBR);
      const pBL = mapToScreen(t.x, t.y + 1, hBL);
      const bTL = vb(t.x, t.y), bTR = vb(t.x + 1, t.y), bBR = vb(t.x + 1, t.y + 1), bBL = vb(t.x, t.y + 1);

      for (let sy = 0; sy < sub; sy++)
        for (let sx = 0; sx < sub; sx++) {
          const u0 = sx/sub, u1 = (sx+1)/sub, v0 = sy/sub, v1 = (sy+1)/sub;
          const l2d = (p: typeof pTL, q: typeof pTL, r: typeof pTL, s: typeof pTL, u: number, v: number) => ({
            screenX: lerp(lerp(p.screenX, s.screenX, v), lerp(q.screenX, r.screenX, v), u),
            screenY: lerp(lerp(p.screenY, s.screenY, v), lerp(q.screenY, r.screenY, v), u),
          });
          const sTL = l2d(pTL, pTR, pBR, pBL, u0, v0);
          const sTR = l2d(pTL, pTR, pBR, pBL, u1, v0);
          const sBR = l2d(pTL, pTR, pBR, pBL, u1, v1);
          const sBL = l2d(pTL, pTR, pBR, pBL, u0, v1);
          const avg = (lerp(lerp(bTL, bTR, u0), lerp(bBL, bBR, u0), v0) +
                       lerp(lerp(bTL, bTR, u0), lerp(bBL, bBR, u0), v0) +
                       lerp(lerp(bTL, bTR, u1), lerp(bBL, bBR, u1), v1) +
                       lerp(lerp(bTL, bTR, u1), lerp(bBL, bBR, u1), v1)) / 4;
          const g = Math.round(avg * 255);
          lctx.fillStyle = `rgb(${g},${g},${g})`;
          lctx.beginPath();
          lctx.moveTo(sTL.screenX, sTL.screenY);
          lctx.lineTo(sTR.screenX, sTR.screenY);
          lctx.lineTo(sBR.screenX, sBR.screenY);
          lctx.lineTo(sBL.screenX, sBL.screenY);
          lctx.closePath();
          lctx.fill();
        }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lmc, 0, 0);
    ctx.restore();
  }

  clear(): void {
    if (this.image) { this.image.destroy(); this.image = null; }
    if (this.scene.textures.exists(this.canvasKey)) this.scene.textures.remove(this.canvasKey);
    this.patternCache.clear();
  }
}
