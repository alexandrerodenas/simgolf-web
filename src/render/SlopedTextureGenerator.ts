/**
 * SlopedTextureGenerator — Génère des textures de tuile pentues.
 *
 * Pour chaque combinaison unique (forme géométrique + texture source),
 * pré-calcule une texture où l'herbe est mappée sur le quadrilatère
 * via 2 triangles affines (Canvas 2D).
 *
 * Anti-gap :
 *   1. Remplissage opaque du quad avant le texturing
 *   2. Bleed de 1px vers l'extérieur
 *   3. Pas de stroke
 */

import Phaser from 'phaser';
import { mapToScreen } from './CoordinateSystem';

// ================================================================
// Générateur
// ================================================================

export class SlopedTextureGenerator {
  private scene: Phaser.Scene;
  private cache = new Map<string, string>();
  /** Couleur unie de remplissage anti-gap */
  private readonly fillColor = '#4a8f4a';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Retourne la clé de texture pour une forme + texture source.
   * Génère et met en cache si nécessaire.
   *
   * @param sourceKey  Clé de la texture source (ex: 'RoughB0003')
   * @param hTL,hTR,hBR,hBL  Hauteurs des 4 sommets
   */
  getTextureKey(
    sourceKey: string,
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): string {
    // Cache key = combinaison de la forme ET de la source
    const cacheKey = `${sourceKey}_${this.shapeKey(hTL, hTR, hBR, hBL)}`;
    const texKey = `slope_${cacheKey}`;

    if (this.scene.textures.exists(texKey)) return texKey;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    this.generate(texKey, sourceKey, hTL, hTR, hBR, hBL);
    this.cache.set(cacheKey, texKey);

    return texKey;
  }

  private shapeKey(
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): string {
    const h = [hTL, hTR, hBR, hBL];
    const min = Math.min(...h);
    return h.map(v => v - min).join(',');
  }

  // ================================================================
  // Génération
  // ================================================================

  private generate(
    texKey: string,
    sourceKey: string,
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): void {
    const origin = mapToScreen(0, 0);
    const vert = (vx: number, vy: number, h: number) => {
      const p = mapToScreen(vx, vy, h);
      return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
    };

    const tl = vert(0, 0, hTL);
    const tr = vert(1, 0, hTR);
    const br = vert(1, 1, hBR);
    const bl = vert(0, 1, hBL);
    const corners = [tl, tr, br, bl];

    // Centre pour le bleed
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    // Bleed 1px vers l'extérieur
    const bleed = 1;
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
    const pts = corners.map(expand);

    // Bounding box
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));

    const margin = 2;
    const canvasW = Math.ceil(maxX - minX) + margin * 2;
    const canvasH = Math.ceil(maxY - minY) + margin * 2;

    const offsetX = minX - margin;
    const offsetY = minY - margin;
    const shifted = pts.map(p => ({
      x: p.x - offsetX,
      y: p.y - offsetY,
    }));

    // Canvas Phaser
    const canvas = this.scene.textures.createCanvas(texKey, canvasW, canvasH);
    if (!canvas) return;
    const ctx = canvas.context;
    ctx.clearRect(0, 0, canvasW, canvasH);

    // === Étape 1 : Remplissage opaque ===
    const [pTL, pTR, pBR, pBL] = shifted;
    ctx.fillStyle = this.fillColor;
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.fill();

    // === Étape 2 : Texture source ===
    const srcTex = this.scene.textures.get(sourceKey);
    if (!srcTex || !srcTex.key) {
      // Fallback sur RoughA0001
      const fallback = this.scene.textures.get('RoughA0001');
      if (!fallback) return;
    }
    const srcImg = (this.scene.textures.get(sourceKey) || this.scene.textures.get('RoughA0001')!).getSourceImage() as CanvasImageSource;
    if (!srcImg) return;

    // Triangle 1 : TL → TR → BR
    this.drawTexturedTriangle(ctx, srcImg,
      pTL.x, pTL.y, pTR.x, pTR.y, pBR.x, pBR.y,
      0, 0, 1, 0, 1, 1);

    // Triangle 2 : TL → BR → BL
    this.drawTexturedTriangle(ctx, srcImg,
      pTL.x, pTL.y, pBR.x, pBR.y, pBL.x, pBL.y,
      0, 0, 1, 1, 0, 1);

    canvas.refresh();
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
    const a = x1 - x0;
    const b = x2 - x0;
    const c = x0;
    const d = y1 - y0;
    const e = y2 - y0;
    const f = y0;

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
}
