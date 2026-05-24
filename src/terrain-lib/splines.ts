/**
 * splines.ts — Générateurs de splines
 *
 * Port des fonctions drawBezierSpline et drawCardinalSpline
 * de Terrain.dll.
 *
 * Les splines sont utilisées dans le jeu original pour :
 *   - Lisser les bords de terrain entre zones d'élévation différente
 *   - Tracer les chemins avec des courbes douces
 *   - Définir les contours des greens et des bunkers
 */

/**
 * Génère une spline de Bézier cubique.
 * 4 points de contrôle → courbe lisse.
 */
export function bezierSpline(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  x4: number, y4: number,
  steps: number = 32,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const u2 = u * u;
    const u3 = u2 * u;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = u3 * x1 + 3 * u2 * t * x2 + 3 * u * t2 * x3 + t3 * x4;
    const y = u3 * y1 + 3 * u2 * t * y2 + 3 * u * t2 * y3 + t3 * y4;
    points.push([x, y]);
  }
  return points;
}

/**
 * Génère une spline cardinale (interpolation Hermite avec tension).
 * 4 points de contrôle, la courbe passe par P2 et P3.
 *
 * @param tension  0 = chatmul, 0.5 = catmull-rom centré, 1 = serré
 */
export function cardinalSpline(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  x4: number, y4: number,
  tension: number = 0.5,
  steps: number = 32,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const s = (1 - tension) / 2;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;

    // Polynômes de base Hermite
    const h1 =  2 * t3 - 3 * t2 + 1;      // P2
    const h2 = -2 * t3 + 3 * t2;           // P3
    const h3 =      t3 - 2 * t2 + t;       // tangente en P2
    const h4 =      t3 - t2;               // tangente en P3

    const x = h1 * x2 + h2 * x3 + s * (h3 * (x3 - x1) + h4 * (x4 - x2));
    const y = h1 * y2 + h2 * y3 + s * (h3 * (y3 - y1) + h4 * (y4 - y2));
    points.push([x, y]);
  }
  return points;
}

/**
 * Génère les points d'un cercle dans la projection isométrique.
 */
export function isometricCircle(
  cx: number, cy: number,
  radiusX: number, radiusY?: number,
  segments: number = 24,
): Array<[number, number]> {
  const ry = radiusY ?? radiusX / 2;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push([
      cx + Math.cos(angle) * radiusX,
      cy + Math.sin(angle) * ry,
    ]);
  }
  return points;
}
