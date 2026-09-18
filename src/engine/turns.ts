import type { GameState, Territory, TerritoryState, UnitComposition } from './types';
import { playAiTurn } from './ai';
import { creditIncome } from './economy';

export type EndTurnOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0 };

function resetMovement(territoryState: GameState['territoryState']): GameState['territoryState'] {
  const next = new Map<string, TerritoryState>();
  for (const [id, state] of territoryState) next.set(id, { ...state, movedIn: EMPTY_GARRISON });
  return next;
}

/** Advances the pointer to the very next seat in player order, wrapping the round counter,
 *  refreshing which units may move again, and paying everyone's income once every seat has had
 *  a turn. */
function advanceToNextPlayer(gameState: GameState): GameState {
  const { players } = gameState;
  const currentIndex = players.findIndex((p) => p.id === gameState.activePlayerId);
  const nextIndex = (currentIndex + 1) % players.length;
  const wrapped = nextIndex === 0;
  const nextPlayer = players[nextIndex]!;
  const advanced: GameState = {
    ...gameState,
    turn: wrapped ? gameState.turn + 1 : gameState.turn,
    activePlayerId: nextPlayer.id,
    territoryState: wrapped ? resetMovement(gameState.territoryState) : gameState.territoryState,
  };
  return wrapped ? creditIncome(advanced) : advanced;
}

/**
 * Ends `playerId`'s turn and hands control to the next seat. Any AI seats that follow act
 * immediately, in order (see ai.ts for their current, very simple policy), until control
 * reaches the next human - or wraps back to `playerId` if they're the only human at the table.
 */
export function endTurn(gameState: GameState, playerId: string, territories: readonly Territory[]): EndTurnOutcome {
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  if (!gameState.players.some((p) => p.id === playerId)) return { ok: false, reason: 'Spieler nicht gefunden.' };

  let state = advanceToNextPlayer(gameState);
  while (true) {
    const active = state.players.find((p) => p.id === state.activePlayerId);
    if (!active?.isAI) break;
    state = playAiTurn(state, active.id, territories);
    state = advanceToNextPlayer(state);
  }
  return { ok: true, gameState: state };
}
