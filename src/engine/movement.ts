import type { GameState, Territory, UnitComposition } from './types';
import { areAtWar } from './diplomacy';
import { addToPlayerStats } from './stats';

/** Structural subset shared by TerritoryState (main map) and BattleSubState (tactical grid) - the
 *  movement/availability rules below apply identically to both, so they take this instead of
 *  either concrete type. */
interface MovableState {
  readonly garrison: UnitComposition;
  readonly movedIn: UnitComposition;
  readonly extraMoveUsed: UnitComposition;
}

const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

export function totalUnits(garrison: UnitComposition): number {
  return garrison.infantry + garrison.lightTank + garrison.heavyTank + garrison.artillery + garrison.motorizedInfantry;
}

export function addGarrisons(a: UnitComposition, b: UnitComposition): UnitComposition {
  return {
    infantry: a.infantry + b.infantry,
    lightTank: a.lightTank + b.lightTank,
    heavyTank: a.heavyTank + b.heavyTank,
    artillery: a.artillery + b.artillery,
    motorizedInfantry: a.motorizedInfantry + b.motorizedInfantry,
  };
}

export function subtractGarrisons(a: UnitComposition, b: UnitComposition): UnitComposition {
  return {
    infantry: a.infantry - b.infantry,
    lightTank: a.lightTank - b.lightTank,
    heavyTank: a.heavyTank - b.heavyTank,
    artillery: a.artillery - b.artillery,
    motorizedInfantry: a.motorizedInfantry - b.motorizedInfantry,
  };
}

function fitsWithin(amount: UnitComposition, available: UnitComposition): boolean {
  return (
    amount.infantry >= 0 &&
    amount.lightTank >= 0 &&
    amount.heavyTank >= 0 &&
    amount.artillery >= 0 &&
    amount.motorizedInfantry >= 0 &&
    amount.infantry <= available.infantry &&
    amount.lightTank <= available.lightTank &&
    amount.heavyTank <= available.heavyTank &&
    amount.artillery <= available.artillery &&
    amount.motorizedInfantry <= available.motorizedInfantry
  );
}

/** Of a territory's current garrison, how many units are free to be sent somewhere this round.
 *  Every type but Motorisierte Infanterie may only move once per round: anything in `movedIn`
 *  (arrived this round, whether by moving, capturing or recruiting) is excluded. Motorisierte
 *  Infanterie ignores `movedIn` entirely and is available up to twice per round instead - it's
 *  only unavailable once it's used up its second move too (`extraMoveUsed`), regardless of whether
 *  it arrived this round or was already sitting there - see splitExtraMoveUnits for how a move
 *  decides whether it's spending a unit's first or second use. */
export function availableToMove(state: MovableState): UnitComposition {
  const base = subtractGarrisons(state.garrison, state.movedIn);
  return { ...base, motorizedInfantry: state.garrison.motorizedInfantry - state.extraMoveUsed.motorizedInfantry };
}

/**
 * Decides how many of a Motorisierte-Infanterie move come from the source's "never moved this
 * round" pool (still sitting there from before, or freshly recruited/captured-in) versus its
 * "already moved once, this is its second and last hop" pool - fresh units are spent first. The
 * split matters only for what the DESTINATION should record: units from the fresh pool arrive
 * still owing a second move (only added to the destination's `movedIn`, same as any other type);
 * units from the used-once pool have now used both, so they're also added to the destination's
 * `extraMoveUsed`, locking them there for the rest of the round.
 */
export function splitExtraMoveUnits(fromState: MovableState, motorizedAmount: number): { readonly fresh: number; readonly usedOnce: number } {
  const freshAvailable = Math.max(0, fromState.garrison.motorizedInfantry - fromState.movedIn.motorizedInfantry);
  const fresh = Math.min(motorizedAmount, freshAvailable);
  return { fresh, usedOnce: motorizedAmount - fresh };
}

export type MoveOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/**
 * Moves `amount` units from a territory onto an adjacent one - at most what's currently
 * available there (garrison minus whatever already moved this round). Anything left behind
 * stays put, still owned by the mover, free to move again once the round resets. Only the
 * active player may move, and never while a battle is pending (see engine/combat.ts).
 *
 * - Neutral or own destination: relocates/reinforces, no resistance.
 * - Enemy destination with an empty garrison: uncontested capture.
 * - Enemy destination with a defended garrison: rejected - attacking a defended territory goes
 *   through engine/combat.ts's startBattle/deployment flow instead, not a plain move.
 */
export function moveUnits(
  gameState: GameState,
  playerId: string,
  fromId: string,
  toId: string,
  territories: readonly Territory[],
  amount: UnitComposition,
): MoveOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
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

  const { usedOnce: motorizedUsedOnce } = splitExtraMoveUnits(fromState, amount.motorizedInfantry);

  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(fromId, { ...fromState, garrison: subtractGarrisons(fromState.garrison, amount) });

  if (toState.ownerId === null || toState.ownerId === playerId) {
    const baseGarrison = toState.ownerId === playerId ? toState.garrison : EMPTY_GARRISON;
    const baseMovedIn = toState.ownerId === playerId ? toState.movedIn : EMPTY_GARRISON;
    const baseExtraMoveUsed = toState.ownerId === playerId ? toState.extraMoveUsed : EMPTY_GARRISON;
    nextTerritoryState.set(toId, {
      ownerId: playerId,
      garrison: addGarrisons(baseGarrison, amount),
      movedIn: addGarrisons(baseMovedIn, amount),
      extraMoveUsed: addGarrisons(baseExtraMoveUsed, { ...EMPTY_GARRISON, motorizedInfantry: motorizedUsedOnce }),
    });
    return { ok: true, gameState: { ...gameState, territoryState: nextTerritoryState } };
  }

  if (totalUnits(toState.garrison) === 0) {
    if (!areAtWar(gameState, playerId, toState.ownerId)) {
      return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor Gebiete erobert werden können.' };
    }
    nextTerritoryState.set(toId, {
      ownerId: playerId,
      garrison: amount,
      movedIn: amount,
      extraMoveUsed: { ...EMPTY_GARRISON, motorizedInfantry: motorizedUsedOnce },
    });
    const conqueredState = addToPlayerStats(
      { ...gameState, territoryState: nextTerritoryState },
      playerId,
      { territoriesConquered: 1 },
    );
    return { ok: true, gameState: conqueredState };
  }

  return { ok: false, reason: 'Das Gebiet ist verteidigt - greife an, statt zu verschieben.' };
}
