import type { GameStateWire, LobbyState, UnitComposition } from '../engine/types';

// Wire messages between RemoteGameClient (browser) and the session server.
// A `join` with no `code` creates a new lobby; with `code`, it joins an existing one.
export type ClientMessage =
  | {
      readonly type: 'join';
      readonly playerId: string;
      readonly code?: string;
      readonly name: string;
      /** Only used (and required) when creating a new session. */
      readonly maxHumans?: number;
    }
  | { readonly type: 'claim_capital'; readonly territoryId: string }
  | { readonly type: 'add_ai' } // host-only
  | { readonly type: 'remove_ai'; readonly aiId: string } // host-only
  | { readonly type: 'start' } // host-only
  | { readonly type: 'move_units'; readonly fromId: string; readonly toId: string; readonly amount: UnitComposition }
  | { readonly type: 'end_turn' }
  | { readonly type: 'recruit'; readonly territoryId: string; readonly amount: UnitComposition };

export type ServerMessage =
  | { readonly type: 'lobby'; readonly lobby: LobbyState }
  /** Sent once the host starts the game, and again after every accepted move. */
  | { readonly type: 'game_state'; readonly gameState: GameStateWire }
  | { readonly type: 'error'; readonly message: string };
