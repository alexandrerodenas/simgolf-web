/**
 * terrain.ts — Terrain class
 *
 * Port TypeScript de Terrain.dll (SimGolf 2001, Maxis/Firaxis).
 *
 * Architecture :
 *   - Singleton (getInstance())
 *   - Grille de tiles avec édition d'élévation
 *   - Calcul de normales pour l'éclairage OpenGL
 *   - Multi-pass rendering avec textures et blending
 *   - Splines (Bezier, Cardinal) pour lissage
 *   - Chemins avec rendu de piste
 *
 * Sources : analyse rizin de Terrain.dll v6.1.4 (objdump + désassemble)
 */

import {
  ITile,
  TileType,
  CourseTheme,
  IRenderPass,
  ILightConfig,
  IMapState,
  TileFlags,
  TILE_W,
  TILE_H,
} from './types.js';

// ─── Familles de terrain (jeu original) ───

/**
 * Familles de terrain — 2 tuiles de même famille = pas de bordure.
 *  0 = grass   : Rough, DeepRough, Woods, Brush, Rock
 *  1 = play    : Fairway, Tee, Green
 *  2 = sand    : Bunker, GrassySand
 *  3 = water   : Shallow, Middle, Deep
 *  4 = path    : Path, Bridge, Ravine
 *  5 = building
 *  6 = cliff
 */
export const TERRAIN_FAMILY: Record<TileType, number> = {
  [TileType.Rough]:         0,
  [TileType.Tree]:          0,
  [TileType.Flower]:        0,
  [TileType.DeepRough]:     0,
  [TileType.Rock]:          0,
  [TileType.Marsh]:         3,
  [TileType.Overgrowth]:    0,
  [TileType.Fairway]:       1,
  [TileType.Tee]:           1,
  [TileType.PuttingGreen]:  1,
  [TileType.FirmFairway]:   1,
  [TileType.TrickyGreen]:   1,
  [TileType.SandBunker]:    2,
  [TileType.GrassySand]:    2,
  [TileType.GrassBunker]:   2,
  [TileType.PotSandBunker]: 2,
  [TileType.ZenSand]:       2,
  [TileType.WaterShallow]:  3,
  [TileType.WaterMiddle]:   3,
  [TileType.WaterDeep]:     3,
  [TileType.Path]:          4,
  [TileType.Bridge]:        4,
  [TileType.Ravine]:        4,
  [TileType.Building]:      5,
  [TileType.RetainingWall]: 5,
  [TileType.Cliff]:         6,
  [TileType.Brush]:         0,
  [TileType.Natural]:       0,
  [TileType.Vegetation]:    0,
  [TileType.Flowerbed]:     0,
};

// ─── Configuration des textures par type ───
// Nombre max de variations cosmétiques par type
export const MAX_VARIATION: Partial<Record<TileType, number>> = {
  [TileType.Rough]:         5,
  [TileType.DeepRough]:     9,
  [TileType.Fairway]:       5,
  [TileType.PuttingGreen]:  5,
  [TileType.SandBunker]:    5,
  [TileType.Tee]:           25,
  [TileType.GrassySand]:    9,
  [TileType.GrassBunker]:   9,
  [TileType.WaterShallow]:  9,
  [TileType.WaterMiddle]:   9,
  [TileType.WaterDeep]:     5,
  [TileType.Cliff]:         9,
  [TileType.Tree]:          9,
  [TileType.Flower]:        9,
  [TileType.Rock]:          9,
  [TileType.Marsh]:         9,
  [TileType.Overgrowth]:    9,
  [TileType.FirmFairway]:   9,
  [TileType.ZenSand]:       9,
  [TileType.TrickyGreen]:   5,
  [TileType.PotSandBunker]: 5,
};

// ─── Types qui ont des textures de bordure A-D ───
const TYPES_WITH_BORDER: Set<TileType> = new Set([
  TileType.WaterShallow,
  TileType.WaterMiddle,
  TileType.WaterDeep,
  TileType.Cliff,
  TileType.GrassBunker,
  TileType.GrassySand,
  TileType.Overgrowth,
  TileType.Ravine,
  TileType.Marsh,
]);

// ─── Types de terrain à texture unique ou multiple ───
const NUM_TEXTURED_TILES = 21; // string constant from Terrain.dll

