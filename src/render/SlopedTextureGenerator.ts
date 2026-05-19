/**
 * SlopedTextureGenerator — Génère des textures de tuile pentues
 * en mappant la texture d'herbe du jeu sur un quadrilatère quelconque.
 *
 * Pour chaque forme géométrique unique (définie par les 4 hauteurs),
 * on pré-calcule une texture en dessinant l'herbe avec un transform
 * affine par triangle (Canvas 2D). Pas de diagonale visible.
 *
 * Résultat : ~20 textures pré-calculées, réutilisées par toutes les tuiles.
 */

import Phaser from 'phaser';
import { mapToScreen } from './CoordinateSystem';
import { TILE_W, TILE_H, TILE_D } from './CoordinateSystem';

// ================================================================
// ShapeKey → identifiant unique pour une configuration de hauteurs
// ================================================================

export function shapeKey(
  hTL: number, hTR: number, hBR: number, hBL: number,
): string {
  const h = [hTL, hTR, hBR, hBL];
  const min = Math.min(...h);
  return h.map(v => v - min).join(',');
}

// ================================================================
// Générateur de textures pentues
// ================================================================

export class SlopedTextureGenerator {
  private scene: Phaser.Scene;
  private cache = new Map<string, string>();
  private readonly sourceTextureKey: string;

  constructor(scene: Phaser.Scene, sourceTextureKey = 'RoughA0001') {
    this.scene = scene;
    this.sourceTextureKey = sourceTextureKey;
  }

  /**
   * Retourne la clé de texture pour une configuration de hauteurs donnée.
   * Génère et met en cache la texture si elle n'existe pas encore.
   */
  getTextureKey(
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): string {
    const key = shapeKey(hTL, hTR, hBR, hBL);
    const texKey = `slope_${key}`;

    if (this.scene.textures.exists(texKey)) return texKey;
    if (this.cache.has(key)) return this.cache.get(key)!;

    this.generate(key, texKey, hTL, hTR, hBR, hBL);
    this.cache.set(key, texKey);

    return texKey;
  }

  // ================================================================
  // Génération d'une texture
  // ================================================================

  private generate(
    key: string,
    texKey: string,
    hTL: number, hTR: number, hBR: number, hBL: number,
  ): void {
    // Positions écran des 4 sommets (relatives à l'origine)
    const origin = mapToScreen(0, 0);
    const vert = (vx: number, vy: number, h: number) => {
      const p = mapToScreen(vx, vy, h);
      return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
    };

    // Les 4 sommets de la tuile à LEURS hauteurs réelles
    const tl = vert(0, 0, hTL);
    const tr = vert(1, 0, hTR);
    const br = vert(1, 1, hBR);
    const bl = vert(0, 1, hBL);
    const corners = [tl, tr, br, bl];

    // Bounding box
    const minX = Math.min(...corners.map(c => c.x));
    const maxX = Math.max(...corners.map(c => c.x));
    const minY = Math.min(...corners.map(c => c.y));
    const maxY = Math.max(...corners.map(c => c.y));

    const margin = 2;
    const canvasW = Math.ceil(maxX - minX) + margin * 2;
    const canvasH = Math.ceil(maxY - minY) + margin * 2;

    // Décaler les sommets pour qu'ils tiennent dans le canvas
    const offsetX = minX - margin;
    const offsetY = minY - margin;
    const pts = corners.map(c => ({
      x: c.x - offsetX,
      y: c.y - offsetY,
    }));

    // Créer le canvas Phaser
    const canvas = this.scene.textures.createCanvas(texKey, canvasW, canvasH);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Source texture (64×64 grass)
    const srcTex = this.scene.textures.get(this.sourceTextureKey);
    const srcImg = srcTex.getSourceImage() as CanvasImageSource;

    if (!srcImg) {
      console.warn(`[SlopedTexture] Source manquante: ${this.sourceTextureKey}`);
      return;
    }

    // === Dessiner les 2 triangles avec affine transform ===

    // Triangle 1 : TL → TR → BR
    this.drawTexturedTriangle(
      ctx, srcImg,
      pts[0].x, pts[0].y,  // TL
      pts[1].x, pts[1].y,  // TR
      pts[2].x, pts[2].y,  // BR
      0, 0, 1, 0, 1, 1,    // UV: (0,0), (1,0), (1,1)
    );

    // Triangle 2 : TL → BR → BL
    this.drawTexturedTriangle(
      ctx, srcImg,
      pts[0].x, pts[0].y,  // TL
      pts[2].x, pts[2].y,  // BR
      pts[3].x, pts[3].y,  // BL
      0, 0, 1, 1, 0, 1,    // UV: (0,0), (1,1), (0,1)
    );

    canvas.refresh();
  }

  /**
   * Dessine un triangle avec texture mappée via affine transform.
   *
   * Le transform affine est calculé pour mapper l'UV (u,v) → (x,y)
   * de sorte que les 3 coins UV tombent exactement sur les 3 sommets.
   */
  private drawTexturedTriangle(
    ctx: CanvasRenderingContext2D,
    srcImg: CanvasImageSource,
    x0: number, y0: number,  // Sommet 0
    x1: number, y1: number,  // Sommet 1
    x2: number, y2: number,  // Sommet 2
    u0: number, v0: number,  // UV sommet 0
    u1: number, v1: number,  // UV sommet 1
    u2: number, v2: number,  // UV sommet 2
  ): void {
    // Transformer UV → XY
    // x = a*u + b*v + c
    // y = d*u + e*v + f
    //
    // Avec UV(0,0) → (c, f) = (x0, y0)
    // UV(1,0) → (a+c, d+f) = (x1-x0, y1-y0)
    // UV(0,1) → (b+c, e+f) = (x2-x0, y2-y0)

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

    // Appliquer le transform affine inverse
    // On mappe le rectangle source (0,0)-(64,64) vers le triangle
    ctx.setTransform(a, d, b, e, c, f);
    ctx.drawImage(srcImg, 0, 0, 64, 64);

    ctx.restore();
  }
}
