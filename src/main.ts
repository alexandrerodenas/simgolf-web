/**
 * main.ts — Moteur de rendu 3D SimGolf (Three.js)
 *
 * Projection dimétrique 2:1, pas d'éclairage (comme le jeu original).
 * Toolbar overlay en bas de l'écran avec 5 panels d'outils.
 * Clic sur la carte applique l'outil sélectionné.
 *
 * Contrôles :
 *   - Pan : glisser souris / 1 doigt
 *   - Zoom : molette / pincer 2 doigts
 *   - Clic : applique l'outil sélectionné sur la tuile
 * Raccourcis :
 *   R → Reset  T → Dessus  V → View mode  D → Debug
 */

import * as THREE from 'three';
import { generateGridRough } from './world/terrain';
import { getGeometryType, Terrain } from './terrain-lib/index.js';
import { TileType, ITile } from './terrain-lib/types.js';
import { ThreeRenderer } from './render/ThreeRenderer';
import { gridCenter, resizeCamera } from './render/camera';
import { initToolbar, getActiveTool, getActivePanel } from './ui/toolbar';

// ---- 1. Constantes ----
const MAP_W = 40;
const MAP_H = 40;
const TOOLBAR_H = 120;

// ---- 2. Conteneur Three.js ----
const container = document.getElementById('game-container')!;

// ---- 3. Initialisation ----
const renderer = new ThreeRenderer(container);
const terrain = Terrain.getInstance();
const mapState = generateGridRough(MAP_W, MAP_H);
renderer.loadMap(mapState);

console.log(`[SimGolf] Carte ${MAP_W}×${MAP_H}, ${mapState.tiles.length} tuiles`);

// ---- 4. Caméra ----
const cam = renderer.camera;
const center = gridCenter(MAP_W, MAP_H);
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const cx = center.x;
const cz = center.z;
const camDist = Math.max(MAP_W, MAP_H) * 64;

cam.position.set(cx, camDist, cz);
cam.up.set(0, 0, -1);
cam.lookAt(cx, 0, cz);
cam.zoom = 1;
const lookTarget = new THREE.Vector3(cx, 0, cz);
resizeCamera(cam, MAP_W, MAP_H, cam.zoom);

// ---- 5. Mapping outil → TileType ----
const TOOL_TO_TILETYPE: Record<string, TileType> = {
  rough:     TileType.Rough,
  fairway:   TileType.Fairway,
  green:     TileType.PuttingGreen,
  tee:       TileType.Tee,
  deeprough: TileType.DeepRough,
  bunker:    TileType.SandBunker,
  water:     TileType.WaterShallow,
  woods:     TileType.Tree,
  brush:     TileType.Flower,
  flowers:   TileType.Flower,
  rocks:     TileType.Rock,
  path:      TileType.Path,
  bridge:    TileType.Bridge,
  clubhouse: TileType.Building,
  proshop:   TileType.Building,
};

const TILE_TYPE_NAME: Record<number, string> = {
  [TileType.Rough]: 'Rough', [TileType.Fairway]: 'Fairway',
  [TileType.PuttingGreen]: 'Green', [TileType.SandBunker]: 'Bunker',
  [TileType.WaterShallow]: 'Water', [TileType.WaterMiddle]: 'Water M',
  [TileType.WaterDeep]: 'Water D', [TileType.DeepRough]: 'Deep Rough',
  [TileType.GrassySand]: 'Grassy Sand', [TileType.GrassBunker]: 'Grass Bunker',
  [TileType.Tee]: 'Tee', [TileType.Cliff]: 'Cliff',
  [TileType.Path]: 'Path', [TileType.Building]: 'Building',
  [TileType.Tree]: 'Trees', [TileType.Flower]: 'Flowers',
  [TileType.Rock]: 'Rocks', [TileType.Marsh]: 'Marsh',
  [TileType.Overgrowth]: 'Overgrowth', [TileType.Brush]: 'Brush',
  [TileType.FirmFairway]: 'Firm Fairway', [TileType.TrickyGreen]: 'Tricky Green',
  [TileType.PotSandBunker]: 'Pot Bunker',
};

// ---- 6. Appliquer un outil sur une tuile ----

