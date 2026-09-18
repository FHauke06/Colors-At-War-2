import type { GameState, Territory, TerritoryState, UnitComposition } from './types';

const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0 };

export function totalUnits(garrison: UnitComposition): number {
  return garrison.infantry + garrison.lightTank + garrison.heavyTank;
}

export function addGarrisons(a: UnitComposition, b: UnitComposition): UnitComposition {
  return {
    infantry: a.infantry + b.infantry,
    lightTank: a.lightTank + b.lightTank,
    heavyTank: a.heavyTank + b.heavyTank,
  };
}

export function subtractGarrisons(a: UnitComposition, b: UnitComposition): UnitComposition {
  return {
    infantry: a.infantry - b.infantry,
    lightTank: a.lightTank - b.lightTank,
    heavyTank: a.heavyTank - b.heavyTank,
  };
}

function fitsWithin(amount: UnitComposition, available: UnitComposition): boolean {
  return (
    amount.infantry >= 0 &&
    amount.lightTank >= 0 &&
    amount.heavyTank >= 0 &&
    amount.infantry <= available.infantry &&
    amount.lightTank <= available.lightTank &&
    amount.heavyTank <= available.heavyTank
  );
}

/** Of a territory's current garrison, how many units haven't moved yet this round - and are
 *  therefore free to be sent somewhere (a unit may only move once per round). */
export function availableToMove(state: TerritoryState): UnitComposition {
  return subtractGarrisons(state.garrison, state.movedIn);
}

export type MoveOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/**
 * Moves `amount` units from a territory onto an adjacent one - at most what's currently
 * available there (garrison minus whatever already moved this round). Anything left behind
 * stays put, still owned by the mover, free to move again once the round resets. Only the
 * active player may move.
 *
 * - Neutral or own destination: relocates/reinforces, no resistance.
 * - Enemy destination with an empty garrison: uncontested capture.
 * - Enemy destination with a defended garrison: rejected - tactical combat isn't implemented
 *   yet (a later roadmap step), so this is surfaced as a blocked move rather than guessed at.
 */
export function moveUnits(
  gameState: GameState,
  playerId: string,
  fromId: string,
  toId: string,
  territories: readonly Territory[],
  amount: UnitComposition,
): MoveOutcome {
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const fromTerritory = territories.find((t) => t.id === fromId);
  if (!fromTerritory) return { ok: false, reason: `Unbekanntes Gebiet "${fromId}".` };
  if (!fromTerritory.neighbors.includes(toId)) return { ok: false, reason: 'Gebiete sind nicht benachbart.' };

  const fromState = gameState.territoryState.get(fromId);
  if (!fromState || fromState.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  if (totalUnits(amount) === 0) return { ok: false, reason: 'Keine Einheiten ausgewählt.' };
  if (!fitsWithin(amount, availableToMove(fromState))) {
    return { ok: false, reason: 'Nicht genug verfügbare Einheiten - manche haben sich diese Runde schon bewegt.' };
  }

  const toState = gameState.territoryState.get(toId);
  if (!toState) return { ok: false, reason: `Unbekanntes Gebiet "${toId}".` };

  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(fromId, { ...fromState, garrison: subtractGarrisons(fromState.garrison, amount) });

  if (toState.ownerId === null || toState.ownerId === playerId) {
    const baseGarrison = toState.ownerId === playerId ? toState.garrison : EMPTY_GARRISON;
    const baseMovedIn = toState.ownerId === playerId ? toState.movedIn : EMPTY_GARRISON;
    nextTerritoryState.set(toId, {
      ownerId: playerId,
      garrison: addGarrisons(baseGarrison, amount),
      movedIn: addGarrisons(baseMovedIn, amount),
    });
    return { ok: true, gameState: { ...gameState, territoryState: nextTerritoryState } };
  }

  if (totalUnits(toState.garrison) === 0) {
    nextTerritoryState.set(toId, { ownerId: playerId, garrison: amount, movedIn: amount });
    return { ok: true, gameState: { ...gameState, territoryState: nextTerritoryState } };
  }

  return { ok: false, reason: 'Das Gebiet ist verteidigt - das Kampfsystem folgt in einem späteren Schritt.' };
}
