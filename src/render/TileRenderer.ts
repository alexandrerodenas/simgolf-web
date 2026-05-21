/**
 * SimGolf Web — Tile Renderer (pattern fill, géométrie continue)
 *
 * Chaque tuile est un quadrilatère aux 4 sommets projetés de leurs
 * hauteurs réelles. Remplissage : ctx.createPattern(texture, 'repeat').
 * Toutes les tuiles dans un CANVAS UNIQUE → zéro gap.
 * Tri painter's algorithm par profondeur (x + y).
 *
 * Éclairage :
 *   Vertex lighting (Gouraud shading) par tessellation.
 *   Chaque tuile est subdivisée en N×N sous-quads. Pour chaque sous-quad,
 *   la luminosité est interpolée bilinéairement depuis les 4 coins,
 *   puis appliquée via globalCompositeOperation = 'multiply'.
 *   La continuité inter-tuile est garantie car les coins adjacents de
 *   deux tuiles voisines lisent le même vertex de la heightmap.
 */

import Phaser from 'phaser';
import { TileData, TerrainEngine } from '../core';
import { TileType } from '../core/types';
import { mapToScreen } from './CoordinateSystem';

/** Nombre de subdivisions par tuile pour l'éclairage */
const LIGHT_SUBDIV = 8;

// ================================================================
// Textures Rock
// ================================================================

/** Noms des textures Rock (5 groupes × 9 variantes = 45) */
const ROCK_TEXTURES = (() => {
  const names: string[] = [];
  for (const group of ['A', 'B', 'C', 'D', 'E']) {
    for (let v = 1; v <= 9; v++) {
      names.push(`ROCK${group}${v.toString().padStart(4, '0')}`);
    }
  }
  return names;
})();

/** Noms des textures Woods (4 groupes × 9 variantes = 36) */
const WOODS_TEXTURES = (() => {
  const names: string[] = [];
  for (const group of ['A', 'B', 'C', 'D']) {
    for (let v = 1; v <= 9; v++) {
      names.push(`WOODS${group}${v.toString().padStart(4, '0')}`);
    }
  }
  return names;
})();

// ================================================================
// Éclairage directionnel
// ================================================================

/** Vecteur lumière directionnelle normalisé — simule un soleil
 *  venant du Nord-Ouest (haut-gauche en isométrique). */
const LIGHT_DIR: readonly [number, number, number] = [
  -0.409,  // X (Est-Ouest)
  -0.613,  // Y (Nord-Sud)
   0.707,  // Z (verticale)
];

/** Intensité minimale (ombre max) — les creux restent visibles */
const MIN_BRIGHTNESS = 0.65;

/** Pas spatial pour le calcul des normales */
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

/** Interpolation linéaire */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ================================================================
// Types internes
// ================================================================

interface QuadTile {
  x: number; y: number;
  verts: readonly [
    { x: number; y: number },  // TL
    { x: number; y: number },  // TR
    { x: number; y: number },  // BR
    { x: number; y: number },  // BL
  ];
  type: TileType;
  variation: number;
}

/**
 * Brightness aux 4 coins d'une tuile, dans [MIN_BRIGHTNESS, 1.0].
 * Ordre : [TL, TR, BR, BL].
 */
