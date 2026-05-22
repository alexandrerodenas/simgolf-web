/**
 * render/camera.ts — Configuration de la caméra orthographique pour
 * la projection dimétrique 2:1 du jeu SimGolf original.
 *
 * La projection originale (REFERENCE_GUIDE.md §4.2) transforme les
 * coordonnées grille (mapX, mapY) en pixels écran :
 *
 *   screenX = (mapX - mapY) × 64       (TILE_W / 2)
 *   screenY = (mapX + mapY) × 32       (TILE_H / 2)
 *
 * En Three.js, on place la grille dans le plan XZ et on positionne
 * la caméra pour reproduire ce rapport 2:1.
 *
 * L'angle d'inclinaison (elevation de la caméra) est calculé pour
 * qu'un carré unitaire du plan XZ apparaisse comme un losange 2:1
 * sur l'écran. Avec une rotation azimuthale de 45°, l'angle
 * d'élévation nécessaire est arctan(1/sqrt(2)) ≈ 35.26°.
 *
 * Élévation du terrain : chaque vertex a sa hauteur sur Y, ce qui
 * donne un effet 3D isométrique au-dessus du plan de base.
 */

import * as THREE from 'three';
import { TILE_W, TILE_H, ELEVATION_SCALE } from '../core/types';

/**
 * Crée et configure la caméra orthographique pour la projection
 * dimétrique 2:1 du jeu original.
 *
 * @param width  Largeur de la grille en tuiles
 * @param height Hauteur de la grille en tuiles
 * @param zoom   Facteur de zoom (1 = vue complète)
 * @returns      { camera, controls } — caméra configurée + wrapper orbites
 */
export function createDimetricCamera(
  width: number,
  height: number,
  zoom: number = 1,
): { camera: THREE.OrthographicCamera } {
  // ---- 1. Dimensions de la scène en unités Three.js ----
  // Chaque tuile fait TILE_W×TILE_H dans la projection 2D.
  // En 3D, on place les tuiles dans le plan XZ avec un espacement
  // de TILE_W/2 sur X et TILE_H/2 sur Z entre les axes diagonaux.

  // Taille de la grille en unités 3D
  const gridW = width * (TILE_W / 2);   // taille X
  const gridH = height * (TILE_H / 2);  // taille Z

  // Le centre de la grille en 3D
  const centerX = 0;
  const centerZ = 0;

  // ---- 2. Rapport d'aspect de la fenêtre ----
  const aspect = window.innerWidth / window.innerHeight;

  // ---- 3. Taille du frustum orthographique ----
  // On calcule le frustum pour voir toute la grille avec un zoom
  // L'orthographic frustum est défini en unités écran
  const maxDim = Math.max(gridW * 1.2, gridH * 1.2) / zoom;
  const frustumH = maxDim;
  const frustumW = maxDim * aspect;

  const camera = new THREE.OrthographicCamera(
    -frustumW / 2, frustumW / 2,
    frustumH / 2, -frustumH / 2,
    0.1, 2000,
  );

  // ---- 4. Position de la caméra pour la projection 2:1 ----
  // Azimuth : 45° (les axes de la grille apparaissent en diagonale)
  // Élévation : arctan(1/√2) ≈ 35.26° pour le rapport 2:1
  const azimuth = Math.PI / 4;       // 45°
  const elevation = Math.atan(1 / Math.sqrt(2)); // ≈ 35.26°
  const distance = maxDim * 2.5;

  camera.position.set(
    centerX + distance * Math.cos(elevation) * Math.sin(azimuth),
    distance * Math.sin(elevation),
    centerZ + distance * Math.cos(elevation) * Math.cos(azimuth),
  );

  camera.lookAt(centerX, 0, centerZ);

  // ---- 5. Plan proche/loin adapté à l'échelle ----
  camera.near = 0.1;
  camera.far = distance * 3;
  camera.updateProjectionMatrix();

  return { camera };
}

/**
 * Met à jour la caméra lors du redimensionnement de la fenêtre.
 */
export function resizeCamera(
  camera: THREE.OrthographicCamera,
  width: number,
  height: number,
  zoom: number = 1,
): void {
  const aspect = window.innerWidth / window.innerHeight;
  const maxDim = Math.max(width * 64 * 1.2, height * 32 * 1.2) / zoom;

  camera.left = -(maxDim * aspect) / 2;
  camera.right = (maxDim * aspect) / 2;
  camera.top = maxDim / 2;
  camera.bottom = -maxDim / 2;
  camera.updateProjectionMatrix();
}

/**
 * Fonction de projection grille→3D pour un vertex de tuile.
 *
 * Place un point (mapX, mapY, elevation) dans l'espace Three.js
 * de façon à ce que la grille apparaisse en projection 2:1.
 *
 * @param mapX       Coordonnée grille X (en tuiles)
 * @param mapY       Coordonnée grille Y (en tuiles)
 * @param elevation  Hauteur (0-4)
 * @returns          Position { x, y, z } en espace Three.js
 */
export function tileVertexPosition(
  mapX: number,
  mapY: number,
  elevation: number = 0,
): { x: number; y: number; z: number } {
  const tileW2 = TILE_W / 2;   // 64
  const tileH2 = TILE_H / 2;   // 32

  return {
    x: (mapX - mapY) * tileW2,
    y: elevation * ELEVATION_SCALE,
    z: (mapX + mapY) * tileH2,
  };
}
