import type { UnitComposition, UpgradeId } from '../../engine/types';

/** One territory a scenario faction starts owning, with its own garrison (not necessarily uniform
 *  across the faction's territories - a capital usually gets a bigger one). */
export interface ScenarioTerritory {
  readonly territoryId: string;
  readonly garrison: UnitComposition;
  /** Schiffe, die im Hafen dieses Gebiets starten - nur sinnvoll für Küstengebiete (siehe
   *  engine/economy.ts's isCoastal), und wie die Garnison nur für Großmächte gesetzt. Sie stehen ab
   *  Runde 1 zur Verfügung (kein `shipsMovedIn`). Weglassen = keine Schiffe. */
  readonly ships?: number;
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
  /** A hard cap on how many nukes this faction may ever fire, on top of the usual research+points
   *  cost - see engine/types.ts's GameState.nukeStockpiles and engine/combat.ts's useNuke. Omit for
   *  the normal, uncapped behavior (research+affordability only) - most scenarios/factions don't
   *  set this at all. Firing still requires 'nuke' to actually be in this faction's researchState
   *  below (a stockpile alone doesn't grant the tech). */
  readonly nukeStockpile?: number;
  /** This faction's starting tech, e.g. a pre-unlocked 'nuke' for a Cold War scenario - same shape
   *  as engine/types.ts's ResearchState. Omit for the normal "only Infanterie" human start (an AI
   *  seat still gets engine/setup.ts's usual full unlock regardless, same as any other scenario). */
  readonly researchState?: {
    readonly unlockedGround?: readonly ('lightTank' | 'heavyTank' | 'motorizedInfantry')[];
    readonly unlockedAir?: readonly ('fighters' | 'cas' | 'bombers')[];
    readonly unlockedSupport?: readonly ('artillery' | 'nuke')[];
    readonly unlockedNaval?: readonly 'ships'[];
    /** Schon zum Start erforschte Upgrades (siehe engine/research.ts's UPGRADE_TREE). Weglassen = keine. */
    readonly upgrades?: readonly UpgradeId[];
  };
}

/** A pair of faction `capitalId`s (each must match a ScenarioFaction.capitalId in the same
 *  scenario) - the relation named applies from the very first turn, before either side could
 *  otherwise reach it through normal play (see engine/diplomacy.ts's declareWar/proposePact). */
export type ScenarioFactionPair = readonly [string, string];

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Which of data/MainMaps' MAIN_MAPS this scenario is built for - see MainMapEntry.id. */
  readonly mapId: string;
  readonly factions: readonly ScenarioFaction[];
  /** Pairs already at war when the scenario starts (e.g. the invasion the scenario is named for) -
   *  without this, every faction starts at peace with every other and a human has to manually
   *  declare war before attacking, even where the scenario's own description says the fighting has
   *  already begun. Omit for a scenario where nobody starts at war. */
  readonly wars?: readonly ScenarioFactionPair[];
  /** Pairs under an active non-aggression pact from the start (e.g. Molotov-Ribbentrop) - same
   *  effect as both sides mutually proposing one on turn 1 (see engine/diplomacy.ts's
   *  proposePact), just already in place. Omit for a scenario with no starting pacts. */
  readonly pacts?: readonly ScenarioFactionPair[];
  /** Alliances that already exist when the scenario starts - each entry lists the `capitalId`s of
   *  ALL members of one alliance (NATO, the Warsaw Pact, ...), and a faction may appear in at most
   *  one. Members see each other's units and share every war (see engine/diplomacy.ts): any war
   *  in `wars` involving one member is joined by the rest at setup, so a scenario doesn't have to
   *  spell that out - but two members of the same alliance must not be listed as being at war.
   *  Omit for a scenario without alliances. */
  readonly alliances?: readonly (readonly string[])[];
}
