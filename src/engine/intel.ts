import type { GameState } from './types';
import { playerForce, totalUnits } from './movement';
import { developmentAt } from './economy';
import { totalAircraft } from './airforce';
import { areAllied } from './diplomacy';

/** How far off one side of an estimate can randomly land - "zufällig zwischen 5% und 25% unter/
 *  über dem tatsächlichen Wert". */
const ESTIMATE_MIN_ERROR = 0.05;
const ESTIMATE_MAX_ERROR = 0.25;

function randomErrorFraction(): number {
  return ESTIMATE_MIN_ERROR + Math.random() * (ESTIMATE_MAX_ERROR - ESTIMATE_MIN_ERROR);
}

export interface EstimateRange {
  readonly low: number;
  readonly high: number;
}

/** One [low, high] estimate for a true value - two *independent* rolls, one per side, rather than
 *  a single jittered point mirrored both ways - "bei 10 Einheiten sieht der Nutzer z.B. 8-11": a
 *  20% undershoot paired with a 10% overshoot, not a matching +/-15% on both sides. `low` is
 *  clamped at 0 (never negative) and `high` is clamped to at least `low` (a target with 0 of
 *  something always shows "0-0", never an inverted range). */
function estimateRange(trueValue: number): EstimateRange {
  const low = Math.max(0, Math.round(trueValue * (1 - randomErrorFraction())));
  const high = Math.max(low, Math.round(trueValue * (1 + randomErrorFraction())));
  return { low, high };
}

export interface ForceEstimate {
  /** All 4 UnitComposition types summed into one figure - "Einheiten werden zusammen gruppiert
   *  und nicht in Art unterschieden". */
  readonly units: EstimateRange;
  readonly factories: EstimateRange;
  /** All 3 AirComposition types summed into one figure, same grouping rule as units. */
  readonly airforce: EstimateRange;
}

/**
 * A fuzzy, spy-report-style estimate of `targetPlayerId`'s true total military strength - "eine
 * Schätzung, wie viele Einheiten der Gegner hat" - grouped rather than broken down by type, and
 * randomized independently per category and per side of the range, freshly, every time this is
 * called. Deliberately computed from the true, unfiltered GameState (unlike everything else a
 * client normally sees, which is fogged by engine/visibility.ts) - an estimate of hidden strength
 * is the whole point. Callers (see net/GameClient.ts's estimateEnemyForces) must only ever expose
 * the resulting fuzzy range to a player, never this function's authoritative input.
 *
 * When `viewerId` is allied with the target there's nothing to estimate: allies see each other's
 * units outright (see engine/visibility.ts), so the report is exact (low === high) instead.
 */
export function estimateForces(gameState: GameState, targetPlayerId: string, viewerId?: string): ForceEstimate {
  const exact = viewerId !== undefined && areAllied(gameState, viewerId, targetPlayerId);
  // Troops stationed on an ally's ground count too, not just the garrisons at home.
  const units = totalUnits(playerForce(gameState, targetPlayerId));
  let factories = 0;
  let airforce = 0;

  for (const [territoryId, state] of gameState.territoryState) {
    if (state.ownerId !== targetPlayerId) continue;
    factories += developmentAt(gameState, territoryId).factories;
  }
  for (const [territoryId, airfield] of gameState.airfields) {
    if (gameState.territoryState.get(territoryId)?.ownerId !== targetPlayerId) continue;
    airforce += totalAircraft(airfield.aircraft);
  }

  const range = (trueValue: number): EstimateRange => (exact ? { low: trueValue, high: trueValue } : estimateRange(trueValue));
  return {
    units: range(units),
    factories: range(factories),
    airforce: range(airforce),
  };
}
