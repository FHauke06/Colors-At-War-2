import type { BattlePlacement, BattleSubState, BattleSubTerritory, BattleTerrain, CalledAircraft, GameState, PendingBattle, Territory, TerritoryState, UnitComposition } from './types';
import {
  addGarrisons,
  subtractGarrisons,
  totalUnits,
  availableToMove,
  splitExtraMoveUnits,
  stackOf,
  withStack,
  depositUnits,
  guestsOf,
  defenderForce,
  setDefenderForce,
  splitAmongStacks,
} from './movement';
import { pickRandomBattleMap, type BattleMap } from '../data/BattleMaps';
import { areAllied, areAtWar } from './diplomacy';
import { recordBattleOutcome, addToPlayerStats } from './stats';
import { isSupportUnlocked, strengthTableFor, artilleryRangeFor, artilleryKillsPerPiece } from './research';
import { STRENGTH, ARTILLERY_RANGE } from './unitStats';
import type { StrengthTable } from './unitStats';
import {
  airfieldAt,
  emptyAirComposition,
  fighterKills,
  FIGHTER_CALL_ARRIVAL_ROUNDS,
  CAS_CALL_ARRIVAL_ROUNDS,
  CAS_RETURN_TRIP_ROUNDS,
  CAS_MIN_AIR_SUPERIORITY,
  CAS_STRIKE_DAMAGE_PER_UNIT,
} from './airforce';

/** The tactical battlefield is a GRID_SIZE-wide grid of "kleine Gebiete" - the attacker only ever
 *  gets a shallow strip (ATTACKER_ROWS rows) to stage from, the defender the rest of the map to
 *  fall back across - flanked by one extra escape row beyond each side's back line, where units
 *  that reach it can break through (or retreat) onto the main map instead of occupying it. */
export const GRID_SIZE = 16;
const ATTACKER_ROWS = 3;
const TOP_ESCAPE_ROW = 0;
const PLAYABLE_ROW_START = 1;
const BOTTOM_ESCAPE_ROW = PLAYABLE_ROW_START + GRID_SIZE;
const TOTAL_ROWS = BOTTOM_ESCAPE_ROW + 1;
/** Both sides know this limit going in (see engine/ai.ts's time-aware battle-turn heuristics) - a
 *  battle that's still going after this many full rounds (attacker turn + defender turn) ends with
 *  the defender winning outright, having simply outlasted the clock. */
export const MAX_BATTLE_ROUNDS = 60;

const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

/** Die Kampfwerte je Einheitentyp (5:2:1 - siehe unitStats.ts) und die Grundreichweite der Artillerie, hier für
 *  ui/GameScreen.ts's Research-Tooltips wieder ausgeführt. Ein Spieler mit Upgrades hat höhere Werte: siehe
 *  research.ts's strengthTableFor/artilleryRangeFor - die Kampffunktionen unten nehmen dafür optional die Tabelle des Besitzers. */
export { STRENGTH, ARTILLERY_RANGE };

/** Units fighting from a defended "kleines Gebiet" count 1.5x their nominal strength - ceil'd so
 *  a fight is never decided by a fractional point. */
const DEFENSE_MULTIPLIER = 1.5;

/** Rüstungspunkte spent each time useNuke is called, on top of the one-time SUPPORT_TECH_TREE
 *  research cost to unlock 'nuke' in the first place (see engine/research.ts). */
export const NUKE_USE_COST = 750;

/** `table` = die Kampfwerte des Besitzers dieser Einheiten (research.ts's strengthTableFor) - ohne Angabe die Grundwerte. */
export function battleStrength(composition: UnitComposition, table: StrengthTable = STRENGTH): number {
  return (
    composition.infantry * table.infantry +
    composition.lightTank * table.lightTank +
    composition.heavyTank * table.heavyTank +
    composition.artillery * table.artillery +
    composition.motorizedInfantry * table.motorizedInfantry
  );
}

/** A defending garrison's effective combat strength - see DEFENSE_MULTIPLIER. */
export function defenseStrength(garrison: UnitComposition, table: StrengthTable = STRENGTH): number {
  return Math.ceil(battleStrength(garrison, table) * DEFENSE_MULTIPLIER);
}

/** Removes `damage` worth of strength from `composition`, cheapest unit type first - gemessen in den Kampfwerten von `table`
 *  (dem Besitzer der Einheiten: aufgerüstete Einheiten sind mehr wert und fallen daher später). Artillery
 *  never defends itself (see UnitComposition) - it has zero STRENGTH, so it can't "afford" its way
 *  through the division-based peeling below the way the other types do. Instead, any nonzero
 *  damage that reaches a stack wipes every artillery piece in it outright, first, before infantry/
 *  lightTank/heavyTank casualties are computed from the remaining damage budget. */
function reduceByStrength(composition: UnitComposition, damage: number, table: StrengthTable = STRENGTH): UnitComposition {
  let left = damage;
  const remaining = { ...composition };

  if (left > 0) remaining.artillery = 0;

  const infantryLost = Math.min(remaining.infantry, Math.floor(left / table.infantry));
  remaining.infantry -= infantryLost;
  left -= infantryLost * table.infantry;

  // Same strength tier as Infanterie (both 1) - taken next, same "cheapest first" convention.
  const motorizedLost = Math.min(remaining.motorizedInfantry, Math.floor(left / table.motorizedInfantry));
  remaining.motorizedInfantry -= motorizedLost;
  left -= motorizedLost * table.motorizedInfantry;

  const lightLost = Math.min(remaining.lightTank, Math.floor(left / table.lightTank));
  remaining.lightTank -= lightLost;
  left -= lightLost * table.lightTank;

  const heavyLost = Math.min(remaining.heavyTank, Math.floor(left / table.heavyTank));
  remaining.heavyTank -= heavyLost;

  return remaining;
}

function subTerritoryId(row: number, col: number): string {
  return `${row}-${col}`;
}

/** Expands a BattleMap's cells into a full terrain lookup. Maps aren't mirrored/symmetric - each
 *  one places its obstacles wherever it wants across the whole grid (see data/BattleMaps). */
function expandTerrain(map: BattleMap): Map<string, BattleTerrain> {
  const terrain = new Map<string, BattleTerrain>();
  for (const cell of map.cells) terrain.set(subTerritoryId(cell.row, cell.col), cell.terrain);
  return terrain;
}

/** Picks 6 random normal, non-escape cells from the defender's zone as cities - the attacker's
 *  only path to winning without wiping out the whole defending force outright, since the attacker
 *  (a shallow 3-row staging strip, see ATTACKER_ROWS) has no cities of their own to hold. */
function pickCityIds(cells: readonly Omit<BattleSubTerritory, 'isCity'>[]): Set<string> {
  const candidates = cells.filter((t) => t.side === 'defender' && t.terrain === 'normal' && !t.isEscape);
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return new Set(shuffled.slice(0, 6).map((c) => c.id));
}

/** A GRID_SIZE x TOTAL_ROWS grid, 8-directionally connected (orthogonal and diagonal). Rows
 *  PLAYABLE_ROW_START..PLAYABLE_ROW_START+ATTACKER_ROWS-1 (a shallow 3-row strip) are the
 *  attacker's starting zone, the rest up to BOTTOM_ESCAPE_ROW-1 the defender's much larger one -
 *  just the deployment boundary, not a restriction on where units can end up once the fighting
 *  starts. TOP_ESCAPE_ROW and BOTTOM_ESCAPE_ROW are the escape lanes: nobody deploys there,
 *  they're reachable only by fighting or marching up to them. River/mountain cells (from `map`)
 *  are excluded from every neighbor list on every side - nothing can ever stand on or pass through
 *  one. 6 cities, all in the defender's zone (see pickCityIds), are the attacker's alternate win
 *  condition - the defender has none of their own to lose. */
export function generateSubTerritories(map: BattleMap): BattleSubTerritory[] {
  const terrainByCell = expandTerrain(map);
  const terrainAt = (row: number, col: number): BattleTerrain => terrainByCell.get(subTerritoryId(row, col)) ?? 'normal';

  const base: Omit<BattleSubTerritory, 'isCity'>[] = [];
  for (let row = 0; row < TOTAL_ROWS; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const terrain = terrainAt(row, col);
      const neighbors: string[] = [];
      if (terrain === 'normal') {
        for (let dRow = -1; dRow <= 1; dRow++) {
          for (let dCol = -1; dCol <= 1; dCol++) {
            if (dRow === 0 && dCol === 0) continue;
            const r = row + dRow;
            const c = col + dCol;
            if (r >= 0 && r < TOTAL_ROWS && c >= 0 && c < GRID_SIZE && terrainAt(r, c) === 'normal') {
              neighbors.push(subTerritoryId(r, c));
            }
          }
        }
      }
      const playableRow = row - PLAYABLE_ROW_START;
      base.push({
        id: subTerritoryId(row, col),
        row,
        col,
        side: playableRow < ATTACKER_ROWS ? 'attacker' : 'defender',
        isEscape: row === TOP_ESCAPE_ROW || row === BOTTOM_ESCAPE_ROW,
        terrain,
        neighbors,
      });
    }
  }

  const cityIds = pickCityIds(base);
  return base.map((t) => ({ ...t, isCity: cityIds.has(t.id) }));
}

