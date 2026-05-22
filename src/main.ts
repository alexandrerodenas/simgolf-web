/**
 * main.ts — Moteur de rendu Canvas 2D SimGolf
 *
 * Projection dimétrique 2:1, rendu par tuile (losange indivisible).
 * Contrôles : pan tactile (1 doigt) / souris, pincement (2 doigts) /
 * molette pour le zoom.
 *
 * Raccourcis :
 *   R  →  Reset vue
 *   T  →  Vue de dessus
 *   D  →  Debug overlay (lettre géo + chiffre variation)
 */

import { generateParklandGrid, texturePathForTile, getGeometryType,
         computeEdgeMask, edgeMaskToVariation, maxVariationForType } from './world/terrain';
import { createCamera2D, Camera2D, tileVertexPosition } from './render/camera';
import { renderMap } from './render/TileRenderer';

// ---- 1. Constantes ----
const MAP_W = 40;
const MAP_H = 40;

// ---- 2. Canvas de rendu ----
const canvas = document.createElement('canvas');
canvas.style.cssText = 'display:block;width:100%;height:100%;position:fixed;top:0;left:0;touch-action:none';
const ctx = canvas.getContext('2d')!;
document.body.appendChild(canvas);

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.imageSmoothingEnabled = false;
}

resize();
window.addEventListener('resize', resize);

// ---- 3. Caméra 2D (pan + zoom uniquement, pas de rotation) ----
const cam = createCamera2D();

// Centrer la vue initiale : le losange central (20,20) au centre écran
const GRID_CENTER_Y = ((MAP_W / 2) + (MAP_H / 2)) * 32 + 32; // 1312 à zoom=1
cam.offsetX = canvas.width / 2;
cam.offsetY = canvas.height / 2 - GRID_CENTER_Y;
cam.zoom = 1;

// ---- 4. Génération du terrain ----
const mapState = generateParklandGrid(MAP_W, MAP_H);

// ---- 5. Pré-chargement des textures ----
const neededPaths = new Set<string>();
for (const tile of mapState.tiles) {
  const path = texturePathForTile(tile, mapState.tiles, MAP_W, MAP_H);
  if (path) neededPaths.add(path);
}

const textureImages = new Map<string, HTMLImageElement>();
const tileImages: (HTMLImageElement | undefined)[] = new Array(mapState.tiles.length);
let texturesToLoad = neededPaths.size;
let texturesLoaded = 0;

console.log(`[SimGolf] ${texturesToLoad} textures à charger`);

for (const path of neededPaths) {
  const img = new Image();
  img.onload = () => {
    textureImages.set(path, img);
    texturesLoaded++;
    if (texturesLoaded === texturesToLoad) {
      console.log('[SimGolf] Toutes les textures chargées');
    }
  };
  img.onerror = () => {
    texturesLoaded++;
    console.warn(`[SimGolf] Texture manquante: ${path}`);
  };
  img.src = path;
}

// Pré-calcul des images par tuile (mise à jour quand les textures arrivent)
function updateTileImages(): void {
  for (let i = 0; i < mapState.tiles.length; i++) {
    const path = texturePathForTile(mapState.tiles[i], mapState.tiles, MAP_W, MAP_H);
    tileImages[i] = path ? textureImages.get(path) : undefined;
  }
}

// Réessayer périodiquement le temps que les textures chargent
let frameCount = 0;

// ---- 6. Contrôles tactiles ----
let lastTouchDist = 0;
let lastTouchX = 0;
let lastTouchY = 0;
let isPanning = false;

