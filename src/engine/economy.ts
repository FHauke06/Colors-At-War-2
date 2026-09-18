import type { GameState, UnitComposition } from './types';
import { addGarrisons, totalUnits } from './movement';
import { TERRITORY_RESOURCES, DEFAULT_TERRITORY_RESOURCE } from '../data/territoryResources';

/** Cost in Rüstungspunkte per unit - scaled from the 5:2:1 Infanterie:Leichter-Panzer:Schwerer-
 *  Panzer Stärkeverhältnis (Stärke 1 : 2.5 : 5), doubled to keep costs whole numbers. */
export const UNIT_COSTS: UnitComposition = { infantry: 2, lightTank: 5, heavyTank: 10 };

export function costOf(amount: UnitComposition): number {
  return (
    amount.infantry * UNIT_COSTS.infantry +
    amount.lightTank * UNIT_COSTS.lightTank +
    amount.heavyTank * UNIT_COSTS.heavyTank
  );
}

export function resourceValue(territoryId: string): number {
  return TERRITORY_RESOURCES[territoryId] ?? DEFAULT_TERRITORY_RESOURCE;
}

function territoryIncome(gameState: GameState, playerId: string): number {
  let income = 0;
  for (const [territoryId, state] of gameState.territoryState) {
    if (state.ownerId === playerId) income += resourceValue(territoryId);
  }
  return income;
}

/**
 * Pays every player income for the round that just completed: each territory they hold gives
 * its own Rüstungspunkte-Wert (see data/territoryResources.ts - based on real GDP, not a flat
 * rate per territory). Called once per round, at the moment play wraps back to the first seat -
 * so there's no income (and nothing to recruit with) until round 2.
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
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const state = gameState.territoryState.get(territoryId);
  if (!state || state.ownerId !== playerId) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  if (totalUnits(amount) === 0) return { ok: false, reason: 'Keine Einheiten ausgewählt.' };

  const cost = costOf(amount);
  const balance = gameState.resources.get(playerId) ?? 0;
  if (cost > balance) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const nextTerritoryState = new Map(gameState.territoryState);
  nextTerritoryState.set(territoryId, {
    ownerId: playerId,
    garrison: addGarrisons(state.garrison, amount),
    movedIn: addGarrisons(state.movedIn, amount),
  });

  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - cost);

  return { ok: true, gameState: { ...gameState, territoryState: nextTerritoryState, resources } };
}
