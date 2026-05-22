/**
 * render/camera.ts — Caméra orthographique pour projection dimétrique 2:1
 *
 * SimGolf utilise une projection dimétrique (pas isométrique) :
 * rapport 2:1 (tuile 128×64 pixels), angle d'élévation = arctan(1/√2) ≈ 35.264°.
 *
 * Transformation grille → écran du jeu original :
 *   screenX = (mapX - mapY) × 64
 *   screenY = (mapX + mapY) × 32 - elevation × 32
 *
 * En Three.js les tuiles sont placées à plat sur le plan XZ avec la hauteur
 * sur Y. La caméra est positionnée dans l'espace selon l'azimuth 45° et
 * l'élévation arctan(1/√2), puis orientée vers le centre de la grille.
 */

import * as THREE from 'three';
import { TILE_W, TILE_H, ELEVATION_SCALE } from '../core/types';

const AZIMUTH = Math.PI / 4;                   // 45° — axes diagonaux
const ELEVATION = Math.atan(1 / Math.sqrt(2)); // ≈ 35.264° — dimétrique 2:1

/**
 * Calcule le centre de la grille dans l'espace Three.js.
 * Exporté pour OrbitControls.
 */
export function gridCenter(gridW: number, gridH: number): { x: number; z: number } {
  return {
    x: (gridW / 2 - gridH / 2) * (TILE_W / 2),
    z: (gridW / 2 + gridH / 2) * (TILE_H / 2),
  };
}

/**
 * Crée la caméra orthographique pour la projection dimétrique 2:1.
 *
 * Positionne la caméra dans l'espace 3D à l'azimuth 45° et l'élévation
 * arctan(1/√2), puis la fait regarder vers le centre de la grille.
 * Le frustum s'adapte au viewport.
 *
 * Le zoom est géré par OrbitControls via camera.zoom.
 */
export function createDimetricCamera(
  gridW: number,
  gridH: number,
): { camera: THREE.OrthographicCamera } {
  const aspect = window.innerWidth / window.innerHeight;
  const { x: cx, z: cz } = gridCenter(gridW, gridH);

  // Taille de base du monde visible (sans zoom)
  const worldW = gridW * (TILE_W / 2);
  const worldH = gridH * (TILE_H / 2);
  const baseDim = Math.max(worldW, worldH) * 1.2;

  // Frustum adapté au viewport
  const frustumH = baseDim;
  const frustumW = baseDim * aspect;

  // Distance caméra → centre du terrain
  const dist = baseDim * 2.2;
  const farPlane = dist * 3;

  const camera = new THREE.OrthographicCamera(
    -frustumW / 2, frustumW / 2,
    frustumH / 2, -frustumH / 2,
    0.1, farPlane,
  );
  camera.zoom = 1;

  // ---- Position de la caméra en 3D ----
  camera.position.set(
    cx + dist * Math.cos(ELEVATION) * Math.sin(AZIMUTH),
    dist * Math.sin(ELEVATION),
    cz + dist * Math.cos(ELEVATION) * Math.cos(AZIMUTH),
  );
  camera.lookAt(cx, 0, cz);

  return { camera };
}

/**
 * Redimensionne la caméra lors du resize de la fenêtre.
 * Recalcule left/right/top/bottom tout en conservant l'aspect ratio.
 * Préserve camera.zoom (géré par OrbitControls).
 */
export function resizeDimetricCamera(
  camera: THREE.OrthographicCamera,
  gridW: number,
  gridH: number,
): void {
  const aspect = window.innerWidth / window.innerHeight;
  const worldW = gridW * (TILE_W / 2);
  const worldH = gridH * (TILE_H / 2);
  const baseDim = Math.max(worldW, worldH) * 1.2;

  camera.left = -(baseDim * aspect) / 2;
  camera.right = (baseDim * aspect) / 2;
  camera.top = baseDim / 2;
  camera.bottom = -baseDim / 2;
  camera.updateProjectionMatrix();
}

/**
 * Position d'un vertex de tuile dans l'espace Three.js.
 * Formule exacte de la projection du jeu original :
 *   x = (mapX - mapY) × 64      (TILE_W / 2)
 *   y = elevation × 32           (ELEVATION_SCALE)
 *   z = (mapX + mapY) × 32      (TILE_H / 2)
 */
export function tileVertexPosition(
  mapX: number,
  mapY: number,
  elevation: number = 0,
): { x: number; y: number; z: number } {
  return {
    x: (mapX - mapY) * (TILE_W / 2),
    y: elevation * ELEVATION_SCALE,
    z: (mapX + mapY) * (TILE_H / 2),
  };
}
