import type { GameState, LobbyState, Territory, TerritoryData } from '../engine/types';
import { MIN_FACTIONS, MAX_FACTIONS } from '../engine/palette';
import { canStart } from '../engine/session';
import { MapRenderer } from '../render/MapRenderer';
import type { GameClient } from '../net/GameClient';
import { isHost } from '../net/GameClient';
import { LocalGameClient } from '../net/LocalGameClient';
import { RemoteGameClient, resolveWsUrl } from '../net/RemoteGameClient';

const inputClass =
  'rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none';
const primaryBtnClass =
  'rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500';
const secondaryBtnClass =
  'rounded-md border border-slate-600 bg-slate-800 px-4 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-700';
const cardClass = 'rounded-lg border border-slate-700 bg-slate-800/60 p-6';

export class SetupScreen {
  private readonly root: HTMLElement;
  private readonly territories: readonly Territory[];
  private readonly data: TerritoryData;
  private readonly onComplete: (client: GameClient, gameState: GameState) => void;

  private client: GameClient | null = null;
  private map: MapRenderer | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(container: HTMLElement, data: TerritoryData, onComplete: (client: GameClient, gameState: GameState) => void) {
    this.data = data;
    this.territories = data.territories;
    this.onComplete = onComplete;
    this.root = document.createElement('div');
    this.root.className = 'mx-auto max-w-2xl';
    container.appendChild(this.root);
    this.renderModeSelect();
  }

  /** Unsubscribes from the current client's events. Call when this screen is being torn down
   *  (e.g. after the game starts) so it doesn't keep reacting to state changes in the background. */
  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  private clear(): void {
    this.destroy();
    this.map = null;
    this.root.replaceChildren();
  }

  // --- step 1: offline vs online ---
  private renderModeSelect(): void {
    this.clear();
    const card = document.createElement('div');
    card.className = `${cardClass} flex flex-col items-center gap-4 text-center`;

    const title = document.createElement('h2');
    title.textContent = 'Wie möchtest du spielen?';
    title.className = 'text-lg font-semibold';

    const row = document.createElement('div');
    row.className = 'flex gap-3';

    const offlineBtn = document.createElement('button');
    offlineBtn.type = 'button';
    offlineBtn.textContent = 'Offline (gegen Computer)';
    offlineBtn.className = primaryBtnClass;
    offlineBtn.addEventListener('click', () => this.renderOfflineConfig());

    const onlineBtn = document.createElement('button');
    onlineBtn.type = 'button';
    onlineBtn.textContent = 'Online (mit Freunden)';
    onlineBtn.className = secondaryBtnClass;
    onlineBtn.addEventListener('click', () => this.renderOnlineChoice());

    row.append(offlineBtn, onlineBtn);
    card.append(title, row);
    this.root.appendChild(card);
  }

