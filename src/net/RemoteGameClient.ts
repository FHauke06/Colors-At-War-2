import type { AiDifficulty, AirComposition, AirTech, BattlePlacement, GameState, GroundTech, LobbyState, NavalTech, SupportTech, UnitComposition, UpgradeId } from '../engine/types';
import { deserializeGameState } from '../engine/session';
import type { BattleResult } from '../engine/combat';
import type { SeaBattleResult } from '../engine/naval';
import type { BomberRaidMode } from '../engine/airforce';
import type { ForceEstimate } from '../engine/intel';
import type { ClientMessage, ServerMessage } from './protocol';
import type { GameClient } from './GameClient';

// Not a security token, just a per-tab identity - avoid crypto.randomUUID() since it requires
// a secure context (https or localhost) and this may be deployed over plain http.
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RemoteSessionOptions {
  /** Omit to create a new session (host); provide to join an existing one. */
  readonly code?: string;
  readonly name: string;
  /** How many human slots the lobby accepts; only used (and required) when creating. */
  readonly maxHumans?: number;
  /** Which of data/MainMaps' MAIN_MAPS to play on; only used (and required) when creating - a
   *  joining client gets it from the lobby the server sends back instead. */
  readonly mapId?: string;
  /** How well every AI seat added to this lobby plays; only used when creating - defaults to
   *  'medium' if omitted (see LobbyState.aiDifficulty). */
  readonly aiDifficulty?: AiDifficulty;
  /** Which of data/Scenarios to play; only used when creating - a joining client gets it from the lobby (lobby.scenarioId). */
  readonly scenarioId?: string;
}

/** Online mode: proxies the same GameClient interface over a WebSocket to the session server. */
export class RemoteGameClient implements GameClient {
  readonly playerId = generateId();
  readonly isOnline = true;

  private readonly ws: WebSocket;
  private lobby: LobbyState;
  private hasStarted = false;
  private readonly lobbyListeners = new Set<(lobby: LobbyState) => void>();
  private readonly startListeners = new Set<(gameState: GameState) => void>();
  private readonly stateListeners = new Set<(gameState: GameState) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly battleListeners = new Set<(battle: BattleResult | SeaBattleResult) => void>();
  private readonly forceEstimateListeners = new Set<(targetId: string, estimate: ForceEstimate) => void>();

  constructor(wsUrl: string, options: RemoteSessionOptions) {
    this.lobby = {
      code: '',
      // Unknown until the real lobby arrives from the server (see SetupScreen's "connecting"
      // guard, which holds off building the map view until then).
      mapId: '',
      maxHumans: options.maxHumans ?? 0,
      slots: [],
      aiSlots: [],
      status: 'lobby',
      aiDifficulty: options.aiDifficulty ?? 'medium',
    };

    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener('open', () => {
      this.send({
        type: 'join',
        playerId: this.playerId,
        code: options.code,
        name: options.name,
        maxHumans: options.maxHumans,
        mapId: options.mapId,
        aiDifficulty: options.aiDifficulty,
        scenarioId: options.scenarioId,
      });
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      switch (msg.type) {
        case 'lobby':
          this.lobby = msg.lobby;
          this.lobbyListeners.forEach((cb) => cb(this.lobby));
          break;
        case 'game_state': {
          const gameState = deserializeGameState(msg.gameState);
          if (!this.hasStarted) {
            this.hasStarted = true;
            this.startListeners.forEach((cb) => cb(gameState));
          }
          this.stateListeners.forEach((cb) => cb(gameState));
          break;
        }
        case 'battle':
          this.battleListeners.forEach((cb) => cb(msg.battle));
          break;
        case 'force_estimate':
          this.forceEstimateListeners.forEach((cb) => cb(msg.targetId, msg.estimate));
          break;
        case 'error':
          this.errorListeners.forEach((cb) => cb(msg.message));
          break;
      }
    });
    this.ws.addEventListener('error', () => {
      this.errorListeners.forEach((cb) => cb('Verbindung zum Server fehlgeschlagen.'));
    });
    this.ws.addEventListener('close', () => {
      this.errorListeners.forEach((cb) => cb('Verbindung zum Server unterbrochen.'));
    });
  }

