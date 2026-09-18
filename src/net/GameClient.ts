import type { GameState, LobbyState, UnitComposition } from '../engine/types';

/**
 * Abstracts "how the lobby/game state reaches this browser tab" so the UI never has to know
 * whether it's talking to a local, offline session or a remote server over a WebSocket.
 */
export interface GameClient {
  readonly playerId: string;
  /** Whether this client goes over the network - gates UI (e.g. interactive AI add/remove,
   *  session code display) that only makes sense once other people could be watching. */
  readonly isOnline: boolean;
  getLobby(): LobbyState;
  /** Fires whenever the lobby changes (join, capital claimed, AI added, ...). Returns an unsubscribe fn. */
  onLobby(cb: (lobby: LobbyState) => void): () => void;
  /** Fires exactly once, when the host starts the game - the lobby -> map screen transition. */
  onGameStart(cb: (gameState: GameState) => void): () => void;
  /** Fires on every game state change from here on, including the initial one from onGameStart. */
  onGameState(cb: (gameState: GameState) => void): () => void;
  onError(cb: (message: string) => void): () => void;
  claimCapital(territoryId: string): void;
  /** Host-only; no-op (with an onError) if called by a non-host. */
  addAi(): void;
  removeAi(aiId: string): void;
  /** Host-only; no-op (with an onError) if called by a non-host or before every slot has picked. */
  start(): void;
  /** Moves `amount` units (at most what's garrisoned there) from an owned territory onto an
   *  adjacent one. No-op (with an onError) unless it's currently this player's turn. */
  moveUnits(fromId: string, toId: string, amount: UnitComposition): void;
  /** Ends this player's turn. Any AI seats that follow act immediately, in order, until control
   *  reaches the next human. No-op (with an onError) unless it's currently this player's turn. */
  endTurn(): void;
  /** Spends Rüstungspunkte to add new units to an owned territory. No-op (with an onError)
   *  unless it's currently this player's turn or they can't afford it. */
  recruit(territoryId: string, amount: UnitComposition): void;
  close(): void;
}

export function isHost(client: GameClient): boolean {
  return client.getLobby().slots[0]?.playerId === client.playerId;
}
