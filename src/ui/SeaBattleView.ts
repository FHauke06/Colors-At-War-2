import type { PendingSeaBattle, Player } from '../engine/types';
import { autoPlaceFleet, halfCells } from '../engine/naval';
import { SHIP_ICON_PATH } from '../render/shipIcons';

/**
 * Die Ansicht einer Seeschlacht ("Schiffe versenken", siehe engine/naval.ts): ein 10x10-Raster, oben die Hälfte des
 * Angreifers, unten die des Verteidigers. Zuerst platziert jede Seite VERDECKT ihre Flotte (jedes Schiff = 1 Kasten) in
 * der eigenen Hälfte, danach wird abwechselnd auf die gegnerische Hälfte geschossen. Treffer (versenktes Schiff) und
 * Fehlschüsse (Wasser) sehen beide Seiten; die verbleibende Schiffsanzahl steht im Kopf. Zuschauer sehen dasselbe ohne
 * Klick-Funktionen.
 */

export interface SeaBattleViewOptions {
  readonly pending: PendingSeaBattle;
  readonly zoneName: string;
  readonly players: readonly Player[];
  /** Die eigene Spieler-Id (null/fremd = Zuschauer). */
  readonly viewerId: string;
  readonly onDeploy: (cells: readonly number[]) => void;
  readonly onShoot: (cell: number) => void;
  readonly onCancel: () => void;
  readonly onProposeSimulation: () => void;
  readonly onDeclineSimulation: () => void;
  readonly primaryBtnClass: string;
  readonly secondaryBtnClass: string;
}

/** Ausgewählte (noch nicht bestätigte) Aufstellung - überlebt Re-Renders derselben Schlacht. */
let draftKey = '';
let draft = new Set<number>();

