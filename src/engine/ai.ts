import type { AiDifficulty, AirComposition, BattlePlacement, BattleSubTerritory, GameState, PendingBattle, SeaZone, Territory, UnitComposition } from './types';
import { moveShips, embarkUnits, disembarkUnits, startAmphibiousBattle, seaStateOf, availableShips, totalShips, cascadeAiSeaBattle, coastalZoneIds } from './naval';
import { recruitShips, SHIP_COST, isCoastal } from './economy';
import { moveUnits, totalUnits, availableToMove, subtractGarrisons, defenderForce, playerForce } from './movement';
import {
  startBattle,
  markDeployed,
  beginBattlePhase,
  endBattleTurn,
  forceConcludeBattle,
  battleStrength,
  defenseStrength,
  MAX_BATTLE_ROUNDS,
  SIMULATED_DEFENSE_MULTIPLIER,
  moveBattleUnits,
  bombardBattleCell,
  ARTILLERY_RANGE,
  subTerritoryDistance,
  callAirSupport,
  casStrike,
  proposeBattleDraw,
} from './combat';
import type { BattleResult } from './combat';
import {
  declareWar,
  proposePact,
  proposeAlliance,
  allianceConflict,
  allianceMembers,
  areAllied,
  areAtWar,
  hasPendingProposal,
  hasPendingAllianceProposal,
} from './diplomacy';
import {
  recruitUnits,
  buildFactory,
  upgradeInfrastructure,
  developmentAt,
  factoryCapacity,
  UNIT_COSTS,
  FACTORY_COST,
  INFRASTRUCTURE_COST,
  MAX_INFRASTRUCTURE_LEVEL,
} from './economy';
import {
  airfieldAt,
  airfieldCapacity,
  totalAircraft,
  buildAirfield,
  upgradeAirfield,
  recruitAircraft,
  launchBomberRaid,
  fighterSweep,
  territoryDistance,
  AIRCRAFT_COST_PER_100,
  AIRCRAFT_PACKET_SIZE,
  AIRFIELD_BUILD_COST,
  AIRFIELD_UPGRADE_COST,
  FIGHTER_RANGE,
  CAS_STRIKE_DAMAGE_PER_UNIT,
} from './airforce';
import type { BomberRaidMode } from './airforce';

/**
 * The knobs that vary by Player.aiDifficulty - "am Spielbeginn einstellen, wie gut die KI ist".
 * Distinct from aiTechAffinity (each AI's own random roll for *how* it diversifies, unaffected by
 * difficulty): this instead governs how boldly and effectively it plays, uniformly for every AI
 * seat in the lobby (see LobbyState.aiDifficulty).
 */
interface AiDifficultyProfile {
  /** How much stronger (in total military strength) the AI wants to be before declaring war on a
   *  bordering rival - keeps it from picking fights it can't comfortably win. Lower = bolder. */
  readonly warStrengthMargin: number;
  /** Chance per eligible rival, per turn, that the AI actually follows through on a war it could
   *  justify - so wars don't all break out the instant the numbers turn favorable. */
  readonly warDeclarationChance: number;
  /** Extra margin (on top of the defender's own SIMULATED_DEFENSE_MULTIPLIER bonus) the AI wants
   *  before committing to an attack, since losing the committed force outright is a real risk.
   *  Lower = attacks on a thinner edge. */
  readonly attackStrengthMargin: number;
  /** Caps techAffinityOf's already-random personal roll - see runAiEconomy. A low-difficulty AI
   *  under-uses even a high personal affinity roll; a high-difficulty one gets closer to what that
   *  roll would allow. */
  readonly maxDiversifiedShare: number;
  /** Chance, per owned Flugplatz with something to send and an eligible target, per AI turn, that
   *  runAiAirOffense actually launches it. */
  readonly airOffenseChanceScale: number;
}

const DIFFICULTY_PROFILES: Record<AiDifficulty, AiDifficultyProfile> = {
  easy: {
    warStrengthMargin: 1.8,
    warDeclarationChance: 0.25,
    attackStrengthMargin: 1.6,
    maxDiversifiedShare: 0.3,
    airOffenseChanceScale: 0.25,
  },
  medium: {
    warStrengthMargin: 1.3,
    warDeclarationChance: 0.5,
    attackStrengthMargin: 1.2,
    maxDiversifiedShare: 0.7,
    airOffenseChanceScale: 0.5,
  },
  hard: {
    warStrengthMargin: 1.05,
    warDeclarationChance: 0.85,
    attackStrengthMargin: 1.0,
    maxDiversifiedShare: 0.85,
    airOffenseChanceScale: 0.75,
  },
};

/** This AI seat's difficulty (see Player.aiDifficulty) - defaults to 'medium' if it's ever
 *  missing, the same fallback createLobby itself uses when none was explicitly chosen. */
function difficultyProfileOf(gameState: GameState, aiPlayerId: string): AiDifficultyProfile {
  const difficulty = gameState.players.find((p) => p.id === aiPlayerId)?.aiDifficulty ?? 'medium';
  return DIFFICULTY_PROFILES[difficulty];
}

/** This AI seat's one-time personality roll (see Player.aiTechAffinity) - defaults to 0 (the old,
 *  diversification-free behavior) if it's ever missing, rather than crashing or acting as if it
 *  were 1. */
function techAffinityOf(gameState: GameState, aiPlayerId: string): number {
  return gameState.players.find((p) => p.id === aiPlayerId)?.aiTechAffinity ?? 0;
}

function totalPlayerStrength(gameState: GameState, playerId: string): number {
  return battleStrength(playerForce(gameState, playerId));
}

/** Every other player's id who owns a territory directly bordering one of the AI's own. */
function borderingRivalIds(gameState: GameState, territories: readonly Territory[], aiPlayerId: string): Set<string> {
  const rivals = new Set<string>();
  for (const territory of territories) {
    if (gameState.territoryState.get(territory.id)?.ownerId !== aiPlayerId) continue;
    for (const neighborId of territory.neighbors) {
      const ownerId = gameState.territoryState.get(neighborId)?.ownerId;
      if (ownerId && ownerId !== aiPlayerId) rivals.add(ownerId);
    }
  }
  return rivals;
}

/** Total military strength of every player in `playerIds`' alliances, each player counted once -
 *  what actually fights together, since a war joins a whole alliance (see
 *  engine/diplomacy.ts's propagateAllianceWars). A player without allies is just themselves. */
function coalitionStrength(gameState: GameState, playerIds: Iterable<string>): number {
  const members = new Set<string>();
  for (const id of playerIds) for (const member of allianceMembers(gameState, id)) members.add(member);
  let total = 0;
  for (const member of members) total += totalPlayerStrength(gameState, member);
  return total;
}

/** Everyone at war with anyone in `playerId`'s alliance. */
function enemyIdsOfAlliance(gameState: GameState, playerId: string): Set<string> {
  const enemies = new Set<string>();
  for (const member of allianceMembers(gameState, playerId)) {
    for (const other of gameState.players) {
      if (other.id !== member && areAtWar(gameState, member, other.id)) enemies.add(other.id);
    }
  }
  return enemies;
}

/** Whether the AI takes an alliance `proposerId` offered it: only if it's actually possible (see
 *  engine/diplomacy.ts's allianceConflict) and it wouldn't get dragged into a war it can't
 *  comfortably win - joining means inheriting every war the proposer's alliance is already in, so
 *  the merged alliance has to out-muscle those new enemies by the same margin the AI demands
 *  before it starts a war of its own. An alliance that brings no new enemies is always welcome. */
function aiAcceptsAlliance(gameState: GameState, aiPlayerId: string, proposerId: string, profile: AiDifficultyProfile): boolean {
  if (allianceConflict(gameState, aiPlayerId, proposerId)) return false;
  const ownEnemies = enemyIdsOfAlliance(gameState, aiPlayerId);
  const newEnemies = [...enemyIdsOfAlliance(gameState, proposerId)].filter((id) => !ownEnemies.has(id));
  if (newEnemies.length === 0) return true;
  const merged = [...allianceMembers(gameState, aiPlayerId), ...allianceMembers(gameState, proposerId)];
  return coalitionStrength(gameState, merged) > coalitionStrength(gameState, newEnemies) * profile.warStrengthMargin;
}

/**
 * Diplomacy pass, run before anything else each AI turn: accepts any non-aggression pact someone
 * has already offered (a pact never hurts and closes off a front) and any alliance offer it can
 * safely take on (see aiAcceptsAlliance), then opportunistically declares war on a bordering rival
 * it clearly outmatches - opening that rival up as an attack target for the military pass below.
 * The comparison is alliance against alliance, since a war drags in everyone on both sides.
 * Declaring war against a pact partner, an ally or someone already at war is simply rejected by
 * engine/diplomacy.ts's own validation, so no extra bookkeeping here.
 */
function runAiDiplomacy(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const profile = difficultyProfileOf(state, aiPlayerId);

  for (const player of state.players) {
    if (player.id === aiPlayerId) continue;
    if (hasPendingProposal(state, player.id, aiPlayerId)) {
      const outcome = proposePact(state, aiPlayerId, player.id);
      if (outcome.ok) state = outcome.gameState;
    }
    if (hasPendingAllianceProposal(state, player.id, aiPlayerId) && aiAcceptsAlliance(state, aiPlayerId, player.id, profile)) {
      const outcome = proposeAlliance(state, aiPlayerId, player.id);
      if (outcome.ok) state = outcome.gameState;
    }
  }

  for (const rivalId of borderingRivalIds(state, territories, aiPlayerId)) {
    if (areAtWar(state, aiPlayerId, rivalId) || areAllied(state, aiPlayerId, rivalId)) continue;
    const myStrength = coalitionStrength(state, [aiPlayerId]);
    const rivalStrength = coalitionStrength(state, [rivalId]);
    if (myStrength <= rivalStrength * profile.warStrengthMargin) continue;
    if (Math.random() >= profile.warDeclarationChance) continue;
    const outcome = declareWar(state, aiPlayerId, rivalId);
    if (outcome.ok) state = outcome.gameState;
  }

  return state;
}

