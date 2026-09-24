import type { AirComposition, AirTech, BattlePlacement, GameState, GroundTech, LobbyState, NavalTech, SupportTech, UnitComposition } from '../engine/types';
import type { BattleResult } from '../engine/combat';
import type { SeaBattleResult } from '../engine/naval';
import type { BomberRaidMode } from '../engine/airforce';
import type { ForceEstimate } from '../engine/intel';

/**
 * Abstracts "how the lobby/game state reaches this browser tab" so the UI never has to know
 * whether it's talking to a local, offline session or a remote server over a WebSocket.
 */
export interface GameClient {
  readonly playerId: string;
  /** Whether this client goes over the network - gates UI (e.g. interactive AI add/remove,
   *  session code display) that only makes sense once other people could be watching. */
  readonly isOnline: boolean;
  getLobby(): LobbyState;
  /** Fires whenever the lobby changes (join, capital claimed, AI added, ...). Returns an unsubscribe fn. */
  onLobby(cb: (lobby: LobbyState) => void): () => void;
  /** Fires exactly once, when the host starts the game - the lobby -> map screen transition. */
  onGameStart(cb: (gameState: GameState) => void): () => void;
  /** Fires on every game state change from here on, including the initial one from onGameStart. */
  onGameState(cb: (gameState: GameState) => void): () => void;
  onError(cb: (message: string) => void): () => void;
  /** Fires when a tactical battle concludes (one side loses every unit on the sub-map) - both
   *  combatants and anyone else watching get this. */
  onBattle(cb: (battle: BattleResult | SeaBattleResult) => void): () => void;
  /** Fires in reply to a matching estimateEnemyForces(targetId) call - only this client gets its
   *  own request's answer, never anyone else's. */
  onForceEstimate(cb: (targetId: string, estimate: ForceEstimate) => void): () => void;
  claimCapital(territoryId: string): void;
  /** Host-only; no-op (with an onError) if called by a non-host. */
  addAi(): void;
  removeAi(aiId: string): void;
  /** Host-only; no-op (with an onError) if called by a non-host or before every slot has picked. */
  start(): void;
  /** Moves `amount` units (at most what's garrisoned there) from an owned territory onto an
   *  adjacent unowned/own/undefended one. No-op (with an onError) if it's actually defended -
   *  use attack() for that - or unless it's currently this player's turn. */
  moveUnits(fromId: string, toId: string, amount: UnitComposition): void;
  /** Ends this player's turn. Any AI seats that follow act immediately, in order, until control
   *  reaches the next human. No-op (with an onError) unless it's currently this player's turn. */
  endTurn(): void;
  /** Spends Rüstungspunkte to add new units to an owned territory. No-op (with an onError)
   *  unless it's currently this player's turn or they can't afford it. */
  recruit(territoryId: string, amount: UnitComposition): void;
  /** Spends FACTORY_COST to add one factory at an owned territory (raises its Rüstungspunkte
   *  yield by 1/round). No-op (with an onError) if at capacity, unaffordable, or not this
   *  player's turn. */
  buildFactory(territoryId: string): void;
  /** Spends INFRASTRUCTURE_COST to raise a territory's infrastructure level by 1, raising its
   *  factory capacity by 1. No-op (with an onError) if at max level, unaffordable, or not this
   *  player's turn. */
  upgradeInfrastructure(territoryId: string): void;
  /** Declares an attack on a defended adjacent enemy territory - opens a pending battle that
   *  blocks all other actions until it concludes (see onGameState's pendingBattle field).
   *  No-op (with an onError) unless it's currently this player's turn. */
  attack(fromId: string, toId: string): void;
  /** Resolves an attack instantly and randomly instead of opening the tactical sub-map - the
   *  defender's strength counts double. Fires onBattle with the result, same as a concluded
   *  tactical battle. No-op (with an onError) unless it's currently this player's turn. */
  simulateAttack(fromId: string, toId: string): void;
  /** Calls off an attack this player declared, before they've confirmed a deployment for it. */
  cancelAttack(): void;
  /** Commits this player's initial placements (a sparse list - most of the grid stays empty) for
   *  the currently pending battle, as attacker or defender, whichever role they have in it.
   *  One-shot: can't be changed after. Once both sides have deployed, the tactical sub-map opens
   *  for movement. */
  deployBattle(placements: readonly BattlePlacement[]): void;
  /** Moves `amount` units between two adjacent "kleine Gebiete" on the tactical sub-map, during
   *  the battle phase. No-op (with an onError) unless it's this player's turn within the battle. */
  battleMove(fromSubId: string, toSubId: string, amount: UnitComposition): void;
  /** Sends `amount` units from a sub-territory adjacent to the escape row off the tactical map and
   *  onto `destinationId`, a neighbor of the contested territory on the main map. No-op (with an
   *  onError) unless it's this player's turn within the battle, or the destination is defended. */
  escapeBattle(fromSubId: string, destinationId: string, amount: UnitComposition): void;
  /** Fires `artilleryCount` of the artillery at `fromSubId` at an enemy-held cell up to
   *  ARTILLERY_RANGE cells away (see engine/combat.ts) - no adjacency needed. Kills up to one
   *  Infanterie per artillery piece fired, nothing else. No-op (with an onError) unless it's this
   *  player's turn within the battle, the target is in range and enemy-held, or there's no
   *  Infanterie there to hit. */
  bombardBattleCell(fromSubId: string, targetSubId: string, artilleryCount: number): void;
  /** Ends this player's turn within the tactical battle, passing the initiative to the other
   *  combatant (AI seats pass immediately). No-op unless it's this player's turn in the battle. */
  endBattleTurn(): void;
  /** Bietet in der laufenden taktischen Schlacht ein Unentschieden an bzw. stimmt dem des Gegners zu (jederzeit in der
   *  Kampfphase, unabhängig vom Zug). Stimmen beide Seiten zu, endet die Schlacht unverändert (siehe engine/combat.ts's
   *  proposeBattleDraw); eine beteiligte KI antwortet sofort nach ihrer Heuristik (engine/ai.ts's aiWantsDraw). */
  proposeBattleDraw(): void;
  /** Declares war on `targetId` - a prerequisite for attacking or capturing their territory.
   *  Everyone in each side's alliance is at war with everyone in the other's from then on (see
   *  engine/diplomacy.ts's propagateAllianceWars). No-op (with an onError) if already at war,
   *  allied with the target, blocked by an active/cooling-down pact, or not this player's turn. */
  declareWar(targetId: string): void;
  /** Offers `targetId` a non-aggression pact. Activates immediately (and ends any war) once they
   *  offer one back; otherwise waits as a one-sided pending offer. */
  proposePact(targetId: string): void;
  /** Withdraws a pact offer this player made that the other side hasn't matched yet. */
  withdrawPactProposal(targetId: string): void;
  /** Cancels an active pact with `targetId` - it still blocks a war declaration for 3 more rounds. */
  cancelPact(targetId: string): void;
  /** Offers `targetId` an alliance (shared vision, automatic war-joining - see engine/diplomacy.ts).
   *  Forms immediately once they offer one back; otherwise waits as a one-sided pending offer.
   *  No-op (with an onError) if it isn't possible (see engine/diplomacy.ts's allianceConflict) or
   *  it isn't this player's turn. */
  proposeAlliance(targetId: string): void;
  /** Withdraws an alliance offer this player made that the other side hasn't matched yet. */
  withdrawAllianceProposal(targetId: string): void;
  /** Leaves this player's alliance (the others stay allied among themselves). Wars already under
   *  way continue; war against the former allies stays blocked for 3 more rounds. */
  leaveAlliance(): void;
  /** Builds a level-1 Flugplatz (AIRFIELD_BUILD_COST) at an owned territory that doesn't already
   *  have one. No-op (with an onError) if unaffordable, one's already there, or not this player's
   *  turn. */
  buildAirfield(territoryId: string): void;
  /** Raises an existing Flugplatz by one level (AIRFIELD_UPGRADE_COST), raising its capacity by
   *  AIRFIELD_CAPACITY_PER_LEVEL. No-op (with an onError) if there's no airfield there yet,
   *  unaffordable, or not this player's turn. */
  upgradeAirfield(territoryId: string): void;
  /** Spends Rüstungspunkte to add aircraft to an owned Flugplatz, capped by its free capacity.
   *  No-op (with an onError) if there's no airfield there, not enough room, unaffordable, or not
   *  this player's turn. */
  recruitAircraft(territoryId: string, amount: AirComposition): void;
  /** Sends `bomberCount` Bomber from `fromTerritoryId`'s Flugplatz at any territory on the map (no
   *  range limit) - resolves instantly. How many return is exactly the attacker's Jäger-projected
   *  air superiority fraction at the target; only the returning survivors deal damage. `mode`
   *  picks the payload: 'units' hits the garrison (100 Bomber ~ damage for 10 Schwere Panzer),
   *  'factories' destroys factories built there instead (100 Bomber ~ 3 Fabriken) - never both in
   *  one raid (see engine/airforce.ts's launchBomberRaid). No-op (with an onError) unless it's this
   *  player's turn, at war with the target's owner, the target has factories (mode 'factories'),
   *  or there aren't enough Bomber available. */
  launchBomberRaid(fromTerritoryId: string, targetTerritoryId: string, bomberCount: number, mode: BomberRaidMode): void;
  /** Sends `fighterCount` Jäger from `fromTerritoryId`'s Flugplatz to fight an immediate air-to-air
   *  engagement over `targetTerritoryId`, up to FIGHTER_RANGE hops away - resolves instantly, no
   *  tactical sub-map involved, same as launchBomberRaid (see engine/airforce.ts's fighterSweep).
   *  No-op (with an onError) unless it's this player's turn, at war with the target's owner, the
   *  target is in range, or there aren't enough Jäger available. */
  fighterSweep(fromTerritoryId: string, targetTerritoryId: string, fighterCount: number): void;
  /** Calls Jäger or CAS stationed at the contested territory or one of its main-map neighbors into
   *  the currently pending tactical battle. Jäger arrive 1 battle-round later and join the shared
   *  Luftüberlegenheit pool; CAS arrive 3 rounds later and wait for a casStrike - and can only be
   *  called while the calling side already holds over 50% of the battle's Jäger. No-op (with an
   *  onError) unless a battle is pending, this player is a participant, the source territory is
   *  eligible, or (for CAS) that air-superiority threshold isn't met. */
  callAirSupport(type: 'fighter' | 'cas', fromTerritoryId: string, count: number): void;
  /** Strikes one "kleines Gebiet" with a 'ready' (arrived) CAS call-in - CAS_STRIKE_DAMAGE_PER_UNIT
   *  strength-worth of damage per CAS unit, then it starts its 3-round trip back to base. No-op
   *  (with an onError) unless that CAS call-in belongs to this player and has actually arrived. */
  casStrike(calledAircraftId: string, targetSubId: string): void;
  /** Spends Rüstungspunkte to permanently unlock a ground unit type (Leichte Panzer or Schwere
   *  Panzer) for recruiting - see engine/research.ts's GROUND_TECH_TREE. No-op (with an onError)
   *  if already unlocked, its prerequisite isn't, unaffordable, or not this player's turn. */
  unlockGroundTech(tech: GroundTech): void;
  /** Same as unlockGroundTech, for aircraft types (Jäger, CAS, Bomber) - see
   *  engine/research.ts's AIR_TECH_TREE. */
  unlockAirTech(tech: AirTech): void;
  /** Same as unlockGroundTech, for engine/research.ts's SUPPORT_TECH_TREE (Artillerie and the
   *  Atombombe). */
  unlockSupportTech(tech: SupportTech): void;
  /** Wie unlockGroundTech, für die Marine (engine/research.ts's NAVAL_TECH_TREE, Tech `ships`). */
  unlockNavalTech(tech: NavalTech): void;
  /** Rekrutiert `count` Schiffe (SHIP_COST je Stück) in einem eigenen Küstengebiet. */
  recruitShips(territoryId: string, count: number): void;
  /** Bewegt Schiffe Küste <-> Seezone bzw. Zone <-> Zone. Fährt man in eine feindliche Zone mit Schiffen
   *  (Krieg nötig), beginnt eine Seeschlacht (pendingSeaBattle in onGameState). */
  moveShips(fromId: string, toId: string, count: number): void;
  /** Bestätigt die verdeckte Aufstellung der eigenen Flotte in der laufenden Seeschlacht (Kasten-Indizes
   *  row * gridSize + col in der eigenen Rasterhälfte, genau so viele wie Schiffe in der Schlacht). */
  deploySeaFleet(cells: readonly number[]): void;
  /** Schießt in der Seeschlacht auf einen Kasten der gegnerischen Hälfte. */
  seaShoot(cell: number): void;
  /** Ruft eine Seeschlacht ab, solange der Angreifer noch nicht aufgestellt hat. */
  cancelSeaBattle(): void;
  /** Bietet an, die Seeschlacht zu simulieren (bzw. stimmt dem Angebot des Gegners zu). Beide Seiten müssen zustimmen,
   *  KIs stimmen immer sofort zu - dann wird automatisch nach den Seeschlacht-Regeln ausgetragen (engine/naval.ts's
   *  simulateSeaBattle). */
  proposeSeaSimulation(): void;
  /** Lehnt ein Simulations-Angebot des Gegners ab - es wird normal weitergespielt. */
  declineSeaSimulation(): void;
  /** Ends the current tactical battle instantly, destroying every unit on the sub-map - the
   *  caller's own included - for NUKE_USE_COST Rüstungspunkte (see engine/combat.ts's useNuke).
   *  No-op (with an onError) unless it's this player's turn within the battle, 'nuke' is unlocked,
   *  or they can't afford it. */
  useNuke(): void;
  /** Requests a fuzzy, spy-report-style estimate of `targetId`'s true total Einheiten/Fabriken/
   *  Luftwaffe - see engine/intel.ts's estimateForces for exactly how fuzzy. Answered via
   *  onForceEstimate, not a return value, since a remote session needs a round trip; computed from
   *  the authoritative, unfiltered game state (never the caller's own fogged view of it), so it
   *  reflects the target's *true* strength, not just whatever's currently visible. */
  estimateEnemyForces(targetId: string): void;
  close(): void;
}

export function isHost(client: GameClient): boolean {
  return client.getLobby().slots[0]?.playerId === client.playerId;
}
