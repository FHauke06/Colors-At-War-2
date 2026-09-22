import type { AiDifficulty, AiSlot, GameState, LobbySlot, LobbyState, Player, ResearchState, Territory, TerritoryState, UnitComposition } from './types';
import { MIN_FACTIONS } from './palette';
import { emptyDiplomacyState } from './diplomacy';
import { fullResearchState } from './research';
import type { Scenario } from '../data/Scenarios/types';

const STARTING_GARRISON: UnitComposition = { infantry: 10, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };
const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

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
      extraMoveUsed: EMPTY_GARRISON,
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

/** Builds an already-fully-assigned LobbyState for a scenario (see data/Scenarios) - the human
 *  plays `scenario.factions[humanFactionIndex]`, every other faction becomes an AI seat. Every
 *  slot's capitalId is set straight from the scenario, so canStart() is true immediately - a
 *  scenario game skips the normal click-a-territory-to-claim-a-capital lobby step entirely (see
 *  ui/SetupScreen.ts's renderScenarioConfig). */
export function lobbyFromScenario(
  scenario: Scenario,
  humanFactionIndex: number,
  humanPlayerId: string,
  humanName: string,
  aiDifficulty: AiDifficulty,
): LobbyState {
  const human = scenario.factions[humanFactionIndex];
  if (!human) throw new Error(`scenario "${scenario.id}" has no faction at index ${humanFactionIndex}`);

  const slots: LobbySlot[] = [
    { playerId: humanPlayerId, name: humanName, color: human.color, capitalId: human.capitalId, isHost: true },
  ];
  const aiSlots: AiSlot[] = scenario.factions
    .map((faction, i) => ({ faction, i }))
    .filter(({ i }) => i !== humanFactionIndex)
    .map(({ faction, i }): AiSlot => ({
      id: `scenario-ai-${i}`,
      name: faction.name,
      color: faction.color,
      capitalId: faction.capitalId,
    }));

  return { code: 'SZENARIO', mapId: scenario.mapId, maxHumans: 1, slots, aiSlots, status: 'lobby', aiDifficulty };
}

/** Turns a scenario-derived lobby (see lobbyFromScenario) into its full pre-populated GameState:
 *  every territory the scenario lists gets that faction's exact garrison and every faction starts
 *  with its scenario-defined Rüstungspunkte, instead of the normal "one empty capital each with a
 *  flat starting garrison" (see buildGameStateFromLobby). Territories the scenario doesn't mention
 *  stay neutral/unowned, same as any territory outside a normal game's starting capitals. */
export function buildGameStateFromScenario(scenario: Scenario, lobby: LobbyState, territories: readonly Territory[]): GameState {
  // Each lobby participant's capitalId came straight from a scenario faction (see
  // lobbyFromScenario) and every faction's capitalId is unique, so this reliably maps back.
  const factionByCapital = new Map(scenario.factions.map((f) => [f.capitalId, f]));

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
      aiTechAffinity: Math.random(),
      aiDifficulty: lobby.aiDifficulty,
    })),
  ];

  const territoryState = new Map<string, TerritoryState>();
  for (const territory of territories) {
    territoryState.set(territory.id, { ownerId: null, garrison: EMPTY_GARRISON, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON });
  }

  const resources = new Map<string, number>();
  for (const player of players) {
    const faction = factionByCapital.get(player.capitalId);
    if (!faction) throw new Error(`no scenario faction found for capital "${player.capitalId}"`);
    resources.set(player.id, faction.resources);
    for (const st of faction.territories) {
      territoryState.set(st.territoryId, { ownerId: player.id, garrison: st.garrison, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON });
    }
  }

  const research = new Map<string, ResearchState>(
    players.filter((p) => p.isAI).map((p): [string, ResearchState] => [p.id, fullResearchState()]),
  );

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