/**
 * For each of the AI's territories with units that haven't moved yet this round, expands into a
 * capturable neighbor (unowned, or an enemy's whose garrison is empty and who's at war with the
 * AI - the only kinds of territory anyone can take without a fight). Territories with no such
 * neighbor just sit still.
 */
function runAiExpansion(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const ownedIds = [...state.territoryState.entries()].filter(([, s]) => s.ownerId === aiPlayerId).map(([id]) => id);

  for (const fromId of ownedIds) {
    const fromState = state.territoryState.get(fromId);
    const fromTerritory = territories.find((t) => t.id === fromId);
    if (!fromState || !fromTerritory) continue;

    const available = availableToMove(fromState);
    if (totalUnits(available) === 0) continue;

    const targetId = fromTerritory.neighbors.find((neighborId) => {
      const neighborState = state.territoryState.get(neighborId);
      if (!neighborState || neighborState.ownerId === aiPlayerId) return false;
      if (neighborState.ownerId === null) return true;
      return totalUnits(defenderForce(neighborState)) === 0 && areAtWar(state, aiPlayerId, neighborState.ownerId);
    });
    if (!targetId) continue;

    const outcome = moveUnits(state, aiPlayerId, fromId, targetId, territories, available);
    if (outcome.ok) state = outcome.gameState;
  }

  return state;
}

/** The AI's own attacker placement for a battle it just opened against a human, who hasn't
 *  deployed yet - kept out of gameState the same way a human's deployment is (see
 *  net/LocalGameClient.ts's attackerDeployment/defenderDeployment), so the human doesn't see it
 *  before committing their own. The caller (turns.ts's endTurn, then whichever net/ layer invoked
 *  it) must stash this and fold it into beginBattlePhase once the human deploys. */
export interface PendingAiDeployment {
  readonly side: 'attacker' | 'defender';
  readonly placements: readonly BattlePlacement[];
}

interface AttackPhaseResult {
  readonly gameState: GameState;
  readonly pendingAiDeployment: PendingAiDeployment | null;
}

/**
 * Opens a real tactical battle instead of resolving the attack instantly, and immediately deploys
 * the AI's own attacking force (see autoDeployForBattle). If the defender is also AI, deploys them
 * too and plays the whole battle out synchronously (cascadeAiBattleTurns) since nobody else needs
 * to be involved and leaving it pending would stall the game. If the defender is human, stops
 * right there - the battle stays pending, exactly as if they'd been attacked directly through the
 * UI, and its outcome is reported back via pendingAiDeployment.
 */
function launchAiAttack(
  gameState: GameState,
  aiPlayerId: string,
  fromId: string,
  toId: string,
  territories: readonly Territory[],
): AttackPhaseResult {
  const startOutcome = startBattle(gameState, aiPlayerId, fromId, toId, territories);
  if (!startOutcome.ok) return { gameState, pendingAiDeployment: null };
  let state = startOutcome.gameState;
  const pending = state.pendingBattle!;

  const attackerPlacements = autoDeployForBattle(pending.attackerMax, pending.subTerritories, 'attacker');
  state = markDeployed(state, 'attacker');

  const defender = state.players.find((p) => p.id === pending.defenderId);
  if (!defender?.isAI) {
    return { gameState: state, pendingAiDeployment: { side: 'attacker', placements: attackerPlacements } };
  }

  const defenderPlacements = autoDeployForBattle(pending.defenderMax, pending.subTerritories, 'defender');
  state = markDeployed(state, 'defender');
  state = beginBattlePhase(state, attackerPlacements, defenderPlacements);
  state = cascadeAiBattleTurns(state, territories);

  return { gameState: state, pendingAiDeployment: null };
}

/**
 * Attacks bordering enemies the AI is at war with, wherever it has a clear strength advantage -
 * now a real tactical battle (see launchAiAttack), not the instant simulateAttack shortcut. Stops
 * at the first attack that leaves a battle pending for a human to resolve (only one battle can be
 * pending at a time); an AI-vs-AI fight resolves fully before this loop continues to the next
 * territory. One attack attempt per territory per turn, committing everything available there.
 */
function runAiAttacks(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): AttackPhaseResult {
  let state = gameState;
  const attackStrengthMargin = difficultyProfileOf(state, aiPlayerId).attackStrengthMargin;
  const ownedIds = [...state.territoryState.entries()].filter(([, s]) => s.ownerId === aiPlayerId).map(([id]) => id);

  for (const fromId of ownedIds) {
    if (state.pendingBattle) break;
    const fromState = state.territoryState.get(fromId);
    const fromTerritory = territories.find((t) => t.id === fromId);
    if (!fromState || !fromTerritory) continue;

    const available = availableToMove(fromState);
    if (totalUnits(available) === 0) continue;
    const myStrength = battleStrength(available);

    const targetId = fromTerritory.neighbors.find((neighborId) => {
      const neighborState = state.territoryState.get(neighborId);
      if (!neighborState || !neighborState.ownerId || neighborState.ownerId === aiPlayerId) return false;
      const defenders = defenderForce(neighborState);
      if (totalUnits(defenders) === 0) return false;
      if (!areAtWar(state, aiPlayerId, neighborState.ownerId)) return false;
      const theirStrength = battleStrength(defenders) * SIMULATED_DEFENSE_MULTIPLIER;
      return myStrength > theirStrength * attackStrengthMargin;
    });
    if (!targetId) continue;

    const attackResult = launchAiAttack(state, aiPlayerId, fromId, targetId, territories);
    state = attackResult.gameState;
    if (attackResult.pendingAiDeployment) return { gameState: state, pendingAiDeployment: attackResult.pendingAiDeployment };
  }

  return { gameState: state, pendingAiDeployment: null };
}

const MAX_ECONOMY_ACTIONS = 25;
const RECRUIT_COMPOSITION = (count: number): UnitComposition => ({ infantry: count, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 });

/**
 * Spends the AI's Rüstungspunkte at its capital: factories first (raises income), then
 * infrastructure once factories are capped (raises the factory cap). Whatever's left is split by
 * this AI's own tech-affinity roll (see techAffinityOf), capped by its difficulty's
 * maxDiversifiedShare (see difficultyProfileOf - at affinity 0, or difficulty easy's very low cap,
 * this reproduces something close to the old infantry-only AI), between diversification (ground
 * and Airforce, see runAiDiversifiedSpending) and, as ever, fresh Infanterie for whatever the
 * diversified spending didn't use - so nothing is ever left unspent just because a Flugplatz was
 * already full or a diversified type turned out unaffordable this turn. A simple, single-territory
 * heuristic - not a spread-out investment strategy.
 */
function runAiEconomy(gameState: GameState, aiPlayerId: string): GameState {
  let state = gameState;
  const capitalId = state.players.find((p) => p.id === aiPlayerId)?.capitalId;
  if (!capitalId || state.territoryState.get(capitalId)?.ownerId !== aiPlayerId) return state;

  for (let i = 0; i < MAX_ECONOMY_ACTIONS; i++) {
    const balance = state.resources.get(aiPlayerId) ?? 0;
    const development = developmentAt(state, capitalId);
    if (balance >= FACTORY_COST && development.factories < factoryCapacity(development)) {
      const outcome = buildFactory(state, aiPlayerId, capitalId);
      if (outcome.ok) {
        state = outcome.gameState;
        continue;
      }
    }
    if (balance >= INFRASTRUCTURE_COST && development.infrastructureLevel < MAX_INFRASTRUCTURE_LEVEL) {
      const outcome = upgradeInfrastructure(state, aiPlayerId, capitalId);
      if (outcome.ok) {
        state = outcome.gameState;
        continue;
      }
    }
    break;
  }

  const affinity = techAffinityOf(state, aiPlayerId);
  if (affinity > 0) {
    const balance = state.resources.get(aiPlayerId) ?? 0;
    const maxDiversifiedShare = difficultyProfileOf(state, aiPlayerId).maxDiversifiedShare;
    const diversifiedBudget = Math.floor(balance * affinity * maxDiversifiedShare);
    state = runAiDiversifiedSpending(state, aiPlayerId, capitalId, diversifiedBudget);
  }

  const remainingBalance = state.resources.get(aiPlayerId) ?? 0;
  const infantryToRecruit = Math.floor(remainingBalance / UNIT_COSTS.infantry);
  if (infantryToRecruit > 0) {
    const outcome = recruitUnits(state, aiPlayerId, capitalId, RECRUIT_COMPOSITION(infantryToRecruit));
    if (outcome.ok) state = outcome.gameState;
  }

  return state;
}

/**
 * Hands the Airforce (runAiAirforceInvestment) first claim on the whole diversified `budget`,
 * then gives ground diversification (runAiGroundDiversification) whatever's actually left over -
 * deliberately sequential, not an even up-front split. A Flugplatz costs AIRFIELD_BUILD_COST
 * (15) in one lump sum; splitting a modest budget in half before it ever got there would almost
 * always land both halves under every purchase's threshold (an airfield that's just out of reach
 * *and* three ground types each too thin to afford even one unit) - which is exactly what a
 * typical mid-game diversified budget (usually in the tens, not hundreds) used to hit turn after
 * turn, silently doing nothing every time despite a non-zero budget and a real affinity roll.
 * Giving one spend first crack at the *whole* amount, instead of a fraction of it, is what
 * actually clears these lump-sum thresholds in practice. Neither sub-spend is obligated to use
 * everything it's handed; runAiEconomy sweeps whatever ends up unspent into ordinary Infanterie
 * afterward regardless, so nothing is ever wasted just because - say - the capital's Flugplatz was
 * already at capacity this turn.
 */
