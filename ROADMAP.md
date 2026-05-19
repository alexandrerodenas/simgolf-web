# SimGolf Web — Roadmap & Tickets

> Portage web du jeu SimGolf (Firaxis, 2002)
> Stack : Vite + TypeScript + Phaser
> V1 : Éditeur de parcours + gestion club + golfeurs IA

---

## Légende

```
[⏳] À faire    [🏗️] En cours    [✅] Fini    [❌] Annulé
```

**Priorités :** P0 = Bloquant, P1 = Important, P2 = Souhaitable, P3 = Bonus

---

## Phase 0 — Fondations (scaffolding)

> Objectif : projet Vite + Phaser qui compile, boot scene → game scene

### P0-0 : Projet Vite + TypeScript + Phaser ✅
- [x] `npm init`, `npm install phaser`, `npm install -D typescript vite`
- [x] tsconfig strict, pas de framework supplémentaire
- [x] Vite dev server, build static
- [x] `vite.config.ts`, `.gitignore`

### P0-1 : Scènes Phaser ✅
- [x] BootScene : splash → transition GameScene
- [x] GameScene : fond + debug text + FPS counter
- [x] Game loop intégré (Phaser s'en charge)

### P0-2 : Structure de dossiers ⏳
- [x] `src/config.ts` — constantes du jeu
- [x] `src/scenes/` — BootScene, GameScene
- [ ] `src/core/` — moteurs de jeu
- [ ] `src/render/` — rendu isométrique
- [ ] `src/ui/` — HUD, overlays
- [ ] `src/data/` — données extraites (golfeurs, textures)

### P0-3 : Assets pipeline ⏳
- [ ] `public/textures/` — textures originales (terrain)
- [ ] `public/sprites/` — sprites de décor (arbres, bâtiments)
- [ ] Copier les données depuis `simgolf-re/game_data/`

### P0-4 : Déploiement Vercel ⏳
- [ ] `vercel.json` : static
- [ ] Build script dans `package.json`
- [ ] Déploiement Vercel initial

---

## Phase 1 — Structures de données & Terrain Engine

> Objectif : carte 64×64 fonctionnelle, modifiable en mémoire

[...]

---

## Phase 2 — Rendu isométrique

> Objectif : afficher la carte en isométrique avec culling, zoom

[...]

---

## Phase 3 — Interaction tactile

> Objectif : éditer le terrain au doigt (mobile paysage)

[...]

---

## Phase 4 — Simulation & Systèmes de jeu

> Objectif : golfeurs autonomes qui jouent, économie qui tourne

[...]

---

## Phase 5 — Interface utilisateur

> Objectif : menus, HUD, toolbar, écrans de rapport

[...]

---

## Phase 6 — Sauvegarde & Données

> Objectif : persistance, import/export, robustesse

[...]

---

## Résumé des dépendances

```
P0 ─── P1 ─── P2 ─── P3 ─── P4 ─── P5 ─── P6 ─── P7
                      │       │
                      └── P3 dépend de P2
                      └── P4 dépend de P1 (terrain) et P2 (rendu)
                      └── P5 dépend de P4 (game state)
                      └── P6 dépend de P4
```
