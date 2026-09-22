import type { GameState, TerritoryDevelopment, UnitComposition } from './types';
import { addGarrisons, totalUnits } from './movement';
import { isGroundUnlocked, isSupportUnlocked } from './research';

const UNIT_LABEL: Record<keyof UnitComposition, string> = {
  infantry: 'Infanterie',
  lightTank: 'Leichte Panzer',
  heavyTank: 'Schwere Panzer',
  artillery: 'Artillerie',
  motorizedInfantry: 'Motorisierte Infanterie',
};

/** Cost in Rüstungspunkte per unit - scaled from the 5:2:1 Infanterie:Leichter-Panzer:Schwerer-
 *  Panzer Stärkeverhältnis (Stärke 1 : 2.5 : 5), doubled to keep costs whole numbers. Artillery
 *  costs the same as a light tank - it carries no ordinary battle strength at all, its value is
 *  entirely in the ranged bombardment action (see engine/combat.ts's bombardBattleCell).
 *  Motorisierte Infanterie costs double plain Infanterie for the same combat strength - its value
 *  is entirely in mobility (see UnitComposition's doc comment). */
export const UNIT_COSTS: UnitComposition = { infantry: 2, lightTank: 5, heavyTank: 10, artillery: 5, motorizedInfantry: 4 };

export function costOf(amount: UnitComposition): number {
  return (
    amount.infantry * UNIT_COSTS.infantry +
    amount.lightTank * UNIT_COSTS.lightTank +
    amount.heavyTank * UNIT_COSTS.heavyTank +
    amount.artillery * UNIT_COSTS.artillery +
    amount.motorizedInfantry * UNIT_COSTS.motorizedInfantry
  );
}

/** Every territory yields this per round just by being held... */
export const DEFAULT_BASE_VALUE = 1;
/** ...except a capital (anyone's - a fixed geographic designation, not tied to who currently
 *  owns it), which yields more even completely undeveloped. */
export const CAPITAL_BASE_VALUE = 5;

export const FACTORY_COST = 5;
/** How many factories a territory can hold with no infrastructure investment. */
export const BASE_FACTORY_CAPACITY = 6;
export const INFRASTRUCTURE_COST = 3;
export const MAX_INFRASTRUCTURE_LEVEL = 5;

const EMPTY_DEVELOPMENT: TerritoryDevelopment = { factories: 0, infrastructureLevel: 0 };

export function developmentAt(gameState: GameState, territoryId: string): TerritoryDevelopment {
  return gameState.development.get(territoryId) ?? EMPTY_DEVELOPMENT;
}

export function factoryCapacity(development: TerritoryDevelopment): number {
  return BASE_FACTORY_CAPACITY + development.infrastructureLevel;
}

function isCapital(gameState: GameState, territoryId: string): boolean {
  return gameState.players.some((p) => p.capitalId === territoryId);
}

/** A territory's Rüstungspunkte yield per round: base value (see DEFAULT_BASE_VALUE /
 *  CAPITAL_BASE_VALUE) plus 1 per factory built there. */
export function resourceValue(gameState: GameState, territoryId: string): number {
  const base = isCapital(gameState, territoryId) ? CAPITAL_BASE_VALUE : DEFAULT_BASE_VALUE;
  return base + developmentAt(gameState, territoryId).factories;
}

function territoryIncome(gameState: GameState, playerId: string): number {
  let income = 0;
  for (const [territoryId, state] of gameState.territoryState) {
    if (state.ownerId === playerId) income += resourceValue(gameState, territoryId);
  }
  return income;
}

/**
 * Pays every player income for the round that just completed: each territory they hold gives
 * its own Rüstungspunkte-Wert (base value plus factories, see resourceValue). Called once per
 * round, at the moment play wraps back to the first seat - so there's no income (and nothing to
 * recruit or build with) until round 2.
 */
