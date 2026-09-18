import type { GameState, LobbyState, Territory, TerritoryData } from '../engine/types';
import { NEUTRAL_COLOR } from '../engine/palette';
import { totalUnits } from '../engine/movement';
import { resourceValue } from '../engine/economy';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Blue (low) -> amber/red (high), scaled to whatever range of values is actually on screen. */
function resourceHeatColor(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0.5;
  const hue = 215 - t * 205;
  return `hsl(${hue}, 55%, 32%)`;
}

// Hover/drag/drop-target cues are drawn as a stroke, never a fill: fill carries real information
// (who owns this territory), and overwriting it - even temporarily, even just for the exact
// territory the pointer happens to land on right after a drop - would hide that while it lasts.
// (Style is applied via inline style rather than Tailwind classes for the same underlying
// reason a class wouldn't work here: an element's base fill and a class-based stroke would
// carry equal CSS specificity, so whichever rule lands later in Tailwind's generated stylesheet
// wins - not necessarily the one added last in JS. Inline style always wins over a class.)
const RELATED_STROKE = '#fbbf24'; // amber-400
const RELATED_STROKE_WIDTH = '0.15';
const HOVERED_STROKE_WIDTH = '0.22';

interface CapitalMarker {
  readonly capitalId: string;
  readonly color: string;
}

export interface DragHandler {
  /** Whether this territory may be picked up as a drag source right now. */
  canDrag(territoryId: string): boolean;
  onDrop(fromId: string, toId: string): void;
}

export class MapRenderer {
  private readonly svg: SVGSVGElement;
  private readonly markerLayer: SVGGElement;
  private readonly tooltip: HTMLDivElement;
  private readonly pathsById = new Map<string, SVGPathElement>();
  private readonly territoriesById = new Map<string, Territory>();
  private hoveredId: string | null = null;
  private clickHandler: ((territoryId: string) => void) | null = null;
  private dragHandler: DragHandler | null = null;
  private dragSourceId: string | null = null;
  private dragEligible = false;
  private dragLine: SVGLineElement | null = null;
  private currentGameState: GameState | null = null;

  constructor(container: HTMLElement, data: TerritoryData) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', data.viewBox);
    this.svg.classList.add('block', 'w-full', 'h-auto', 'touch-none');

    this.tooltip = document.createElement('div');
    this.tooltip.className =
      'pointer-events-none fixed hidden -translate-x-1/2 -translate-y-[130%] rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-sm font-semibold text-slate-100 shadow-lg z-10';

    for (const territory of data.territories) {
      this.territoriesById.set(territory.id, territory);

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
      el.addEventListener('pointerdown', (e) => this.onDragStart(e, territory));
      el.addEventListener('pointermove', (e) => this.onDragMove(e));
      el.addEventListener('pointerup', (e) => this.onDragEnd(e));
      el.addEventListener('pointercancel', () => this.cancelDrag());
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

  /** Called with a territory id whenever the player taps/clicks it without dragging (e.g. to
   *  claim a capital, or to open a recruit menu). */
  setClickHandler(handler: ((territoryId: string) => void) | null): void {
    this.clickHandler = handler;
  }

  /** Enables dragging units from one territory onto an adjacent one. */
  setDragHandler(handler: DragHandler | null): void {
    this.dragHandler = handler;
  }

  /** Colors territories by owner, marks capitals, and labels garrison sizes. Pass null to reset. */
  applyGameState(gameState: GameState | null): void {
    this.currentGameState = gameState;
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

    this.markerLayer.replaceChildren();
    if (!gameState) return;
    this.drawMarkers(gameState.players.map((p) => ({ capitalId: p.capitalId, color: p.color })), false);
    for (const [id, state] of gameState.territoryState) {
      const total = totalUnits(state.garrison);
      if (total === 0) continue;
      const available = total - totalUnits(state.movedIn);
      this.drawLabel(id, available < total ? `${available}/${total}` : String(total));
    }
  }

  /** Colors territories by their Rüstungspunkte-Wert (see engine/economy.ts) as a heatmap and
   *  labels each with its value - independent of ownership or any other game state. */
  applyResourceView(territories: readonly Territory[]): void {
    const values = territories.map((t) => resourceValue(t.id));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const colorByTerritory = new Map<string, string>();
    for (const t of territories) colorByTerritory.set(t.id, resourceHeatColor(resourceValue(t.id), min, max));
    this.paint(colorByTerritory);
    this.markerLayer.replaceChildren();
    for (const t of territories) this.drawLabel(t.id, String(resourceValue(t.id)));
  }

  /** Colors territories by lobby claims (pre-game) and marks each claimed capital so far. */
  applyLobby(lobby: LobbyState | null): void {
    this.currentGameState = null;
    const colorByTerritory = new Map<string, string | undefined>();
    const markers: CapitalMarker[] = [];
    if (lobby) {
      for (const slot of lobby.slots) {
        if (slot.capitalId) {
          colorByTerritory.set(slot.capitalId, slot.color);
          markers.push({ capitalId: slot.capitalId, color: slot.color });
        }
      }
      for (const ai of lobby.aiSlots) {
        colorByTerritory.set(ai.capitalId, ai.color);
        markers.push({ capitalId: ai.capitalId, color: ai.color });
      }
    }
    this.paint(colorByTerritory);
    this.drawMarkers(markers, true);
  }

  private paint(colorByTerritory: ReadonlyMap<string, string | undefined>): void {
    // Always paints the true color, even for a currently-hovered element: ownership can change
    // (e.g. right after a move) while the pointer sits still, and a stale hover-fill left over
    // from before that change would otherwise hide the new, correct color indefinitely.
    for (const [id, el] of this.pathsById) {
      el.style.fill = colorByTerritory.get(id) ?? NEUTRAL_COLOR;
    }
  }

  private drawMarkers(markers: readonly CapitalMarker[], clearFirst: boolean): void {
    if (clearFirst) this.markerLayer.replaceChildren();
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

  private drawLabel(territoryId: string, text: string): void {
    const territory = this.territoriesById.get(territoryId);
    if (!territory) return;
    const [cx, cy] = territory.centroid;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(cx));
    label.setAttribute('y', String((cy ?? 0) + 0.55));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '0.5');
    label.setAttribute('font-weight', '700');
    label.setAttribute('fill', 'white');
    label.setAttribute('stroke', 'black');
    label.setAttribute('stroke-width', '0.05');
    label.setAttribute('paint-order', 'stroke');
    label.textContent = text;
    this.markerLayer.appendChild(label);
  }

