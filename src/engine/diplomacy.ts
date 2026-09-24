import type { DiplomacyState, DiplomaticRelation, GameState } from './types';

const DEFAULT_RELATION: DiplomaticRelation = { atWar: false, pact: null };

/** A non-aggression pact, once cancelled, still blocks a new war for this many rounds. Leaving an
 *  alliance leaves the same cooldown behind between you and each former ally (see leaveAlliance). */
export const PACT_COOLDOWN_ROUNDS = 3;

export function emptyDiplomacyState(): DiplomacyState {
  return { relations: new Map(), pactProposals: new Set(), allianceProposals: new Set() };
}

/** Order-independent key for a pair of players - a relation applies to both sides equally. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function splitPairKey(key: string): [string, string] {
  const [a, b] = key.split('|');
  return [a!, b!];
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

/** Whether `a` and `b` belong to the same alliance (see DiplomaticRelation.allied). */
export function areAllied(gameState: GameState, a: string, b: string): boolean {
  return getRelation(gameState, a, b).allied === true;
}

/** Everyone `playerId` shares an alliance with, not counting themselves - empty if they belong to
 *  none. Alliance membership is a full clique (see DiplomaticRelation.allied), so this is simply
 *  every player they carry the `allied` flag with. */
export function alliesOf(gameState: GameState, playerId: string): string[] {
  const allies: string[] = [];
  for (const [key, relation] of gameState.diplomacy.relations) {
    if (!relation.allied) continue;
    const [a, b] = splitPairKey(key);
    if (a === playerId) allies.push(b);
    else if (b === playerId) allies.push(a);
  }
  return allies;
}

/** `playerId` plus all their allies - the whole alliance, or just themselves if they have none. */
export function allianceMembers(gameState: GameState, playerId: string): string[] {
  return [playerId, ...alliesOf(gameState, playerId)];
}

export function hasPendingProposal(gameState: GameState, fromId: string, toId: string): boolean {
  return gameState.diplomacy.pactProposals.has(proposalKey(fromId, toId));
}

export function hasPendingAllianceProposal(gameState: GameState, fromId: string, toId: string): boolean {
  return gameState.diplomacy.allianceProposals?.has(proposalKey(fromId, toId)) ?? false;
}

/** Whether a pact between this pair (still active, or cancelled but inside its cooldown) rules out
 *  a war between them right now - shared by declareWar's own check and the alliance war-joining,
 *  which must respect a pact the same way (see propagateAllianceWars). */
function pactBlocksWar(relation: DiplomaticRelation, currentRound: number): boolean {
  if (!relation.pact) return false;
  return relation.pact.active || currentRound <= relation.pact.blocksWarUntilRound;
}

function canDeclareWar(relation: DiplomaticRelation, currentRound: number): boolean {
  return !relation.atWar && !pactBlocksWar(relation, currentRound);
}

/** A copy of `relation` without the named optional flags (they're only ever stored as `true`, never
 *  as `false`/`undefined`, so an explicit "off" means removing the key entirely). */
function withoutFlags(relation: DiplomaticRelation, ...flags: ('allied' | 'viaAlliance')[]): DiplomaticRelation {
  const next: { -readonly [K in keyof DiplomaticRelation]: DiplomaticRelation[K] } = { ...relation };
  for (const flag of flags) delete next[flag];
  return next;
}

function nameOf(gameState: GameState, playerId: string): string {
  return gameState.players.find((p) => p.id === playerId)?.name ?? playerId;
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

/**
 * Alliance war-joining, applied until nothing changes: whenever a war exists between two players,
 * every member of each one's alliance is at war with the other one too - "wird automatisch einem
 * Krieg beigetreten, wenn ein Allianzmitglied in einem Krieg ist". Run after anything that can
 * create such a war (declareWar) or bring two groups of wars together (an alliance forming - the
 * new members inherit each other's enemies), and once at scenario setup (engine/setup.ts).
 *
 * A pair of players who'd otherwise be dragged into fighting each other is left alone if a pact
 * between them still holds (active, or cancelled but inside its cooldown): the treaty wins, that
 * ally simply sits this war out. Everything joined this way is flagged `viaAlliance`, purely for
 * wording. Returns `gameState` itself (same reference) if there was nothing to join.
 */
export function propagateAllianceWars(gameState: GameState): GameState {
  const relations = new Map(gameState.diplomacy.relations);
  const round = gameState.turn;

  const allies = new Map<string, string[]>();
  for (const [key, relation] of relations) {
    if (!relation.allied) continue;
    const [a, b] = splitPairKey(key);
    allies.set(a, [...(allies.get(a) ?? []), b]);
    allies.set(b, [...(allies.get(b) ?? []), a]);
  }
  if (allies.size === 0) return gameState;

  let anyChange = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, relation] of [...relations]) {
      if (!relation.atWar) continue;
      const [p, r] = splitPairKey(key);
      for (const [side, enemy] of [[p, r], [r, p]] as const) {
        for (const ally of allies.get(side) ?? []) {
          if (ally === enemy) continue;
          const pairKeyOfJoin = pairKey(ally, enemy);
          const existing = relations.get(pairKeyOfJoin) ?? DEFAULT_RELATION;
          if (existing.atWar || existing.allied || pactBlocksWar(existing, round)) continue;
          relations.set(pairKeyOfJoin, { atWar: true, pact: null, viaAlliance: true });
          changed = true;
          anyChange = true;
        }
      }
    }
  }

  if (!anyChange) return gameState;
  return { ...gameState, diplomacy: { ...gameState.diplomacy, relations } };
}

