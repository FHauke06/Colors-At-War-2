import type { AiDifficulty, AirComposition, AirTech, BattlePlacement, GameState, GroundTech, LobbyState, Territory, UnitComposition } from '../engine/types';
import { addAi, claimCapital, canStart, createLobby, removeAi } from '../engine/session';
import { buildGameStateFromLobby } from '../engine/setup';
import { moveUnits } from '../engine/movement';
import { endTurn, resumeAiTurnIfNeeded } from '../engine/turns';
import { recruitUnits, buildFactory as buildFactoryEngine, upgradeInfrastructure as upgradeInfrastructureEngine } from '../engine/economy';
import { unlockGroundTech as unlockGroundTechEngine, unlockAirTech as unlockAirTechEngine } from '../engine/research';
import {
  startBattle,
  simulateAttack as simulateAttackEngine,
  cancelBattle,
  markDeployed,
  deploymentFits,
  beginBattlePhase,
  moveBattleUnits,
  escapeBattle as escapeBattleEngine,
  bombardBattleCell as bombardBattleCellEngine,
  callAirSupport as callAirSupportEngine,
  casStrike as casStrikeEngine,
  endBattleTurn as endBattleTurnEngine,
} from '../engine/combat';
import type { BattleResult } from '../engine/combat';
import { autoDeployForBattle, cascadeAiBattleTurns } from '../engine/ai';
import type { PendingAiDeployment } from '../engine/ai';
import { declareWar as declareWarEngine, proposePact as proposePactEngine, cancelPact as cancelPactEngine, withdrawPactProposal as withdrawPactProposalEngine } from '../engine/diplomacy';
import {
  buildAirfield as buildAirfieldEngine,
  upgradeAirfield as upgradeAirfieldEngine,
  recruitAircraft as recruitAircraftEngine,
  launchBomberRaid as launchBomberRaidEngine,
  fighterSweep as fighterSweepEngine,
} from '../engine/airforce';
import type { BomberRaidMode } from '../engine/airforce';
import { estimateForces } from '../engine/intel';
import type { ForceEstimate } from '../engine/intel';
import { filterGameStateForViewer } from '../engine/visibility';
import type { GameClient } from './GameClient';

const LOCAL_PLAYER_ID = 'local';

/** Offline mode: a "session" of exactly one local human, no network involved. `aiCount`
 *  opponents are added immediately so their (spread-out) capitals show on the map right away. */
export class LocalGameClient implements GameClient {
  readonly playerId = LOCAL_PLAYER_ID;
  readonly isOnline = false;

  private lobby: LobbyState;
  private gameState: GameState | null = null;
  private readonly territories: readonly Territory[];
  private readonly lobbyListeners = new Set<(lobby: LobbyState) => void>();
  private readonly startListeners = new Set<(gameState: GameState) => void>();
  private readonly stateListeners = new Set<(gameState: GameState) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly battleListeners = new Set<(battle: BattleResult) => void>();
  private readonly forceEstimateListeners = new Set<(targetId: string, estimate: ForceEstimate) => void>();
  /** Deployment for the current pending battle, kept out of gameState so it's never broadcast -
   *  holds this session's human placement while waiting on the AI, or the AI's own blind placement
   *  (see engine/ai.ts's PendingAiDeployment) while waiting on this session's human. */
  private attackerDeployment: readonly BattlePlacement[] | null = null;
  private defenderDeployment: readonly BattlePlacement[] | null = null;

  constructor(territories: readonly Territory[], hostName: string, aiCount: number, aiDifficulty: AiDifficulty = 'medium') {
    this.territories = territories;
    let lobby = createLobby('LOKAL', 1, LOCAL_PLAYER_ID, hostName, aiDifficulty);
    for (let i = 0; i < aiCount; i++) lobby = addAi(lobby, territories);
    this.lobby = lobby;
  }

  getLobby(): LobbyState {
    return this.lobby;
  }

  onLobby(cb: (lobby: LobbyState) => void): () => void {
    this.lobbyListeners.add(cb);
    return () => this.lobbyListeners.delete(cb);
  }

  onGameStart(cb: (gameState: GameState) => void): () => void {
    this.startListeners.add(cb);
    return () => this.startListeners.delete(cb);
  }

