/**
 * SimGolf Web — Tile Renderer (pattern fill, géométrie continue)
 *
 * Chaque tuile est un quadrilatère aux 4 sommets projetés de leurs
 * hauteurs réelles. Le remplissage utilise ctx.createPattern(texture, 'repeat')
 * — la texture d'herbe n'est JAMAIS étirée ou déformée, elle se répète
 * naturellement et se découpe sur la géométrie de la pente.
 *
 * Toutes les tuiles sont dessinées dans un CANVAS UNIQUE → zéro gap.
 * Tri painter's algorithm par depth = x + y.
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine, TileType } from '../core';
import { mapToScreen, TILE_H, TILE_D } from './CoordinateSystem';
import { getShapeLetter, getCosmeticVariant, buildTextureSourceName } from './ShapeClassifier';

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private mapImage: Phaser.GameObjects.Image | null = null;
  private canvasKey = 'terrain_canvas';
  private showDebug = false;

  /** Position du canvas dans le monde Phaser */
  canvasOffsetX = 0;
  canvasOffsetY = 0;

  /** Images des arbres (rajoutées par-dessus le canvas terrain) */
  private treeImages: Phaser.GameObjects.Image[] = [];

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
    // 1. Collecter les 4 sommets de chaque tuile (hauteurs réelles)
    // ================================================================
    interface QuadTile {
      x: number; y: number;
      hTL: number; hTR: number; hBR: number; hBL: number;
      verts: Array<{ x: number; y: number }>;
      avgH: number;
      sourceKey: string;
    }

    const origin = mapToScreen(0, 0);
    const quads: QuadTile[] = [];
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y } of tiles) {
      const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);
      const avgH = (hTL + hTR + hBR + hBL) / 4;

      // 4 sommets projetés avec leurs hauteurs individuelles
      const verts = [
        this.vert(x,     y,     hTL, origin), // TL
        this.vert(x + 1, y,     hTR, origin), // TR
        this.vert(x + 1, y + 1, hBR, origin), // BR
        this.vert(x,     y + 1, hBL, origin), // BL
      ];

      // Bounding box
      for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }

      const sourceKey = buildTextureSourceName(
        'Rough',
        getShapeLetter(hTL, hTR, hBR, hBL),
        getCosmeticVariant(x, y, 9),
      );

      quads.push({ x, y, hTL, hTR, hBR, hBL, verts, avgH, sourceKey });
    }

    // ================================================================
    // 2. Tri painter's : depth = x + y
    // ================================================================
    quads.sort((a, b) => {
      const da = a.x + a.y;
      const db = b.x + b.y;
      if (da !== db) return da - db;
      return a.x - b.x;
    });

    // ================================================================
    // 3. Création du canvas
    // ================================================================
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

    // ================================================================
    // 4. Pattern fill pour chaque tuile
    // ================================================================
    // On crée UN pattern pour la texture de base et on le réutilise
    // pour toutes les tuiles. Le pattern se répète dans le repère
    // CANVAS → les tuiles adjacentes s'alignent parfaitement.
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

      // Quadrilatère rempli avec le pattern (texture non déformée)
      ctx.fillStyle = pattern;
      ctx.beginPath();
      ctx.moveTo(pTL.x, pTL.y);
      ctx.lineTo(pTR.x, pTR.y);
      ctx.lineTo(pBR.x, pBR.y);
      ctx.lineTo(pBL.x, pBL.y);
      ctx.closePath();
      ctx.fill();

      // Debug overlay
      if (this.showDebug) {
        const cx = (pTL.x + pTR.x + pBR.x + pBL.x) / 4;
        const cy = (pTL.y + pTR.y + pBR.y + pBL.y) / 4;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(cx - 14, cy - 5, 28, 10);
        ctx.fillStyle = '#ffcc00';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(q.sourceKey, cx, cy + 3);
      }
    }

    canvas.refresh();

    // ================================================================
    // 5. Image Phaser unique
    // ================================================================
    this.mapImage = this.scene.add.image(offsetX, offsetY, this.canvasKey);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setDepth(0);

    // ================================================================
    // 6. Arbres (sprites du jeu par-dessus le terrain)
    // ================================================================
    this.renderTrees(quads, origin);
  }

  // ================================================================
  // Pattern Fill
  // ================================================================

  /**
   * Crée un CanvasPattern à partir de la texture de base (RoughA0001).
   * Toutes les tuiles partagent le même pattern → jointure invisible.
   *
   * Fallback : si la texture n'est pas disponible en tant qu'image
   * source (WebGL), on tente une image HTML classique.
   */
  private createGrassPattern(
    ctx: CanvasRenderingContext2D,
  ): CanvasPattern | null {
    // On essaie d'abord via la texture Phaser
    const srcKey = 'RoughA0001';
    const tex = this.scene.textures.get(srcKey);
    const srcImg = tex?.getSourceImage() as CanvasImageSource | null;

    if (srcImg) {
      try {
        const p = ctx.createPattern(srcImg, 'repeat');
        if (p) return p;
      } catch {
        // Ignore — on tente le fallback
      }
    }

    // Fallback : créer une texture d'herbe procédurale 64×64
    // et l'utiliser comme pattern
    console.warn('[TileRenderer] createPattern fallback — génération procédurale');
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
  // Arbres (sprites du jeu)
  // ================================================================

  // Clés des textures d'arbres du jeu (chargées par BootScene)
  private readonly TREE_KEYS = [
    'Tree_TreeMapleSmall', 'Tree_TreeMapleMedium',
    'Tree_TreePineSmall', 'Tree_TreePineMedium',
    'Tree_TreePineFirSm', 'Tree_TreePineFirMed',
    'Tree_Scenic_Tree', 'Tree_BlackPine',
    'Tree_WillowTree', 'Tree_TreeMapleLarge',
  ];

  /**
   * Crée les sprites d'arbres pour toutes les tuiles de type TREE.
   * Utilise les textures du jeu original (redimensionnées).
   * Tri painter's algorithm par profondeur (x + y).
   */
  private renderTrees(
    quads: Array<{ x: number; y: number; hTL: number; hTR: number; hBR: number; hBL: number }>,
    origin: { screenX: number; screenY: number },
  ): void {
    // Collecter les tuiles qui sont des arbres
    const treeTiles: Array<{ x: number; y: number; scrX: number; scrY: number; depth: number; variant: number }> = [];

    for (const q of quads) {
      const tile = this.terrain.tileAt(q.x, q.y);
      if (!tile || tile.type !== TileType.TREE) continue;

      const avgH = (q.hTL + q.hTR + q.hBR + q.hBL) / 4;
      // Position : centre de la tuile à la hauteur moyenne
      const pos = mapToScreen(q.x, q.y, 0);
      const scrX = pos.screenX - origin.screenX;
      const scrY = pos.screenY - origin.screenY - avgH * TILE_D;

      treeTiles.push({
        x: q.x, y: q.y,
        scrX, scrY,
        depth: q.x + q.y,
        variant: tile.variation % 9,
      });
    }

    // Trier par profondeur (idem painter's algorithm)
    treeTiles.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.x - b.x;
    });

    // Créer les Images
    for (const t of treeTiles) {
      const texKey = this.TREE_KEYS[t.variant % this.TREE_KEYS.length];
      if (!this.scene.textures.exists(texKey)) continue;

      const img = this.scene.add.image(t.scrX, t.scrY, texKey);
      img.setOrigin(0.5, 1); // ancrage bas-centre → le tronc touche le sol
      img.setDepth((t.x + t.y) * 16 + 1000); // toujours devant le terrain
      img.setName(`tree_${t.x}_${t.y}`);
      this.treeImages.push(img);
    }
  }

  // ================================================================
  // Helpers
  // ================================================================

  /**
   * Projette un sommet (vx, vy, h) en coordonnées écran,
   * relatif à mapToScreen(0, 0).
   */
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
    for (const img of this.treeImages) img.destroy();
    this.treeImages = [];
  }
}
