import type { UnitComposition } from './types';

/** Kampfwert je Einheitentyp - eine Tabelle statt einer Konstante, weil Upgrades (engine/research.ts's UPGRADE_TREE) sie je
 *  Spieler verändern können (siehe research.ts's strengthTableFor). */
export type StrengthTable = Readonly<Record<keyof UnitComposition, number>>;

/** Same 5:2:1 ratio documented on UnitComposition: infantry=1, lightTank=2.5, heavyTank=5.
 *  Artillery carries no strength here at all (offense or defense) - its only combat role is the
 *  ranged bombardBattleCell action, not ordinary adjacent movement/combat. Das sind die Grundwerte
 *  ohne Upgrades; exported for ui/GameScreen.ts's Research tech-tree tooltips. */
export const STRENGTH: StrengthTable = { infantry: 1, lightTank: 2.5, heavyTank: 5, artillery: 0, motorizedInfantry: 1 };

/** How many "kleine Gebiete" away (Chebyshev/8-directional distance, same convention as every
 *  other adjacency check on this grid) a bombardBattleCell shot can reach - ohne Reichweiten-Upgrade. */
export const ARTILLERY_RANGE = 4;

/** Wie viele Infanterie ein Artilleriegeschütz pro Beschuss tötet - ohne Schadens-Upgrade. */
export const ARTILLERY_KILLS_PER_PIECE = 1;
