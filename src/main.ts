/**
 * main.ts — Moteur de rendu 3D SimGolf (Three.js)
 *
 * Projection dimétrique 2:1, éclairage lambertien comme le jeu original.
 * Normales 3D calculées depuis l'élévation.
 * Bordures entre types de terrain (strips overlay avec orientation A-D).
 *
 * Contrôles : pan tactile (1 doigt) / souris, pincement (2 doigts) /
 * molette pour le zoom.
 *
 * Raccourcis :
 *   R  →  Reset vue
 *   T  →  Vue de dessus
 *   D  →  Debug overlay
 */

import * as THREE from 'three';
import { generateVegetationGrid } from './world/terrain';
import { getGeometryType } from './terrain-lib/index.js';
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

// ---- 4. Génération du terrain ----
const mapState = generateVegetationGrid(MAP_W, MAP_H);
renderer.loadMap(mapState);

console.log(`[SimGolf] Carte ${MAP_W}×${MAP_H}, ${mapState.tiles.length} tuiles`);

// ---- 5. Caméra — configuration unique ----
const cam = renderer.camera;
const center = gridCenter(MAP_W, MAP_H);
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 15;

/** Met à jour le frustum de la caméra en fonction de la taille de la fenêtre */
function resizeFrustum(): void {
  const aspect = window.innerWidth / window.innerHeight;
  const dim = Math.max(MAP_W, MAP_H) * 55;
  cam.left   = -(dim * aspect) / 2;
  cam.right  =  (dim * aspect) / 2;
  cam.top    =   dim / 2;
  cam.bottom =  -dim / 2;
  cam.updateProjectionMatrix();
}

/** Positionne la caméra en vue dimétrique pointant vers (tx, ty, tz) */
function setDimetricView(tx: number, ty: number, tz: number): void {
  const dist = Math.max(MAP_W, MAP_H) * 55;
  const AZ = Math.PI / 4;
  const EL = Math.atan(1 / Math.sqrt(2));
  cam.up.set(0, 1, 0);
  cam.position.set(
    tx + dist * Math.cos(EL) * Math.sin(AZ),
    ty + dist * Math.sin(EL),
    tz + dist * Math.cos(EL) * Math.cos(AZ),
  );
  cam.lookAt(tx, ty, tz);
  resizeFrustum();
}

// Centre de la carte
const CENTER_X = center.x;
const CENTER_Z = center.z;

// Point que la caméra regarde
const lookTarget = new THREE.Vector3(CENTER_X, 0, CENTER_Z);

// Vue initiale
setDimetricView(CENTER_X, 0, CENTER_Z);
cam.zoom = 1;
cam.updateProjectionMatrix();

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
    const dx = e.touches[0].clientX - lastTouchX;
    const dy = e.touches[0].clientY - lastTouchY;
    panScreen(dx, dy);
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastTouchDist > 0) {
      cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * lastTouchDist / dist));
      cam.updateProjectionMatrix();
    }
    lastTouchDist = dist;
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

/** Pan en écran : déplace le lookTarget dans le plan horizontal */
function panScreen(dx: number, dy: number): void {
  // Facteur : un pixel à zoom=1 correspond à ~2 unités monde
  const f = 2 / cam.zoom;
  // Déplacement dans le plan de la caméra (XZ avec Y=0)
  // En dimétrique, X écran ≈ (X monde × 0.7 + Z monde × 0.7) 
  // On projette simplement le déplacement dans le repère monde
  // Droite écran → +X monde (approximatif)
  // Haut écran → -Z monde (nord)
  lookTarget.x -= dx * f;
  lookTarget.z -= dy * f;
  setDimetricView(lookTarget.x, 0, lookTarget.z);
  cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom));
  cam.updateProjectionMatrix();
}

container.addEventListener('mousedown', (e: MouseEvent) => {
  mouseDown = true;
  mouseX = e.clientX;
  mouseY = e.clientY;
  container.style.cursor = 'grabbing';
});

