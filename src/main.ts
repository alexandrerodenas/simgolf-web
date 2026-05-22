/**
 * main.ts — Point d'entrée Three.js du moteur spatial SimGolf
 *
 * Initialise la scène, la caméra dimétrique 2:1, et les maillages
 * Parkland texturés. Boucle d'animation avec rendu et redimensionnement.
 *
 * Les textures WebP (64×64) sont chargées depuis assets/textures/parkland/
 * et appliquées aux tuiles via UV mapping.
 */

import * as THREE from 'three';
import { generateParklandGrid, buildParklandMesh, texturePathForTile } from './world/terrain';
import { createDimetricCamera, resizeDimetricCamera } from './render/camera';
import { TileType } from './core/types';

// ---- 1. Scène ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a3a1a);

// ---- 2. Caméra dimétrique 2:1 ----
const MAP_W = 40;
const MAP_H = 40;

const { camera } = createDimetricCamera(MAP_W, MAP_H, 1);

// ---- 3. Lumière ----
const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(-50, 80, 50);
dirLight.castShadow = false;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x88bbff, 0.3);
fillLight.position.set(30, 20, -40);
scene.add(fillLight);

// ---- 4. Terrain Parkland ----
const mapState = generateParklandGrid(MAP_W, MAP_H);

// Collecter tous les chemins de texture nécessaires
const neededPaths = new Set<string>();
for (const tile of mapState.tiles) {
  const path = texturePathForTile(tile);
  if (path) neededPaths.add(path);
}
console.log(`[SimGolf] ${neededPaths.size} textures à charger`);

// Charger les textures
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();
let texturesLoaded = 0;

for (const path of neededPaths) {
  textureLoader.load(path, (tex) => {
    textureCache.set(path, tex);
    texturesLoaded++;
    if (texturesLoaded === neededPaths.size) {
      console.log(`[SimGolf] Toutes les textures chargées (${texturesLoaded})`);
    }
  });
}

// Construire les maillages groupés par texture
const groups = buildParklandMesh(mapState);

for (const group of groups) {
  let material: THREE.Material;

  if (group.texturePath && textureCache.has(group.texturePath)) {
    // Texture déjà chargée — utiliser
    material = new THREE.MeshLambertMaterial({
      map: textureCache.get(group.texturePath),
      flatShading: true,
      side: THREE.DoubleSide,
    });
  } else if (group.texturePath) {
    // Texture pas encore chargée — utiliser la texture avec fallback,
    // Three.js passera à l'image une fois chargée
    const tex = textureLoader.load(group.texturePath);
    textureCache.set(group.texturePath, tex);
    material = new THREE.MeshLambertMaterial({
      map: tex,
      flatShading: true,
      side: THREE.DoubleSide,
    });
  } else {
    // Pas de texture — vertex colors
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

// ---- 5. Renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

// ---- 6. Redimensionnement ----
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  resizeDimetricCamera(camera, MAP_W, MAP_H, 1);
  renderer.setSize(w, h);
});

// ---- 7. Boucle d'animation ----
function animate(): void {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

// ---- 8. Info console ----
console.log(`[SimGolf] Terrain Parkland ${MAP_W}×${MAP_H} — Three.js texturé`);

// ---- 9. Info DOM ----
const el = document.createElement('div');
el.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre';
el.textContent = `SimGolf — Parkland ${MAP_W}×${MAP_H}\nThree.js — Textures WebP — Projection 2:1`;
document.body.appendChild(el);
