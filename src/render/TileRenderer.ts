/**
 * SimGolf Web — Tile Renderer (pattern fill, géométrie continue)
 *
 * Chaque tuile est un quadrilatère aux 4 sommets projetés de leurs
 * hauteurs réelles. Remplissage : ctx.createPattern(RoughA0001, 'repeat').
 * Toutes les tuiles dans un CANVAS UNIQUE → zéro gap.
 * Tri painter's algorithm par profondeur (x + y).
 *
 * Herbe en pattern fill sur canvas unique + arbres en sprites overlay.
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { TileType } from '../core/types';
import { mapToScreen } from './CoordinateSystem';

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private mapImage: Phaser.GameObjects.Image | null = null;
  private canvasKey = 'terrain_canvas';

  /** Sprites d'arbres (détruits et recréés à chaque render) */
  private treeSprites: Phaser.GameObjects.Image[] = [];

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
    interface QuadTile {
      x: number; y: number;
      verts: Array<{ x: number; y: number }>;
    }

    const origin = mapToScreen(0, 0);
    const quads: QuadTile[] = [];
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y } of tiles) {
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

      quads.push({ x, y, verts });
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
    const pattern = this.createGrassPattern(ctx);
    if (!pattern) return;

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

      // Texture répétée
      ctx.fillStyle = pattern;
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

    // ── 6. Arbres : sprites par-dessus le terrain ──
    this.renderTrees(quads, tiles);
  }

  // ================================================================
  // Pattern Fill
  // ================================================================

  /**
   * Crée un CanvasPattern à partir de la texture RoughA0001.
   * Toutes les tuiles partagent le même pattern → jointure invisible.
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
    console.warn('[TileRenderer] createPattern fallback');
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 64;
    patternCanvas.height = 64;
    const pctx = patternCanvas.getContext('2d')!;
    this.drawFallbackGrass(pctx, 64, 64);
    return ctx.createPattern(patternCanvas, 'repeat') || null;
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

  /**
   * Rend les arbres comme sprites Phaser sur les tuiles TREE.
   * Tri painter's par profondeur (x + y), positionnés au centre
   * isométrique de chaque tuile, ancrés en bas du sprite.
   */
  private renderTrees(
    _quads: Array<{ x: number; y: number; verts: Array<{ x: number; y: number }> }>,
    tiles: Array<{ x: number; y: number; data: TileData }>,
  ): void {
    const origin = mapToScreen(0, 0);

    // Collecter les tuiles TREE
    interface TreeEntry {
      x: number; y: number;
      screenX: number; screenY: number;
      textureKey: string;
    }

    const trees: TreeEntry[] = [];
    for (const { x, y, data } of tiles) {
      if (data.type !== TileType.TREE) continue;

      // Centre isométrique de la tuile
      const hAvg = (data.elevation[0] + data.elevation[1] +
                    data.elevation[2] + data.elevation[3]) / 4;
      const p = mapToScreen(x + 0.5, y + 0.5, hAvg);
      const screenX = p.screenX - origin.screenX;
      const screenY = p.screenY - origin.screenY;

      // Texture : cycle parmi les 12 variantes
      const treeIdx = data.variation % 12;
      const treeNames = [
        'Tree_TreePineSmall', 'Tree_TreePineMedium', 'Tree_TreePineLarge',
        'Tree_TreeMapleSmall', 'Tree_TreeMapleMedium', 'Tree_TreeMapleLarge',
        'Tree_Scenic_Tree', 'Tree_BlackPine', 'Tree_WillowTree',
        'Tree_TreePineFirSm', 'Tree_TreePineFirMed', 'Tree_TreePineFirLg',
      ];
      const textureKey = treeNames[treeIdx];

      trees.push({ x, y, screenX, screenY, textureKey });
    }

    // Tri painter's : arrière → avant
    trees.sort((a, b) => {
      const da = a.x + a.y;
      const db = b.x + b.y;
      if (da !== db) return da - db;
      return a.x - b.x;
    });

    // Créer les sprites
    for (const t of trees) {
      const tex = this.scene.textures.get(t.textureKey);
      if (!tex?.getSourceImage()) continue;

      const img = this.scene.add.image(t.screenX, t.screenY, t.textureKey);
      img.setOrigin(0.5, 1); // Ancré en bas-centre
      img.setDepth(t.x + t.y + 1); // Au-dessus du terrain (depth 0)
      this.treeSprites.push(img);
    }
  }

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
    for (const s of this.treeSprites) {
      s.destroy();
    }
    this.treeSprites = [];
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }
  }
}
