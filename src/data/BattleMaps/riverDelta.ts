import type { BattleMap } from './types';
import { riverRow, riverCol } from './types';

export const riverDelta: BattleMap = {
  id: 'river-delta',
  name: 'Flussdelta',
  // Three separate river branches converging toward one crossing point - a genuinely irregular
  // shape, not a symmetric pattern reflected onto itself.
  cells: [
    ...riverRow(6, [6, 7, 8]),
    ...riverCol(6, 6, 10, [10]),
    ...riverCol(9, 6, 10, [10]),
    ...riverRow(10, [6, 7, 8, 9]),
  ],
};
