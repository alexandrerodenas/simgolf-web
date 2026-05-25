/**
 * render/TileRenderer.ts — Rendu Canvas 2D (obsolète, remplacé par ThreeRenderer)
 *
 * Ce fichier est conservé pour référence uniquement.
 * Le rendu 3D utilise ThreeRenderer (src/render/ThreeRenderer.ts).
 */

import { IMapState, IRenderPass } from '../terrain-lib/types.js';

const TEX_SIZE = 64;
const OVERDRAW = 1.0;

export function renderTiles(
  ctx: CanvasRenderingContext2D,
  mapState: IMapState,
  cam: { offsetX: number; offsetY: number; zoom: number },
  getImages: (tileIdx: number) => HTMLImageElement[],
  _getPasses?: (tileIdx: number) => IRenderPass[],
  _reverse: boolean = false,
): void {
  const { width, height, tiles } = mapState;
  const z = cam.zoom;
  const getPasses = _getPasses || ((i: number) => tiles[i].renderPasses);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tileIdx = y * width + x;
      const tile = tiles[tileIdx];
      const passes = getPasses(tileIdx);
      const images = getImages(tileIdx);

      const originX = (tile.x - tile.y) * 64 * z + cam.offsetX;
      const originY = (tile.x + tile.y) * 32 * z + cam.offsetY;

      for (let p = 0; p < Math.min(passes.length, images.length); p++) {
        const pass = passes[p];
        if (pass.isOverlay) continue;
        const img = images[p];
        if (!img) continue;

        ctx.setTransform(z, z * 0.5, -z, z * 0.5, originX, originY);
        ctx.drawImage(img,
          0.5, 0.5, TEX_SIZE - 1, TEX_SIZE - 1,
          -OVERDRAW, -OVERDRAW, TEX_SIZE + OVERDRAW * 2, TEX_SIZE + OVERDRAW * 2,
        );
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
