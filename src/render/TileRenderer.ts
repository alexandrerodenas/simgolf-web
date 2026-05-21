/**
 * SimGolf Web — Tile Renderer (pattern fill, géométrie continue)
 *
 * Chaque tuile est un quadrilatère aux 4 sommets projetés de leurs
 * hauteurs réelles. Remplissage : ctx.createPattern(texture, 'repeat').
 * Toutes les tuiles dans un CANVAS UNIQUE → zéro gap.
 * Tri painter's algorithm par profondeur (x + y).
 *
 * Éclairage : vertex lighting simulé par overlay de dégradés
 * par triangle (faux Gouraud shading). Les normales sont calculées
 * par différences finies sur la heightmap, la lumière directionnelle
 * fixe simule un soleil de fin de matinée.
 *
 * - GRASS : textures Rough en pattern fill + overlay éclairage
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { TileType } from '../core/types';
import { mapToScreen } from './CoordinateSystem';

// ================================================================
// Éclairage directionnel
// ================================================================

/** Vecteur lumière directionnelle normalisé — simule un soleil
 *  venant du Nord-Ouest (haut-gauche en isométrique). */
const LIGHT_DIR: readonly [number, number, number] = [
  -0.409,   // composante X (Est-Ouest)
  -0.613,   // composante Y (Nord-Sud)
   0.707,   // composante Z (verticale)
];

/** Intensité minimale (ombre max) */
const MIN_BRIGHTNESS = 0.65;

/** Pas de la grille pour le calcul des normales */
const STEP = 2;