function runAiDiversifiedSpending(gameState: GameState, aiPlayerId: string, capitalId: string, budget: number): GameState {
  if (budget <= 0) return gameState;
  const balanceBefore = gameState.resources.get(aiPlayerId) ?? 0;

  const afterAir = runAiAirforceInvestment(gameState, aiPlayerId, capitalId, budget);
  const spentOnAir = balanceBefore - (afterAir.resources.get(aiPlayerId) ?? 0);

  return runAiGroundDiversification(afterAir, aiPlayerId, capitalId, budget - spentOnAir);
}

/**
 * Spends `budget` on Artillerie, Leichte Panzer and Schwere Panzer, in that order, each getting
 * half of whatever remains after the one before it (so Schwere Panzer, the priciest of the three,
 * only ever gets bought once there's real budget to spare). Artillerie goes first, on purpose -
 * "die KI soll auch wissen, wie Artillerie funktioniert": once it actually has some (this is the
 * only place an AI ever recruits it), engine/ai.ts's existing bombardWithArtillery puts it to use
 * in battle for free, and giving it first claim on the ground budget (rather than an equal split,
 * or leaving it for last) is what makes that actually happen reliably instead of only in the
 * occasional high-budget turn. Sequential and front-loaded for the same reason
 * runAiDiversifiedSpending hands the Airforce the whole budget rather than a fixed fraction of it -
 * an even three-way split of a modest budget used to land every share under UNIT_COSTS' per-type
 * threshold, buying nothing at all.
 */
function runAiGroundDiversification(gameState: GameState, aiPlayerId: string, capitalId: string, budget: number): GameState {
  if (budget <= 0) return gameState;
  let remaining = budget;
  const amount: Record<keyof UnitComposition, number> = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

  for (const type of ['artillery', 'lightTank'] as const) {
    const typeBudget = Math.floor(remaining / 2);
    const count = Math.floor(typeBudget / UNIT_COSTS[type]);
    amount[type] = count;
    remaining -= count * UNIT_COSTS[type];
  }
  amount.heavyTank = Math.floor(remaining / UNIT_COSTS.heavyTank);

  if (totalUnits(amount) === 0) return gameState;
  const outcome = recruitUnits(gameState, aiPlayerId, capitalId, amount);
  return outcome.ok ? outcome.gameState : gameState;
}

/**
 * Spends `budget` growing the Airforce at the capital - "die KI soll auch wissen, wie
 * Luftüberlegenheit funktioniert": builds a Flugplatz there if there isn't one yet, or upgrades it
 * once it's already full, then recruits into whatever free capacity is left, split roughly evenly
 * across Jäger/CAS/Bomber by budget share (not by capacity - Jäger and CAS are cheap enough that an
 * even budget split usually buys some of each; Bomber, by far the priciest per unit, only starts
 * appearing once there's real budget to spare). See useAirSupportInBattle/runAiAirOffense for how
 * the AI actually uses what it recruits here.
 */
function runAiAirforceInvestment(gameState: GameState, aiPlayerId: string, capitalId: string, budget: number): GameState {
  let state = gameState;
  if (budget <= 0) return state;
  let remaining = budget;

  let airfield = airfieldAt(state, capitalId);
  if (airfield.level === 0) {
    if (remaining < AIRFIELD_BUILD_COST) return state;
    const built = buildAirfield(state, aiPlayerId, capitalId);
    if (!built.ok) return state;
    state = built.gameState;
    remaining -= AIRFIELD_BUILD_COST;
  } else if (airfieldCapacity(airfield.level) - totalAircraft(airfield.aircraft) === 0 && remaining >= AIRFIELD_UPGRADE_COST) {
    const upgraded = upgradeAirfield(state, aiPlayerId, capitalId);
    if (upgraded.ok) {
      state = upgraded.gameState;
      remaining -= AIRFIELD_UPGRADE_COST;
    }
  }

  airfield = airfieldAt(state, capitalId);
  let capacityLeft = airfieldCapacity(airfield.level) - totalAircraft(airfield.aircraft);
  if (capacityLeft <= 0 || remaining <= 0) return state;

  // Aircraft are only ever recruited a whole Einheit (AIRCRAFT_PACKET_SIZE = 100 aircraft) at a
  // time (see recruitAircraft) - round each type's count down to the nearest whole Einheit, same
  // as the recruit UI's stepper does, rather than the arbitrary count budget/cost math would
  // otherwise produce (which recruitAircraft would just reject outright).
  const amount: Record<keyof AirComposition, number> = { fighters: 0, cas: 0, bombers: 0 };
  const perTypeBudget = remaining / 3;
  for (const type of ['fighters', 'cas', 'bombers'] as const) {
    if (capacityLeft <= 0) break;
    const perUnitCost = AIRCRAFT_COST_PER_100[type] / 100;
    const rawCount = Math.min(capacityLeft, Math.floor(perTypeBudget / perUnitCost));
    const count = Math.floor(rawCount / AIRCRAFT_PACKET_SIZE) * AIRCRAFT_PACKET_SIZE;
    if (count <= 0) continue;
    amount[type] = count;
    capacityLeft -= count;
  }
  if (totalAircraft(amount) === 0) return state;

  const recruited = recruitAircraft(state, aiPlayerId, capitalId, amount);
  return recruited.ok ? recruited.gameState : state;
}

/** Of the raids that do go out with a factory-bearing target available, this fraction target
 *  factories instead of units - the AI mostly still goes after the enemy's army, factories are the
 *  occasional exception, not the rule. */
const FACTORY_RAID_CHANCE = 0.3;

/**
 * Occasionally launches the AI's Airforce at an enemy it's at war with, outside of any tactical
 * battle: a Bomber raid (see engine/airforce.ts's launchBomberRaid - mostly aimed at units, an
 * occasional one aimed at factories instead, see FACTORY_RAID_CHANCE) from any Flugplatz with
 * Bomber stationed, and/or a Jäger sweep (fighterSweep) from any Flugplatz within FIGHTER_RANGE of
 * an enemy territory. Gated by the difficulty profile's airOffenseChanceScale per eligible
 * Flugplatz - keeps a high-affinity AI from emptying every Flugplatz every single turn regardless
 * of the odds already baked into how much it built up in the first place. An AI with
 * aiTechAffinity 0 never built an Airforce in the first place (see runAiEconomy), so this is
 * naturally a no-op for it without needing its own affinity check.
 */
function runAiAirOffense(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const airOffenseChanceScale = difficultyProfileOf(state, aiPlayerId).airOffenseChanceScale;
  const myAirfieldIds = [...state.airfields.keys()].filter(
    (territoryId) => state.territoryState.get(territoryId)?.ownerId === aiPlayerId,
  );

  for (const fromId of myAirfieldIds) {
    if (Math.random() >= airOffenseChanceScale) continue;

    const airfield = airfieldAt(state, fromId);
    if (airfield.aircraft.bombers > 0) {
      const target = territories.find((t) => {
        const s = state.territoryState.get(t.id);
        return s?.ownerId !== null && s?.ownerId !== aiPlayerId && s?.ownerId !== undefined && areAtWar(state, aiPlayerId, s.ownerId);
      });
      if (target) {
        const development = developmentAt(state, target.id);
        const mode: BomberRaidMode = development.factories > 0 && Math.random() < FACTORY_RAID_CHANCE ? 'factories' : 'units';
        const outcome = launchBomberRaid(state, aiPlayerId, fromId, target.id, airfield.aircraft.bombers, mode, territories);
        if (outcome.ok) state = outcome.gameState;
      }
    }

    const currentFighters = airfieldAt(state, fromId).aircraft.fighters;
    if (currentFighters > 0) {
      const target = territories.find((t) => {
        const s = state.territoryState.get(t.id);
        if (!s?.ownerId || s.ownerId === aiPlayerId || !areAtWar(state, aiPlayerId, s.ownerId)) return false;
        return territoryDistance(fromId, t.id, territories, FIGHTER_RANGE) !== null;
      });
      if (target) {
        const outcome = fighterSweep(state, aiPlayerId, fromId, target.id, currentFighters, territories);
        if (outcome.ok) state = outcome.gameState;
      }
    }
  }

  return state;
}

export interface AiTurnResult {
  readonly gameState: GameState;
  /** Set when this turn opened a tactical battle against a human who hasn't deployed yet - see
   *  runAiAttacks/launchAiAttack/PendingAiDeployment. The rest of the turn (expansion, economy) is
   *  skipped in that case, same as if the AI had simply run out of pendingBattle-blocked actions. */
  readonly pendingAiDeployment: PendingAiDeployment | null;
}

/**
 * The AI's full turn: diplomacy (accept pacts, opportunistically declare war), attack outmatched
 * enemies it's at war with, occasionally strike with its Airforce too (runAiAirOffense), expand
 * into capturable ground, then spend whatever Rüstungspunkte are left. Each pass only ever improves
 * on doing nothing - any step that finds no good move simply leaves the state untouched. Stops
 * early if an attack opens a battle a human needs to deploy for.
 */
