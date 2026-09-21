import type { DiplomacyState, DiplomaticRelation, GameState } from './types';

const DEFAULT_RELATION: DiplomaticRelation = { atWar: false, pact: null };

/** A non-aggression pact, once cancelled, still blocks a new war for this many rounds. */
export const PACT_COOLDOWN_ROUNDS = 3;

export function emptyDiplomacyState(): DiplomacyState {
  return { relations: new Map(), pactProposals: new Set() };
}

/** Order-independent key for a pair of players - a relation applies to both sides equally. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function proposalKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

export function getRelation(gameState: GameState, a: string, b: string): DiplomaticRelation {
  if (a === b) return DEFAULT_RELATION;
  return gameState.diplomacy.relations.get(pairKey(a, b)) ?? DEFAULT_RELATION;
}

/** Whether `a` and `b` may currently fight - see engine/combat.ts's startBattle/simulateAttack,
 *  which both gate on this before allowing an attack. */
export function areAtWar(gameState: GameState, a: string, b: string): boolean {
  return getRelation(gameState, a, b).atWar;
}

export function hasPendingProposal(gameState: GameState, fromId: string, toId: string): boolean {
  return gameState.diplomacy.pactProposals.has(proposalKey(fromId, toId));
}

function canDeclareWar(relation: DiplomaticRelation, currentRound: number): boolean {
  if (relation.atWar) return false;
  if (!relation.pact) return true;
  if (relation.pact.active) return false;
  return currentRound > relation.pact.blocksWarUntilRound;
}

export type DiplomacyOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

function validateTarget(gameState: GameState, playerId: string, targetId: string): string | null {
  if (gameState.activePlayerId !== playerId) return 'Du bist nicht am Zug.';
  if (playerId === targetId) return 'Ungültiges Ziel.';
  if (!gameState.players.some((p) => p.id === targetId)) return 'Unbekannter Spieler.';
  return null;
}

export function declareWar(gameState: GameState, playerId: string, targetId: string): DiplomacyOutcome {
  const invalid = validateTarget(gameState, playerId, targetId);
  if (invalid) return { ok: false, reason: invalid };

  const relation = getRelation(gameState, playerId, targetId);
  if (!canDeclareWar(relation, gameState.turn)) {
    if (relation.atWar) return { ok: false, reason: 'Ihr befindet euch bereits im Krieg.' };
    return { ok: false, reason: 'Ein Nichtangriffspakt verhindert derzeit eine Kriegserklärung.' };
  }

  const nextRelations = new Map(gameState.diplomacy.relations);
  nextRelations.set(pairKey(playerId, targetId), { atWar: true, pact: null });
  return {
    ok: true,
    gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, relations: nextRelations } },
  };
}

/** Proposes a non-aggression pact. Once the other side has proposed one back, it activates
 *  immediately (which also ends any war between them). */
export function proposePact(gameState: GameState, playerId: string, targetId: string): DiplomacyOutcome {
  const invalid = validateTarget(gameState, playerId, targetId);
  if (invalid) return { ok: false, reason: invalid };

  const relation = getRelation(gameState, playerId, targetId);
  if (relation.pact?.active) return { ok: false, reason: 'Es besteht bereits ein Pakt.' };
  if (hasPendingProposal(gameState, playerId, targetId)) {
    return { ok: false, reason: 'Angebot bereits gesendet.' };
  }

  const nextProposals = new Set(gameState.diplomacy.pactProposals);
  if (hasPendingProposal(gameState, targetId, playerId)) {
    nextProposals.delete(proposalKey(targetId, playerId));
    const nextRelations = new Map(gameState.diplomacy.relations);
    nextRelations.set(pairKey(playerId, targetId), { atWar: false, pact: { active: true } });
    return {
      ok: true,
      gameState: { ...gameState, diplomacy: { relations: nextRelations, pactProposals: nextProposals } },
    };
  }

  nextProposals.add(proposalKey(playerId, targetId));
  return {
    ok: true,
    gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, pactProposals: nextProposals } },
  };
}

/** Withdraws a pending, not-yet-mutual pact offer this player made. */
export function withdrawPactProposal(gameState: GameState, playerId: string, targetId: string): DiplomacyOutcome {
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  if (!hasPendingProposal(gameState, playerId, targetId)) {
    return { ok: false, reason: 'Kein ausstehendes Angebot.' };
  }
  const nextProposals = new Set(gameState.diplomacy.pactProposals);
  nextProposals.delete(proposalKey(playerId, targetId));
  return {
    ok: true,
    gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, pactProposals: nextProposals } },
  };
}

/** Cancels an active pact; it keeps blocking war for PACT_COOLDOWN_ROUNDS more rounds. */
export function cancelPact(gameState: GameState, playerId: string, targetId: string): DiplomacyOutcome {
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  const relation = getRelation(gameState, playerId, targetId);
  if (!relation.pact?.active) return { ok: false, reason: 'Kein aktiver Pakt zum Kündigen.' };

  const nextRelations = new Map(gameState.diplomacy.relations);
  nextRelations.set(pairKey(playerId, targetId), {
    atWar: false,
    pact: { active: false, blocksWarUntilRound: gameState.turn + PACT_COOLDOWN_ROUNDS },
  });
  return {
    ok: true,
    gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, relations: nextRelations } },
  };
}
