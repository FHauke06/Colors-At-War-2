import type { BattleTerrain } from '../../engine/types';

// Must match GRID_SIZE in engine/combat.ts - kept as a separate literal here (rather than
// imported) so this data folder doesn't create a circular dependency with combat.ts, which
// imports from here (via ./index).
export const GRID_SIZE = 16;

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

/** Shared building blocks for defining a map's `cells` - see any file in this folder for
 *  examples. Add a new map by creating a new file here (same pattern) and registering it in
 *  ./index.ts's BATTLE_MAPS array. */
export function riverRow(row: number, fords: readonly number[]): BattleMapCell[] {
  const cells: BattleMapCell[] = [];
  for (let col = 0; col < GRID_SIZE; col++) {
    if (!fords.includes(col)) cells.push({ row, col, terrain: 'river' });
  }
  return cells;
}

export function riverCol(col: number, rowStart: number, rowEnd: number, fords: readonly number[]): BattleMapCell[] {
  const cells: BattleMapCell[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    if (!fords.includes(row)) cells.push({ row, col, terrain: 'river' });
  }
  return cells;
}

export function mountainBlock(rowStart: number, rowEnd: number, colStart: number, colEnd: number): BattleMapCell[] {
  const cells: BattleMapCell[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) cells.push({ row, col, terrain: 'mountain' });
  }
  return cells;
}
