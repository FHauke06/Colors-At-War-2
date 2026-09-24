import type { AiDifficulty, GameState, LobbyState, Territory, TerritoryData } from '../engine/types';
import { MIN_FACTIONS, MAX_FACTIONS } from '../engine/palette';
import { canStart } from '../engine/session';
import { finalizeScenarioLobby } from '../engine/setup';
import { MapRenderer } from '../render/MapRenderer';
import type { GameClient } from '../net/GameClient';
import { isHost } from '../net/GameClient';
import { LocalGameClient } from '../net/LocalGameClient';
import { RemoteGameClient, resolveWsUrl } from '../net/RemoteGameClient';
import { MAIN_MAPS, DEFAULT_MAIN_MAP_ID, mainMapById } from '../data/MainMaps';
import { SCENARIOS, scenarioById } from '../data/Scenarios';
import type { Scenario } from '../data/Scenarios';
import { buildLogo } from './logo';
import { uiIcon } from './uiIcons';
import type { UiIconName } from './uiIcons';
import { cardClass, inputClass, primaryBtnClass, secondaryBtnClass } from './styles';

const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  easy: 'Einfach',
  medium: 'Mittel',
  hard: 'Schwer',
};

export class SetupScreen {
  private readonly root: HTMLElement;
  private readonly onComplete: (client: GameClient, gameState: GameState, data: TerritoryData) => void;

  /** Which of data/MainMaps' MAIN_MAPS is currently selected - chosen via renderMapSelector for an
   *  offline game or an online host, or adopted from the lobby's mapId for a joining online client
   *  (see enterLobby's ensureMapCurrent). data/territories are kept in lockstep via setMap. */
  private selectedMapId: string = DEFAULT_MAIN_MAP_ID;
  private data: TerritoryData = mainMapById(this.selectedMapId);
  private territories: readonly Territory[] = this.data.territories;

  /** Nur für einen Online-Host: das gewählte Szenario (data/Scenarios) oder null = freie Karte mit Hauptstadt-Wahl. */
  private selectedScenarioId: string | null = null;

  private client: GameClient | null = null;
  private map: MapRenderer | null = null;
  private unsubscribers: (() => void)[] = [];

  constructor(container: HTMLElement, onComplete: (client: GameClient, gameState: GameState, data: TerritoryData) => void) {
    this.onComplete = onComplete;
    this.root = document.createElement('div');
    this.root.className = 'mx-auto max-w-2xl';
    container.appendChild(this.root);
    this.renderModeSelect();
  }

  private setMap(mapId: string): void {
    this.selectedMapId = mapId;
    this.data = mainMapById(mapId);
    this.territories = this.data.territories;
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
    document.documentElement.classList.remove('title-screen');
    this.root.className = 'mx-auto max-w-2xl';
    this.root.replaceChildren();
  }

