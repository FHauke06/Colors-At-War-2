import type { GameState, GuestStack, Territory, TerritoryState, UnitComposition } from './types';
import { areAllied, areAtWar } from './diplomacy';
import { addToPlayerStats } from './stats';

/** Structural subset shared by TerritoryState (main map), GuestStack (an ally's units on somebody
 *  else's territory) and BattleSubState (tactical grid) - the movement/availability rules below
 *  apply identically to all of them, so they take this instead of any one concrete type. */
export interface MovableState {
  readonly garrison: UnitComposition;
  readonly movedIn: UnitComposition;
  readonly extraMoveUsed: UnitComposition;
}

const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };
const UNIT_KEYS = ['infantry', 'lightTank', 'heavyTank', 'artillery', 'motorizedInfantry'] as const;

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

function minGarrisons(a: UnitComposition, b: UnitComposition): UnitComposition {
  return {
    infantry: Math.min(a.infantry, b.infantry),
    lightTank: Math.min(a.lightTank, b.lightTank),
    heavyTank: Math.min(a.heavyTank, b.heavyTank),
    artillery: Math.min(a.artillery, b.artillery),
    motorizedInfantry: Math.min(a.motorizedInfantry, b.motorizedInfantry),
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

// ---------------------------------------------------------------------------------------------
// Stationing: a territory holds its owner's garrison plus any allied guests' ("Verbündete dürfen
// auf demselben Gebiet stehen") - see TerritoryState.guests. Everything below is how the rest of the
// engine reads and writes those stacks without caring which kind it's dealing with.
// ---------------------------------------------------------------------------------------------

export function guestsOf(state: TerritoryState): readonly GuestStack[] {
  return state.guests ?? [];
}

/** `playerId`'s own units at a territory: the owner's garrison if they own it, their guest stack if
 *  they're visiting, null if they have nothing there at all. */
export function stackOf(state: TerritoryState, playerId: string): MovableState | null {
  if (state.ownerId === playerId) return state;
  return guestsOf(state).find((g) => g.playerId === playerId) ?? null;
}

/** `state` without any guests (the field is left off entirely when there's none, not set empty). */
function withGuests(state: TerritoryState, guests: readonly GuestStack[]): TerritoryState {
  const { guests: _previous, ...rest } = state;
  return guests.length > 0 ? { ...rest, guests } : rest;
}

/** Writes `stack` back as `playerId`'s units at `state` - onto the territory itself if they own it,
 *  otherwise into (or out of - an emptied stack is dropped) their guest entry, keeping the order the
 *  guests arrived in. */
export function withStack(state: TerritoryState, playerId: string, stack: MovableState): TerritoryState {
  const { garrison, movedIn, extraMoveUsed } = stack;
  if (state.ownerId === playerId) return { ...state, garrison, movedIn, extraMoveUsed };

  const entry: GuestStack = { playerId, garrison, movedIn, extraMoveUsed };
  const existing = guestsOf(state);
  const guests = existing.some((g) => g.playerId === playerId)
    ? existing.map((g) => (g.playerId === playerId ? entry : g))
    : [...existing, entry];
  return withGuests(state, guests.filter((g) => totalUnits(g.garrison) > 0));
}

/** `units` arriving at `state` under `playerId`, having just moved (so they can't go on until the
 *  round resets - `extraMoveUsed` is how many of them are Motorisierte Infanterie on their second
 *  hop, see splitExtraMoveUnits): unowned ground is claimed by them, their own ground is reinforced,
 *  anyone else's - the caller has already checked that's an ally's - becomes a guest stack there. */
export function depositUnits(
  state: TerritoryState,
  playerId: string,
  units: UnitComposition,
  extraMoveUsed: UnitComposition = EMPTY_GARRISON,
): TerritoryState {
  if (state.ownerId === null) return { ownerId: playerId, garrison: units, movedIn: units, extraMoveUsed };
  const current = stackOf(state, playerId) ?? { garrison: EMPTY_GARRISON, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON };
  return withStack(state, playerId, {
    garrison: addGarrisons(current.garrison, units),
    movedIn: addGarrisons(current.movedIn, units),
    extraMoveUsed: addGarrisons(current.extraMoveUsed, extraMoveUsed),
  });
}

/** Everything that defends a territory when it's attacked: the owner's garrison and every allied
 *  guest's together - "Verbündete verteidigen gemeinsam". */
export function defenderForce(state: TerritoryState): UnitComposition {
  return guestsOf(state).reduce((sum, guest) => addGarrisons(sum, guest.garrison), state.garrison);
}

/** Every unit `playerId` has on the map: their garrisons at home plus their guest stacks abroad. */
export function playerForce(gameState: GameState, playerId: string): UnitComposition {
  let total = EMPTY_GARRISON;
  for (const state of gameState.territoryState.values()) {
    const stack = stackOf(state, playerId);
    if (stack) total = addGarrisons(total, stack.garrison);
  }
  return total;
}

/**
 * Divides `total` - whatever's left of several stacks' combined force, e.g. after a fight - back
 * among those stacks, per unit type in proportion to what each one brought (largest remainder, ties
 * to the earlier stack, which is the owner's). Deterministic, and never hands a stack more of a type
 * than it started with. `weights` are each stack's original garrison, in the same order as the
 * returned shares.
 */
export function splitAmongStacks(total: UnitComposition, weights: readonly UnitComposition[]): UnitComposition[] {
  const shares = weights.map(() => ({ ...EMPTY_GARRISON }));
  for (const type of UNIT_KEYS) {
    const weightSum = weights.reduce((sum, w) => sum + w[type], 0);
    const amount = Math.min(total[type], weightSum);
    if (amount <= 0) continue;

    const exact = weights.map((w) => (amount * w[type]) / weightSum);
    const floors = exact.map((x) => Math.floor(x));
    let remainder = amount - floors.reduce((sum, f) => sum + f, 0);
    const byLargestRemainder = exact
      .map((x, index) => ({ index, fraction: x - Math.floor(x) }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (const { index } of byLargestRemainder) {
      if (remainder <= 0) break;
      floors[index] = floors[index]! + 1;
      remainder--;
    }
    floors.forEach((count, index) => {
      shares[index]![type] = count;
    });
  }
  return shares;
}

/**
 * Replaces what defends `state` - the owner's garrison and every guest stack - with `remaining`
 * (never more of a type than they had together), split back across them in proportion to what each
 * held (see splitAmongStacks). `spent` marks the survivors as having just fought, so none of them
 * can move again this round (the winner of a battle, see engine/combat.ts's applyConclusion);
 * otherwise each stack keeps whatever it had already moved, capped at what's left of it.
 */
export function setDefenderForce(state: TerritoryState, remaining: UnitComposition, spent: boolean): TerritoryState {
  const guests = guestsOf(state);
  const shares = splitAmongStacks(remaining, [state.garrison, ...guests.map((g) => g.garrison)]);
  const settle = (stack: MovableState, share: UnitComposition): MovableState => ({
    garrison: share,
    movedIn: spent ? share : minGarrisons(stack.movedIn, share),
    extraMoveUsed: spent ? EMPTY_GARRISON : minGarrisons(stack.extraMoveUsed, share),
  });

  const nextOwner: TerritoryState = { ...state, ...settle(state, shares[0]!) };
  const nextGuests = guests
    .map((guest, i): GuestStack => ({ ...guest, ...settle(guest, shares[i + 1]!) }))
    .filter((guest) => totalUnits(guest.garrison) > 0);
  return withGuests(nextOwner, nextGuests);
}

/** Drops the guest stacks of every player who no longer holds a single territory (see
 *  engine/victory.ts's isEliminated): with nowhere left to call home and no turn of their own ever
 *  again, their stranded units would only linger on the map as ghosts - and forever block their
 *  former allies from leaving the alliance (see engine/diplomacy.ts's leaveAlliance). */
export function pruneEliminatedGuests(gameState: GameState): GameState {
  const landed = new Set<string>();
  for (const state of gameState.territoryState.values()) if (state.ownerId) landed.add(state.ownerId);

  let next: Map<string, TerritoryState> | null = null;
  for (const [id, state] of gameState.territoryState) {
    const guests = guestsOf(state);
    const kept = guests.filter((g) => landed.has(g.playerId));
    if (kept.length === guests.length) continue;
    next ??= new Map(gameState.territoryState);
    next.set(id, withGuests(state, kept));
  }
  return next ? { ...gameState, territoryState: next } : gameState;
}

/** What a viewer sees standing on one territory, sorted by whose it is - see garrisonView. */
export interface GarrisonView {
  /** The viewer's own units here, and how many of those haven't acted this round. */
  readonly own: UnitComposition;
  readonly ownAvailable: UnitComposition;
  /** Units of the viewer's allies here: the owner's garrison and any other visiting ally's. */
  readonly friendly: UnitComposition;
  /** Everybody else's - an ordinary foreign garrison, or none of it visible at all - and how many
   *  of it haven't acted this round. */
  readonly other: UnitComposition;
  readonly otherAvailable: UnitComposition;
}

/** Sorts the units at `state` into the viewer's own, their allies' ("freundliche") and everyone
 *  else's - what the map draws in green, blue and white respectively (see render/MapRenderer.ts's
 *  drawGarrisonLabel). A null viewer has no own units and no allies. */
export function garrisonView(gameState: GameState, state: TerritoryState, viewerId: string | null): GarrisonView {
  let own = EMPTY_GARRISON;
  let ownAvailable = EMPTY_GARRISON;
  let friendly = EMPTY_GARRISON;
  let other = EMPTY_GARRISON;
  let otherAvailable = EMPTY_GARRISON;

  const stacks: readonly { readonly playerId: string | null; readonly stack: MovableState }[] = [
    { playerId: state.ownerId, stack: state },
    ...guestsOf(state).map((guest) => ({ playerId: guest.playerId, stack: guest })),
  ];
  for (const { playerId, stack } of stacks) {
    if (totalUnits(stack.garrison) === 0) continue;
    const unmoved = subtractGarrisons(stack.garrison, stack.movedIn);
    if (viewerId !== null && playerId === viewerId) {
      own = addGarrisons(own, stack.garrison);
      ownAvailable = addGarrisons(ownAvailable, unmoved);
    } else if (viewerId !== null && playerId !== null && areAllied(gameState, viewerId, playerId)) {
      friendly = addGarrisons(friendly, stack.garrison);
    } else {
      other = addGarrisons(other, stack.garrison);
      otherAvailable = addGarrisons(otherAvailable, unmoved);
    }
  }
  return { own, ownAvailable, friendly, other, otherAvailable };
}

export type MoveOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/**
 * Moves `amount` units from a territory onto an adjacent one - at most what's currently
 * available there (garrison minus whatever already moved this round). Anything left behind
 * stays put, still the mover's, free to move again once the round resets. Only the
 * active player may move, and never while a battle is pending (see engine/combat.ts). The units
 * may come from the mover's own territory or from an ally's territory they're stationed on.
 *
 * - Neutral or own destination: relocates/reinforces, no resistance.
 * - An ally's territory: the units stand there alongside the ally's own (see TerritoryState.guests),
 *   so allied ground can be crossed and used as a staging area.
 * - Enemy destination with nothing defending it (no garrison, no allied guests): uncontested
 *   capture.
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
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const fromTerritory = territories.find((t) => t.id === fromId);
  if (!fromTerritory) return { ok: false, reason: `Unbekanntes Gebiet "${fromId}".` };
  if (!fromTerritory.neighbors.includes(toId)) return { ok: false, reason: 'Gebiete sind nicht benachbart.' };

  const fromState = gameState.territoryState.get(fromId);
  const fromStack = fromState ? stackOf(fromState, playerId) : null;
  if (!fromState || !fromStack) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  if (totalUnits(amount) === 0) return { ok: false, reason: 'Keine Einheiten ausgewählt.' };
  if (!fitsWithin(amount, availableToMove(fromStack))) {
    return { ok: false, reason: 'Nicht genug verfügbare Einheiten - manche haben sich diese Runde schon bewegt.' };
  }

  const toState = gameState.territoryState.get(toId);
  if (!toState) return { ok: false, reason: `Unbekanntes Gebiet "${toId}".` };

  const { usedOnce: motorizedUsedOnce } = splitExtraMoveUnits(fromStack, amount.motorizedInfantry);
  const secondHop: UnitComposition = { ...EMPTY_GARRISON, motorizedInfantry: motorizedUsedOnce };

  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(
    fromId,
    withStack(fromState, playerId, {
      garrison: subtractGarrisons(fromStack.garrison, amount),
      movedIn: fromStack.movedIn,
      extraMoveUsed: fromStack.extraMoveUsed,
    }),
  );

  if (toState.ownerId === null || toState.ownerId === playerId || areAllied(gameState, playerId, toState.ownerId)) {
    nextTerritoryState.set(toId, depositUnits(toState, playerId, amount, secondHop));
    return { ok: true, gameState: { ...gameState, territoryState: nextTerritoryState } };
  }

  if (totalUnits(defenderForce(toState)) === 0) {
    if (!areAtWar(gameState, playerId, toState.ownerId)) {
      return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor Gebiete erobert werden können.' };
    }
    nextTerritoryState.set(toId, { ownerId: playerId, garrison: amount, movedIn: amount, extraMoveUsed: secondHop });
    const conqueredState = addToPlayerStats(
      { ...gameState, territoryState: nextTerritoryState },
      playerId,
      { territoriesConquered: 1 },
    );
    return { ok: true, gameState: conqueredState };
  }

  return { ok: false, reason: 'Das Gebiet ist verteidigt - greife an, statt zu verschieben.' };
}
