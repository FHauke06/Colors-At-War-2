import type { AiDifficulty, AiSlot, GameState, LobbySlot, LobbyState, Player, ResearchState, Territory, TerritoryState, UnitComposition } from './types';
import { MIN_FACTIONS } from './palette';
import { emptyDiplomacyState, pairKey, propagateAllianceWars } from './diplomacy';
import { fullResearchState } from './research';
import type { Scenario } from '../data/Scenarios/types';
import { scenarioById } from '../data/Scenarios';

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
  // Szenario-Lobby (LobbyState.scenarioId): derselbe Weg wie beim Offline-Szenario - Startgebiete, Garnisonen,
  // Rüstungspunkte, Krieg/Pakte/Allianzen und researchState kommen aus dem Szenario (buildGameStateFromScenario).
  if (lobby.scenarioId) {
    const scenario = scenarioById(lobby.scenarioId);
    if (!scenario) throw new Error(`unknown scenario "${lobby.scenarioId}"`);
    if (lobby.slots.some((s) => s.capitalId === null)) throw new Error('cannot start: not every player has picked a faction');
    return buildGameStateFromScenario(scenario, finalizeScenarioLobby(lobby), territories);
  }
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
    nukeStockpiles: new Map(),
    pendingBattle: null,
    seaZones: new Map(),
    pendingSeaBattle: null,
  };
}

/**
 * Macht aus einer Szenario-Lobby (LobbyState.scenarioId) eine vollständige: jede Fraktion, die kein Mensch gewählt hat
 * (Human-Slots wählen eine Fraktion über ihre capitalId), wird ein KI-Sitz mit Namen/Farbe/Hauptstadt der Fraktion, und
 * die gewählten Fraktionen geben ihre Farbe an den Menschen. Reine Funktion - dient dem Start (buildGameStateFromLobby),
 * der Startbedingung (session.ts's canStart) und der Vorschau in der Lobby (SetupScreen).
 */
