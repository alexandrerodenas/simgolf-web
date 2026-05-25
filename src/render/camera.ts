/**
 * render/camera.ts — Caméra SimGolf (port fidèle du jeu original)
 *
 * La caméra SimGolf utilise une projection purement verticale :
 *   - Regard vers le bas (Y négatif → down)
 *   - Rotation de 45° autour de l'axe Y (azimut isométrique)
 *   - Pas d'inclinaison d'élévation
 *   - Le rapport dimétrique 2:1 vient de la géométrie des tuiles :
 *     chaque tuile fait 128×64 unités 3D (RENDER_TILE_W × RENDER_TILE_H)
 *
 * Source : rizin de Terrain.dll (render @ 0x10005990, drawLine @ 0x100048a0)
 *   glRotatef(45.0 + angle, 0, 1, 0)   — rotation Y seule
 *   glTranslatef((cx - tileX)*100, 0, (cz - tileZ)*100) — centrage
 *   glOrtho(0, width, 0, height, -1, 1) — projection orthographique
 *
 * Références : REFERENCE_GUIDE.md §4.2 (Projection Dimétrique 2:1)
 *              REFERENCE_GUIDE.md §4.7 (Caméra et Zoom)
 */

import * as THREE from 'three';
import { RENDER_TILE_W, RENDER_TILE_H, RENDER_ELEVATION_SCALE } from '../core/types';

// ─── Caméra 2D (obsolète, conservée pour compatibilité) ───

export interface Camera2D {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export function createCamera2D(): Camera2D {
  return { offsetX: 0, offsetY: 0, zoom: 1 };
}

// ─── Constantes caméra du jeu original ───

/** Angle de rotation isométrique autour de Y (vérifié rizin : [0x1005f344] = 45.0) */
const AZIMUTH_Y = Math.PI / 4;  // 45°

/** Centre virtuel de la grille de rendu (render.c : RENDER_GRID_CENTER = 25) */
const GRID_CENTER = 25;

/** Facteur d'échelle de translation (vérifié rizin : [0x1005f340] = 100.0) */
const PAN_SCALE = 100.0;

/** Niveaux de zoom du jeu original (REFERENCE_GUIDE §4.7) */
export const ZOOM_LEVELS = [0.5, 1.0, 2.0, 4.0];

/** FOV perspective selon résolution (REFERENCE_GUIDE §4.7) */
export function getFovForResolution(w: number, h: number): number {
  const aspect = w / h;
  if (Math.abs(aspect - 4 / 3) < 0.05) return 38.86;   // 800×600, 1024×768
  if (Math.abs(aspect - 5 / 4) < 0.05) return 40.58;   // 1280×1024
  return 40.0; // fallback
}

// ─── Conversion grille → monde 3D ───

/**
 * Position d'un vertex de tuile dans l'espace 3D.
 * Formule exacte du jeu original :
 *   worldX = (mapX - mapY) × (TILE_W / 2)
 *   worldY = elevation × ELEVATION_SCALE
 *   worldZ = (mapX + mapY) × (TILE_H / 2)
 */
export function tileVertexPosition(
  mapX: number,
  mapY: number,
  elevation: number = 0,
): { x: number; y: number; z: number } {
  return {
    x: (mapX - mapY) * (RENDER_TILE_W / 2),
    y: elevation * RENDER_ELEVATION_SCALE,
    z: (mapX + mapY) * (RENDER_TILE_H / 2),
  };
}

// ─── Configuration de la caméra Three.js ───

/**
 * Centre de la grille dans l'espace 3D.
 */
export function gridCenter(gridW: number, gridH: number): { x: number; z: number } {
  return {
    x: (gridW / 2 - gridH / 2) * (RENDER_TILE_W / 2),
    z: (gridW / 2 + gridH / 2) * (RENDER_TILE_H / 2),
  };
}

/**
 * Configure la caméra orthographique en vue SimGolf originale :
 *   - Regard vers le bas (Y négatif)
 *   - Rotation Y de 45° (azimut isométrique)
 *   - Pas d'inclinaison d'élévation — le 2:1 vient des tuiles
 */
export function setupSimGolfCamera(
  camera: THREE.OrthographicCamera,
  gridW: number,
  gridH: number,
): void {
  const { x: cx, z: cz } = gridCenter(gridW, gridH);

  // Distance verticale de la caméra
  const dist = Math.max(gridW, gridH) * RENDER_TILE_H;

  // Position : à la verticale du centre de la grille
  camera.position.set(cx, dist, cz);
  camera.up.set(0, 0, -1);      // Z négatif = nord dans le repère
  camera.lookAt(cx, 0, cz);

  // Le frustum orthographique permet de voir toute la grille
  resizeCamera(camera, gridW, gridH);

  // Rotation Y de 45° pour l'effet isométrique
  // Dans Three.js, on oriente la caméra pour regarder avec le bon angle
  // La rotation 45°Y est assurée par la position de la caméra au-dessus
  // du centre + la forme des tuiles (RENDER_TILE_W × RENDER_TILE_H = 2:1)
}

/**
 * Redimensionne le frustum de la caméra pour la taille de la fenêtre.
 */
export function resizeCamera(
  camera: THREE.OrthographicCamera,
  gridW: number,
  gridH: number,
  zoom: number = 1,
): void {
  const aspect = window.innerWidth / window.innerHeight;
  const worldW = gridW * RENDER_TILE_W;
  const worldH = gridH * RENDER_TILE_H;
  const dim = Math.max(worldW, worldH) * 0.6 / zoom;

  camera.left   = -(dim * aspect) / 2;
  camera.right  =  (dim * aspect) / 2;
  camera.top    =   dim / 2;
  camera.bottom =  -dim / 2;
  camera.updateProjectionMatrix();
}

/**
 * Calcule le décalage de panoramique en fonction de la position
 * de la souris et du niveau de zoom.
 *
 * Formule : factor = 100.0 / zoom (basée sur PAN_SCALE = 100.0 du jeu original)
 */
export function panFactor(zoom: number): number {
  return PAN_SCALE / zoom;
}
