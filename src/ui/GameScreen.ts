import type { GameState, TerritoryData, UnitComposition } from '../engine/types';
import { totalUnits } from '../engine/movement';
import { UNIT_COSTS, costOf } from '../engine/economy';
import { MapRenderer } from '../render/MapRenderer';
import type { GameClient } from '../net/GameClient';

const MAP_HINT =
  'Ziehe Einheiten auf ein angrenzendes Gebiet, um sie zu verschieben. Klicke ein eigenes Gebiet an, um dort Einheiten zu rekrutieren.';
const RESOURCE_HINT =
  'Zeigt, wie viele Rüstungspunkte jedes Gebiet pro Runde einbringt (heller/wärmer = mehr) - abgeleitet aus realen Wirtschaftsdaten.';

const primaryBtnClass =
  'rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500';
const secondaryBtnClass =
  'rounded-md border border-slate-600 bg-slate-800 px-4 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-700';

const UNIT_LABELS: Record<keyof UnitComposition, string> = {
  infantry: 'Infanterie',
  lightTank: 'Leichte Panzer',
  heavyTank: 'Schwere Panzer',
};

export class GameScreen {
  private readonly map: MapRenderer;
  private readonly legend: HTMLDivElement;
  private readonly errorBanner: HTMLDivElement;
  private readonly turnStatus: HTMLDivElement;
  private readonly endTurnBtn: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;
  private readonly mapTabBtn: HTMLButtonElement;
  private readonly resourceTabBtn: HTMLButtonElement;
  private readonly data: TerritoryData;
  private readonly client: GameClient;
  private readonly unsubscribers: (() => void)[] = [];
  private currentGameState: GameState;
  private activeTab: 'map' | 'resources' = 'map';

  constructor(container: HTMLElement, data: TerritoryData, client: GameClient, initialGameState: GameState) {
    this.data = data;
    this.client = client;
    this.currentGameState = initialGameState;

    const shell = document.createElement('div');
    shell.className = 'mx-auto max-w-6xl';

    this.errorBanner = document.createElement('div');
    this.errorBanner.className = 'mb-3 hidden rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-200';

    const turnRow = document.createElement('div');
    turnRow.className =
      'mb-3 flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2';
    this.turnStatus = document.createElement('div');
    this.turnStatus.className = 'text-sm text-slate-200';
    this.endTurnBtn = document.createElement('button');
    this.endTurnBtn.type = 'button';
    this.endTurnBtn.textContent = 'Zug beenden';
    this.endTurnBtn.className = primaryBtnClass;
    this.endTurnBtn.addEventListener('click', () => client.endTurn());
    turnRow.append(this.turnStatus, this.endTurnBtn);

    const tabRow = document.createElement('div');
    tabRow.className = 'mb-3 flex gap-2';
    this.mapTabBtn = document.createElement('button');
    this.mapTabBtn.type = 'button';
    this.mapTabBtn.textContent = 'Karte';
    this.mapTabBtn.addEventListener('click', () => this.setTab('map'));
    this.resourceTabBtn = document.createElement('button');
    this.resourceTabBtn.type = 'button';
    this.resourceTabBtn.textContent = 'Ressourcen';
    this.resourceTabBtn.addEventListener('click', () => this.setTab('resources'));
    tabRow.append(this.mapTabBtn, this.resourceTabBtn);

    this.hint = document.createElement('p');
    this.hint.className = 'mb-3 text-sm text-slate-400';

    const mapContainer = document.createElement('div');
    this.legend = document.createElement('div');
    this.legend.className = 'mt-4 flex flex-wrap gap-2';

    shell.append(this.errorBanner, turnRow, tabRow, this.hint, mapContainer, this.legend);
    container.appendChild(shell);

    this.map = new MapRenderer(mapContainer, data);
    this.map.setDragHandler({
      canDrag: (territoryId) => {
        if (this.activeTab !== 'map') return false;
        const state = this.currentGameState.territoryState.get(territoryId);
        if (!state) return false;
        if (state.ownerId !== client.playerId) return false;
        if (this.currentGameState.activePlayerId !== client.playerId) return false;
        return totalUnits(state.garrison) - totalUnits(state.movedIn) > 0;
      },
      onDrop: (fromId, toId) => this.openMoveMenu(fromId, toId),
    });
    this.map.setClickHandler((territoryId) => this.tryOpenRecruitMenu(territoryId));

    this.unsubscribers.push(client.onGameState((gameState) => this.render(gameState)));
    this.unsubscribers.push(
      client.onError((message) => {
        this.errorBanner.textContent = message;
        this.errorBanner.classList.remove('hidden');
      }),
    );

    this.currentGameState = initialGameState;
    this.setTab('map');
    this.render(initialGameState);
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
  }

