/**
 * SimGolf Web — Tile Renderer (pattern fill, géométrie continue)
 *
 * Chaque tuile est un quadrilatère aux 4 sommets projetés de leurs
 * hauteurs réelles. Remplissage : ctx.createPattern(texture, 'repeat').
 * Toutes les tuiles dans un CANVAS UNIQUE → zéro gap.
 * Tri painter's algorithm par profondeur (x + y).
 *
 * - GRASS/ROUGH/etc : textures Rough en pattern fill (tileable)
 * - TREE : textures Woods (Tree_*.png) — autotile selon les voisines
 *   Les bords transparents ne sont montrés qu'aux transitions TREE↔non-TREE
 *   ou aux bords de la carte.
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { TileType } from '../core/types';
import { mapToScreen } from './CoordinateSystem';

/** Noms des textures Woods (tuiles terrain de type arbre) */
const TREE_TEXTURES = [
  'Tree_TreePineSmall', 'Tree_TreePineMedium', 'Tree_TreePineLarge',
  'Tree_TreeMapleSmall', 'Tree_TreeMapleMedium', 'Tree_TreeMapleLarge',
  'Tree_Scenic_Tree', 'Tree_BlackPine', 'Tree_WillowTree',
  'Tree_TreePineFirSm', 'Tree_TreePineFirMed', 'Tree_TreePineFirLg',
] as const;

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

    // Map pour lookup rapide des types
    const typeMap = new Map<string, TileType>();
    for (const { x, y, data } of tiles) {
      typeMap.set(`${x},${y}`, data.type);
    }

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

    // ── 4. Pattern herbe (tileable) ──
    const grassPattern = this.createGrassPattern(ctx);

    // ── 5. Rendu de chaque tuile ──
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

      if (q.type === TileType.TREE) {
        // Woods : texture avec autotile (bords transparents uniquement aux transitions)
        this.drawTreeTile(ctx, q, typeMap, grassPattern);
      } else {
        // Terrain standard : pattern fill tileable
        ctx.fillStyle = grassPattern || '#4a8f4a';
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

    // ── 6. Image Phaser unique ──
    this.mapImage = this.scene.add.image(offsetX, offsetY, this.canvasKey);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setDepth(0);
  }

  // ================================================================
  // Rendu des tuiles Woods (arbres) avec autotile
  // ================================================================

  /**
   * Dessine une tuile Woods avec gestion des transitions.
   *
   * Logique :
   * - Si la tuile TREE a une voisine non-TREE (ou est au bord de la carte),
   *   le bord de transition de la texture Woods est visible de ce côté.
   * - Si toutes les voisines sont TREE, aucun bord transparent n'apparaît.
   *
   * Implémentation : on crée un canvas temporaire, on y dessine l'image
   * Woods complète, puis on découpe une sous-rectangle qui ne contient
   * que les bords de transition nécessaires.
   */
  private drawTreeTile(
    ctx: CanvasRenderingContext2D,
    quad: QuadTile,
    typeMap: Map<string, TileType>,
    fallback: CanvasPattern | null,
  ): void {
    const [pTL, pTR, pBR, pBL] = quad.verts;

    // Texture Woods
    const idx = quad.variation % TREE_TEXTURES.length;
    const textureKey = TREE_TEXTURES[idx];
    const tex = this.scene.textures.get(textureKey);
    const srcImg = tex?.getSourceImage() as HTMLImageElement | null;

    if (!srcImg) {
      ctx.fillStyle = fallback || '#4a8f4a';
      this.fillQuad(ctx, pTL, pTR, pBR, pBL);
      return;
    }

    // Déterminer les bords de transition
    const isBorderN = quad.y === 0;
    const isBorderS = quad.y === this.terrain.height - 1;
    const isBorderW = quad.x === 0;
    const isBorderE = quad.x === this.terrain.width - 1;

    const neighborN = typeMap.get(`${quad.x},${quad.y - 1}`) ?? TileType.EMPTY;
    const neighborS = typeMap.get(`${quad.x},${quad.y + 1}`) ?? TileType.EMPTY;
    const neighborW = typeMap.get(`${quad.x - 1},${quad.y}`) ?? TileType.EMPTY;
    const neighborE = typeMap.get(`${quad.x + 1},${quad.y}`) ?? TileType.EMPTY;

    // Bord visible si voisine non-TREE (ou bord de carte)
    const showN = isBorderN || neighborN !== TileType.TREE;
    const showS = isBorderS || neighborS !== TileType.TREE;
    const showW = isBorderW || neighborW !== TileType.TREE;
    const showE = isBorderE || neighborE !== TileType.TREE;

    // Si aucun bord de transition → le centre opaque doit couvrir tout le quad.
    // On scale l'image plus grand pour que les bords transparents débordent
    // du quad et soient coupés par le clip.
    if (!showN && !showS && !showW && !showE) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pTL.x, pTL.y);
      ctx.lineTo(pTR.x, pTR.y);
      ctx.lineTo(pBR.x, pBR.y);
      ctx.lineTo(pBL.x, pBL.y);
      ctx.closePath();
      ctx.clip();
      this.drawCentered(ctx, srcImg, pTL, pTR, pBR, pBL, 1.35);
      ctx.restore();
      return;
    }

    // Au moins un bord de transition : dessiner l'image normale
    // (bords transparents visibles du côté des voisines non-TREE)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.clip();
    this.drawCentered(ctx, srcImg, pTL, pTR, pBR, pBL, 1.0);
    ctx.restore();
  }

  /**
   * Dessine l'image centrée sur le quadrilatère, redimensionnée
   * pour couvrir tout le quad.
   */
  private drawCentered(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    pTL: { x: number; y: number },
    pTR: { x: number; y: number },
    pBR: { x: number; y: number },
    pBL: { x: number; y: number },
    scaleMultiplier = 1.0,
  ): void {
    // Centre du quad
    const cx = (pTL.x + pBR.x) / 2;
    const cy = (pTL.y + pBR.y) / 2;

    // Dimensions du quad (bounding box)
    const xs = [pTL.x, pTR.x, pBR.x, pBL.x];
    const ys = [pTL.y, pTR.y, pBR.y, pBL.y];
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);

    // Scale pour couvrir le quad, ajusté par le multiplicateur
    const scaleX = bw / img.width;
    const scaleY = bh / img.height;
    const scale = Math.max(scaleX, scaleY) * scaleMultiplier;

    const dw = img.width * scale;
    const dh = img.height * scale;

    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  // ================================================================
  // Pattern herbe
  // ================================================================

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

    console.warn('[TileRenderer] createPattern fallback');
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 64;
    patternCanvas.height = 64;
    const pctx = patternCanvas.getContext('2d')!;
    this.drawFallbackGrass(pctx, 64, 64);
    return ctx.createPattern(patternCanvas, 'repeat') || null;
  }

  private fillQuad(
    ctx: CanvasRenderingContext2D,
    pTL: { x: number; y: number },
    pTR: { x: number; y: number },
    pBR: { x: number; y: number },
    pBL: { x: number; y: number },
  ): void {
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.fill();
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
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }
  }
}
