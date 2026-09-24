import type { GameState, PlayerStats, UnitComposition } from './types';
import { playerForce, totalUnits } from './movement';

/** Live snapshot (not cumulative, unlike PlayerStats) of a player's current troop count across
 *  every territory they hold right now, plus whatever they have stationed on an ally's - for the
 *  end-of-game stats screen's "Truppen" column. */
export function totalTroopsFor(gameState: GameState, playerId: string): number {
  return totalUnits(playerForce(gameState, playerId));
}

/** Live snapshot of a player's current factory count across every territory they hold right now -
 *  for the end-of-game stats screen's "Fabriken" column. */
export function totalFactoriesFor(gameState: GameState, playerId: string): number {
  let total = 0;
  for (const [territoryId, state] of gameState.territoryState) {
    if (state.ownerId !== playerId) continue;
    total += gameState.development.get(territoryId)?.factories ?? 0;
  }
  return total;
}

const EMPTY_STATS: PlayerStats = { battlesWon: 0, territoriesConquered: 0, unitsDefeated: 0, unitsLost: 0 };

export function statsFor(gameState: GameState, playerId: string): PlayerStats {
  return gameState.stats.get(playerId) ?? EMPTY_STATS;
}

/** Adds `delta` (any subset of fields) onto `playerId`'s running totals. Stats only ever
 *  accumulate over the course of the game - there's no "undo". */
export function addToPlayerStats(gameState: GameState, playerId: string, delta: Partial<PlayerStats>): GameState {
  const current = statsFor(gameState, playerId);
  const next = new Map(gameState.stats);
  next.set(playerId, {
    battlesWon: current.battlesWon + (delta.battlesWon ?? 0),
    territoriesConquered: current.territoriesConquered + (delta.territoriesConquered ?? 0),
    unitsDefeated: current.unitsDefeated + (delta.unitsDefeated ?? 0),
    unitsLost: current.unitsLost + (delta.unitsLost ?? 0),
  });
  return { ...gameState, stats: next };
}

/**
 * Records one concluded engagement's outcome for both sides at once - shared by
 * engine/combat.ts's simulateAttack and applyConclusion, the two places a fight actually
 * resolves. `winnerStarting`/`winnerSurviving` and `loserStarting`/`loserRetained` are each
 * side's committed force and what it has left afterward (loserRetained being 0 for a wipeout, or
 * whatever successfully retreated - see applyConclusion's retreatableCellIds). The winner always
 * gets credit for the fight (battlesWon); territoriesConquered only goes to the winner when it's
 * the attacker (a successful defense keeps ground that was already theirs, not "conquered").
 */
export function recordBattleOutcome(
  gameState: GameState,
  params: {
    readonly winnerId: string;
    readonly loserId: string;
    readonly attackerWon: boolean;
    readonly winnerStarting: UnitComposition;
    readonly winnerSurviving: UnitComposition;
    readonly loserStarting: UnitComposition;
    readonly loserRetained: UnitComposition;
  },
): GameState {
  const { winnerId, loserId, attackerWon, winnerStarting, winnerSurviving, loserStarting, loserRetained } = params;
  const winnerLosses = totalUnits(winnerStarting) - totalUnits(winnerSurviving);
  const loserLosses = totalUnits(loserStarting) - totalUnits(loserRetained);

  let state = addToPlayerStats(gameState, winnerId, {
    battlesWon: 1,
    territoriesConquered: attackerWon ? 1 : 0,
    unitsLost: winnerLosses,
    unitsDefeated: loserLosses,
  });
  state = addToPlayerStats(state, loserId, {
    unitsLost: loserLosses,
    unitsDefeated: winnerLosses,
  });
  return state;
}
