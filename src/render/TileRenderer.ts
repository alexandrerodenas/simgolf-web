/**
 * render/TileRenderer.ts — Rendu 2D Canvas Sub-Tiling 4 Quadrants
 *
 * Chaque tuile est divisée en 4 quadrants de 32×32 px (NW, NE, SW, SE)
 * pouvant chacun avoir une texture différente. Le rendu utilise
 * ctx.drawImage avec source rectangle pour n'afficher qu'un quadrant
 * de la texture 64×64.
 *
 * Ordre de rendu : painter's algorithm par (mapX + mapY) croissant.
 * Projection dimétrique 2:1 (REFERENCE_GUIDE.md §4.2) :
 *   screenX = (mapX - mapY) × 64
 *   screenY = (mapX + mapY) × 32
 */

import { IMapState, IRenderPass } from '../core/types';

const TEX_SIZE = 64;
const QUAD_SIZE = 32;

/**
 * Coordonnées source (dans la texture 64×64) pour chaque quadrant.
 * Quadrant 0 = NW (haut-gauche), 1 = NE, 2 = SW, 3 = SE
 */
const QUAD_SRC: [number, number][] = [
  [0,  0],  // NW
  [32, 0],  // NE
  [0,  32], // SW
  [32, 32], // SE
];

/**
 * Rendu complet de la carte en sub-tiling 4 quadrants.
 *
 * Chaque tuile est rendue comme 4 quadrants 32×32 indépendants.
 * Chaque quadrant peut utiliser une texture de base ou de bordure
 * selon le voisinage (déterminé par computeRenderPasses).
 *
 * @param ctx         Contexte 2D du canvas
 * @param mapState    État de la carte
 * @param cam         Caméra 2D (offset + zoom)
 * @param getImages   Fonction (tileIdx) → HTMLImageElement[] (1 par passe/quadrant)
 * @param reverse     Si true, ordre inverse (vue de dessus)
 */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  mapState: IMapState,
  cam: { offsetX: number; offsetY: number; zoom: number },
  getImages: (tileIdx: number) => HTMLImageElement[],
  reverse: boolean = false,
): void {
  const { width, height } = mapState;
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
      const tile = mapState.tiles[tileIdx];

      // Origine du losange à l'écran (sommet haut)
      const originX = (tile.x - tile.y) * 64 * z + cam.offsetX;
      const originY = (tile.x + tile.y) * 32 * z + cam.offsetY;

      // Rendu des 4 quadrants
      const images = getImages(tileIdx);
      // Par défaut (si pas d'images), on dessine 4 fois la même base
      for (let q = 0; q < 4; q++) {
        const img = images[q];
        if (!img) {
          // Peut-être un fallback ? On continue.
          continue;
        }

        // Source : quadrant q dans la texture 64×64
        const [sx, sy] = QUAD_SRC[q];
        // Destination : quadrant q dans le losange (en coords locales)
        const dx = (q === 0 || q === 2) ? 0 : 32;  // NW/SW → gauche, NE/SE → droite
        const dy = (q === 0 || q === 1) ? 0 : 32;  // NW/NE → haut, SW/SE → bas

        // Matrice de projection pour CE quadrant
        // Le quadrant fait 32×32 dans l'espace local de la texture,
        // rendu comme un sous-losange 32×16 à l'écran
        ctx.setTransform(
          z, z * 0.5,              // eX: → droite (1, 0.5)
          -z, z * 0.5,             // eY: → gauche (1, -0.5) = -1, 0.5
          originX + dx * z - dy * z,  // Translation X
          originY + dx * z * 0.5 + dy * z * 0.5,  // Translation Y
        );

        // Dessine le quadrant : source 32×32 dans la texture, destination 32×32
        ctx.drawImage(img, sx, sy, QUAD_SIZE, QUAD_SIZE, 0, 0, QUAD_SIZE, QUAD_SIZE);
      }
    }
  }

  // Restaurer la matrice identité
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
