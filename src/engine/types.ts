export interface Territory {
  readonly id: string;
  readonly name: string;
  /** SVG path `d` attribute in the map's projected coordinate space. */
  readonly path: string;
  readonly neighbors: readonly string[];
  /** Projected [x, y], used for label/capital placement. */
  readonly centroid: readonly number[];
}

export interface TerritoryData {
  readonly viewBox: string;
  readonly territories: readonly Territory[];
}

/**
 * A garrison is a headcount per unit type, not individual units - there is no per-unit HP.
 * Combat strength is compared via a common denominator: 5 Infanterie = 2 leichte Panzer =
 * 1 schwerer Panzer, i.e. infantry=1, lightTank=2.5, heavyTank=5 strength points each.
 */
export interface UnitComposition {
  readonly infantry: number;
  readonly lightTank: number;
  readonly heavyTank: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** CSS color, unique per player. */
  readonly color: string;
  readonly capitalId: string;
  readonly isAI: boolean;
}

export interface TerritoryState {
  readonly ownerId: string | null;
  readonly garrison: UnitComposition;
  /** Of `garrison`, how many arrived (by moving or capturing) this round - a unit may only
   *  move once per round, so these can't be sent onward again until the round resets. */
  readonly movedIn: UnitComposition;
}

export interface GameState {
  /** Round number - increments each time the active player wraps back to the first player. */
  readonly turn: number;
  /** Whose turn it currently is; only this player may move units or end the turn. */
  readonly activePlayerId: string;
  readonly players: readonly Player[];
  readonly territoryState: ReadonlyMap<string, TerritoryState>;
  /** Rüstungspunkte per player, spent on recruiting new units. */
  readonly resources: ReadonlyMap<string, number>;
}

/** A human seat in the pre-game lobby. */
export interface LobbySlot {
  readonly playerId: string;
  readonly name: string;
  readonly color: string;
  readonly capitalId: string | null;
  readonly isHost: boolean;
}

/** An AI seat, added interactively in the lobby - it gets a capital immediately, not at start. */
export interface AiSlot {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly capitalId: string;
}

export interface LobbyState {
  readonly code: string;
  /** Caps how many human slots may join; unrelated to how many AI get added. */
  readonly maxHumans: number;
  readonly slots: readonly LobbySlot[];
  readonly aiSlots: readonly AiSlot[];
  readonly status: 'lobby' | 'started';
}

/** JSON-safe wire form of GameState (Map -> entry array). */
export interface GameStateWire {
  readonly turn: number;
  readonly activePlayerId: string;
  readonly players: readonly Player[];
  readonly territoryState: readonly (readonly [string, TerritoryState])[];
  readonly resources: readonly (readonly [string, number])[];
}
