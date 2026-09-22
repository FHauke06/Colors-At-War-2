import type { BattleMap } from './types';
import { openField } from './openField';
import { riverPlain } from './riverPlain';
import { mountainPass } from './mountainPass';
import { riverValley } from './riverValley';
import { twinRivers } from './twinRivers';
import { highlandFlank } from './highlandFlank';
import { riverDelta } from './riverDelta';

export type { BattleMap, BattleMapCell } from './types';

/** Every tactical battle map. To add a new one: create a file in this folder (see any of the
 *  existing ones - types.ts's riverRow/riverCol/mountainBlock helpers cover most shapes) and add
 *  it here. */
export const BATTLE_MAPS: readonly BattleMap[] = [
  openField,
  riverPlain,
  mountainPass,
  riverValley,
  twinRivers,
  highlandFlank,
  riverDelta,
];

export function pickRandomBattleMap(): BattleMap {
  return BATTLE_MAPS[Math.floor(Math.random() * BATTLE_MAPS.length)]!;
}
