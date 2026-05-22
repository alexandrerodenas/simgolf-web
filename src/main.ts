/**
 * main.ts — Point d'entrée Three.js du moteur spatial SimGolf
 *
 * Initialise la scène, la caméra dimétrique 2:1, et le maillage
 * Parkland. Boucle d'animation avec rendu et redimensionnement.
 */

import * as THREE from 'three';
import { generateParklandGrid, buildParklandMesh } from './world/terrain';
import { createDimetricCamera, resizeCamera } from './render/camera';

// ---- 1. Scène ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a3a1a);

// ---- 2. Caméra dimétrique 2:1 ----
const MAP_W = 40;
const MAP_H = 40;

const { camera } = createDimetricCamera(MAP_W, MAP_H, 1);

// ---- 3. Lumière ----
// Soleil Nord-Ouest (direction du jeu original : -0.409, -0.613, 0.707)
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
const { mesh } = buildParklandMesh(mapState);
scene.add(mesh);

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
  resizeCamera(camera, MAP_W, MAP_H, 1);
  renderer.setSize(w, h);
});

// ---- 7. Boucle d'animation ----
function animate(): void {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

// ---- 8. Info console ----
console.log(`[SimGolf] Terrain Parkland ${MAP_W}×${MAP_H} — Three.js`);

// ---- 9. Info DOM ----
const el = document.createElement('div');
el.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,0.7);color:#0f0;padding:4px 10px;font:12px monospace;border-radius:4px;pointer-events:none;z-index:999;white-space:pre';
el.textContent = `SimGolf — Parkland ${MAP_W}×${MAP_H}\nThree.js — Projection 2:1 dimétrique`;
document.body.appendChild(el);
