import type { AirTech, GameState, GroundTech, NavalTech, ResearchState, SupportTech, UpgradeId } from './types';
import { ARTILLERY_KILLS_PER_PIECE, ARTILLERY_RANGE, STRENGTH } from './unitStats';
import type { StrengthTable } from './unitStats';

const EMPTY_RESEARCH: ResearchState = { unlockedGround: [], unlockedAir: [], unlockedSupport: [], unlockedNaval: [] };

export function emptyResearchState(): ResearchState {
  return EMPTY_RESEARCH;
}

/** Every tech unlocked at once - granted to AI seats immediately at game start (see
 *  engine/setup.ts) so the AI keeps its full existing tactical repertoire without ever having to
 *  spend points researching it. */
export function fullResearchState(): ResearchState {
  return {
    unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'],
    unlockedAir: ['fighters', 'cas', 'bombers'],
    unlockedSupport: ['artillery', 'nuke'],
    unlockedNaval: ['ships'],
  };
}

export function researchAt(gameState: GameState, playerId: string): ResearchState {
  return gameState.research.get(playerId) ?? EMPTY_RESEARCH;
}

/** Infanterie always counts as unlocked - it's the one type nobody has to research. */
export function isGroundUnlocked(gameState: GameState, playerId: string, type: GroundTech | 'infantry'): boolean {
  if (type === 'infantry') return true;
  return researchAt(gameState, playerId).unlockedGround.includes(type);
}

export function isAirUnlocked(gameState: GameState, playerId: string, type: AirTech): boolean {
  return researchAt(gameState, playerId).unlockedAir.includes(type);
}

export function isSupportUnlocked(gameState: GameState, playerId: string, type: SupportTech): boolean {
  return researchAt(gameState, playerId).unlockedSupport.includes(type);
}

export function isNavalUnlocked(gameState: GameState, playerId: string, type: NavalTech): boolean {
  return (researchAt(gameState, playerId).unlockedNaval ?? []).includes(type);
}

export interface TechDef<T> {
  readonly cost: number;
  /** null means it has no prerequisite - unlockable from the start. */
  readonly requires: T | null;
}

/** Schwere Panzer needs Leichte Panzer first (a tank-doctrine progression, not an arbitrary
 *  gate). Artillerie used to live here too - see SUPPORT_TECH_TREE, it's grouped with the
 *  Atombombe now instead, since neither is a frontline ground unit. Motorisierte Infanterie has no
 *  prerequisite - see engine/movement.ts's availableToMove for its actual gameplay effect (a
 *  second move per round/battle-turn), UNIT_COSTS.motorizedInfantry for its recruiting cost. */
export const GROUND_TECH_TREE: Record<GroundTech, TechDef<GroundTech>> = {
  lightTank: { cost: 150, requires: null },
  heavyTank: { cost: 250, requires: 'lightTank' },
  motorizedInfantry: { cost: 100, requires: null },
};

/** Jäger first, then CAS (needs top cover to operate - see engine/airforce.ts's
 *  CAS_MIN_AIR_SUPERIORITY, the same idea applied to the tech tree), then Bomber. */
export const AIR_TECH_TREE: Record<AirTech, TechDef<AirTech>> = {
  fighters: { cost: 75, requires: null },
  cas: { cost: 200, requires: 'fighters' },
  bombers: { cost: 1000, requires: 'cas' },
};

/** Support weapons: Artillerie (cheap, no prerequisite - its own ranged bombardBattleCell combat
 *  role) and the Atombombe (no prerequisite either, but by far the single most expensive unlock in
 *  the game - see engine/combat.ts's NUKE_USE_COST for what it costs per use on top of this). */
export const SUPPORT_TECH_TREE: Record<SupportTech, TechDef<SupportTech>> = {
  artillery: { cost: 150, requires: null },
  nuke: { cost: 2000, requires: null },
};

/** Marine: bewusst nur eine Stufe, ohne Voraussetzung - `ships` schaltet Schiffe frei (Rekrutieren in
 *  Küstengebieten, siehe engine/naval.ts's recruitShips). 200 Rüstungspunkte liegen zwischen CAS (200) und
 *  Schweren Panzern (250): teuer genug, dass man sich für den Seekrieg entscheiden muss. Die Schiffe selbst
 *  kosten zusätzlich SHIP_COST pro Stück (engine/naval.ts). */
export const NAVAL_TECH_TREE: Record<NavalTech, TechDef<NavalTech>> = {
  ships: { cost: 200, requires: null },
};

export type ResearchOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