export function finalizeScenarioLobby(lobby: LobbyState): LobbyState {
  const scenario = lobby.scenarioId ? scenarioById(lobby.scenarioId) : undefined;
  if (!scenario) throw new Error(`unknown scenario "${lobby.scenarioId}"`);
  const byCapital = new Map(scenario.factions.map((f) => [f.capitalId, f]));
  const slots = lobby.slots.map((slot) => {
    const faction = slot.capitalId ? byCapital.get(slot.capitalId) : undefined;
    return faction ? { ...slot, color: faction.color } : slot;
  });
  const claimed = new Set(lobby.slots.map((s) => s.capitalId).filter((id): id is string => id !== null));
  const aiSlots: AiSlot[] = scenario.factions
    .map((faction, i) => ({ faction, i }))
    .filter(({ faction }) => !claimed.has(faction.capitalId))
    .map(({ faction, i }): AiSlot => ({ id: `scenario-ai-${i}`, name: faction.name, color: faction.color, capitalId: faction.capitalId }));
  return { ...lobby, slots, aiSlots };
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
 *  stay neutral/unowned, same as any territory outside a normal game's starting capitals. Also
 *  seeds diplomacy (scenario.wars/pacts/alliances) and each faction's own research/nukeStockpile,
 *  when set. */
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
  const playerIdByCapital = new Map(players.map((p) => [p.capitalId, p.id]));

  const territoryState = new Map<string, TerritoryState>();
  for (const territory of territories) {
    territoryState.set(territory.id, { ownerId: null, garrison: EMPTY_GARRISON, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON });
  }

  const resources = new Map<string, number>();
  const nukeStockpiles = new Map<string, number>();
  for (const player of players) {
    const faction = factionByCapital.get(player.capitalId);
    if (!faction) throw new Error(`no scenario faction found for capital "${player.capitalId}"`);
    resources.set(player.id, faction.resources);
    if (faction.nukeStockpile !== undefined) nukeStockpiles.set(player.id, faction.nukeStockpile);
    for (const st of faction.territories) {
      territoryState.set(st.territoryId, {
        ownerId: player.id,
        garrison: st.garrison,
        movedIn: EMPTY_GARRISON,
        extraMoveUsed: EMPTY_GARRISON,
        ...(st.ships ? { ships: st.ships } : {}),
      });
    }
  }

  // A faction's own researchState (e.g. a Cold War nuclear power's pre-unlocked 'nuke') applies
  // whether that seat ends up human- or AI-controlled - it's part of the scenario's premise, not
  // just an AI convenience. Falls back to the normal "AI gets everything, human starts with just
  // Infanterie" split (see buildGameStateFromLobby) for any faction that doesn't set one.
  const research = new Map<string, ResearchState>();
  for (const player of players) {
    const faction = factionByCapital.get(player.capitalId)!;
    if (faction.researchState) {
      research.set(player.id, {
        unlockedGround: [...(faction.researchState.unlockedGround ?? [])],
        unlockedAir: [...(faction.researchState.unlockedAir ?? [])],
        unlockedSupport: [...(faction.researchState.unlockedSupport ?? [])],
        unlockedNaval: [...(faction.researchState.unlockedNaval ?? [])],
      });
    } else if (player.isAI) {
      research.set(player.id, fullResearchState());
    }
  }

  let diplomacy = emptyDiplomacyState();
  for (const [aCapital, bCapital] of scenario.wars ?? []) {
    const a = playerIdByCapital.get(aCapital);
    const b = playerIdByCapital.get(bCapital);
    if (!a || !b) throw new Error(`scenario "${scenario.id}": unknown capital in wars pair (${aCapital}, ${bCapital})`);
    diplomacy = { ...diplomacy, relations: new Map(diplomacy.relations).set(pairKey(a, b), { atWar: true, pact: null }) };
  }
  for (const [aCapital, bCapital] of scenario.pacts ?? []) {
    const a = playerIdByCapital.get(aCapital);
    const b = playerIdByCapital.get(bCapital);
    if (!a || !b) throw new Error(`scenario "${scenario.id}": unknown capital in pacts pair (${aCapital}, ${bCapital})`);
    diplomacy = { ...diplomacy, relations: new Map(diplomacy.relations).set(pairKey(a, b), { atWar: false, pact: { active: true } }) };
  }

  // Each alliance becomes a full clique of `allied` pairs (see DiplomaticRelation.allied), and a
  // faction may only be in one - the same exclusive-membership rule engine/diplomacy.ts enforces
  // for alliances formed in play.
  const inAlliance = new Set<string>();
  for (const capitals of scenario.alliances ?? []) {
    if (capitals.length < 2) throw new Error(`scenario "${scenario.id}": an alliance needs at least 2 members`);
    const memberIds = capitals.map((capital) => {
      const id = playerIdByCapital.get(capital);
      if (!id) throw new Error(`scenario "${scenario.id}": unknown capital in alliances (${capital})`);
      if (inAlliance.has(id)) throw new Error(`scenario "${scenario.id}": "${capital}" is listed in more than one alliance`);
      inAlliance.add(id);
      return id;
    });
    const relations = new Map(diplomacy.relations);
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const key = pairKey(memberIds[i]!, memberIds[j]!);
        const existing = relations.get(key) ?? { atWar: false, pact: null };
        if (existing.atWar) {
          throw new Error(`scenario "${scenario.id}": allied factions (${capitals[i]}, ${capitals[j]}) can't start at war with each other`);
        }
        relations.set(key, { ...existing, allied: true });
      }
    }
    diplomacy = { ...diplomacy, relations };
  }

  // Lets every alliance member join the wars listed above, so a scenario only has to name the
  // war itself (see propagateAllianceWars).
  return propagateAllianceWars({
    turn: 1,
    activePlayerId: players[0]!.id,
    players,
    territoryState,
    resources,
    development: new Map(),
    diplomacy,
    stats: new Map(),
    airfields: new Map(),
    research,
    nukeStockpiles,
    pendingBattle: null,
    seaZones: new Map(),
    pendingSeaBattle: null,
  });
}
