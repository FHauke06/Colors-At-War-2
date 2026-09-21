import type { AirComposition, AirfieldState, GameState, Territory, UnitComposition } from './types';
import { areAtWar } from './diplomacy';
import { isAirUnlocked } from './research';
import { developmentAt } from './economy';

const AIR_TECH_LABEL: Record<keyof AirComposition, string> = {
  fighters: 'Jäger',
  cas: 'CAS',
  bombers: 'Bomber',
};

const EMPTY_AIR: AirComposition = { fighters: 0, cas: 0, bombers: 0 };
const EMPTY_AIRFIELD: AirfieldState = { level: 0, aircraft: EMPTY_AIR };

export function emptyAirComposition(): AirComposition {
  return EMPTY_AIR;
}

export function totalAircraft(c: AirComposition): number {
  return c.fighters + c.cas + c.bombers;
}

export function addAircraft(a: AirComposition, b: AirComposition): AirComposition {
  return { fighters: a.fighters + b.fighters, cas: a.cas + b.cas, bombers: a.bombers + b.bombers };
}

export function subtractAircraft(a: AirComposition, b: AirComposition): AirComposition {
  return { fighters: a.fighters - b.fighters, cas: a.cas - b.cas, bombers: a.bombers - b.bombers };
}

/** Rüstungspunkte per 100 aircraft - Jäger and CAS are cheap enough to field in bulk, Bomber
 *  raids are a serious investment. */
export const AIRCRAFT_COST_PER_100: AirComposition = { fighters: 20, cas: 30, bombers: 200 };

/** Ceil'd so a fight is never decided by a fractional Rüstungspunkt - same convention as
 *  engine/combat.ts's defenseStrength. */
export function airCostOf(amount: AirComposition): number {
  const raw =
    (amount.fighters * AIRCRAFT_COST_PER_100.fighters +
      amount.cas * AIRCRAFT_COST_PER_100.cas +
      amount.bombers * AIRCRAFT_COST_PER_100.bombers) /
    100;
  return Math.ceil(raw);
}

/** How many battle-rounds after being called a Jäger takes to arrive over the battlefield. */
export const FIGHTER_CALL_ARRIVAL_ROUNDS = 1;
/** How many battle-rounds after being called CAS takes to arrive - and, once it has struck, how
 *  many more it takes to fly back to base before it's available again. */
export const CAS_CALL_ARRIVAL_ROUNDS = 3;
export const CAS_RETURN_TRIP_ROUNDS = 3;
/** CAS can only be called while the calling side holds over this share of the battle's Jäger pool
 *  (see PendingBattle.airSuperiority) - it needs its own top cover to operate safely. */
export const CAS_MIN_AIR_SUPERIORITY = 0.5;
/** Strength-worth of damage one CAS unit deals to its chosen "kleines Gebiet" per strike -
 *  reduceByStrength, cheapest unit first, same as every other damage-pool effect in the game.
 *  10 = one CAS unit alone can down 10 Infanterie (STRENGTH.infantry = 1) in a single strike. */
export const CAS_STRIKE_DAMAGE_PER_UNIT = 10;

export const AIRFIELD_BUILD_COST = 15;
export const AIRFIELD_UPGRADE_COST = 10;
/** Each level adds this many aircraft of capacity - level 1 holds 2, level 2 holds 4, etc. */
export const AIRFIELD_CAPACITY_PER_LEVEL = 2;

export function airfieldAt(gameState: GameState, territoryId: string): AirfieldState {
  return gameState.airfields.get(territoryId) ?? EMPTY_AIRFIELD;
}

export function airfieldCapacity(level: number): number {
  return level * AIRFIELD_CAPACITY_PER_LEVEL;
}

export type AirforceOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/** Builds a level-1 Flugplatz at an owned territory that doesn't already have one. */
export function buildAirfield(gameState: GameState, playerId: string, territoryId: string): AirforceOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const state = gameState.territoryState.get(territoryId);
  if (!state || state.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  if (airfieldAt(gameState, territoryId).level > 0) return { ok: false, reason: 'Hier steht bereits ein Flugplatz.' };

  const balance = gameState.resources.get(playerId) ?? 0;
  if (balance < AIRFIELD_BUILD_COST) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const nextAirfields = new Map(gameState.airfields);
  nextAirfields.set(territoryId, { level: 1, aircraft: EMPTY_AIR });
  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - AIRFIELD_BUILD_COST);

  return { ok: true, gameState: { ...gameState, airfields: nextAirfields, resources } };
}

