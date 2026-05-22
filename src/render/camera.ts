/**
 * render/camera.ts — Caméra orthographique pour projection dimétrique 2:1
 *
 * SimGolf utilise une projection dimétrique (pas isométrique) :
 * rapport 2:1, angle d'élévation = arctan(0.5) ≈ 26.565°.
 *
 * Transformation grille → écran du jeu original :
 *   screenX = (mapX - mapY) × 64
 *   screenY = (mapX + mapY) × 32 - elevation × 32
 *
 * En Three.js on utilise un BufferGeometry où chaque vertex est placé
 * en 3D selon cette même formule (XZ = plan sol, Y = hauteur).
 * La caméra est orientée avec rotation.order = 'YXZ' :
 *   y = ±45°  (azimuth = axes diagonaux)
 *   x = arctan(0.5) ≈ 26.565°  (inclinaison = rapport 2:1)
 */

import * as THREE from 'three';
import { TILE_W, TILE_H, ELEVATION_SCALE } from '../core/types';

/**
 * Crée la caméra orthographique pour la projection dimétrique 2:1.
 *
 * @param gridW   Largeur de la grille en tuiles
 * @param gridH   Hauteur de la grille en tuiles
 * @param zoom    Facteur de zoom
 * @returns       { camera }
 */
export function createDimetricCamera(
  gridW: number,
  gridH: number,
  zoom: number = 1,
): { camera: THREE.OrthographicCamera } {
  const aspect = window.innerWidth / window.innerHeight;

  // Taille du frustum = la plus grande dimension de la grille
  // majorée de 20% pour les marges
  const worldW = gridW * (TILE_W / 2);   // 40 × 64 = 2560
  const worldH = gridH * (TILE_H / 2);   // 40 × 32 = 1280
  const maxDim = Math.max(worldW, worldH) * 1.2 / zoom;

  const frustumH = maxDim;
  const frustumW = maxDim * aspect;

  const camera = new THREE.OrthographicCamera(
    -frustumW / 2, frustumW / 2,
    frustumH / 2, -frustumH / 2,
    0.1, 5000,
  );

  // ---- Orientation dimétrique 2:1 ----
  // Ordre de rotation YXZ pour éviter les gimbal locks
  camera.rotation.order = 'YXZ';

  // 1. Rotation Y = 45° pour que la grille apparaisse en diagonale
  camera.rotation.y = Math.PI / 4;

  // 2. Rotation X = arctan(0.5) ≈ 26.565° pour le ratio 2:1
  camera.rotation.x = -Math.atan(0.5);

  // 3. Centrer puis reculer selon l'angle local de la caméra
  const centerX = (gridW / 2 - gridH / 2) * (TILE_W / 2);
  const centerZ = (gridW / 2 + gridH / 2) * (TILE_H / 2);
  const dist = maxDim * 2.2;

  camera.position.set(centerX, 0, centerZ);
  camera.translateZ(dist);

  camera.near = 0.1;
  camera.far = dist * 3;
  camera.updateProjectionMatrix();

  return { camera };
}

/**
 * Redimensionne la caméra lors du resize de la fenêtre.
 */
export function resizeDimetricCamera(
  camera: THREE.OrthographicCamera,
  gridW: number,
  gridH: number,
  zoom: number = 1,
): void {
  const aspect = window.innerWidth / window.innerHeight;
  const worldW = gridW * (TILE_W / 2);
  const worldH = gridH * (TILE_H / 2);
  const maxDim = Math.max(worldW, worldH) * 1.2 / zoom;

  camera.left = -(maxDim * aspect) / 2;
  camera.right = (maxDim * aspect) / 2;
  camera.top = maxDim / 2;
  camera.bottom = -maxDim / 2;
  camera.updateProjectionMatrix();
}

/**
 * Position d'un vertex de tuile dans l'espace Three.js.
 * Formule exacte de la projection du jeu original :
 *   x = (mapX - mapY) × 64
 *   y = elevation × 32
 *   z = (mapX + mapY) × 32
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