export function creditIncome(gameState: GameState): GameState {
  const resources = new Map(gameState.resources);
  for (const player of gameState.players) {
    const income = territoryIncome(gameState, player.id);
    resources.set(player.id, (resources.get(player.id) ?? 0) + income);
  }
  return { ...gameState, resources };
}

export type RecruitOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/**
 * Spends Rüstungspunkte to add freshly-built units to an owned territory. Like a move, the new
 * units count as having already acted this round - they can't be sent anywhere until the round
 * resets, matching how a unit may only move once per round.
 */
export function recruitUnits(
  gameState: GameState,
  playerId: string,
  territoryId: string,
  amount: UnitComposition,
): RecruitOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const state = gameState.territoryState.get(territoryId);
  if (!state || state.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  if (totalUnits(amount) === 0) return { ok: false, reason: 'Keine Einheiten ausgewählt.' };

  for (const type of ['lightTank', 'heavyTank', 'motorizedInfantry'] as const) {
    if (amount[type] > 0 && !isGroundUnlocked(gameState, playerId, type)) {
      return { ok: false, reason: `${UNIT_LABEL[type]} noch nicht erforscht.` };
    }
  }
  if (amount.artillery > 0 && !isSupportUnlocked(gameState, playerId, 'artillery')) {
    return { ok: false, reason: `${UNIT_LABEL.artillery} noch nicht erforscht.` };
  }

  const cost = costOf(amount);
  const balance = gameState.resources.get(playerId) ?? 0;
  if (cost > balance) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(territoryId, {
    ownerId: playerId,
    garrison: addGarrisons(state.garrison, amount),
    movedIn: addGarrisons(state.movedIn, amount),
    extraMoveUsed: state.extraMoveUsed,
  });

  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - cost);

  return { ok: true, gameState: { ...gameState, territoryState: nextTerritoryState, resources } };
}

export type DevelopOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

/** Spends FACTORY_COST to add one factory at an owned territory, raising its Rüstungspunkte
 *  yield by 1/round - capped at BASE_FACTORY_CAPACITY plus the territory's infrastructure level. */
export function buildFactory(gameState: GameState, playerId: string, territoryId: string): DevelopOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const state = gameState.territoryState.get(territoryId);
  if (!state || state.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };

  const development = developmentAt(gameState, territoryId);
  if (development.factories >= factoryCapacity(development)) {
    return { ok: false, reason: 'Maximale Fabrikanzahl für dieses Gebiet erreicht - baue zuerst Infrastruktur aus.' };
  }

  const balance = gameState.resources.get(playerId) ?? 0;
  if (balance < FACTORY_COST) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const nextDevelopment = new Map(gameState.development);
  nextDevelopment.set(territoryId, { ...development, factories: development.factories + 1 });
  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - FACTORY_COST);

  return { ok: true, gameState: { ...gameState, development: nextDevelopment, resources } };
}

/** Spends INFRASTRUCTURE_COST to raise a territory's infrastructure level by 1 (max
 *  MAX_INFRASTRUCTURE_LEVEL), each level raising its factory capacity by 1. */
export function upgradeInfrastructure(gameState: GameState, playerId: string, territoryId: string): DevelopOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const state = gameState.territoryState.get(territoryId);
  if (!state || state.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };

  const development = developmentAt(gameState, territoryId);
  if (development.infrastructureLevel >= MAX_INFRASTRUCTURE_LEVEL) {
    return { ok: false, reason: 'Maximale Infrastrukturstufe für dieses Gebiet erreicht.' };
  }

  const balance = gameState.resources.get(playerId) ?? 0;
  if (balance < INFRASTRUCTURE_COST) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const nextDevelopment = new Map(gameState.development);
  nextDevelopment.set(territoryId, { ...development, infrastructureLevel: development.infrastructureLevel + 1 });
  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - INFRASTRUCTURE_COST);

  return { ok: true, gameState: { ...gameState, development: nextDevelopment, resources } };
}
