import type { GameState, TerritoryData } from '../engine/types';
import { MapRenderer } from '../render/MapRenderer';

export class GameScreen {
  constructor(container: HTMLElement, data: TerritoryData, gameState: GameState) {
    const shell = document.createElement('div');
    shell.className = 'mx-auto max-w-6xl';

    const mapContainer = document.createElement('div');
    const legend = document.createElement('div');
    legend.className = 'mt-4 flex flex-wrap gap-2';

    for (const player of gameState.players) {
      const capital = data.territories.find((t) => t.id === player.capitalId);
      const chip = document.createElement('div');
      chip.className =
        'flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100';
      const swatch = document.createElement('span');
      swatch.className = 'h-3 w-3 shrink-0 rounded-full';
      swatch.style.background = player.color;
      const text = document.createElement('span');
      const suffix = player.isAI ? ' (KI)' : '';
      text.textContent = `${player.name}${suffix} — ${capital?.name ?? player.capitalId}`;
      chip.append(swatch, text);
      legend.appendChild(chip);
    }

    shell.append(mapContainer, legend);
    container.appendChild(shell);

    const map = new MapRenderer(mapContainer, data);
    map.applyGameState(gameState);
  }
}