export function declareWar(gameState: GameState, playerId: string, targetId: string): DiplomacyOutcome {
  const invalid = validateTarget(gameState, playerId, targetId);
  if (invalid) return { ok: false, reason: invalid };

  const relation = getRelation(gameState, playerId, targetId);
  if (relation.allied) {
    return { ok: false, reason: 'Ihr seid verbündet - verlasse zuerst die Allianz, bevor du den Krieg erklärst.' };
  }
  if (!canDeclareWar(relation, gameState.turn)) {
    if (relation.atWar) return { ok: false, reason: 'Ihr befindet euch bereits im Krieg.' };
    return { ok: false, reason: 'Ein Nichtangriffspakt verhindert derzeit eine Kriegserklärung.' };
  }

  const nextRelations = new Map(gameState.diplomacy.relations);
  nextRelations.set(pairKey(playerId, targetId), { atWar: true, pact: null });
  const declared: GameState = { ...gameState, diplomacy: { ...gameState.diplomacy, relations: nextRelations } };
  return { ok: true, gameState: propagateAllianceWars(declared) };
}

/** Proposes a non-aggression pact. Once the other side has proposed one back, it activates
 *  immediately (which also ends any war between them - only theirs: allies keep fighting on their
 *  own, see propagateAllianceWars). */
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
    nextRelations.set(pairKey(playerId, targetId), {
      ...withoutFlags(relation, 'viaAlliance'),
      atWar: false,
      pact: { active: true },
    });
    return {
      ok: true,
      gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, relations: nextRelations, pactProposals: nextProposals } },
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
    ...relation,
    atWar: false,
    pact: { active: false, blocksWarUntilRound: gameState.turn + PACT_COOLDOWN_ROUNDS },
  });
  return {
    ok: true,
    gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, relations: nextRelations } },
  };
}

// ============================== Alliances ==============================

/**
 * Why `a` and `b` can't (or can't yet) be in the same alliance, or null if they can. An alliance is
 * a group with exclusive membership: forming one either founds a new alliance of two, or brings a
 * player without one into the other's existing alliance - two players who both already belong to an
 * alliance (necessarily different ones) can't merge them, one has to leave first. And nobody in
 * either group may be at war with anybody in the other - allies must be able to fight side by side,
 * never against each other.
 */
export function allianceConflict(gameState: GameState, a: string, b: string): string | null {
  if (areAllied(gameState, a, b)) return 'Ihr seid bereits verbündet.';
  if (areAtWar(gameState, a, b)) return 'Ihr befindet euch im Krieg - schließt zuerst Frieden (Pakt).';

  const groupA = allianceMembers(gameState, a);
  const groupB = allianceMembers(gameState, b);
  if (groupA.length > 1 && groupB.length > 1) {
    return 'Ihr gehört beide bereits einer Allianz an - eine von euch muss sie erst verlassen.';
  }
  for (const p of groupA) {
    for (const q of groupB) {
      if (areAtWar(gameState, p, q)) {
        return `${nameOf(gameState, p)} und ${nameOf(gameState, q)} führen Krieg gegeneinander - ein gemeinsames Bündnis ist nicht möglich.`;
      }
    }
  }
  return null;
}

/** Puts `a`'s and `b`'s whole groups into one alliance (every cross pair becomes allied, keeping
 *  the alliance a clique), drops any now-pointless offers between the new members, and lets the
 *  members inherit each other's wars (propagateAllianceWars). Callers validate first
 *  (allianceConflict). */