  // --- step 2a: offline config ---
  private renderOfflineConfig(): void {
    this.clear();
    let factionCount = 4;
    const { card, nameInput } = this.renderPlayerAndCountForm(
      'Gegen den Computer spielen',
      'Anzahl Fraktionen:',
      MIN_FACTIONS,
      () => factionCount,
      (n) => { factionCount = n; },
    );

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = 'Weiter zur Hauptstadt-Wahl';
    startBtn.className = primaryBtnClass;
    startBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Spieler 1';
      this.client = new LocalGameClient(this.territories, name, factionCount - 1);
      this.enterLobby();
    });

    card.append(this.backRow(), startBtn);
    this.root.appendChild(card);
  }

  // --- step 2b: online choice ---
  private renderOnlineChoice(): void {
    this.clear();
    const card = document.createElement('div');
    card.className = `${cardClass} flex flex-col items-center gap-4 text-center`;

    const title = document.createElement('h2');
    title.textContent = 'Online spielen';
    title.className = 'text-lg font-semibold';

    const row = document.createElement('div');
    row.className = 'flex gap-3';

    const hostBtn = document.createElement('button');
    hostBtn.type = 'button';
    hostBtn.textContent = 'Session erstellen';
    hostBtn.className = primaryBtnClass;
    hostBtn.addEventListener('click', () => this.renderOnlineHostConfig());

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.textContent = 'Session beitreten';
    joinBtn.className = secondaryBtnClass;
    joinBtn.addEventListener('click', () => this.renderOnlineJoinConfig());

    row.append(hostBtn, joinBtn);
    card.append(title, row, this.backRow(() => this.renderModeSelect()));
    this.root.appendChild(card);
  }

  // --- step 3a: create an online session ---
  private renderOnlineHostConfig(): void {
    this.clear();
    let maxHumans = 4;
    const { card, nameInput } = this.renderPlayerAndCountForm(
      'Session erstellen',
      'Wie viele Spieler dürfen beitreten:',
      1,
      () => maxHumans,
      (n) => { maxHumans = n; },
    );
    const hint = document.createElement('p');
    hint.className = 'text-sm text-slate-400';
    hint.textContent = 'Computer-Gegner kannst du danach direkt in der Lobby hinzufügen.';
    card.appendChild(hint);

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = 'Session erstellen';
    createBtn.className = primaryBtnClass;
    createBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Host';
      this.client = new RemoteGameClient(resolveWsUrl(), { name, maxHumans });
      this.enterLobby();
    });

    card.append(this.backRow(() => this.renderOnlineChoice()), createBtn);
    this.root.appendChild(card);
  }

  // --- step 3b: join an online session ---
  private renderOnlineJoinConfig(): void {
    this.clear();
    const card = document.createElement('div');
    card.className = `${cardClass} flex flex-col gap-4`;

    const title = document.createElement('h2');
    title.textContent = 'Session beitreten';
    title.className = 'text-lg font-semibold';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Dein Name';
    nameInput.maxLength = 24;
    nameInput.className = inputClass;

    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.placeholder = 'Session-Code (z.B. AB3XQ9)';
    codeInput.maxLength = 6;
    codeInput.className = `${inputClass} uppercase tracking-widest`;
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase();
    });

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.textContent = 'Beitreten';
    joinBtn.className = primaryBtnClass;
    joinBtn.addEventListener('click', () => {
      const code = codeInput.value.trim();
      if (code.length !== 6) return;
      const name = nameInput.value.trim() || 'Spieler';
      this.client = new RemoteGameClient(resolveWsUrl(), { name, code });
      this.enterLobby();
    });

    card.append(title, nameInput, codeInput, this.backRow(() => this.renderOnlineChoice()), joinBtn);
    this.root.appendChild(card);
  }

  // --- shared form for "name + a bounded stepper" (offline faction count / online-host max humans) ---
  private renderPlayerAndCountForm(
    heading: string,
    countLabelText: string,
    minCount: number,
    getCount: () => number,
    setCount: (n: number) => void,
  ): { card: HTMLDivElement; nameInput: HTMLInputElement; countLabel: HTMLSpanElement; bumpCount: (d: number) => void } {
    const card = document.createElement('div');
    card.className = `${cardClass} flex flex-col gap-4`;

    const title = document.createElement('h2');
    title.textContent = heading;
    title.className = 'text-lg font-semibold';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Dein Name';
    nameInput.maxLength = 24;
    nameInput.className = inputClass;

    const countRow = document.createElement('div');
    countRow.className = 'flex items-center gap-3';
    const countLabelEl = document.createElement('span');
    countLabelEl.textContent = countLabelText;
    countLabelEl.className = 'text-sm text-slate-300';
    const countLabel = document.createElement('span');
    countLabel.className = 'w-8 text-center text-sm tabular-nums';

    const bumpCount = (delta: number): void => {
      setCount(Math.min(MAX_FACTIONS, Math.max(minCount, getCount() + delta)));
      countLabel.textContent = String(getCount());
    };
    bumpCount(0);

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.textContent = '-';
    minusBtn.className = 'h-8 w-8 rounded-md border border-slate-600 bg-slate-800 text-lg leading-none hover:bg-slate-700';
    minusBtn.addEventListener('click', () => bumpCount(-1));

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    plusBtn.className = 'h-8 w-8 rounded-md border border-slate-600 bg-slate-800 text-lg leading-none hover:bg-slate-700';
    plusBtn.addEventListener('click', () => bumpCount(1));

    countRow.append(countLabelEl, minusBtn, countLabel, plusBtn);
    card.append(title, nameInput, countRow);
    return { card, nameInput, countLabel, bumpCount };
  }

  private backRow(onBack?: () => void): HTMLDivElement {
    const row = document.createElement('div');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '← Zurück';
    btn.className = 'text-sm text-slate-400 hover:text-slate-200';
    btn.addEventListener('click', () => (onBack ? onBack() : this.renderModeSelect()));
    row.appendChild(btn);
    return row;
  }

  // --- step 4: lobby (shared by offline & online) ---
  private enterLobby(): void {
    const client = this.client;
    if (!client) return;
    this.root.replaceChildren();

    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-4';

    const status = document.createElement('div');
    status.className = 'text-sm text-slate-300';

    const errorBanner = document.createElement('div');
    errorBanner.className = 'hidden rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-200';

    const slotList = document.createElement('div');
    slotList.className = 'flex flex-wrap gap-2';

    const addAiBtn = document.createElement('button');
    addAiBtn.type = 'button';
    addAiBtn.textContent = '+ KI hinzufügen';
    addAiBtn.className = secondaryBtnClass;
    addAiBtn.addEventListener('click', () => client.addAi());

    const hint = document.createElement('p');
    hint.className = 'text-sm text-slate-400';
    hint.textContent = 'Klicke auf der Karte ein Gebiet, um es als deine Hauptstadt festzulegen.';

    const mapContainer = document.createElement('div');
    this.map = new MapRenderer(mapContainer, this.data);
    this.map.setClickHandler((territoryId) => client.claimCapital(territoryId));

    const actionRow = document.createElement('div');
    actionRow.className = 'flex items-center gap-3';
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = 'Spiel starten';
    startBtn.className = primaryBtnClass;
    startBtn.addEventListener('click', () => client.start());
    actionRow.appendChild(startBtn);

    wrap.append(status, errorBanner, slotList, addAiBtn, hint, mapContainer, actionRow);
    this.root.appendChild(wrap);

    const showError = (message: string): void => {
      errorBanner.textContent = message;
      errorBanner.classList.remove('hidden');
    };

    const update = (lobby: LobbyState): void => {
      const host = isHost(client);
      const connecting = client.isOnline && !lobby.code;

      status.classList.toggle('hidden', !client.isOnline);
      if (client.isOnline) {
        status.textContent = connecting
          ? 'Verbinde...'
          : `Session-Code: ${lobby.code} · ${lobby.slots.length}/${lobby.maxHumans} Spieler beigetreten` +
            (host ? '' : ' · Warte auf Host...');
      }

      slotList.replaceChildren();
      for (const slot of lobby.slots) {
        slotList.appendChild(this.renderSlotChip(slot.color, slot.name, slot.capitalId, [
          slot.isHost ? 'Host' : null,
          slot.playerId === client.playerId ? 'Du' : null,
        ].filter((s): s is string => s !== null)));
      }
      for (const ai of lobby.aiSlots) {
        const onRemove = client.isOnline && host ? () => client.removeAi(ai.id) : undefined;
        slotList.appendChild(this.renderSlotChip(ai.color, ai.name, ai.capitalId, [], onRemove));
      }

      const canAddMore = lobby.slots.length + lobby.aiSlots.length < MAX_FACTIONS;
      addAiBtn.classList.toggle('hidden', !(client.isOnline && host));
      addAiBtn.disabled = !canAddMore || connecting;

      this.map?.applyLobby(lobby);

      startBtn.classList.toggle('hidden', !host);
      startBtn.disabled = !canStart(lobby) || connecting;
    };

    this.unsubscribers.push(client.onLobby(update));
    this.unsubscribers.push(client.onError(showError));
    this.unsubscribers.push(client.onGameStart((gameState) => this.onComplete(client, gameState)));

    update(client.getLobby());
  }

  private renderSlotChip(
    color: string,
    name: string,
    capitalId: string | null,
    tags: readonly string[],
    onRemove?: () => void,
  ): HTMLDivElement {
    const chip = document.createElement('div');
    chip.className = 'flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100';
    const swatch = document.createElement('span');
    swatch.className = 'h-3 w-3 shrink-0 rounded-full';
    swatch.style.background = color;
    const text = document.createElement('span');
    const capital = capitalId ? this.territories.find((t) => t.id === capitalId)?.name ?? capitalId : 'wählt noch...';
    const tagText = tags.length ? ` (${tags.join(', ')})` : '';
    text.textContent = `${name}${tagText} — ${capital}`;
    chip.append(swatch, text);
    if (onRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.className = 'text-slate-400 hover:text-red-400';
      removeBtn.addEventListener('click', onRemove);
      chip.appendChild(removeBtn);
    }
    return chip;
  }
}