function sumComposition(items: readonly UnitComposition[]): UnitComposition {
  return items.reduce((acc, item) => addGarrisons(acc, item), EMPTY_GARRISON);
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

/** A deployment (a sparse list of placements - most of the grid stays empty) is legal if every
 *  entry lands on a real, non-negative cell and the total across all of them doesn't exceed what
 *  that side actually has available. Duplicate entries for the same cell are fine - they're summed. */
export function deploymentFits(
  max: UnitComposition,
  placements: readonly BattlePlacement[],
  validSubIds: ReadonlySet<string>,
): boolean {
  if (placements.some((p) => !validSubIds.has(p.subId))) return false;
  if (placements.some((p) => p.amount.infantry < 0 || p.amount.lightTank < 0 || p.amount.heavyTank < 0 || p.amount.artillery < 0)) {
    return false;
  }
  const sum = sumComposition(placements.map((p) => p.amount));
  return (
    sum.infantry <= max.infantry &&
    sum.lightTank <= max.lightTank &&
    sum.heavyTank <= max.heavyTank &&
    sum.artillery <= max.artillery
  );
}

export type StartBattleOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/**
 * Declares an attack: records who's fighting over what and each side's available force, and lays
 * out the tactical sub-map - but doesn't touch territoryState yet, and subState stays null until
 * both sides have deployed. Blocks (like every other action) while a battle is already pending.
 * The attack may launch from the attacker's own territory or from an ally's they're stationed on
 * (see TerritoryState.guests); the defending force is the territory owner's garrison together with
 * every allied guest standing there, fighting as one under the owner's command.
 */
export function startBattle(
  gameState: GameState,
  playerId: string,
  fromId: string,
  toId: string,
  territories: readonly Territory[],
): StartBattleOutcome {
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Es läuft bereits ein Kampf.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const fromTerritory = territories.find((t) => t.id === fromId);
  if (!fromTerritory) return { ok: false, reason: `Unbekanntes Gebiet "${fromId}".` };
  if (!fromTerritory.neighbors.includes(toId)) return { ok: false, reason: 'Gebiete sind nicht benachbart.' };

  const fromState = gameState.territoryState.get(fromId);
  const fromStack = fromState ? stackOf(fromState, playerId) : null;
  if (!fromState || !fromStack) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  const attackerMax = availableToMove(fromStack);
  if (totalUnits(attackerMax) === 0) {
    return { ok: false, reason: 'Nicht genug verfügbare Einheiten - manche haben sich diese Runde schon bewegt.' };
  }

  const toState = gameState.territoryState.get(toId);
  if (!toState) return { ok: false, reason: `Unbekanntes Gebiet "${toId}".` };
  if (toState.ownerId === null || toState.ownerId === playerId || areAllied(gameState, playerId, toState.ownerId)) {
    return { ok: false, reason: 'Das Gebiet ist nicht feindlich besetzt - normal verschieben statt angreifen.' };
  }
  const defenders = defenderForce(toState);
  if (totalUnits(defenders) === 0) {
    return { ok: false, reason: 'Das Gebiet ist unverteidigt - normal verschieben statt angreifen.' };
  }
  if (!areAtWar(gameState, playerId, toState.ownerId)) {
    return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor angegriffen werden kann.' };
  }

  const battleMap = pickRandomBattleMap();
  const pendingBattle: PendingBattle = {
    territoryId: toId,
    fromId,
    attackerId: playerId,
    defenderId: toState.ownerId,
    attackerMax,
    defenderMax: defenders,
    attackerDeployed: false,
    defenderDeployed: false,
    battleMapName: battleMap.name,
    subTerritories: generateSubTerritories(battleMap),
    subState: null,
    activeSide: null,
    battleRound: 0,
    calledAircraft: [],
  };
  return { ok: true, gameState: { ...gameState, pendingBattle } };
}

/** A simulated fight's defenders count double their nominal strength - steeper than the tactical
 *  battle's 1.5x DEFENSE_MULTIPLIER, since skipping the tactical map entirely should come with a
 *  real risk premium rather than being a strictly-better shortcut. Exported for engine/ai.ts,
 *  which sizes up simulated-attack targets with the same math. */
export const SIMULATED_DEFENSE_MULTIPLIER = 2;

export type SimulateAttackOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly result: BattleResult }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolves an attack instantly and randomly instead of opening the tactical sub-map: commits the
 * attacker's whole available force against the defender's whole garrison. The defender's
 * SIMULATED_DEFENSE_MULTIPLIER applies twice over - their boosted strength both wins the
 * weighted-random roll (win chance attackerStrength / (attackerStrength + boostedDefenderStrength))
 * more often AND halves the damage they actually take on a successful defense. The loser's
 * committed force is wiped entirely; the winner keeps survivors reduced by the loser's
 * (effective) strength.
 */
export function simulateAttack(
  gameState: GameState,
  playerId: string,
  fromId: string,
  toId: string,
  territories: readonly Territory[],
): SimulateAttackOutcome {
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Es läuft bereits ein Kampf.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const fromTerritory = territories.find((t) => t.id === fromId);
  if (!fromTerritory) return { ok: false, reason: `Unbekanntes Gebiet "${fromId}".` };
  if (!fromTerritory.neighbors.includes(toId)) return { ok: false, reason: 'Gebiete sind nicht benachbart.' };

  const fromState = gameState.territoryState.get(fromId);
  const fromStack = fromState ? stackOf(fromState, playerId) : null;
  if (!fromState || !fromStack) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  const attackerForce = availableToMove(fromStack);
  if (totalUnits(attackerForce) === 0) {
    return { ok: false, reason: 'Nicht genug verfügbare Einheiten - manche haben sich diese Runde schon bewegt.' };
  }

  const toState = gameState.territoryState.get(toId);
  if (!toState) return { ok: false, reason: `Unbekanntes Gebiet "${toId}".` };
  if (toState.ownerId === null || toState.ownerId === playerId || areAllied(gameState, playerId, toState.ownerId)) {
    return { ok: false, reason: 'Das Gebiet ist nicht feindlich besetzt - normal verschieben statt angreifen.' };
  }
  // The owner's garrison and any allied guests defend as one force - and share the outcome.
  const defenders = defenderForce(toState);
  if (totalUnits(defenders) === 0) {
    return { ok: false, reason: 'Das Gebiet ist unverteidigt - normal verschieben statt angreifen.' };
  }
  if (!areAtWar(gameState, playerId, toState.ownerId)) {
    return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor angegriffen werden kann.' };
  }

  // Jede Seite kämpft mit den Kampfwerten ihres Besitzers (Schadens-Upgrades, siehe research.ts).
  const attackerTable = strengthTableFor(gameState, playerId);
  const defenderTable = strengthTableFor(gameState, toState.ownerId);
  const attackerStrength = battleStrength(attackerForce, attackerTable);
  const defenderStrength = battleStrength(defenders, defenderTable) * SIMULATED_DEFENSE_MULTIPLIER;
  const attackerWon = Math.random() < attackerStrength / (attackerStrength + defenderStrength);

  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(
    fromId,
    withStack(fromState, playerId, {
      garrison: subtractGarrisons(fromStack.garrison, attackerForce),
      movedIn: fromStack.movedIn,
      extraMoveUsed: fromStack.extraMoveUsed,
    }),
  );
  if (attackerWon) {
    // The wiped-out defenders take any guests standing with them along - none survive to stay.
    const survivors = reduceByStrength(attackerForce, defenderStrength, attackerTable);
    nextTerritoryState.set(toId, { ownerId: playerId, garrison: survivors, movedIn: survivors, extraMoveUsed: EMPTY_GARRISON });
  } else {
    // The defender's toughness bonus applies twice over: it made winning the roll more likely,
    // and it halves the damage they actually take in doing so (SIMULATED_DEFENSE_MULTIPLIER).
    const survivors = reduceByStrength(defenders, attackerStrength / SIMULATED_DEFENSE_MULTIPLIER, defenderTable);
    nextTerritoryState.set(toId, setDefenderForce(toState, survivors, false));
  }

  const statefulGameState = recordBattleOutcome(
    { ...gameState, territoryState: nextTerritoryState },
    attackerWon
      ? {
          winnerId: playerId,
          loserId: toState.ownerId,
          attackerWon: true,
          winnerStarting: attackerForce,
          winnerSurviving: reduceByStrength(attackerForce, defenderStrength, attackerTable),
          loserStarting: defenders,
          loserRetained: EMPTY_GARRISON,
        }
      : {
          winnerId: toState.ownerId,
          loserId: playerId,
          attackerWon: false,
          winnerStarting: defenders,
          winnerSurviving: reduceByStrength(defenders, attackerStrength / SIMULATED_DEFENSE_MULTIPLIER, defenderTable),
          loserStarting: attackerForce,
          loserRetained: EMPTY_GARRISON,
        },
  );

  const result: BattleResult = { territoryId: toId, attackerId: playerId, defenderId: toState.ownerId, attackerWon };
  return { ok: true, gameState: statefulGameState, result };
}