// ─── Geométrie (Groupe A-E) ───

/**
 * Détermine le groupe géométrique (A-E) selon les 4 hauteurs des coins.
 * A = plat    (tous égaux)
 * B = pente   (2 adjacents égaux)
 * C = coin    (1 différent)
 * D = diagonale (opposés égaux)
 * E = raide   (écart ≥ 2 entre adjacents)
 */
export function getGeometryType(e: [number, number, number, number]): string {
  const [a, b, c, d] = e;
  if (Math.abs(a - b) >= 2 || Math.abs(b - c) >= 2 ||
      Math.abs(c - d) >= 2 || Math.abs(d - a) >= 2) return 'E';
  if (a === b && b === c && c === d) return 'A';
  if (a === c && b === d && a !== b) return 'D';
  if ((a === b && c === d && a !== c) ||
      (b === c && d === a && b !== d)) return 'B';
  return 'C';
}

// ─── Transitions (bordures entre familles) ───

/** Mapping de transition asymétrique entre familles */
function borderOverride(
  currType: TileType, neiType: TileType
): TileType | undefined {
  const fCurr = TERRAIN_FAMILY[currType] ?? 0;
  const fNei  = TERRAIN_FAMILY[neiType]  ?? 0;
  if (fCurr === fNei) return undefined;

  if (fCurr === 2 && fNei === 0) return TileType.GrassySand;
  if (fCurr === 0 && fNei === 2) return TileType.GrassBunker;
  if (fCurr === 2 && fNei === 1) return TileType.SandBunker;
  if (fCurr === 1 && fNei === 2) return TileType.GrassBunker;
  if (fCurr === 3 && fNei !== 3) return TileType.WaterShallow;
  if (fCurr !== 3 && fNei === 3) return TileType.Marsh;
  return undefined;
}

function needsBorder(currType: TileType, neiType: TileType): boolean {
  return TERRAIN_FAMILY[currType] !== TERRAIN_FAMILY[neiType];
}

// ─────── Terrain class (Port du singleton original) ───────

export class Terrain {
  private static _instance: Terrain | null = null;

  // Grille de terrain
  tiles: ITile[] = [];
  width = 0;
  height = 0;

  // État du système
  hdc: any = null;          // HDC Windows → WebGL context
  zoomLevel = 1;
  splineHeight = 1.0;
  initialized = false;
  theme: CourseTheme = CourseTheme.Parkland;

  // Éclairage
  lighting: ILightConfig = {
    ambient: [0.4, 0.4, 0.4, 1.0],
    diffuse: [0.8, 0.8, 0.8, 1.0],
    lightDir: [0.5, -0.5, 1.0],
  };

  // Données de collars (autour du trou)
  collars: number[] = [];

  // Callback de rendu (branché sur le WebGL ou Canvas)
  onRenderTile?: (tile: ITile, passes: IRenderPass[]) => void;

  // ── Singleton ──
  static getInstance(): Terrain {
    if (!this._instance) {
      this._instance = new Terrain();
    }
    return this._instance;
  }

  // ── Construction ──
  protected constructor() {
    // singleton
  }

  /**
   * initSystem — Initialise le système de terrain.
   * @param w     Largeur de la grille en tiles
   * @param h     Hauteur de la grille en tiles
   * @param hdc   Contexte de rendu (WebGLRenderingContext | null)
   * @param debug Mode debug (réserve des buffers)
   */
  initSystem(w: number, h: number, hdc: any, debug: boolean): void {
    this.width = w;
    this.height = h;
    this.hdc = hdc;
    this.initialized = true;

    // Allocation de la grille — eau plate par défaut
    this.resetTerrain();
    this.zoomLevel = 1;
    this.splineHeight = 1.0;

    // Initialisation des textures et états OpenGL
    if (hdc && typeof hdc === 'object') {
      // WebGL setup (délégué au renderer)
    }
  }

  /**
   * closeSystem — Ferme le système et libère les ressources.
   */
  closeSystem(): void {
    this.initialized = false;
    this.tiles = [];
    this.width = 0;
    this.height = 0;
    this.hdc = null;
  }

  // ── Manipulation de la grille ──