/** Raises an existing Flugplatz by one level, raising its capacity by AIRFIELD_CAPACITY_PER_LEVEL. */
export function upgradeAirfield(gameState: GameState, playerId: string, territoryId: string): AirforceOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const state = gameState.territoryState.get(territoryId);
  if (!state || state.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };

  const airfield = airfieldAt(gameState, territoryId);
  if (airfield.level === 0) return { ok: false, reason: 'Hier steht noch kein Flugplatz.' };

  const balance = gameState.resources.get(playerId) ?? 0;
  if (balance < AIRFIELD_UPGRADE_COST) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const nextAirfields = new Map(gameState.airfields);
  nextAirfields.set(territoryId, { ...airfield, level: airfield.level + 1 });
  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - AIRFIELD_UPGRADE_COST);

  return { ok: true, gameState: { ...gameState, airfields: nextAirfields, resources } };
}

/** Spends Rüstungspunkte to add freshly-built aircraft to an owned Flugplatz, capped by its
 *  current free capacity (airfieldCapacity(level) minus whatever's already stationed there). */
export function recruitAircraft(
  gameState: GameState,
  playerId: string,
  territoryId: string,
  amount: AirComposition,
): AirforceOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const state = gameState.territoryState.get(territoryId);
  if (!state || state.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  if (amount.fighters < 0 || amount.cas < 0 || amount.bombers < 0) return { ok: false, reason: 'Ungültige Anzahl.' };
  if (totalAircraft(amount) === 0) return { ok: false, reason: 'Keine Flugzeuge ausgewählt.' };

  for (const type of ['fighters', 'cas', 'bombers'] as const) {
    if (amount[type] > 0 && !isAirUnlocked(gameState, playerId, type)) {
      return { ok: false, reason: `${AIR_TECH_LABEL[type]} noch nicht erforscht.` };
    }
  }

  const airfield = airfieldAt(gameState, territoryId);
  if (airfield.level === 0) return { ok: false, reason: 'Hier steht noch kein Flugplatz.' };
  const freeCapacity = airfieldCapacity(airfield.level) - totalAircraft(airfield.aircraft);
  if (totalAircraft(amount) > freeCapacity) {
    return { ok: false, reason: 'Nicht genug freie Kapazität auf diesem Flugplatz.' };
  }

  const cost = airCostOf(amount);
  const balance = gameState.resources.get(playerId) ?? 0;
  if (cost > balance) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const nextAirfields = new Map(gameState.airfields);
  nextAirfields.set(territoryId, { ...airfield, aircraft: addAircraft(airfield.aircraft, amount) });
  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - cost);

  return { ok: true, gameState: { ...gameState, airfields: nextAirfields, resources } };
}

/** 8-directional... no, plain graph distance on the main map: how many territory-hops from `from`
 *  to `to` (0 if the same territory), capped at `maxDistance` - returns null if farther than that
 *  (a cheap BFS, since FIGHTER_RANGE is always small). Exported for ui/GameScreen.ts's fighter
 *  sweep target list, which needs to filter down to the same reachable set fighterSweep itself
 *  validates against. */