// ================================================================
// Utilitaires vecteurs
// ================================================================

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ================================================================
// Quad interfa
// ================================================================

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
    const fillStyle = grassPattern || '#4a8f4a';

    // ── 5. Rendu de chaque tuile : pattern + éclairage ──
    for (const q of quads) {
      const [pTL, pTR, pBR, pBL] = q.verts;

      // Fond opaque + pattern fill
      ctx.fillStyle = '#4a8f4a';
      this.fillQuad(ctx, pTL, pTR, pBR, pBL);
      ctx.fillStyle = fillStyle;
      this.fillQuad(ctx, pTL, pTR, pBR, pBL);

      // ── Éclairage : vertex lighting par-dessus le pattern ──
      const brightness = this.computeTileBrightness(q.x, q.y);
      this.drawLighting(ctx, pTL, pTR, pBR, pBL, brightness);
    }

    canvas.refresh();

    // ── 6. Image Phaser unique ──
    this.mapImage = this.scene.add.image(offsetX, offsetY, this.canvasKey);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setDepth(0);
  }

  // ================================================================
  // Éclairage
  // ================================================================

  /**
   * Calcule les 4 intensités lumineuses des coins de la tuile (x, y).
   * Retourne [bTL, bTR, bBR, bBL] dans [MIN_BRIGHTNESS, 1.0].
   */
  private computeTileBrightness(
    tileX: number,
    tileY: number,
  ): [number, number, number, number] {
    const terrain = this.terrain;
    const vx = tileX, vy = tileY;

    // Normales aux 4 coins de la tuile
    const nTL = this.vertexNormal(terrain, vx,     vy);
    const nTR = this.vertexNormal(terrain, vx + 1, vy);
    const nBR = this.vertexNormal(terrain, vx + 1, vy + 1);
    const nBL = this.vertexNormal(terrain, vx,     vy + 1);

    return [
      this.brightness(nTL),
      this.brightness(nTR),
      this.brightness(nBR),
      this.brightness(nBL),
    ];
  }

  /**
   * Calcule la normale d'un sommet de la heightmap par différences finies.
   *
   * La normale est le produit vectoriel des tangentes X et Y au sommet.
   * Les hauteurs voisines (hL, hR, hU, hD) sont lues depuis la heightmap.
   * Le pas spatial horizontal/vertical est STEP (2 unités isométriques).
   */
  private vertexNormal(
    terrain: TerrainEngine,
    vx: number,
    vy: number,
  ): [number, number, number] {
    const hC = terrain.getVertex(vx, vy);
    const hL = terrain.getVertex(vx - 1, vy);
    const hR = terrain.getVertex(vx + 1, vy);
    const hU = terrain.getVertex(vx, vy - 1);
    const hD = terrain.getVertex(vx, vy + 1);

    // Tangentes : différence finie centrée
    const dx: [number, number, number] = [STEP, 0, hR - hL];
    const dy: [number, number, number] = [0, STEP, hU - hD];

    // Normale = cross(dx, dy), normalisée
    return normalize(cross(dx, dy));
  }

  /**
   * Produit scalaire normal → lumière, clampé dans [MIN_BRIGHTNESS, 1.0].
   */
  private brightness(normal: [number, number, number]): number {
    const d = dot(normal, LIGHT_DIR);
    // d ∈ [-1, 1] → on remappe dans [MIN_BRIGHTNESS, 1.0]
    return MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * (d + 1) / 2;
  }

  /**
   * Dessine l'overlay d'éclairage sur un quad.
   *
   * Le quad est divisé en 2 triangles. Chaque triangle reçoit un
   * gradient linéaire entre son sommet le plus lumineux et le plus
   * sombre, avec une opacité inversement proportionnelle à la luminosité.
   *
   * Pour chaque triangle on dessine un gradient noir semi-transparent
   * dont l'alpha varie de (1 - brightness_max) à (1 - brightness_min).
   */
  private drawLighting(
    ctx: CanvasRenderingContext2D,
    pTL: { x: number; y: number },
    pTR: { x: number; y: number },
    pBR: { x: number; y: number },
    pBL: { x: number; y: number },
    [bTL, bTR, bBR, bBL]: [number, number, number, number],
  ): void {
    // Triangle 1 : (TL, TR, BR)
    this.drawTriangleLighting(ctx, pTL, pTR, pBR, bTL, bTR, bBR);
    // Triangle 2 : (TL, BR, BL)
    this.drawTriangleLighting(ctx, pTL, pBR, pBL, bTL, bBR, bBL);
  }

  /**
   * Dessine l'overlay d'éclairage pour un triangle.
   * Crée un gradient linéaire entre le point le plus lumineux et
   * le plus sombre.
   */
  private drawTriangleLighting(
    ctx: CanvasRenderingContext2D,
    pA: { x: number; y: number },
    pB: { x: number; y: number },
    pC: { x: number; y: number },
    bA: number,
    bB: number,
    bC: number,
  ): void {
    // Trouver le point le plus lumineux et le plus sombre
    let brightP = pA, darkP = pA;
    let bRight = bA, bDark = bA;

    const check = (p: { x: number; y: number }, b: number) => {
      if (b > bRight) { bRight = b; brightP = p; }
      if (b < bDark)  { bDark  = b; darkP  = p; }
    };
    check(pB, bB);
    check(pC, bC);

    // Si pas de variation de luminosité → rien à dessiner
    if (bRight <= bDark) return;

    // Gradient du point lumineux vers le point sombre
    const alphaLight = 1 - bRight; // ~0 au max
    const alphaDark  = 1 - bDark;  // ~0.35 au max

    const grad = ctx.createLinearGradient(brightP.x, brightP.y, darkP.x, darkP.y);
    grad.addColorStop(0, `rgba(0, 0, 0, ${alphaLight.toFixed(3)})`);
    grad.addColorStop(1, `rgba(0, 0, 0, ${alphaDark.toFixed(3)})`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.lineTo(pC.x, pC.y);
    ctx.closePath();
    ctx.fill();
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

    // Fallback procédural
    console.warn('[TileRenderer] createGrassPattern fallback');
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 64;
    patternCanvas.height = 64;
    const pctx = patternCanvas.getContext('2d')!;
    this.drawFallbackGrass(pctx, 64, 64);
    return ctx.createPattern(patternCanvas, 'repeat') || null;
  }

  // ================================================================
  // Helpers
  // ================================================================

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

  private vert(
    vx: number, vy: number, h: number,
    origin: { screenX: number; screenY: number },
  ): { x: number; y: number } {
    const p = mapToScreen(vx, vy, h);
    return { x: p.screenX - origin.screenX, y: p.screenY - origin.screenY };
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
