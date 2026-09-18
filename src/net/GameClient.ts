import type { GameState, LobbyState } from '../engine/types';

/**
 * Abstracts "how the lobby/game state reaches this browser tab" so the UI never has to know
 * whether it's talking to a local, offline session or a remote server over a WebSocket.
 */
export interface GameClient {
  readonly playerId: string;
  getLobby(): LobbyState;
  /** Fires whenever the lobby changes (join, capital claimed, ...). Returns an unsubscribe fn. */
  onLobby(cb: (lobby: LobbyState) => void): () => void;
  /** Fires once, when the host starts the game. */
  onGameStart(cb: (gameState: GameState) => void): () => void;
  onError(cb: (message: string) => void): () => void;
  claimCapital(territoryId: string): void;
  /** Host-only; no-op (with an onError) if called by a non-host or before every slot has picked. */
  start(): void;
  close(): void;
}

export function isHost(client: GameClient): boolean {
  return client.getLobby().slots[0]?.playerId === client.playerId;
}