function applyToolToTile(tile: ITile, toolId: string): void {
  const panel = getActivePanel();

  switch (panel) {
    case 'terrain': {
      const tileType = TOOL_TO_TILETYPE[toolId];
      if (tileType !== undefined) {
        terrain.setType(tile, tileType, 0);
      }
      break;
    }
    case 'elevation': {
      switch (toolId) {
        case 'raise':
          // Élever le coin le plus bas
          let minIdx = 0, minVal = tile.elevation[0];
          for (let i = 1; i < 4; i++) {
            if (tile.elevation[i] < minVal) { minVal = tile.elevation[i]; minIdx = i; }
          }
          terrain.elevateCorner(tile, minIdx);
          break;
        case 'lower':
          let maxIdx = 0, maxVal = tile.elevation[0];
          for (let i = 1; i < 4; i++) {
            if (tile.elevation[i] > maxVal) { maxVal = tile.elevation[i]; maxIdx = i; }
          }
          terrain.lowerCorner(tile, maxIdx);
          break;
        case 'flatten':
          const avg = Math.round(tile.elevation.reduce((a, b) => a + b, 0) / 4);
          for (let i = 0; i < 4; i++) tile.elevation[i] = avg;
          break;
        case 'smooth':
          // Lisser : chaque coin = moyenne avec les voisins
          for (let i = 0; i < 4; i++) {
            const neighbor = [tile.neighborN, tile.neighborE, tile.neighborS, tile.neighborW][i];
            if (neighbor) {
              tile.elevation[i] = Math.round((tile.elevation[i] + neighbor.elevation[(i + 2) % 4]) / 2);
            }
          }
          break;
      }
      break;
    }
    case 'amenities': {
      if (toolId === 'path') {
        tile.flags |= 1 << 8; // HasPath
        tile.type = TileType.Path;
        // Activer les flags de chemin vers les voisins qui ont aussi path
        const neighs: Array<{ nei: ITile | null; selfDir: 'N'|'S'|'E'|'W'; neiDir: 'N'|'S'|'E'|'W' }> = [
          { nei: tile.neighborN, selfDir: 'N', neiDir: 'S' },
          { nei: tile.neighborS, selfDir: 'S', neiDir: 'N' },
          { nei: tile.neighborE, selfDir: 'E', neiDir: 'W' },
          { nei: tile.neighborW, selfDir: 'W', neiDir: 'E' },
        ];
        for (const { nei, selfDir, neiDir } of neighs) {
          if (nei && (nei.flags & (1 << 8))) {
            (tile as any)[`path${selfDir}`] = true;
            (nei as any)[`path${neiDir}`] = true;
          }
        }
      }
      break;
    }
    case 'building': {
      if (toolId === 'path' || toolId === 'bridge') {
        terrain.setType(tile, toolId === 'bridge' ? TileType.Bridge : TileType.Path, 0);
        tile.flags |= 1 << 8;
      } else {
        terrain.setType(tile, TileType.Building, 0);
      }
      break;
    }
  }

  // Recalculer les passes de rendu
  terrain.computeAllRenderPasses();
}

// ---- 7. Conversion écran → tuile ----

function screenToTile(sx: number, sy: number): { x: number; y: number } | null {
  const cw = window.innerWidth / 2;
  const ch = (window.innerHeight - TOOLBAR_H) / 2;
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

// ---- 8. Contrôles tactiles ----
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
    panScreen(e.touches[0].clientX - lastTouchX, e.touches[0].clientY - lastTouchY);
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

container.addEventListener('touchend', (e: TouchEvent) => {
  // Si le toucher était court (< 150ms de distance), c'est un clic
  isPanning = false;
  lastTouchDist = 0;
});

// ---- 9. Contrôles souris ----
let mouseDown = false;
let mouseMoved = false;
let mouseX = 0;
let mouseY = 0;

function panScreen(dx: number, dy: number): void {
  const f = 100 / cam.zoom;
  lookTarget.x -= dx * f * 0.01;
  lookTarget.z -= dy * f * 0.01;
  cam.position.x = lookTarget.x;
  cam.position.z = lookTarget.z;
  cam.lookAt(lookTarget.x, 0, lookTarget.z);
  cam.updateProjectionMatrix();
}

container.addEventListener('mousedown', (e: MouseEvent) => {
  mouseDown = true;
  mouseMoved = false;
  mouseX = e.clientX;
  mouseY = e.clientY;
  container.style.cursor = 'grabbing';
});

container.addEventListener('mousemove', (e: MouseEvent) => {
  if (mouseDown) {
    if (Math.abs(e.clientX - mouseX) > 3 || Math.abs(e.clientY - mouseY) > 3) {
      mouseMoved = true;
    }
    panScreen(e.clientX - mouseX, e.clientY - mouseY);
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
});

container.addEventListener('mouseup', (e: MouseEvent) => {
  mouseDown = false;
  container.style.cursor = 'grab';

  // Si la souris n'a pas bougé (ou très peu), c'est un clic → appliquer l'outil
  if (!mouseMoved) {
    const tile = screenToTile(e.clientX, e.clientY);
    if (tile) {
      const idx = tile.y * MAP_W + tile.x;
      const t = mapState.tiles[idx];
      const tool = getActiveTool();
      const panel = getActivePanel();
      
      if (tool && panel !== 'employees') {
        applyToolToTile(t, tool);
        renderer.rebuild();
        showInfo(`${TILE_TYPE_NAME[t.type] ?? tool} → tile [${t.x},${t.y}]`);
      }
    }
  }
});

container.addEventListener('wheel', (e: WheelEvent) => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.12 : 0.88;
  cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * factor));
  cam.updateProjectionMatrix();
}, { passive: false });

