import type { GameState, Territory, TerritoryState, UnitComposition } from './types';
import { playAiTurn, type PendingAiDeployment } from './ai';
import { creditIncome } from './economy';
import { isEliminated, isGameOver } from './victory';
import { resolveAirCombatForRound } from './airforce';

export type EndTurnOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly pendingAiDeployment: PendingAiDeployment | null }
  | { readonly ok: false; readonly reason: string };

const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

function resetMovement(territoryState: GameState['territoryState']): GameState['territoryState'] {
  const next = new Map<string, TerritoryState>();
  for (const [id, state] of territoryState) next.set(id, { ...state, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON });
  return next;
}

/** Advances the pointer to the next seat still holding any territory (see victory.ts's
 *  isEliminated - an eliminated player has nothing left to command, so their seat is skipped
 *  entirely), wrapping the round counter, refreshing which units may move again, paying everyone's
 *  income, and running the background Jäger contest over every contested territory (see
 *  engine/airforce.ts's resolveAirCombatForRound) once every remaining seat has had a turn. Stops
 *  at the active player themselves if literally everyone else is eliminated - endTurn refuses to be
 *  called at all once the game's actually over (see isGameOver), so this is just a defensive floor. */
function advanceToNextPlayer(gameState: GameState, territories: readonly Territory[]): GameState {
  const { players } = gameState;
  const currentIndex = players.findIndex((p) => p.id === gameState.activePlayerId);

  let nextIndex = currentIndex;
  let wrapped = false;
  do {
    nextIndex = (nextIndex + 1) % players.length;
    if (nextIndex === 0) wrapped = true;
  } while (isEliminated(gameState, players[nextIndex]!.id) && nextIndex !== currentIndex);
  const nextPlayer = players[nextIndex]!;

  const advanced: GameState = {
    ...gameState,
    turn: wrapped ? gameState.turn + 1 : gameState.turn,
    activePlayerId: nextPlayer.id,
    territoryState: wrapped ? resetMovement(gameState.territoryState) : gameState.territoryState,
  };
  if (!wrapped) return advanced;
  return resolveAirCombatForRound(creditIncome(advanced), territories);
}

export interface CascadeResult {
  readonly gameState: GameState;
  readonly pendingAiDeployment: PendingAiDeployment | null;
}

/** Hard cap on consecutive AI seats processed in one cascadeAiTurns call. Once every remaining
 *  human is eliminated (see victory.ts's isEliminated), the loop below has no human turn left to
 *  stop at - it can only end via isGameOver, which depends on the AIs actually finishing each
 *  other off. That's a real, unbounded number of turns in principle, so this cap exists purely as
 *  a hard backstop against ever actually hanging the event loop; a real playthrough resolves in a
 *  tiny fraction of this. */
const MAX_CASCADE_PLAYER_TURNS = 1000;

/**
 * Runs consecutive AI seats' turns, in order, starting from whoever's currently active - until
 * control reaches a human, the game is decided, an AI opens a tactical battle against a human (in
 * which case pendingAiDeployment carries that AI's blind attacker placement - see ai.ts's
 * PendingAiDeployment - for the caller to stash the same way a human's own deployment is kept out
 * of gameState; the cascade stops there since nothing else can proceed while a battle is pending),
 * or MAX_CASCADE_PLAYER_TURNS is reached (see its own doc comment). Shared by endTurn (which
 * advances past the player ending their turn first) and resumeAiTurnIfNeeded (which doesn't - it
 * continues the same AI's turn that a battle had paused).
 */
function cascadeAiTurns(gameState: GameState, territories: readonly Territory[]): CascadeResult {
  let state = gameState;
  let pendingAiDeployment: PendingAiDeployment | null = null;
  for (let turns = 0; turns < MAX_CASCADE_PLAYER_TURNS && !state.pendingBattle && !isGameOver(state); turns++) {
    const active = state.players.find((p) => p.id === state.activePlayerId);
    if (!active?.isAI) break;
    const result = playAiTurn(state, active.id, territories);
    state = result.gameState;
    if (result.pendingAiDeployment) {
      pendingAiDeployment = result.pendingAiDeployment;
      break;
    }
    state = advanceToNextPlayer(state, territories);
  }
  return { gameState: state, pendingAiDeployment };
}

/**
 * Ends `playerId`'s turn and hands control to the next seat, then cascades through any AI seats
 * that follow (see cascadeAiTurns).
 */
export function endTurn(gameState: GameState, playerId: string, territories: readonly Territory[]): EndTurnOutcome {
  if (isGameOver(gameState)) return { ok: false, reason: 'Das Spiel ist bereits entschieden.' };
  if (gameState.pendingBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  if (!gameState.players.some((p) => p.id === playerId)) return { ok: false, reason: 'Spieler nicht gefunden.' };

  const advanced = advanceToNextPlayer(gameState, territories);
  const { gameState: state, pendingAiDeployment } = cascadeAiTurns(advanced, territories);
  return { ok: true, gameState: state, pendingAiDeployment };
}

/**
 * Resumes a stalled AI turn: call this after any human action that might have just concluded a
 * tactical battle (deploying as defender, making a tactical move, escaping, or ending their own
 * battle-turn - see net/LocalGameClient.ts and server/index.ts). When an AI opens a battle against
 * a human, its turn gets paused mid-way (see PendingAiDeployment) with the game's active player
 * left pointing at that AI and no pendingBattle-blocked action able to advance it further. Once
 * the human resolves the battle, nothing else would ever let that AI finish its turn (attack
 * elsewhere, expand, spend its points) or hand control to the next player - without this, the game
 * would simply sit there forever once an AI's battle concludes. A no-op (returns the state
 * unchanged) if a battle is still pending, or if the active player isn't AI - the ordinary case
 * where a human's own battle just concluded and it's already correctly their turn to continue.
 */
export function resumeAiTurnIfNeeded(gameState: GameState, territories: readonly Territory[]): CascadeResult {
  if (gameState.pendingBattle) return { gameState, pendingAiDeployment: null };
  const active = gameState.players.find((p) => p.id === gameState.activePlayerId);
  if (!active?.isAI) return { gameState, pendingAiDeployment: null };
  return cascadeAiTurns(gameState, territories);
}
