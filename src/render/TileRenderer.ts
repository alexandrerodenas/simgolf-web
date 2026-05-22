/**
 * render/TileRenderer.ts — Rendu 2D Canvas des tuiles SimGolf
 *
 * Chaque tuile est dessinée comme un losange 2:1 indivisible via
 * ctx.setTransform(). La matrice affine projette la texture 64×64
 * sur le losange écran.
 *
 * Projection dimétrique 2:1 (REFERENCE_GUIDE.md §4.2) :
 *   screenX = (mapX - mapY) × 64
 *   screenY = (mapX + mapY) × 32
 *
 * Ordre de rendu : painter's algorithm par (mapX + mapY) croissant.
 * Les tuiles "arrière" (petite somme) sont dessinées en premier.
 */

import { IMapState } from '../core/types';
import { Camera2D } from './camera';

const TEX_SIZE = 64;

/**
 * Rendu complet de la carte en une passe.
 *
 * @param ctx        Contexte 2D du canvas
 * @param mapState   État de la carte
 * @param cam        Caméra 2D (offset + zoom)
 * @param getImage   Fonction (tile) → HTMLImageElement | undefined
 * @param reverse    Si true, ordre inverse (vue de dessus)
 */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  mapState: IMapState,
  cam: Camera2D,
  getImage: (tileIdx: number) => HTMLImageElement | undefined,
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

      // Dessiner la texture si disponible
      const img = getImage(tileIdx);
      if (img) {
        ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
      }
    }
  }

  // Restaurer la matrice identité
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