container.style.cursor = 'grab';

// ---- 10. Raccourcis clavier ----
let debugMode = false;

function resetView(): void {
  lookTarget.set(cx, 0, cz);
  cam.zoom = 1;
  cam.position.set(cx, camDist, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  resizeCamera(cam, MAP_W, MAP_H, cam.zoom);
}

function topDownView(): void {
  lookTarget.set(cx, 0, cz);
  cam.zoom = 2;
  cam.position.set(cx, camDist, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  resizeCamera(cam, MAP_W, MAP_H, cam.zoom);
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetView(); }
  else if (e.key === 't' || e.key === 'T') { e.preventDefault(); topDownView(); }
  else if (e.key === 'v' || e.key === 'V') {
    e.preventDefault();
    const modes = ['Normal', 'Rotation 90°', 'Rotation 180°', 'Rotation 270°'];
    const next = ((mapState.viewMode ?? 0) + 1) % 4;
    renderer.setViewMode(next);
    showInfo(`View mode: ${modes[next]} (${next})`);
  }
  else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    debugMode = !debugMode;
    console.log(`[SimGolf] Debug ${debugMode ? 'ON' : 'OFF'}`);
  }
});

window.addEventListener('resize', () => resizeCamera(cam, MAP_W, MAP_H, cam.zoom));

// ---- 11. Overlay info ----
const infoEl = document.getElementById('tile-info')!;
let infoTimeout: ReturnType<typeof setTimeout> | null = null;

function showInfo(msg: string): void {
  infoEl.textContent = msg;
  infoEl.style.display = 'block';
  if (infoTimeout) clearTimeout(infoTimeout);
  infoTimeout = setTimeout(() => { infoEl.style.display = 'none'; }, 2000);
}

// Info tuile survolée
container.addEventListener('mousemove', (e: MouseEvent) => {
  if (mouseDown) return;
  const hit = screenToTile(e.clientX, e.clientY);
  if (hit) {
    const idx = hit.y * MAP_W + hit.x;
    const t = mapState.tiles[idx];
    infoEl.style.display = 'block';
    const tool = getActiveTool();
    infoEl.textContent = `[${t.x},${t.y}] ${TILE_TYPE_NAME[t.type] ?? t.type} elev:[${t.elevation.join(',')}] var:${t.variation} tool:${tool}`;
  } else {
    infoEl.style.display = 'none';
  }
});

// ---- 12. Toolbar init ----
initToolbar((tool: string) => {
  console.log(`[Toolbar] Selected: ${tool}`);
  showInfo(`Tool: ${tool}`);
});

document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
  cam.zoom = Math.min(ZOOM_MAX, cam.zoom * 0.88);
  cam.updateProjectionMatrix();
});
document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
  cam.zoom = Math.max(ZOOM_MIN, cam.zoom * 1.12);
  cam.updateProjectionMatrix();
});
document.getElementById('btn-info')?.addEventListener('click', () => {
  showInfo(`Map ${MAP_W}×${MAP_H} tiles:${mapState.tiles.length}`);
});

// ---- 13. Debug overlay ----
const debugCanvas = document.createElement('canvas');
debugCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:calc(100% - 120px);pointer-events:none;z-index:10';
const debugCtx = debugCanvas.getContext('2d')!;
document.body.appendChild(debugCanvas);

function resizeDebug(): void {
  debugCanvas.width = window.innerWidth;
  debugCanvas.height = window.innerHeight - TOOLBAR_H;
}
resizeDebug();
window.addEventListener('resize', resizeDebug);

function drawDebug(): void {
  if (!debugMode) return;
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  debugCtx.font = `${11 * window.devicePixelRatio}px monospace`;
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
    const short = TILE_TYPE_NAME[tile.type]?.[0] ?? '?';
    debugCtx.fillStyle = 'rgba(255,255,0,0.85)';
    debugCtx.fillText(`${short}${geom}${tile.variation}`, ox, oy);
  }
}

// ---- 14. Boucle d'animation ----
function animate(): void {
  renderer.render();
  drawDebug();
  requestAnimationFrame(animate);
}

animate();

// Info DOM
const el = document.createElement('div');
el.style.cssText = 'position:fixed;bottom:124px;right:8px;background:rgba(0,0,0,0.7);color:#0f0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre';
el.textContent = `SimGolf 3D — ${MAP_W}×${MAP_H}  |  R=réinit  T=dessus  V=vue  D=debug`;
document.body.appendChild(el);
