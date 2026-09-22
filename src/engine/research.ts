import type { AirTech, GameState, GroundTech, ResearchState, SupportTech } from './types';

const EMPTY_RESEARCH: ResearchState = { unlockedGround: [], unlockedAir: [], unlockedSupport: [] };

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

export type ResearchOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

function unlockTech<T extends string>(
  gameState: GameState,
  playerId: string,
  tech: T,
  tree: Record<T, TechDef<T>>,
  field: 'unlockedGround' | 'unlockedAir' | 'unlockedSupport',
): ResearchOutcome {
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };

  const def = tree[tech];
  const research = researchAt(gameState, playerId);
  const unlocked = research[field] as readonly T[];
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
