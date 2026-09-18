import { WebSocketServer, WebSocket } from 'ws';
import territoryData from '../src/data/territories.json';
import type { LobbyState, Territory, TerritoryData } from '../src/engine/types';
import { addSlot, claimCapital, canStart, createLobby, generateSessionCode, serializeGameState } from '../src/engine/session';
import { buildGameStateFromLobby } from '../src/engine/setup';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';

const territories: readonly Territory[] = (territoryData as TerritoryData).territories;

const PORT = Number(process.env.PORT) || 8787;

interface Session {
  lobby: LobbyState;
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
            if (!msg.factionCount) throw new Error('factionCount fehlt.');
            const code = freshCode();
            const lobby = createLobby(code, msg.factionCount, playerId, msg.name);
            const session: Session = { lobby, sockets: new Map([[playerId, ws]]) };
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
        case 'start': {
          if (!sessionCode || !playerId) throw new Error('Noch keiner Session beigetreten.');
          const session = sessions.get(sessionCode);
          if (!session) throw new Error('Session nicht mehr aktiv.');
          if (session.lobby.slots[0]?.playerId !== playerId) throw new Error('Nur der Host kann starten.');
          if (!canStart(session.lobby)) throw new Error('Noch nicht jeder hat eine Hauptstadt gewählt.');

          const gameState = buildGameStateFromLobby(session.lobby, territories);
          session.lobby = { ...session.lobby, status: 'started' };
          const message: ServerMessage = { type: 'game_started', gameState: serializeGameState(gameState) };
          for (const socket of session.sockets.values()) send(socket, message);
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
