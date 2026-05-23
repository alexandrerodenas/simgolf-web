/**
 * render/TileRenderer.ts — Rendu 2D Canvas Multi-Passes avec Sub-Tiling
 *
 * Chaque tuile est dessinée comme un losange 2:1 via ctx.setTransform().
 * Le système Multi-Passes avec Sub-Tiling divise chaque tuile en 4 quadrants
 * (NW, NE, SW, SE), chacun utilisant sa propre texture.
 *
 * Chaque quadrant est rendu comme un triangle (le 4e coin du sous-carré 32×32
 * est en dehors du diamant). Les triangles sont dessinés via ctx.clip() pour
 * ne montrer que la partie visible de chaque quadrant.
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
 * Coordonnées des 4 triangles de quadrant dans l'espace local de la tuile.
 * Chaque quadrant est un triangle défini par 3 sommets [x,y] dans le repère
 * local où le diamant complet va de (0,0) à (64,64) avec le centre à (32,32).
 *
 * Les 3 sommets de chaque triangle forment un sous-diamant dont le 4e coin
 * est en dehors du diamant (transparent).
 */
const QUAD_TRIANGLES: [number, number][][] = [
  // Q0 (NW) : (32,0) top - (0,32) left - (32,32) center
  [[32, 0], [0, 32], [32, 32]],
  // Q1 (NE) : (32,0) top - (64,32) right - (32,32) center
  [[32, 0], [64, 32], [32, 32]],
  // Q2 (SW) : (0,32) left - (32,64) bottom - (32,32) center
  [[0, 32], [32, 64], [32, 32]],
  // Q3 (SE) : (32,32) center - (64,32) right - (32,64) bottom
  [[32, 32], [64, 32], [32, 64]],
];

/**
 * Coordonnées source dans la texture 64×64 pour chaque quadrant.
 * Chaque quadrant = sous-région 32×32 de la texture.
 */
const QUAD_SRC = [
  { sx: 0, sy: 0, sw: 32, sh: 32 },   // NW
  { sx: 32, sy: 0, sw: 32, sh: 32 },  // NE
  { sx: 0, sy: 32, sw: 32, sh: 32 },  // SW
  { sx: 32, sy: 32, sw: 32, sh: 32 }, // SE
];

/**
 * Rendu complet de la carte avec support Sub-Tiling (4 quadrants par tuile).
 *
 * Chaque tuile a 4 renderPasses (une par quadrant). Pour chaque passe :
 *   1. Clip le contexte 2D au triangle du quadrant
 *   2. Dessine la sous-région 32×32 de la texture
 *   3. Restaure le clip
 *
 * @param ctx         Contexte 2D du canvas
 * @param mapState    État de la carte
 * @param cam         Caméra 2D (offset + zoom)
 * @param getImages   Fonction (tileIdx) → HTMLImageElement[] (1+ images par tuile)
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

  // Préserver la matrice de transformation
  ctx.save();

  for (const sum of range) {
    for (let y = 0; y < height; y++) {
      const x = sum - y;
      if (x < 0 || x >= width) continue;

      const tileIdx = y * width + x;
      const tile = tiles[tileIdx];

      // Origine du losange à l'écran (sommet haut)
      const originX = (tile.x - tile.y) * 64 * z + cam.offsetX;
      const originY = (tile.x + tile.y) * 32 * z + cam.offsetY;

      // Matrice de projection dimétrique 2:1 (commune à tous les quadrants)
      ctx.setTransform(z, z * 0.5, -z, z * 0.5, originX, originY);

      const images = getImages(tileIdx);

      if (images.length <= 1) {
        // Mode legacy : 1 seule texture pour toute la tuile
        if (images[0]) {
          ctx.drawImage(images[0], 0, 0, TEX_SIZE, TEX_SIZE);
        }
      } else {
        // Mode Sub-Tiling : chaque quadrant dessine sa sous-région
        for (let q = 0; q < Math.min(images.length, 4); q++) {
          if (!images[q]) continue;

          const tri = QUAD_TRIANGLES[q];
          const src = QUAD_SRC[q];

          // Clip au triangle de ce quadrant
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(tri[0][0], tri[0][1]);
          ctx.lineTo(tri[1][0], tri[1][1]);
          ctx.lineTo(tri[2][0], tri[2][1]);
          ctx.closePath();
          ctx.clip();

          // Dessiner la sous-région 32×32 de la texture
          ctx.drawImage(
            images[q],
            src.sx, src.sy, src.sw, src.sh,  // source rect
            0, 0, TEX_SIZE, TEX_SIZE,         // dest rect (full diamond)
          );

          ctx.restore(); // restore clip
        }
      }
    }
  }

  ctx.restore(); // restore identity transform
}