canvas.addEventListener('touchstart', (e: TouchEvent) => {
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

canvas.addEventListener('touchmove', (e: TouchEvent) => {
  e.preventDefault();
  if (e.touches.length === 1 && isPanning) {
    const dx = e.touches[0].clientX - lastTouchX;
    const dy = e.touches[0].clientY - lastTouchY;
    cam.offsetX += dx;
    cam.offsetY += dy;
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastTouchDist > 0) {
      const scale = dist / lastTouchDist;
      cam.zoom = Math.max(0.5, Math.min(20, cam.zoom * scale));
    }
    lastTouchDist = dist;
    // Pan avec le centre du pinch
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    if (lastTouchX !== 0) {
      cam.offsetX += mx - lastTouchX;
      cam.offsetY += my - lastTouchY;
    }
    lastTouchX = mx;
    lastTouchY = my;
  }
}, { passive: false });

canvas.addEventListener('touchend', () => {
  isPanning = false;
  lastTouchDist = 0;
});

// ---- 7. Contrôles souris ----
let mouseDown = false;
let mouseX = 0;
let mouseY = 0;

canvas.addEventListener('mousedown', (e: MouseEvent) => {
  mouseDown = true;
  mouseX = e.clientX;
  mouseY = e.clientY;
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('mousemove', (e: MouseEvent) => {
  if (mouseDown) {
    const dx = e.clientX - mouseX;
    const dy = e.clientY - mouseY;
    cam.offsetX += dx;
    cam.offsetY += dy;
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
});

canvas.addEventListener('mouseup', () => {
  mouseDown = false;
  canvas.style.cursor = 'grab';
});

canvas.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  cam.zoom = Math.max(0.5, Math.min(20, cam.zoom * delta));
}, { passive: false });

canvas.style.cursor = 'grab';

// ---- 8. Raccourcis clavier ----
let debugMode = false;

function resetView(): void {
  cam.offsetX = canvas.width / 2;
  cam.offsetY = canvas.height / 2 - GRID_CENTER_Y;
  cam.zoom = 1;
}

function topDownView(): void {
  cam.offsetX = canvas.width / 2;
  cam.offsetY = canvas.height / 2;
  cam.zoom = 1;
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

// ---- 9. Debug overlay ----
const debugCanvas = document.createElement('canvas');
debugCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:998';
const debugCtx = debugCanvas.getContext('2d')!;
document.body.appendChild(debugCanvas);

function resizeDebug(): void {
  debugCanvas.width = canvas.width;
  debugCanvas.height = canvas.height;
}
resizeDebug();

function drawDebug(): void {
  if (!debugMode) return;
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  debugCtx.font = `${12 * devicePixelRatio}px monospace`;
  debugCtx.textAlign = 'center';
  debugCtx.textBaseline = 'middle';
  const z = cam.zoom;
  for (const tile of mapState.tiles) {
    const ox = (tile.x - tile.y) * 64 * z + cam.offsetX;
    const oy = (tile.x + tile.y) * 32 * z + cam.offsetY;
    const sx = ox;
    const sy = oy + 32 * z; // centre du losange
    if (sx < -50 || sx > debugCanvas.width + 50 || sy < -50 || sy > debugCanvas.height + 50) continue;
    const geom = getGeometryType(tile.elevation);
    const mask = computeEdgeMask(mapState.tiles, MAP_W, MAP_H, tile.x, tile.y);
    const edgeVar = edgeMaskToVariation(mask, maxVariationForType(tile.type));
    debugCtx.fillStyle = 'rgba(255,255,0,0.85)';
    debugCtx.fillText(`${geom}${edgeVar}`, sx, sy);
  }
}

// ---- 10. Boucle d'animation ----
function animate(): void {
  // Mettre à jour les images de texture périodiquement
  frameCount++;
  if (frameCount % 30 === 0 && texturesLoaded < texturesToLoad) {
    updateTileImages();
  }
  if (frameCount === 1 || texturesLoaded === texturesToLoad) {
    updateTileImages();
  }

  // Effacer
  ctx.fillStyle = '#1a3a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Rendu des tuiles
  const getImage = (idx: number) => tileImages[idx];
  const isTopDown = cam.offsetY > canvas.height / 2 + 100; // seuil vue dessus
  renderMap(ctx, mapState, cam, getImage, isTopDown);

  // Debug
  drawDebug();

  requestAnimationFrame(animate);
}

// Lancer l'animation après un premier update
updateTileImages();
animate();

// ---- Bouton Debug tactile ----
const debugBtn = document.createElement('button');
debugBtn.textContent = 'D';
debugBtn.style.cssText = `
  position:fixed;bottom:70px;right:12px;z-index:1000;
  width:48px;height:48px;border-radius:24px;
  background:rgba(0,0,0,0.7);color:#ff0;
  font:bold 20px monospace;border:2px solid rgba(255,255,0,0.3);
  cursor:pointer;touch-action:manipulation;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 2px 8px rgba(0,0,0,0.5);
`;
debugBtn.addEventListener('click', () => {
  debugMode = !debugMode;
  debugBtn.style.background = debugMode
    ? 'rgba(255,255,0,0.3)'
    : 'rgba(0,0,0,0.7)';
  debugBtn.style.borderColor = debugMode
    ? 'rgba(255,255,0,0.9)'
    : 'rgba(255,255,0,0.3)';
  console.log(`[SimGolf] Debug ${debugMode ? 'ON' : 'OFF'}`);
});
document.body.appendChild(debugBtn);

// ---- Info DOM ----
const el = document.createElement('div');
el.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre';
el.textContent = `SimGolf — Parkland ${MAP_W}×${MAP_H}\nTouch: pan + pinch zoom  |  R=réinit  T=dessus  D=debug`;
document.body.appendChild(el);
