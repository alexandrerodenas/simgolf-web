/**
 * render/TileRenderer.ts — Rendu 2D Canvas — Overlays par Quadrants
 *
 * Algorithme Holistique : chaque tuile commence par un fond uni 0001,
 * puis des overlays par quadrants viennent plaquer les bordures
 * (textures 0002/0004/0005) uniquement là où c'est nécessaire.
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
 * Rendu complet de la carte en overlays cumulatifs par quadrants.
 *
 * Chaque tuile est rendue en multiples passes :
 *   Pass 0 : Fond uni 0001 (texture entière 64×64)
 *   Pass+  : Overlays quadrants depuis 0002 (bords droits)
 *            ou 0004 (angles arrondis) ou 0005 (îlot)
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

        // Transformation de base pour la tuile entière
        ctx.setTransform(z, z * 0.5, -z, z * 0.5, originX, originY);

        if (quads.length === 4) {
          // Texture entière : drawImage direct
          ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
        } else {
          // Quadrants spécifiques : source rect dans la texture
          for (const q of quads) {
            const [sx, sy] = QUAD_SRC[q];
            // Position destination dans le losange
            const dx = (q === 0 || q === 2) ? 0 : QUAD_SIZE;
            const dy = (q === 0 || q === 1) ? 0 : QUAD_SIZE;

            // Ajuster la transform pour ce quadrant
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

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
