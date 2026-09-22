import type { BattleMap } from './types';
import { mountainBlock } from './types';

export const mountainPass: BattleMap = {
  id: 'mountain-pass',
  name: 'Bergpass',
  // Two unrelated mountain ranges at different depths and on opposite flanks - no symmetry at
  // all, so the two flanks play out completely differently.
  cells: [...mountainBlock(5, 8, 0, 2), ...mountainBlock(11, 15, 12, 15)],
};