function formAlliance(gameState: GameState, a: string, b: string): GameState {
  const groupA = allianceMembers(gameState, a);
  const groupB = allianceMembers(gameState, b);
  const members = new Set([...groupA, ...groupB]);

  const nextRelations = new Map(gameState.diplomacy.relations);
  for (const p of groupA) {
    for (const q of groupB) {
      const key = pairKey(p, q);
      nextRelations.set(key, { ...(nextRelations.get(key) ?? DEFAULT_RELATION), allied: true });
    }
  }

  const nextProposals = new Set<string>();
  for (const key of gameState.diplomacy.allianceProposals ?? []) {
    const [from, to] = key.split('->');
    if (from && to && members.has(from) && members.has(to)) continue;
    nextProposals.add(key);
  }

  return propagateAllianceWars({
    ...gameState,
    diplomacy: { ...gameState.diplomacy, relations: nextRelations, allianceProposals: nextProposals },
  });
}

/** Proposes an alliance (see allianceConflict for who can). Activates immediately once the other
 *  side has proposed one back - the same mutual-offer flow as a non-aggression pact - otherwise
 *  waits as a one-sided pending offer. */
export function proposeAlliance(gameState: GameState, playerId: string, targetId: string): DiplomacyOutcome {
  const invalid = validateTarget(gameState, playerId, targetId);
  if (invalid) return { ok: false, reason: invalid };

  const conflict = allianceConflict(gameState, playerId, targetId);
  if (conflict) return { ok: false, reason: conflict };
  if (hasPendingAllianceProposal(gameState, playerId, targetId)) {
    return { ok: false, reason: 'Angebot bereits gesendet.' };
  }

  if (hasPendingAllianceProposal(gameState, targetId, playerId)) {
    return { ok: true, gameState: formAlliance(gameState, playerId, targetId) };
  }

  const nextProposals = new Set(gameState.diplomacy.allianceProposals ?? []);
  nextProposals.add(proposalKey(playerId, targetId));
  return {
    ok: true,
    gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, allianceProposals: nextProposals } },
  };
}

/** Withdraws a pending, not-yet-mutual alliance offer this player made. */
export function withdrawAllianceProposal(gameState: GameState, playerId: string, targetId: string): DiplomacyOutcome {
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  if (!hasPendingAllianceProposal(gameState, playerId, targetId)) {
    return { ok: false, reason: 'Kein ausstehendes Angebot.' };
  }
  const nextProposals = new Set(gameState.diplomacy.allianceProposals);
  nextProposals.delete(proposalKey(playerId, targetId));
  return {
    ok: true,
    gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, allianceProposals: nextProposals } },
  };
}

/** Whether `playerId`'s units stand on any territory owned by one of `otherIds`, or any of theirs on
 *  a territory of `playerId`'s - allies sharing ground, see TerritoryState.guests. */
function shareGroundWith(gameState: GameState, playerId: string, otherIds: readonly string[]): boolean {
  const others = new Set(otherIds);
  for (const state of gameState.territoryState.values()) {
    const guests = state.guests;
    if (!guests) continue;
    if (state.ownerId === playerId && guests.some((g) => others.has(g.playerId))) return true;
    if (state.ownerId !== null && others.has(state.ownerId) && guests.some((g) => g.playerId === playerId)) return true;
  }
  return false;
}

/** Leaves `playerId`'s alliance - the rest stay allied among themselves. Wars already under way
 *  stay as they are (make peace the usual way, see proposePact), but the former allies are shielded
 *  from an immediate betrayal: like cancelling a pact, it blocks a war declaration between you and
 *  each of them for PACT_COOLDOWN_ROUNDS more rounds - an active pact between the two is left as
 *  it is. Not while allies' units share ground with yours (either way round): they'd be left
 *  standing on territory that's no longer friendly, so they have to move out first. */
export function leaveAlliance(gameState: GameState, playerId: string): DiplomacyOutcome {
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  const allies = alliesOf(gameState, playerId);
  if (allies.length === 0) return { ok: false, reason: 'Du gehörst keiner Allianz an.' };
  if (shareGroundWith(gameState, playerId, allies)) {
    return {
      ok: false,
      reason: 'Solange Einheiten von dir auf Gebieten von Verbündeten oder Einheiten von Verbündeten auf deinen Gebieten stehen, kannst du die Allianz nicht verlassen - zieht sie erst ab.',
    };
  }

  const nextRelations = new Map(gameState.diplomacy.relations);
  for (const ally of allies) {
    const key = pairKey(playerId, ally);
    const relation = nextRelations.get(key) ?? DEFAULT_RELATION;
    nextRelations.set(key, {
      ...withoutFlags(relation, 'allied'),
      pact: relation.pact?.active
        ? relation.pact
        : { active: false, blocksWarUntilRound: gameState.turn + PACT_COOLDOWN_ROUNDS },
    });
  }
  return {
    ok: true,
    gameState: { ...gameState, diplomacy: { ...gameState.diplomacy, relations: nextRelations } },
  };
}