  // --- step 1: title screen - offline vs online vs scenario ---
  private renderModeSelect(): void {
    this.clear();
    // Das große Logo ersetzt hier das der Kopfzeile (siehe style.css, `title-screen`); jeder andere Schritt räumt die Klasse in clear() wieder ab.
    document.documentElement.classList.add('title-screen');
    // Vertikal mittig im Fenster (abzüglich Kopfzeile und Rand).
    this.root.className = 'mx-auto flex min-h-[calc(100dvh-9rem)] max-w-3xl flex-col justify-center';

    const hero = document.createElement('div');
    hero.className = 'mb-8 mt-2 flex flex-col items-center gap-3 text-center';
    const logo = buildLogo('lg');
    const tagline = document.createElement('p');
    tagline.className = 'font-mono text-xs font-medium uppercase tracking-[0.2em] text-slate-500';
    tagline.textContent = `Rundenstrategie · ${MAIN_MAPS.map((m) => m.name).join(' · ')}`;
    hero.append(logo, tagline);

    const modes: readonly { readonly icon: UiIconName; readonly title: string; readonly text: string; readonly go: () => void }[] = [
      {
        icon: 'computer',
        title: 'Gegen den Computer',
        text: `Allein gegen KI-Fraktionen - auf freier Karte mit eigener Hauptstadt oder in einem der ${SCENARIOS.length} historischen Szenarien (${SCENARIOS.map((sc) => sc.name.split(' – ')[0]).join(', ')}).`,
        go: () => this.renderOfflineConfig(),
      },
      {
        icon: 'network',
        title: 'Mit Freunden',
        text: 'Session erstellen oder per Code beitreten - ebenfalls auf freier Karte oder mit einem Szenario. Der Host kann freie Plätze mit KI füllen.',
        go: () => this.renderOnlineChoice(),
      },
    ];

    const grid = document.createElement('div');
    grid.className = 'grid gap-4 sm:grid-cols-2';
    modes.forEach((mode, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `${cardClass} group flex flex-col items-start gap-3 text-left transition-colors hover:bg-slate-900`;
      const top = document.createElement('div');
      top.className = 'flex w-full items-start justify-between';
      const badge = document.createElement('div');
      badge.className = 'flex h-12 w-12 items-center justify-center rounded-md border border-slate-100 bg-amber-500 text-slate-900';
      badge.appendChild(uiIcon(mode.icon, 26));
      const index = document.createElement('span');
      index.className = 'font-mono text-sm font-medium text-slate-500';
      index.textContent = `0${i + 1}`;
      top.append(badge, index);
      const title = document.createElement('div');
      title.className = 'label-caps text-2xl leading-none';
      title.textContent = mode.title;
      const text = document.createElement('p');
      text.className = 'text-sm text-slate-400';
      text.textContent = mode.text;
      const go = document.createElement('div');
      go.className = 'label-caps mt-auto flex items-center gap-2 pt-1 text-sm text-signal';
      go.append(document.createTextNode('Auswählen'), uiIcon('endTurn', 12));
      card.append(top, title, text, go);
      card.addEventListener('click', mode.go);
      grid.appendChild(card);
    });

    this.root.append(hero, grid);
  }

  // --- step 2a: offline config ---
  private renderOfflineConfig(): void {
    this.clear();
    let factionCount = 4;
    let aiDifficulty: AiDifficulty = 'medium';
    const { card, nameInput, countRow } = this.renderPlayerAndCountForm(
      'Gegen den Computer spielen',
      'Anzahl Fraktionen:',
      MIN_FACTIONS,
      () => factionCount,
      (n) => { factionCount = n; },
    );
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = primaryBtnClass;
    startBtn.textContent = 'Weiter zur Hauptstadt-Wahl';

    // Wie beim Online-Host: ein Szenario bringt seine Karte und seine festen Fraktionen mit - die Anzahl der Fraktionen entfällt,
    // und statt einer Hauptstadt wählt man in der Lobby eine Fraktion.
    this.selectedScenarioId = null;
    const mapSelector = this.renderMapSelector();
    card.appendChild(this.renderScenarioSelector(mapSelector, (scenario) => {
      countRow.classList.toggle('hidden', !!scenario);
      startBtn.textContent = scenario ? 'Weiter zur Fraktions-Wahl' : 'Weiter zur Hauptstadt-Wahl';
    }));
    card.appendChild(mapSelector);
    card.appendChild(this.renderDifficultySelector(() => aiDifficulty, (d) => { aiDifficulty = d; }));

    startBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Spieler 1';
      this.client = LocalGameClient.newLobby(this.selectedMapId, name, factionCount - 1, aiDifficulty, this.selectedScenarioId ?? undefined);
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
    title.className = 'label-caps text-2xl leading-none';

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
    let aiDifficulty: AiDifficulty = 'medium';
    const { card, nameInput } = this.renderPlayerAndCountForm(
      'Session erstellen',
      'Wie viele Spieler dürfen beitreten:',
      1,
      () => maxHumans,
      (n) => { maxHumans = n; },
    );
    this.selectedScenarioId = null;
    const mapSelector = this.renderMapSelector();
    card.appendChild(this.renderScenarioSelector(mapSelector));
    card.appendChild(mapSelector);
    card.appendChild(this.renderDifficultySelector(() => aiDifficulty, (d) => { aiDifficulty = d; }));
    const hint = document.createElement('p');
    hint.className = 'text-sm text-slate-400';
    hint.textContent = 'Computer-Gegner kannst du danach direkt in der Lobby hinzufügen (bei einem Szenario stellen die nicht gewählten Fraktionen die KI).';
    card.appendChild(hint);

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.textContent = 'Session erstellen';
    createBtn.className = primaryBtnClass;
    createBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Host';
      const scenario = this.selectedScenarioId ? scenarioById(this.selectedScenarioId) : undefined;
      this.client = new RemoteGameClient(resolveWsUrl(), {
        name,
        maxHumans: scenario ? Math.min(maxHumans, scenario.factions.length) : maxHumans,
        mapId: this.selectedMapId,
        aiDifficulty,
        scenarioId: scenario?.id,
      });
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
    title.className = 'label-caps text-2xl leading-none';

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
  ): { card: HTMLDivElement; nameInput: HTMLInputElement; countRow: HTMLDivElement; countLabel: HTMLSpanElement; bumpCount: (d: number) => void } {
    const card = document.createElement('div');
    card.className = `${cardClass} flex flex-col gap-4`;

    const title = document.createElement('h2');
    title.textContent = heading;
    title.className = 'label-caps text-2xl leading-none';

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
    minusBtn.className = 'h-8 w-8 rounded-md border border-slate-500 bg-slate-800 text-lg leading-none hover:border-slate-100 hover:bg-slate-700';
    minusBtn.addEventListener('click', () => bumpCount(-1));

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    plusBtn.className = 'h-8 w-8 rounded-md border border-slate-500 bg-slate-800 text-lg leading-none hover:border-slate-100 hover:bg-slate-700';
    plusBtn.addEventListener('click', () => bumpCount(1));

    countRow.append(countLabelEl, minusBtn, countLabel, plusBtn);
    card.append(title, nameInput, countRow);
    return { card, nameInput, countRow, countLabel, bumpCount };
  }

