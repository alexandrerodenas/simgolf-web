/**
 * SlopedTextureGenerator — Génère des textures de tuile pentues.
 *
 * Mappe la texture d'herbe du jeu sur le quadrilatère formé par
 * les 4 sommets (2 triangles affines, diagonale invisible).
 *
 * Anti-gap :
 *   1. Remplissage opaque du quad avant le texturing
 *   2. Bleed de 1px vers l'extérieur sur chaque sommet
 *   3. Pas de stroke/bordure
 */

import Phaser from 'phaser';
import { mapToScreen } from './CoordinateSystem';

// ================================================================
// ShapeKey
// ================================================================

export function shapeKey(
  hTL: number, hTR: number, hBR: number, hBL: number,
): string {
  const h = [hTL, hTR, hBR, hBL];
  const min = Math.min(...h);
  return h.map(v => v - min).join(',');
}

// ================================================================
// Générateur
// ================================================================

export class SlopedTextureGenerator {
  private scene: Phaser.Scene;
  private cache = new Map<string, string>();
  private readonly sourceTextureKey: string;
  /** Couleur unie de remplissage anti-gap (vert herbe moyen) */
  private readonly fillColor = '#4a8f4a';

  constructor(scene: Phaser.Scene, sourceTextureKey = 'RoughA0001') {
    this.scene = scene;
    this.sourceTextureKey = sourceTextureKey;
  }

  getTextureKey(
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): string {
    const key = shapeKey(hTL, hTR, hBR, hBL);
    const texKey = `slope_${key}`;

    if (this.scene.textures.exists(texKey)) return texKey;
    if (this.cache.has(key)) return this.cache.get(key)!;

    this.generate(texKey, hTL, hTR, hBR, hBL);
    this.cache.set(key, texKey);

    return texKey;
  }

  // ================================================================
  // Génération
  // ================================================================

  private generate(
    texKey: string,
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): void {
    const origin = mapToScreen(0, 0);
    const vert = (vx: number, vy: number, h: number) => {
      const p = mapToScreen(vx, vy, h);
      return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
    };

    // 4 sommets à leurs hauteurs réelles
    const tl = vert(0, 0, hTL);
    const tr = vert(1, 0, hTR);
    const br = vert(1, 1, hBR);
    const bl = vert(0, 1, hBL);
    const corners = [tl, tr, br, bl];

    // Centre pour le calcul du bleed
    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    // Bleed : pousse chaque sommet de 1px vers l'extérieur
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

    // Bounding box avec marge
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

    // Créer le canvas Phaser
    const canvas = this.scene.textures.createCanvas(texKey, canvasW, canvasH);
    if (!canvas) return;
    const ctx = canvas.context;
    ctx.clearRect(0, 0, canvasW, canvasH);

    // === Étape 1 : Remplissage opaque du quad (anti-gap) ===
    const [pTL, pTR, pBR, pBL] = shifted;
    ctx.fillStyle = this.fillColor;
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.fill();

    // === Étape 2 : Texture mappée par triangles affines ===
    const srcTex = this.scene.textures.get(this.sourceTextureKey);
    const srcImg = srcTex.getSourceImage() as CanvasImageSource;
    if (!srcImg) {
      console.warn(`[SlopedTexture] Source manquante: ${this.sourceTextureKey}`);
      return;
    }

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

  /**
   * Triangle texturé via affine transform.
   * Pas de clip() — on utilise le remplissage opaque pour les bords.
   * Le transform est exact : le triangle source 64×64 est mappé
   * sur le triangle cible.
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
    // Matrice affine : x = a*u + b*v + c, y = d*u + e*v + f
    // Avec les 3 contraintes UV → XY, on résout :
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

    // Pas de stroke : lineWidth = 0, pas de bordure
  }
}
