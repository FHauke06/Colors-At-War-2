import type { GameState, Player } from './types';

/** How many territories `playerId` currently owns. */
export function territoryCountFor(gameState: GameState, playerId: string): number {
  let count = 0;
  for (const state of gameState.territoryState.values()) {
    if (state.ownerId === playerId) count++;
  }
  return count;
}

/** A player with zero territories has lost and is out of the game - nothing left to command, so
 *  their seat is simply skipped from here on (see engine/turns.ts's advanceToNextPlayer). */
export function isEliminated(gameState: GameState, playerId: string): boolean {
  return territoryCountFor(gameState, playerId) === 0;
}

/** Every player still holding at least one territory, in the game's original seating order. */
export function remainingPlayers(gameState: GameState): readonly Player[] {
  return gameState.players.filter((p) => !isEliminated(gameState, p.id));
}

/** The winner, once the game is decided (see isGameOver) - the remaining player holding the most
 *  territory. Usually there's only one remaining player left to pick from; once every human is
 *  out, though, several AI may still be remaining and contesting - the match is called in favor of
 *  whichever currently leads rather than simulating their fight out to the very end. Null while the
 *  game is still genuinely contested. */
export function gameWinner(gameState: GameState): Player | null {
  if (!isGameOver(gameState)) return null;
  const remaining = remainingPlayers(gameState);
  if (remaining.length === 0) return null; // unreachable in practice: a simultaneous mutual wipeout
  return [...remaining].sort((a, b) => territoryCountFor(gameState, b.id) - territoryCountFor(gameState, a.id))[0]!;
}

/** True once the game has been decided: either one player remains (or, in the
 *  unreachable-in-practice case of a simultaneous mutual wipeout, nobody at all), or - regardless
 *  of how many AI factions are still fighting it out - every human player has been eliminated. A
 *  human-vs-AI match has nothing left for anyone to actually play once its human is out, so it ends
 *  immediately rather than leaving them watching AI-vs-AI resolve on its own (see gameWinner). */
export function isGameOver(gameState: GameState): boolean {
  const remaining = remainingPlayers(gameState);
  if (remaining.length <= 1) return true;
  return !remaining.some((p) => !p.isAI);
}

/** Every player's current territory count, sorted most-held-first - the whole game's worth of
 *  standings in one place, for a stats display. Includes eliminated players (at 0). */
export function territoryStandings(gameState: GameState): readonly { readonly player: Player; readonly count: number }[] {
  return gameState.players
    .map((player) => ({ player, count: territoryCountFor(gameState, player.id) }))
    .sort((a, b) => b.count - a.count);
}
