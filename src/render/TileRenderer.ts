/**
 * SimGolf Web — Tile Renderer (maillage continu)
 *
 * Rendu de terrain continu : chaque tuile est un quadrilatère texturé
 * dont les 4 sommets sont projetés à LEUR hauteur réelle (heightmap).
 *
 * Les 4 hauteurs indépendantes (hTL, hTR, hBR, hBL) donnent 4 points 3D
 * projetés en 2D via la formume isométrique. La texture du jeu est
 * mappée par 2 triangles affines → surface inclinée continue.
 *
 * Toutes les tuiles sont dessinées dans un CANVAS UNIQUE → pas de gaps.
 * Tri painter's algorithm pour le chevauchement correct.
 * Pas de murs marrons pour les pentes douces (diff ≤ 1).
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { mapToScreen, TILE_W, TILE_H, TILE_D } from './CoordinateSystem';
import { getShapeLetter, getCosmeticVariant, buildTextureSourceName } from './ShapeClassifier';

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private mapImage: Phaser.GameObjects.Image | null = null;
  private canvasKey = 'terrain_canvas';
  private showDebug = false;
  private srcCache = new Map<string, CanvasImageSource | null>();

  /** Position du canvas dans le monde Phaser (coin haut-gauche) */
  canvasOffsetX = 0;
  canvasOffsetY = 0;

  constructor(scene: Phaser.Scene, terrain: TerrainEngine) {
    this.scene = scene;
    this.terrain = terrain;
  }

  setDebug(active: boolean): void { this.showDebug = active; }
  isDebug(): boolean { return this.showDebug; }

  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    if (tiles.length === 0) return;
    this.clearAll();

    // ================================================================
    // 1. Collecter les données de chaque tuile
    // ================================================================
    interface TileRenderData {
      x: number; y: number;
      hTL: number; hTR: number; hBR: number; hBL: number;
      avgH: number;
      /** 4 sommets du quad [TL, TR, BR, BL] */
      verts: Array<{ x: number; y: number }>;
    }

    const data: TileRenderData[] = [];
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y } of tiles) {
      const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);
      const avgH = (hTL + hTR + hBR + hBL) / 4;

      // 4 sommets projetés avec LEUR hauteur individuelle
      const verts = [
        this.vert(x,     y,     hTL), // TL
        this.vert(x + 1, y,     hTR), // TR
        this.vert(x + 1, y + 1, hBR), // BR
        this.vert(x,     y + 1, hBL), // BL
      ];

      // Mise à jour bounding box (avec léger padding pour l'anti-aliasing)
      for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }

      data.push({ x, y, hTL, hTR, hBR, hBL, avgH, verts });
    }

    // ================================================================
    // 2. Tri painter's algorithm
    // ================================================================
    // L'ordre de rendu doit aller de l'arrière (haut-gauche, basse alt.)
    // vers l'avant (bas-droite, haute alt.)
    data.sort((a, b) => {
      const da = a.x + a.y + a.avgH;
      const db = b.x + b.y + b.avgH;
      return da - db;
    });

    // ================================================================
    // 3. Création du canvas
    // ================================================================
    const margin = 2; // anti-aliasing safety
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

    // Translate pour que les coordonnées monde → pixels canvas
    ctx.save();
    ctx.translate(-offsetX, -offsetY);

    // ================================================================
    // 4. Dessiner chaque tuile
    // ================================================================
    for (const d of data) {
      const sourceKey = buildTextureSourceName(
        'Rough',
        getShapeLetter(d.hTL, d.hTR, d.hBR, d.hBL),
        getCosmeticVariant(d.x, d.y, 9),
      );

      const srcImg = this.getSourceImage(sourceKey);
      if (!srcImg) continue;

      this.drawSlopedQuad(ctx, srcImg, d.verts, d.hTL, d.hTR, d.hBR, d.hBL);

      // Debug overlay
      if (this.showDebug) {
        const cx = (d.verts[0].x + d.verts[1].x + d.verts[2].x + d.verts[3].x) / 4;
        const cy = (d.verts[0].y + d.verts[1].y + d.verts[2].y + d.verts[3].y) / 4;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(cx - 14, cy - 5, 28, 10);
        ctx.fillStyle = '#ffcc00';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(sourceKey, cx, cy + 3);
      }
    }

    ctx.restore();
    canvas.refresh();

    // ================================================================
    // 5. Image Phaser
    // ================================================================
    this.mapImage = this.scene.add.image(offsetX, offsetY, this.canvasKey);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setDepth(0);
  }

  // ================================================================
  // Dessin d'un quadrilatère texturé pentu
  // ================================================================

  /**
   * Dessine un quadrilatère texturé sur le contexte canvas.
   * Utilise 2 triangles affines pour mapper la texture carrée 64×64
   * sur les 4 sommets projetés à leurs hauteurs réelles.
   *
   * TRIANGULATION DYNAMIQUE : analyse les 4 hauteurs pour choisir
   * la diagonale de coupe qui évite les quadrilatères croisés.
   *   - Si |hTL - hBR| ≤ |hTR - hBL| → diagonale TL-BR (standard)
   *   - Sinon → diagonale TR-BL (inversée)
   *
   * Les 4 sommets sont [TL, TR, BR, BL].
   * Les UV vont de (0,0) en haut-gauche à (1,1) en bas-droite.
   */
  private drawSlopedQuad(
    ctx: CanvasRenderingContext2D,
    srcImg: CanvasImageSource,
    verts: Array<{ x: number; y: number }>,
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): void {
    const [pTL, pTR, pBR, pBL] = verts;

    // Remplissage de fond opaque (couleur herbe) — anti-gap/transparence
    ctx.fillStyle = '#4a8f4a';
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.fill();

    // Triangulation dynamique : choisir la diagonale qui relie
    // les deux sommets aux hauteurs les plus proches → évite les quads pliés
    const diffTLBR = Math.abs(hTL - hBR);
    const diffTRBL = Math.abs(hTR - hBL);

    if (diffTLBR <= diffTRBL) {
      // Diagonale TL-BR (standard)
      // Triangle 1 : TL → TR → BR
      this.drawTexturedTriangle(ctx, srcImg,
        pTL.x, pTL.y,
        pTR.x, pTR.y,
        pBR.x, pBR.y,
        0, 0, 1, 0, 1, 1);

      // Triangle 2 : TL → BR → BL
      this.drawTexturedTriangle(ctx, srcImg,
        pTL.x, pTL.y,
        pBR.x, pBR.y,
        pBL.x, pBL.y,
        0, 0, 1, 1, 0, 1);
    } else {
      // Diagonale TR-BL (inversée)
      // Triangle 1 : TL → TR → BL
      this.drawTexturedTriangle(ctx, srcImg,
        pTL.x, pTL.y,
        pTR.x, pTR.y,
        pBL.x, pBL.y,
        0, 0, 1, 0, 0, 1);

      // Triangle 2 : TR → BR → BL
      this.drawTexturedTriangle(ctx, srcImg,
        pTR.x, pTR.y,
        pBR.x, pBR.y,
        pBL.x, pBL.y,
        1, 0, 1, 1, 0, 1);
    }
  }

  /**
   * Dessine un triangle texturé avec transformation affine.
   * srcUV: (u0,v0) en point 0, (u1,v1) en point 1, (u2,v2) en point 2
   */
  private drawTexturedTriangle(
    ctx: CanvasRenderingContext2D,
    srcImg: CanvasImageSource,
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    u0: number, v0: number,
    u1: number, v1: number,
    u2: number, v2: number,
  ): void {
    const a = x1 - x0, b = x2 - x0;
    const d = y1 - y0, e = y2 - y0;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();

    // Transformée affine : mappe le rectangle UV (0..1) sur le triangle
    ctx.setTransform(a, d, b, e, x0, y0);
    ctx.drawImage(srcImg, 0, 0, 64, 64);
    ctx.restore();
  }

  // ================================================================
  // Helpers
  // ================================================================

  /**
   * Projette un sommet (vx, vy, h) en coordonnées écran,
   * relatif à mapToScreen(0, 0) pour un référentiel commun.
   */
  private vert(vx: number, vy: number, h: number): { x: number; y: number } {
    const p = mapToScreen(vx, vy, h);
    const origin = mapToScreen(0, 0);
    return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
  }

  private getSourceImage(key: string): CanvasImageSource | null {
    if (this.srcCache.has(key)) return this.srcCache.get(key)!;
    const tex = this.scene.textures.get(key);
    const img = tex?.getSourceImage() as CanvasImageSource ?? null;
    this.srcCache.set(key, img);
    return img;
  }

  clearAll(): void {
    if (this.mapImage) {
      this.mapImage.destroy();
      this.mapImage = null;
    }
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }
    this.srcCache.clear();
  }
}
