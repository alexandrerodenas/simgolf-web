/**
 * Golfeurs et célébrités — données stub (à remplacer par les vrais parsés)
 */

import type { ProGolfer } from '../core/types';

/** 4 golfeurs de test (sera remplacé par les 96 pros + 50 célébrités) */
export const sampleGolfers: ProGolfer[] = [
  {
    name: 'Tiger Woods',
    bodyType: 0, skinColor: 2, hat: 1, shirtColor: 3, pantsColor: 1,
    skills: { powerHitter: 14, longDriver: 15, accurateDriver: 12, accurateIrons: 13, accuratePutter: 14, drawShot: 10, fadeShot: 9, highBackspin: 12, recovery: 11, unknown: 0 },
  },
  {
    name: 'Jack Nicklaus',
    bodyType: 1, skinColor: 1, hat: 0, shirtColor: 5, pantsColor: 2,
    skills: { powerHitter: 13, longDriver: 14, accurateDriver: 14, accurateIrons: 15, accuratePutter: 13, drawShot: 12, fadeShot: 11, highBackspin: 10, recovery: 12, unknown: 0 },
  },
  {
    name: 'Annika Sörenstam',
    bodyType: 0, skinColor: 1, hat: 2, shirtColor: 4, pantsColor: 0,
    skills: { powerHitter: 10, longDriver: 11, accurateDriver: 15, accurateIrons: 14, accuratePutter: 15, drawShot: 8, fadeShot: 9, highBackspin: 13, recovery: 11, unknown: 0 },
  },
  {
    name: 'Seve Ballesteros',
    bodyType: 0, skinColor: 2, hat: 0, shirtColor: 7, pantsColor: 3,
    skills: { powerHitter: 12, longDriver: 13, accurateDriver: 9, accurateIrons: 11, accuratePutter: 12, drawShot: 14, fadeShot: 13, highBackspin: 14, recovery: 15, unknown: 0 },
  },
];

/** 2 célébrités de test */
export const sampleCelebrities: ProGolfer[] = [
  {
    name: 'Michael Jordan',
    bodyType: 2, skinColor: 3, hat: 2, shirtColor: 2, pantsColor: 1,
    skills: { powerHitter: 15, longDriver: 13, accurateDriver: 8, accurateIrons: 7, accuratePutter: 9, drawShot: 6, fadeShot: 5, highBackspin: 10, recovery: 8, unknown: 0 },
  },
  {
    name: 'Bill Murray',
    bodyType: 1, skinColor: 1, hat: 3, shirtColor: 5, pantsColor: 4,
    skills: { powerHitter: 6, longDriver: 7, accurateDriver: 5, accurateIrons: 6, accuratePutter: 8, drawShot: 3, fadeShot: 4, highBackspin: 2, recovery: 5, unknown: 0 },
  },
];