  /** "Hauptkarte" dropdown for data/MainMaps' MAIN_MAPS - shown once, alongside the offline
   *  faction count or the online host's max-player count, same spot as the KI-Schwierigkeit
   *  selector below. Only the lobby creator picks a map; a joining online client just adopts
   *  whatever the host chose via lobby.mapId (see enterLobby's ensureMapCurrent). */
  private renderMapSelector(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-1.5';

    const label = document.createElement('span');
    label.textContent = 'Hauptkarte:';
    label.className = 'text-sm text-slate-300';

    const select = document.createElement('select');
    select.className = inputClass;
    for (const map of MAIN_MAPS) {
      const option = document.createElement('option');
      option.value = map.id;
      option.textContent = map.name;
      select.appendChild(option);
    }
    select.value = this.selectedMapId;
    select.addEventListener('change', () => this.setMap(select.value));

    wrap.append(label, select);
    return wrap;
  }

  /** "Szenario" dropdown, analog zur Kartenauswahl - im Offline-Spiel wie beim Online-Host (Joiner laden das Szenario anhand
   *  von lobby.scenarioId lokal aus data/Scenarios). Ein Szenario bringt seine eigene Karte mit - die Kartenauswahl
   *  (`mapSelector`) wird dann auf diese gesetzt und gesperrt. `onChange` bekommt das gewählte Szenario (oder undefined für
   *  "kein Szenario"), damit das jeweilige Formular seine übrigen Felder anpassen kann. */
  private renderScenarioSelector(mapSelector: HTMLDivElement, onChange?: (scenario: Scenario | undefined) => void): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-1.5';
    const label = document.createElement('span');
    label.textContent = 'Szenario:';
    label.className = 'text-sm text-slate-300';
    const select = document.createElement('select');
    select.className = inputClass;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Kein Szenario (freie Karte, eigene Hauptstadt wählen)';
    select.appendChild(none);
    for (const scenario of SCENARIOS) {
      const mapName = MAIN_MAPS.find((m) => m.id === scenario.mapId)?.name ?? scenario.mapId;
      const option = document.createElement('option');
      option.value = scenario.id;
      option.textContent = `${scenario.name} (${mapName})`;
      select.appendChild(option);
    }
    const desc = document.createElement('p');
    desc.className = 'hidden text-xs text-slate-400';
    const mapSelect = mapSelector.querySelector('select');
    select.addEventListener('change', () => {
      const scenario = select.value ? scenarioById(select.value) : undefined;
      this.selectedScenarioId = scenario?.id ?? null;
      if (scenario) this.setMap(scenario.mapId);
      if (mapSelect) {
        mapSelect.value = this.selectedMapId;
        mapSelect.disabled = !!scenario;
      }
      desc.textContent = scenario?.description ?? '';
      desc.classList.toggle('hidden', !scenario);
      onChange?.(scenario);
    });
    wrap.append(label, select, desc);
    return wrap;
  }

  /** "Einfach"/"Mittel"/"Schwer" toggle row for engine/types.ts's AiDifficulty - "am Spielbeginn
   *  einstellen, wie gut die KI ist". One choice for the whole lobby (see LobbyState.aiDifficulty),
   *  not per AI seat, so this appears once, alongside the offline faction count or the online
   *  host's max-player count, rather than per "+ KI hinzufügen" click. */
  private renderDifficultySelector(getDifficulty: () => AiDifficulty, setDifficulty: (d: AiDifficulty) => void): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-1.5';

    const label = document.createElement('span');
    label.textContent = 'KI-Schwierigkeit:';
    label.className = 'text-sm text-slate-300';

    const row = document.createElement('div');
    row.className = 'flex gap-2';

    const buttons = new Map<AiDifficulty, HTMLButtonElement>();
    const refresh = (): void => {
      for (const [level, btn] of buttons) {
        btn.className = level === getDifficulty() ? primaryBtnClass : secondaryBtnClass;
      }
    };
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = DIFFICULTY_LABELS[level];
      btn.addEventListener('click', () => {
        setDifficulty(level);
        refresh();
      });
      buttons.set(level, btn);
      row.appendChild(btn);
    }
    refresh();

    wrap.append(label, row);
    return wrap;
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

    const difficultyLabel = document.createElement('p');
    difficultyLabel.className = 'hidden text-sm text-slate-400';

    const hint = document.createElement('p');
    hint.className = 'text-sm text-slate-400';
    hint.textContent = 'Klicke auf der Karte ein Gebiet, um es als deine Hauptstadt festzulegen.';

    const factionList = document.createElement('div');
    factionList.className = 'hidden flex-wrap gap-2';

    const mapContainer = document.createElement('div');
    // Built lazily by ensureMapCurrent below, once this session's real map is known - immediately
    // for an offline game or an online host (this.selectedMapId is already right by the time
    // enterLobby runs), only once the first real lobby message arrives for a joining online client
    // (whose placeholder lobby.mapId is '' until then - see RemoteGameClient's constructor).

    const actionRow = document.createElement('div');
    actionRow.className = 'flex items-center gap-3';
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = 'Spiel starten';
    startBtn.className = primaryBtnClass;
    startBtn.addEventListener('click', () => client.start());
    actionRow.appendChild(startBtn);

    wrap.append(status, errorBanner, slotList, addAiBtn, difficultyLabel, hint, factionList, mapContainer, actionRow);
    this.root.appendChild(wrap);

    const showError = (message: string): void => {
      errorBanner.textContent = message;
      errorBanner.classList.remove('hidden');
    };

    const ensureMapCurrent = (lobby: LobbyState, connecting: boolean): void => {
      if (this.map || connecting) return;
      if (lobby.mapId) this.setMap(lobby.mapId);
      this.map = new MapRenderer(mapContainer, this.data);
      this.map.setClickHandler((territoryId) => client.claimCapital(territoryId));
    };

    const update = (lobby: LobbyState): void => {
      const host = isHost(client);
      const connecting = client.isOnline && !lobby.code;
      ensureMapCurrent(lobby, connecting);

      status.classList.toggle('hidden', !client.isOnline);
      if (client.isOnline) {
        status.textContent = connecting
          ? 'Verbinde...'
          : `Session-Code: ${lobby.code} · ${lobby.slots.length}/${lobby.maxHumans} Spieler beigetreten` +
            (host ? '' : ' · Warte auf Host...');
      }

      // Szenario-Lobby: statt der Hauptstadt-Wahl wählt man eine Fraktion; nicht gewählte Fraktionen werden KI-Sitze
      // (finalizeScenarioLobby) - schon hier als Vorschau in Slots und auf der Karte. Joiner laden das Szenario lokal.
      const scenario = lobby.scenarioId ? scenarioById(lobby.scenarioId) : undefined;
      let shown = lobby;
      if (scenario) {
        try {
          shown = finalizeScenarioLobby(lobby);
        } catch {
          shown = lobby;
        }
      }
      hint.textContent = scenario
        ? `Szenario "${scenario.name}": Wähle unten (oder per Klick auf ihre Hauptstadt) deine Fraktion - nicht gewählte Fraktionen spielt die KI.`
        : 'Klicke auf der Karte ein Gebiet, um es als deine Hauptstadt festzulegen.';
      factionList.classList.toggle('hidden', !scenario);
      factionList.classList.toggle('flex', !!scenario);
      factionList.replaceChildren();
      for (const faction of scenario?.factions ?? []) {
        const taker = lobby.slots.find((s) => s.capitalId === faction.capitalId);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flex items-center gap-2 ${taker?.playerId === client.playerId ? primaryBtnClass : secondaryBtnClass}`;
        const dot = document.createElement('span');
        dot.className = 'h-3 w-3 shrink-0 rounded-full';
        dot.style.background = faction.color;
        btn.append(dot, document.createTextNode(taker ? `${faction.name} — ${taker.name}` : faction.name));
        btn.title = `${faction.territories.length} ${faction.territories.length === 1 ? 'Gebiet' : 'Gebiete'} · ${faction.resources} Rüstungspunkte`;
        btn.disabled = !!taker && taker.playerId !== client.playerId;
        btn.addEventListener('click', () => client.claimCapital(faction.capitalId));
        factionList.appendChild(btn);
      }

      slotList.replaceChildren();
      for (const slot of shown.slots) {
        slotList.appendChild(this.renderSlotChip(slot.color, slot.name, slot.capitalId, [
          slot.isHost ? 'Host' : null,
          slot.playerId === client.playerId ? 'Du' : null,
        ].filter((s): s is string => s !== null)));
      }
      // In einer Szenario-Lobby stehen die KI-Fraktionen schon in der Fraktionsliste darunter (mit Farbe, Namen und Vorschau auf der
      // Karte) - als Chips oben wären sie nur eine zweite, sehr lange Liste derselben Angaben.
      if (!scenario) {
        for (const ai of shown.aiSlots) {
          const onRemove = client.isOnline && host ? () => client.removeAi(ai.id) : undefined;
          slotList.appendChild(this.renderSlotChip(ai.color, ai.name, ai.capitalId, [], onRemove));
        }
      }

      difficultyLabel.classList.toggle('hidden', shown.aiSlots.length === 0);
      difficultyLabel.textContent = `KI-Schwierigkeit: ${DIFFICULTY_LABELS[lobby.aiDifficulty]}`;

      const canAddMore = lobby.slots.length + lobby.aiSlots.length < MAX_FACTIONS;
      addAiBtn.classList.toggle('hidden', !(client.isOnline && host) || !!scenario);
      addAiBtn.disabled = !canAddMore || connecting;

      this.map?.applyLobby(shown);

      startBtn.classList.toggle('hidden', !host);
      startBtn.disabled = !canStart(lobby) || connecting;
    };

    this.unsubscribers.push(client.onLobby(update));
    this.unsubscribers.push(client.onError(showError));
    this.unsubscribers.push(client.onGameStart((gameState) => this.onComplete(client, gameState, this.data)));

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
