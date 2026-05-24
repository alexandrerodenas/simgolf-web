/**
 * main.ts — Moteur de rendu 3D SimGolf (Three.js)
 *
 * Projection dimétrique 2:1, éclairage lambertien comme le jeu original.
 * Normales 3D calculées depuis l'élévation.
 *
 * Contrôles : pan tactile (1 doigt) / souris, pincement (2 doigts) /
 * molette pour le zoom.
 *
 * Raccourcis :
 *   R  →  Reset vue
 *   T  →  Vue de dessus
 *   D  →  Debug overlay (type + géométrie + variation)
 */

import * as THREE from 'three';
import { generateVegetationGrid } from './world/terrain';
import { getGeometryType, TileType } from './terrain-lib/index.js';
import { ThreeRenderer } from './render/ThreeRenderer';
import { gridCenter } from './render/camera';

// ---- 1. Constantes ----
const MAP_W = 40;
const MAP_H = 40;

// ---- 2. Conteneur pour Three.js ----
const container = document.createElement('div');
container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;overflow:hidden';
document.body.appendChild(container);

// ---- 3. Initialisation du renderer Three.js ----
const renderer = new ThreeRenderer(container);

// ---- 4. Génération du terrain (avec élévation) ----
const mapState = generateVegetationGrid(MAP_W, MAP_H);
renderer.loadMap(mapState);

console.log(`[SimGolf] Carte générée : ${MAP_W}×${MAP_H}, ${mapState.tiles.length} tuiles`);
console.log(`[SimGolf] Éclairage : ambient=${mapState.lighting.ambient}, diffuse=${mapState.lighting.diffuse}, dir=${mapState.lighting.lightDir}`);

// ---- 5. Point focal de la caméra (point que la caméra regarde) ----
const center = gridCenter(MAP_W, MAP_H);
const focusPoint = new THREE.Vector3(center.x, 0, center.z);

/**
 * Recalcule la position de la caméra en fonction du focusPoint + zoom.
 * La caméra reste à distance fixe du focus avec le même angle dimétrique.
 */
function updateCameraFromFocus(): void {
  const cam = renderer.camera;
  const dist = Math.max(MAP_W, MAP_H) * 50 / cam.zoom;
  const AZIMUTH = Math.PI / 4;
  const ELEVATION = Math.atan(1 / Math.sqrt(2));

  cam.position.set(
    focusPoint.x + dist * Math.cos(ELEVATION) * Math.sin(AZIMUTH),
    focusPoint.y + dist * Math.sin(ELEVATION),
    focusPoint.z + dist * Math.cos(ELEVATION) * Math.cos(AZIMUTH),
  );
  cam.lookAt(focusPoint);

  // Ajuster frustum si zoom change
  const aspect = window.innerWidth / window.innerHeight;
  const baseDim = Math.max(MAP_W, MAP_H) * 60;
  cam.left = -(baseDim * aspect) / 2;
  cam.right = (baseDim * aspect) / 2;
  cam.top = baseDim / 2;
  cam.bottom = -baseDim / 2;
  cam.zoom = 1; // On utilise la distance (dist) pour le zoom, pas la propriété zoom
  cam.updateProjectionMatrix();
}

// Initialisation de la vue
updateCameraFromFocus();

// ---- 6. Contrôles tactiles ----
let lastTouchDist = 0;
let lastTouchX = 0;
let lastTouchY = 0;
let isPanning = false;

container.addEventListener('touchstart', (e: TouchEvent) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    isPanning = true;
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    isPanning = false;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastTouchDist = Math.sqrt(dx * dx + dy * dy);
  }
}, { passive: false });

container.addEventListener('touchmove', (e: TouchEvent) => {
  e.preventDefault();
  if (e.touches.length === 1 && isPanning) {
    const dx = (e.touches[0].clientX - lastTouchX);
    const dy = (e.touches[0].clientY - lastTouchY);

    // Facteur d'échelle : au zoom max, on panne plus lentement
    const zoomFactor = renderer.currentZoom;
    focusPoint.x -= dx * zoomFactor * 0.5;
    focusPoint.z -= dy * zoomFactor * 0.5;
    updateCameraFromFocus();

    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastTouchDist > 0) {
      const scale = lastTouchDist / dist;
      renderer.currentZoom = Math.max(0.3, Math.min(20, renderer.currentZoom * scale));
      updateCameraFromFocus();
    }
    lastTouchDist = dist;
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    if (lastTouchX !== 0) {
      const dx2 = mx - lastTouchX;
      const dy2 = my - lastTouchY;
      const zoomFactor = renderer.currentZoom;
      focusPoint.x -= dx2 * zoomFactor;
      focusPoint.z -= dy2 * zoomFactor;
      updateCameraFromFocus();
    }
    lastTouchX = mx;
    lastTouchY = my;
  }
}, { passive: false });

container.addEventListener('touchend', () => {
  isPanning = false;
  lastTouchDist = 0;
});

// ---- 7. Contrôles souris ----
let mouseDown = false;
let mouseX = 0;
let mouseY = 0;

container.addEventListener('mousedown', (e: MouseEvent) => {
  mouseDown = true;
  mouseX = e.clientX;
  mouseY = e.clientY;
  container.style.cursor = 'grabbing';
});

container.addEventListener('mousemove', (e: MouseEvent) => {
  if (mouseDown) {
    const dx = e.clientX - mouseX;
    const dy = e.clientY - mouseY;
    const zoomFactor = renderer.currentZoom;
    focusPoint.x -= dx * zoomFactor * 2;
    focusPoint.z -= dy * zoomFactor * 2;
    updateCameraFromFocus();
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
});

container.addEventListener('mouseup', () => {
  mouseDown = false;
  container.style.cursor = 'grab';
});

container.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 1.15 : 0.85;
  renderer.currentZoom = Math.max(0.3, Math.min(20, renderer.currentZoom * delta));
  updateCameraFromFocus();
}, { passive: false });

