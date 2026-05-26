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

import {
  TerrainTransitionManager,
  getTerrainPriority,
  maskToSpriteCoords,
  type AutotileGrid,
  type TransitionMask,
  TRANSITION_FULL,
} from './autotile.js';

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


// ─── Conversion grille → monde ───


/** Projection dimétrique : worldX = (gx-gy)*64, worldZ = (gx+gy)*32, worldY = elev*32 */
function gridToWorld(gx: number, gy: number, elev: number): { x: number; y: number; z: number } {
  return {
    x: (gx - gy) * 64,
    y: elev * 32,
    z: (gx + gy) * 32,
  };
}

// ─────── Terrain class (Port du singleton original) ───────

export class Terrain implements AutotileGrid {
  private static _instance: Terrain | null = null;

  // Grille de terrain
  tiles: ITile[] = [];
  width = 0;
  height = 0;

  // Gestionnaire d'autotiling vertex-based
  autotile: TerrainTransitionManager;

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
    this.autotile = new TerrainTransitionManager(this);
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
    // Lier les voisins après création
    this.linkNeighbors();
  }

  /**
   * linkNeighbors — Établit les pointeurs voisins pour toutes les tuiles.
   * Équivalent des pointeurs à tile+0x34/0x38/0x3c/0x40.
   */
  private linkNeighbors(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[y * this.width + x];
        tile.neighborN = this.tileAt(x, y - 1);
        tile.neighborS = this.tileAt(x, y + 1);
        tile.neighborW = this.tileAt(x - 1, y);
        tile.neighborE = this.tileAt(x + 1, y);
      }
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

  // ── Interface AutotileGrid ──

  /** Implémentation de AutotileGrid.getTileType */
  getTileType(r: number, c: number): TileType {
    const tile = this.tileAt(c, r);
    return tile ? tile.type : TileType.WaterDeep;
  }

  /** Implémentation de AutotileGrid.getTileElevation */
  getTileElevation(r: number, c: number): [number, number, number, number] {
    const tile = this.tileAt(c, r);
    return tile ? tile.elevation : [0, 0, 0, 0];
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
    // Le recalcul des passes est déclenché par computeAllRenderPasses()
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
  }

  /**
   * updatePath — Met à jour le réseau de chemins autour d'une position.
   */
  updatePath(x: number, y: number, range: number): void {
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const tile = this.tileAt(x + dx, y + dy);
        if (tile && this.hasPath(tile)) {
          tile.renderPasses = this.computeRenderPasses(tile);
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
    tile.renderPasses = this.computeRenderPasses(tile);
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
  updatePath(x: number, y: number, range: number): void {
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const tile = this.tileAt(x + dx, y + dy);
        if (tile && this.hasPath(tile)) {
          tile.renderPasses = this.computeRenderPasses(tile);
        }
      }
    }
  }

  // ── Rendu edge-strip overlay ──

  /** Ratio UV pour le strip de 4px (textures 64×64) */
  private static readonly EDGE_STRIP_UV = 4 / 64; // ≈ 0.0625

  /**
   * computeRenderPasses — Génère les passes de rendu avec edge-strip overlay.
   *
   * Chaque tuile est rendue en 2 couches :
   *   1. Base : la tuile pleine (variation 0001)
   *   2. Edge strips : pour chaque voisin de type différent, un strip de 6px
   *      de la variante 0002 est superposé sur le côté de la jointure.
   *
   * Les strips sont rendus avec blending (isOverlay=true) pour se fondre
   * sur la tuile de base.
   */
  private computeRenderPasses(tile: ITile): IRenderPass[] {
    const passes: IRenderPass[] = [];
    const [hTL, hTR, hBR, hBL] = tile.elevation;
    const geomSuffix = getGeometryType(tile.elevation);
    const S = Terrain.EDGE_STRIP_UV;

    // SandBunker : encoder le sous-type dans le suffixe
    const sbSubType = tile.type === TileType.SandBunker
      ? Math.max(1, tile.subType || 1)
      : 0;
    const geomWithSub = sbSubType > 0 ? `${sbSubType}${geomSuffix}` : geomSuffix;

    // Helper: gridToWorld simplifié
    const p = (gx: number, gy: number, elev: number) => gridToWorld(gx, gy, elev);

    const TL = p(tile.x,     tile.y,     hTL);
    const TR = p(tile.x + 1, tile.y,     hTR);
    const BR = p(tile.x + 1, tile.y + 1, hBR);
    const BL = p(tile.x,     tile.y + 1, hBL);

    // Helper : 3 vertex → tuple 9-floats
    const tri = (a: typeof TL, b: typeof TL, c: typeof TL):
      [number,number,number,number,number,number,number,number,number] =>
      [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z];

    // Helper : interpole entre 2 valeurs 3D
    const lerp = (
      a: typeof TL, b: typeof TL, t: number
    ): typeof TL => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    });

    // ─── 1. Passe de base : tuile pleine 0001 ───
    const baseKey = `${tile.type}:0:${geomWithSub}`;
    const diagTLBR = Math.abs(hTL - hBR) < Math.abs(hTR - hBL);

    // 2 triangles = quad complet, split par la diagonale la plus courte
    if (diagTLBR) {
      passes.push({
        type: tile.type, variation: 0, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(TL, TR, BL),
        texCoordIndices: [0, 0, 1, 0, 0, 1],
        textureKey: baseKey, isOverlay: false,
      });
      passes.push({
        type: tile.type, variation: 0, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(TR, BR, BL),
        texCoordIndices: [1, 0, 1, 1, 0, 1],
        textureKey: baseKey, isOverlay: false,
      });
    } else {
      passes.push({
        type: tile.type, variation: 0, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(TL, TR, BR),
        texCoordIndices: [0, 0, 1, 0, 1, 1],
        textureKey: baseKey, isOverlay: false,
      });
      passes.push({
        type: tile.type, variation: 0, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(TL, BR, BL),
        texCoordIndices: [0, 0, 1, 1, 0, 1],
        textureKey: baseKey, isOverlay: false,
      });
    }

    // ─── 2. Coins et Edge strips overlay ───
    // Détecte quels voisins diffèrent (par famille visuelle, pas type exact)
    // Ex: WaterShallow/Middle/Deep sont même famille → pas de bordure entre eux
    const sameFamily = (a: ITile | null, b: ITile | null): boolean => {
      if (!a || !b) return false;
      return getTerrainPriority(a.type) === getTerrainPriority(b.type);
    };
    const diffEdges = {
      N: tile.neighborN !== null && !sameFamily(tile, tile.neighborN),
      E: tile.neighborE !== null && !sameFamily(tile, tile.neighborE),
      S: tile.neighborS !== null && !sameFamily(tile, tile.neighborS),
      W: tile.neighborW !== null && !sameFamily(tile, tile.neighborW),
    };

    // Coins adjacents : si 2 arêtes adjacentes diffèrent → coin 0004
    interface CornerQuad {
      name: string;
      a: typeof TL; b: typeof TL; c: typeof TL; d: typeof TL;
      vari: number; // 2=0003, 3=0004
      uv: [number,number,number,number,number,number][];
    }
    const corners: CornerQuad[] = [];

    // Midpoints des arêtes et centre
    const mid = (a: typeof TL, b: typeof TL) => ({
      x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
    });
    const M_T = mid(TL, TR);
    const M_R = mid(TR, BR);
    const M_B = mid(BL, BR);
    const M_L = mid(TL, BL);
    const center = {
      x: (TL.x + TR.x + BR.x + BL.x) / 4,
      y: (TL.y + TR.y + BR.y + BL.y) / 4,
      z: (TL.z + TR.z + BR.z + BL.z) / 4,
    };

    // NE corner (N+E) → quadrant TR
    if (diffEdges.N && diffEdges.E) {
      const nPri = getTerrainPriority(tile.neighborE!.type);
      const tPri = getTerrainPriority(tile.type);
      const useRounded = nPri >= tPri; // voisin plus clair ou égal → 0004, plus sombre → 0003
      const cornerVar = useRounded ? 3 : 2;
      corners.push({
        name: 'NE', a: TR, b: center, c: M_T, d: M_R,
        vari: cornerVar,
        uv: [
          [1, 0, 0.5, 0.5, 0.5, 0],     // Tri1: TR, C, M_T
          [1, 0, 1, 0.5, 0.5, 0.5],     // Tri2: TR, M_R, C
        ],
      });
    }

    // SE corner (E+S) → quadrant BR
    if (diffEdges.E && diffEdges.S) {
      const nPri = getTerrainPriority(tile.neighborE!.type);
      const tPri = getTerrainPriority(tile.type);
      const useRounded = nPri >= tPri;
      const cornerVar = useRounded ? 3 : 2;
      corners.push({
        name: 'SE', a: BR, b: center, c: M_R, d: M_B,
        vari: cornerVar,
        uv: [
          [1, 1, 0.5, 0.5, 1, 0.5],     // Tri1: BR, C, M_R
          [1, 1, 0.5, 1, 0.5, 0.5],     // Tri2: BR, M_B, C
        ],
      });
    }

    // SW corner (S+W) → quadrant BL
    if (diffEdges.S && diffEdges.W) {
      const nPri = getTerrainPriority(tile.neighborS!.type);
      const tPri = getTerrainPriority(tile.type);
      const useRounded = nPri >= tPri;
      const cornerVar = useRounded ? 3 : 2;
      corners.push({
        name: 'SW', a: BL, b: center, c: M_B, d: M_L,
        vari: cornerVar,
        uv: [
          [0, 1, 0.5, 0.5, 0.5, 1],     // Tri1: BL, C, M_B
          [0, 1, 0, 0.5, 0.5, 0.5],     // Tri2: BL, M_L, C
        ],
      });
    }

    // NW corner (W+N) → quadrant TL
    if (diffEdges.W && diffEdges.N) {
      const nPri = getTerrainPriority(tile.neighborW!.type);
      const tPri = getTerrainPriority(tile.type);
      const useRounded = nPri >= tPri;
      const cornerVar = useRounded ? 3 : 2;
      corners.push({
        name: 'NW', a: TL, b: center, c: M_L, d: M_T,
        vari: cornerVar,
        uv: [
          [0, 0, 0.5, 0.5, 0, 0.5],     // Tri1: TL, C, M_L
          [0, 0, 0.5, 0, 0.5, 0.5],     // Tri2: TL, M_T, C
        ],
      });
    }

    // Ajout des coins corner (variation 0003 ou 0004)
    for (const cnr of corners) {
      const key = `corner:${tile.type}:${cnr.vari}:${geomWithSub}:${cnr.name}`;
      // Tri1: a → b → d  (quadrant split)
      passes.push({
        type: tile.type, variation: cnr.vari, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(cnr.a, cnr.b, cnr.c),
        texCoordIndices: cnr.uv[0],
        textureKey: key, isOverlay: true,
      });
      passes.push({
        type: tile.type, variation: cnr.vari, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(cnr.a, cnr.d, cnr.b),
        texCoordIndices: cnr.uv[1],
        textureKey: key, isOverlay: true,
      });
    }

    // Ajout des edge strips pour les arêtes non couvertes par un corner
    const edgeKey = `edge:${tile.type}:${geomWithSub}`;

    // Nord
    if (diffEdges.N) {
      const iTL = lerp(TL, BL, S);
      const iTR = lerp(TR, BR, S);
      const key = `${edgeKey}:N`;
      passes.push({
        type: tile.type, variation: 1, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(TL, TR, iTR),
        texCoordIndices: [0, 0, 1, 0, 1, S],
        textureKey: key, isOverlay: true,
      });
      passes.push({
        type: tile.type, variation: 1, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(TL, iTR, iTL),
        texCoordIndices: [0, 0, 1, S, 0, S],
        textureKey: key, isOverlay: true,
      });
    }

    // Est
    if (diffEdges.E) {
      const iTR = lerp(TR, TL, S);
      const iBR = lerp(BR, BL, S);
      const key = `${edgeKey}:E`;
      passes.push({
        type: tile.type, variation: 1, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(TR, BR, iBR),
        texCoordIndices: [1, 0, 1, 1, 1-S, 1],
        textureKey: key, isOverlay: true,
      });
      passes.push({
        type: tile.type, variation: 1, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(TR, iBR, iTR),
        texCoordIndices: [1, 0, 1-S, 1, 1-S, 0],
        textureKey: key, isOverlay: true,
      });
    }

    // Sud
    if (diffEdges.S) {
      const iBL = lerp(BL, TL, S);
      const iBR = lerp(BR, TR, S);
      const key = `${edgeKey}:S`;
      passes.push({
        type: tile.type, variation: 1, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(BR, BL, iBL),
        texCoordIndices: [1, 1, 0, 1, 0, 1-S],
        textureKey: key, isOverlay: true,
      });
      passes.push({
        type: tile.type, variation: 1, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(BR, iBL, iBR),
        texCoordIndices: [1, 1, 0, 1-S, 1, 1-S],
        textureKey: key, isOverlay: true,
      });
    }

    // Ouest
    if (diffEdges.W) {
      const iTL = lerp(TL, TR, S);
      const iBL = lerp(BL, BR, S);
      const key = `${edgeKey}:W`;
      passes.push({
        type: tile.type, variation: 1, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(BL, TL, iTL),
        texCoordIndices: [0, 1, 0, 0, S, 0],
        textureKey: key, isOverlay: true,
      });
      passes.push({
        type: tile.type, variation: 1, suffix: geomWithSub,
        subType: tile.subType, mask: 0,
        vertexPositions: tri(BL, iTL, iBL),
        texCoordIndices: [0, 1, S, 0, S, 1],
        textureKey: key, isOverlay: true,
      });
    }

    return passes;
  }

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
      // Nouveaux champs
      orientation: 0,
      neighborN: null,
      neighborS: null,
      neighborE: null,
      neighborW: null,
      overlayPrev: 0,
      overlayNext: 0,
      pathN: false,
      pathE: false,
      pathS: false,
      pathW: false,
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