container.addEventListener('mousemove', (e: MouseEvent) => {
  if (mouseDown) {
    panScreen(e.clientX - mouseX, e.clientY - mouseY);
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
  const factor = e.deltaY > 0 ? 1.12 : 0.88;
  cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor));
  cam.updateProjectionMatrix();
}, { passive: false });

container.style.cursor = 'grab';

// ---- 8. Raccourcis clavier ----
let debugMode = false;

function resetView(): void {
  lookTarget.set(CENTER_X, 0, CENTER_Z);
  cam.zoom = 1;
  setDimetricView(CENTER_X, 0, CENTER_Z);
  cam.updateProjectionMatrix();
}

function topDownView(): void {
  lookTarget.set(CENTER_X, 0, CENTER_Z);
  cam.zoom = 2;
  const dist = Math.max(MAP_W, MAP_H) * 60 / cam.zoom;
  cam.position.set(CENTER_X, dist * 2, CENTER_Z);
  cam.up.set(0, 0, -1);
  cam.lookAt(CENTER_X, 0, CENTER_Z);
  resizeFrustum();
  cam.zoom = 2;
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

// Resize
window.addEventListener('resize', resizeFrustum);

// ---- 9. Debug overlay ----
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

  const cw = debugCanvas.width / 2;
  const ch = debugCanvas.height / 2;
  const z = cam.zoom;

  for (const tile of mapState.tiles) {
    const ox = cw + (tile.x - tile.y) * 32 / z;
    const oy = ch + (tile.x + tile.y) * 16 / z;
    if (ox < -50 || ox > debugCanvas.width + 50 || oy < -50 || oy > debugCanvas.height + 50) continue;

    const geom = getGeometryType(tile.elevation);
    const typeNames: Record<number, string> = { 0: 'R', 7: 'DR', 14: 'W', 15: 'B' };
    const label = typeNames[tile.type] ?? String(tile.type);
    debugCtx.fillStyle = 'rgba(255,255,0,0.85)';
    debugCtx.fillText(`${label}${geom}${tile.variation}`, ox, oy);
  }
}

// ---- 10. Info tuile survolée ----
const infoEl = document.createElement('div');
infoEl.style.cssText = 'position:fixed;bottom:74px;left:8px;background:rgba(0,0,0,0.85);color:#ff0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre;display:none';
document.body.appendChild(infoEl);

/** Convertit coordonnées écran → tile grille (approximatif) */
function screenToTile(sx: number, sy: number): { x: number; y: number } | null {
  const cw = debugCanvas.width / 2;
  const ch = debugCanvas.height / 2;
  const z = cam.zoom;
  const rx = (sx - cw) / (32 / z);
  const ry = (sy - ch) / (16 / z);
  const tx = (rx + ry) / 2;
  const ty = (ry - rx) / 2;
  const x = Math.round(tx);
  const y = Math.round(ty);
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return null;
  return { x, y };
}

container.addEventListener('mousemove', (e: MouseEvent) => {
  if (mouseDown) return; // pas de hover pendant le pan
  const tile = screenToTile(e.clientX, e.clientY);
  if (tile) {
    const idx = tile.y * MAP_W + tile.x;
    const t = mapState.tiles[idx];
    const typeNames: Record<number, string> = {
      0: 'Rough', 1: 'Fairway', 2: 'PuttingGreen', 3: 'SandBunker',
      4: 'WaterShallow', 5: 'WaterMiddle', 6: 'WaterDeep', 7: 'DeepRough',
    };
    infoEl.style.display = 'block';
    infoEl.textContent = `Tile [${t.x},${t.y}]  ${typeNames[t.type] ?? t.type}  elev:[${t.elevation.join(',')}]  var:${t.variation}`;
  } else {
    infoEl.style.display = 'none';
  }
});

// ---- 11. Boucle d'animation ----
function animate(): void {
  renderer.render();
  drawDebug();
  requestAnimationFrame(animate);
}

// ---- 12. Lancement ----
animate();

// Info DOM
const el = document.createElement('div');
el.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre';
el.textContent = `SimGolf 3D — ${MAP_W}×${MAP_H}  |  Pan glisser  Zoom molette/pincée  R=réinit  T=dessus  D=debug`;
document.body.appendChild(el);
