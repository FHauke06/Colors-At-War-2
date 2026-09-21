import type { GameState, LobbyState, Player, ResearchState, Territory, TerritoryState, UnitComposition } from './types';
import { MIN_FACTIONS } from './palette';
import { emptyDiplomacyState } from './diplomacy';
import { fullResearchState } from './research';

const STARTING_GARRISON: UnitComposition = { infantry: 10, lightTank: 0, heavyTank: 0, artillery: 0 };
const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0 };

/** Picks `count` random territories (excluding any in `alreadyPicked`) - used to give AI seats
 *  a capital. Each call reshuffles, so repeated single picks (as `addAi` does) are independent. */
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

  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j]!, remaining[i]!];
  }
  return remaining.slice(0, count);
}

/** Turns a finished lobby (every human slot has a capital, AI seats already have theirs)
 *  into the game's initial state. */
export function buildGameStateFromLobby(lobby: LobbyState, territories: readonly Territory[]): GameState {
  if (lobby.slots.some((s) => s.capitalId === null)) {
    throw new Error('cannot start: not every player has picked a capital');
  }
  if (lobby.slots.length + lobby.aiSlots.length < MIN_FACTIONS) {
    throw new Error(`need at least ${MIN_FACTIONS} factions to start`);
  }

  const players: Player[] = [
    ...lobby.slots.map((slot): Player => ({
      id: slot.playerId,
      name: slot.name,
      color: slot.color,
      capitalId: slot.capitalId!,
      isAI: false,
    })),
    ...lobby.aiSlots.map((ai): Player => ({
      id: ai.id,
      name: ai.name,
      color: ai.color,
      capitalId: ai.capitalId,
      isAI: true,
      // Each AI seat's one-time personality roll - see Player.aiTechAffinity.
      aiTechAffinity: Math.random(),
      // The lobby-wide difficulty chosen when this lobby was created - see Player.aiDifficulty.
      aiDifficulty: lobby.aiDifficulty,
    })),
  ];

  const territoryState = new Map<string, TerritoryState>();
  for (const territory of territories) {
    const owner = players.find((p) => p.capitalId === territory.id) ?? null;
    territoryState.set(territory.id, {
      ownerId: owner?.id ?? null,
      garrison: owner ? STARTING_GARRISON : EMPTY_GARRISON,
      movedIn: EMPTY_GARRISON,
    });
  }

  const resources = new Map(players.map((p): [string, number] => [p.id, 0]));

  // Human seats start with only Infanterie unlocked (see engine/research.ts's Research tab) - AI
  // seats get every tech unlocked immediately instead, so they keep their full existing tactical
  // repertoire without ever having to spend points researching it themselves.
  const research = new Map<string, ResearchState>(
    players.filter((p) => p.isAI).map((p): [string, ResearchState] => [p.id, fullResearchState()]),
  );

  // The host (always the first slot, always human) goes first.
  return {
    turn: 1,
    activePlayerId: players[0]!.id,
    players,
    territoryState,
    resources,
    development: new Map(),
    diplomacy: emptyDiplomacyState(),
    stats: new Map(),
    airfields: new Map(),
    research,
    pendingBattle: null,
  };
}
