/**
 * SlopedTextureGenerator — Génère des textures de tuile pentues.
 *
 * Deux modes :
 *   1. getTextureKey() — crée une texture canvas individuelle (mode legacy)
 *   2. renderQuadToContext() — dessine une tuile texturée dans un contexte existant
 *      → utilisé pour le rendu canvas unique (anti-gap)
 *
 * Chaque tuile est un quadrilatère texturé via 2 triangles affines.
 * Anti-gap en mode canvas unique : pas de jointure entre canvas individuels.
 */

import Phaser from 'phaser';
import { mapToScreen } from './CoordinateSystem';
import { getShapeLetter, getCosmeticVariant, buildTextureSourceName } from './ShapeClassifier';
import type { TerrainEngine } from '../core';

export class SlopedTextureGenerator {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Retourne la clé de texture source pour une tuile (ex: "RoughB0003").
   */
  getSourceKey(
    hTL: number, hTR: number, hBR: number, hBL: number,
    x: number, y: number,
    texturePrefix = 'Rough',
  ): string {
    const letter = getShapeLetter(hTL, hTR, hBR, hBL);
    const variant = getCosmeticVariant(x, y, 9);
    return buildTextureSourceName(texturePrefix, letter, variant);
  }

  /**
   * Retourne les 4 sommets de la tuile en coordonnées écran.
   */
  getCorners(
    x: number, y: number,
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): Array<{ x: number; y: number }> {
    const origin = mapToScreen(0, 0);
    const v = (vx: number, vy: number, h: number) => {
      const p = mapToScreen(vx, vy, h);
      return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
    };
    return [
      v(x,     y,     hTL),
      v(x + 1, y,     hTR),
      v(x + 1, y + 1, hBR),
      v(x,     y + 1, hBL),
    ];
  }

  /**
   * Dessine une tuile texturée dans le contexte canvas donné.
   * Utilise 2 triangles affines pour mapper la texture sur le quadrilatère.
   * La tuile est tracée avec un petit bleed pour éviter les trous.
   */
  renderQuadToContext(
    ctx: CanvasRenderingContext2D,
    srcImg: CanvasImageSource,
    tl: { x: number; y: number },
    tr: { x: number; y: number },
    br: { x: number; y: number },
    bl: { x: number; y: number },
  ): void {
    // Centre pour le bleed
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    // Bleed 2px vers l'extérieur (plus serré que l'ancien 1px)
    const bleed = 2;
    const expand = (p: { x: number; y: number }) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) return p;
      return {
        x: p.x + (dx / len) * bleed,
        y: p.y + (dy / len) * bleed,
      };
    };

    const [pTL, pTR, pBR, pBL] = [tl, tr, br, bl].map(expand);

    // Remplissage de fond opaque (anti-gap)
    ctx.fillStyle = '#4a8f4a';
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.fill();

    // Texture : triangle TL-TR-BR
    this.drawTexturedTriangle(ctx, srcImg,
      pTL.x, pTL.y, pTR.x, pTR.y, pBR.x, pBR.y,
      0, 0, 1, 0, 1, 1);

    // Texture : triangle TL-BR-BL
    this.drawTexturedTriangle(ctx, srcImg,
      pTL.x, pTL.y, pBR.x, pBR.y, pBL.x, pBL.y,
      0, 0, 1, 1, 0, 1);
  }

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
    const a = x1 - x0, b = x2 - x0, c = x0;
    const d = y1 - y0, e = y2 - y0, f = y0;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();

    ctx.setTransform(a, d, b, e, c, f);
    ctx.drawImage(srcImg, 0, 0, 64, 64);
    ctx.restore();
  }

  // ================================================================
  // Mode legacy (texture canvas individuelle)
  // ================================================================

  /**
   * Mode legacy : crée une texture canvas individuelle pour une tuile.
   * Utilisé uniquement si on a besoin de textures détachées.
   */
  getTextureKey(
    sourceKey: string,
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): string {
    const corners = this.getCorners(0, 0, hTL, hTR, hBR, hBL);
    const [tl, tr, br, bl] = corners;
    const cacheKey = `${sourceKey}_${this.shapeKey(hTL, hTR, hBR, hBL)}`;
    const texKey = `slope_${cacheKey}`;

    if (this.scene.textures.exists(texKey)) return texKey;

    this.generateLegacy(texKey, sourceKey, tl, tr, br, bl);
    return texKey;
  }

  private shapeKey(hTL: number, hTR: number, hBR: number, hBL: number): string {
    const h = [hTL, hTR, hBR, hBL];
    const min = Math.min(...h);
    return h.map(v => v - min).join(',');
  }

  private generateLegacy(
    texKey: string,
    sourceKey: string,
    tl: { x: number; y: number },
    tr: { x: number; y: number },
    br: { x: number; y: number },
    bl: { x: number; y: number },
  ): void {
    // Bounding box
    const allPts = [tl, tr, br, bl];
    const minX = Math.min(...allPts.map(p => p.x));
    const maxX = Math.max(...allPts.map(p => p.x));
    const minY = Math.min(...allPts.map(p => p.y));
    const maxY = Math.max(...allPts.map(p => p.y));

    const margin = 2;
    const canvasW = Math.ceil(maxX - minX) + margin * 2;
    const canvasH = Math.ceil(maxY - minY) + margin * 2;

    if (canvasW <= 0 || canvasH <= 0) return;

    const offsetX = minX - margin;
    const offsetY = minY - margin;

    const canvas = this.scene.textures.createCanvas(texKey, canvasW, canvasH);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.save();
    ctx.translate(-offsetX, -offsetY);

    // Obtient la texture source
    const srcImg = this.getSourceImage(sourceKey);
    if (srcImg) {
      this.renderQuadToContext(ctx, srcImg, tl, tr, br, bl);
    } else {
      // Fallback : remplissage couleur
      ctx.fillStyle = '#4a8f4a';
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
    canvas.refresh();
  }

  private getSourceImage(sourceKey: string): CanvasImageSource | null {
    const tex = this.scene.textures.get(sourceKey);
    const srcImg = tex?.getSourceImage() as CanvasImageSource;
    return srcImg || null;
  }
}
