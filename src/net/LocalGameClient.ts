import type { GameState, LobbyState, Territory, UnitComposition } from '../engine/types';
import { addAi, claimCapital, canStart, createLobby, removeAi } from '../engine/session';
import { buildGameStateFromLobby } from '../engine/setup';
import { moveUnits } from '../engine/movement';
import { endTurn } from '../engine/turns';
import { recruitUnits } from '../engine/economy';
import type { GameClient } from './GameClient';

const LOCAL_PLAYER_ID = 'local';

/** Offline mode: a "session" of exactly one local human, no network involved. `aiCount`
 *  opponents are added immediately so their (spread-out) capitals show on the map right away. */
export class LocalGameClient implements GameClient {
  readonly playerId = LOCAL_PLAYER_ID;
  readonly isOnline = false;

  private lobby: LobbyState;
  private gameState: GameState | null = null;
  private readonly territories: readonly Territory[];
  private readonly lobbyListeners = new Set<(lobby: LobbyState) => void>();
  private readonly startListeners = new Set<(gameState: GameState) => void>();
  private readonly stateListeners = new Set<(gameState: GameState) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  constructor(territories: readonly Territory[], hostName: string, aiCount: number) {
    this.territories = territories;
    let lobby = createLobby('LOKAL', 1, LOCAL_PLAYER_ID, hostName);
    for (let i = 0; i < aiCount; i++) lobby = addAi(lobby, territories);
    this.lobby = lobby;
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

  onGameState(cb: (gameState: GameState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onError(cb: (message: string) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  claimCapital(territoryId: string): void {
    this.mutateLobby((lobby) => claimCapital(lobby, this.playerId, territoryId, this.territories));
  }

  addAi(): void {
    this.mutateLobby((lobby) => addAi(lobby, this.territories));
  }

  removeAi(aiId: string): void {
    this.mutateLobby((lobby) => removeAi(lobby, aiId));
  }

  start(): void {
    if (!canStart(this.lobby)) {
      this.errorListeners.forEach((cb) => cb('Noch nicht jeder Spieler hat eine Hauptstadt gewählt.'));
      return;
    }
    this.gameState = buildGameStateFromLobby(this.lobby, this.territories);
    this.lobby = { ...this.lobby, status: 'started' };
    this.startListeners.forEach((cb) => cb(this.gameState!));
    this.stateListeners.forEach((cb) => cb(this.gameState!));
  }

  moveUnits(fromId: string, toId: string, amount: UnitComposition): void {
    if (!this.gameState) return;
    const outcome = moveUnits(this.gameState, this.playerId, fromId, toId, this.territories, amount);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.stateListeners.forEach((cb) => cb(this.gameState!));
  }

  endTurn(): void {
    if (!this.gameState) return;
    const outcome = endTurn(this.gameState, this.playerId, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.stateListeners.forEach((cb) => cb(this.gameState!));
  }

  recruit(territoryId: string, amount: UnitComposition): void {
    if (!this.gameState) return;
    const outcome = recruitUnits(this.gameState, this.playerId, territoryId, amount);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.stateListeners.forEach((cb) => cb(this.gameState!));
  }

  close(): void {
    this.lobbyListeners.clear();
    this.startListeners.clear();
    this.stateListeners.clear();
    this.errorListeners.clear();
  }

  private mutateLobby(fn: (lobby: LobbyState) => LobbyState): void {
    try {
      this.lobby = fn(this.lobby);
      this.lobbyListeners.forEach((cb) => cb(this.lobby));
    } catch (err) {
      this.errorListeners.forEach((cb) => cb((err as Error).message));
    }
  }
}
