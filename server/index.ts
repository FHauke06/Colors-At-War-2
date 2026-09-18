import { WebSocketServer, WebSocket } from 'ws';
import territoryData from '../src/data/territories.json';
import type { GameState, LobbyState, Territory, TerritoryData } from '../src/engine/types';
import { addAi, addSlot, claimCapital, canStart, createLobby, generateSessionCode, removeAi, serializeGameState } from '../src/engine/session';
import { buildGameStateFromLobby } from '../src/engine/setup';
import { moveUnits } from '../src/engine/movement';
import { endTurn } from '../src/engine/turns';
import { recruitUnits } from '../src/engine/economy';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';

const territories: readonly Territory[] = (territoryData as TerritoryData).territories;

const PORT = Number(process.env.PORT) || 8787;

interface Session {
  lobby: LobbyState;
  gameState: GameState | null;
  sockets: Map<string, WebSocket>; // playerId -> socket
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

function broadcastGameState(session: Session): void {
  if (!session.gameState) return;
  const message: ServerMessage = { type: 'game_state', gameState: serializeGameState(session.gameState) };
  for (const socket of session.sockets.values()) send(socket, message);
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
            const lobby = createLobby(code, msg.maxHumans, playerId, msg.name);
            const session: Session = { lobby, gameState: null, sockets: new Map([[playerId, ws]]) };
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
