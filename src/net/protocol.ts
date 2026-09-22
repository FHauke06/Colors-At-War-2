import type { AiDifficulty, AirComposition, AirTech, BattlePlacement, GameStateWire, GroundTech, LobbyState, SupportTech, UnitComposition } from '../engine/types';
import type { BattleResult } from '../engine/combat';
import type { BomberRaidMode } from '../engine/airforce';
import type { ForceEstimate } from '../engine/intel';

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
      /** Which MAIN_MAPS entry to play on; only used (and required) when creating a new session. */
      readonly mapId?: string;
      /** Only used when creating a new session - defaults to 'medium' if omitted. */
      readonly aiDifficulty?: AiDifficulty;
    }
  | { readonly type: 'claim_capital'; readonly territoryId: string }
  | { readonly type: 'add_ai' } // host-only
  | { readonly type: 'remove_ai'; readonly aiId: string } // host-only
  | { readonly type: 'start' } // host-only
  | { readonly type: 'move_units'; readonly fromId: string; readonly toId: string; readonly amount: UnitComposition }
  | { readonly type: 'end_turn' }
  | { readonly type: 'recruit'; readonly territoryId: string; readonly amount: UnitComposition }
  | { readonly type: 'build_factory'; readonly territoryId: string }
  | { readonly type: 'upgrade_infrastructure'; readonly territoryId: string }
  | { readonly type: 'attack'; readonly fromId: string; readonly toId: string }
  | { readonly type: 'simulate_attack'; readonly fromId: string; readonly toId: string }
  | { readonly type: 'cancel_attack' }
  | { readonly type: 'deploy_battle'; readonly placements: readonly BattlePlacement[] }
  | { readonly type: 'battle_move'; readonly fromSubId: string; readonly toSubId: string; readonly amount: UnitComposition }
  | {
      readonly type: 'escape_battle';
      readonly fromSubId: string;
      readonly destinationId: string;
      readonly amount: UnitComposition;
    }
  | {
      readonly type: 'bombard_battle_cell';
      readonly fromSubId: string;
      readonly targetSubId: string;
      readonly artilleryCount: number;
    }
  | { readonly type: 'end_battle_turn' }
  | { readonly type: 'declare_war'; readonly targetId: string }
  | { readonly type: 'propose_pact'; readonly targetId: string }
  | { readonly type: 'withdraw_pact_proposal'; readonly targetId: string }
  | { readonly type: 'cancel_pact'; readonly targetId: string }
  | { readonly type: 'build_airfield'; readonly territoryId: string }
  | { readonly type: 'upgrade_airfield'; readonly territoryId: string }
  | { readonly type: 'recruit_aircraft'; readonly territoryId: string; readonly amount: AirComposition }
  | {
      readonly type: 'launch_bomber_raid';
      readonly fromTerritoryId: string;
      readonly targetTerritoryId: string;
      readonly bomberCount: number;
      readonly mode: BomberRaidMode;
    }
  | {
      readonly type: 'fighter_sweep';
      readonly fromTerritoryId: string;
      readonly targetTerritoryId: string;
      readonly fighterCount: number;
    }
  | {
      readonly type: 'call_air_support';
      readonly aircraftType: 'fighter' | 'cas';
      readonly fromTerritoryId: string;
      readonly count: number;
    }
  | { readonly type: 'cas_strike'; readonly calledAircraftId: string; readonly targetSubId: string }
  | { readonly type: 'unlock_ground_tech'; readonly tech: GroundTech }
  | { readonly type: 'unlock_air_tech'; readonly tech: AirTech }
  | { readonly type: 'unlock_support_tech'; readonly tech: SupportTech }
  | { readonly type: 'use_nuke' }
  | { readonly type: 'estimate_forces'; readonly targetId: string };

export type ServerMessage =
  | { readonly type: 'lobby'; readonly lobby: LobbyState }
  /** Sent once the host starts the game, and again after every accepted move. */
  | { readonly type: 'game_state'; readonly gameState: GameStateWire }
  /** Sent right after the game_state update in which a tactical battle concludes (one side at
   *  zero units anywhere on the sub-map) - BattleResult is plain data, no separate wire form. */
  | { readonly type: 'battle'; readonly battle: BattleResult }
  /** Sent only to the requesting socket (never broadcast) in reply to 'estimate_forces' - viewer-
   *  specific intel, not something every participant should see. */
  | { readonly type: 'force_estimate'; readonly targetId: string; readonly estimate: ForceEstimate }
  | { readonly type: 'error'; readonly message: string };