container.style.cursor = 'grab';

// ---- 8. Raccourcis clavier ----
let debugMode = false;

function resetView(): void {
  renderer.currentZoom = 1;
  focusPoint.set(center.x, 0, center.z);
  updateCameraFromFocus();
}

function topDownView(): void {
  const cam = renderer.camera;
  renderer.currentZoom = 1.5;
  const dist = Math.max(MAP_W, MAP_H) * 50 / renderer.currentZoom;
  cam.position.set(focusPoint.x, dist, focusPoint.z);
  cam.up.set(0, 0, -1);
  cam.lookAt(focusPoint);

  const aspect = window.innerWidth / window.innerHeight;
  const baseDim = Math.max(MAP_W, MAP_H) * 60;
  cam.left = -(baseDim * aspect) / 2;
  cam.right = (baseDim * aspect) / 2;
  cam.top = baseDim / 2;
  cam.bottom = -baseDim / 2;
  cam.zoom = 1;
  cam.updateProjectionMatrix();
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetView(); }
  else if (e.key === 't' || e.key === 'T') { e.preventDefault(); topDownView(); }
  else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    debugMode = !debugMode;
    console.log(`[SimGolf] Debug ${debugMode ? 'ON' : 'OFF'}`);
  }
});

// ---- 9. Debug overlay (Canvas 2D) ----
const debugCanvas = document.createElement('canvas');
debugCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:998';
const debugCtx = debugCanvas.getContext('2d')!;
document.body.appendChild(debugCanvas);

function resizeDebug(): void {
  debugCanvas.width = window.innerWidth;
  debugCanvas.height = window.innerHeight;
}
resizeDebug();
window.addEventListener('resize', resizeDebug);

function drawDebug(): void {
  if (!debugMode) return;
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  debugCtx.font = `${12 * window.devicePixelRatio}px monospace`;
  debugCtx.textAlign = 'center';
  debugCtx.textBaseline = 'middle';

  // Vue centrée approximative
  const cx = debugCanvas.width / 2;
  const cy = debugCanvas.height / 2;
  const zf = renderer.currentZoom;

  for (const tile of mapState.tiles) {
    // Projection grille → écran (simplifiée)
    const ox = cx + (tile.x - tile.y) * 32 / zf;
    const oy = cy + (tile.x + tile.y) * 16 / zf;
    if (ox < -50 || ox > debugCanvas.width + 50 || oy < -50 || oy > debugCanvas.height + 50) continue;

    const geom = getGeometryType(tile.elevation);
    const typeNames: Record<number, string> = {
      0: 'R', 7: 'DR', 14: 'W', 15: 'B',
    };
    const label = typeNames[tile.type] ?? String(tile.type);
    debugCtx.fillStyle = 'rgba(255,255,0,0.85)';
    debugCtx.fillText(`${label}${geom}${tile.variation}`, ox, oy);
  }
}

// ---- 10. Boucle d'animation ----
function animate(): void {
  renderer.render();
  drawDebug();
  requestAnimationFrame(animate);
}

// ---- 11. Info tuile survolée ----
const infoEl = document.createElement('div');
infoEl.style.cssText = 'position:fixed;bottom:74px;left:8px;background:rgba(0,0,0,0.85);color:#ff0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre;display:none';
document.body.appendChild(infoEl);

/** Convertit coordonnées écran → tile grille (approximatif) */
function screenToTile(sx: number, sy: number): { x: number; y: number } | null {
  const cx = debugCanvas.width / 2;
  const cy = debugCanvas.height / 2;
  const zf = renderer.currentZoom;
  const rx = (sx - cx) / (32 / zf);
  const ry = (sy - cy) / (16 / zf);
  const tx = (rx + ry) / 2;
  const ty = (ry - rx) / 2;
  const x = Math.round(tx);
  const y = Math.round(ty);
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return null;
  return { x, y };
}

container.addEventListener('mousemove', (e: MouseEvent) => {
  const tile = screenToTile(e.clientX, e.clientY);
  if (tile) {
    const idx = tile.y * MAP_W + tile.x;
    const t = mapState.tiles[idx];
    const typeNames: Record<number, string> = {
      0: 'Rough', 1: 'Fairway', 2: 'PuttingGreen', 3: 'SandBunker',
      4: 'WaterShallow', 5: 'WaterMiddle', 6: 'WaterDeep', 7: 'DeepRough',
      8: 'GrassySand', 9: 'GrassBunker', 10: 'Tee', 11: 'Cliff',
      12: 'Path', 13: 'Building', 14: 'Woods', 15: 'Brush',
    };
    const elType = typeNames[t.type] ?? `Type${t.type}`;
    infoEl.style.display = 'block';
    infoEl.textContent = `Tile [${t.x},${t.y}]  ${elType}  elev:[${t.elevation.join(',')}]  var:${t.variation}  passes:${t.renderPasses.length}`;
  } else {
    infoEl.style.display = 'none';
  }
});

// ---- 12. Lancement ----
animate();

// ---- 13. Info DOM ----
const el = document.createElement('div');
el.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre';
el.textContent = `SimGolf 3D — ${MAP_W}×${MAP_H}  |  Touch: pan + pinch zoom  |  R=réinit  T=dessus  D=debug`;
document.body.appendChild(el);