  private setTab(tab: 'map' | 'resources'): void {
    this.activeTab = tab;
    this.mapTabBtn.className = tab === 'map' ? primaryBtnClass : secondaryBtnClass;
    this.resourceTabBtn.className = tab === 'resources' ? primaryBtnClass : secondaryBtnClass;
    this.hint.textContent = tab === 'map' ? MAP_HINT : RESOURCE_HINT;
    if (tab === 'map') {
      this.map.applyGameState(this.currentGameState);
    } else {
      this.map.applyResourceView(this.data.territories);
    }
  }

  private render(gameState: GameState): void {
    this.currentGameState = gameState;
    if (this.activeTab === 'map') this.map.applyGameState(gameState);

    const activePlayer = gameState.players.find((p) => p.id === gameState.activePlayerId);
    const isMyTurn = gameState.activePlayerId === this.client.playerId;
    const myPoints = gameState.resources.get(this.client.playerId) ?? 0;
    this.turnStatus.textContent = `Runde ${gameState.turn} — ${
      isMyTurn ? 'Du bist am Zug' : `${activePlayer?.name ?? '?'} ist am Zug`
    } — ${myPoints} Rüstungspunkte`;
    this.endTurnBtn.disabled = !isMyTurn;

    this.legend.replaceChildren();
    for (const player of gameState.players) {
      const capital = this.data.territories.find((t) => t.id === player.capitalId);
      const chip = document.createElement('div');
      chip.className =
        'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-slate-100' +
        (player.id === gameState.activePlayerId
          ? ' border-amber-400 bg-slate-800'
          : ' border-slate-700 bg-slate-800');
      const swatch = document.createElement('span');
      swatch.className = 'h-3 w-3 shrink-0 rounded-full';
      swatch.style.background = player.color;
      const text = document.createElement('span');
      const suffix = player.isAI ? ' (KI)' : '';
      text.textContent = `${player.name}${suffix} — ${capital?.name ?? player.capitalId}`;
      chip.append(swatch, text);
      this.legend.appendChild(chip);
    }
  }

  /** Backdrop + card shell shared by the move and recruit menus. */
  private openModal(title: string): { card: HTMLDivElement; close: () => void } {
    const backdrop = document.createElement('div');
    backdrop.className = 'fixed inset-0 z-20 flex items-center justify-center bg-slate-950/70 p-4';
    const close = (): void => backdrop.remove();
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const card = document.createElement('div');
    card.className = 'flex w-full max-w-sm flex-col gap-4 rounded-lg border border-slate-700 bg-slate-800 p-5';

    const titleEl = document.createElement('h3');
    titleEl.className = 'text-base font-semibold text-slate-100';
    titleEl.textContent = title;
    card.appendChild(titleEl);

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    return { card, close };
  }

