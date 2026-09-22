import type { BattleMap } from './types';
import { riverRow, mountainBlock } from './types';

export const riverValley: BattleMap = {
  id: 'river-valley',
  name: 'Flusstal',
  cells: [...riverRow(6, [2, 8, 12]), ...mountainBlock(10, 13, 4, 7)],
};