  private send(message: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
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

  onBattle(cb: (battle: BattleResult | SeaBattleResult) => void): () => void {
    this.battleListeners.add(cb);
    return () => this.battleListeners.delete(cb);
  }

  onForceEstimate(cb: (targetId: string, estimate: ForceEstimate) => void): () => void {
    this.forceEstimateListeners.add(cb);
    return () => this.forceEstimateListeners.delete(cb);
  }

  claimCapital(territoryId: string): void {
    this.send({ type: 'claim_capital', territoryId });
  }

  addAi(): void {
    this.send({ type: 'add_ai' });
  }

  removeAi(aiId: string): void {
    this.send({ type: 'remove_ai', aiId });
  }

  start(): void {
    this.send({ type: 'start' });
  }

  moveUnits(fromId: string, toId: string, amount: UnitComposition): void {
    this.send({ type: 'move_units', fromId, toId, amount });
  }

  endTurn(): void {
    this.send({ type: 'end_turn' });
  }

  recruit(territoryId: string, amount: UnitComposition): void {
    this.send({ type: 'recruit', territoryId, amount });
  }

  buildFactory(territoryId: string): void {
    this.send({ type: 'build_factory', territoryId });
  }

  upgradeInfrastructure(territoryId: string): void {
    this.send({ type: 'upgrade_infrastructure', territoryId });
  }

  attack(fromId: string, toId: string): void {
    this.send({ type: 'attack', fromId, toId });
  }

  simulateAttack(fromId: string, toId: string): void {
    this.send({ type: 'simulate_attack', fromId, toId });
  }

  cancelAttack(): void {
    this.send({ type: 'cancel_attack' });
  }

  deployBattle(placements: readonly BattlePlacement[]): void {
    this.send({ type: 'deploy_battle', placements });
  }

  battleMove(fromSubId: string, toSubId: string, amount: UnitComposition): void {
    this.send({ type: 'battle_move', fromSubId, toSubId, amount });
  }

  escapeBattle(fromSubId: string, destinationId: string, amount: UnitComposition): void {
    this.send({ type: 'escape_battle', fromSubId, destinationId, amount });
  }

  bombardBattleCell(fromSubId: string, targetSubId: string, artilleryCount: number): void {
    this.send({ type: 'bombard_battle_cell', fromSubId, targetSubId, artilleryCount });
  }

  useNuke(): void {
    this.send({ type: 'use_nuke' });
  }

  callAirSupport(type: 'fighter' | 'cas', fromTerritoryId: string, count: number): void {
    this.send({ type: 'call_air_support', aircraftType: type, fromTerritoryId, count });
  }

  casStrike(calledAircraftId: string, targetSubId: string): void {
    this.send({ type: 'cas_strike', calledAircraftId, targetSubId });
  }

  proposeBattleDraw(): void {
    this.send({ type: 'propose_battle_draw' });
  }

  endBattleTurn(): void {
    this.send({ type: 'end_battle_turn' });
  }

  declareWar(targetId: string): void {
    this.send({ type: 'declare_war', targetId });
  }

  proposePact(targetId: string): void {
    this.send({ type: 'propose_pact', targetId });
  }

  withdrawPactProposal(targetId: string): void {
    this.send({ type: 'withdraw_pact_proposal', targetId });
  }

  cancelPact(targetId: string): void {
    this.send({ type: 'cancel_pact', targetId });
  }

  proposeAlliance(targetId: string): void {
    this.send({ type: 'propose_alliance', targetId });
  }

  withdrawAllianceProposal(targetId: string): void {
    this.send({ type: 'withdraw_alliance_proposal', targetId });
  }

  leaveAlliance(): void {
    this.send({ type: 'leave_alliance' });
  }

  buildAirfield(territoryId: string): void {
    this.send({ type: 'build_airfield', territoryId });
  }

  upgradeAirfield(territoryId: string): void {
    this.send({ type: 'upgrade_airfield', territoryId });
  }

  recruitAircraft(territoryId: string, amount: AirComposition): void {
    this.send({ type: 'recruit_aircraft', territoryId, amount });
  }

  launchBomberRaid(fromTerritoryId: string, targetTerritoryId: string, bomberCount: number, mode: BomberRaidMode): void {
    this.send({ type: 'launch_bomber_raid', fromTerritoryId, targetTerritoryId, bomberCount, mode });
  }

  fighterSweep(fromTerritoryId: string, targetTerritoryId: string, fighterCount: number): void {
    this.send({ type: 'fighter_sweep', fromTerritoryId, targetTerritoryId, fighterCount });
  }

  unlockGroundTech(tech: GroundTech): void {
    this.send({ type: 'unlock_ground_tech', tech });
  }

  unlockAirTech(tech: AirTech): void {
    this.send({ type: 'unlock_air_tech', tech });
  }

  unlockSupportTech(tech: SupportTech): void {
    this.send({ type: 'unlock_support_tech', tech });
  }

  unlockNavalTech(tech: NavalTech): void {
    this.send({ type: 'unlock_naval_tech', tech });
  }

  unlockUpgrade(upgrade: UpgradeId): void {
    this.send({ type: 'unlock_upgrade', upgrade });
  }

  recruitShips(territoryId: string, count: number): void {
    this.send({ type: 'recruit_ships', territoryId, count });
  }

  moveShips(fromId: string, toId: string, count: number): void {
    this.send({ type: 'move_ships', fromId, toId, count });
  }

  deploySeaFleet(cells: readonly number[]): void {
    this.send({ type: 'deploy_sea_fleet', cells });
  }

  seaShoot(cell: number): void {
    this.send({ type: 'sea_shoot', cell });
  }

  proposeSeaSimulation(): void {
    this.send({ type: 'propose_sea_simulate' });
  }

  declineSeaSimulation(): void {
    this.send({ type: 'decline_sea_simulate' });
  }

  cancelSeaBattle(): void {
    this.send({ type: 'cancel_sea_battle' });
  }

  estimateEnemyForces(targetId: string): void {
    this.send({ type: 'estimate_forces', targetId });
  }

  close(): void {
    this.ws.close();
    this.lobbyListeners.clear();
    this.startListeners.clear();
    this.stateListeners.clear();
    this.errorListeners.clear();
    this.battleListeners.clear();
    this.forceEstimateListeners.clear();
  }
}

/** Same-origin `/ws` in production (nginx proxies it); direct port in dev (no nginx in front of Vite). */
export function resolveWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env.DEV) return `${protocol}//${location.hostname}:8787`;
  return `${protocol}//${location.host}/ws`;
}