export function playAiTurn(gameState: GameState, aiPlayerId: string, territories: readonly Territory[], seaZones: readonly SeaZone[] = []): AiTurnResult {
  let state = gameState;
  state = runAiDiplomacy(state, aiPlayerId, territories);

  // Attacks before peaceful expansion: a territory that could do either commits its whole
  // available force to just one this turn (see runAiExpansion/runAiAttacks), so pressing a
  // just-declared war takes priority over mopping up neutral ground.
  const attackResult = runAiAttacks(state, aiPlayerId, territories);
  state = attackResult.gameState;
  if (attackResult.pendingAiDeployment) return { gameState: state, pendingAiDeployment: attackResult.pendingAiDeployment };

  // Airforce actions (launchBomberRaid/fighterSweep) both refuse to run while a battle is pending,
  // same as every other action below - safe here since the early return above already guarantees
  // there isn't one left over from runAiAttacks.
  state = runAiAirOffense(state, aiPlayerId, territories);

  // Seekrieg: Landungen/Landungsangriffe, Einschiffen, Flotten in Zonen schicken - siehe runAiNaval.
  const navalResult = runAiNaval(state, aiPlayerId, territories, seaZones);
  state = navalResult.gameState;
  if (navalResult.pendingAiDeployment || state.pendingSeaBattle || state.pendingBattle) {
    return { gameState: state, pendingAiDeployment: navalResult.pendingAiDeployment };
  }

  state = runAiExpansion(state, aiPlayerId, territories);
  state = runAiShipbuilding(state, aiPlayerId, seaZones);
  state = runAiEconomy(state, aiPlayerId);
  return { gameState: state, pendingAiDeployment: null };
}

/** Ein Landgebiet an einer Seezone, das die KI dort erobern/besetzen könnte: neutral oder im Krieg befindlicher Feind. */
function isNavalTarget(state: GameState, aiPlayerId: string, territoryId: string): boolean {
  const t = state.territoryState.get(territoryId);
  if (!t || t.ownerId === aiPlayerId) return false;
  return t.ownerId === null || areAtWar(state, aiPlayerId, t.ownerId);
}

function zoneHasTargets(state: GameState, aiPlayerId: string, zone: SeaZone): boolean {
  return zone.neighbors.some((n) => state.territoryState.has(n) && isNavalTarget(state, aiPlayerId, n));
}

/** Wie attraktiv eine Zone als nächstes Fahrtziel ist: Feind im Krieg > neutral (mit Zielen davor) > eigene Zone mit Zielen. */
function zoneScore(state: GameState, aiPlayerId: string, zone: SeaZone): number {
  const z = seaStateOf(state, zone.id);
  const targets = zoneHasTargets(state, aiPlayerId, zone) ? 2 : 0;
  if (z.ownerId !== null && z.ownerId !== aiPlayerId) return 4 + targets;
  if (z.ownerId === null) return 2 + targets;
  return targets > 0 ? 1 : 0;
}

/**
 * Die Marine der KI, in dieser Reihenfolge: (1) Truppen aus Zonen an Land setzen (neutral/unverteidigt) oder bei
 * Überlegenheit als Landungsangriff; (2) Landeinheiten aus ALLEN angrenzenden eigenen Häfen in eigene Zonen mit
 * Zielen einschiffen; (3) Flotten schicken: aus Häfen in die attraktivste Zone (Feind im Krieg, sonst neutral),
 * und Flotten, die in einer Zone ohne Ziele/Truppen liegen, weiter in die nächste interessante Zone. Feindliche Flotten
 * werden schon ab 3/4 der eigenen Größe angegriffen; Seeschlachten trägt cascadeAiSeaBattle automatisch aus.
 */
function runAiNaval(gameState: GameState, aiPlayerId: string, territories: readonly Territory[], seaZones: readonly SeaZone[]): AttackPhaseResult {
  let state = gameState;
  if (seaZones.length === 0) return { gameState: state, pendingAiDeployment: null };
  const margin = difficultyProfileOf(state, aiPlayerId).attackStrengthMargin;

  // (1) Anlanden
  for (const zone of seaZones) {
    const z = seaStateOf(state, zone.id);
    if (z.ownerId !== aiPlayerId) continue;
    const available = subtractGarrisons(z.embarked, z.embarkedMovedIn);
    if (totalUnits(available) === 0) continue;
    // Unverteidigte Ziele zuerst, dann Landungsangriffe.
    const targets = zone.neighbors.filter((n) => state.territoryState.has(n) && isNavalTarget(state, aiPlayerId, n));
    targets.sort((a, b) => totalUnits(defenderForce(state.territoryState.get(a)!)) - totalUnits(defenderForce(state.territoryState.get(b)!)));
    for (const n of targets) {
      const t = state.territoryState.get(n)!;
      const defenders = defenderForce(t);
      if (totalUnits(defenders) === 0) {
        const out = disembarkUnits(state, aiPlayerId, zone.id, n, available, seaZones);
        if (out.ok) state = out.gameState;
        break;
      }
      if (battleStrength(available) > defenseStrength(defenders) * margin * 0.75) {
        const start = startAmphibiousBattle(state, aiPlayerId, zone.id, n, seaZones);
        if (!start.ok) continue;
        let s2 = start.gameState;
        const pending = s2.pendingBattle!;
        const placements = autoDeployForBattle(pending.attackerMax, pending.subTerritories, 'attacker');
        s2 = markDeployed(s2, 'attacker');
        const defender = s2.players.find((p) => p.id === pending.defenderId);
        if (!defender?.isAI) return { gameState: s2, pendingAiDeployment: { side: 'attacker', placements } };
        const defPlacements = autoDeployForBattle(pending.defenderMax, pending.subTerritories, 'defender');
        s2 = markDeployed(s2, 'defender');
        s2 = beginBattlePhase(s2, placements, defPlacements);
        return { gameState: cascadeAiBattleTurns(s2, territories), pendingAiDeployment: null };
      }
    }
  }

  // (2) Einschiffen: jeder angrenzende eigene Hafen gibt ab, was verfügbar ist (ein Mann bleibt als Wache zurück).
  for (const zone of seaZones) {
    const z = seaStateOf(state, zone.id);
    if (z.ownerId !== aiPlayerId || z.ships < 1 || !zoneHasTargets(state, aiPlayerId, zone)) continue;
    for (const n of zone.neighbors) {
      const t = state.territoryState.get(n);
      if (!t || t.ownerId !== aiPlayerId) continue;
      const avail = availableToMove(t);
      const load = { ...avail, artillery: 0, infantry: Math.max(0, avail.infantry - 1) };
      if (totalUnits(load) < 1) continue;
      const out = embarkUnits(state, aiPlayerId, n, zone.id, load, seaZones);
      if (out.ok) state = out.gameState;
    }
  }

  // (3) Flotten schicken (Hafen -> Zone, dann Zone -> Zone)
  const tryMove = (fromId: string, zone: SeaZone, ships: number): boolean => {
    const z = seaStateOf(state, zone.id);
    if (z.ownerId !== null && z.ownerId !== aiPlayerId && z.ships > ships * 1.34) return false;
    const out = moveShips(state, aiPlayerId, fromId, zone.id, ships, seaZones);
    if (!out.ok) return false;
    state = out.gameState;
    if (state.pendingSeaBattle) state = cascadeAiSeaBattle(state).gameState;
    return true;
  };
  for (const [portId, port] of [...state.territoryState.entries()]) {
    if (port.ownerId !== aiPlayerId) continue;
    const ships = availableShips(state, aiPlayerId, portId, seaZones);
    if (ships <= 0) continue;
    const options = seaZones
      .filter((zone) => zone.neighbors.includes(portId) && zoneScore(state, aiPlayerId, zone) >= 2)
      .sort((a, b) => zoneScore(state, aiPlayerId, b) - zoneScore(state, aiPlayerId, a));
    for (const zone of options) {
      if (tryMove(portId, zone, ships)) break;
      if (state.pendingSeaBattle) return { gameState: state, pendingAiDeployment: null };
    }
    if (state.pendingSeaBattle) return { gameState: state, pendingAiDeployment: null };
  }
  for (const zone of seaZones) {
    const z = seaStateOf(state, zone.id);
    if (z.ownerId !== aiPlayerId) continue;
    const ships = availableShips(state, aiPlayerId, zone.id, seaZones);
    // Truppen an Bord oder Ziele in Reichweite: die Flotte bleibt als Transporter/Deckung liegen.
    if (ships <= 0 || totalUnits(z.embarked) > 0 || zoneHasTargets(state, aiPlayerId, zone)) continue;
    const options = zone.neighbors
      .map((id) => seaZones.find((c) => c.id === id))
      .filter((c): c is SeaZone => c !== undefined && zoneScore(state, aiPlayerId, c) >= 2)
      .sort((a, b) => zoneScore(state, aiPlayerId, b) - zoneScore(state, aiPlayerId, a));
    for (const next of options) {
      if (tryMove(zone.id, next, ships)) break;
      if (state.pendingSeaBattle) return { gameState: state, pendingAiDeployment: null };
    }
    if (state.pendingSeaBattle) return { gameState: state, pendingAiDeployment: null };
  }
  return { gameState: state, pendingAiDeployment: null };
}

/**
 * Baut Schiffe in den Häfen des Reiches: Zielgröße wächst mit der Zahl der Küstengebiete (6 + 2 je Hafen, höchstens
 * 24), bezahlt mit einem Anteil des Guthabens je nach Schwierigkeit (easy 30%, medium 50%, hard 65%). Häfen an
 * Zonen mit Zielen oder Feinden kommen zuerst, die Hauptstadt bevorzugt.
 */
