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
}

export interface GameState {
  readonly turn: number;
  readonly players: readonly Player[];
  readonly territoryState: ReadonlyMap<string, TerritoryState>;
}

/** A human seat in the pre-game lobby. AI seats aren't slots - they're filled in at start. */
export interface LobbySlot {
  readonly playerId: string;
  readonly name: string;
  readonly color: string;
  readonly capitalId: string | null;
  readonly isHost: boolean;
}

export interface LobbyState {
  readonly code: string;
  readonly factionCount: number;
  readonly slots: readonly LobbySlot[];
  readonly status: 'lobby' | 'started';
}

/** JSON-safe wire form of GameState (Map -> entry array). */
export interface GameStateWire {
  readonly turn: number;
  readonly players: readonly Player[];
  readonly territoryState: readonly (readonly [string, TerritoryState])[];
}
