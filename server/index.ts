import { WebSocketServer, WebSocket } from 'ws';
import territoryData from '../src/data/territories.json';
import type { GameState, LobbyState, Territory, TerritoryData } from '../src/engine/types';
import { addAi, addSlot, claimCapital, canStart, createLobby, generateSessionCode, removeAi, serializeGameState } from '../src/engine/session';
import { buildGameStateFromLobby } from '../src/engine/setup';
import { moveUnits } from '../src/engine/movement';
import { endTurn, resumeAiTurnIfNeeded } from '../src/engine/turns';
import { recruitUnits, buildFactory, upgradeInfrastructure } from '../src/engine/economy';
import { declareWar, proposePact, withdrawPactProposal, cancelPact } from '../src/engine/diplomacy';
import { unlockGroundTech, unlockAirTech } from '../src/engine/research';
import { filterGameStateForViewer } from '../src/engine/visibility';
import {
  startBattle,
  simulateAttack,
  cancelBattle,
  markDeployed,
  deploymentFits,
  beginBattlePhase,
  moveBattleUnits,
  escapeBattle,
  bombardBattleCell,
  callAirSupport,
  casStrike,
  endBattleTurn as endBattleTurnEngine,
} from '../src/engine/combat';
import type { BattleResult } from '../src/engine/combat';
import { autoDeployForBattle, cascadeAiBattleTurns } from '../src/engine/ai';
import type { PendingAiDeployment } from '../src/engine/ai';
import { buildAirfield, upgradeAirfield, recruitAircraft, launchBomberRaid, fighterSweep } from '../src/engine/airforce';
import { estimateForces } from '../src/engine/intel';
import type { BattlePlacement } from '../src/engine/types';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';

const territories: readonly Territory[] = (territoryData as TerritoryData).territories;

const PORT = Number(process.env.PORT) || 8787;

interface Session {
  lobby: LobbyState;
  gameState: GameState | null;
  sockets: Map<string, WebSocket>; // playerId -> socket
  /** Deployment for the current pendingBattle, held here instead of on gameState so it's never
   *  broadcast - a player must not see the other side's tactical choice before committing theirs. */
  pendingDeployment: { attacker?: readonly BattlePlacement[]; defender?: readonly BattlePlacement[] };
}

const sessions = new Map<string, Session>();

