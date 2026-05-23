/**
 * render/TileRenderer.ts — Rendu 2D Canvas — Overlays par Quadrants
 *
 * Algorithme Holistique : chaque tuile commence par un fond uni 0001,
 * puis des overlays par quadrants viennent plaquer les bordures
 * (textures 0002/0003/0004/0005) uniquement là où c'est nécessaire.
 *
 * Pour les bordures droites (texture 0002), on extrait une BANDE fine
 * de 6 pixels le long de l'arête externe, pas le quadrant entier.
 *
 * Projection dimétrique 2:1 (REFERENCE_GUIDE.md §4.2) :
 *   screenX = (mapX - mapY) × 64
 *   screenY = (mapX + mapY) × 32
 *
 * Ordre de rendu : painter's algorithm par (mapX + mapY) croissant.
 */

import { IMapState, IRenderPass } from '../core/types';

const TEX_SIZE = 64;
const QUAD_SIZE = 32;

/** Épaisseur de la bande de bordure fine (6 pixels les plus proches de l'arête) */
const BORDER_STRIP = 6;

/**
 * Coordonnées source (dans la texture 64×64) pour chaque quadrant.
 */
const QUAD_SRC: Record<number, [number, number]> = {
  0: [0,  0],   // NW
  1: [32, 0],   // NE
  2: [0,  32],  // SW
  3: [32, 32],  // SE
};

/**
 * Calcule source rect et dest rect pour un quadrant en mode strip.
 * Extrait une bande de BORDER_STRIP pixels le long de l'arête externe
 * de la texture et la place à l'extérieur de la tuile, côté jonction.
 */
function stripRects(
  q: number,
  edge: 'N' | 'E' | 'S' | 'W',
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const [sxBase, syBase] = QUAD_SRC[q];
  const s = BORDER_STRIP;

  switch (edge) {
    case 'N':
      // Bande haute : extrait les s premiers pixels du haut de la texture,
      // placée AU-DESSUS de la tuile, côté voisin Nord (dy = -s)
      return {
        sx: sxBase, sy: syBase, sw: QUAD_SIZE, sh: s,
        dx: (q === 0 || q === 2) ? 0 : QUAD_SIZE,
        dy: -s, dw: QUAD_SIZE, dh: s,
      };
    case 'E':
      // Bande droite : extrait les s derniers pixels du bord droit,
      // placée À DROITE de la tuile, côté voisin Est (dx = TEX_SIZE = 64)
      return {
        sx: sxBase + QUAD_SIZE - s, sy: syBase, sw: s, sh: QUAD_SIZE,
        dx: TEX_SIZE,
        dy: (q === 0 || q === 1) ? 0 : QUAD_SIZE,
        dw: s, dh: QUAD_SIZE,
      };
    case 'S':
      // Bande basse : extrait les s derniers pixels du bord bas,
      // placée EN-DESSOUS de la tuile, côté voisin Sud (dy = TEX_SIZE = 64)
      return {
        sx: sxBase, sy: syBase + QUAD_SIZE - s, sw: QUAD_SIZE, sh: s,
        dx: (q === 0 || q === 2) ? 0 : QUAD_SIZE,
        dy: TEX_SIZE, dw: QUAD_SIZE, dh: s,
      };
    case 'W':
      // Bande gauche : extrait les s premiers pixels du bord gauche,
      // placée À GAUCHE de la tuile, côté voisin Ouest (dx = -s)
      return {
        sx: sxBase, sy: syBase, sw: s, sh: QUAD_SIZE,
        dx: -s,
        dy: (q === 0 || q === 1) ? 0 : QUAD_SIZE,
        dw: s, dh: QUAD_SIZE,
      };
  }
}

/**
 * Rendu complet de la carte en overlays cumulatifs par quadrants.
 *
 * Chaque tuile est rendue en multiples passes :
 *   Pass 0 : Fond uni 0001 (texture entière 64×64)
 *   Pass+  : Overlays quadrants depuis 0002 (bords droits, bandes fines)
 *            ou 0003 (diagonales isolées), 0004 (angles arrondis),
 *            0005 (îlot)
 *
 * Les overlays s'empilent avec alpha compositing (source-over) :
 * le fond 0001 reste visible là où les overlays sont transparents.
 *
 * @param ctx         Contexte 2D du canvas
 * @param mapState    État de la carte
 * @param cam         Caméra 2D (offset + zoom)
 * @param getImages   Fonction (tileIdx) → HTMLImageElement[] (1 par passe)
 * @param reverse     Si true, ordre inverse (vue de dessus)
 */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  mapState: IMapState,
  cam: { offsetX: number; offsetY: number; zoom: number },
  getImages: (tileIdx: number) => HTMLImageElement[],
  getPasses?: (tileIdx: number) => IRenderPass[],
  reverse: boolean = false,
): void {
  const { width, height, tiles } = mapState;
  const z = cam.zoom;

  // Painter's algorithm
  const range = Array.from({ length: width + height }, (_, i) =>
    reverse ? width + height - 1 - i : i,
  );

  for (const sum of range) {
    for (let y = 0; y < height; y++) {
      const x = sum - y;
      if (x < 0 || x >= width) continue;

      const tileIdx = y * width + x;
      const tile = tiles[tileIdx];
      const passes = getPasses ? getPasses(tileIdx) : tile.renderPasses;
      const images = getImages(tileIdx);

      // Origine du losange à l'écran
      const originX = (tile.x - tile.y) * 64 * z + cam.offsetX;
      const originY = (tile.x + tile.y) * 32 * z + cam.offsetY;

      // Itère sur chaque passe (base + overlays)
      for (let p = 0; p < Math.min(passes.length, images.length); p++) {
        const pass = passes[p];
        const img = images[p];
        if (!img) continue;

        // Si la passe a des quadrants spécifiques, ne rendre qu'eux
        const quads = pass.quadrants ?? [0, 1, 2, 3];  // tous par défaut
        const stripEdge = pass.stripEdge;

        // Transformation de base pour la tuile entière
        ctx.setTransform(z, z * 0.5, -z, z * 0.5, originX, originY);

        if (quads.length === 4 && !stripEdge) {
          // Texture entière : drawImage direct
          ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
        } else {
          // Quadrants spécifiques
          for (const q of quads) {
            if (stripEdge) {
              // --- Mode strip : bande fine le long de l'arête ---
              const r = stripRects(q, stripEdge);
              ctx.setTransform(
                z, z * 0.5,
                -z, z * 0.5,
                originX + r.dx * z - r.dy * z,
                originY + (r.dx + r.dy) * z * 0.5,
              );
              ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, r.dw, r.dh);
            } else {
              // --- Mode quadrant normal (32×32) ---
              const [sx, sy] = QUAD_SRC[q];
              let dx = (q === 0 || q === 2) ? 0 : QUAD_SIZE;
              let dy = (q === 0 || q === 1) ? 0 : QUAD_SIZE;

              // Les corners (texture 0004, 1 quadrant) : offset de 6 unités
              // pour les angles latéraux NE et SW.
              if (pass.variation === 3 && quads.length === 1) {
                if (q === 1) { dy -= BORDER_STRIP; }  // NE → vers le haut
                if (q === 2) { dy += BORDER_STRIP; }  // SW → vers le bas
              }

              ctx.setTransform(
                z, z * 0.5,
                -z, z * 0.5,
                originX + dx * z - dy * z,
                originY + (dx + dy) * z * 0.5,
              );

              ctx.drawImage(img, sx, sy, QUAD_SIZE, QUAD_SIZE, 0, 0, QUAD_SIZE, QUAD_SIZE);
            }
          }
        }
      }
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