function runAiShipbuilding(gameState: GameState, aiPlayerId: string, seaZones: readonly SeaZone[]): GameState {
  let state = gameState;
  const ports = [...state.territoryState.entries()]
    .filter(([id, t]) => t.ownerId === aiPlayerId && isCoastal(id, seaZones))
    .map(([id]) => id);
  if (ports.length === 0) return state;
  const fleetTarget = Math.min(24, 6 + 2 * ports.length);
  const capitalId = state.players.find((p) => p.id === aiPlayerId)?.capitalId;
  const rank = (id: string): number => {
    const zones = coastalZoneIds(id, seaZones).map((zid) => seaZones.find((z) => z.id === zid)!);
    const best = Math.max(...zones.map((z) => zoneScore(state, aiPlayerId, z)));
    return best * 10 + (id === capitalId ? 5 : 0);
  };
  ports.sort((a, b) => rank(b) - rank(a));

  const fraction = { easy: 0.3, medium: 0.5, hard: 0.65 }[state.players.find((p) => p.id === aiPlayerId)?.aiDifficulty ?? 'medium'];
  let budget = Math.floor(((state.resources.get(aiPlayerId) ?? 0) * fraction) / SHIP_COST);
  let missing = fleetTarget - totalShips(state, aiPlayerId);
  for (const id of ports) {
    if (budget <= 0 || missing <= 0) break;
    const count = Math.min(budget, missing, 8);
    const out = recruitShips(state, aiPlayerId, id, count, seaZones);
    if (!out.ok) continue;
    state = out.gameState;
    budget -= count;
    missing -= count;
  }
  return state;
}

/** How many of the front-most rows (0 = the row right at the frontier) a deployment may draw
 *  from - varies how deep the AI's line sits from battle to battle. */
const DEPLOYMENT_DEPTH_OPTIONS = 3;

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * Deployment policy for when the AI is drawn into a battle, as either side - see runAiAttacks for
 * when it's the attacker, or LocalGameClient.ts/server/index.ts for when a human attacks it.
 * Randomized on purpose so the AI doesn't put its force in the same predictable pattern every
 * time: picks one of the front-most few rows at random (usually, not always, the very front),
 * a random subset of that row's cells in random order, and a randomized (not perfectly even) split
 * of the force across them. Still a simple front line, no deeper tactical judgement.
 */
export function autoDeployForBattle(
  force: UnitComposition,
  subTerritories: readonly BattleSubTerritory[],
  side: 'attacker' | 'defender',
): BattlePlacement[] {
  const sideTerritories = subTerritories.filter((t) => t.side === side && !t.isEscape && t.terrain === 'normal');
  if (sideTerritories.length === 0) return [];

  const rowsFrontToBack = [...new Set(sideTerritories.map((t) => t.row))].sort((a, b) => (side === 'attacker' ? b - a : a - b));
  const depthOptions = rowsFrontToBack.slice(0, Math.min(DEPLOYMENT_DEPTH_OPTIONS, rowsFrontToBack.length));
  const chosenRow = depthOptions[Math.floor(Math.random() * depthOptions.length)]!;
  const rowCells = shuffled(sideTerritories.filter((t) => t.row === chosenRow));
  if (rowCells.length === 0) return [];

  const useCount = Math.max(1, Math.round(rowCells.length * (0.5 + Math.random() * 0.5)));
  const cells = rowCells.slice(0, useCount);
  const weights = cells.map(() => 0.5 + Math.random());
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const amounts: Record<keyof UnitComposition, number>[] = cells.map(() => ({
    infantry: 0,
    lightTank: 0,
    heavyTank: 0,
    artillery: 0,
    motorizedInfantry: 0,
  }));
  const distribute = (type: keyof UnitComposition, count: number): void => {
    let remaining = count;
    for (let i = 0; i < cells.length && remaining > 0; i++) {
      const isLast = i === cells.length - 1;
      const share = isLast ? remaining : Math.min(remaining, Math.round((weights[i]! / totalWeight) * count));
      amounts[i]![type] += share;
      remaining -= share;
    }
  };
  distribute('infantry', force.infantry);
  distribute('lightTank', force.lightTank);
  distribute('heavyTank', force.heavyTank);
  distribute('artillery', force.artillery);

  return cells.map((t, i) => ({ subId: t.id, amount: amounts[i]! })).filter((p) => totalUnits(p.amount) > 0);
}

/** How much bolder the attacker gets, and how much more cautious the defender gets, as
 *  MAX_BATTLE_ROUNDS approaches - both sides know the clock, so an attacker running out of time
 *  starts taking fights it'd normally skip (running out the clock is a loss for them), while a
 *  defender close to outlasting it gets pickier about ever attacking or holding a losing position
 *  (simply surviving to the limit is a win for them). 1 = normal caution; multiplying a strength
 *  threshold by this shrinks it for an urgent attacker (easier to trigger an attack) and grows it
 *  for an urgent defender (harder to trigger one, and see retreatFromHopelessFights for how the
 *  same factor makes a defender let go of ground sooner, an attacker later). */
const ATTACKER_URGENCY_BOLDNESS = 0.6;
const DEFENDER_URGENCY_CAUTION = 1.2;

function timeCautionFactor(pending: PendingBattle, aiPlayerId: string): number {
  const remaining = Math.max(0, MAX_BATTLE_ROUNDS - pending.battleRound);
  const urgency = 1 - Math.min(1, remaining / MAX_BATTLE_ROUNDS); // 0 at the start, 1 at the limit
  const isAttacker = aiPlayerId === pending.attackerId;
  return isAttacker ? 1 - ATTACKER_URGENCY_BOLDNESS * urgency : 1 + DEFENDER_URGENCY_CAUTION * urgency;
}

/**
 * "Die KI soll auch wissen, wie Luftüberlegenheit funktioniert" - the in-battle half of that (see
 * runAiAirOffense for outside-of-battle Bomber raids/Jäger sweeps): if the AI owns a Flugplatz
 * eligible to call into this fight (the contested territory itself, or one of its main-map
 * neighbors - the same rule callAirSupport itself enforces) and doesn't already have Jäger or CAS
 * called in, calls in everything stationed there at once. Then strikes with every 'ready' CAS
 * against whichever enemy-held cell currently holds the most units - the same "hit the biggest
 * stack" idea as bombardWithArtillery, just with air power instead of ground artillery. A no-op
 * for an AI with no eligible Flugplatz nearby, or nothing left to call or strike with - which is
 * to say, in practice, a no-op for any AI whose tech-affinity roll never had it build one (see
 * runAiEconomy/techAffinityOf).
 */
function useAirSupportInBattle(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const pending0 = state.pendingBattle;
  if (!pending0?.subState) return state;
  const side: 'attacker' | 'defender' = aiPlayerId === pending0.attackerId ? 'attacker' : 'defender';

  const contested = territories.find((t) => t.id === pending0.territoryId);
  const eligibleSourceIds = [pending0.territoryId, ...(contested?.neighbors ?? [])];
  const sourceId = eligibleSourceIds.find((id) => {
    const territoryState = state.territoryState.get(id);
    return territoryState?.ownerId === aiPlayerId && airfieldAt(state, id).level > 0;
  });

  if (sourceId) {
    const hasFightersOut = state.pendingBattle!.calledAircraft.some(
      (c) => c.side === side && c.type === 'fighter' && c.status !== 'returning',
    );
    const fighterAirfield = airfieldAt(state, sourceId);
    if (!hasFightersOut && fighterAirfield.aircraft.fighters > 0) {
      const outcome = callAirSupport(state, aiPlayerId, 'fighter', sourceId, fighterAirfield.aircraft.fighters, territories);
      if (outcome.ok) state = outcome.gameState;
    }

    const hasCasOut = state.pendingBattle?.calledAircraft.some(
      (c) => c.side === side && c.type === 'cas' && c.status !== 'returning',
    ) ?? false;
    const casAirfield = airfieldAt(state, sourceId);
    if (!hasCasOut && casAirfield.aircraft.cas > 0) {
      // Rejected outright (see callAirSupport) unless this side already holds over
      // CAS_MIN_AIR_SUPERIORITY of the battle's Jäger - a harmless no-op attempt otherwise, no
      // need to pre-check that here too.
      const outcome = callAirSupport(state, aiPlayerId, 'cas', sourceId, casAirfield.aircraft.cas, territories);
      if (outcome.ok) state = outcome.gameState;
    }
  }

  for (;;) {
    const readyCas = state.pendingBattle?.calledAircraft.find((c) => c.side === side && c.type === 'cas' && c.status === 'ready');
    if (!readyCas) break;
    const subState = state.pendingBattle?.subState;
    if (!subState) break;

    let bestTargetId: string | null = null;
    let bestUnits = 0;
    for (const [id, cellState] of subState) {
      if (cellState.ownerId === aiPlayerId) continue;
      const total = totalUnits(cellState.garrison);
      if (total > bestUnits) {
        bestUnits = total;
        bestTargetId = id;
      }
    }
    if (!bestTargetId) break;

    const outcome = casStrike(state, aiPlayerId, readyCas.id, bestTargetId, territories);
    if (!outcome.ok) break; // guards against looping forever if casStrike keeps rejecting
    state = outcome.gameState;
    if (!state.pendingBattle) break;
  }

  return state;
}

/**
 * Fires every bit of available artillery at whichever reachable enemy cell (within
 * ARTILLERY_RANGE, no adjacency needed) currently holds the most Infanterie - a free, no-lookahead
 * "soften the biggest stack" heuristic, run before the AI's ordinary adjacent attacks each turn.
 * Artillery that has nothing worth targeting in range just sits idle this turn (see
 * bombardBattleCell - firing at an empty-of-infantry cell is rejected outright).
 */
