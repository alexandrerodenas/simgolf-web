SimGolf Web — Woods Auto-Tiling Transition LUT

Mapping des configurations de voisinage (bitmask 8-way) aux assets
de transition Woods pré-rendus par Firaxis (0005-0009).

## Principes

Le bitmask 8-way (N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128)
est calculé par calculateBitmask(x, y, TileType.TREE) et renvoie un
index 0-255.

Le mapping LUT associe ces index aux 9 variantes de texture disponibles
par groupe géométrique (A-D) :

| Asset     | Type     | Description                                          |
|-----------|----------|------------------------------------------------------|
| 0001-0004 | Center   | Pleine forêt, aucune transition                      |
| 0005      | Edge N   | Transition bord Nord (herbe en haut)                 |
| 0006      | Edge E   | Transition bord Est                                  |
| 0007      | Edge S   | Transition bord Sud                                  |
| 0008      | Edge W   | Transition bord Ouest                                |
| 0009      | Corner   | Coin extérieur / multiple transitions / isolé        |

## Logique de mapping

getWoodsTransitionVariant(bitmask: number): number

1. Isoler les 4 bits cardinaux : n=N, e=E, s=S, w=W
2. Si les 4 sont à 1 (intérieur massif) → 0001-0004 (au hasard)
3. Si 3 bits à 1, 1 bit à 0 → transition bord simple
   - N=0 → 0005 (nord)
   - E=0 → 0006 (est)
   - S=0 → 0007 (sud)
   - W=0 → 0008 (ouest)
4. Si ≤ 2 bits à 1 (coin, bord double, isolé) → 0009 (corner)

## À faire

- Valider visuellement que les assets 0005-0009 correspondent bien
  aux transitions attendues (besoin d'inspection visuelle)
- Étendre le mapping aux groupes B/C/D pour la variation décorative
