import type { BattleMap } from './types';
import { riverCol, mountainBlock } from './types';

export const highlandFlank: BattleMap = {
  id: 'highland-flank',
  name: 'Hochlandflanke',
  // Asymmetric on purpose: a mountain highland dominates the right side deep in the defender's
  // zone, a river guards the left approach closer to the front - the two routes in feel nothing
  // alike, on a map that couldn't exist under the old mirrored format.
  cells: [...mountainBlock(7, 14, 10, 15), ...riverCol(3, 4, 12, [7, 8]), ...mountainBlock(15, 16, 0, 3)],
};