function bombardWithArtillery(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const pending = state.pendingBattle;
  if (!pending?.subState) return state;

  for (const cell of pending.subTerritories) {
    const subState = state.pendingBattle?.subState;
    if (!subState) break;

    const cellState = subState.get(cell.id);
    if (!cellState || cellState.ownerId !== aiPlayerId) continue;
    const availableArtillery = cellState.garrison.artillery - cellState.movedIn.artillery;
    if (availableArtillery <= 0) continue;

    let bestTargetId: string | null = null;
    let bestInfantry = 0;
    for (const other of pending.subTerritories) {
      if (subTerritoryDistance(cell, other) > ARTILLERY_RANGE) continue;
      const otherState = subState.get(other.id);
      if (!otherState || otherState.ownerId === aiPlayerId) continue;
      if (otherState.garrison.infantry > bestInfantry) {
        bestInfantry = otherState.garrison.infantry;
        bestTargetId = other.id;
      }
    }
    if (!bestTargetId) continue;

    const outcome = bombardBattleCell(state, aiPlayerId, cell.id, bestTargetId, availableArtillery, territories);
    if (!outcome.ok) continue;
    state = outcome.gameState;
    if (!state.pendingBattle) break;
  }

  return state;
}

/**
 * Attacks an adjacent enemy-held cell wherever the AI can beat it (accounting for the defender's
 * DEFENSE_MULTIPLIER bonus), committing that cell's whole available force - the required edge
 * shrinks for an attacker running low on time and grows for a defender close to outlasting it (see
 * timeCautionFactor). One attack per cell, no lookahead beyond that.
 */
function attackFavorableTargets(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const pending = state.pendingBattle;
  if (!pending?.subState) return state;
  const caution = timeCautionFactor(pending, aiPlayerId);

  for (const cell of pending.subTerritories) {
    const subState = state.pendingBattle?.subState;
    if (!subState) break;

    const cellState = subState.get(cell.id);
    if (!cellState || cellState.ownerId !== aiPlayerId) continue;
    const available = subtractGarrisons(cellState.garrison, cellState.movedIn);
    if (totalUnits(available) === 0) continue;
    // Artillery has no melee attack value (see UnitComposition) and shouldn't be dragged into an
    // adjacent assault it can't contribute to - it stays behind, kept in position for
    // bombardWithArtillery instead. Only the rest of the available force is ever committed here.
    const attackForce: UnitComposition = { ...available, artillery: 0 };
    if (totalUnits(attackForce) === 0) continue;
    const myStrength = battleStrength(attackForce);

    const targetId = cell.neighbors.find((neighborId) => {
      const neighborState = subState.get(neighborId);
      if (!neighborState || neighborState.ownerId === aiPlayerId || totalUnits(neighborState.garrison) === 0) return false;
      return myStrength > defenseStrength(neighborState.garrison) * caution;
    });
    if (!targetId) continue;

    const outcome = moveBattleUnits(state, aiPlayerId, cell.id, targetId, attackForce, territories);
    if (!outcome.ok) continue;
    state = outcome.gameState;
    if (outcome.concluded) break;
  }

  return state;
}

/** The strongest single enemy cell touching `cell` - what it would face if the enemy attacked it
 *  next. 0 if nothing adjacent is enemy-held. */
function strongestAdjacentEnemyStrength(
  cell: BattleSubTerritory,
  subState: ReadonlyMap<string, { readonly ownerId: string; readonly garrison: UnitComposition }>,
  aiPlayerId: string,
): number {
  let max = 0;
  for (const neighborId of cell.neighbors) {
    const neighborState = subState.get(neighborId);
    if (neighborState && neighborState.ownerId !== aiPlayerId) max = Math.max(max, battleStrength(neighborState.garrison));
  }
  return max;
}

/**
 * For contact cells that can't survive what's next to them (the strongest adjacent enemy cell
 * would beat their DEFENSE_MULTIPLIER-boosted strength outright): pulls back to a neighboring own/
 * empty cell that isn't itself facing an even worse threat, trading ground to keep the force alive
 * rather than losing it for nothing. If nowhere safer exists, stands its ground - retreating
 * further into a worse spot would just delay the same loss. Uses the same timeCautionFactor as
 * attackFavorableTargets, but divided rather than multiplied: a defender running low on time lets
 * go of shaky ground sooner (protects the force it needs to just survive the clock), while an
 * attacker running low holds on longer (accepts the risk rather than waste turns falling back).
 */
function retreatFromHopelessFights(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const pending = state.pendingBattle;
  if (!pending?.subState) return state;
  const caution = timeCautionFactor(pending, aiPlayerId);

  for (const cell of pending.subTerritories) {
    const subState = state.pendingBattle?.subState;
    if (!subState) break;

    const cellState = subState.get(cell.id);
    if (!cellState || cellState.ownerId !== aiPlayerId) continue;
    const available = subtractGarrisons(cellState.garrison, cellState.movedIn);
    if (totalUnits(available) === 0) continue;

    const threat = strongestAdjacentEnemyStrength(cell, subState, aiPlayerId);
    if (threat === 0 || defenseStrength(cellState.garrison) / caution > threat) continue; // untouched, or can hold

    const saferNeighborId = cell.neighbors.find((neighborId) => {
      const neighborState = subState.get(neighborId);
      if (!neighborState || (neighborState.ownerId !== aiPlayerId && totalUnits(neighborState.garrison) > 0)) return false;
      const neighborCell = pending.subTerritories.find((t) => t.id === neighborId)!;
      // The escape row looks empty and threat-free like any other quiet edge cell, but
      // moveBattleUnits (rightly) refuses to ever place units there - only escapeBattle may, and
      // that's a deliberate withdrawal onto the main map, not a same-turn defensive sidestep. Skip
      // it here so a genuinely reachable safer cell isn't passed over for one that would just fail.
      if (neighborCell.isEscape) return false;
      return strongestAdjacentEnemyStrength(neighborCell, subState, aiPlayerId) < threat;
    });
    if (!saferNeighborId) continue;

    const outcome = moveBattleUnits(state, aiPlayerId, cell.id, saferNeighborId, available, territories);
    if (outcome.ok) state = outcome.gameState;
  }

  return state;
}

/** The AI's own cells currently touching at least one enemy-occupied cell - already at the front,
 *  win or not. attackFavorableTargets already tries a winning strike from here every turn; what a
 *  cell stuck here is usually missing is the combined strength to ever land one, which is exactly
 *  what reinforceFront sends its way - without that, a front cell just stands in front of the
 *  enemy forever instead of ever finishing them off. */
function frontCellIds(
  subTerritories: readonly BattleSubTerritory[],
  subState: ReadonlyMap<string, { readonly ownerId: string; readonly garrison: UnitComposition }>,
  aiPlayerId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const cell of subTerritories) {
    if (subState.get(cell.id)?.ownerId !== aiPlayerId) continue;
    const touchesEnemy = cell.neighbors.some((neighborId) => {
      const neighborState = subState.get(neighborId);
      return neighborState && neighborState.ownerId !== aiPlayerId && totalUnits(neighborState.garrison) > 0;
    });
    if (touchesEnemy) ids.add(cell.id);
  }
  return ids;
}

/** Multi-source BFS distance (in 8-directional steps, through cells the AI could actually stand
 *  on - its own, or empty ground) from every reachable cell to the nearest one in `seedIds`. */
function distancesFrom(
  subTerritories: readonly BattleSubTerritory[],
  subState: ReadonlyMap<string, { readonly ownerId: string; readonly garrison: UnitComposition }>,
  aiPlayerId: string,
  seedIds: ReadonlySet<string>,
): Map<string, number> {
  const byId = new Map(subTerritories.map((t) => [t.id, t]));
  const distance = new Map<string, number>();
  const queue: string[] = [];
  for (const id of seedIds) {
    distance.set(id, 0);
    queue.push(id);
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const d = distance.get(id)!;
    const cell = byId.get(id);
    if (!cell) continue;
    for (const neighborId of cell.neighbors) {
      if (distance.has(neighborId)) continue;
      const neighborState = subState.get(neighborId);
      const passable = neighborState && (neighborState.ownerId === aiPlayerId || totalUnits(neighborState.garrison) === 0);
      if (!passable) continue;
      distance.set(neighborId, d + 1);
      queue.push(neighborId);
    }
  }
  return distance;
}

/**
 * For cells with available force that found nothing worth attacking or retreating from this
 * battle-turn: masses them where they're actually needed, in priority order -
 *   1. any of the AI's own cities currently under direct threat (a front cell that's also a city -
 *      losing all 6 loses the battle outright for the attacker, or costs the defender their
 *      surest path to holding out, so these come first),
 *   2. any front cell at all, city or not - reinforcing a fight already underway,
 *   3. straight toward wherever the enemy's forces are, if there's no contact anywhere yet.
 * A cell already sitting at the front stays put and keeps trying attackFavorableTargets each turn
 * rather than being redirected elsewhere - it doesn't abandon a fight it's already in just because
 * a city elsewhere needs help too; only genuine reserves (not currently touching any enemy) get
 * sent marching. This is what turns "stands in front of the enemy but never finishes them" into
 * an actual concentration of force over a few battle-turns, and what makes a threatened city draw
 * help before some other, less urgent front does. A no-op once nothing needs reinforcing and no
 * enemy remains anywhere reachable.
 */
