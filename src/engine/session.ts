import type { AiDifficulty, AiSlot, DiplomacyState, DiplomacyStateWire, GameState, GameStateWire, LobbySlot, LobbyState, PendingBattle, PendingBattleWire, Territory } from './types';
import { FACTION_COLORS, MAX_FACTIONS } from './palette';
import { pickCapitals } from './setup';
import { randomAiName } from './aiNames';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L - avoids typos when shared aloud

export function generateSessionCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

// Not a security token, just an internal id - safe in both browser and Node without crypto APIs.
function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function totalFactions(lobby: LobbyState): number {
  return lobby.slots.length + lobby.aiSlots.length;
}

function nextColor(lobby: LobbyState): string {
  const used = new Set([...lobby.slots.map((s) => s.color), ...lobby.aiSlots.map((a) => a.color)]);
  const color = FACTION_COLORS.find((c) => !used.has(c));
  if (!color) throw new Error('Maximale Anzahl Fraktionen erreicht.');
  return color;
}

function claimedTerritories(lobby: LobbyState, territories: readonly Territory[]): Territory[] {
  const ids = new Set([
    ...lobby.slots.map((s) => s.capitalId),
    ...lobby.aiSlots.map((a) => a.capitalId),
  ].filter((id): id is string => id !== null));
  return territories.filter((t) => ids.has(t.id));
}

export function createLobby(
  code: string,
  maxHumans: number,
  hostId: string,
  hostName: string,
  aiDifficulty: AiDifficulty = 'medium',
): LobbyState {
  if (maxHumans < 1 || maxHumans > MAX_FACTIONS) {
    throw new Error(`maxHumans must be between 1 and ${MAX_FACTIONS}`);
  }
  const host: LobbySlot = {
    playerId: hostId,
    name: hostName,
    color: FACTION_COLORS[0]!,
    capitalId: null,
    isHost: true,
  };
  return { code, maxHumans, slots: [host], aiSlots: [], status: 'lobby', aiDifficulty };
}

export function addSlot(lobby: LobbyState, playerId: string, name: string): LobbyState {
  if (lobby.status !== 'lobby') throw new Error('game already started');
  if (lobby.slots.some((s) => s.playerId === playerId)) return lobby; // already joined (e.g. reconnect)
  if (lobby.slots.length >= lobby.maxHumans) throw new Error('Lobby ist voll.');
  if (totalFactions(lobby) >= MAX_FACTIONS) throw new Error('Maximale Anzahl Fraktionen erreicht.');

  const slot: LobbySlot = { playerId, name, color: nextColor(lobby), capitalId: null, isHost: false };
  return { ...lobby, slots: [...lobby.slots, slot] };
}

export function claimCapital(
  lobby: LobbyState,
  playerId: string,
  territoryId: string,
  territories: readonly Territory[],
): LobbyState {
  if (lobby.status !== 'lobby') throw new Error('game already started');
  if (!territories.some((t) => t.id === territoryId)) throw new Error(`unknown territory "${territoryId}"`);
  if (!lobby.slots.some((s) => s.playerId === playerId)) throw new Error('not a member of this lobby');

  const takenByHuman = lobby.slots.some((s) => s.capitalId === territoryId && s.playerId !== playerId);
  const takenByAi = lobby.aiSlots.some((a) => a.capitalId === territoryId);
  if (takenByHuman || takenByAi) throw new Error('Gebiet ist bereits vergeben.');

  return {
    ...lobby,
    slots: lobby.slots.map((s) => (s.playerId === playerId ? { ...s, capitalId: territoryId } : s)),
  };
}

/** Adds one AI with an immediately-assigned, spread-out capital (visible on the map right away). */
export function addAi(lobby: LobbyState, territories: readonly Territory[]): LobbyState {
  if (lobby.status !== 'lobby') throw new Error('game already started');
  if (totalFactions(lobby) >= MAX_FACTIONS) throw new Error('Maximale Anzahl Fraktionen erreicht.');

  const [capital] = pickCapitals(territories, 1, claimedTerritories(lobby, territories));
  if (!capital) throw new Error('Keine freien Gebiete für eine weitere KI.');

  const usedNames = new Set([...lobby.slots.map((s) => s.name), ...lobby.aiSlots.map((a) => a.name)]);
  const ai: AiSlot = { id: `ai-${randomId()}`, name: randomAiName(usedNames), color: nextColor(lobby), capitalId: capital.id };
  return { ...lobby, aiSlots: [...lobby.aiSlots, ai] };
}

export function removeAi(lobby: LobbyState, aiId: string): LobbyState {
  if (lobby.status !== 'lobby') throw new Error('game already started');
  return { ...lobby, aiSlots: lobby.aiSlots.filter((a) => a.id !== aiId) };
}

export function canStart(lobby: LobbyState): boolean {
  return (
    lobby.status === 'lobby' &&
    lobby.slots.length > 0 &&
    lobby.slots.every((s) => s.capitalId !== null) &&
    totalFactions(lobby) >= 2
  );
}

function serializePendingBattle(pending: PendingBattle | null): PendingBattleWire | null {
  if (!pending) return null;
  return { ...pending, subState: pending.subState ? [...pending.subState.entries()] : null };
}

function deserializePendingBattle(wire: PendingBattleWire | null): PendingBattle | null {
  if (!wire) return null;
  return { ...wire, subState: wire.subState ? new Map(wire.subState) : null };
}

function serializeDiplomacy(state: DiplomacyState): DiplomacyStateWire {
  return { relations: [...state.relations.entries()], pactProposals: [...state.pactProposals] };
}

function deserializeDiplomacy(wire: DiplomacyStateWire): DiplomacyState {
  return { relations: new Map(wire.relations), pactProposals: new Set(wire.pactProposals) };
}

export function serializeGameState(state: GameState): GameStateWire {
  return {
    turn: state.turn,
    activePlayerId: state.activePlayerId,
    players: state.players,
    territoryState: [...state.territoryState.entries()],
    resources: [...state.resources.entries()],
    development: [...state.development.entries()],
    diplomacy: serializeDiplomacy(state.diplomacy),
    stats: [...state.stats.entries()],
    airfields: [...state.airfields.entries()],
    research: [...state.research.entries()],
    pendingBattle: serializePendingBattle(state.pendingBattle),
  };
}

export function deserializeGameState(wire: GameStateWire): GameState {
  return {
    turn: wire.turn,
    activePlayerId: wire.activePlayerId,
    players: wire.players,
    territoryState: new Map(wire.territoryState),
    resources: new Map(wire.resources),
    development: new Map(wire.development),
    diplomacy: deserializeDiplomacy(wire.diplomacy),
    stats: new Map(wire.stats),
    airfields: new Map(wire.airfields),
    research: new Map(wire.research),
    pendingBattle: deserializePendingBattle(wire.pendingBattle),
  };
}
