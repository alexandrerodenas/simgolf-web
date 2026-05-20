/**
 * SimGolf Web — Tile Renderer (canvas unique)
 *
 * Au lieu de créer une Image Phaser par tuile (ce qui cause des gaps
 * aux jointures entre tuiles pentues), rend TOUTES les tuiles dans
 * un seul canvas → pas de décalage entre canvas individuels.
 *
 * La texture source est celle du jeu original (RoughA0001-E0005.png),
 * choisie selon la forme A-E et la variante cosmétique (0001-0009).
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { SlopedTextureGenerator } from './SlopedTextureGenerator';
import { mapToScreen } from './CoordinateSystem';
import { MAP_SIZE } from '../config';

export class TileRenderer {
  private scene: Phaser.Scene;
  private terrain: TerrainEngine;
  private textureGen: SlopedTextureGenerator;
  private mapImage: Phaser.GameObjects.Image | null = null;
  private canvasKey = 'map_fullcanvas';
  private dirty = true;
  private showDebug = false;

  /** Décalage monde du canvas (position du pixel (0,0) du canvas dans le monde Phaser) */
  mapOffsetX = 0;
  mapOffsetY = 0;

  // Cache des images sources (textures du jeu)
  private srcCache = new Map<string, CanvasImageSource | null>();

  constructor(scene: Phaser.Scene, terrain: TerrainEngine) {
    this.scene = scene;
    this.terrain = terrain;
    this.textureGen = new SlopedTextureGenerator(scene);
  }

  setDebug(active: boolean): void { this.showDebug = active; }
  isDebug(): boolean { return this.showDebug; }

  /**
   * Marque le canvas comme à regénérer.
   */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Rendu complet de toute la carte dans un canvas unique.
   */
  renderAll(tiles: Array<{ x: number; y: number; data: TileData }>): void {
    if (tiles.length === 0) return;

    // Supprime l'ancienne image
    if (this.mapImage) {
      this.mapImage.destroy();
      this.mapImage = null;
    }

    // Supprime l'ancien canvas texture
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }

    // === Étape 1 : Calculer la bounding box globale ===
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    const allCorners: Array<{
      corners: Array<{ x: number; y: number }>;
      hTL: number; hTR: number; hBR: number; hBL: number;
      x: number; y: number;
      sourceKey: string;
    }> = [];

    for (const { x, y } of tiles) {
      const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);
      const sourceKey = this.textureGen.getSourceKey(hTL, hTR, hBR, hBL, x, y);
      const corners = this.textureGen.getCorners(x, y, hTL, hTR, hBR, hBL);

      // Bleed 2px
      const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
      const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
      const bleed = 2;
      const expanded = corners.map(p => {
        const dx = p.x - cx, dy = p.y - cy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return p;
        return { x: p.x + (dx / len) * bleed, y: p.y + (dy / len) * bleed };
      });

      for (const p of expanded) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }

      allCorners.push({ x, y, corners, hTL, hTR, hBR, hBL, sourceKey });
    }

    const margin = 2;
    const canvasW = Math.ceil(maxX - minX) + margin * 2;
    const canvasH = Math.ceil(maxY - minY) + margin * 2;

    if (canvasW <= 0 || canvasH <= 0) {
      console.warn('[TileRenderer] Canvas vide');
      return;
    }

    // === Étape 2 : Créer le canvas ===
    const canvas = this.scene.textures.createCanvas(this.canvasKey, canvasW, canvasH);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Décalage pour que la map soit centrée dans le canvas
    const offsetX = minX - margin;
    const offsetY = minY - margin;

    ctx.save();
    ctx.translate(-offsetX, -offsetY);

    // === Étape 3 : Trier (painter's algorithm) ===
    // Ordre : arrière (y petit, x petit) → avant (y grand, x grand)
    // Pour l'isométrique, on trie par (x + y) puis par x
    allCorners.sort((a, b) => {
      const depthA = a.x + a.y;
      const depthB = b.x + b.y;
      if (depthA !== depthB) return depthA - depthB;
      return a.x - b.x;
    });

    // === Étape 4 : Dessiner chaque tuile ===
    for (const entry of allCorners) {
      const srcImg = this.getSourceImage(entry.sourceKey);
      if (!srcImg) continue;

      this.textureGen.renderQuadToContext(
        ctx, srcImg,
        entry.corners[0], entry.corners[1],
        entry.corners[2], entry.corners[3],
      );

      // Debug overlay : étiquette de variante
      if (this.showDebug) {
        const avgH = (entry.hTL + entry.hTR + entry.hBR + entry.hBL) / 4;
        const cx = (entry.corners[0].x + entry.corners[1].x + entry.corners[2].x + entry.corners[3].x) / 4;
        const cy = (entry.corners[0].y + entry.corners[1].y + entry.corners[2].y + entry.corners[3].y) / 4;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(cx - 12, cy - 5, 24, 10);
        ctx.fillStyle = '#ffcc00';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(entry.sourceKey, cx, cy + 3);
      }
    }

    ctx.restore();
    canvas.refresh();

    // === Étape 5 : Créer l'Image Phaser ===
    // Positionnée au coin haut-gauche de la map (dans le monde Phaser)
    this.mapOffsetX = offsetX;
    this.mapOffsetY = offsetY;
    this.mapImage = this.scene.add.image(this.mapOffsetX, this.mapOffsetY, this.canvasKey);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setDepth(0);

    this.dirty = false;
  }

  /**
   * Récupère une image source depuis le cache.
   */
  private getSourceImage(key: string): CanvasImageSource | null {
    if (this.srcCache.has(key)) return this.srcCache.get(key)!;

    const tex = this.scene.textures.get(key);
    const src = tex?.getSourceImage() as CanvasImageSource ?? null;
    this.srcCache.set(key, src);
    return src;
  }

  /**
   * Nettoie tout (images, textures, cache).
   */
  clearAll(): void {
    if (this.mapImage) {
      this.mapImage.destroy();
      this.mapImage = null;
    }
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }
    this.srcCache.clear();
    this.dirty = true;
  }
}
