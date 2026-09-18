import './style.css';
import territoryData from './data/territories.json';
import type { GameState, TerritoryData } from './engine/types';
import { SetupScreen } from './ui/SetupScreen';
import { GameScreen } from './ui/GameScreen';

const data = territoryData as TerritoryData;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element missing');
app.className = 'min-h-screen px-4 py-6';

const header = document.createElement('h1');
header.textContent = 'Colors at War';
header.className = 'mb-4 text-xl font-semibold';
app.appendChild(header);

const screenContainer = document.createElement('div');
app.appendChild(screenContainer);

function showGame(gameState: GameState): void {
  screenContainer.replaceChildren();
  new GameScreen(screenContainer, data, gameState);
}

new SetupScreen(screenContainer, data, showGame);
