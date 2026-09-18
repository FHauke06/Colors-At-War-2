import type { GameState, LobbyState, Player, Territory, TerritoryState, UnitComposition } from './types';
import { FACTION_COLORS } from './palette';

const STARTING_GARRISON: UnitComposition = { infantry: 10, lightTank: 0, heavyTank: 0 };
const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0 };

function distance(a: readonly number[], b: readonly number[]): number {
  const dx = (a[0] ?? 0) - (b[0] ?? 0);
  const dy = (a[1] ?? 0) - (b[1] ?? 0);
  return Math.hypot(dx, dy);
}

/**
 * Greedy farthest-point sampling: repeatedly add whichever remaining territory maximizes its
 * minimum distance to the capitals already picked, so factions start spread out instead of
 * clustered. With no `alreadyPicked`, the first pick is the territory closest to the map's
 * centroid; otherwise it continues from the given (e.g. human-chosen) capitals.
 */
export function pickCapitals(
  territories: readonly Territory[],
  count: number,
  alreadyPicked: readonly Territory[] = [],
): Territory[] {
  const takenIds = new Set(alreadyPicked.map((t) => t.id));
  const remaining = territories.filter((t) => !takenIds.has(t.id));
  if (count > remaining.length) {
    throw new Error(`cannot pick ${count} more capitals from ${remaining.length} remaining territories`);
  }

  const picked: Territory[] = [...alreadyPicked];

  if (picked.length === 0) {
    let sumX = 0;
    let sumY = 0;
    for (const t of territories) {
      sumX += t.centroid[0] ?? 0;
      sumY += t.centroid[1] ?? 0;
    }
    const meanCentroid = [sumX / territories.length, sumY / territories.length];

    let firstIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((t, i) => {
      const d = distance(t.centroid, meanCentroid);
      if (d < bestDist) { bestDist = d; firstIdx = i; }
    });
    picked.push(remaining.splice(firstIdx, 1)[0]!);
  }

  while (picked.length < alreadyPicked.length + count) {
    let bestIdx = 0;
    let bestMinDist = -Infinity;
    remaining.forEach((candidate, i) => {
      const minDist = Math.min(...picked.map((p) => distance(p.centroid, candidate.centroid)));
      if (minDist > bestMinDist) { bestMinDist = minDist; bestIdx = i; }
    });
    picked.push(remaining.splice(bestIdx, 1)[0]!);
  }

  return picked.slice(alreadyPicked.length);
}

/** Turns a finished lobby (every human slot has a capital) into the game's initial state,
 *  filling any seats the lobby didn't use with AI players. */
export function buildGameStateFromLobby(lobby: LobbyState, territories: readonly Territory[]): GameState {
  const incomplete = lobby.slots.some((s) => s.capitalId === null);
  if (incomplete) throw new Error('cannot start: not every player has picked a capital');

  const humanTerritories = lobby.slots.map(
    (s) => territories.find((t) => t.id === s.capitalId)!,
  );
  const aiCount = lobby.factionCount - lobby.slots.length;
  const aiCapitals = aiCount > 0 ? pickCapitals(territories, aiCount, humanTerritories) : [];

  const players: Player[] = [
    ...lobby.slots.map((slot): Player => ({
      id: slot.playerId,
      name: slot.name,
      color: slot.color,
      capitalId: slot.capitalId!,
      isAI: false,
    })),
    ...aiCapitals.map((capital, i): Player => ({
      id: `ai-${i + 1}`,
      name: `KI ${i + 1}`,
      color: FACTION_COLORS[lobby.slots.length + i]!,
      capitalId: capital.id,
      isAI: true,
    })),
  ];

  const territoryState = new Map<string, TerritoryState>();
  for (const territory of territories) {
    const owner = players.find((p) => p.capitalId === territory.id) ?? null;
    territoryState.set(territory.id, {
      ownerId: owner?.id ?? null,
      garrison: owner ? STARTING_GARRISON : EMPTY_GARRISON,
    });
  }

  return { turn: 1, players, territoryState };
}