export function territoryDistance(from: string, to: string, territories: readonly Territory[], maxDistance: number): number | null {
  if (from === to) return 0;
  const byId = new Map(territories.map((t) => [t.id, t]));
  const visited = new Set<string>([from]);
  let frontier = [from];
  for (let d = 1; d <= maxDistance; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const t = byId.get(id);
      if (!t) continue;
      for (const n of t.neighbors) {
        if (n === to) return d;
        if (!visited.has(n)) {
          visited.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/** How far a Jäger can operate from its home Flugplatz - the airfield's own territory, or any
 *  territory reachable within this many hops. */
export const FIGHTER_RANGE = 1;

/** Sums `playerId`'s Jäger stationed at every Flugplatz within FIGHTER_RANGE of `territoryId` -
 *  "können über jedes Gebiet fliegen, das 1 von ihrem Flugplatz entfernt ist". */
export function projectableFightersAt(
  gameState: GameState,
  territoryId: string,
  playerId: string,
  territories: readonly Territory[],
): number {
  let total = 0;
  for (const [airfieldTerritoryId, airfield] of gameState.airfields) {
    if (airfield.aircraft.fighters === 0) continue;
    if (gameState.territoryState.get(airfieldTerritoryId)?.ownerId !== playerId) continue;
    if (territoryDistance(airfieldTerritoryId, territoryId, territories, FIGHTER_RANGE) === null) continue;
    total += airfield.aircraft.fighters;
  }
  return total;
}

/** A side's fraction of the Jäger contest at a spot - 1 (full control) if the opponent has no
 *  fighters there at all, regardless of whether you have any either. Used both for Bomber survival
 *  (launchBomberRaid) and the in-battle Luftüberlegenheit bar (see engine/combat.ts). */
export function airSuperiorityFraction(myFighters: number, enemyFighters: number): number {
  if (enemyFighters === 0) return 1;
  return myFighters / (myFighters + enemyFighters);
}

/** How many Jäger a side (with `myFighters`, that round, against `enemyFighters`) shoots down this
 *  round - base FIGHTER_BASE_KILL_RATE per fighter, scaled up the more it outnumbers the enemy (a
 *  clean, symmetric way to reward numerical superiority: kills = rate * mine² / theirs, so doubling
 *  your own count quadruples your kills against a fixed enemy force). 0 if either side is empty. */
export const FIGHTER_BASE_KILL_RATE = 0.1;

/** Exported for engine/combat.ts's in-battle Jäger attrition (the same formula, just scoped to a
 *  single tactical battle's called-in Jäger pool instead of the whole map's background contest). */
export function fighterKills(myFighters: number, enemyFighters: number): number {
  if (myFighters === 0 || enemyFighters === 0) return 0;
  return Math.min(enemyFighters, FIGHTER_BASE_KILL_RATE * ((myFighters * myFighters) / enemyFighters));
}

/** Removes `losses` Jäger from `playerId`'s airfields within FIGHTER_RANGE of `territoryId`,
 *  largest contributing airfield first (a simple, deterministic order - which specific base a
 *  fighter was lost from doesn't matter for balance, only that the total comes down correctly). */
function removeProjectableFighters(
  gameState: GameState,
  territoryId: string,
  playerId: string,
  losses: number,
  territories: readonly Territory[],
): GameState {
  if (losses <= 0) return gameState;
  const contributing = [...gameState.airfields.entries()]
    .filter(
      ([airfieldTerritoryId, airfield]) =>
        airfield.aircraft.fighters > 0 &&
        gameState.territoryState.get(airfieldTerritoryId)?.ownerId === playerId &&
        territoryDistance(airfieldTerritoryId, territoryId, territories, FIGHTER_RANGE) !== null,
    )
    .sort(([, a], [, b]) => b.aircraft.fighters - a.aircraft.fighters);

  let remaining = Math.round(losses);
  const nextAirfields = new Map(gameState.airfields);
  for (const [airfieldTerritoryId, airfield] of contributing) {
    if (remaining <= 0) break;
    const taken = Math.min(airfield.aircraft.fighters, remaining);
    nextAirfields.set(airfieldTerritoryId, {
      ...airfield,
      aircraft: { ...airfield.aircraft, fighters: airfield.aircraft.fighters - taken },
    });
    remaining -= taken;
  }
  return { ...gameState, airfields: nextAirfields };
}

/**
 * The background Jäger contest: for every territory, every pair of at-war players with any Jäger
 * projectable there fights it out this round (see fighterKills) - both sides' losses are computed
 * from the same pre-round counts (simultaneous, not sequential) and then applied. Called once per
 * round, alongside creditIncome (see engine/turns.ts), independently of any tactical battle - this
 * is a standing background contest over contested airspace, not something tied to ground combat.
 */
export function resolveAirCombatForRound(gameState: GameState, territories: readonly Territory[]): GameState {
  let state = gameState;
  for (const territory of territories) {
    for (let i = 0; i < state.players.length; i++) {
      for (let j = i + 1; j < state.players.length; j++) {
        const a = state.players[i]!;
        const b = state.players[j]!;
        if (!areAtWar(state, a.id, b.id)) continue;

        const aFighters = projectableFightersAt(state, territory.id, a.id, territories);
        const bFighters = projectableFightersAt(state, territory.id, b.id, territories);
        if (aFighters === 0 || bFighters === 0) continue;

        const aLosses = fighterKills(bFighters, aFighters); // b's fighters kill a's
        const bLosses = fighterKills(aFighters, bFighters); // a's fighters kill b's
        state = removeProjectableFighters(state, territory.id, a.id, aLosses, territories);
        state = removeProjectableFighters(state, territory.id, b.id, bLosses, territories);
      }
    }
  }
  return state;
}

/** Removes `damage` strength-worth of units from a garrison, cheapest first (same convention as
 *  engine/combat.ts's reduceByStrength, duplicated here to avoid a combat.ts <-> airforce.ts
 *  import cycle - both files independently implement the exact same STRENGTH scale). */
function reduceGarrisonByStrength(garrison: UnitComposition, damage: number): UnitComposition {
  const STRENGTH = { infantry: 1, lightTank: 2.5, heavyTank: 5, artillery: 0 };
  let left = damage;
  const remaining = { ...garrison };
  if (left > 0) remaining.artillery = 0;

  const infantryLost = Math.min(remaining.infantry, Math.floor(left / STRENGTH.infantry));
  remaining.infantry -= infantryLost;
  left -= infantryLost * STRENGTH.infantry;

  const lightLost = Math.min(remaining.lightTank, Math.floor(left / STRENGTH.lightTank));
  remaining.lightTank -= lightLost;
  left -= lightLost * STRENGTH.lightTank;

  const heavyLost = Math.min(remaining.heavyTank, Math.floor(left / STRENGTH.heavyTank));
  remaining.heavyTank -= heavyLost;

  return remaining;
}

export const BOMBER_DAMAGE_PER_UNIT = 0.5;
/** Factories destroyed per returning Bomber in 'factories' mode - "100 Bomber = 3 Fabriken". */
export const FACTORY_DAMAGE_PER_BOMBER = 0.03;

/** What a Bomber raid's returning sortie is sent to destroy - "auswählen können, ob sie Einheiten
 *  treffen oder Fabriken zerstören sollen": 'units' hits the target's garrison (the original,
 *  still-default behavior - BOMBER_DAMAGE_PER_UNIT strength-worth of damage per returning Bomber,
 *  "100 Bomber = Schaden für 10 Schwere Panzer"), 'factories' instead destroys factories built
 *  there (FACTORY_DAMAGE_PER_BOMBER each, "100 Bomber = 3 Fabriken") - a raid can only ever do one
 *  or the other, never both in the same sortie. */
export type BomberRaidMode = 'units' | 'factories';

export type BomberRaidOutcome =
  | {
      readonly ok: true;
      readonly gameState: GameState;
      readonly bombersReturned: number;
      readonly bombersLost: number;
      readonly mode: BomberRaidMode;
      /** Strength-worth of garrison damage dealt - 0 when mode is 'factories'. */
      readonly damageDealt: number;
      /** Factories destroyed - 0 when mode is 'units'. */
      readonly factoriesDestroyed: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Sends `bomberCount` Bomber from `fromTerritoryId`'s Flugplatz at any territory on the map (no
 * range limit, unlike Jäger) - resolves instantly, no tactical sub-map involved. How many come
 * back is exactly the attacker's Jäger-projected air superiority fraction at the target (see
 * airSuperiorityFraction) - "100 unserer Jäger zu 100 feindlichen macht 50%, also kommen von 100
 * Bombern nur 50 zurück". Only the returning survivors are assumed to have actually broken through
 * to drop their payload - see BomberRaidMode for what that payload hits.
 */
export function launchBomberRaid(
  gameState: GameState,
  playerId: string,
  fromTerritoryId: string,
  targetTerritoryId: string,
  bomberCount: number,
  mode: BomberRaidMode,
  territories: readonly Territory[],
): BomberRaidOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  if (bomberCount <= 0) return { ok: false, reason: 'Keine Bomber ausgewählt.' };
  if (fromTerritoryId === targetTerritoryId) return { ok: false, reason: 'Ziel muss ein anderes Gebiet sein.' };

  const fromState = gameState.territoryState.get(fromTerritoryId);
  if (!fromState || fromState.ownerId !== playerId) return { ok: false, reason: 'Das Startgebiet gehört dir nicht.' };
  const airfield = airfieldAt(gameState, fromTerritoryId);
  if (bomberCount > airfield.aircraft.bombers) {
    return { ok: false, reason: 'Nicht genug verfügbare Bomber auf diesem Flugplatz.' };
  }

  const targetState = gameState.territoryState.get(targetTerritoryId);
  if (!targetState) return { ok: false, reason: `Unbekanntes Gebiet "${targetTerritoryId}".` };
  if (targetState.ownerId === null) return { ok: false, reason: 'Unbesetztes Gebiet - hier gibt es nichts zu bombardieren.' };
  if (targetState.ownerId === playerId) return { ok: false, reason: 'Kann kein eigenes Gebiet bombardieren.' };
  if (!areAtWar(gameState, playerId, targetState.ownerId)) {
    return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor bombardiert werden kann.' };
  }
  const targetDevelopment = developmentAt(gameState, targetTerritoryId);
  if (mode === 'factories' && targetDevelopment.factories === 0) {
    return { ok: false, reason: 'Hier gibt es keine Fabriken zu zerstören.' };
  }

  const myFighters = projectableFightersAt(gameState, targetTerritoryId, playerId, territories);
  const enemyFighters = projectableFightersAt(gameState, targetTerritoryId, targetState.ownerId, territories);
  const fraction = airSuperiorityFraction(myFighters, enemyFighters);
  const bombersReturned = Math.round(bomberCount * fraction);
  const bombersLost = bomberCount - bombersReturned;

  // The sortie's survivors fly straight back to the same Flugplatz - only the lost ones (shot down
  // over the target) actually leave the roster, not the whole bomberCount that set out.
  const nextAirfields = new Map(gameState.airfields);
  nextAirfields.set(fromTerritoryId, {
    ...airfield,
    aircraft: { ...airfield.aircraft, bombers: airfield.aircraft.bombers - bombersLost },
  });

  if (mode === 'factories') {
    // Whole factories, not a damage pool - Math.round (not floor) so a raid nowhere near the
    // 100-bomber/3-factory ratio still rounds to the nearer outcome. Same floor-to-zero guarantee
    // as the 'units' branch below: any sortie that actually got through takes out at least 1,
    // capped at however many are actually there to destroy.
    const factoriesDestroyed =
      bombersReturned > 0 ? Math.min(targetDevelopment.factories, Math.max(1, Math.round(bombersReturned * FACTORY_DAMAGE_PER_BOMBER))) : 0;
    const nextDevelopment = new Map(gameState.development);
    nextDevelopment.set(targetTerritoryId, { ...targetDevelopment, factories: targetDevelopment.factories - factoriesDestroyed });
    return {
      ok: true,
      gameState: { ...gameState, airfields: nextAirfields, development: nextDevelopment },
      bombersReturned,
      bombersLost,
      mode,
      damageDealt: 0,
      factoriesDestroyed,
    };
  }

  // Same floor-to-zero issue as engine/combat.ts's casStrike: at 0.5 strength/unit, fewer than 2
  // returning bombers would otherwise always round down to no effect at all. Guarantee at least 1
  // full strength point whenever any bomber actually made it through.
  const damageDealt = bombersReturned > 0 ? Math.max(1, bombersReturned * BOMBER_DAMAGE_PER_UNIT) : 0;
  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(targetTerritoryId, {
    ...targetState,
    garrison: reduceGarrisonByStrength(targetState.garrison, damageDealt),
  });

  return {
    ok: true,
    gameState: { ...gameState, airfields: nextAirfields, territoryState: nextTerritoryState },
    bombersReturned,
    bombersLost,
    mode,
    damageDealt,
    factoriesDestroyed: 0,
  };
}

export type FighterSweepOutcome =
  | {
      readonly ok: true;
      readonly gameState: GameState;
      readonly myLosses: number;
      readonly enemyLosses: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Sends `fighterCount` Jäger from `fromTerritoryId`'s Flugplatz to fight an immediate, on-demand
 * air-to-air engagement over `targetTerritoryId` - "Jäger müssen bewegbar sein, um dort Ziele
 * anzugreifen, ohne eine Schlacht zu starten". Resolves instantly, no tactical sub-map involved,
 * same as launchBomberRaid - it's a player-initiated version of resolveAirCombatForRound's
 * per-round background contest (same fighterKills formula), scoped to this one engagement, letting
 * a player choose exactly when and with how large a force to clear the skies over a target (e.g.
 * right before a Bomber raid or an invasion) instead of only ever reacting to the passive per-round
 * tick. Limited to FIGHTER_RANGE hops from the launching Flugplatz, same as every other Jäger
 * action - unlike Bomber, which has no range limit. The sent Jäger's own losses come directly off
 * `fromTerritoryId`'s roster (the specific batch the player chose to risk); the enemy's losses are
 * spread across their contributing Flugplätze the same way the background contest already does
 * (see removeProjectableFighters) - it isn't a raid against one specific enemy airfield, but
 * against their whole projectable presence at the target.
 */
export function fighterSweep(
  gameState: GameState,
  playerId: string,
  fromTerritoryId: string,
  targetTerritoryId: string,
  fighterCount: number,
  territories: readonly Territory[],
): FighterSweepOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  if (fighterCount <= 0) return { ok: false, reason: 'Keine Jäger ausgewählt.' };
  if (fromTerritoryId === targetTerritoryId) return { ok: false, reason: 'Ziel muss ein anderes Gebiet sein.' };

  const fromState = gameState.territoryState.get(fromTerritoryId);
  if (!fromState || fromState.ownerId !== playerId) return { ok: false, reason: 'Das Startgebiet gehört dir nicht.' };
  const airfield = airfieldAt(gameState, fromTerritoryId);
  if (fighterCount > airfield.aircraft.fighters) {
    return { ok: false, reason: 'Nicht genug verfügbare Jäger auf diesem Flugplatz.' };
  }

  const targetState = gameState.territoryState.get(targetTerritoryId);
  if (!targetState) return { ok: false, reason: `Unbekanntes Gebiet "${targetTerritoryId}".` };
  if (targetState.ownerId === null) return { ok: false, reason: 'Unbesetztes Gebiet - hier gibt es nichts anzugreifen.' };
  if (targetState.ownerId === playerId) return { ok: false, reason: 'Kann kein eigenes Gebiet angreifen.' };
  if (!areAtWar(gameState, playerId, targetState.ownerId)) {
    return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor angegriffen werden kann.' };
  }
  if (territoryDistance(fromTerritoryId, targetTerritoryId, territories, FIGHTER_RANGE) === null) {
    return { ok: false, reason: 'Ziel liegt außerhalb der Reichweite der Jäger.' };
  }

  const enemyFighters = projectableFightersAt(gameState, targetTerritoryId, targetState.ownerId, territories);
  const myLosses = Math.round(fighterKills(enemyFighters, fighterCount));
  const enemyLosses = Math.round(fighterKills(fighterCount, enemyFighters));

  const nextAirfields = new Map(gameState.airfields);
  nextAirfields.set(fromTerritoryId, {
    ...airfield,
    aircraft: { ...airfield.aircraft, fighters: airfield.aircraft.fighters - myLosses },
  });

  const withMyLosses = { ...gameState, airfields: nextAirfields };
  const finalState = removeProjectableFighters(withMyLosses, targetTerritoryId, targetState.ownerId, enemyLosses, territories);

  return { ok: true, gameState: finalState, myLosses, enemyLosses };
}
