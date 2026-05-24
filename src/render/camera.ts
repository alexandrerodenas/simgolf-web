/**
 * render/camera.ts — Caméra orthographique pour projection dimétrique 2:1
 *
 * SimGolf utilise une projection dimétrique (pas isométrique) :
 * rapport 2:1, angle d'élévation = arctan(1/√2) ≈ 35.264°.
 *
 * Transformation grille → écran du jeu original :
 *   screenX = (mapX - mapY) × 64
 *   screenY = (mapX + mapY) × 32 - elevation × 32
 *
 * ⚠️ SOURCE DE VÉRITÉ : terrain-ts pour les types, mais les constantes
 * de rendu sont définies localement (échelle Three.js = 2× terrain-ts).
 */

import * as THREE from 'three';
import { RENDER_TILE_W, RENDER_TILE_H, RENDER_ELEVATION_SCALE } from '../core/types';

// ─── Caméra 2D (rendu Canvas) ───

export interface Camera2D {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export function createCamera2D(): Camera2D {
  return { offsetX: 0, offsetY: 0, zoom: 1 };
}

// ─── Projection Dimétrique ───

const AZIMUTH = Math.PI / 4;
const ELEVATION = Math.atan(1 / Math.sqrt(2));

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
 * Crée la caméra orthographique Three.js pour projection dimétrique.
 */
export function createDimetricCamera(
  gridW: number,
  gridH: number,
): { camera: THREE.OrthographicCamera } {
  const aspect = window.innerWidth / window.innerHeight;
  const { x: cx, z: cz } = gridCenter(gridW, gridH);

  const worldW = gridW * (RENDER_TILE_W / 2);
  const worldH = gridH * (RENDER_TILE_H / 2);
  const baseDim = Math.max(worldW, worldH) * 1.2;

  const frustumH = baseDim;
  const frustumW = baseDim * aspect;

  const dist = baseDim * 2.2;
  const farPlane = dist * 3;

  const camera = new THREE.OrthographicCamera(
    -frustumW / 2, frustumW / 2,
    frustumH / 2, -frustumH / 2,
    0.1, farPlane,
  );
  camera.zoom = 1;

  camera.position.set(
    cx + dist * Math.cos(ELEVATION) * Math.sin(AZIMUTH),
    dist * Math.sin(ELEVATION),
    cz + dist * Math.cos(ELEVATION) * Math.cos(AZIMUTH),
  );
  camera.lookAt(cx, 0, cz);

  return { camera };
}

/**
 * Redimensionne la caméra au resize de la fenêtre.
 */
export function resizeDimetricCamera(
  camera: THREE.OrthographicCamera,
  gridW: number,
  gridH: number,
): void {
  const aspect = window.innerWidth / window.innerHeight;
  const worldW = gridW * (RENDER_TILE_W / 2);
  const worldH = gridH * (RENDER_TILE_H / 2);
  const baseDim = Math.max(worldW, worldH) * 1.2;

  camera.left = -(baseDim * aspect) / 2;
  camera.right = (baseDim * aspect) / 2;
  camera.top = baseDim / 2;
  camera.bottom = -baseDim / 2;
  camera.updateProjectionMatrix();
}

/**
 * Position d'un vertex de tuile dans l'espace Three.js.
 * Formule exacte de la projection du jeu original.
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