  /**
   * resetTerrain — Initialise toutes les tuiles en eau plate.
   */
  resetTerrain(): void {
    const n = this.width * this.height;
    this.tiles = new Array(n);
    for (let i = 0; i < n; i++) {
      const y = Math.floor(i / this.width);
      const x = i % this.width;
      this.tiles[i] = this.createTile(x, y, TileType.WaterDeep, [0, 0, 0, 0]);
    }
  }

  /**
   * tileAt — Retourne la tuile à (x, y), ou null si hors-grille.
   */
  tileAt(x: number, y: number): ITile | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tiles[y * this.width + x];
  }

  /**
   * tileHit — Même que tileAt (alias), retourne null si hors limites.
   */
  tileHit(x: number, y: number): ITile | null {
    return this.tileAt(x, y);
  }

  // ── Types de terrain ──

  /**
   * getType — Retourne le type d'une tuile.
   */
  getType(tile: ITile): number {
    return tile.type as number;
  }

  /**
   * setType — Change le type d'une tuile.
   * @param tile    La tuile
   * @param newType Nouveau TileType
   * @param effect  Sous-type/effet (ex: SandBunker 1A-4A)
   */
  setType(tile: ITile | null, newType: number, effect: number): void {
    if (!tile) return;
    tile.type = newType as TileType;
    tile.subType = effect;

    // Réassigner une variation aléatoire
    const maxVar = MAX_VARIATION[tile.type] ?? 1;
    tile.variation = Math.floor(Math.random() * maxVar);

    // Mettre à jour les flags de bordure
    this.updateBorderFlags(tile);
  }

  /**
   * getVariation — Retourne la variation cosmétique d'une tuile.
   */
  getVariation(tile: ITile): number {
    return tile.variation;
  }

  // ── Élévation ──

  /**
   * getElevation — Retourne l'élévation au coin donné d'une tuile.
   * @param tile   La tuile
   * @param corner 0=TL, 1=TR, 2=BR, 3=BL
   */
  getElevation(tile: ITile | null, corner: number): number {
    if (!tile || corner < 0 || corner > 3) return 0;
    return tile.elevation[corner];
  }

  /**
   * elevateCorner — Augmente l'élévation d'un coin d'une tuile.
   */
  elevateCorner(tile: ITile | null, corner: number): void {
    if (!tile || corner < 0 || corner > 3) return;
    if (tile.elevation[corner] < 4) {
      tile.elevation[corner]++;
      this.propagateElevation(tile, corner);
    }
  }

  /**
   * lowerCorner — Diminue l'élévation d'un coin d'une tuile.
   */
  lowerCorner(tile: ITile | null, corner: number): void {
    if (!tile || corner < 0 || corner > 3) return;
    if (tile.elevation[corner] > 0) {
      tile.elevation[corner]--;
      this.propagateElevation(tile, corner);
    }
  }

  /**
   * lowerEdgeCorner — Diminue l'élévation avec un facteur de lissage.
   */
  lowerEdgeCorner(tile: ITile | null, corner: number, neighbor: ITile | null, factor: number): void {
    if (!tile || corner < 0 || corner > 3) return;
    const delta = Math.max(1, Math.round(factor));
    tile.elevation[corner] = Math.max(0, tile.elevation[corner] - delta);
    this.propagateElevation(tile, corner);
  }

  /**
   * propagateElevation — Assure la cohérence des hauteurs avec les tuiles
   * voisines (contrainte d'écart max 1 entre coins adjacents).
   */
  private propagateElevation(tile: ITile, corner: number): void {
    // Propagation aux tuiles adjacentes selon le coin modifié
    // Chaque coin est partagé entre 1, 2 ou 4 tuiles
    const adj: Array<[number, number, number]> = [];
    const x = tile.x, y = tile.y;

    // Voisins partageant ce coin
    switch (corner) {
      case 0: // TL → partagé avec TL voisin N et W
        adj.push([x, y - 1, 2]); // tile au nord, coin BR
        adj.push([x - 1, y, 1]); // tile à l'ouest, coin TR
        adj.push([x - 1, y - 1, 3]); // tile NW, coin BL
        break;
      case 1: // TR
        adj.push([x, y - 1, 3]); // tile N, coin BL
        adj.push([x + 1, y, 0]); // tile E, coin TL
        adj.push([x + 1, y - 1, 2]); // tile NE, coin BR
        break;
      case 2: // BR
        adj.push([x, y + 1, 0]); // tile S, coin TL
        adj.push([x + 1, y, 3]); // tile E, coin BL
        adj.push([x + 1, y + 1, 1]); // tile SE, coin TR
        break;
      case 3: // BL
        adj.push([x, y + 1, 1]); // tile S, coin TR
        adj.push([x - 1, y, 2]); // tile W, coin BR
        adj.push([x - 1, y + 1, 0]); // tile SW, coin TL
        break;
    }

    for (const [nx, ny, nc] of adj) {
      const neighbor = this.tileAt(nx, ny);
      if (neighbor) {
        const diff = tile.elevation[corner] - neighbor.elevation[nc];
        if (diff > 1) {
          neighbor.elevation[nc] = tile.elevation[corner] - 1;
        } else if (diff < -1) {
          neighbor.elevation[nc] = tile.elevation[corner] + 1;
          this.propagateElevation(neighbor, nc);
        }
      }
    }
  }

  // ── Murs ──

  setWall(tile: ITile | null, direction: number, value: number, isWall: boolean): void {
    if (!tile || direction < 0 || direction > 3) return;
    tile.walls[direction] = isWall;
    const bit = 8 << direction; // WallN=8, WallE=16, WallS=32, WallW=64
    if (isWall) {
      tile.flags |= bit;
    } else {
      tile.flags &= ~bit;
    }
  }

  getWall(tile: ITile | null, direction: number): boolean {
    if (!tile || direction < 0 || direction > 3) return false;
    return tile.walls[direction];
  }

  // ── Chemins ──

  hasPath(tile: ITile | null): boolean {
    return tile ? !!(tile.flags & TileFlags.HasPath) : false;
  }

  hasConnectedPath(x: number, y: number): boolean {
    const tile = this.tileAt(x, y);
    return this.hasPath(tile);
  }

  /**
   * layPath — Pose un chemin sur une tuile.
   * @param tile   La tuile
   * @param from   Direction depuis laquelle on vient
   * @param to     Direction vers laquelle on va
   */
  layPath(tile: ITile | null, from: number, to: number): void {
    if (!tile) return;
    tile.flags |= TileFlags.HasPath;
    tile.type = TileType.Path;
    this.updateBorderFlags(tile);
  }

  /**
   * updatePath — Met à jour le réseau de chemins autour d'une position.
   */
  updatePath(x: number, y: number, range: number): void {
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const tile = this.tileAt(x + dx, y + dy);
        if (tile && this.hasPath(tile)) {
          this.updateBorderFlags(tile);
        }
      }
    }
  }

  // ── Parcours ──

  /**
   * loadNewCourseType — Charge un nouveau type de parcours, reset le terrain.
   */
  loadNewCourseType(courseType: number): void {
    this.theme = courseType as CourseTheme;
    this.resetTerrain();
    this.loadLightingForTheme(this.theme);
  }

  /**
   * loadLightingForTheme — Charge la configuration d'éclairage
   * depuis un fichier .txt (parkland/links/desert/tropical).
   * Version simplifiée — les fichiers originaux contiennent
   * #AMBIENT R G B A\n#DIFFUSE R G B A\n
   */
  private loadLightingForTheme(theme: CourseTheme): void {
    const presets: Record<CourseTheme, ILightConfig> = {
      [CourseTheme.Parkland]: {
        ambient: [0.45, 0.50, 0.35, 1.0],
        diffuse: [0.85, 0.80, 0.70, 1.0],
        lightDir: [0.3, -0.6, 0.8],
      },
      [CourseTheme.Links]: {
        ambient: [0.40, 0.45, 0.50, 1.0],
        diffuse: [0.75, 0.80, 0.90, 1.0],
        lightDir: [0.5, -0.5, 0.7],
      },
      [CourseTheme.Desert]: {
        ambient: [0.55, 0.45, 0.30, 1.0],
        diffuse: [1.0, 0.85, 0.60, 1.0],
        lightDir: [0.5, -0.7, 1.0],
      },
      [CourseTheme.Tropical]: {
        ambient: [0.35, 0.50, 0.30, 1.0],
        diffuse: [0.90, 0.85, 0.65, 1.0],
        lightDir: [0.2, -0.4, 0.9],
      },
    };
    this.lighting = presets[theme] ?? presets[CourseTheme.Parkland];
  }

  /**
   * changeLighting — Change l'éclairage (interpolation entre presets).
   */
  changeLighting(index: number): void {
    const themes = Object.values(CourseTheme).filter(v => typeof v === 'number') as CourseTheme[];
    const idx = Math.max(0, Math.min(index, themes.length - 1));
    this.loadLightingForTheme(themes[idx]);
  }

  // ── Zoom / Redimension ──

  setZoomLevel(level: number): void {
    this.zoomLevel = Math.max(1, level);
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    // Réallouer la grille (préserve les données existantes si possible)
    const oldTiles = this.tiles;
    this.resetTerrain();
    const minW = Math.min(oldTiles.length > 0 ? (oldTiles.length / this.height) || this.width : 0, this.width);
    const minH = Math.min(oldTiles.length / (this.width || 1) || 0, this.height);
    for (let y = 0; y < minH; y++) {
      for (let x = 0; x < minW; x++) {
        const src = y * (oldTiles.length ? Math.ceil(oldTiles.length / (oldTiles.length ? 1 : 1)) : 0) + x;
        if (oldTiles[src]) {
          const dst = y * this.width + x;
          this.tiles[dst] = { ...oldTiles[src], x, y };
        }
      }
    }
  }

  // ── Collar Info ──

  /**
   * passCollarInfo — Transmet les données des collars autour du trou.
   * Les collars sont les zones d'herbe rase autour de chaque trou.
   */
  passCollarInfo(collarData: number[], count: number): void {
    this.collars = collarData.slice(0, count);
  }

  // ── Setter divers ──

  setSplineHeight(height: number): void {
    this.splineHeight = Math.max(0.1, height);
  }

  // ── Normales ──

  /**
   * calcAllNormals — Recalcule les normales pour toutes les tuiles.
   * Dans le jeu original, les normales sont stockées par tile et
   * utilisées pour l'éclairage OpenGL (glNormal3f/glNormalPointer).
   * Ici on les calcule pour le rendu WebGL.
   */
  calcAllNormals(tile: ITile): void {
    // Les normales sont calculées par vertex pour chaque tile
    // et stockées pour l'appel à glNormalPointer
    // Implémentation dans le renderer
  }

  /**
   * calcNormals — Recalcule les normales pour une tuile spécifique.
   */
  calcNormals(tile: ITile): void {
    this.calcAllNormals(tile);
  }

  // ── Rendu ──

  /**
   * render — Rendu d'une tuile avec interp température.
   * @param tile La tuile à rendre
   * @param t    Température d'interpolation [0..1]
   * @returns    true si rendu effectué
   */
  render(tile: ITile | null, t: number): boolean {
    if (!tile || !this.initialized) return false;
    const passes = this.computeRenderPasses(tile);
    if (this.onRenderTile) {
      this.onRenderTile(tile, passes);
    }
    return true;
  }

  /**
   * localRender — Rend une zone locale autour de 2 tuiles.
   * Utilisé pour le rendu focalisé (autour du golfeur).
   */
  localRender(tile: ITile, tile2: ITile, radius: number): void {
    const cx = Math.floor((tile.x + tile2.x) / 2);
    const cy = Math.floor((tile.y + tile2.y) / 2);
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = this.tileAt(cx + dx, cy + dy);
        if (t) this.render(t, 1.0);
      }
    }
  }

  /**
   * renderTile — Rendu d'une tuile par coordonnées.
   * @param x       Position X
   * @param y       Position Y
   * @param w       Largeur d'affichage
   * @param tex     Index de texture
   * @param h       Hauteur d'affichage
   */
  renderTile(x: number, y: number, w: number, tex: number, h: number): void {
    const tile = this.tileAt(x, y);
    if (tile) this.render(tile, 1.0);
  }

  /**
   * stripRender — Rendu d'une bande de tuiles.
   * @param tile   Tuile de départ
   * @param count  Nombre de tuiles
   * @param t      Température d'interpolation
   */
  stripRender(tile: ITile, count: number, t: number): void {
    for (let i = 0; i < count; i++) {
      const t2 = this.tileAt(tile.x + i, tile.y);
      if (t2) this.render(t2, t);
    }
  }

  /**
   * pathUpdateRender — Rendu des chemins avec mise à jour des passes.
   */
  pathUpdateRender(tile: ITile | null, t: number): void {
    if (!tile || !this.hasPath(tile)) return;
    this.updateBorderFlags(tile);
    this.render(tile, t);
  }

  // ── Splines ──

  /**
   * drawBezierSpline — Dessine une spline de Bézier cubique.
   * Les 9 paramètres encodent 3 points de contrôle (x,y) × 3 + paramètres
   */
  drawBezierSpline(
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    x4: number, y4: number,
    steps: number,
  ): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const x = u*u*u*x1 + 3*u*u*t*x2 + 3*u*t*t*x3 + t*t*t*x4;
      const y = u*u*u*y1 + 3*u*u*t*y2 + 3*u*t*t*y3 + t*t*t*y4;
      points.push([x, y]);
    }
    return points;
  }

  /**
   * drawCardinalSpline — Dessine une spline cardinale.
   * 11 paramètres : 4 points de contrôle (x,y) + tension + steps
   */
  drawCardinalSpline(
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    x4: number, y4: number,
    tension: number,
    steps: number,
  ): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const s = (1 - tension) / 2;

      const h1 =  2*t3 - 3*t2 + 1;
      const h2 = -2*t3 + 3*t2;
      const h3 =   t3 - 2*t2 + t;
      const h4 =   t3 - t2;

      const x = h1*x2 + h2*x3 + s*(h3*(x3 - x1) + h4*(x4 - x2));
      const y = h1*y2 + h2*y3 + s*(h3*(y3 - y1) + h4*(y4 - y2));
      points.push([x, y]);
    }
    return points;
  }

  /**
   * drawCircle — Génère les points d'un cercle de terrain.
   */
  drawCircle(center: ITile | null, radius: number): Array<[number, number]> {
    if (!center) return [];
    const points: Array<[number, number]> = [];
    const segments = Math.max(8, Math.round(radius * 16));
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push([
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(angle) * radius / 2,
      ]);
    }
    return points;
  }

  /**
   * drawLine — Génère une ligne entre 2 points avec épaisseur.
   * 7 paramètres : x1,y1, x2,y2, épaisseur, type, motif
   */
  drawLine(
    x1: number, y1: number,
    x2: number, y2: number,
    thickness: number,
    lineType: number,
    pattern: number,
  ): Array<[number, number]> {
    return [[x1, y1], [x2, y2]];
  }

  // ── Gestion des bordures (internes) ──

  private updateBorderFlags(tile: ITile): void {
    const neighbors = [
      this.tileAt(tile.x, tile.y - 1), // N
      this.tileAt(tile.x + 1, tile.y), // E
      this.tileAt(tile.x, tile.y + 1), // S
      this.tileAt(tile.x - 1, tile.y), // W
    ];

    let flags = tile.flags;
    const bitMask = [TileFlags.BorderN, TileFlags.BorderE, TileFlags.BorderS, TileFlags.BorderW];

    for (let i = 0; i < 4; i++) {
      if (neighbors[i] && needsBorder(tile.type, neighbors[i]!.type)) {
        flags |= bitMask[i];
      } else {
        flags &= ~bitMask[i];
      }
    }
    tile.flags = flags;
  }

  // ── Calcul de passes de rendu ──

  /**
   * computeRenderPasses — Calcule les passes de rendu pour une tuile.
   * Système multi-couches :
   *   Pass 0 : Base (texture entière)
   *   Pass 1+ : Overlays de bordure par quadrant
   */
  private computeRenderPasses(tile: ITile): IRenderPass[] {
    const passes: IRenderPass[] = [];
    const family = TERRAIN_FAMILY[tile.type] ?? 0;
    const geomSuffix = getGeometryType(tile.elevation);
    const baseSuffix = family === 0 ? geomSuffix : 'A';

    // Pass 0 : fond — utilise la variation cosmétique de la tuile
    passes.push({
      type: tile.type,
      variation: tile.variation,    // variation cosmétique réelle (0001-00XX)
      suffix: baseSuffix,
      subType: tile.subType,
    });

    // Voisins
    const neighborAt = (dx: number, dy: number): TileType | undefined => {
      const n = this.tileAt(tile.x + dx, tile.y + dy);
      return n ? n.type : undefined;
    };

    const overrideFor = (nType: TileType | undefined): TileType | undefined => {
      const t = nType ?? TileType.Rough;
      if (!needsBorder(tile.type, t)) return undefined;
      const ov = borderOverride(tile.type, t);
      const bt = ov ?? tile.type;
      return TYPES_WITH_BORDER.has(bt) ? bt : undefined;
    };

    // ── Détection des bords par voisin cardinal ──
    // Chaque voisin (N/E/S/O) peut produire un strip overlay.
    // Les coins sont automatiquement gérés par l'overlap des strips adjacents.
    // Orientation : N→A, E→B, S→C, O→D (convention du jeu original)
    const EDGE_TO_SUFFIX: Record<string, string> = {
      'N': 'A', 'E': 'B', 'S': 'C', 'W': 'D',
    };

    // On utilise les quadrants pour savoir quels voisins cardinaux existent
    // Chaque quadrant touche 2 voisins cardinaux
    const CARDINAL_NEIGHBORS: Record<string, { dx: number; dy: number; edge: string }> = {
      '0,-1': { dx: 0, dy: -1, edge: 'N' },
      '1,0':  { dx: 1, dy: 0,  edge: 'E' },
      '0,1':  { dx: 0, dy: 1,  edge: 'S' },
      '-1,0': { dx: -1, dy: 0, edge: 'W' },
    };

    // Pour chaque voisin cardinal, vérifier s'il y a besoin d'un strip
    // Un même voisin peut être touché par 2 quadrants → on déduplique
    const edgesNeeded = new Set<string>();
    for (const [, info] of Object.entries(CARDINAL_NEIGHBORS)) {
      const nType = neighborAt(info.dx, info.dy);
      const ov = overrideFor(nType);
      if (ov) edgesNeeded.add(info.edge);
    }

    // Pour chaque bord, déterminer les quadrants à couvrir
    // N → quadrants 0 (NW) et 1 (NE)
    // E → quadrants 1 (NE) et 3 (SE)
    // S → quadrants 2 (SW) et 3 (SE)
    // W → quadrants 0 (NW) et 2 (SW)
    const EDGE_QUADS: Record<string, number[]> = {
      'N': [0, 1],
      'E': [1, 3],
      'S': [2, 3],
      'W': [0, 2],
    };

    // Map edge name → delta dx/dy
    const EDGE_TO_DELTA: Record<string, { dx: number; dy: number }> = {
      'N': { dx: 0, dy: -1 },
      'E': { dx: 1, dy: 0 },
      'S': { dx: 0, dy: 1 },
      'W': { dx: -1, dy: 0 },
    };

    for (const edge of edgesNeeded) {
      const suffix = EDGE_TO_SUFFIX[edge];
      const delta = EDGE_TO_DELTA[edge];
      const nType = neighborAt(delta.dx, delta.dy);
      const ov = overrideFor(nType);
      if (!ov) continue;

      passes.push({
        type: ov,
        variation: 0,        // 0001 — première variation
        suffix: suffix,      // N→A, E→B, S→C, W→D
        subType: tile.subType,
        quadrants: EDGE_QUADS[edge],
        stripEdge: edge as 'N' | 'E' | 'S' | 'W',
      });
    }

    return passes;
  }

  // ── Helpers ──

  private createTile(x: number, y: number, type: TileType, elevation: [number, number, number, number]): ITile {
    return {
      x, y,
      elevation,
      type,
      flags: TileFlags.None,
      variation: 0,
      walls: [false, false, false, false],
      subType: 0,
      renderPasses: [],
    };
  }

  /**
   * initTerrain — Initialise le terrain après reset.
   * Dans le jeu original, place les trous, calcule les zones.
   */
  initTerrain(): void {
    // Stub — la génération procédurale est gérée par le game manager
    this.computeAllRenderPasses();
  }

  /**
   * computeAllRenderPasses — Calcule les passes pour toute la grille.
   */
  computeAllRenderPasses(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[y * this.width + x];
        tile.renderPasses = this.computeRenderPasses(tile);
      }
    }
  }
}

/** Export du singleton */
export const terrain = Terrain.getInstance();