export type CancelBattleOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/** Lets the attacker call off an attack before they've committed to a deployment - the defender
 *  doesn't get a say (they didn't choose to be attacked in the first place). */
export function cancelBattle(gameState: GameState, playerId: string): CancelBattleOutcome {
  const pending = gameState.pendingBattle;
  if (!pending) return { ok: false, reason: 'Kein Kampf im Gange.' };
  if (pending.attackerId !== playerId) return { ok: false, reason: 'Nur der Angreifer kann abbrechen.' };
  if (pending.attackerDeployed) return { ok: false, reason: 'Die Aufstellung ist bereits bestätigt.' };
  return { ok: true, gameState: { ...gameState, pendingBattle: null } };
}

/** Flips the "this side has committed" flag, without revealing what they deployed - used right
 *  after a deployment is accepted so the other side (and any onlookers) can see progress. */
export function markDeployed(gameState: GameState, side: 'attacker' | 'defender'): GameState {
  if (!gameState.pendingBattle) return gameState;
  return {
    ...gameState,
    pendingBattle: {
      ...gameState.pendingBattle,
      ...(side === 'attacker' ? { attackerDeployed: true } : { defenderDeployed: true }),
    },
  };
}

/**
 * Once both sides have deployed, materializes the tactical sub-map: every cell starts empty and
 * owned by whichever side its starting zone belongs to, then each side's placements are dropped
 * in on top. The attacker's committed force leaves the source macro territory immediately (it's
 * departed, regardless of how the fight goes). The defender moves first, having had time to dig in
 * and react to wherever the attacker chose to land.
 */
export function beginBattlePhase(
  gameState: GameState,
  attackerPlacements: readonly BattlePlacement[],
  defenderPlacements: readonly BattlePlacement[],
): GameState {
  const pending = gameState.pendingBattle;
  if (!pending) return gameState;

  const subState = new Map<string, BattleSubState>();
  for (const t of pending.subTerritories) {
    subState.set(t.id, {
      ownerId: t.side === 'attacker' ? pending.attackerId : pending.defenderId,
      garrison: EMPTY_GARRISON,
      movedIn: EMPTY_GARRISON,
      extraMoveUsed: EMPTY_GARRISON,
    });
  }
  for (const p of [...attackerPlacements, ...defenderPlacements]) {
    const existing = subState.get(p.subId);
    if (existing) subState.set(p.subId, { ...existing, garrison: addGarrisons(existing.garrison, p.amount) });
  }

  const committed = sumComposition(attackerPlacements.map((p) => p.amount));
  if (pending.fromSeaZone) {
    // Landungsangriff: die Truppen verlassen die Schiffe (eingeschiffte Einheiten der Seezone).
    const zone = gameState.seaZones.get(pending.fromId);
    const nextSeaZones = new Map(gameState.seaZones);
    if (zone) {
      const embarked = subtractGarrisons(zone.embarked, committed);
      nextSeaZones.set(pending.fromId, {
        ...zone,
        embarked,
        embarkedMovedIn: {
          infantry: Math.min(zone.embarkedMovedIn.infantry, embarked.infantry),
          lightTank: Math.min(zone.embarkedMovedIn.lightTank, embarked.lightTank),
          heavyTank: Math.min(zone.embarkedMovedIn.heavyTank, embarked.heavyTank),
          artillery: Math.min(zone.embarkedMovedIn.artillery, embarked.artillery),
          motorizedInfantry: Math.min(zone.embarkedMovedIn.motorizedInfantry, embarked.motorizedInfantry),
        },
      });
    }
    return {
      ...gameState,
      seaZones: nextSeaZones,
      pendingBattle: { ...pending, subState, activeSide: 'defender', battleRound: 1 },
    };
  }
  const nextTerritoryState = new Map(gameState.territoryState);
  const fromState = gameState.territoryState.get(pending.fromId)!;
  const fromStack = stackOf(fromState, pending.attackerId);
  if (fromStack) {
    nextTerritoryState.set(
      pending.fromId,
      withStack(fromState, pending.attackerId, {
        garrison: subtractGarrisons(fromStack.garrison, committed),
        movedIn: fromStack.movedIn,
        extraMoveUsed: fromStack.extraMoveUsed,
      }),
    );
  }

  return {
    ...gameState,
    territoryState: nextTerritoryState,
    pendingBattle: { ...pending, subState, activeSide: 'defender', battleRound: 1 },
  };
}

export interface BattleResult {
  readonly territoryId: string;
  readonly attackerId: string;
  readonly defenderId: string;
  readonly attackerWon: boolean;
  /** Set only when useNuke ended the battle - both sides lost everything, so `attackerWon` is
   *  always false here but doesn't mean the defender actually held the ground (see useNuke: the
   *  territory ends up unowned, not defender-owned). ui/GameScreen.ts's showBattleConcluded checks
   *  this to show a distinct "mutually annihilated" message instead of the usual win/lose one. */
  readonly nuked?: boolean;
  /** Nur bei einer Seeschlacht (engine/naval.ts) gesetzt: `territoryId` ist dann die Seezone. */
  readonly sea?: true;
  /** Gesetzt, wenn die Schlacht durch ein beidseitig bestätigtes Unentschieden endete (proposeBattleDraw). */
  readonly draw?: true;
}

function sideTotalUnits(subState: ReadonlyMap<string, BattleSubState>, ownerId: string): number {
  let total = 0;
  for (const state of subState.values()) {
    if (state.ownerId === ownerId) total += totalUnits(state.garrison);
  }
  return total;
}

function subTerritoriesOwnedBy(subState: ReadonlyMap<string, BattleSubState>, ownerId: string): UnitComposition {
  let total = EMPTY_GARRISON;
  for (const state of subState.values()) {
    if (state.ownerId === ownerId) total = addGarrisons(total, state.garrison);
  }
  return total;
}

function sumGarrisonsAt(subState: ReadonlyMap<string, BattleSubState>, cellIds: ReadonlySet<string>): UnitComposition {
  let total = EMPTY_GARRISON;
  for (const id of cellIds) {
    const state = subState.get(id);
    if (state) total = addGarrisons(total, state.garrison);
  }
  return total;
}

/** Whether a sub-territory is safe for `sideId` to retreat through: their own ground, or empty
 *  ground nobody's actually standing on. Not the enemy's - a live enemy cell blocks the path. */
function isPassableForRetreat(state: BattleSubState, sideId: string): boolean {
  return state.ownerId === sideId || totalUnits(state.garrison) === 0;
}

/**
 * The loser's sub-territories (still holding units) that have an unbroken path - through ground
 * not held by the winner - to an escape row. A BFS out from every escape-row cell, through
 * anything passable for the loser (see isPassableForRetreat); whatever it reaches and the loser
 * still occupies gets a chance to retreat onto the main map instead of being lost outright along
 * with the rest of their side - see applyConclusion. Everything the BFS never reaches is cut off
 * and lost with the battle, same as before this existed.
 */
