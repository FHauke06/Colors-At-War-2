import type { GameState, LobbyState, UnitComposition } from '../engine/types';
import { deserializeGameState } from '../engine/session';
import type { ClientMessage, ServerMessage } from './protocol';
import type { GameClient } from './GameClient';

// Not a security token, just a per-tab identity - avoid crypto.randomUUID() since it requires
// a secure context (https or localhost) and this may be deployed over plain http.
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RemoteSessionOptions {
  /** Omit to create a new session (host); provide to join an existing one. */
  readonly code?: string;
  readonly name: string;
  /** How many human slots the lobby accepts; only used (and required) when creating. */
  readonly maxHumans?: number;
}

/** Online mode: proxies the same GameClient interface over a WebSocket to the session server. */
export class RemoteGameClient implements GameClient {
  readonly playerId = generateId();
  readonly isOnline = true;

  private readonly ws: WebSocket;
  private lobby: LobbyState;
  private hasStarted = false;
  private readonly lobbyListeners = new Set<(lobby: LobbyState) => void>();
  private readonly startListeners = new Set<(gameState: GameState) => void>();
  private readonly stateListeners = new Set<(gameState: GameState) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();

  constructor(wsUrl: string, options: RemoteSessionOptions) {
    this.lobby = { code: '', maxHumans: options.maxHumans ?? 0, slots: [], aiSlots: [], status: 'lobby' };

    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener('open', () => {
      this.send({
        type: 'join',
        playerId: this.playerId,
        code: options.code,
        name: options.name,
        maxHumans: options.maxHumans,
      });
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      switch (msg.type) {
        case 'lobby':
          this.lobby = msg.lobby;
          this.lobbyListeners.forEach((cb) => cb(this.lobby));
          break;
        case 'game_state': {
          const gameState = deserializeGameState(msg.gameState);
          if (!this.hasStarted) {
            this.hasStarted = true;
            this.startListeners.forEach((cb) => cb(gameState));
          }
          this.stateListeners.forEach((cb) => cb(gameState));
          break;
        }
        case 'error':
          this.errorListeners.forEach((cb) => cb(msg.message));
          break;
      }
    });
    this.ws.addEventListener('error', () => {
      this.errorListeners.forEach((cb) => cb('Verbindung zum Server fehlgeschlagen.'));
    });
    this.ws.addEventListener('close', () => {
      this.errorListeners.forEach((cb) => cb('Verbindung zum Server unterbrochen.'));
    });
  }

  private send(message: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
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
    this.send({ type: 'claim_capital', territoryId });
  }

  addAi(): void {
    this.send({ type: 'add_ai' });
  }

  removeAi(aiId: string): void {
    this.send({ type: 'remove_ai', aiId });
  }

  start(): void {
    this.send({ type: 'start' });
  }

  moveUnits(fromId: string, toId: string, amount: UnitComposition): void {
    this.send({ type: 'move_units', fromId, toId, amount });
  }

  endTurn(): void {
    this.send({ type: 'end_turn' });
  }

  recruit(territoryId: string, amount: UnitComposition): void {
    this.send({ type: 'recruit', territoryId, amount });
  }

  close(): void {
    this.ws.close();
    this.lobbyListeners.clear();
    this.startListeners.clear();
    this.stateListeners.clear();
    this.errorListeners.clear();
  }
}

/** Same-origin `/ws` in production (nginx proxies it); direct port in dev (no nginx in front of Vite). */
export function resolveWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env.DEV) return `${protocol}//${location.hostname}:8787`;
  return `${protocol}//${location.host}/ws`;
}
