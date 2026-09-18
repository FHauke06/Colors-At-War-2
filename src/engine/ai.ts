import type { GameState, Territory } from './types';
import { moveUnits, totalUnits, availableToMove } from './movement';

/**
 * Placeholder AI policy until real decision-making exists: for each of the AI's territories, if
 * it has units that haven't moved yet this round and borders a capturable neighbor (unowned, or
 * enemy with an empty garrison - the only kind of territory anyone can take without combat,
 * which isn't implemented yet), send everything available there. Territories with no such
 * neighbor just sit still.
 */
export function playAiTurn(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const ownedIds = [...state.territoryState.entries()]
    .filter(([, s]) => s.ownerId === aiPlayerId)
    .map(([id]) => id);

  for (const fromId of ownedIds) {
    const fromState = state.territoryState.get(fromId);
    const fromTerritory = territories.find((t) => t.id === fromId);
    if (!fromState || !fromTerritory) continue;

    const available = availableToMove(fromState);
    if (totalUnits(available) === 0) continue;

    const targetId = fromTerritory.neighbors.find((neighborId) => {
      const neighborState = state.territoryState.get(neighborId);
      if (!neighborState || neighborState.ownerId === aiPlayerId) return false;
      return neighborState.ownerId === null || totalUnits(neighborState.garrison) === 0;
    });
    if (!targetId) continue;

    const outcome = moveUnits(state, aiPlayerId, fromId, targetId, territories, available);
    if (outcome.ok) state = outcome.gameState;
  }

  return state;
}