function unlockTech<T extends string>(
  gameState: GameState,
  playerId: string,
  tech: T,
  tree: Record<T, TechDef<T>>,
  field: 'unlockedGround' | 'unlockedAir' | 'unlockedSupport' | 'unlockedNaval',
): ResearchOutcome {
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const def = tree[tech];
  const research = researchAt(gameState, playerId);
  const unlocked = (research[field] ?? []) as readonly T[];
  if (unlocked.includes(tech)) return { ok: false, reason: 'Bereits erforscht.' };
  if (def.requires && !unlocked.includes(def.requires)) {
    return { ok: false, reason: 'Voraussetzung noch nicht erforscht.' };
  }

  const balance = gameState.resources.get(playerId) ?? 0;
  if (balance < def.cost) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const nextResearch = new Map(gameState.research);
  nextResearch.set(playerId, { ...research, [field]: [...unlocked, tech] });
  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - def.cost);

  return { ok: true, gameState: { ...gameState, research: nextResearch, resources } };
}

export function unlockGroundTech(gameState: GameState, playerId: string, tech: GroundTech): ResearchOutcome {
  return unlockTech(gameState, playerId, tech, GROUND_TECH_TREE, 'unlockedGround');
}

export function unlockAirTech(gameState: GameState, playerId: string, tech: AirTech): ResearchOutcome {
  return unlockTech(gameState, playerId, tech, AIR_TECH_TREE, 'unlockedAir');
}

export function unlockSupportTech(gameState: GameState, playerId: string, tech: SupportTech): ResearchOutcome {
  return unlockTech(gameState, playerId, tech, SUPPORT_TECH_TREE, 'unlockedSupport');
}

/** Wie unlockGroundTech, für die Marine (engine/research.ts's NAVAL_TECH_TREE). */
export function unlockNavalTech(gameState: GameState, playerId: string, tech: NavalTech): ResearchOutcome {
  return unlockTech(gameState, playerId, tech, NAVAL_TECH_TREE, 'unlockedNaval');
}

// ============================== Upgrades ==============================

/** Ein Upgrade gehört immer zu einer Einheiten-Technologie (`tech`, in der Gruppe `group`): es setzt sie voraus und hängt im
 *  Research-Tab direkt darunter. `effect`: 'damage' erhöht den Kampfwert der Armee-Einheit (bei der Artillerie: wie viele
 *  Infanterie ein Geschütz pro Beschuss tötet), 'range' die Reichweite der Artillerie. */
export type UpgradeDef =
  | { readonly group: 'ground'; readonly tech: GroundTech; readonly effect: 'damage'; readonly cost: number }
  | { readonly group: 'support'; readonly tech: 'artillery'; readonly effect: 'damage' | 'range'; readonly cost: number };

/** Kosten je Upgrade: knapp unter dem Preis der Einheit selbst, damit sich die Verbesserung lohnt, aber wie die Einheit eine
 *  echte Entscheidung bleibt. Die Artillerie hat zwei getrennte Verbesserungen (Schaden und Reichweite). */
export const UPGRADE_TREE: Record<UpgradeId, UpgradeDef> = {
  lightTankDamage: { group: 'ground', tech: 'lightTank', effect: 'damage', cost: 120 },
  heavyTankDamage: { group: 'ground', tech: 'heavyTank', effect: 'damage', cost: 200 },
  motorizedInfantryDamage: { group: 'ground', tech: 'motorizedInfantry', effect: 'damage', cost: 80 },
  artilleryDamage: { group: 'support', tech: 'artillery', effect: 'damage', cost: 150 },
  artilleryRange: { group: 'support', tech: 'artillery', effect: 'range', cost: 120 },
};

/** Alle Upgrades in fester Reihenfolge (die der Research-Tab und die KI durchgehen). */
export const UPGRADE_IDS = Object.keys(UPGRADE_TREE) as readonly UpgradeId[];

/** Schadens-Upgrade einer Armee-Einheit: ihr Kampfwert steigt um diesen Anteil (Leichte Panzer 2,5 -> 3,0, Schwere 5 -> 6,
 *  Motorisierte Infanterie 1 -> 1,2) - im Angriff wie in der Verteidigung, denn Kampfwert ist im Spiel beides. */
export const DAMAGE_UPGRADE_BONUS = 0.2;
/** Schadens-Upgrade der Artillerie: so viele Infanterie tötet ein Geschütz pro Beschuss zusätzlich (statt 1 dann 2). */
export const ARTILLERY_DAMAGE_UPGRADE_KILLS = 1;
/** Reichweiten-Upgrade der Artillerie: so viele Felder weiter reicht der Beschuss (statt 4 dann 6). */
export const ARTILLERY_RANGE_UPGRADE_BONUS = 2;

/** Die Upgrades, die zu einer Technologie gehören (in UPGRADE_IDS-Reihenfolge). */
export function upgradesOf(tech: GroundTech | SupportTech): readonly UpgradeId[] {
  return UPGRADE_IDS.filter((id) => UPGRADE_TREE[id].tech === tech);
}

