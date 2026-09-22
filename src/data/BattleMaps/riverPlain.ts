import type { BattleMap } from './types';
import { riverRow } from './types';

export const riverPlain: BattleMap = {
  id: 'river-plain',
  name: 'Flussebene',
  // A single river crossing partway into the defender's territory - the attacker's shallow
  // staging strip stays clear, but the far bank is properly defensible.
  cells: [...riverRow(8, [3, 9, 13])],
};