function retreatableCellIds(
  subTerritories: readonly BattleSubTerritory[],
  subState: ReadonlyMap<string, BattleSubState>,
  loserId: string,
): Set<string> {
  const byId = new Map(subTerritories.map((t) => [t.id, t]));
  const reached = new Set<string>();
  const queue: string[] = [];
  for (const t of subTerritories) {
    if (t.isEscape) {
      reached.add(t.id);
      queue.push(t.id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const cell = byId.get(id);
    if (!cell) continue;
    for (const neighborId of cell.neighbors) {
      if (reached.has(neighborId)) continue;
      const neighborState = subState.get(neighborId);
      if (!neighborState || !isPassableForRetreat(neighborState, loserId)) continue;
      reached.add(neighborId);
      queue.push(neighborId);
    }
  }

  const retreatable = new Set<string>();
  for (const [id, state] of subState) {
    if (state.ownerId === loserId && totalUnits(state.garrison) > 0 && reached.has(id)) retreatable.add(id);
  }
  return retreatable;
}

/** Where the loser's retreating survivors land on the main map: the attacker always falls back to
 *  where they launched the assault from; the defender falls back to any other territory of their
 *  own bordering the contested one (not the attacker's launch point) - or, failing that, onto an
 *  ally's, where they stand as guests. Null if no such territory exists - nowhere safe to send
 *  them, regardless of whether the sub-map path was clear. */
function retreatDestination(
  gameState: GameState,
  pending: PendingBattle,
  loserId: string,
  territories: readonly Territory[],
): string | null {
  // Ein geschlagener Landungsangriff kann nicht auf die Schiffe zurück - die Truppen sind verloren.
  if (loserId === pending.attackerId) return pending.fromSeaZone ? null : pending.fromId;
  const contested = territories.find((t) => t.id === pending.territoryId);
  if (!contested) return null;
  const candidates = contested.neighbors.filter((id) => id !== pending.fromId);
  const ownerOf = (id: string): string | null => gameState.territoryState.get(id)?.ownerId ?? null;
  const home = candidates.find((id) => ownerOf(id) === loserId);
  if (home) return home;
  return candidates.find((id) => {
    const owner = ownerOf(id);
    return owner !== null && areAllied(gameState, loserId, owner);
  }) ?? null;
}

/** Splits `total` - some part of a territory's defending force, e.g. its survivors - back among
 *  whoever contributed it: the owner's garrison and every allied guest's, in proportion to what
 *  each had there (see splitAmongStacks). */
function shareOutDefenders(
  state: TerritoryState,
  ownerId: string,
  total: UnitComposition,
): readonly { readonly playerId: string; readonly share: UnitComposition }[] {
  const guests = guestsOf(state);
  const shares = splitAmongStacks(total, [state.garrison, ...guests.map((g) => g.garrison)]);
  return [
    { playerId: ownerId, share: shares[0]! },
    ...guests.map((guest, i) => ({ playerId: guest.playerId, share: shares[i + 1]! })),
  ];
}

/**
 * Folds a concluded tactical battle back into the macro map: the winner's combined survivors
 * (summed across every sub-territory they still hold) become the new garrison at the contested
 * territory - spent for this round either way, having just fought. A defender who holds the ground
 * keeps it together with the allied guests who fought beside them, each getting their share of the
 * survivors back (setDefenderForce); a conquering attacker takes it over alone. The loser's
 * survivors that had a clear path to an escape row (see retreatableCellIds) fall back onto a
 * neighboring territory instead of being lost outright, if one exists (retreatDestination) - a
 * defeated defense's guests retreating along with their host, each as their own units or as guests
 * wherever they land; everything else - cut off, or with nowhere to retreat to - is lost along with
 * the battle.
 */
function applyConclusion(gameState: GameState, result: BattleResult, territories: readonly Territory[]): GameState {
  const pending = gameState.pendingBattle!;
  const winnerId = result.attackerWon ? pending.attackerId : pending.defenderId;
  const loserId = result.attackerWon ? pending.defenderId : pending.attackerId;
  const survivors = subTerritoriesOwnedBy(pending.subState!, winnerId);
  const contested = gameState.territoryState.get(pending.territoryId)!;

  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(
    pending.territoryId,
    result.attackerWon
      ? { ownerId: winnerId, garrison: survivors, movedIn: survivors, extraMoveUsed: EMPTY_GARRISON }
      : setDefenderForce(contested, survivors, true),
  );

  const retreatable = retreatableCellIds(pending.subTerritories, pending.subState!, loserId);
  let retreatingUnits = EMPTY_GARRISON;
  if (retreatable.size > 0) {
    retreatingUnits = sumGarrisonsAt(pending.subState!, retreatable);
    const destinationId = totalUnits(retreatingUnits) > 0 ? retreatDestination(gameState, pending, loserId, territories) : null;
    if (destinationId) {
      const arrivals =
        loserId === pending.attackerId
          ? [{ playerId: loserId, share: retreatingUnits }]
          : shareOutDefenders(contested, loserId, retreatingUnits);
      let landed = gameState.territoryState.get(destinationId)!;
      for (const { playerId, share } of arrivals) {
        if (totalUnits(share) > 0) landed = depositUnits(landed, playerId, share);
      }
      nextTerritoryState.set(destinationId, landed);
    }
  }

  const winnerMax = winnerId === pending.attackerId ? pending.attackerMax : pending.defenderMax;
  const loserMax = loserId === pending.attackerId ? pending.attackerMax : pending.defenderMax;
  const statefulGameState = recordBattleOutcome(
    { ...gameState, territoryState: nextTerritoryState },
    {
      winnerId,
      loserId,
      attackerWon: result.attackerWon,
      winnerStarting: winnerMax,
      winnerSurviving: survivors,
      loserStarting: loserMax,
      loserRetained: retreatingUnits,
    },
  );

  const withAircraftReturned = returnAllCalledAircraftToBase(statefulGameState, pending);
  return { ...withAircraftReturned, pendingBattle: null };
}

export type DrawOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly concluded: BattleResult | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Bietet ein Unentschieden an (oder stimmt einem Angebot zu): setzt das Angebot der eigenen Seite. Erlaubt für beide
 * Kämpfer jederzeit in der Kampfphase (nach der Aufstellung), unabhängig davon, wer am Zug ist; wiederholtes Anbieten
 * ist harmlos. Haben BEIDE Seiten angeboten, endet die Schlacht UNVERÄNDERT (applyDraw): kein Gebiet wechselt den
 * Besitzer, der volle Restbestand beider Seiten bleibt erhalten.
 */
export function proposeBattleDraw(gameState: GameState, playerId: string): DrawOutcome {
  const pending = gameState.pendingBattle;
  if (!pending) return { ok: false, reason: 'Kein Kampf im Gange.' };
  if (!pending.subState) return { ok: false, reason: 'Ein Unentschieden ist erst nach der Aufstellung möglich.' };
  const side = pending.attackerId === playerId ? 'attacker' : pending.defenderId === playerId ? 'defender' : null;
  if (!side) return { ok: false, reason: 'Du bist an diesem Kampf nicht beteiligt.' };

  const next: PendingBattle = { ...pending, ...(side === 'attacker' ? { attackerDrawOffer: true as const } : { defenderDrawOffer: true as const }) };
  if (next.attackerDrawOffer && next.defenderDrawOffer) {
    const result: BattleResult = { territoryId: pending.territoryId, attackerId: pending.attackerId, defenderId: pending.defenderId, attackerWon: false, draw: true };
    return { ok: true, gameState: applyDraw({ ...gameState, pendingBattle: next }), concluded: result };
  }
  return { ok: true, gameState: { ...gameState, pendingBattle: next }, concluded: null };
}

/**
 * Beendet die Schlacht unverändert. Der Angreifer verliert nichts außer dem, was im Kampf schon gefallen ist: seine
 * überlebenden Einheiten (alles, was noch auf dem Schlachtfeld steht) kehren an ihren Ausgangsort zurück (Landgebiet,
 * bzw. bei einem Landungsangriff an Bord der Seezone) und gelten als bewegt. Beim Verteidiger wird die Garnison des
 * umkämpften Gebiets (samt verbündeter Gäste) auf seine überlebenden Einheiten gesetzt - das Gebiet bleibt seins.
 * Es gibt keine Statistik (weder Sieg noch Niederlage), Luftunterstützung fliegt zurück zur Basis.
 */
function applyDraw(gameState: GameState): GameState {
  const pending = gameState.pendingBattle!;
  const attackerRemaining = subTerritoriesOwnedUnits(pending.subState!, pending.attackerId);
  const defenderRemaining = subTerritoriesOwnedUnits(pending.subState!, pending.defenderId);

  const nextTerritoryState = new Map(gameState.territoryState);
  const contested = gameState.territoryState.get(pending.territoryId)!;
  nextTerritoryState.set(pending.territoryId, setDefenderForce(contested, defenderRemaining, false));

  let next: GameState = { ...gameState, territoryState: nextTerritoryState };
  if (totalUnits(attackerRemaining) > 0) {
    if (pending.fromSeaZone) {
      const zone = gameState.seaZones.get(pending.fromId);
      if (zone) {
        const seaZones = new Map(gameState.seaZones);
        seaZones.set(pending.fromId, {
          ...zone,
          embarked: addGarrisons(zone.embarked, attackerRemaining),
          embarkedMovedIn: addGarrisons(zone.embarkedMovedIn, attackerRemaining),
        });
        next = { ...next, seaZones };
      }
    } else {
      const from = nextTerritoryState.get(pending.fromId)!;
      nextTerritoryState.set(pending.fromId, depositUnits(from, pending.attackerId, attackerRemaining));
    }
  }
  return { ...returnAllCalledAircraftToBase(next, pending), pendingBattle: null };
}

/** Alle Einheiten eines Spielers auf dem Schlachtfeld (Summe über die Felder, die er gerade hält). */
function subTerritoriesOwnedUnits(subState: ReadonlyMap<string, BattleSubState>, ownerId: string): UnitComposition {
  return subTerritoriesOwnedBy(subState, ownerId);
}

/** Returns every one of `pending`'s called-in aircraft straight to its home airfield, regardless of
 *  where it was in its round trip - 'active'/'ready' credited immediately, 'incoming'/'returning'
 *  skip the rest of their transit time. Used whenever a battle concludes, so nothing is ever left
 *  stranded once PendingBattle itself is cleared. */
function returnAllCalledAircraftToBase(gameState: GameState, pending: PendingBattle): GameState {
  let airfields = gameState.airfields;
  for (const entry of pending.calledAircraft) {
    const home = airfields.get(entry.fromTerritoryId) ?? { level: 0, aircraft: emptyAirComposition() };
    const nextAircraft =
      entry.type === 'fighter'
        ? { ...home.aircraft, fighters: home.aircraft.fighters + entry.count }
        : { ...home.aircraft, cas: home.aircraft.cas + entry.count };
    const nextAirfields = new Map(airfields);
    nextAirfields.set(entry.fromTerritoryId, { ...home, aircraft: nextAircraft });
    airfields = nextAirfields;
  }
  return { ...gameState, airfields };
}

/** A side's current Luftüberlegenheit in this battle: total 'active' Jäger called in by each side
 *  (see CalledAircraft) - not what's merely projectable from nearby bases (engine/airforce.ts's
 *  projectableFightersAt), only what's actually arrived and engaged here. Drives the bar next to
 *  the tactical grid and gates calling in CAS (see callAirSupport). */
export function battleAirSuperiority(pending: PendingBattle): { attackerFighters: number; defenderFighters: number } {
  let attackerFighters = 0;
  let defenderFighters = 0;
  for (const entry of pending.calledAircraft) {
    if (entry.type !== 'fighter' || entry.status !== 'active') continue;
    if (entry.side === 'attacker') attackerFighters += entry.count;
    else defenderFighters += entry.count;
  }
  return { attackerFighters, defenderFighters };
}

export type CallAirSupportOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/**
 * Calls Jäger or CAS stationed at `fromTerritoryId` - the contested territory itself, or one of its
 * main-map neighbors ("nur Flugzeuge, die auf dem bekämpften oder benachbarten Gebiet stehen") -
 * into the currently pending tactical battle. Jäger arrive FIGHTER_CALL_ARRIVAL_ROUNDS battle-round
 * later and join the shared Luftüberlegenheit pool (see battleAirSuperiority); CAS arrive
 * CAS_CALL_ARRIVAL_ROUNDS later and wait 'ready' for a casStrike. CAS additionally requires the
 * calling side to already hold over CAS_MIN_AIR_SUPERIORITY of the battle's Jäger - it needs top
 * cover to operate safely. Both participants (and any spectator) can already see the call the
 * moment it's placed, the same way subState is fully visible to both - calledAircraft carries no
 * separate "notify" side effect of its own.
 */
export function callAirSupport(
  gameState: GameState,
  playerId: string,
  type: 'fighter' | 'cas',
  fromTerritoryId: string,
  count: number,
  territories: readonly Territory[],
): CallAirSupportOutcome {
  const pending = gameState.pendingBattle;
  if (!pending) return { ok: false, reason: 'Kein Kampf im Gange.' };
  const side: 'attacker' | 'defender' | null =
    pending.attackerId === playerId ? 'attacker' : pending.defenderId === playerId ? 'defender' : null;
  if (!side) return { ok: false, reason: 'Du bist nicht an diesem Kampf beteiligt.' };
  if (!Number.isFinite(count) || count <= 0) return { ok: false, reason: 'Keine Flugzeuge ausgewählt.' };

  const contested = territories.find((t) => t.id === pending.territoryId);
  const isEligibleSource = fromTerritoryId === pending.territoryId || (contested?.neighbors.includes(fromTerritoryId) ?? false);
  if (!isEligibleSource) {
    return { ok: false, reason: 'Nur Flugzeuge auf dem umkämpften oder einem angrenzenden Gebiet können gerufen werden.' };
  }

  const fromState = gameState.territoryState.get(fromTerritoryId);
  if (!fromState || fromState.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  const airfield = airfieldAt(gameState, fromTerritoryId);
  const available = type === 'fighter' ? airfield.aircraft.fighters : airfield.aircraft.cas;
  if (count > available) return { ok: false, reason: 'Nicht genug verfügbare Flugzeuge auf diesem Flugplatz.' };

  if (type === 'cas') {
    const { attackerFighters, defenderFighters } = battleAirSuperiority(pending);
    const mine = side === 'attacker' ? attackerFighters : defenderFighters;
    const total = attackerFighters + defenderFighters;
    if (total === 0 || mine / total <= CAS_MIN_AIR_SUPERIORITY) {
      return {
        ok: false,
        reason: 'CAS kann nur eingesetzt werden, wenn über 50% der Jäger in der Schlacht die eigenen sind.',
      };
    }
  }

  const nextAirfields = new Map(gameState.airfields);
  nextAirfields.set(fromTerritoryId, {
    ...airfield,
    aircraft:
      type === 'fighter'
        ? { ...airfield.aircraft, fighters: airfield.aircraft.fighters - count }
        : { ...airfield.aircraft, cas: airfield.aircraft.cas - count },
  });

  const entry: CalledAircraft = {
    id: `${type}-${fromTerritoryId}-${Math.random().toString(36).slice(2, 10)}`,
    side,
    type,
    count,
    fromTerritoryId,
    status: 'incoming',
    roundsRemaining: type === 'fighter' ? FIGHTER_CALL_ARRIVAL_ROUNDS : CAS_CALL_ARRIVAL_ROUNDS,
  };

  return {
    ok: true,
    gameState: {
      ...gameState,
      airfields: nextAirfields,
      pendingBattle: { ...pending, calledAircraft: [...pending.calledAircraft, entry] },
    },
  };
}

export type CasStrikeOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly concluded: BattleResult | null }
  | { readonly ok: false; readonly reason: string };

/** Strikes one "kleines Gebiet" with a 'ready' (arrived) CAS call - CAS_STRIKE_DAMAGE_PER_UNIT
 *  strength-worth of damage per CAS unit (reduceByStrength, cheapest unit first), then the CAS
 *  starts its CAS_RETURN_TRIP_ROUNDS trip back to base. Checks for a conclusion afterward, same as
 *  moveBattleUnits/bombardBattleCell - a CAS strike can also be what finally wipes a side out. */
export function casStrike(
  gameState: GameState,
  playerId: string,
  calledAircraftId: string,
  targetSubId: string,
  territories: readonly Territory[],
): CasStrikeOutcome {
  const pending = gameState.pendingBattle;
  if (!pending?.subState) return { ok: false, reason: 'Kein taktischer Kampf im Gange.' };
  const side: 'attacker' | 'defender' | null =
    pending.attackerId === playerId ? 'attacker' : pending.defenderId === playerId ? 'defender' : null;
  if (!side) return { ok: false, reason: 'Du bist nicht an diesem Kampf beteiligt.' };

  const entry = pending.calledAircraft.find((c) => c.id === calledAircraftId);
  if (!entry || entry.type !== 'cas' || entry.status !== 'ready' || entry.side !== side) {
    return { ok: false, reason: 'Diese CAS ist nicht einsatzbereit.' };
  }

  const targetState = pending.subState.get(targetSubId);
  if (!targetState) return { ok: false, reason: `Unbekanntes Feld "${targetSubId}".` };
  if (totalUnits(targetState.garrison) === 0) return { ok: false, reason: 'Kein Ziel auf diesem Feld.' };

  // reduceByStrength floors partial damage to zero casualties (same as every other damage-pool
  // effect in the game) - the Math.max keeps a strike from ever rounding all the way down to no
  // effect, even if CAS_STRIKE_DAMAGE_PER_UNIT is ever tuned back down below 1 strength/unit.
  const damage = Math.max(1, entry.count * CAS_STRIKE_DAMAGE_PER_UNIT);
  const nextSubState = new Map(pending.subState);
  nextSubState.set(targetSubId, { ...targetState, garrison: reduceByStrength(targetState.garrison, damage, strengthTableFor(gameState, targetState.ownerId)) });

  const nextCalled = pending.calledAircraft.map((c) =>
    c.id === calledAircraftId ? { ...c, status: 'returning' as const, roundsRemaining: CAS_RETURN_TRIP_ROUNDS } : c,
  );

  let nextGameState: GameState = {
    ...gameState,
    pendingBattle: { ...pending, subState: nextSubState, calledAircraft: nextCalled },
  };
  const concluded = checkConclusion(nextGameState);
  if (concluded) nextGameState = applyConclusion(nextGameState, concluded, territories);

  return { ok: true, gameState: nextGameState, concluded };
}

/** Advances every called-in aircraft's round trip by one full battle round: 'incoming' entries
 *  count down and either join the Luftüberlegenheit pool (Jäger, status -> 'active') or become
 *  strike-ready (CAS, status -> 'ready'); 'returning' CAS that finishes its trip is credited
 *  straight back to its home airfield and removed from the list. Called from endBattleTurn at the
 *  same point the round counter itself advances. */
function processAirSupportArrivals(gameState: GameState): GameState {
  const pending = gameState.pendingBattle;
  if (!pending) return gameState;

  let airfields = gameState.airfields;
  const nextCalled: CalledAircraft[] = [];
  for (const entry of pending.calledAircraft) {
    if (entry.status === 'incoming') {
      const roundsRemaining = entry.roundsRemaining - 1;
      if (roundsRemaining > 0) {
        nextCalled.push({ ...entry, roundsRemaining });
      } else {
        nextCalled.push({ ...entry, status: entry.type === 'fighter' ? 'active' : 'ready', roundsRemaining: 0 });
      }
      continue;
    }
    if (entry.status === 'returning') {
      const roundsRemaining = entry.roundsRemaining - 1;
      if (roundsRemaining > 0) {
        nextCalled.push({ ...entry, roundsRemaining });
        continue;
      }
      const home = airfields.get(entry.fromTerritoryId) ?? { level: 0, aircraft: emptyAirComposition() };
      const nextAirfields = new Map(airfields);
      nextAirfields.set(entry.fromTerritoryId, {
        ...home,
        aircraft: { ...home.aircraft, cas: home.aircraft.cas + entry.count },
      });
      airfields = nextAirfields;
      continue;
    }
    nextCalled.push(entry);
  }

  return { ...gameState, airfields, pendingBattle: { ...pending, calledAircraft: nextCalled } };
}

/** Mutual attrition between the battle's two 'active' Jäger pools, one full round's worth (see
 *  engine/airforce.ts's fighterKills for the formula) - both sides' losses are computed from the
 *  same pre-round counts and then applied, spread across each side's 'active' entries in list
 *  order, removing any that reach 0. */
function resolveInBattleAirCombat(gameState: GameState): GameState {
  const pending = gameState.pendingBattle;
  if (!pending) return gameState;

  const { attackerFighters, defenderFighters } = battleAirSuperiority(pending);
  if (attackerFighters === 0 || defenderFighters === 0) return gameState;

  const attackerLosses = Math.round(fighterKills(defenderFighters, attackerFighters));
  const defenderLosses = Math.round(fighterKills(attackerFighters, defenderFighters));

  const applyLosses = (entries: readonly CalledAircraft[], side: 'attacker' | 'defender', losses: number): CalledAircraft[] => {
    let remaining = losses;
    return entries
      .map((e) => {
        if (e.type !== 'fighter' || e.status !== 'active' || e.side !== side || remaining <= 0) return e;
        const taken = Math.min(e.count, remaining);
        remaining -= taken;
        return { ...e, count: e.count - taken };
      })
      .filter((e) => e.type !== 'fighter' || e.status !== 'active' || e.count > 0);
  };

  let nextCalled = applyLosses(pending.calledAircraft, 'attacker', attackerLosses);
  nextCalled = applyLosses(nextCalled, 'defender', defenderLosses);

  return { ...gameState, pendingBattle: { ...pending, calledAircraft: nextCalled } };
}

/** True once every one of `cities` is owned by `capturerId`. */
function allCitiesCapturedBy(
  cities: readonly BattleSubTerritory[],
  subState: ReadonlyMap<string, BattleSubState>,
  capturerId: string,
): boolean {
  return cities.length > 0 && cities.every((c) => subState.get(c.id)?.ownerId === capturerId);
}

function checkConclusion(gameState: GameState): BattleResult | null {
  const pending = gameState.pendingBattle;
  if (!pending?.subState) return null;
  const result = (attackerWon: boolean): BattleResult => ({
    territoryId: pending.territoryId,
    attackerId: pending.attackerId,
    defenderId: pending.defenderId,
    attackerWon,
  });

  const attackerTotal = sideTotalUnits(pending.subState, pending.attackerId);
  const defenderTotal = sideTotalUnits(pending.subState, pending.defenderId);
  if (defenderTotal === 0) return result(true);
  if (attackerTotal === 0) return result(false);

  // Capturing all 6 (defender-side) cities wins outright for the attacker, even with troops still
  // on the board - the defender has no cities of their own to lose, so there's no symmetric check.
  const allCities = pending.subTerritories.filter((t) => t.isCity);
  if (allCitiesCapturedBy(allCities, pending.subState, pending.attackerId)) return result(true);

  return null;
}

export type BattleMoveOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly concluded: BattleResult | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Moves `amount` units between two adjacent sub-territories, during the tactical battle phase.
 * Onto your own/empty ground: relocates/reinforces freely. Onto the enemy's: resolved instantly
 * by pure strength (no randomness) - the defending garrison counts 1.5x (see defenseStrength) -
 * the stronger side survives with the exact difference, the weaker is wiped; an exact tie wipes
 * both and the ground stays with whoever held it (nobody's force survived to take it). Checks for
 * a conclusion (one side at zero units anywhere) after every move and folds the result back into
 * the macro map immediately if so - including a chance for the loser's cut-off-free survivors to
 * retreat onto the main map instead of being lost outright, see applyConclusion. Never targets the
 * escape row - see escapeBattle for that.
 */
export function moveBattleUnits(
  gameState: GameState,
  playerId: string,
  fromSubId: string,
  toSubId: string,
  amount: UnitComposition,
  territories: readonly Territory[],
): BattleMoveOutcome {
  const pending = gameState.pendingBattle;
  if (!pending?.subState || !pending.activeSide) return { ok: false, reason: 'Kein taktischer Kampf im Gange.' };

  const activeBattlePlayerId = pending.activeSide === 'attacker' ? pending.attackerId : pending.defenderId;
  if (activeBattlePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug in diesem Kampf.' };

  const fromTerritory = pending.subTerritories.find((t) => t.id === fromSubId);
  if (!fromTerritory || !fromTerritory.neighbors.includes(toSubId)) {
    return { ok: false, reason: 'Felder sind nicht benachbart.' };
  }
  const toTerritory = pending.subTerritories.find((t) => t.id === toSubId);
  if (toTerritory?.isEscape) {
    return { ok: false, reason: 'Das Fluchtfeld kann nicht direkt angesteuert werden - nutze "Vom Schlachtfeld fliehen".' };
  }

  const fromState = pending.subState.get(fromSubId);
  if (!fromState || fromState.ownerId !== playerId) return { ok: false, reason: 'Das Feld gehört dir nicht.' };
  if (totalUnits(amount) === 0) return { ok: false, reason: 'Keine Einheiten ausgewählt.' };
  if (!fitsWithin(amount, availableToMove(fromState))) {
    return { ok: false, reason: 'Nicht genug verfügbare Einheiten - manche haben sich diesen Kampfzug schon bewegt.' };
  }

  const toState = pending.subState.get(toSubId);
  if (!toState) return { ok: false, reason: `Unbekanntes Feld "${toSubId}".` };

  const { usedOnce: motorizedUsedOnce } = splitExtraMoveUnits(fromState, amount.motorizedInfantry);

  const nextSubState = new Map(pending.subState);
  nextSubState.set(fromSubId, { ...fromState, garrison: subtractGarrisons(fromState.garrison, amount) });

  if (toState.ownerId === playerId) {
    nextSubState.set(toSubId, {
      ownerId: playerId,
      garrison: addGarrisons(toState.garrison, amount),
      movedIn: addGarrisons(toState.movedIn, amount),
      extraMoveUsed: addGarrisons(toState.extraMoveUsed, { ...EMPTY_GARRISON, motorizedInfantry: motorizedUsedOnce }),
    });
  } else {
    // Beide Seiten zählen mit den Kampfwerten ihres Besitzers (Schadens-Upgrades, siehe research.ts).
    const attackerTable = strengthTableFor(gameState, playerId);
    const defenderTable = strengthTableFor(gameState, toState.ownerId);
    const attackStrength = battleStrength(amount, attackerTable);
    const effectiveDefenseStrength = defenseStrength(toState.garrison, defenderTable);
    if (attackStrength > effectiveDefenseStrength) {
      const survivors = reduceByStrength(amount, effectiveDefenseStrength, attackerTable);
      nextSubState.set(toSubId, { ownerId: playerId, garrison: survivors, movedIn: survivors, extraMoveUsed: EMPTY_GARRISON });
    } else {
      // Defender holds (a tie also lands here: reduceByStrength by an equal amount empties it,
      // but the ground stays theirs since the attacker's force didn't survive to take it).
      nextSubState.set(toSubId, { ...toState, garrison: reduceByStrength(toState.garrison, attackStrength, defenderTable) });
    }
  }

  let nextGameState: GameState = { ...gameState, pendingBattle: { ...pending, subState: nextSubState } };
  const concluded = checkConclusion(nextGameState);
  if (concluded) nextGameState = applyConclusion(nextGameState, concluded, territories);

  return { ok: true, gameState: nextGameState, concluded };
}

/** 8-directional (Chebyshev) distance between two cells on the grid - same "a step in any of 8
 *  directions counts as 1" convention generateSubTerritories uses for ordinary adjacency, just not
 *  capped at 1 step. Exported for engine/ai.ts's bombardment heuristic and ui/GameScreen.ts's
 *  target-range highlighting, which both need the exact same reach bombardBattleCell enforces. */
export function subTerritoryDistance(a: BattleSubTerritory, b: BattleSubTerritory): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

export type BombardOutcome =
  | {
      readonly ok: true;
      readonly gameState: GameState;
      readonly concluded: BattleResult | null;
      readonly infantryKilled: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Fires `artilleryCount` of the artillery sitting at `fromSubId` at an enemy-held cell up to
 * artilleryRangeFor cells away (ARTILLERY_RANGE, mit Reichweiten-Upgrade weiter; no adjacency or line-of-sight
 * requirement, unlike moveBattleUnits) - killing up to artilleryKillsPerPiece Infanterie (1, mit Schadens-Upgrade 2) per
 * artillery piece that fires, capped by however many are actually there. Does nothing to lightTank/heavyTank/artillery at the target - see UnitComposition's note
 * on artillery carrying no ordinary battle strength; bombardment is its entire combat role, and it
 * only ever targets Infanterie. The firing artillery stays put (this isn't a move) but is marked as
 * having acted this battle-turn via the same `movedIn` bookkeeping ordinary movement uses, so it
 * can't also move or fire again until the round resets. Checks for a conclusion afterward, same as
 * moveBattleUnits/escapeBattle, since wiping the last defenders on a cell is possible this way too.
 */
export function bombardBattleCell(
  gameState: GameState,
  playerId: string,
  fromSubId: string,
  targetSubId: string,
  artilleryCount: number,
  territories: readonly Territory[],
): BombardOutcome {
  const pending = gameState.pendingBattle;
  if (!pending?.subState || !pending.activeSide) return { ok: false, reason: 'Kein taktischer Kampf im Gange.' };

  const activeBattlePlayerId = pending.activeSide === 'attacker' ? pending.attackerId : pending.defenderId;
  if (activeBattlePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug in diesem Kampf.' };
  if (artilleryCount <= 0) return { ok: false, reason: 'Keine Artillerie ausgewählt.' };
  if (fromSubId === targetSubId) return { ok: false, reason: 'Ziel muss ein anderes Feld sein.' };

  const fromTerritory = pending.subTerritories.find((t) => t.id === fromSubId);
  const targetTerritory = pending.subTerritories.find((t) => t.id === targetSubId);
  if (!fromTerritory || !targetTerritory) return { ok: false, reason: 'Unbekanntes Feld.' };
  const range = artilleryRangeFor(gameState, playerId);
  if (subTerritoryDistance(fromTerritory, targetTerritory) > range) {
    return { ok: false, reason: `Ziel liegt außerhalb der Reichweite (${range} Felder).` };
  }

  const fromState = pending.subState.get(fromSubId);
  if (!fromState || fromState.ownerId !== playerId) return { ok: false, reason: 'Das Feld gehört dir nicht.' };
  const availableArtillery = fromState.garrison.artillery - fromState.movedIn.artillery;
  if (artilleryCount > availableArtillery) {
    return {
      ok: false,
      reason: 'Nicht genug verfügbare Artillerie - manche hat sich diesen Kampfzug schon bewegt oder bereits gefeuert.',
    };
  }

  const targetState = pending.subState.get(targetSubId);
  if (!targetState) return { ok: false, reason: `Unbekanntes Feld "${targetSubId}".` };
  if (targetState.ownerId === playerId) return { ok: false, reason: 'Kann kein eigenes Feld beschießen.' };
  if (targetState.garrison.infantry === 0) return { ok: false, reason: 'Kein Infanterie-Ziel auf diesem Feld.' };

  const infantryKilled = Math.min(targetState.garrison.infantry, artilleryCount * artilleryKillsPerPiece(gameState, playerId));

  const nextSubState = new Map(pending.subState);
  nextSubState.set(fromSubId, {
    ...fromState,
    movedIn: { ...fromState.movedIn, artillery: fromState.movedIn.artillery + artilleryCount },
  });
  nextSubState.set(targetSubId, {
    ...targetState,
    garrison: { ...targetState.garrison, infantry: targetState.garrison.infantry - infantryKilled },
  });

  let nextGameState: GameState = { ...gameState, pendingBattle: { ...pending, subState: nextSubState } };
  const concluded = checkConclusion(nextGameState);
  if (concluded) nextGameState = applyConclusion(nextGameState, concluded, territories);

  return { ok: true, gameState: nextGameState, concluded, infantryKilled };
}

export type UseNukeOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly concluded: BattleResult }
  | { readonly ok: false; readonly reason: string };

/**
 * Ends the current tactical battle instantly by wiping every unit on the sub-map - the caller's
 * own included, not just the enemy's ("zerstört alle Einheiten in der Schlacht, auch
 * freundliche"). Costs NUKE_USE_COST Rüstungspunkte on top of having researched 'nuke' at all (see
 * engine/research.ts's SUPPORT_TECH_TREE), and one warhead off gameState.nukeStockpiles when the
 * caller has an entry there at all (most don't - see GameState.nukeStockpiles' doc comment - and
 * fire as often as they can afford, same as before this existed). Unlike an ordinary conclusion (applyConclusion), there
 * is no winner: the contested territory ends up unowned rather than credited to either side, and
 * no battlesWon/territoriesConquered goes to anyone - just each side's actual losses (whatever was
 * still alive on the grid the instant the bomb went off, not merely what was originally
 * deployed - some of it may already have died in earlier battle-turns). Any called-in aircraft
 * still return home same as any other conclusion (see returnAllCalledAircraftToBase) - they were
 * never on the ground to be caught in it.
 */
export function useNuke(gameState: GameState, playerId: string): UseNukeOutcome {
  const pending = gameState.pendingBattle;
  if (!pending?.subState || !pending.activeSide) return { ok: false, reason: 'Kein taktischer Kampf im Gange.' };

  const activeBattlePlayerId = pending.activeSide === 'attacker' ? pending.attackerId : pending.defenderId;
  if (activeBattlePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug in diesem Kampf.' };
  if (!isSupportUnlocked(gameState, playerId, 'nuke')) return { ok: false, reason: 'Atombombe noch nicht erforscht.' };

  const balance = gameState.resources.get(playerId) ?? 0;
  if (balance < NUKE_USE_COST) return { ok: false, reason: 'Nicht genug Rüstungspunkte für eine Atombombe.' };
  const stockpile = gameState.nukeStockpiles.get(playerId);
  if (stockpile !== undefined && stockpile <= 0) return { ok: false, reason: 'Kein Sprengkopf mehr im Arsenal.' };

  const attackerLosses = sideTotalUnits(pending.subState, pending.attackerId);
  const defenderLosses = sideTotalUnits(pending.subState, pending.defenderId);

  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - NUKE_USE_COST);
  const nukeStockpiles = stockpile === undefined ? gameState.nukeStockpiles : new Map(gameState.nukeStockpiles).set(playerId, stockpile - 1);

  let state = addToPlayerStats({ ...gameState, resources, nukeStockpiles }, pending.attackerId, { unitsLost: attackerLosses });
  state = addToPlayerStats(state, pending.defenderId, { unitsLost: defenderLosses });

  const nextTerritoryState = new Map(state.territoryState);
  nextTerritoryState.set(pending.territoryId, { ownerId: null, garrison: EMPTY_GARRISON, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON });

  const withAircraftReturned = returnAllCalledAircraftToBase({ ...state, territoryState: nextTerritoryState }, pending);
  const finalGameState: GameState = { ...withAircraftReturned, pendingBattle: null };

  const concluded: BattleResult = {
    territoryId: pending.territoryId,
    attackerId: pending.attackerId,
    defenderId: pending.defenderId,
    attackerWon: false,
    nuked: true,
  };

  return { ok: true, gameState: finalGameState, concluded };
}

export type EscapeBattleOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly concluded: BattleResult | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Sends `amount` units from a sub-territory adjacent to the escape row off the tactical map
 * entirely and onto `destinationId`, a neighbor of the contested territory on the main map - a
 * breakthrough (attacker) or a fighting retreat (defender), your choice either way. The units
 * never occupy the escape row itself; this is one atomic step from the grid straight onto the
 * macro map. Can't land on a defended enemy territory (that would need a second battle, which
 * isn't supported while this one is still pending) - use a peaceful move or an attack for that
 * once this battle is over. Checks for a conclusion same as moveBattleUnits, since escaping is
 * also a way for a side to end up at zero units on the grid.
 */
export function escapeBattle(
  gameState: GameState,
  playerId: string,
  fromSubId: string,
  destinationId: string,
  amount: UnitComposition,
  territories: readonly Territory[],
): EscapeBattleOutcome {
  const pending = gameState.pendingBattle;
  if (!pending?.subState || !pending.activeSide) return { ok: false, reason: 'Kein taktischer Kampf im Gange.' };

  const activeBattlePlayerId = pending.activeSide === 'attacker' ? pending.attackerId : pending.defenderId;
  if (activeBattlePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug in diesem Kampf.' };

  const fromTerritory = pending.subTerritories.find((t) => t.id === fromSubId);
  if (!fromTerritory) return { ok: false, reason: `Unbekanntes Feld "${fromSubId}".` };
  const reachesEscapeRow = fromTerritory.neighbors.some(
    (id) => pending.subTerritories.find((t) => t.id === id)?.isEscape,
  );
  if (!reachesEscapeRow) return { ok: false, reason: 'Dieses Feld grenzt nicht an das Fluchtfeld.' };

  const fromState = pending.subState.get(fromSubId);
  if (!fromState || fromState.ownerId !== playerId) return { ok: false, reason: 'Das Feld gehört dir nicht.' };
  if (totalUnits(amount) === 0) return { ok: false, reason: 'Keine Einheiten ausgewählt.' };
  if (!fitsWithin(amount, availableToMove(fromState))) {
    return { ok: false, reason: 'Nicht genug verfügbare Einheiten - manche haben sich diesen Kampfzug schon bewegt.' };
  }

  const destTerritory = territories.find((t) => t.id === destinationId);
  if (!destTerritory || !destTerritory.neighbors.includes(pending.territoryId)) {
    return { ok: false, reason: 'Dieses Gebiet grenzt nicht an das Schlachtfeld.' };
  }
  const destState = gameState.territoryState.get(destinationId);
  if (!destState) return { ok: false, reason: `Unbekanntes Gebiet "${destinationId}".` };
  // Unowned, own and allied ground can be landed on (an ally's as guests, see TerritoryState.guests);
  // anyone else's only if nothing at all defends it - neither a garrison nor allied guests.
  const friendlyGround =
    destState.ownerId === null || destState.ownerId === playerId || areAllied(gameState, playerId, destState.ownerId);
  if (!friendlyGround && totalUnits(defenderForce(destState)) > 0) {
    return { ok: false, reason: 'Dieses Gebiet ist verteidigt - dorthin kann man nicht entkommen.' };
  }

  const nextSubState = new Map(pending.subState);
  nextSubState.set(fromSubId, { ...fromState, garrison: subtractGarrisons(fromState.garrison, amount) });

  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(
    destinationId,
    friendlyGround
      ? depositUnits(destState, playerId, amount)
      : { ownerId: playerId, garrison: amount, movedIn: amount, extraMoveUsed: EMPTY_GARRISON },
  );

  let nextGameState: GameState = {
    ...gameState,
    territoryState: nextTerritoryState,
    pendingBattle: { ...pending, subState: nextSubState },
  };
  const concluded = checkConclusion(nextGameState);
  if (concluded) nextGameState = applyConclusion(nextGameState, concluded, territories);

  return { ok: true, gameState: nextGameState, concluded };
}

export type EndBattleTurnOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly concluded: BattleResult | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Passes the tactical initiative to the other combatant. A full lap (back to the defender, who
 * goes first each round - see beginBattlePhase) refreshes which units may move again, mirroring
 * the main game's once-per-round rule, and counts as one more of MAX_BATTLE_ROUNDS - once that's
 * used up, the defender wins outright regardless of remaining forces or cities (see applyConclusion
 * for the same loser's-survivors-retreat handling as any other conclusion), having simply outlasted
 * the clock.
 */
export function endBattleTurn(gameState: GameState, playerId: string, territories: readonly Territory[]): EndBattleTurnOutcome {
  const pending = gameState.pendingBattle;
  if (!pending?.subState || !pending.activeSide) return { ok: false, reason: 'Kein taktischer Kampf im Gange.' };

  const activeBattlePlayerId = pending.activeSide === 'attacker' ? pending.attackerId : pending.defenderId;
  if (activeBattlePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug in diesem Kampf.' };

  const nextSide: 'attacker' | 'defender' = pending.activeSide === 'attacker' ? 'defender' : 'attacker';
  let nextSubState = pending.subState;
  let nextRound = pending.battleRound;
  if (nextSide === 'defender') {
    nextSubState = new Map([...pending.subState].map(([id, s]) => [id, { ...s, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON }]));
    nextRound += 1;
  }

  let nextGameState: GameState = {
    ...gameState,
    pendingBattle: { ...pending, subState: nextSubState, activeSide: nextSide, battleRound: nextRound },
  };
  if (nextSide === 'defender') {
    // A full round just completed - advance every called-in aircraft's round trip (arrivals,
    // CAS returning home) and resolve this round's Jäger attrition, same cadence as battleRound.
    nextGameState = processAirSupportArrivals(nextGameState);
    nextGameState = resolveInBattleAirCombat(nextGameState);
  }

  if (nextRound > MAX_BATTLE_ROUNDS) {
    const result: BattleResult = {
      territoryId: pending.territoryId,
      attackerId: pending.attackerId,
      defenderId: pending.defenderId,
      attackerWon: false,
    };
    return { ok: true, gameState: applyConclusion(nextGameState, result, territories), concluded: result };
  }

  return { ok: true, gameState: nextGameState, concluded: null };
}

/**
 * Forces an otherwise-stalemated battle to a conclusion: whoever has more total remaining strength
 * on the sub-map wins (an exact tie favors the defender - home advantage), folded back into the
 * macro map exactly like a normal conclusion (including the loser's retreat, see applyConclusion).
 * A no-op if no battle is pending. Used by engine/ai.ts's cascadeAiBattleTurns as a hard safety
 * net for an AI-vs-AI fight that runs long enough that neither side's heuristics will ever find a
 * profitable move against the other - without this, nothing would end it and a battle between two
 * AI could hang the game indefinitely.
 */
export function forceConcludeBattle(gameState: GameState, territories: readonly Territory[]): GameState {
  const pending = gameState.pendingBattle;
  if (!pending?.subState) return gameState;
  const attackerStrength = battleStrength(subTerritoriesOwnedBy(pending.subState, pending.attackerId), strengthTableFor(gameState, pending.attackerId));
  const defenderStrength = battleStrength(subTerritoriesOwnedBy(pending.subState, pending.defenderId), strengthTableFor(gameState, pending.defenderId));
  const result: BattleResult = {
    territoryId: pending.territoryId,
    attackerId: pending.attackerId,
    defenderId: pending.defenderId,
    attackerWon: attackerStrength > defenderStrength,
  };
  return applyConclusion(gameState, result, territories);
}