export function hasUpgrade(gameState: GameState, playerId: string, upgrade: UpgradeId): boolean {
  return (researchAt(gameState, playerId).upgrades ?? []).includes(upgrade);
}

/** Ob die Technologie, zu der `upgrade` gehört, erforscht ist - Voraussetzung für das Upgrade. */
export function isUpgradeTechUnlocked(gameState: GameState, playerId: string, upgrade: UpgradeId): boolean {
  const def = UPGRADE_TREE[upgrade];
  return def.group === 'ground' ? isGroundUnlocked(gameState, playerId, def.tech) : isSupportUnlocked(gameState, playerId, def.tech);
}

/** Erforscht ein Upgrade: wie unlockTech nur außerhalb von Kämpfen, nur am Zug, nur einmal, mit erforschter Technologie und
 *  genug Rüstungspunkten. */
export function unlockUpgrade(gameState: GameState, playerId: string, upgrade: UpgradeId): ResearchOutcome {
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  // Die Id kommt beim Server vom Client - nur bekannte Upgrades zulassen (nicht z.B. "__proto__").
  if (!UPGRADE_IDS.includes(upgrade)) return { ok: false, reason: 'Unbekanntes Upgrade.' };
  const def = UPGRADE_TREE[upgrade];
  if (hasUpgrade(gameState, playerId, upgrade)) return { ok: false, reason: 'Bereits erforscht.' };
  if (!isUpgradeTechUnlocked(gameState, playerId, upgrade)) return { ok: false, reason: 'Die zugehörige Einheit ist noch nicht erforscht.' };

  const balance = gameState.resources.get(playerId) ?? 0;
  if (balance < def.cost) return { ok: false, reason: 'Nicht genug Rüstungspunkte.' };

  const research = researchAt(gameState, playerId);
  const nextResearch = new Map(gameState.research);
  nextResearch.set(playerId, { ...research, upgrades: [...(research.upgrades ?? []), upgrade] });
  const resources = new Map(gameState.resources);
  resources.set(playerId, balance - def.cost);
  return { ok: true, gameState: { ...gameState, research: nextResearch, resources } };
}

/** Gibt einem Spieler ein Upgrade ohne Kosten und ohne Prüfung - für die KI, die ihre Upgrades planmäßig bekommt (engine/ai.ts's
 *  runAiUpgrades), und für Szenarien. Ein schon vorhandenes Upgrade bleibt unverändert. */
export function grantUpgrade(gameState: GameState, playerId: string, upgrade: UpgradeId): GameState {
  if (hasUpgrade(gameState, playerId, upgrade)) return gameState;
  const research = researchAt(gameState, playerId);
  const nextResearch = new Map(gameState.research);
  nextResearch.set(playerId, { ...research, upgrades: [...(research.upgrades ?? []), upgrade] });
  return { ...gameState, research: nextResearch };
}

/** Der Kampfwert je Einheitentyp dieses Spielers: die Grundwerte (unitStats.ts's STRENGTH), erhöht um seine erforschten
 *  Schadens-Upgrades der Armee-Einheiten. Ohne solche Upgrades ist es genau die (gemeinsame) Grundtabelle. */
export function strengthTableFor(gameState: GameState, playerId: string): StrengthTable {
  const upgrades = researchAt(gameState, playerId).upgrades;
  if (!upgrades || upgrades.length === 0) return STRENGTH;
  let table: Record<keyof StrengthTable, number> | null = null;
  for (const id of upgrades) {
    const def = UPGRADE_TREE[id];
    if (def?.group !== 'ground') continue;
    table ??= { ...STRENGTH };
    table[def.tech] = STRENGTH[def.tech] * (1 + DAMAGE_UPGRADE_BONUS);
  }
  return table ?? STRENGTH;
}

/** Reichweite des Artillerie-Beschusses dieses Spielers in Feldern (Grundwert plus Reichweiten-Upgrade). */
export function artilleryRangeFor(gameState: GameState, playerId: string): number {
  return ARTILLERY_RANGE + (hasUpgrade(gameState, playerId, 'artilleryRange') ? ARTILLERY_RANGE_UPGRADE_BONUS : 0);
}

/** Wie viele Infanterie ein Artilleriegeschütz dieses Spielers pro Beschuss tötet (Grundwert plus Schadens-Upgrade). */
export function artilleryKillsPerPiece(gameState: GameState, playerId: string): number {
  return ARTILLERY_KILLS_PER_PIECE + (hasUpgrade(gameState, playerId, 'artilleryDamage') ? ARTILLERY_DAMAGE_UPGRADE_KILLS : 0);
}