function reinforceFront(gameState: GameState, aiPlayerId: string, territories: readonly Territory[]): GameState {
  let state = gameState;
  const pending = state.pendingBattle;
  if (!pending?.subState) return state;

  const front = frontCellIds(pending.subTerritories, pending.subState, aiPlayerId);
  const threatenedCities = new Set(
    [...front].filter((id) => pending.subTerritories.find((t) => t.id === id)?.isCity),
  );

  let seedIds: ReadonlySet<string>;
  let fallbackToEnemySeed = false;
  if (threatenedCities.size > 0) {
    seedIds = threatenedCities;
  } else if (front.size > 0) {
    seedIds = front;
  } else {
    seedIds = new Set(
      [...pending.subState.entries()].filter(([, s]) => s.ownerId !== aiPlayerId && totalUnits(s.garrison) > 0).map(([id]) => id),
    );
    fallbackToEnemySeed = true;
  }
  if (seedIds.size === 0) return state;

  const distances = distancesFrom(pending.subTerritories, pending.subState, aiPlayerId, seedIds);
  // Seeded from my own cells (priorities 1-2): distance 0 means "already there". Seeded from the
  // enemy's cells (priority 3, no contact yet): distance 1 means "already touching one" instead.
  const alreadyThereDistance = fallbackToEnemySeed ? 1 : 0;

  for (const cell of pending.subTerritories) {
    const subState = state.pendingBattle?.subState;
    if (!subState) break;
    if (front.has(cell.id)) continue; // already fighting its own corner - doesn't get pulled away

    const cellState = subState.get(cell.id);
    if (!cellState || cellState.ownerId !== aiPlayerId) continue;
    const available = subtractGarrisons(cellState.garrison, cellState.movedIn);
    if (totalUnits(available) === 0) continue;

    const myDistance = distances.get(cell.id);
    if (myDistance === undefined || myDistance <= alreadyThereDistance) continue;

    const targetId = cell.neighbors.find((neighborId) => {
      const neighborState = subState.get(neighborId);
      if (!neighborState || (neighborState.ownerId !== aiPlayerId && totalUnits(neighborState.garrison) > 0)) return false;
      // Never route reinforcements onto the escape row itself - moveBattleUnits refuses that (see
      // retreatFromHopelessFights for why), it's not a real waypoint to march through.
      if (pending.subTerritories.find((t) => t.id === neighborId)?.isEscape) return false;
      return (distances.get(neighborId) ?? Infinity) < myDistance;
    });
    if (!targetId) continue;

    const outcome = moveBattleUnits(state, aiPlayerId, cell.id, targetId, available, territories);
    if (outcome.ok) state = outcome.gameState;
  }

  return state;
}

/**
 * One battle-turn's worth of tactical decisions for whichever side is currently active and AI-
 * controlled: calls in and strikes with any Jäger/CAS it has available first (useAirSupportInBattle
 * - "die KI soll wissen, wie Luftüberlegenheit funktioniert"), fires any available artillery at the
 * biggest reachable Infanterie stack next (bombardWithArtillery - free, no adjacency needed),
 * attacks wherever it has a clear local advantage (attackFavorableTargets), pulls back anything
 * about to be wiped for nothing (retreatFromHopelessFights), then masses whatever's left where it's
 * most needed - a threatened city first, any other front line second, straight at the enemy if
 * there's no contact yet (reinforceFront) - so the AI keeps working to actually end the battle and
 * defend what matters, rather than settling for camping out the round limit. A straightforward
 * heuristic, not exhaustive tactical play, but a real improvement over always passing - and, unlike
 * a fixed "march forward" rule, actually reacts to where the fight is and whether a given cell can
 * hold, rather than moving blindly. The caller (cascadeAiBattleTurns) still ends the turn afterwards
 * regardless of what this did or didn't do.
 */
export function playAiBattleMoves(gameState: GameState, territories: readonly Territory[]): GameState {
  const pending = gameState.pendingBattle;
  if (!pending?.subState || !pending.activeSide) return gameState;
  const aiPlayerId = pending.activeSide === 'attacker' ? pending.attackerId : pending.defenderId;

  let state = useAirSupportInBattle(gameState, aiPlayerId, territories);
  if (!state.pendingBattle) return state;
  state = bombardWithArtillery(state, aiPlayerId, territories);
  if (!state.pendingBattle) return state;
  state = attackFavorableTargets(state, aiPlayerId, territories);
  if (!state.pendingBattle) return state;
  state = retreatFromHopelessFights(state, aiPlayerId, territories);
  if (!state.pendingBattle) return state;
  state = reinforceFront(state, aiPlayerId, territories);
  return state;
}

/** Ab dieser Kampfrunde bietet die KI von sich aus ein Unentschieden an (wenn aiWantsDraw gilt). */
const AI_DRAW_OFFER_MIN_ROUND = 10;

/** Alle Einheiten eines Spielers auf dem taktischen Schlachtfeld. */
function unitsOnBattlefield(pending: PendingBattle, ownerId: string): UnitComposition {
  let total: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };
  for (const cell of pending.subState?.values() ?? []) {
    if (cell.ownerId === ownerId) {
      total = {
        infantry: total.infantry + cell.garrison.infantry,
        lightTank: total.lightTank + cell.garrison.lightTank,
        heavyTank: total.heavyTank + cell.garrison.heavyTank,
        artillery: total.artillery + cell.garrison.artillery,
        motorizedInfantry: total.motorizedInfantry + cell.garrison.motorizedInfantry,
      };
    }
  }
  return total;
}

/**
 * Die Unentschieden-Heuristik der KI: keine Seite hat noch Artillerie auf dem Feld (sie könnte aus der Ferne noch
 * etwas bewegen) UND der Angreifer kann den Verteidiger nicht mehr schlagen, ohne selbst zu verlieren, gemessen als
 * Angreifer-Stärke <= Verteidiger-Stärke auf dem Schlachtfeld (battleStrength der jeweils noch vorhandenen Einheiten).
 */
export function aiWantsDraw(pending: PendingBattle): boolean {
  if (!pending.subState) return false;
  const attacker = unitsOnBattlefield(pending, pending.attackerId);
  const defender = unitsOnBattlefield(pending, pending.defenderId);
  if (attacker.artillery > 0 || defender.artillery > 0) return false;
  return battleStrength(attacker) <= battleStrength(defender);
}

/** Kein einziger Soldat - Ausgangspunkt für die Summen der Kampfeinschätzung. */
const NO_UNITS: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

/** Wie sich der Kampf aus Sicht des Angreifers entwickeln kann - siehe battleOutlook. */
interface BattleOutlook {
  /** Der Angreifer könnte unter günstigen Annahmen noch gewinnen (eigene Artillerie und Luftunterstützung treffen, Städte
   *  und Truppen liegen erreichbar) - nur wenn selbst das nicht reicht, ist er chancenlos. */
  readonly attackerMayWin: boolean;
  /** Der Angreifer gewinnt auch unter ungünstigen Annahmen (die Artillerie und Luftunterstützung des Verteidigers dezimiert ihn,
   *  seine eigene trifft nicht) - nur dann ist der Verteidiger verloren. */
  readonly attackerSurelyWins: boolean;
}

/** Ein Feld angreifen kostet so viel Stärke, wie es verteidigt (der Verteidiger zählt dort 1,5-fach, siehe combat.ts's
 *  defenseStrength) - hier für eine reine Stärkezahl. */
function costToBreak(strength: number): number {
  return defenseStrength({ ...NO_UNITS, infantry: Math.max(0, strength) });
}

/** Wie viele Züge der Angreifer noch hat, bevor die Uhr abläuft und der Verteidiger gewinnt (siehe combat.ts's
 *  MAX_BATTLE_ROUNDS; in jeder Runde zieht der Angreifer nach dem Verteidiger). */
function attackerTurnsLeft(pending: PendingBattle): number {
  return Math.max(0, MAX_BATTLE_ROUNDS - pending.battleRound + 1);
}

/** CAS-Schläge, die eine Seite noch ausführen kann (unterwegs oder bereit) - je Flugzeug-Einheit ein Schlag mit
 *  CAS_STRIKE_DAMAGE_PER_UNIT Stärke Schaden. */
function pendingCasDamage(pending: PendingBattle, side: 'attacker' | 'defender'): number {
  let damage = 0;
  for (const aircraft of pending.calledAircraft) {
    if (aircraft.side === side && aircraft.type === 'cas' && (aircraft.status === 'incoming' || aircraft.status === 'ready')) {
      damage += aircraft.count * CAS_STRIKE_DAMAGE_PER_UNIT;
    }
  }
  return damage;
}

/** Wie viele Kampfzüge der Angreifer mindestens braucht, um jedes der Felder `targets` zu erreichen - der Weg zum entferntesten,
 *  in Luftlinie auf dem Raster (Hindernisse und Tempo außer Acht gelassen, also eine Untergrenze). Unendlich, wenn er gar keine
 *  Truppen mehr hat. */
function turnsToReach(pending: PendingBattle, targets: readonly BattleSubTerritory[]): number {
  const subState = pending.subState;
  if (!subState) return Number.POSITIVE_INFINITY;
  const starts = pending.subTerritories.filter((t) => {
    const cell = subState.get(t.id);
    return cell?.ownerId === pending.attackerId && totalUnits(cell.garrison) > 0;
  });
  if (starts.length === 0) return Number.POSITIVE_INFINITY;
  let farthest = 0;
  for (const target of targets) {
    farthest = Math.max(farthest, Math.min(...starts.map((start) => subTerritoryDistance(start, target))));
  }
  return farthest;
}

