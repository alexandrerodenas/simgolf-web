/**
 * main.ts — Moteur de rendu WebGL/Three.js SimGolf
 *
 * Pipeline GPU complet avec Sub-Tiling :
 *   generateVegetationGrid() → buildParklandMesh() → TileRenderer.create()
 *   → OrbitControls (pan + zoom, dimétrique fixe)
 *
 * Contrôles :
 *   Pan  : cliquer-glisser (souris) / 1 doigt (tactile)
 *   Zoom : molette (souris) / pincement (tactile)
 *   R    : réinitialiser la vue dimétrique
 */

import { generateVegetationGrid } from './world/terrain';
import { TileRenderer } from './render/TileRenderer';

// ---- 1. Constantes ----
const MAP_W = 40;
const MAP_H = 40;

// ---- 2. Génération du terrain ----
const mapState = generateVegetationGrid(MAP_W, MAP_H);
console.log(`[SimGolf] Carte générée : ${MAP_W}×${MAP_H}, ${mapState.tiles.length} tuiles`);

// ---- 3. Stats des passes de rendu ----
let totalPasses = 0;
let maxPasses = 0;
for (const tile of mapState.tiles) {
  totalPasses += tile.renderPasses.length;
  if (tile.renderPasses.length > maxPasses) maxPasses = tile.renderPasses.length;
}
console.log(`[SimGolf] Stats passes : total=${totalPasses}, max/tile=${maxPasses}, moyenne=${(totalPasses / mapState.tiles.length).toFixed(2)}`);

// ---- 4. Initialisation du rendu WebGL ----
const renderer = TileRenderer.create(document.body, mapState);

// ---- 5. Boucle d'animation ----
function animate(): void {
  renderer.render();
  requestAnimationFrame(animate);
}
animate();

// ---- 6. Raccourcis clavier ----
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    renderer.resetView();
    console.log('[SimGolf] Vue réinitialisée');
  }
});

// ---- 7. Info DOM ----
const el = document.createElement('div');
el.style.cssText = `
  position:fixed;bottom:8px;left:8px;
  background:rgba(0,0,0,0.7);color:#0f0;
  padding:4px 10px;font:12px monospace;
  border-radius:4px;pointer-events:none;
  z-index:999;white-space:pre
`;
el.textContent = `SimGolf — WebGL ${MAP_W}×${MAP_H}\nPan: cliquer-glisser  |  Zoom: molette  |  R=réinit`;
document.body.appendChild(el);
