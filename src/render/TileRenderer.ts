/**
 * SimGolf Web — Tile Renderer (pattern fill, géométrie continue)
 *
 * Chaque tuile est un quadrilatère aux 4 sommets projetés de leurs
 * hauteurs réelles. Remplissage : ctx.createPattern(texture, 'repeat').
 * Toutes les tuiles dans un CANVAS UNIQUE → zéro gap.
 * Tri painter's algorithm par profondeur (x + y).
 *
 * - GRASS/ROUGH/etc : textures Rough en pattern fill
 * - TREE : textures Woods en pattern fill
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { TileType } from '../core/types';
import { mapToScreen } from './CoordinateSystem';

/**
 * Noms des textures Woods (tuiles terrain boisées).
 * 36 textures : 4 groupes (A-D) × 9 variantes (0001-0009).
 * Les groupes A-D sont des variantes décoratives (clairsemé → dense).
 */
const WOODS_TEXTURES = (() => {
  const names: string[] = [];
  for (const group of ['A', 'B', 'C', 'D']) {
    for (let v = 1; v <= 9; v++) {
      names.push(`woods${group}${v.toString().padStart(4, '0')}`);
    }
  }
  return names; // index 0..35
})();

interface QuadTile {
  x: number; y: number;
  verts: Array<{ x: number; y: number }>;
  type: TileType;
  variation: number;
}

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private mapImage: Phaser.GameObjects.Image | null = null;
  private canvasKey = 'terrain_canvas';

  /** Position du canvas dans le monde Phaser */
  canvasOffsetX = 0;
  canvasOffsetY = 0;

  constructor(scene: Phaser.Scene, terrain: TerrainEngine) {
    this.scene = scene;
    this.terrain = terrain;
  }

  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    if (tiles.length === 0) return;
    this.clearAll();

    // ── 1. Collecter les 4 sommets de chaque tuile ──
    const origin = mapToScreen(0, 0);
    const quads: QuadTile[] = [];
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y, data } of tiles) {
      const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);

      const verts = [
        this.vert(x,     y,     hTL, origin), // TL
        this.vert(x + 1, y,     hTR, origin), // TR
        this.vert(x + 1, y + 1, hBR, origin), // BR
        this.vert(x,     y + 1, hBL, origin), // BL
      ];

      for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }

      quads.push({ x, y, verts, type: data.type, variation: data.variation });
    }

    // ── 2. Tri painter's : arrière → avant ──
    quads.sort((a, b) => {
      const da = a.x + a.y;
      const db = b.x + b.y;
      if (da !== db) return da - db;
      return a.x - b.x;
    });

    // ── 3. Canvas unique ──
    const margin = 2;
    const cw = Math.ceil(maxX - minX) + margin * 2;
    const ch = Math.ceil(maxY - minY) + margin * 2;

    if (cw <= 0 || ch <= 0) return;

    const offsetX = minX - margin;
    const offsetY = minY - margin;
    this.canvasOffsetX = offsetX;
    this.canvasOffsetY = offsetY;

    const canvas = this.scene.textures.createCanvas(this.canvasKey, cw, ch);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, cw, ch);
    ctx.translate(-offsetX, -offsetY);

    // ── 4. Pattern fill pour chaque tuile ──
    const grassPattern = this.createGrassPattern(ctx);

    for (const q of quads) {
      const [pTL, pTR, pBR, pBL] = q.verts;

      // Fond opaque (anti-gap de transparence)
      ctx.fillStyle = '#4a8f4a';
      ctx.beginPath();
      ctx.moveTo(pTL.x, pTL.y);
      ctx.lineTo(pTR.x, pTR.y);
      ctx.lineTo(pBR.x, pBR.y);
      ctx.lineTo(pBL.x, pBL.y);
      ctx.closePath();
      ctx.fill();

      // Pattern selon le type de tuile
      let pattern: CanvasPattern | null = null;

      if (q.type === TileType.TREE) {
        pattern = this.getWoodsPattern(ctx, q.variation);
      }

      // Fallback : herbe
      if (!pattern) pattern = grassPattern;

      if (pattern) {
        ctx.fillStyle = pattern;
      } else {
        ctx.fillStyle = '#4a8f4a';
      }

      ctx.beginPath();
      ctx.moveTo(pTL.x, pTL.y);
      ctx.lineTo(pTR.x, pTR.y);
      ctx.lineTo(pBR.x, pBR.y);
      ctx.lineTo(pBL.x, pBL.y);
      ctx.closePath();
      ctx.fill();
    }

    canvas.refresh();

    // ── 5. Image Phaser unique ──
    this.mapImage = this.scene.add.image(offsetX, offsetY, this.canvasKey);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setDepth(0);
  }

  // ================================================================
  // Patterns
  // ================================================================

  /**
   * Crée un CanvasPattern à partir de la texture RoughA0001.
   */
  private createGrassPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const srcKey = 'RoughA0001';
    const tex = this.scene.textures.get(srcKey);
    const srcImg = tex?.getSourceImage() as CanvasImageSource | null;

    if (srcImg) {
      try {
        const p = ctx.createPattern(srcImg, 'repeat');
        if (p) return p;
      } catch {
        // fallback
      }
    }

    // Fallback procédural
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 64;
    patternCanvas.height = 64;
    const pctx = patternCanvas.getContext('2d')!;
    this.drawFallbackGrass(pctx, 64, 64);
    return ctx.createPattern(patternCanvas, 'repeat') || null;
  }

  /**
   * Récupère ou crée un pattern pour une texture Woods (bois).
   * La variation (1..36) détermine quelle texture Woods utiliser.
   */
  private woodsPatternCache: Map<string, CanvasPattern | null> = new Map();

  private getWoodsPattern(
    ctx: CanvasRenderingContext2D,
    variation: number,
  ): CanvasPattern | null {
    // variation = 0..35 → index dans WOODS_TEXTURES
    const idx = ((variation - 1) % WOODS_TEXTURES.length + WOODS_TEXTURES.length) % WOODS_TEXTURES.length;
    const textureKey = WOODS_TEXTURES[idx];
    const cacheKey = `woods_${textureKey}`;

    if (this.woodsPatternCache.has(cacheKey)) {
      return this.woodsPatternCache.get(cacheKey) ?? null;
    }

    const tex = this.scene.textures.get(textureKey);
    const srcImg = tex?.getSourceImage() as CanvasImageSource | null;

    if (srcImg) {
      try {
        const p = ctx.createPattern(srcImg, 'repeat');
        this.woodsPatternCache.set(cacheKey, p ?? null);
        return p ?? null;
      } catch {
        // fallback
      }
    }

    this.woodsPatternCache.set(cacheKey, null);
    return null;
  }

  private drawFallbackGrass(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#4a8f4a';
    ctx.fillRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.12)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 30; i++) {
      const gx = (i * 17 + 3) % w;
      const gy = (i * 13 + 7) % h;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + 2, gy - 5);
      ctx.stroke();
    }
  }

  // ================================================================
  // Helpers
  // ================================================================

  private vert(
    vx: number, vy: number, h: number,
    origin: { screenX: number; screenY: number },
  ): { x: number; y: number } {
    const p = mapToScreen(vx, vy, h);
    return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
  }

  clearAll(): void {
    if (this.mapImage) {
      this.mapImage.destroy();
      this.mapImage = null;
    }
    this.woodsPatternCache.clear();
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }
  }
}