export function renderSeaBattleView(container: HTMLElement, opts: SeaBattleViewOptions): void {
  const { pending, viewerId } = opts;
  const key = `${pending.zoneId}|${pending.attackerId}|${pending.defenderId}`;
  if (key !== draftKey) {
    draftKey = key;
    draft = new Set();
  }

  const side: 'attacker' | 'defender' | null =
    pending.attackerId === viewerId ? 'attacker' : pending.defenderId === viewerId ? 'defender' : null;
  const name = (id: string): string => opts.players.find((p) => p.id === id)?.name ?? '?';
  const n = pending.gridSize;
  const myDeployed = side === 'attacker' ? pending.attackerDeployed : side === 'defender' ? pending.defenderDeployed : true;
  const deploying = side !== null && !myDeployed;
  const shooting = pending.activeSide !== null;
  const myTurn = side !== null && pending.activeSide === side;
  const myShips = side === 'attacker' ? pending.attackerShips : pending.defenderShips;

  container.replaceChildren();

  const header = document.createElement('div');
  header.className = 'mb-3 text-center';
  const title = document.createElement('h2');
  title.className = 'text-lg font-semibold text-slate-100';
  title.textContent = `Seeschlacht: ${opts.zoneName}`;
  const sub = document.createElement('p');
  sub.className = 'text-sm text-slate-400';
  sub.textContent = `${name(pending.attackerId)} (Angreifer) gegen ${name(pending.defenderId)} (Verteidiger)`;
  const fleets = document.createElement('p');
  fleets.className = 'text-sm font-semibold text-slate-200';
  fleets.textContent = `Schiffe: ${name(pending.attackerId)} ${pending.attackerRemaining}/${pending.attackerShips} — ${name(pending.defenderId)} ${pending.defenderRemaining}/${pending.defenderShips}`;
  header.append(title, sub, fleets);
  container.appendChild(header);

  const status = document.createElement('p');
  status.className = 'mb-3 text-center text-sm text-amber-300';
  if (deploying) {
    status.textContent = `Platziere verdeckt deine ${myShips} Schiffe in deiner Rasterhälfte (${draft.size}/${myShips}) - jedes Schiff ist genau 1 Kasten.`;
  } else if (!shooting) {
    status.textContent = 'Warte auf die Aufstellung des Gegners...';
  } else if (side === null) {
    status.textContent = `${name(pending.activeSide === 'attacker' ? pending.attackerId : pending.defenderId)} schießt...`;
  } else {
    status.textContent = myTurn ? 'Du bist am Zug: wähle ein Feld der gegnerischen Hälfte.' : 'Der Gegner schießt...';
  }
  container.appendChild(status);

  // Raster
  const attackerShots = new Map(pending.attackerShots.map((s) => [s.cell, s.hit]));
  const defenderShots = new Map(pending.defenderShots.map((s) => [s.cell, s.hit]));
  const myFleet = new Set(side === 'attacker' ? pending.attackerFleet : side === 'defender' ? pending.defenderFleet : []);
  const mySide = side;

  const grid = document.createElement('div');
  grid.className = 'mx-auto grid w-full max-w-md gap-0.5 rounded-md border border-slate-700 bg-slate-900 p-1';
  grid.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;

  for (let cell = 0; cell < n * n; cell++) {
    const cellSide: 'attacker' | 'defender' = cell < (n * n) / 2 ? 'attacker' : 'defender';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flex aspect-square items-center justify-center rounded-sm text-sm font-bold leading-none';
    // Schüsse auf diese Hälfte stammen vom jeweils anderen Spieler.
    const shotResult = cellSide === 'attacker' ? defenderShots.get(cell) : attackerShots.get(cell);
    const isMine = mySide === cellSide;
    const bg = cellSide === 'attacker' ? 'bg-sky-950' : 'bg-indigo-950';
    let content = '';
    let color = 'text-slate-500';
    let interactive = false;

    if (shotResult === true) {
      content = '✖';
      color = 'text-red-400';
    } else if (shotResult === false) {
      content = '•';
      color = 'text-sky-300';
    } else if ((isMine && myFleet.has(cell)) || (isMine && deploying && draft.has(cell))) {
      content = 'ship';
    }
    if (deploying && isMine) interactive = true;
    if (shooting && myTurn && !isMine && shotResult === undefined) interactive = true;

    btn.className += ` ${bg} ${color} ${interactive ? 'cursor-pointer hover:bg-slate-700' : 'cursor-default'}`;
    if (isMine) btn.className += ' ring-1 ring-emerald-800';
    if (content === 'ship') {
      btn.innerHTML = `<svg viewBox="0 0 16 16" fill="white" class="h-4/5 w-4/5" aria-hidden="true">${SHIP_ICON_PATH}</svg>`;
    } else {
      btn.textContent = content;
    }
    btn.disabled = !interactive;

    if (deploying && isMine) {
      btn.addEventListener('click', () => {
        if (draft.has(cell)) draft.delete(cell);
        else if (draft.size < myShips) draft.add(cell);
        renderSeaBattleView(container, opts);
      });
    } else if (interactive) {
      btn.addEventListener('click', () => opts.onShoot(cell));
    }
    grid.appendChild(btn);

    // Trennlinie zwischen den Hälften
    if (cell === (n * n) / 2 - 1) {
      const sep = document.createElement('div');
      sep.className = 'col-span-full my-0.5 h-0.5 bg-slate-600';
      grid.appendChild(sep);
    }
  }
  container.appendChild(grid);

  const legend = document.createElement('p');
  legend.className = 'mt-2 text-center text-xs text-slate-500';
  legend.textContent = 'Obere Hälfte: Angreifer - untere Hälfte: Verteidiger.  weißes Schiff = eigenes Schiff · ✖ Treffer (versenkt) · • Fehlschuss (Wasser)';
  container.appendChild(legend);

  const actions = document.createElement('div');
  actions.className = 'mt-3 flex justify-center gap-2';
  if (deploying) {
    const random = document.createElement('button');
    random.type = 'button';
    random.textContent = 'Zufällig aufstellen';
    random.className = opts.secondaryBtnClass;
    random.addEventListener('click', () => {
      draft = new Set(autoPlaceFleet(myShips, side!));
      renderSeaBattleView(container, opts);
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Zurücksetzen';
    clear.className = opts.secondaryBtnClass;
    clear.addEventListener('click', () => {
      draft = new Set();
      renderSeaBattleView(container, opts);
    });
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = 'Aufstellung bestätigen';
    confirm.className = opts.primaryBtnClass;
    confirm.disabled = draft.size !== myShips;
    const allowed = new Set(halfCells(side!));
    confirm.addEventListener('click', () => {
      const cells = [...draft].filter((c) => allowed.has(c));
      draft = new Set();
      opts.onDeploy(cells);
    });
    actions.append(random, clear, confirm);
    if (side === 'attacker') {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Angriff abbrechen';
      cancel.className = opts.secondaryBtnClass;
      cancel.addEventListener('click', () => opts.onCancel());
      actions.appendChild(cancel);
    }
  }
  // Simulieren: beide Seiten müssen zustimmen (KIs immer); ein Mensch kann das Angebot des Gegners ablehnen.
  if (side !== null) {
    const mineOffered = side === 'attacker' ? !!pending.attackerSimOffer : !!pending.defenderSimOffer;
    const theirsOffered = side === 'attacker' ? !!pending.defenderSimOffer : !!pending.attackerSimOffer;
    const sim = document.createElement('button');
    sim.type = 'button';
    sim.textContent = mineOffered ? 'Simulation angeboten...' : theirsOffered ? 'Simulation annehmen' : 'Simulieren anbieten';
    sim.className = theirsOffered && !mineOffered ? opts.primaryBtnClass : opts.secondaryBtnClass;
    sim.title = 'Beide Seiten müssen zustimmen - die Schlacht wird dann automatisch nach den Seeschlacht-Regeln ausgetragen (zufällige Aufstellung, wo noch nicht aufgestellt).';
    sim.disabled = mineOffered;
    sim.addEventListener('click', () => opts.onProposeSimulation());
    actions.appendChild(sim);
    if (theirsOffered && !mineOffered) {
      const decline = document.createElement('button');
      decline.type = 'button';
      decline.textContent = 'Ablehnen';
      decline.className = opts.secondaryBtnClass;
      decline.addEventListener('click', () => opts.onDeclineSimulation());
      actions.appendChild(decline);
    }
  }
  if (actions.childElementCount > 0) container.appendChild(actions);
}
