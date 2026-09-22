import type { UnitComposition } from '../../engine/types';

/** One territory a scenario faction starts owning, with its own garrison (not necessarily uniform
 *  across the faction's territories - a capital usually gets a bigger one). */
export interface ScenarioTerritory {
  readonly territoryId: string;
  readonly garrison: UnitComposition;
}

/** One playable side in a scenario - human or AI is decided later (see SetupScreen's faction
 *  picker), not baked into the scenario itself. Any territory of data/MainMaps' matching map that
 *  isn't listed in any faction's `territories` starts neutral/unowned, same as in a normal game. */
export interface ScenarioFaction {
  readonly name: string;
  /** Any valid CSS color - scenarios pick their own (e.g. historically flavored) palette rather
   *  than drawing from engine/palette.ts's FACTION_COLORS. */
  readonly color: string;
  /** Must be one of this faction's own `territories` entries - see engine/setup.ts's
   *  buildGameStateFromScenario, which maps each lobby participant back to its scenario faction by
   *  matching capitalId. */
  readonly capitalId: string;
  readonly resources: number;
  readonly territories: readonly ScenarioTerritory[];
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Which of data/MainMaps' MAIN_MAPS this scenario is built for - see MainMapEntry.id. */
  readonly mapId: string;
  readonly factions: readonly ScenarioFaction[];
}