  /** Opens a modal to choose how many of each unit type to send, defaulting to everything
   *  available so a plain drag-and-confirm still moves everything like before. */
  private openMoveMenu(fromId: string, toId: string): void {
    const fromState = this.currentGameState.territoryState.get(fromId);
    if (!fromState) return;
    const available: UnitComposition = {
      infantry: fromState.garrison.infantry - fromState.movedIn.infantry,
      lightTank: fromState.garrison.lightTank - fromState.movedIn.lightTank,
      heavyTank: fromState.garrison.heavyTank - fromState.movedIn.heavyTank,
    };
    const fromName = this.data.territories.find((t) => t.id === fromId)?.name ?? fromId;
    const toName = this.data.territories.find((t) => t.id === toId)?.name ?? toId;

    const amount: { infantry: number; lightTank: number; heavyTank: number } = { ...available };
    const { card, close } = this.openModal(`${fromName} → ${toName}`);

    const frozen = totalUnits(fromState.movedIn);
    if (frozen > 0) {
      const note = document.createElement('p');
      note.className = 'text-xs text-slate-500';
      note.textContent =
        frozen === 1
          ? '1 Einheit hat sich diese Runde bereits bewegt und ist nicht wählbar.'
          : `${frozen} Einheiten haben sich diese Runde bereits bewegt und sind nicht wählbar.`;
      card.appendChild(note);
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Verschieben';
    confirmBtn.className = primaryBtnClass;
    confirmBtn.addEventListener('click', () => {
      this.client.moveUnits(fromId, toId, amount);
      close();
    });

    const updateConfirmState = (): void => {
      confirmBtn.disabled = totalUnits(amount) === 0;
    };
    updateConfirmState();

    const unitTypes: (keyof UnitComposition)[] = ['infantry', 'lightTank', 'heavyTank'];
    for (const type of unitTypes) {
      const max = available[type];
      if (max <= 0) continue;
      card.appendChild(
        this.createStepperRow(UNIT_LABELS[type], max, amount[type], (value) => {
          amount[type] = value;
          updateConfirmState();
        }),
      );
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.className = secondaryBtnClass;
    cancelBtn.addEventListener('click', () => close());

    const actions = document.createElement('div');
    actions.className = 'flex justify-end gap-2 pt-2';
    actions.append(cancelBtn, confirmBtn);
    card.appendChild(actions);
  }

  private tryOpenRecruitMenu(territoryId: string): void {
    if (this.activeTab !== 'map') return;
    const state = this.currentGameState.territoryState.get(territoryId);
    if (!state || state.ownerId !== this.client.playerId) return;
    if (this.currentGameState.activePlayerId !== this.client.playerId) return;
    this.openRecruitMenu(territoryId);
  }

  /** Opens a modal to spend Rüstungspunkte on new units at an owned territory. New units count
   *  as having already moved this round, same as a captured or relocated stack. */
  private openRecruitMenu(territoryId: string): void {
    const points = this.currentGameState.resources.get(this.client.playerId) ?? 0;
    const territoryName = this.data.territories.find((t) => t.id === territoryId)?.name ?? territoryId;

    const amount = { infantry: 0, lightTank: 0, heavyTank: 0 };
    const { card, close } = this.openModal(territoryName);

    const pointsText = document.createElement('p');
    pointsText.className = 'text-sm text-slate-300';
    card.appendChild(pointsText);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Rekrutieren';
    confirmBtn.className = primaryBtnClass;
    confirmBtn.addEventListener('click', () => {
      this.client.recruit(territoryId, amount);
      close();
    });

    const updateState = (): void => {
      const cost = costOf(amount);
      pointsText.textContent = `Kosten: ${cost} / ${points} Rüstungspunkte verfügbar`;
      confirmBtn.disabled = totalUnits(amount) === 0 || cost > points;
    };
    updateState();

    const unitTypes: (keyof UnitComposition)[] = ['infantry', 'lightTank', 'heavyTank'];
    for (const type of unitTypes) {
      const max = Math.floor(points / UNIT_COSTS[type]);
      if (max <= 0) continue;
      card.appendChild(
        this.createStepperRow(`${UNIT_LABELS[type]} (${UNIT_COSTS[type]} Pkt.)`, max, amount[type], (value) => {
          amount[type] = value;
          updateState();
        }),
      );
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.className = secondaryBtnClass;
    cancelBtn.addEventListener('click', () => close());

    const actions = document.createElement('div');
    actions.className = 'flex justify-end gap-2 pt-2';
    actions.append(cancelBtn, confirmBtn);
    card.appendChild(actions);
  }

  private createStepperRow(
    label: string,
    max: number,
    initial: number,
    onChange: (value: number) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.className = 'text-sm text-slate-300';

    let value = initial;
    const valueEl = document.createElement('span');
    valueEl.className = 'w-8 text-center text-sm tabular-nums';
    valueEl.textContent = String(value);

    const set = (n: number): void => {
      value = Math.min(max, Math.max(0, n));
      valueEl.textContent = String(value);
      onChange(value);
    };

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.textContent = '-';
    minusBtn.className =
      'h-7 w-7 rounded-md border border-slate-600 bg-slate-900 text-base leading-none hover:bg-slate-700';
    minusBtn.addEventListener('click', () => set(value - 1));

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    plusBtn.className =
      'h-7 w-7 rounded-md border border-slate-600 bg-slate-900 text-base leading-none hover:bg-slate-700';
    plusBtn.addEventListener('click', () => set(value + 1));

    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-2';
    controls.append(minusBtn, valueEl, plusBtn);

    row.append(labelEl, controls);
    return row;
  }
}
