/**
 * SimGolf Web — Tile Renderer (pattern fill, géométrie continue)
 *
 * Chaque tuile est un quadrilatère aux 4 sommets projetés de leurs
 * hauteurs réelles. Remplissage : ctx.createPattern(texture, 'repeat').
 * Toutes les tuiles dans un CANVAS UNIQUE → zéro gap.
 * Tri painter's algorithm par profondeur (x + y).
 *
 * - GRASS/ROUGH/etc : textures Rough en pattern fill
 * - TREE : textures Woods en pattern fill (autotile par shape letter)
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { TileType } from '../core/types';
import { mapToScreen } from './CoordinateSystem';
import { getShapeLetter, ShapeLetter } from './ShapeClassifier';

interface QuadTile {
  x: number; y: number;
  verts: Array<{ x: number; y: number }>;
  type: TileType;
}

/** Préfixe de texture par type de tuile */
const TYPE_PREFIX: Record<TileType, string> = {
  [TileType.GRASS]:       'Rough',
  [TileType.FAIRWAY]:     'Rough',
  [TileType.GREEN]:       'Rough',
  [TileType.TEE]:         'Rough',
  [TileType.SAND]:        'Rough',
  [TileType.WATER]:       'Rough',
  [TileType.PATH]:        'Rough',
  [TileType.BUILDING]:    'Rough',
  [TileType.TREE]:        'woods',   // textures Woods (tuiles terrain)
  [TileType.BUSH]:        'Rough',
  [TileType.FLOWER]:      'Rough',
  [TileType.ROUGH]:       'Rough',
  [TileType.BRIDGE]:      'Rough',
  [TileType.HOLE]:        'Rough',
  [TileType.WATER_HAZARD]: 'Rough',
  [TileType.EMPTY]:       'Rough',
};

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

      quads.push({ x, y, verts, type: data.type });
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

      // Pattern selon le type + shape
      const pattern = this.getPattern(ctx, q);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.beginPath();
        ctx.moveTo(pTL.x, pTL.y);
        ctx.lineTo(pTR.x, pTR.y);
        ctx.lineTo(pBR.x, pBR.y);
        ctx.lineTo(pBL.x, pBL.y);
        ctx.closePath();
        ctx.fill();
      }
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

  /** Cache de patterns par clé de texture */
  private patternCache = new Map<string, CanvasPattern | null>();

  /**
   * Récupère ou crée un pattern pour une tuile donnée.
   * La texture est choisie selon le type de tuile et la forme géométrique.
   */
  private getPattern(
    ctx: CanvasRenderingContext2D,
    quad: QuadTile,
  ): CanvasPattern | null {
    const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(quad.x, quad.y);
    const letter = getShapeLetter(hTL, hTR, hBR, hBL);
    const prefix = TYPE_PREFIX[quad.type] ?? 'Rough';

    // Variante cosmétique déterministe par position
    const variant = this.getCosmeticVariant(quad.x, quad.y, prefix === 'woods' ? 9 : 5);

    const textureKey = `${prefix}${letter}${variant}`;

    if (this.patternCache.has(textureKey)) {
      return this.patternCache.get(textureKey) ?? null;
    }

    const tex = this.scene.textures.get(textureKey);
    const srcImg = tex?.getSourceImage() as CanvasImageSource | null;

    if (srcImg) {
      try {
        const p = ctx.createPattern(srcImg, 'repeat');
        this.patternCache.set(textureKey, p ?? null);
        return p ?? null;
      } catch {
        // fallback
      }
    }

    // Fallback : essayer avec la letter A (toujours disponible)
    const fallbackKey = `${prefix}A${variant}`;
    if (fallbackKey !== textureKey) {
      return this.getPatternFromKey(ctx, fallbackKey);
    }

    this.patternCache.set(textureKey, null);
    return null;
  }

  /** Créer un pattern depuis une clé de texture */
  private getPatternFromKey(
    ctx: CanvasRenderingContext2D,
    textureKey: string,
  ): CanvasPattern | null {
    if (this.patternCache.has(textureKey)) {
      return this.patternCache.get(textureKey) ?? null;
    }

    const tex = this.scene.textures.get(textureKey);
    const srcImg = tex?.getSourceImage() as CanvasImageSource | null;

    if (srcImg) {
      try {
        const p = ctx.createPattern(srcImg, 'repeat');
        this.patternCache.set(textureKey, p ?? null);
        return p ?? null;
      } catch {
        // fallback
      }
    }

    this.patternCache.set(textureKey, null);
    return null;
  }

  /** Variante cosmétique déterministe (0001-0009 ou 0001-0005) */
  private getCosmeticVariant(x: number, y: number, maxVariants: number): string {
    const hash = (x * 31 + y * 17) & 0x7fffffff;
    const variant = (hash % maxVariants) + 1;
    return variant.toString().padStart(4, '0');
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
    this.patternCache.clear();
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }
  }
}
