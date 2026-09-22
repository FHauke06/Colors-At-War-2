import type { GameState, Territory, TerritoryDevelopment, TerritoryState, UnitComposition } from './types';

const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

/** A territory's garrison is visible to `viewerId` if they own it, or own any neighboring
 *  territory - matching how far a real front line's reconnaissance would reach. Ownership itself
 *  (the map's coloring) is always public; only troop counts are gated. */
function garrisonVisible(
  gameState: GameState,
  viewerId: string,
  territoryId: string,
  neighborsById: ReadonlyMap<string, readonly string[]>,
): boolean {
  const state = gameState.territoryState.get(territoryId);
  if (state?.ownerId === viewerId) return true;
  const neighbors = neighborsById.get(territoryId) ?? [];
  return neighbors.some((id) => gameState.territoryState.get(id)?.ownerId === viewerId);
}

/**
 * Builds the game state as `viewerId` is allowed to see it: garrisons on territories they can't
 * see (not owned by them, not adjacent to anything they own) are blanked out - which also
 * suppresses the unit-count label on the map, since a zero garrison already draws nothing (see
 * render/MapRenderer.ts). Factories/infrastructure are stricter still: visible only on
 * territories the viewer owns outright, no neighbor exception. Ownership, resources (each
 * player's point balance) and pendingBattle are unaffected - see engine/combat.ts's own doc
 * comments for why battle visibility already has its own rules.
 */
export function filterGameStateForViewer(
  gameState: GameState,
  viewerId: string,
  territories: readonly Territory[],
): GameState {
  const neighborsById = new Map(territories.map((t) => [t.id, t.neighbors]));

  const territoryState = new Map<string, TerritoryState>();
  for (const [id, state] of gameState.territoryState) {
    if (garrisonVisible(gameState, viewerId, id, neighborsById)) {
      territoryState.set(id, state);
    } else {
      territoryState.set(id, { ...state, garrison: EMPTY_GARRISON, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON });
    }
  }

  const development = new Map<string, TerritoryDevelopment>();
  for (const [id, dev] of gameState.development) {
    if (gameState.territoryState.get(id)?.ownerId === viewerId) development.set(id, dev);
  }

  return { ...gameState, territoryState, development };
}
