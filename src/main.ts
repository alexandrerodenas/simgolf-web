/**
 * main.ts — Point d'entrée Three.js du moteur spatial SimGolf
 *
 * Initialise la scène, la caméra dimétrique 2:1, et les maillages
 * Parkland texturés. Fournit OrbitControls pour zoom, pan et rotation
 * libre, ainsi que des raccourcis clavier.
 *
 * Raccourcis :
 *   R  →  Reset vue dimétrique 2:1
 *   T  →  Vue de dessus (horizontale)
 *
 * Textures WebP (64×64) chargées depuis assets/textures/parkland/
 * et appliquées aux tuiles via UV mapping.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateParklandGrid, buildParklandMesh, texturePathForTile,
         getGeometryType, computeEdgeMask, edgeMaskToVariation,
         maxVariationForType, MeshGroup } from './world/terrain';
import { createDimetricCamera, resizeDimetricCamera, gridCenter, tileVertexPosition } from './render/camera';

// ---- 1. Constantes ----
const MAP_W = 40;
const MAP_H = 40;
const CX = gridCenter(MAP_W, MAP_H).x;
const CZ = gridCenter(MAP_W, MAP_H).z;

// ---- 2. Scène ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a3a1a);

// ---- 3. Caméra dimétrique 2:1 ----
const { camera } = createDimetricCamera(MAP_W, MAP_H);

// ---- 4. Lumière ----
const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(-50, 80, 50);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x88bbff, 0.3);
fillLight.position.set(30, 20, -40);
scene.add(fillLight);

// ---- 5. Terrain Parkland ----
const mapState = generateParklandGrid(MAP_W, MAP_H);

// Collecter les chemins de texture nécessaires
const neededPaths = new Set<string>();
for (const tile of mapState.tiles) {
  const path = texturePathForTile(tile, mapState.tiles, mapState.width, mapState.height);
  if (path) neededPaths.add(path);
}

// Charger les textures
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

for (const path of neededPaths) {
  textureLoader.load(path, (tex) => {
    textureCache.set(path, tex);
  });
}

// Construire les maillages groupés par texture
const groups = buildParklandMesh(mapState);

for (const group of groups) {
  let material: THREE.Material;

  if (group.texturePath) {
    const tex = textureCache.get(group.texturePath)
      ?? textureLoader.load(group.texturePath);
    textureCache.set(group.texturePath, tex);
    material = new THREE.MeshLambertMaterial({
      map: tex,
      flatShading: true,
      side: THREE.DoubleSide,
    });
  } else {
    material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
    });
  }

  const mesh = new THREE.Mesh(group.geometry, material);
  mesh.frustumCulled = true;
  scene.add(mesh);
}

// ---- 6. Renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// ---- 7. OrbitControls (zoom + pan + rotation) ----
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(CX, 0, CZ);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 1.2;
controls.update();

// ---- 8. Redimensionnement ----
window.addEventListener('resize', () => {
  resizeDimetricCamera(camera, MAP_W, MAP_H);
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeDebugCanvas();
});

// ---- 9. Raccourcis clavier ----
function resetView(): void {
  // Restaurer le up par défaut
  camera.up.set(0, 1, 0);
  // Re-créer la position dimétrique
  const { camera: fresh } = createDimetricCamera(MAP_W, MAP_H);
  camera.position.copy(fresh.position);
  camera.quaternion.copy(fresh.quaternion);
  camera.zoom = 1;
  controls.target.set(CX, 0, CZ);
  controls.update();
  camera.updateProjectionMatrix();
}

function topDownView(): void {
  // Vue de dessus : les tuiles apparaissent en losanges
  const baseDim = Math.max(MAP_W * 64, MAP_H * 32) * 1.2;
  const dist = baseDim * 2.2;

  // Orient -Z vers le haut de l'écran → les diagonales de la grille
  // s'alignent sur les axes XZ, produisant des losanges propres
  camera.up.set(0, 0, -1);
  camera.position.set(CX, dist, CZ);
  camera.lookAt(CX, 0, CZ);
  camera.zoom = 1;
  controls.target.set(CX, 0, CZ);
  controls.update();
  camera.updateProjectionMatrix();
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    resetView();
  } else if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    topDownView();
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    debugMode = !debugMode;
    debugCanvas.style.display = debugMode ? 'block' : 'none';
    console.log(`[SimGolf] Debug ${debugMode ? 'ON' : 'OFF'}`);
  }
});

// ---- 10. Debug overlay ---- 
let debugMode = false;
const debugCanvas = document.createElement('canvas');
debugCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:998;display:none';
const debugCtx = debugCanvas.getContext('2d')!;
document.body.appendChild(debugCanvas);
resizeDebugCanvas();

function resizeDebugCanvas(): void {
  debugCanvas.width = renderer.domElement.width;
  debugCanvas.height = renderer.domElement.height;
}

function drawDebugLabels(): void {
  if (!debugMode) return;
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  const vec = new THREE.Vector3();
  const w = debugCanvas.width;
  const h = debugCanvas.height;
  debugCtx.font = '10px monospace';
  debugCtx.textAlign = 'center';
  debugCtx.textBaseline = 'middle';
  for (const tile of mapState.tiles) {
    const avgH = (tile.elevation[0] + tile.elevation[1] + tile.elevation[2] + tile.elevation[3]) / 4;
    const cp = tileVertexPosition(tile.x + 0.5, tile.y + 0.5, avgH);
    vec.set(cp.x, cp.y, cp.z);
    vec.project(camera);
    const sx = (vec.x * 0.5 + 0.5) * w;
    const sy = (-vec.y * 0.5 + 0.5) * h;
    if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
    const geom = getGeometryType(tile.elevation);
    const mask = computeEdgeMask(mapState.tiles, MAP_W, MAP_H, tile.x, tile.y);
    const maxVar = maxVariationForType(tile.type);
    const edgeVar = edgeMaskToVariation(mask, maxVar);
    debugCtx.fillStyle = 'rgba(255,255,0,0.85)';
    debugCtx.fillText(`${geom}${edgeVar}`, sx, sy);
  }
}

// ---- 11. Boucle d'animation ----
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  drawDebugLabels();
}
animate();

// ---- 11. Info console ----
console.log(`[SimGolf] Terrain Parkland ${MAP_W}×${MAP_H} — Three.js texturé`);
console.log('[SimGolf] Raccourcis: R=réinitialiser vue | T=vue de dessus');

// ---- 12. Info DOM ----
const el = document.createElement('div');
el.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre';
el.textContent = `SimGolf — Parkland ${MAP_W}×${MAP_H}\nR=dimétrique  T=dessus  D=debug  Souris=zoom/pan/orbite`;
document.body.appendChild(el);