type TileBrightness = [number, number, number, number];

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

    // ── 1. Collecter les quads + brightness ──
    const origin = mapToScreen(0, 0);
    const quads: QuadTile[] = [];
    const brightMap = new Map<string, TileBrightness>();
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y, data } of tiles) {
      const [hTL, hTR, hBR, hBL] = this.terrain.getTileCorners(x, y);

      const verts = [
        this.vert(x,     y,     hTL, origin), // TL
        this.vert(x + 1, y,     hTR, origin), // TR
        this.vert(x + 1, y + 1, hBR, origin), // BR
        this.vert(x,     y + 1, hBL, origin), // BL
      ] as const;

      for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }

      quads.push({ x, y, verts, type: data.type, variation: data.variation });

      // Brightness – calculé une fois par tuile, stocké par clé
      const key = `${x},${y}`;
      brightMap.set(key, this.computeTileBrightness(x, y));
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

    // ── 5. Dessiner le terrain (pattern fill) ──
    for (const q of quads) {
      const [pTL, pTR, pBR, pBL] = q.verts;

      if (q.type === TileType.ROCK) {
        // Texture rocheuse en pattern fill
        this.drawRockTile(ctx, q);
      } else if (q.type === TileType.TREE) {
        // Texture Woods (sol forestier)
        this.drawWoodsTile(ctx, q);
      } else if (q.type === TileType.ROUGH) {
        // Herbe haute (Rough) — même pattern herbe, fond plus foncé
        ctx.fillStyle = '#3a7a3a';
        this.fillQuad(ctx, pTL, pTR, pBR, pBL);
        this.fillQuad(ctx, pTL, pTR, pBR, pBL);
        ctx.fillStyle = fillStyle;
        this.fillQuad(ctx, pTL, pTR, pBR, pBL);
      } else {
        // Fond opaque vert (anti-gap de transparence)
        ctx.fillStyle = '#4a8f4a';
        this.fillQuad(ctx, pTL, pTR, pBR, pBL);

        // Pattern herbe
        ctx.fillStyle = fillStyle;
        this.fillQuad(ctx, pTL, pTR, pBR, pBL);
      }
    }

    // ── 6. Lightmap overlay (multiply blend) ──
    this.renderLightmap(ctx, cw, ch, offsetX, offsetY, quads, brightMap);

    canvas.refresh();

    // ── 7. Image Phaser unique ──
    this.mapImage = this.scene.add.image(offsetX, offsetY, this.canvasKey);
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setDepth(0);
  }

  // ================================================================
  // Lightmap par tessellation (Gouraud shading)
  // ================================================================

  /**
   * Génère la lightmap par tessellation et la composite en mode multiply.
   *
   * Chaque tuile est divisée en LIGHT_SUBDIV × LIGHT_SUBDIV sous-quads.
   * La luminosité de chaque sommet de sous-quad est interpolée
   * bilinéairement depuis les 4 brightness des coins de la tuile.
   *
   * Chaque sous-quad est rempli d'un gris uniforme correspondant à la
   * moyenne de ses 4 coins. L'ensemble est composité sur le ctx
   * avec globalCompositeOperation = 'multiply'.
   */
  private renderLightmap(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    offsetX: number,
    offsetY: number,
    quads: QuadTile[],
    brightMap: Map<string, TileBrightness>,
  ): void {
    // Canvas offscreen pour la lightmap
    const lmCanvas = document.createElement('canvas');
    lmCanvas.width = cw;
    lmCanvas.height = ch;
    const lmCtx = lmCanvas.getContext('2d')!;
    // Fond blanc = 100% lumineux (aucun effet de multiply)
    lmCtx.fillStyle = '#ffffff';
    lmCtx.fillRect(0, 0, cw, ch);
    lmCtx.translate(-offsetX, -offsetY);

    const n = LIGHT_SUBDIV;

    for (const q of quads) {
      const [pTL, pTR, pBR, pBL] = q.verts;
      const b = brightMap.get(`${q.x},${q.y}`)!;
      if (!b) continue;

      const [bTL, bTR, bBR, bBL] = b;

      // Tessellation : parcourir chaque sous-cellule
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          // UV des 4 coins de la sous-cellule
          const u0 = sx / n;
          const u1 = (sx + 1) / n;
          const v0 = sy / n;
          const v1 = (sy + 1) / n;

          // Position écran des 4 coins de la sous-cellule
          // Par interpolation linéaire sur le quad
          const subTL = this.lerp2D(pTL, pTR, pBL, pBR, u0, v0);
          const subTR = this.lerp2D(pTL, pTR, pBL, pBR, u1, v0);
          const subBR = this.lerp2D(pTL, pTR, pBL, pBR, u1, v1);
          const subBL = this.lerp2D(pTL, pTR, pBL, pBR, u0, v1);

          // Brightness interpolé bilinéairement
          const bTLsub = lerp(lerp(bTL, bTR, u0), lerp(bBL, bBR, u0), v0);
          const bTRsub = lerp(lerp(bTL, bTR, u1), lerp(bBL, bBR, u1), v0);
          const bBRsub = lerp(lerp(bTL, bTR, u1), lerp(bBL, bBR, u1), v1);
          const bBLsub = lerp(lerp(bTL, bTR, u0), lerp(bBL, bBR, u0), v1);

          // Luminosité moyenne de la sous-cellule
          const avgB = (bTLsub + bTRsub + bBRsub + bBLsub) / 4;

          // Valeur de gris = brightness
          const gray = Math.round(avgB * 255);
          const hex = `rgb(${gray},${gray},${gray})`;

          lmCtx.fillStyle = hex;
          lmCtx.beginPath();
          lmCtx.moveTo(subTL.x, subTL.y);
          lmCtx.lineTo(subTR.x, subTR.y);
          lmCtx.lineTo(subBR.x, subBR.y);
          lmCtx.lineTo(subBL.x, subBL.y);
          lmCtx.closePath();
          lmCtx.fill();
        }
      }
    }

    // Composition : multiply = terrain × lightmap
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset world transform
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lmCanvas, 0, 0);
    ctx.restore();
  }

  /**
   * Interpolation bilinéaire sur un quadrilatère isométrique.
   * Calcule la position (x, y) correspondant aux coordonnées
   * locales (u, v) ∈ [0, 1]² dans le quad.
   *
   * Utilise deux interpolations linéaires : d'abord entre les
   * bords gauche et droit selon v, puis entre les résultats selon u.
   */
  private lerp2D(
    pTL: { x: number; y: number },
    pTR: { x: number; y: number },
    pBL: { x: number; y: number },
    pBR: { x: number; y: number },
    u: number,
    v: number,
  ): { x: number; y: number } {
    // Interpolation verticale : bord gauche (TL→BL) et bord droit (TR→BR)
    const leftX  = lerp(pTL.x, pBL.x, v);
    const leftY  = lerp(pTL.y, pBL.y, v);
    const rightX = lerp(pTR.x, pBR.x, v);
    const rightY = lerp(pTR.y, pBR.y, v);

    // Interpolation horizontale entre les bords gauche et droit
    return {
      x: lerp(leftX, rightX, u),
      y: lerp(leftY, rightY, u),
    };
  }

  // ================================================================
  // Calcul des normales et de l'éclairage
  // ================================================================

  /**
   * Calcule les 4 intensités lumineuses des coins de la tuile (x, y).
   * Retourne [bTL, bTR, bBR, bBL] dans [MIN_BRIGHTNESS, 1.0].
   *
   * Continuité garantie : le coin BR de la tuile (x, y) est STRICTEMENT
   * IDENTIQUE au coin TL de la tuile (x+1, y+1) car les deux lisent
   * le même vertex (x+1, y+1) de la heightmap.
   */
  private computeTileBrightness(tileX: number, tileY: number): TileBrightness {
    const t = this.terrain;

    return [
      this.vertexBrightness(t, tileX,     tileY),      // TL
      this.vertexBrightness(t, tileX + 1, tileY),      // TR
      this.vertexBrightness(t, tileX + 1, tileY + 1),  // BR
      this.vertexBrightness(t, tileX,     tileY + 1),  // BL
    ];
  }

  /**
   * Calcule la normale d'un sommet de la heightmap par différences finies
   * centrées, puis retourne le brightness (dot product avec LIGHT_DIR).
   *
   * La normale = normalize(cross(dx, dy)) où :
   *   dx = [STEP, 0, hR - hL]    (tangente horizontale)
   *   dy = [0, STEP, hU - hD]    (tangente verticale)
   */
  private vertexBrightness(
    terrain: TerrainEngine,
    vx: number,
    vy: number,
  ): number {
    const hL = terrain.getVertex(vx - 1, vy);
    const hR = terrain.getVertex(vx + 1, vy);
    const hU = terrain.getVertex(vx, vy - 1);
    const hD = terrain.getVertex(vx, vy + 1);

    const dx: [number, number, number] = [STEP, 0, hR - hL];
    const dy: [number, number, number] = [0, STEP, hU - hD];
    const normal = normalize(cross(dx, dy));

    // Produit scalaire → remappé dans [MIN_BRIGHTNESS, 1.0]
    const d = dot(normal, LIGHT_DIR);
    return MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * (d + 1) / 2;
  }

  // ================================================================
  // Rendu des tuiles ROCK
  // ================================================================

  /**
   * Dessine une tuile ROCK avec sa texture pattern fill.
   * La variation (1-45) détermine quelle texture rockA/E0001-0009 utiliser.
   */
  private drawRockTile(
    ctx: CanvasRenderingContext2D,
    quad: QuadTile,
  ): void {
    const [pTL, pTR, pBR, pBL] = quad.verts;
    const idx = (quad.variation - 1) % ROCK_TEXTURES.length;
    const textureKey = ROCK_TEXTURES[idx];

    // Debug : vérifier si la texture est trouvée
    const texCheck = this.scene.textures.get(textureKey);
    if (!texCheck || !texCheck.key) {
      console.warn(`[TileRenderer] Texture Rock introuvable: "${textureKey}"`);
    }

    // Fond opaque gris-brun (couleur de base de la roche)
    ctx.fillStyle = '#6a5a4a';
    this.fillQuad(ctx, pTL, pTR, pBR, pBL);
    this.fillQuad(ctx, pTL, pTR, pBR, pBL);

    // Pattern rock
    const pattern = this.getRockPattern(ctx, textureKey);
    if (pattern) {
      ctx.fillStyle = pattern;
    } else {
      // Fallback : utiliser la même texture herbe que le reste
      const grassPattern = this.createGrassPattern(ctx);
      ctx.fillStyle = grassPattern || '#4a8f4a';
    }
    this.fillQuad(ctx, pTL, pTR, pBR, pBL);
  }

  // ================================================================
  // Rendu des tuiles WOODS (sol forestier)
  // ================================================================

  /**
   * Dessine une tuile TREE avec sa texture Woods pattern fill.
   * La variation (1-36) détermine quelle texture WOODSA/D0001-0009 utiliser.
   */
  private drawWoodsTile(
    ctx: CanvasRenderingContext2D,
    quad: QuadTile,
  ): void {
    const [pTL, pTR, pBR, pBL] = quad.verts;
    const idx = (quad.variation - 1) % WOODS_TEXTURES.length;
    const textureKey = WOODS_TEXTURES[idx];

    // Fond opaque vert foncé (couleur de base de la forêt)
    ctx.fillStyle = '#2d5a1e';
    this.fillQuad(ctx, pTL, pTR, pBR, pBL);
    this.fillQuad(ctx, pTL, pTR, pBR, pBL);

    // Pattern Woods
    const pattern = this.getWoodsPattern(ctx, textureKey);
    if (pattern) {
      ctx.fillStyle = pattern;
    } else {
      const grassPattern = this.createGrassPattern(ctx);
      ctx.fillStyle = grassPattern || '#2d5a1e';
    }
    this.fillQuad(ctx, pTL, pTR, pBR, pBL);
  }

  /** Cache de patterns Woods */
  private woodsPatternCache = new Map<string, CanvasPattern | null>();

  private getWoodsPattern(
    ctx: CanvasRenderingContext2D,
    textureKey: string,
  ): CanvasPattern | null {
    if (this.woodsPatternCache.has(textureKey)) {
      return this.woodsPatternCache.get(textureKey) ?? null;
    }

    const tex = this.scene.textures.get(textureKey);
    const srcImg = tex?.getSourceImage() as CanvasImageSource | null;

    if (srcImg) {
      try {
        const p = ctx.createPattern(srcImg, 'repeat');
        this.woodsPatternCache.set(textureKey, p ?? null);
        return p ?? null;
      } catch {
        // fallback
      }
    }

    this.woodsPatternCache.set(textureKey, null);
    return null;
  }

  /** Cache de patterns Rock */
  private rockPatternCache = new Map<string, CanvasPattern | null>();

  private getRockPattern(
    ctx: CanvasRenderingContext2D,
    textureKey: string,
  ): CanvasPattern | null {
    if (this.rockPatternCache.has(textureKey)) {
      return this.rockPatternCache.get(textureKey) ?? null;
    }

    const tex = this.scene.textures.get(textureKey);
    const srcImg = tex?.getSourceImage() as CanvasImageSource | null;

    if (srcImg) {
      try {
        const p = ctx.createPattern(srcImg, 'repeat');
        this.rockPatternCache.set(textureKey, p ?? null);
        return p ?? null;
      } catch {
        // fallback
      }
    }

    this.rockPatternCache.set(textureKey, null);
    return null;
  }

  // ================================================================
  // Pattern herbe
  // ================================================================

  private createGrassPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const srcKey = 'ROUGHA0001';
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
    this.woodsPatternCache.clear();
    this.rockPatternCache.clear();
    if (this.scene.textures.exists(this.canvasKey)) {
      this.scene.textures.remove(this.canvasKey);
    }
  }
}
