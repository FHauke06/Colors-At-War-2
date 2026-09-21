import type { BattleTerrain } from './types';

// Must match GRID_SIZE in combat.ts - kept as a separate literal here (rather than imported) so
// this data file doesn't create a circular dependency with combat.ts, which imports from here.
const GRID_SIZE = 16;

/** One obstacle cell, anywhere on the battlefield. Maps are NOT mirrored or otherwise required to
 *  be symmetric - the attacker's zone is a shallow 3-row strip at the top (rows 1-3) and the
 *  defender's is everything else down to row 16, so a map is free to shape the defender's much
 *  larger territory however it likes. Never place anything on row 0 or row 17 (the escape rows) -
 *  they must always stay open. */
export interface BattleMapCell {
  readonly row: number;
  readonly col: number;
  readonly terrain: Exclude<BattleTerrain, 'normal'>;
}

export interface BattleMap {
  readonly id: string;
  readonly name: string;
  readonly cells: readonly BattleMapCell[];
}

function riverRow(row: number, fords: readonly number[]): BattleMapCell[] {
  const cells: BattleMapCell[] = [];
  for (let col = 0; col < GRID_SIZE; col++) {
    if (!fords.includes(col)) cells.push({ row, col, terrain: 'river' });
  }
  return cells;
}

function riverCol(col: number, rowStart: number, rowEnd: number, fords: readonly number[]): BattleMapCell[] {
  const cells: BattleMapCell[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    if (!fords.includes(row)) cells.push({ row, col, terrain: 'river' });
  }
  return cells;
}

function mountainBlock(rowStart: number, rowEnd: number, colStart: number, colEnd: number): BattleMapCell[] {
  const cells: BattleMapCell[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) cells.push({ row, col, terrain: 'mountain' });
  }
  return cells;
}

export const BATTLE_MAPS: readonly BattleMap[] = [
  {
    id: 'open-field',
    name: 'Offenes Feld',
    cells: [],
  },
  {
    id: 'river-plain',
    name: 'Flussebene',
    // A single river crossing partway into the defender's territory - the attacker's shallow
    // staging strip stays clear, but the far bank is properly defensible.
    cells: [...riverRow(8, [3, 9, 13])],
  },
  {
    id: 'mountain-pass',
    name: 'Bergpass',
    // Two unrelated mountain ranges at different depths and on opposite flanks - no symmetry at
    // all, so the two flanks play out completely differently.
    cells: [...mountainBlock(5, 8, 0, 2), ...mountainBlock(11, 15, 12, 15)],
  },
  {
    id: 'river-valley',
    name: 'Flusstal',
    cells: [...riverRow(6, [2, 8, 12]), ...mountainBlock(10, 13, 4, 7)],
  },
  {
    id: 'twin-rivers',
    name: 'Zwillingsflüsse',
    // A shallow first line close to the attacker, then a much tougher second line deep in the
    // defender's territory, with different ford spacing - forces two distinct crossings.
    cells: [...riverRow(5, [1, 7, 11, 14]), ...riverRow(13, [4, 9])],
  },
  {
    id: 'highland-flank',
    name: 'Hochlandflanke',
    // Asymmetric on purpose: a mountain highland dominates the right side deep in the defender's
    // zone, a river guards the left approach closer to the front - the two routes in feel nothing
    // alike, on a map that couldn't exist under the old mirrored format.
    cells: [
      ...mountainBlock(7, 14, 10, 15),
      ...riverCol(3, 4, 12, [7, 8]),
      ...mountainBlock(15, 16, 0, 3),
    ],
  },
  {
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
  },
];

export function pickRandomBattleMap(): BattleMap {
  return BATTLE_MAPS[Math.floor(Math.random() * BATTLE_MAPS.length)]!;
}
