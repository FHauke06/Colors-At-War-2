import type { GameState, LobbyState, Territory } from '../engine/types';
import { claimCapital, canStart, createLobby } from '../engine/session';
import { buildGameStateFromLobby } from '../engine/setup';
import type { GameClient } from './GameClient';

const LOCAL_PLAYER_ID = 'local';

/** Offline mode: a "session" of exactly one local human, no network involved. */
export class LocalGameClient implements GameClient {
  readonly playerId = LOCAL_PLAYER_ID;

  private lobby: LobbyState;
  private readonly territories: readonly Territory[];
  private readonly lobbyListeners = new Set<(lobby: LobbyState) => void>();
  private readonly startListeners = new Set<(gameState: GameState) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  constructor(territories: readonly Territory[], factionCount: number, hostName: string) {
    this.territories = territories;
    this.lobby = createLobby('LOKAL', factionCount, LOCAL_PLAYER_ID, hostName);
  }

  getLobby(): LobbyState {
    return this.lobby;
  }

  onLobby(cb: (lobby: LobbyState) => void): () => void {
    this.lobbyListeners.add(cb);
    return () => this.lobbyListeners.delete(cb);
  }

  onGameStart(cb: (gameState: GameState) => void): () => void {
    this.startListeners.add(cb);
    return () => this.startListeners.delete(cb);
  }

  onError(cb: (message: string) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  claimCapital(territoryId: string): void {
    try {
      this.lobby = claimCapital(this.lobby, this.playerId, territoryId, this.territories);
      this.lobbyListeners.forEach((cb) => cb(this.lobby));
    } catch (err) {
      this.errorListeners.forEach((cb) => cb((err as Error).message));
    }
  }

  start(): void {
    if (!canStart(this.lobby)) {
      this.errorListeners.forEach((cb) => cb('Noch nicht jeder Spieler hat eine Hauptstadt gewählt.'));
      return;
    }
    const gameState = buildGameStateFromLobby(this.lobby, this.territories);
    this.lobby = { ...this.lobby, status: 'started' };
    this.startListeners.forEach((cb) => cb(gameState));
  }

  close(): void {
    this.lobbyListeners.clear();
    this.startListeners.clear();
    this.errorListeners.clear();
  }
}
