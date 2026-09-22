import type { BattleMap } from './types';
import { riverRow } from './types';

export const twinRivers: BattleMap = {
  id: 'twin-rivers',
  name: 'Zwillingsflüsse',
  // A shallow first line close to the attacker, then a much tougher second line deep in the
  // defender's territory, with different ford spacing - forces two distinct crossings.
  cells: [...riverRow(5, [1, 7, 11, 14]), ...riverRow(13, [4, 9])],
};
