import type { GameState, LobbyState, Territory, TerritoryData } from '../engine/types';
import { NEUTRAL_COLOR } from '../engine/palette';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Hover state is applied via inline style rather than Tailwind classes: an element's base
// fill and a hover-state class would carry equal CSS specificity, so whichever rule happens
// to land later in Tailwind's generated stylesheet wins - not necessarily the class added
// last in JS. Inline style always wins over a stylesheet class, and lets us restore the
// exact per-territory owner color on hover-out instead of falling back to a fixed default.
const HOVER_FILL = '#fbbf24'; // amber-400
const NEIGHBOR_FILL = '#b45309'; // amber-700

interface CapitalMarker {
  readonly capitalId: string;
  readonly color: string;
}

export class MapRenderer {
  private readonly svg: SVGSVGElement;
  private readonly markerLayer: SVGGElement;
  private readonly tooltip: HTMLDivElement;
  private readonly pathsById = new Map<string, SVGPathElement>();
  private readonly territoriesById = new Map<string, Territory>();
  private readonly baseFillById = new Map<string, string>();
  private hoveredId: string | null = null;
  private clickHandler: ((territoryId: string) => void) | null = null;

  constructor(container: HTMLElement, data: TerritoryData) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', data.viewBox);
    this.svg.classList.add('block', 'w-full', 'h-auto');

    this.tooltip = document.createElement('div');
    this.tooltip.className =
      'pointer-events-none fixed hidden -translate-x-1/2 -translate-y-[130%] rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-sm font-semibold text-slate-100 shadow-lg z-10';

    for (const territory of data.territories) {
      this.territoriesById.set(territory.id, territory);
      this.baseFillById.set(territory.id, NEUTRAL_COLOR);

      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', territory.path);
      el.setAttribute('data-id', territory.id);
      el.style.fill = NEUTRAL_COLOR;
      el.classList.add(
        'cursor-pointer',
        'stroke-slate-900',
        '[stroke-width:0.07]',
        '[vector-effect:non-scaling-stroke]',
        'transition-colors',
      );
      el.addEventListener('pointerenter', () => this.onEnter(territory));
      el.addEventListener('pointermove', (e) => this.onMove(e));
      el.addEventListener('pointerleave', () => this.onLeave());
      el.addEventListener('click', () => this.clickHandler?.(territory.id));
      this.svg.appendChild(el);
      this.pathsById.set(territory.id, el);
    }

    this.markerLayer = document.createElementNS(SVG_NS, 'g');
    this.markerLayer.classList.add('pointer-events-none');
    this.svg.appendChild(this.markerLayer);

    const wrap = document.createElement('div');
    wrap.className = 'rounded-xl border border-slate-700 bg-sky-950 overflow-hidden';
    wrap.appendChild(this.svg);

    container.appendChild(wrap);
    container.appendChild(this.tooltip);
  }

  /** Called with a territory id whenever the player clicks it (e.g. to claim a capital). */
  setClickHandler(handler: ((territoryId: string) => void) | null): void {
    this.clickHandler = handler;
  }

  /** Colors territories by owner and marks each player's capital. Pass null to reset to neutral. */
  applyGameState(gameState: GameState | null): void {
    this.paint(
      gameState
        ? new Map(
            [...gameState.territoryState.entries()].map(([id, state]) => [
              id,
              gameState.players.find((p) => p.id === state.ownerId)?.color,
            ]),
          )
        : new Map(),
    );
    this.drawMarkers(gameState ? gameState.players.map((p) => ({ capitalId: p.capitalId, color: p.color })) : []);
  }

  /** Colors territories by lobby claims (pre-game) and marks each claimed capital so far. */
  applyLobby(lobby: LobbyState | null): void {
    const colorByTerritory = new Map<string, string | undefined>();
    const markers: CapitalMarker[] = [];
    if (lobby) {
      for (const slot of lobby.slots) {
        if (slot.capitalId) {
          colorByTerritory.set(slot.capitalId, slot.color);
          markers.push({ capitalId: slot.capitalId, color: slot.color });
        }
      }
    }
    this.paint(colorByTerritory);
    this.drawMarkers(markers);
  }

  private paint(colorByTerritory: ReadonlyMap<string, string | undefined>): void {
    for (const [id, el] of this.pathsById) {
      const color = colorByTerritory.get(id) ?? NEUTRAL_COLOR;
      this.baseFillById.set(id, color);
      if (id !== this.hoveredId) el.style.fill = color;
    }
  }

  private drawMarkers(markers: readonly CapitalMarker[]): void {
    this.markerLayer.replaceChildren();
    for (const { capitalId, color } of markers) {
      const territory = this.territoriesById.get(capitalId);
      if (!territory) continue;
      const [cx, cy] = territory.centroid;
      const marker = document.createElementNS(SVG_NS, 'circle');
      marker.setAttribute('cx', String(cx));
      marker.setAttribute('cy', String(cy));
      marker.setAttribute('r', '0.25');
      marker.setAttribute('fill', color);
      marker.setAttribute('stroke', 'white');
      marker.setAttribute('stroke-width', '0.06');
      marker.setAttribute('vector-effect', 'non-scaling-stroke');
      this.markerLayer.appendChild(marker);
    }
  }

  private onEnter(territory: Territory): void {
    this.hoveredId = territory.id;
    this.pathsById.get(territory.id)?.style.setProperty('fill', HOVER_FILL);
    for (const neighborId of territory.neighbors) {
      this.pathsById.get(neighborId)?.style.setProperty('fill', NEIGHBOR_FILL);
    }
    this.tooltip.textContent = territory.name;
    this.tooltip.classList.remove('hidden');
  }

  private onMove(e: PointerEvent): void {
    this.tooltip.style.left = `${e.clientX}px`;
    this.tooltip.style.top = `${e.clientY}px`;
  }

  private onLeave(): void {
    this.hoveredId = null;
    for (const [id, el] of this.pathsById) {
      el.style.fill = this.baseFillById.get(id) ?? NEUTRAL_COLOR;
    }
    this.tooltip.classList.add('hidden');
  }
}
