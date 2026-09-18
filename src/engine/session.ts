import type { GameState, GameStateWire, LobbySlot, LobbyState, Territory } from './types';
import { FACTION_COLORS, MIN_FACTIONS, MAX_FACTIONS } from './palette';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L - avoids typos when shared aloud

export function generateSessionCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function createLobby(code: string, factionCount: number, hostId: string, hostName: string): LobbyState {
  if (factionCount < MIN_FACTIONS || factionCount > MAX_FACTIONS) {
    throw new Error(`factionCount must be between ${MIN_FACTIONS} and ${MAX_FACTIONS}`);
  }
  const host: LobbySlot = {
    playerId: hostId,
    name: hostName,
    color: FACTION_COLORS[0]!,
    capitalId: null,
    isHost: true,
  };
  return { code, factionCount, slots: [host], status: 'lobby' };
}

export function addSlot(lobby: LobbyState, playerId: string, name: string): LobbyState {
  if (lobby.status !== 'lobby') throw new Error('game already started');
  if (lobby.slots.some((s) => s.playerId === playerId)) return lobby; // already joined (e.g. reconnect)
  if (lobby.slots.length >= lobby.factionCount) throw new Error('lobby is full');

  const slot: LobbySlot = {
    playerId,
    name,
    color: FACTION_COLORS[lobby.slots.length]!,
    capitalId: null,
    isHost: false,
  };
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
  const takenByOther = lobby.slots.some((s) => s.capitalId === territoryId && s.playerId !== playerId);
  if (takenByOther) throw new Error('territory already claimed');
  if (!lobby.slots.some((s) => s.playerId === playerId)) throw new Error('not a member of this lobby');

  return {
    ...lobby,
    slots: lobby.slots.map((s) => (s.playerId === playerId ? { ...s, capitalId: territoryId } : s)),
  };
}

export function canStart(lobby: LobbyState): boolean {
  return lobby.status === 'lobby' && lobby.slots.every((s) => s.capitalId !== null);
}

export function serializeGameState(state: GameState): GameStateWire {
  return { turn: state.turn, players: state.players, territoryState: [...state.territoryState.entries()] };
}

export function deserializeGameState(wire: GameStateWire): GameState {
  return { turn: wire.turn, players: wire.players, territoryState: new Map(wire.territoryState) };
}
