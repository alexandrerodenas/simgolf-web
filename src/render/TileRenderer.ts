/**
 * render/TileRenderer.ts — Rendu 2D Canvas Multi-Passes des tuiles SimGolf
 *
 * Chaque tuile est dessinée comme un losange 2:1 via ctx.setTransform().
 * Le système Multi-Passes itère sur renderPasses[] (1 à 4 couches)
 * pour superposer les textures : base + bordures d'auto-tiling.
 *
 * Projection dimétrique 2:1 (REFERENCE_GUIDE.md §4.2) :
 *   screenX = (mapX - mapY) × 64
 *   screenY = (mapX + mapY) × 32
 *
 * Ordre de rendu : painter's algorithm par (mapX + mapY) croissant.
 */

import { IMapState } from '../core/types';

const TEX_SIZE = 64;

/**
 * Rendu complet de la carte en une passe, avec support multi-textures.
 *
 * Chaque tuile peut avoir jusqu'à 4 textures superposées (renderPasses).
 * Le rendu itère toutes les tuiles dans l'ordre painter (arrière → avant),
 * et pour chaque tuile dessine toutes ses passes dans l'ordre (base → bordures).
 *
 * @param ctx         Contexte 2D du canvas
 * @param mapState    État de la carte
 * @param cam         Caméra 2D (offset + zoom)
 * @param getImages   Fonction (tileIdx) → HTMLImageElement[] (1 image par passe)
 * @param reverse     Si true, ordre inverse (vue de dessus)
 */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  mapState: IMapState,
  cam: { offsetX: number; offsetY: number; zoom: number },
  getImages: (tileIdx: number) => HTMLImageElement[],
  reverse: boolean = false,
): void {
  const { width, height, tiles } = mapState;
  const z = cam.zoom;

  // Painter's algorithm : tri croissant ou décroissant selon reverse
  const range = Array.from({ length: width + height }, (_, i) =>
    reverse ? width + height - 1 - i : i,
  );

  for (const sum of range) {
    for (let y = 0; y < height; y++) {
      const x = sum - y;
      if (x < 0 || x >= width) continue;

      const tileIdx = y * width + x;
      const tile = tiles[tileIdx];

      // Origine du losange à l'écran (sommet haut)
      const originX = (tile.x - tile.y) * 64 * z + cam.offsetX;
      const originY = (tile.x + tile.y) * 32 * z + cam.offsetY;

      // Matrice de projection dimétrique 2:1
      ctx.setTransform(z, z * 0.5, -z, z * 0.5, originX, originY);

      // Dessiner toutes les passes (multi-textures superposées)
      const images = getImages(tileIdx);
      for (const img of images) {
        if (img) {
          ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
        }
      }
    }
  }

  // Restaurer la matrice identité
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
