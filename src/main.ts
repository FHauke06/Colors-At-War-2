import './style.css';
import territoryData from './data/territories.json';
import type { GameState, TerritoryData } from './engine/types';
import type { GameClient } from './net/GameClient';
import { SetupScreen } from './ui/SetupScreen';
import { GameScreen } from './ui/GameScreen';
import { buildThemeToggle } from './ui/theme';

const data = territoryData as TerritoryData;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element missing');
app.className = 'min-h-screen px-4 py-6';

const headerRow = document.createElement('div');
headerRow.className = 'mb-4 flex items-center justify-between gap-3';
const header = document.createElement('h1');
header.textContent = 'Colors at War';
header.className = 'text-xl font-semibold';
headerRow.append(header, buildThemeToggle());
app.appendChild(headerRow);

const screenContainer = document.createElement('div');
app.appendChild(screenContainer);

function showGame(client: GameClient, gameState: GameState): void {
  setup.destroy();
  screenContainer.replaceChildren();
  new GameScreen(screenContainer, data, client, gameState);
}

const setup = new SetupScreen(screenContainer, data, showGame);