  onGameState(cb: (gameState: GameState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onError(cb: (message: string) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  onBattle(cb: (battle: BattleResult) => void): () => void {
    this.battleListeners.add(cb);
    return () => this.battleListeners.delete(cb);
  }

  onForceEstimate(cb: (targetId: string, estimate: ForceEstimate) => void): () => void {
    this.forceEstimateListeners.add(cb);
    return () => this.forceEstimateListeners.delete(cb);
  }

  claimCapital(territoryId: string): void {
    this.mutateLobby((lobby) => claimCapital(lobby, this.playerId, territoryId, this.territories));
  }

  addAi(): void {
    this.mutateLobby((lobby) => addAi(lobby, this.territories));
  }

  removeAi(aiId: string): void {
    this.mutateLobby((lobby) => removeAi(lobby, aiId));
  }

  start(): void {
    if (!canStart(this.lobby)) {
      this.errorListeners.forEach((cb) => cb('Noch nicht jeder Spieler hat eine Hauptstadt gewählt.'));
      return;
    }
    this.gameState = buildGameStateFromLobby(this.lobby, this.territories);
    this.lobby = { ...this.lobby, status: 'started' };
    const filtered = this.visibleState();
    this.startListeners.forEach((cb) => cb(filtered));
    this.stateListeners.forEach((cb) => cb(filtered));
  }

  /** The authoritative gameState filtered down to what this session's one local human may see -
   *  see engine/visibility.ts. Always call this instead of handing out `this.gameState` raw. */
  private visibleState(): GameState {
    return filterGameStateForViewer(this.gameState!, this.playerId, this.territories);
  }

  private notifyState(): void {
    const filtered = this.visibleState();
    this.stateListeners.forEach((cb) => cb(filtered));
  }

  moveUnits(fromId: string, toId: string, amount: UnitComposition): void {
    if (!this.gameState) return;
    const outcome = moveUnits(this.gameState, this.playerId, fromId, toId, this.territories, amount);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  attack(fromId: string, toId: string): void {
    if (!this.gameState) return;
    const outcome = startBattle(this.gameState, this.playerId, fromId, toId, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.attackerDeployment = null;
    this.defenderDeployment = null;

    // This method is only ever reached via the human's own attack() call - the AI's attacks go
    // through engine/turns.ts's endTurn instead (see engine/ai.ts's launchAiAttack), never here -
    // so the defender is always AI: deploy for them immediately, blind to whatever the human ends
    // up choosing.
    const pending = this.gameState.pendingBattle!;
    const defender = this.gameState.players.find((p) => p.id === pending.defenderId);
    if (defender?.isAI) {
      this.defenderDeployment = autoDeployForBattle(pending.defenderMax, pending.subTerritories, 'defender');
      this.gameState = markDeployed(this.gameState, 'defender');
    }
    this.notifyState();
  }

  simulateAttack(fromId: string, toId: string): void {
    if (!this.gameState) return;
    const outcome = simulateAttackEngine(this.gameState, this.playerId, fromId, toId, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.battleListeners.forEach((cb) => cb(outcome.result));
    this.notifyState();
  }

  cancelAttack(): void {
    if (!this.gameState) return;
    const outcome = cancelBattle(this.gameState, this.playerId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.attackerDeployment = null;
    this.defenderDeployment = null;
    this.notifyState();
  }

  deployBattle(placements: readonly BattlePlacement[]): void {
    const pending = this.gameState?.pendingBattle;
    if (!this.gameState || !pending) return;

    let side: 'attacker' | 'defender';
    if (pending.attackerId === this.playerId && !pending.attackerDeployed) side = 'attacker';
    else if (pending.defenderId === this.playerId && !pending.defenderDeployed) side = 'defender';
    else {
      this.errorListeners.forEach((cb) => cb('Du kannst hier nicht aufstellen.'));
      return;
    }

    const max = side === 'attacker' ? pending.attackerMax : pending.defenderMax;
    const validSubIds = new Set(
      pending.subTerritories.filter((t) => t.side === side && !t.isEscape && t.terrain === 'normal').map((t) => t.id),
    );
    if (!deploymentFits(max, placements, validSubIds)) {
      this.errorListeners.forEach((cb) => cb('Ungültige Aufstellung.'));
      return;
    }

    if (side === 'attacker') this.attackerDeployment = placements;
    else this.defenderDeployment = placements;
    this.gameState = markDeployed(this.gameState, side);

    const nowPending = this.gameState.pendingBattle!;
    if (nowPending.attackerDeployed && nowPending.defenderDeployed) {
      this.gameState = beginBattlePhase(this.gameState, this.attackerDeployment!, this.defenderDeployment!);
      this.attackerDeployment = null;
      this.defenderDeployment = null;
      // The attacker always moves first (see beginBattlePhase) - if that's the AI (now possible
      // since it can initiate a tactical attack itself, see engine/ai.ts's launchAiAttack), it
      // needs to actually take that opening move here, or the battle would just sit waiting on a
      // turn nobody ever plays.
      this.gameState = cascadeAiBattleTurns(this.gameState, this.territories);
    }
    this.continueStalledAiTurn();
    this.notifyState();
  }

  battleMove(fromSubId: string, toSubId: string, amount: UnitComposition): void {
    if (!this.gameState) return;
    const outcome = moveBattleUnits(this.gameState, this.playerId, fromSubId, toSubId, amount, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    if (outcome.concluded) this.battleListeners.forEach((cb) => cb(outcome.concluded!));
    this.continueStalledAiTurn();
    this.notifyState();
  }

  escapeBattle(fromSubId: string, destinationId: string, amount: UnitComposition): void {
    if (!this.gameState) return;
    const outcome = escapeBattleEngine(this.gameState, this.playerId, fromSubId, destinationId, amount, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    if (outcome.concluded) this.battleListeners.forEach((cb) => cb(outcome.concluded!));
    this.continueStalledAiTurn();
    this.notifyState();
  }

  bombardBattleCell(fromSubId: string, targetSubId: string, artilleryCount: number): void {
    if (!this.gameState) return;
    const outcome = bombardBattleCellEngine(this.gameState, this.playerId, fromSubId, targetSubId, artilleryCount, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    if (outcome.concluded) this.battleListeners.forEach((cb) => cb(outcome.concluded!));
    this.continueStalledAiTurn();
    this.notifyState();
  }

  callAirSupport(type: 'fighter' | 'cas', fromTerritoryId: string, count: number): void {
    if (!this.gameState) return;
    const outcome = callAirSupportEngine(this.gameState, this.playerId, type, fromTerritoryId, count, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  casStrike(calledAircraftId: string, targetSubId: string): void {
    if (!this.gameState) return;
    const outcome = casStrikeEngine(this.gameState, this.playerId, calledAircraftId, targetSubId, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    if (outcome.concluded) this.battleListeners.forEach((cb) => cb(outcome.concluded!));
    this.continueStalledAiTurn();
    this.notifyState();
  }

  endBattleTurn(): void {
    if (!this.gameState) return;
    const outcome = endBattleTurnEngine(this.gameState, this.playerId, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    // A full round (both sides' turns) has a hard cap - see engine/combat.ts's MAX_BATTLE_ROUNDS -
    // past which the defender wins outright, reported here the same way a move/escape concluding
    // the battle already is.
    if (outcome.concluded) this.battleListeners.forEach((cb) => cb(outcome.concluded!));
    this.gameState = cascadeAiBattleTurns(outcome.gameState, this.territories);
    this.continueStalledAiTurn();
    this.notifyState();
  }

  endTurn(): void {
    if (!this.gameState) return;
    const outcome = endTurn(this.gameState, this.playerId, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.stashPendingAiDeployment(outcome.pendingAiDeployment);
    this.notifyState();
  }

  /** Call after any action that might have just concluded a tactical battle (deploying,
   *  battleMove, escapeBattle, endBattleTurn): if that leaves the game's active player still
   *  pointing at an AI whose own turn opened the battle and paused mid-way (see
   *  engine/turns.ts's resumeAiTurnIfNeeded), lets it actually finish - attack elsewhere, expand,
   *  spend its points, or hand control to the next player - instead of the game just sitting
   *  there forever once that battle resolves. A no-op the rest of the time (a human's own battle
   *  concluding, or one still in progress). */
  private continueStalledAiTurn(): void {
    if (!this.gameState) return;
    const result = resumeAiTurnIfNeeded(this.gameState, this.territories);
    this.gameState = result.gameState;
    this.stashPendingAiDeployment(result.pendingAiDeployment);
  }

  /** The AI may have opened a (further) tactical battle against this session's one human and
   *  stopped there (see engine/turns.ts's endTurn/resumeAiTurnIfNeeded) - stash its blind attacker
   *  placement the same way a human's own deployment is kept out of gameState, so deployBattle()
   *  can fold both in once this player deploys as defender. */
  private stashPendingAiDeployment(pendingAiDeployment: PendingAiDeployment | null): void {
    if (!pendingAiDeployment) return;
    if (pendingAiDeployment.side === 'attacker') this.attackerDeployment = pendingAiDeployment.placements;
    else this.defenderDeployment = pendingAiDeployment.placements;
  }

  recruit(territoryId: string, amount: UnitComposition): void {
    if (!this.gameState) return;
    const outcome = recruitUnits(this.gameState, this.playerId, territoryId, amount);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  buildFactory(territoryId: string): void {
    if (!this.gameState) return;
    const outcome = buildFactoryEngine(this.gameState, this.playerId, territoryId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  upgradeInfrastructure(territoryId: string): void {
    if (!this.gameState) return;
    const outcome = upgradeInfrastructureEngine(this.gameState, this.playerId, territoryId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  buildAirfield(territoryId: string): void {
    if (!this.gameState) return;
    const outcome = buildAirfieldEngine(this.gameState, this.playerId, territoryId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  upgradeAirfield(territoryId: string): void {
    if (!this.gameState) return;
    const outcome = upgradeAirfieldEngine(this.gameState, this.playerId, territoryId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  recruitAircraft(territoryId: string, amount: AirComposition): void {
    if (!this.gameState) return;
    const outcome = recruitAircraftEngine(this.gameState, this.playerId, territoryId, amount);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  launchBomberRaid(fromTerritoryId: string, targetTerritoryId: string, bomberCount: number, mode: BomberRaidMode): void {
    if (!this.gameState) return;
    const outcome = launchBomberRaidEngine(this.gameState, this.playerId, fromTerritoryId, targetTerritoryId, bomberCount, mode, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  fighterSweep(fromTerritoryId: string, targetTerritoryId: string, fighterCount: number): void {
    if (!this.gameState) return;
    const outcome = fighterSweepEngine(this.gameState, this.playerId, fromTerritoryId, targetTerritoryId, fighterCount, this.territories);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  declareWar(targetId: string): void {
    if (!this.gameState) return;
    const outcome = declareWarEngine(this.gameState, this.playerId, targetId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  proposePact(targetId: string): void {
    if (!this.gameState) return;
    const outcome = proposePactEngine(this.gameState, this.playerId, targetId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  withdrawPactProposal(targetId: string): void {
    if (!this.gameState) return;
    const outcome = withdrawPactProposalEngine(this.gameState, this.playerId, targetId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  cancelPact(targetId: string): void {
    if (!this.gameState) return;
    const outcome = cancelPactEngine(this.gameState, this.playerId, targetId);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  unlockGroundTech(tech: GroundTech): void {
    if (!this.gameState) return;
    const outcome = unlockGroundTechEngine(this.gameState, this.playerId, tech);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  unlockAirTech(tech: AirTech): void {
    if (!this.gameState) return;
    const outcome = unlockAirTechEngine(this.gameState, this.playerId, tech);
    if (!outcome.ok) {
      this.errorListeners.forEach((cb) => cb(outcome.reason));
      return;
    }
    this.gameState = outcome.gameState;
    this.notifyState();
  }

  estimateEnemyForces(targetId: string): void {
    if (!this.gameState) return;
    // Computed from this.gameState (the authoritative, unfiltered state), not visibleState() -
    // see GameClient.ts's estimateEnemyForces doc comment for why.
    const estimate = estimateForces(this.gameState, targetId);
    this.forceEstimateListeners.forEach((cb) => cb(targetId, estimate));
  }

  close(): void {
    this.lobbyListeners.clear();
    this.startListeners.clear();
    this.stateListeners.clear();
    this.errorListeners.clear();
    this.battleListeners.clear();
    this.forceEstimateListeners.clear();
  }

  private mutateLobby(fn: (lobby: LobbyState) => LobbyState): void {
    try {
      this.lobby = fn(this.lobby);
      this.lobbyListeners.forEach((cb) => cb(this.lobby));
    } catch (err) {
      this.errorListeners.forEach((cb) => cb((err as Error).message));
    }
  }
}