/**
 * Grobe Prognose des Kampfausgangs, nur aus dem Schlachtfeld selbst (Stärke, Feld-Verteidigungsbonus, Artillerie,
 * Luftunterstützung, Städte, Restzeit): Der Angreifer gewinnt, indem er den Verteidiger vernichtet oder alle 6 Städte hält,
 * bevor die Uhr abläuft; sonst gewinnt der Verteidiger. Jedes Feld, das er stürmt, kostet ihn die 1,5-fache Stärke der
 * Besatzung (costToBreak) - ohne Übermacht kommt er also nicht durch. Zwei bewusst gegensätzliche Annahmen, damit die KI nur
 * dann aufgibt, wenn die Lage eindeutig ist (siehe BattleOutlook):
 * - günstig für den Angreifer: eigene Artillerie/CAS treffen, feindliche nicht; Städte, die gerade schwach besetzt sind, zählen als
 *   erreichbar (der Verteidiger könnte sie zwar noch verstärken, muss es aber nicht);
 * - ungünstig für ihn: feindliche Artillerie/CAS dezimiert ihn, seine eigene trifft nicht, der Verteidiger verschanzt sich
 *   mit allem, was er hat, und der Angreifer braucht Reserve in der Zeit.
 */
function battleOutlook(pending: PendingBattle): BattleOutlook {
  const subState = pending.subState;
  if (!subState) return { attackerMayWin: true, attackerSurelyWins: false }; // noch keine Kampfphase: keine Aussage
  const attacker = unitsOnBattlefield(pending, pending.attackerId);
  const defender = unitsOnBattlefield(pending, pending.defenderId);
  const turns = attackerTurnsLeft(pending);
  if (turns === 0 || totalUnits(attacker) === 0) return { attackerMayWin: false, attackerSurelyWins: false };

  const attackerStrength = battleStrength(attacker);
  const defenderStrength = battleStrength(defender);
  // Feuer auf Distanz über die restliche Zeit: Artillerie tötet je Zug höchstens eine Infanterie pro Geschütz, ein CAS-Schlag
  // wirft Stärke ab.
  const attackerFire = Math.min(defender.infantry, attacker.artillery * turns) + pendingCasDamage(pending, 'attacker');
  const defenderFire = Math.min(attacker.infantry, defender.artillery * turns) + pendingCasDamage(pending, 'defender');

  // Günstig für den Angreifer.
  const citiesToTake = pending.subTerritories.filter((t) => t.isCity && subState.get(t.id)?.ownerId !== pending.attackerId);
  let cityCost = 0;
  for (const city of citiesToTake) {
    const cell = subState.get(city.id);
    if (cell && cell.ownerId === pending.defenderId) cityCost += defenseStrength(cell.garrison);
  }
  const cityCostAfterFire = Math.max(0, cityCost - defenseStrength({ ...NO_UNITS, infantry: attackerFire }));
  const defendersLeft = pending.subTerritories.filter((t) => {
    const cell = subState.get(t.id);
    return cell?.ownerId === pending.defenderId && totalUnits(cell.garrison) > 0;
  });
  const citiesInTime = turns >= turnsToReach(pending, citiesToTake);
  const defendersInTime = turns >= turnsToReach(pending, defendersLeft);
  const wipeCost = costToBreak(Math.max(0, defenderStrength - attackerFire));
  // Reine Artillerie kann eine Truppe aus lauter Infanterie ganz allein aufreiben.
  const infantryOnly = defender.lightTank + defender.heavyTank + defender.motorizedInfantry + defender.artillery === 0;
  const artilleryWipes = attacker.artillery > 0 && infantryOnly && attacker.artillery * turns >= defender.infantry;
  const attackerMayWin =
    artilleryWipes ||
    (citiesInTime && attackerStrength > cityCostAfterFire) ||
    (defendersInTime && attackerStrength > wipeCost);

  // Ungünstig für den Angreifer: er muss alles brechen, was der Verteidiger hat, und dafür genug Zeit haben.
  const attackerLeft = Math.max(0, attackerStrength - defenderFire);
  const attackerSurelyWins = attackerLeft > costToBreak(defenderStrength) && turns >= turnsToReach(pending, defendersLeft) + 2;

  return { attackerMayWin, attackerSurelyWins };
}

/**
 * Kann die KI-Seite `aiId` den Kampf noch gewinnen? Bewusst vorsichtig - "kann nicht mehr gewinnen" heißt hier: unter den
 * für sie günstigsten Annahmen bleibt kein Weg zum Sieg (siehe battleOutlook):
 * - Als Angreifer ist sie chancenlos, wenn sie weder die Verteidigung brechen noch die Städte einnehmen kann (Feld-Bonus, Zeit
 *   und Feuer auf Distanz eingerechnet) - nicht schon, wenn sie nur etwas schwächer aussieht.
 * - Als Verteidiger ist sie verloren, wenn der Angreifer sie auch im ungünstigsten Fall überrollt; solange er sie nicht sicher
 *   überrollt, gewinnt sie mindestens die Uhr.
 */
export function aiCanStillWin(pending: PendingBattle, aiId: string): boolean {
  const outlook = battleOutlook(pending);
  return pending.attackerId === aiId ? outlook.attackerMayWin : !outlook.attackerSurelyWins;
}

/**
 * Das Unentschieden-Verhalten der KI-Seite `aiId` in einem laufenden Kampf.
 * Annehmen (ein Angebot des Gegners liegt vor): wenn aiWantsDraw gilt (der Angreifer kommt gegen den Verteidiger nicht mehr an)
 * ODER die KI den Kampf nicht mehr gewinnen kann (aiCanStillWin) - ein Unentschieden ist dann besser als die Niederlage.
 * Anbieten (`mayOffer`): wie bisher nur, wenn aiWantsDraw gilt und der Kampf mindestens AI_DRAW_OFFER_MIN_ROUND Runden läuft.
 * Ein noch offenes Angebot des Gegners prüft die KI zu Beginn jedes eigenen Kampfzugs erneut (cascadeAiBattleTurns), sie nimmt es
 * also auch dann noch an, wenn sich ihre Lage erst später aussichtslos entwickelt. Nutzt dieselbe Engine-Aktion wie der Button der
 * Menschen (proposeBattleDraw). `concluded` ist gesetzt, wenn dadurch (beidseitige Zustimmung) die Schlacht endete.
 */
export function aiHandleDraw(
  gameState: GameState,
  aiId: string,
  mayOffer: boolean,
): { readonly gameState: GameState; readonly concluded: BattleResult | null } {
  const pending = gameState.pendingBattle;
  if (!pending?.subState) return { gameState, concluded: null };
  const isAttacker = pending.attackerId === aiId;
  if (!isAttacker && pending.defenderId !== aiId) return { gameState, concluded: null };
  const alreadyOffered = isAttacker ? pending.attackerDrawOffer : pending.defenderDrawOffer;
  const opponentOffered = isAttacker ? pending.defenderDrawOffer : pending.attackerDrawOffer;
  if (alreadyOffered) return { gameState, concluded: null };
  const accept = !!opponentOffered && (aiWantsDraw(pending) || !aiCanStillWin(pending, aiId));
  const offer = !opponentOffered && mayOffer && pending.battleRound >= AI_DRAW_OFFER_MIN_ROUND && aiWantsDraw(pending);
  if (!accept && !offer) return { gameState, concluded: null };
  const out = proposeBattleDraw(gameState, aiId);
  return out.ok ? { gameState: out.gameState, concluded: out.concluded } : { gameState, concluded: null };
}

/** Nach einer Aktion eines Menschen (z.B. seinem Unentschieden-Angebot): lässt jede beteiligte KI darauf reagieren. */
export function respondAiToDrawOffers(gameState: GameState): { readonly gameState: GameState; readonly concluded: BattleResult | null } {
  const pending = gameState.pendingBattle;
  if (!pending) return { gameState, concluded: null };
  let state = gameState;
  for (const id of [pending.attackerId, pending.defenderId]) {
    if (!state.players.find((p) => p.id === id)?.isAI) continue;
    const out = aiHandleDraw(state, id, false);
    state = out.gameState;
    if (out.concluded) return out;
  }
  return { gameState: state, concluded: null };
}

/** Hard cap on AI-vs-AI battle-turns before forceConcludeBattle steps in - generous (a real fight
 *  concludes in a handful of turns), just a safety net against a heuristic stalemate. */
const MAX_AI_VS_AI_BATTLE_TURNS = 300;

/**
 * Plays out every consecutive AI-controlled turn within a tactical battle, starting from whichever
 * side is currently active - used both when a human ends their own battle-turn (letting any AI
 * opponent take theirs immediately, see net/LocalGameClient.ts and server/index.ts) and, fully
 * self-contained, when an AI's own attack turns out to be against another AI (see launchAiAttack)
 * and nobody else needs to be involved at all. Stops the moment it's a human's turn to act, or the
 * battle concludes - and if it's AI on both sides and neither's heuristics ever finds a profitable
 * move against the other, forces a conclusion after MAX_AI_VS_AI_BATTLE_TURNS rather than looping
 * forever (see combat.ts's forceConcludeBattle).
 */
export function cascadeAiBattleTurns(gameState: GameState, territories: readonly Territory[]): GameState {
  let state = gameState;
  let turnsPlayed = 0;
  while (state.pendingBattle?.activeSide) {
    if (turnsPlayed++ >= MAX_AI_VS_AI_BATTLE_TURNS) {
      state = forceConcludeBattle(state, territories);
      break;
    }
    const activeId =
      state.pendingBattle.activeSide === 'attacker' ? state.pendingBattle.attackerId : state.pendingBattle.defenderId;
    const activePlayer = state.players.find((p) => p.id === activeId);
    if (!activePlayer?.isAI) break;
    state = aiHandleDraw(state, activeId, true).gameState;
    if (!state.pendingBattle) break;
    state = playAiBattleMoves(state, territories);
    if (!state.pendingBattle) break;
    const outcome = endBattleTurn(state, activeId, territories);
    if (!outcome.ok) break;
    state = outcome.gameState;
  }
  return state;
}