function freshCode(): string {
  let code: string;
  do {
    code = generateSessionCode();
  } while (sessions.has(code));
  return code;
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function broadcastLobby(session: Session): void {
  const message: ServerMessage = { type: 'lobby', lobby: session.lobby };
  for (const socket of session.sockets.values()) send(socket, message);
}

/** Each socket gets its own view: garrisons and development it isn't entitled to see (see
 *  engine/visibility.ts) are filtered out before serializing - never sent over the wire at all,
 *  not just hidden client-side. */
function broadcastGameState(session: Session): void {
  if (!session.gameState) return;
  for (const [viewerId, socket] of session.sockets) {
    const filtered = filterGameStateForViewer(session.gameState, viewerId, territories);
    send(socket, { type: 'game_state', gameState: serializeGameState(filtered) });
  }
}

function broadcastBattle(session: Session, battle: BattleResult): void {
  const message: ServerMessage = { type: 'battle', battle };
  for (const socket of session.sockets.values()) send(socket, message);
}

/** The AI may have opened a (further) tactical battle against a human and stopped there (see
 *  engine/turns.ts's endTurn/resumeAiTurnIfNeeded) - stash its blind attacker placement the same
 *  way a human's own deployment is kept out of gameState, so 'deploy_battle' can fold both in
 *  once that human deploys as defender. */
function stashPendingAiDeployment(session: Session, pendingAiDeployment: PendingAiDeployment | null): void {
  if (!pendingAiDeployment) return;
  session.pendingDeployment[pendingAiDeployment.side] = pendingAiDeployment.placements;
}

/** Call after any action that might have just concluded a tactical battle (deploying,
 *  battle_move, escape_battle, end_battle_turn): if that leaves the game's active player still
 *  pointing at an AI whose own turn opened the battle and paused mid-way, lets it actually finish
 *  - attack elsewhere, expand, spend its points, or hand control to the next player - instead of
 *  the game just sitting there forever once that battle resolves. A no-op the rest of the time. */
function continueStalledAiTurn(session: Session): void {
  if (!session.gameState) return;
  const result = resumeAiTurnIfNeeded(session.gameState, territories);
  session.gameState = result.gameState;
  stashPendingAiDeployment(session, result.pendingAiDeployment);
}

const wss = new WebSocketServer({ port: PORT });
// eslint-disable-next-line no-console
console.log(`Colors at War session server listening on :${PORT}`);

wss.on('connection', (ws) => {
  let sessionCode: string | null = null;
  let playerId: string | null = null;

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Ungültige Nachricht.' });
      return;
    }

    try {
      switch (msg.type) {
        case 'join': {
          playerId = msg.playerId;
          if (msg.code) {
            const session = sessions.get(msg.code.toUpperCase());
            if (!session) throw new Error('Session nicht gefunden.');
            session.lobby = addSlot(session.lobby, playerId, msg.name);
            session.sockets.set(playerId, ws);
            sessionCode = session.lobby.code;
            broadcastLobby(session);
          } else {
            if (!msg.maxHumans) throw new Error('maxHumans fehlt.');
            const code = freshCode();
            const lobby = createLobby(code, msg.maxHumans, playerId, msg.name, msg.aiDifficulty);
            const session: Session = { lobby, gameState: null, sockets: new Map([[playerId, ws]]), pendingDeployment: {} };
            sessions.set(code, session);
            sessionCode = code;
            broadcastLobby(session);
          }
          break;
        }
        case 'claim_capital': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session) throw new Error('Session nicht mehr aktiv.');
          session.lobby = claimCapital(session.lobby, playerId, msg.territoryId, territories);
          broadcastLobby(session);
          break;
        }
        case 'add_ai': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session) throw new Error('Session nicht mehr aktiv.');
          if (session.lobby.slots[0]?.playerId !== playerId) throw new Error('Nur der Host kann KIs hinzufügen.');
          session.lobby = addAi(session.lobby, territories);
          broadcastLobby(session);
          break;
        }
        case 'remove_ai': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session) throw new Error('Session nicht mehr aktiv.');
          if (session.lobby.slots[0]?.playerId !== playerId) throw new Error('Nur der Host kann KIs entfernen.');
          session.lobby = removeAi(session.lobby, msg.aiId);
          broadcastLobby(session);
          break;
        }
        case 'start': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session) throw new Error('Session nicht mehr aktiv.');
          if (session.lobby.slots[0]?.playerId !== playerId) throw new Error('Nur der Host kann starten.');
          if (!canStart(session.lobby)) throw new Error('Noch nicht jeder hat eine Hauptstadt gewählt.');

          session.gameState = buildGameStateFromLobby(session.lobby, territories);
          session.lobby = { ...session.lobby, status: 'started' };
          broadcastGameState(session);
          break;
        }
        case 'move_units': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = moveUnits(session.gameState, playerId, msg.fromId, msg.toId, territories, msg.amount);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'end_turn': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = endTurn(session.gameState, playerId, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          stashPendingAiDeployment(session, outcome.pendingAiDeployment);
          broadcastGameState(session);
          break;
        }
        case 'recruit': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = recruitUnits(session.gameState, playerId, msg.territoryId, msg.amount);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'build_factory': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = buildFactory(session.gameState, playerId, msg.territoryId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'upgrade_infrastructure': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = upgradeInfrastructure(session.gameState, playerId, msg.territoryId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'build_airfield': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = buildAirfield(session.gameState, playerId, msg.territoryId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'upgrade_airfield': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = upgradeAirfield(session.gameState, playerId, msg.territoryId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'recruit_aircraft': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = recruitAircraft(session.gameState, playerId, msg.territoryId, msg.amount);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'launch_bomber_raid': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = launchBomberRaid(session.gameState, playerId, msg.fromTerritoryId, msg.targetTerritoryId, msg.bomberCount, msg.mode, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'fighter_sweep': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = fighterSweep(session.gameState, playerId, msg.fromTerritoryId, msg.targetTerritoryId, msg.fighterCount, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'attack': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = startBattle(session.gameState, playerId, msg.fromId, msg.toId, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          session.pendingDeployment = {};

          const pending = session.gameState.pendingBattle!;
          const defender = session.gameState.players.find((p) => p.id === pending.defenderId);
          if (defender?.isAI) {
            session.pendingDeployment.defender = autoDeployForBattle(pending.defenderMax, pending.subTerritories, 'defender');
            session.gameState = markDeployed(session.gameState, 'defender');
          }
          broadcastGameState(session);
          break;
        }
        case 'simulate_attack': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = simulateAttack(session.gameState, playerId, msg.fromId, msg.toId, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastBattle(session, outcome.result);
          broadcastGameState(session);
          break;
        }
        case 'cancel_attack': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = cancelBattle(session.gameState, playerId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          session.pendingDeployment = {};
          broadcastGameState(session);
          break;
        }
        case 'deploy_battle': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          const pending = session?.gameState?.pendingBattle;
          if (!session?.gameState || !pending) throw new Error('Kein Kampf im Gange.');

          let side: 'attacker' | 'defender';
          if (pending.attackerId === playerId && !pending.attackerDeployed) side = 'attacker';
          else if (pending.defenderId === playerId && !pending.defenderDeployed) side = 'defender';
          else throw new Error('Du kannst hier nicht aufstellen.');

          const max = side === 'attacker' ? pending.attackerMax : pending.defenderMax;
          const validSubIds = new Set(
            pending.subTerritories.filter((t) => t.side === side && !t.isEscape && t.terrain === 'normal').map((t) => t.id),
          );
          if (!deploymentFits(max, msg.placements, validSubIds)) throw new Error('Ungültige Aufstellung.');

          session.pendingDeployment[side] = msg.placements;
          session.gameState = markDeployed(session.gameState, side);

          const nowPending = session.gameState.pendingBattle!;
          if (nowPending.attackerDeployed && nowPending.defenderDeployed) {
            session.gameState = beginBattlePhase(
              session.gameState,
              session.pendingDeployment.attacker!,
              session.pendingDeployment.defender!,
            );
            session.pendingDeployment = {};
            // The attacker always moves first (see beginBattlePhase) - if that's the AI (now
            // possible since it can initiate a tactical attack itself, see engine/ai.ts's
            // launchAiAttack), it needs to actually take that opening move here, or the battle
            // would just sit waiting on a turn nobody ever plays.
            session.gameState = cascadeAiBattleTurns(session.gameState, territories);
          }
          continueStalledAiTurn(session);
          broadcastGameState(session);
          break;
        }
        case 'battle_move': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = moveBattleUnits(session.gameState, playerId, msg.fromSubId, msg.toSubId, msg.amount, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          if (outcome.concluded) broadcastBattle(session, outcome.concluded);
          continueStalledAiTurn(session);
          broadcastGameState(session);
          break;
        }
        case 'escape_battle': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = escapeBattle(session.gameState, playerId, msg.fromSubId, msg.destinationId, msg.amount, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          if (outcome.concluded) broadcastBattle(session, outcome.concluded);
          continueStalledAiTurn(session);
          broadcastGameState(session);
          break;
        }
        case 'bombard_battle_cell': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = bombardBattleCell(session.gameState, playerId, msg.fromSubId, msg.targetSubId, msg.artilleryCount, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          if (outcome.concluded) broadcastBattle(session, outcome.concluded);
          continueStalledAiTurn(session);
          broadcastGameState(session);
          break;
        }
        case 'call_air_support': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = callAirSupport(session.gameState, playerId, msg.aircraftType, msg.fromTerritoryId, msg.count, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'cas_strike': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = casStrike(session.gameState, playerId, msg.calledAircraftId, msg.targetSubId, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          if (outcome.concluded) broadcastBattle(session, outcome.concluded);
          continueStalledAiTurn(session);
          broadcastGameState(session);
          break;
        }
        case 'end_battle_turn': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = endBattleTurnEngine(session.gameState, playerId, territories);
          if (!outcome.ok) throw new Error(outcome.reason);
          // A full round has a hard cap (see engine/combat.ts's MAX_BATTLE_ROUNDS) past which the
          // defender wins outright - reported the same way a move/escape concluding it already is.
          if (outcome.concluded) broadcastBattle(session, outcome.concluded);
          session.gameState = cascadeAiBattleTurns(outcome.gameState, territories);
          continueStalledAiTurn(session);
          broadcastGameState(session);
          break;
        }
        case 'declare_war': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = declareWar(session.gameState, playerId, msg.targetId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'propose_pact': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = proposePact(session.gameState, playerId, msg.targetId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'withdraw_pact_proposal': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = withdrawPactProposal(session.gameState, playerId, msg.targetId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'cancel_pact': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = cancelPact(session.gameState, playerId, msg.targetId);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'unlock_ground_tech': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = unlockGroundTech(session.gameState, playerId, msg.tech);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'unlock_air_tech': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          const outcome = unlockAirTech(session.gameState, playerId, msg.tech);
          if (!outcome.ok) throw new Error(outcome.reason);
          session.gameState = outcome.gameState;
          broadcastGameState(session);
          break;
        }
        case 'estimate_forces': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session?.gameState) throw new Error('Das Spiel läuft noch nicht.');
          // Computed from session.gameState (the authoritative, unfiltered state) and sent only to
          // this one socket - viewer-specific intel, never broadcast to the rest of the session.
          const estimate = estimateForces(session.gameState, msg.targetId);
          send(ws, { type: 'force_estimate', targetId: msg.targetId, estimate });
          break;
        }
      }
    } catch (err) {
      send(ws, { type: 'error', message: (err as Error).message });
    }
  });

  ws.on('close', () => {
    // v1: the slot stays in place so a refresh/rejoin with the same code still finds it.
    // A session simply goes stale if nobody reconnects - fine for casual same-group matches.
  });
});
