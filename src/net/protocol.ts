import type { GameStateWire, LobbyState } from '../engine/types';

// Wire messages between RemoteGameClient (browser) and the session server.
// A `join` with no `code` creates a new lobby; with `code`, it joins an existing one.
export type ClientMessage =
  | {
      readonly type: 'join';
      readonly playerId: string;
      readonly code?: string;
      readonly name: string;
      readonly factionCount?: number;
    }
  | { readonly type: 'claim_capital'; readonly territoryId: string }
  | { readonly type: 'start' };

export type ServerMessage =
  | { readonly type: 'lobby'; readonly lobby: LobbyState }
  | { readonly type: 'game_started'; readonly gameState: GameStateWire }
  | { readonly type: 'error'; readonly message: string };
