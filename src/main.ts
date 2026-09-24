import './style.css';
import type { GameState, TerritoryData } from './engine/types';
import type { GameClient } from './net/GameClient';
import { SetupScreen } from './ui/SetupScreen';
import { GameScreen } from './ui/GameScreen';
import { buildThemeToggle } from './ui/theme';
import { buildLogo } from './ui/logo';
import { buildHelpButton, isHelpOpen, openHelp } from './ui/helpDialog';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element missing');
app.className = 'min-h-screen px-4 py-6';

const headerRow = document.createElement('div');
headerRow.className = 'mb-4 flex items-center justify-between gap-3';
const headerLogo = buildLogo('sm');
// Auf dem Startbildschirm steht das große Logo - die Kopfzeile hält dann nur den Platz frei (siehe style.css, `title-screen`).
headerLogo.classList.add('header-logo');
const headerActions = document.createElement('div');
headerActions.className = 'flex items-center gap-2';
headerActions.append(buildHelpButton(), buildThemeToggle());
headerRow.append(headerLogo, headerActions);
app.appendChild(headerRow);

// "?" öffnet die Spielhilfe - außer beim Tippen in einem Eingabefeld.
document.addEventListener('keydown', (e) => {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isHelpOpen()) return;
  const target = e.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  e.preventDefault();
  openHelp();
});

const screenContainer = document.createElement('div');
app.appendChild(screenContainer);

function showGame(client: GameClient, gameState: GameState, data: TerritoryData): void {
  setup.destroy();
  document.documentElement.classList.remove('title-screen');
  screenContainer.replaceChildren();
  new GameScreen(screenContainer, data, client, gameState);
}

const setup = new SetupScreen(screenContainer, showGame);
