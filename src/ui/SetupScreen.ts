import type { GameState, LobbyState, Territory, TerritoryData } from '../engine/types';
import { MIN_FACTIONS, MAX_FACTIONS } from '../engine/palette';
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
  private readonly onComplete: (gameState: GameState) => void;

  private client: GameClient | null = null;
  private map: MapRenderer | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(container: HTMLElement, data: TerritoryData, onComplete: (gameState: GameState) => void) {
    this.data = data;
    this.territories = data.territories;
    this.onComplete = onComplete;
    this.root = document.createElement('div');
    this.root.className = 'mx-auto max-w-2xl';
    container.appendChild(this.root);
    this.renderModeSelect();
  }

  private clear(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
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
      () => factionCount,
      (n) => { factionCount = n; },
    );

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = 'Weiter zur Hauptstadt-Wahl';
    startBtn.className = primaryBtnClass;
    startBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Spieler 1';
      this.client = new LocalGameClient(this.territories, factionCount, name);
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
    let factionCount = 4;
    const { card, nameInput } = this.renderPlayerAndCountForm(
      'Session erstellen',
      () => factionCount,
      (n) => { factionCount = n; },
    );

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = 'Session erstellen';
    createBtn.className = primaryBtnClass;
    createBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Host';
      this.client = new RemoteGameClient(resolveWsUrl(), { name, factionCount });
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

  // --- shared form for "name + faction count" (offline & online-host) ---
  private renderPlayerAndCountForm(
    heading: string,
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
    const countLabelText = document.createElement('span');
    countLabelText.textContent = 'Anzahl Fraktionen:';
    countLabelText.className = 'text-sm text-slate-300';
    const countLabel = document.createElement('span');
    countLabel.className = 'w-8 text-center text-sm tabular-nums';

    const bumpCount = (delta: number): void => {
      setCount(Math.min(MAX_FACTIONS, Math.max(MIN_FACTIONS, getCount() + delta)));
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

    countRow.append(countLabelText, minusBtn, countLabel, plusBtn);
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

    wrap.append(status, errorBanner, slotList, hint, mapContainer, actionRow);
    this.root.appendChild(wrap);

    const showError = (message: string): void => {
      errorBanner.textContent = message;
      errorBanner.classList.remove('hidden');
    };

    const update = (lobby: LobbyState): void => {
      const connecting = !lobby.code;
      status.textContent = connecting
        ? 'Verbinde...'
        : `Session-Code: ${lobby.code} · ${lobby.slots.length}/${lobby.factionCount} Fraktionen vergeben`;

      slotList.replaceChildren();
      for (const slot of lobby.slots) {
        slotList.appendChild(this.renderSlotChip(slot.color, slot.name, slot.capitalId, [
          slot.isHost ? 'Host' : null,
          slot.playerId === client.playerId ? 'Du' : null,
        ].filter((s): s is string => s !== null)));
      }
      for (let i = lobby.slots.length; i < lobby.factionCount; i++) {
        slotList.appendChild(this.renderSlotChip('#475569', `KI ${i + 1 - lobby.slots.length}`, 'wird beim Start vergeben', []));
      }

      this.map?.applyLobby(lobby);

      const host = isHost(client);
      startBtn.classList.toggle('hidden', !host);
      const ready = lobby.slots.every((s) => s.capitalId !== null) && lobby.slots.length > 0;
      startBtn.disabled = !ready || connecting;
      if (!host && !connecting) {
        status.textContent += ' · Warte auf Host...';
      }
    };

    this.unsubscribers.push(client.onLobby(update));
    this.unsubscribers.push(client.onError(showError));
    this.unsubscribers.push(client.onGameStart((gameState) => this.onComplete(gameState)));

    update(client.getLobby());
  }

  private renderSlotChip(color: string, name: string, capitalLabel: string | null, tags: readonly string[]): HTMLDivElement {
    const chip = document.createElement('div');
    chip.className = 'flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100';
    const swatch = document.createElement('span');
    swatch.className = 'h-3 w-3 shrink-0 rounded-full';
    swatch.style.background = color;
    const text = document.createElement('span');
    const capital = capitalLabel ? this.territories.find((t) => t.id === capitalLabel)?.name ?? capitalLabel : 'wählt noch...';
    const tagText = tags.length ? ` (${tags.join(', ')})` : '';
    text.textContent = `${name}${tagText} — ${capital}`;
    chip.append(swatch, text);
    return chip;
  }
}