  private onEnter(territory: Territory): void {
    this.hoveredId = territory.id;
    const el = this.pathsById.get(territory.id);
    el?.style.setProperty('stroke', RELATED_STROKE);
    el?.style.setProperty('stroke-width', HOVERED_STROKE_WIDTH);
    this.setNeighborStroke(territory, true);
    const state = this.currentGameState?.territoryState.get(territory.id);
    let garrisonText = '';
    if (state) {
      const total = totalUnits(state.garrison);
      if (total > 0) {
        const available = total - totalUnits(state.movedIn);
        garrisonText = ` (${available < total ? `${available}/${total}` : total})`;
      }
    }
    this.tooltip.textContent = `${territory.name}${garrisonText}`;
    this.tooltip.classList.remove('hidden');
  }

  private onMove(e: PointerEvent): void {
    this.tooltip.style.left = `${e.clientX}px`;
    this.tooltip.style.top = `${e.clientY}px`;
  }

  private onLeave(): void {
    const territory = this.hoveredId ? this.territoriesById.get(this.hoveredId) : undefined;
    this.hoveredId = null;
    if (territory) {
      const el = this.pathsById.get(territory.id);
      el?.style.removeProperty('stroke');
      el?.style.removeProperty('stroke-width');
      this.setNeighborStroke(territory, false);
    }
    this.tooltip.classList.add('hidden');
  }

  private setNeighborStroke(territory: Territory, on: boolean): void {
    for (const neighborId of territory.neighbors) {
      const el = this.pathsById.get(neighborId);
      if (!el) continue;
      if (on) {
        el.style.setProperty('stroke', RELATED_STROKE);
        el.style.setProperty('stroke-width', RELATED_STROKE_WIDTH);
      } else {
        el.style.removeProperty('stroke');
        el.style.removeProperty('stroke-width');
      }
    }
  }

  // Click and drag share one pointerdown/pointerup pair, so both are decided here rather than
  // also listening for the browser's synthetic `click` event: with setPointerCapture in play,
  // whether a native click still fires afterwards isn't reliably predictable across browsers.
  // Owning both outcomes ourselves - "released back on the source" is a click, "released
  // elsewhere while drag-eligible" is a drop - sidesteps that ambiguity entirely.

  private onDragStart(e: PointerEvent, territory: Territory): void {
    // Tracked even when not drag-eligible, so a plain press+release still resolves to a click.
    this.dragSourceId = territory.id;
    this.dragEligible = this.dragHandler?.canDrag(territory.id) ?? false;
    if (!this.dragEligible) return;
    e.preventDefault();
    (e.currentTarget as SVGPathElement).setPointerCapture(e.pointerId);
    this.setNeighborStroke(territory, true);
    this.updateDragLine(territory.centroid, e);
  }

  private onDragMove(e: PointerEvent): void {
    if (!this.dragSourceId || !this.dragEligible) return;
    const source = this.territoriesById.get(this.dragSourceId);
    if (source) this.updateDragLine(source.centroid, e);
  }

  private onDragEnd(e: PointerEvent): void {
    if (!this.dragSourceId) return;
    const sourceId = this.dragSourceId;
    const wasEligible = this.dragEligible;
    const targetId = this.territoryIdAtPoint(e.clientX, e.clientY);
    this.cancelDrag();
    if (targetId === sourceId) {
      this.clickHandler?.(sourceId);
    } else if (targetId && wasEligible) {
      this.dragHandler?.onDrop(sourceId, targetId);
    }
  }

  private cancelDrag(): void {
    const source = this.dragSourceId && this.dragEligible ? this.territoriesById.get(this.dragSourceId) : undefined;
    if (source) this.setNeighborStroke(source, false);
    this.dragSourceId = null;
    this.dragEligible = false;
    this.dragLine?.remove();
    this.dragLine = null;
  }

  private territoryIdAtPoint(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    return el instanceof SVGPathElement ? el.getAttribute('data-id') : null;
  }

  private updateDragLine(sourceCentroid: readonly number[], e: PointerEvent): void {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return;
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());

    if (!this.dragLine) {
      this.dragLine = document.createElementNS(SVG_NS, 'line');
      this.dragLine.setAttribute('stroke', RELATED_STROKE);
      this.dragLine.setAttribute('stroke-width', '0.12');
      this.dragLine.setAttribute('vector-effect', 'non-scaling-stroke');
      this.dragLine.classList.add('pointer-events-none');
      this.svg.appendChild(this.dragLine);
    }
    this.dragLine.setAttribute('x1', String(sourceCentroid[0] ?? 0));
    this.dragLine.setAttribute('y1', String(sourceCentroid[1] ?? 0));
    this.dragLine.setAttribute('x2', String(local.x));
    this.dragLine.setAttribute('y2', String(local.y));
  }
}
