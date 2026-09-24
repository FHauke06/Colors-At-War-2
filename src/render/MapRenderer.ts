import type { AirfieldState, GameState, LobbyState, SeaZoneState, Territory, TerritoryData, UnitComposition } from '../engine/types';
import { NEUTRAL_COLOR } from '../engine/palette';
import { garrisonView, totalUnits, type GarrisonView } from '../engine/movement';
import { resourceValue } from '../engine/economy';
import { getRelation } from '../engine/diplomacy';
import { projectableFightersAt } from '../engine/airforce';
import { UNIT_ICON_PATHS, UNIT_TYPES } from './unitIcons';
import { AIRCRAFT_ICON_PATHS, AIRCRAFT_TYPES } from './aircraftIcons';
import { SHIP_ICON_PATH } from './shipIcons';
import { createCoastLayer } from './coastLayer';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Blue (low) -> amber/red (high), scaled to whatever range of values is actually on screen. */
function resourceHeatColor(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0.5;
  const hue = 215 - t * 205;
  return `hsl(${hue}, 55%, 32%)`;
}

/** Green (100% own Jäger presence) -> red (100% enemy), by the same fraction as
 *  engine/airforce.ts's airSuperiorityFraction - undefined (falls through to NEUTRAL_COLOR grey in
 *  `paint`) when neither side has any Jäger projectable there at all, distinct from a genuinely
 *  50/50 contested spot (which lands mid-gradient, not grey). */
function airSuperiorityColor(myFighters: number, enemyFighters: number): string | undefined {
  if (myFighters + enemyFighters === 0) return undefined;
  const fraction = myFighters / (myFighters + enemyFighters);
  const hue = fraction * 120; // 0 = red, 120 = green
  return `hsl(${hue}, 65%, 38%)`;
}

// Hover/drag/drop-target cues are drawn as a stroke, never a fill: fill carries real information
// (who owns this territory), and overwriting it - even temporarily, even just for the exact
// territory the pointer happens to land on right after a drop - would hide that while it lasts.
// They live in their own overlay layer (see showCue) as outline copies of the territory instead of
// restyling the territory's own path: touching a base path made Chrome re-rasterize every polygon in
// that area on each hover (25 instead of 17 ms per mouse step at 1440p) - now the base is never touched.
const RELATED_STROKE = '#fbbf24'; // amber-400
const RELATED_STROKE_WIDTH = '1.6';
const HOVERED_STROKE_WIDTH = '2.2';

// The "currently selected" outline is a separate overlay path (same `d` as the territory, drawn
// on top) rather than styling the territory's own stroke like hover/drag do - that would conflict
// the moment the pointer also hovers or drags across the same shape, since onEnter/onLeave own
// that property too and would clobber a persistent selection the instant the pointer left.
const SELECTED_STROKE = '#fbbf24'; // amber-400
const SELECTED_STROKE_WIDTH = '2.4';

// Diplomacy tab colors (see applyDiplomacyView) - unoccupied territories fall through to
// NEUTRAL_COLOR the same as every other view, so there's no separate constant for that case.
const DIPLOMACY_OWN_COLOR = '#16a34a'; // green-600
const DIPLOMACY_ALLY_COLOR = '#2563eb'; // blue-600 - members of the viewer's alliance
const DIPLOMACY_PACT_COLOR = '#7c3aed'; // violet-600 - an active non-aggression pact, no alliance
const DIPLOMACY_WAR_COLOR = '#dc2626'; // red-600
// A rival at plain peace (no pact, no war) isn't any of the 4 requested states - kept one shade
// lighter than NEUTRAL_COLOR so it doesn't read as unowned, without introducing a 5th loud color.
const DIPLOMACY_PEACE_COLOR = '#64748b'; // slate-500

// Unit counts on the map (see drawGarrisonLabel): the viewer's own units in green, their allies'
// ("freundliche" - prefixed with an "F") in blue, everyone else's plain white. Light shades of each,
// so they stay readable on top of any faction's territory color with the label's black outline.
const OWN_UNITS_COLOR = '#4ade80'; // green-400
const FRIENDLY_UNITS_COLOR = '#60a5fa'; // blue-400
const OTHER_UNITS_COLOR = 'white';
/** Zeilenabstand der Garnisons-Zeilen (eine je Einheitentyp) - auch für das Schiffslabel darüber (drawShipLabel). */
const GARRISON_LINE_HEIGHT = 0.7;

// Kartenstil: Kartenpapier + Tinte statt Bildschirmblau. Die Seefarben kommen aus den Theme-Variablen (style.css), damit sie mit
// Hell/Dunkel wechseln: unbesetzte Seezonen als Farbwäsche, besetzte in der Besitzerfarbe halbtransparent auf dem Papier.
const SEA_FILL = 'var(--color-sea)';
const SEA_FILL_STRONG = 'var(--color-sea-strong)'; // Marine-Tab: die See soll dort deutlich hervortreten
const SEA_FILL_OPACITY_FREE = '1';
const SEA_FILL_OPACITY_OWNED = '0.5';
const SEA_FILL_OPACITY_OWNED_NAVAL = '0.85';
const SEA_INK = 'var(--color-sea-ink)'; // Schrift der Seenamen
/** Breite der Europa-Karte (viewBox) - für sie sind alle Schrift- und Symbolgrößen der Beschriftung in Karteneinheiten festgelegt. */
const LABEL_DESIGN_WIDTH = 55.37;

/** Tintenfarbe für alles, was über den Fraktionsfarben liegt (Grenzen, Küste, Beschriftungskontur) - fest, nicht themenabhängig,
 *  weil die Landflächen in beiden Themes dieselben Fraktionsfarben tragen. */
const INK = '#1c1b16';
const LABEL_OUTLINE = '#14130f';

/** Gradnetz wie auf einer Plankarte: gepunktete Längen- und Breitenkreise alle 10 Grad, am Rand mit ihren Gradzahlen. Die
 *  Projektion steht in TerritoryData.lonScale (x = Länge * lonScale, y = -Breite); ohne sie bleibt die Ebene leer. */
function buildGraticule(data: TerritoryData): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('pointer-events-none');
  const scale = data.lonScale;
  const [x0, y0, w, h] = data.viewBox.split(/\s+/).map(Number) as [number, number, number, number];
  if (!scale) return g;
  const fontSize = w * 0.0105;
  const STEP = 10;

  const line = (x1: number, y1: number, x2: number, y2: number): SVGLineElement => {
    const el = document.createElementNS(SVG_NS, 'line');
    el.setAttribute('x1', String(x1));
    el.setAttribute('y1', String(y1));
    el.setAttribute('x2', String(x2));
    el.setAttribute('y2', String(y2));
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.style.stroke = 'var(--color-slate-500)';
    el.style.strokeOpacity = '0.5';
    el.style.strokeWidth = '1.2';
    el.style.strokeDasharray = '0.5 6';
    el.style.strokeLinecap = 'round';
    return el;
  };
  const label = (x: number, y: number, text: string, anchor: 'start' | 'middle'): SVGTextElement => {
    const el = document.createElementNS(SVG_NS, 'text');
    el.setAttribute('x', String(x));
    el.setAttribute('y', String(y));
    el.setAttribute('text-anchor', anchor);
    el.setAttribute('font-size', String(fontSize));
    el.style.fill = 'var(--color-slate-500)';
    el.style.fontFamily = 'var(--font-mono)';
    el.style.fontWeight = '500';
    el.style.letterSpacing = '0.04em';
    el.textContent = text;
    return el;
  };

  for (let lat = Math.ceil(-(y0 + h) / STEP) * STEP; lat <= -y0; lat += STEP) {
    const y = -lat;
    g.appendChild(line(x0, y, x0 + w, y));
    if (y > y0 + fontSize * 2 && y < y0 + h - fontSize) {
      g.appendChild(label(x0 + fontSize * 0.7, y - fontSize * 0.4, `${Math.abs(lat)}°${lat === 0 ? '' : lat > 0 ? 'N' : 'S'}`, 'start'));
    }
  }
  for (let lon = Math.ceil(x0 / scale / STEP) * STEP; lon * scale <= x0 + w; lon += STEP) {
    const x = lon * scale;
    g.appendChild(line(x, y0, x, y0 + h));
    if (x > x0 + fontSize * 4 && x < x0 + w - fontSize * 3) {
      g.appendChild(label(x, y0 + fontSize * 1.6, `${Math.abs(lon)}°${lon === 0 ? '' : lon > 0 ? 'E' : 'W'}`, 'middle'));
    }
  }
  return g;
}

/** Eine deckungsgleiche, nicht anklickbare SVG-Ebene über der Karte (dieselbe viewBox, füllt das Kartenblatt). `will-change: transform` macht
 *  sie zur eigenen Compositor-Ebene: ihr Inhalt wird einmal gerastert und beim Hovern der Basis-Ebene nicht neu gezeichnet - und
 *  umgekehrt zeichnet ein Neuaufbau der Beschriftung nicht die Länder neu. */
function overlaySvg(viewBox: string): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('pointer-events-none', 'absolute', 'inset-0', 'h-full', 'w-full');
  el.style.willChange = 'transform';
  return el;
}

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
  /** Basis-Ebene: Seezonen, Kartennetz und Länder - alles, was Hover, Klick und Drag bekommt. */
  private readonly svg: SVGSVGElement;
  /** Hover-, Drag- und Nachbar-Umrisse (siehe showCue) - eine kleine eigene Ebene, damit die Basis beim Hovern nie neu gezeichnet wird. */
  private readonly cueSvg: SVGSVGElement;
  private readonly cuePaths = new Map<string, SVGPathElement>();
  /** Oberste Ebene: Auswahl-Umrisse, Markierungen, Beschriftung und Drag-Linie (nie anklickbar). */
  private readonly topSvg: SVGSVGElement;
  private readonly selectionLayer: SVGGElement;
  private readonly markerLayer: SVGGElement;
  private readonly tooltip: HTMLDivElement;
  private readonly pathsById = new Map<string, SVGPathElement>();
  private readonly territoriesById = new Map<string, Territory>();
  /** Ids der Seezonen (ebenfalls in pathsById/territoriesById, damit Hover, Auswahl und Drag sie wie Landgebiete behandeln). */
  private readonly seaIds = new Set<string>();
  private hoveredId: string | null = null;
  private clickHandler: ((territoryId: string) => void) | null = null;
  private dragHandler: DragHandler | null = null;
  private dragSourceId: string | null = null;
  private dragEligible = false;
  private dragLine: SVGLineElement | null = null;
  private currentGameState: GameState | null = null;
  /** Whose units count as "own" (green) and whose as "friendly" (blue) - see applyGameState. */
  private viewerId: string | null = null;

  /** Faktor für Zahlen, Symbole und Namen: breitere Karten (Asien) haben pro Einheit weniger Pixel, ihre Beschriftung wäre sonst winzig. */
  private readonly labelScale: number;

  constructor(container: HTMLElement, data: TerritoryData) {
    const viewBoxWidth = Number(data.viewBox.split(/\s+/)[2]);
    this.labelScale = Math.max(1, (viewBoxWidth / LABEL_DESIGN_WIDTH) * 0.9);
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', data.viewBox);
    // Der Kartenrand als feine Tintenlinie um die Zeichenfläche (die "Neatline" eines gedruckten Kartenblatts) - `wrap` unten
    // liefert Papier und Doppelrahmen darum.
    this.svg.classList.add('block', 'w-full', 'h-auto', 'touch-none', 'outline', 'outline-1', 'outline-slate-100/70');

    this.tooltip = document.createElement('div');
    this.tooltip.className =
      'pointer-events-none fixed hidden -translate-x-1/2 -translate-y-[130%] rounded-md border border-slate-100 bg-slate-800 px-2.5 py-1 font-display text-[15px] font-bold uppercase leading-5 tracking-[0.08em] text-slate-100 shadow-md z-10';

    // Die Küstenlinien (Wasserbänder + Tintenküste) sind eine eigene, statische Ebene über der Karte (ein Canvas, siehe coastLayer.ts):
    // im selben SVG wie die Länder wurden sie bei jedem Hover neu gerastert (Messung: 25 statt 17 ms pro Mausschritt). Da sie auf
    // das Wasser beschnitten sind, fallen sie nie auf Land; ihre Lage über den Ländern ändert nichts am Bild.
    const coastLayer = createCoastLayer(data);
    this.cueSvg = overlaySvg(data.viewBox);
    this.topSvg = overlaySvg(data.viewBox);

    // Seezonen zuerst: sie liegen unter dem Land, sichtbar bleibt nur das Wasser. Standardmäßig nicht anklickbar
    // (Lobby/Setup); GameScreen schaltet sie per setSeaInteractive frei.
    for (const zone of data.seaZones) {
      this.seaIds.add(zone.id);
      this.territoriesById.set(zone.id, zone);
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', zone.path);
      el.setAttribute('data-id', zone.id);
      el.style.fill = SEA_FILL;
      el.style.fillOpacity = SEA_FILL_OPACITY_FREE;
      el.style.pointerEvents = 'none';
      el.setAttribute('fill-rule', 'evenodd');
      // Zonengrenzen als gestrichelte Seegrenzen.
      el.classList.add('[stroke:var(--color-sea-line)]', '[stroke-dasharray:5_4]', '[stroke-width:0.9]', '[vector-effect:non-scaling-stroke]');
      el.addEventListener('pointerenter', () => this.onEnter(zone));
      el.addEventListener('pointermove', (e) => this.onMove(e));
      el.addEventListener('pointerleave', () => this.onLeave());
      el.addEventListener('pointerdown', (e) => this.onDragStart(e, zone));
      el.addEventListener('pointermove', (e) => this.onDragMove(e));
      el.addEventListener('pointerup', (e) => this.onDragEnd(e));
      el.addEventListener('pointercancel', () => this.cancelDrag());
      this.svg.appendChild(el);
      this.pathsById.set(zone.id, el);
    }

    this.svg.appendChild(buildGraticule(data));

    for (const territory of data.territories) {
      this.territoriesById.set(territory.id, territory);

      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', territory.path);
      el.setAttribute('data-id', territory.id);
      el.style.fill = NEUTRAL_COLOR;
      el.classList.add(
        'cursor-pointer',
        // Grenzen in fester Tinte (nicht themenabhängig): sie liegen auf den Fraktionsfarben, die in beiden Themes gleich sind.
        // Halbdurchsichtig, damit Binnengrenzen leiser bleiben als die Küste (siehe coastLayer.ts).
        '[stroke:#1c1b16]',
        '[stroke-opacity:0.5]',
        '[stroke-width:0.7]',
        '[stroke-linejoin:round]',
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

    this.selectionLayer = document.createElementNS(SVG_NS, 'g');
    this.selectionLayer.classList.add('pointer-events-none');
    this.topSvg.appendChild(this.selectionLayer);

    this.markerLayer = document.createElementNS(SVG_NS, 'g');
    this.markerLayer.classList.add('pointer-events-none');
    // Zahlen auf der Karte in derselben Ziffernschrift wie die Zugleiste.
    this.markerLayer.style.fontFamily = 'var(--font-mono)';
    this.topSvg.appendChild(this.markerLayer);

    // Kartenblatt: Papier, Doppelrahmen (`frame`) und ein Innenabstand, in dem die Rahmenlinien sichtbar bleiben (7px Rand +
    // 1px Neatline = die 16px, die style.css's `.map-fit` in der Höhe einrechnet). Darin die drei Ebenen übereinander; die Basis
    // gibt die Größe vor, die Overlays füllen sie deckungsgleich aus.
    const sheet = document.createElement('div');
    sheet.className = 'relative';
    sheet.append(this.svg, coastLayer, this.cueSvg, this.topSvg);
    const wrap = document.createElement('div');
    wrap.className = 'frame rounded-md bg-slate-950 p-[7px]';
    wrap.appendChild(sheet);

    container.appendChild(wrap);
    container.appendChild(this.tooltip);
  }

  /** Eine Gruppe für alles, was zu einem Ort gehört (Zahlen, Symbole, Namen), um dessen Mittelpunkt auf die Kartenbreite skaliert. */
  private labelGroup(cx: number, cy: number): SVGGElement {
    const group = document.createElementNS(SVG_NS, 'g');
    if (this.labelScale !== 1) group.setAttribute('transform', `translate(${cx} ${cy}) scale(${this.labelScale}) translate(${-cx} ${-cy})`);
    this.markerLayer.appendChild(group);
    return group;
  }

  /** Zeigt den Umriss eines Gebiets (oder einer Seezone) als kräftige Linie in `stroke` - als Kopie in der Hinweis-Ebene statt durch
   *  Umstylen des Basis-Pfads. Das zuletzt gezeigte liegt oben (der angehoverte Umriss über den Nachbar-Umrissen). Die Kopie entsteht
   *  beim ersten Mal und bleibt danach für weitere Hover erhalten. */
  private showCue(id: string, stroke: string, width: string): void {
    const territory = this.territoriesById.get(id);
    if (!territory) return;
    let el = this.cuePaths.get(id);
    if (!el) {
      el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', territory.path);
      el.setAttribute('fill', 'none');
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      el.setAttribute('stroke-linejoin', 'round');
      this.cuePaths.set(id, el);
    }
    el.style.stroke = stroke;
    el.style.strokeWidth = width;
    this.cueSvg.appendChild(el);
  }

  private hideCue(id: string): void {
    this.cuePaths.get(id)?.remove();
  }

  /** Macht die Seezonen anklickbar/ziehbar (im laufenden Spiel) oder wieder inaktiv (Lobby). */
  setSeaInteractive(on: boolean): void {
    for (const id of this.seaIds) {
      const el = this.pathsById.get(id);
      if (el) {
        el.style.pointerEvents = on ? 'auto' : 'none';
        el.classList.toggle('cursor-pointer', on);
      }
    }
  }

  isSeaZone(id: string): boolean {
    return this.seaIds.has(id);
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

  /** Outlines a territory to show it's the one currently "opened" for an action (e.g. the unit
   *  selection panel is showing its garrison) - pass null to clear it. */
  setSelectedTerritory(territoryId: string | null): void {
    this.selectionLayer.replaceChildren();
    if (!territoryId) return;
    const territory = this.territoriesById.get(territoryId);
    if (!territory) return;
    const outline = document.createElementNS(SVG_NS, 'path');
    outline.setAttribute('d', territory.path);
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', SELECTED_STROKE);
    outline.setAttribute('stroke-width', SELECTED_STROKE_WIDTH);
    outline.setAttribute('vector-effect', 'non-scaling-stroke');
    this.selectionLayer.appendChild(outline);
  }

  /** Draws an outline around each listed territory, in its own color - e.g. the Diplomatie tab
   *  ringing a clicked country in amber and its allies in blue at the same time. Shares the
   *  selection layer with setSelectedTerritory (whichever ran last wins), so pass an empty list
   *  (or call setSelectedTerritory(null)) to clear it. */
  setOutlinedTerritories(
    outlines: readonly { readonly territoryId: string; readonly stroke: string; readonly strokeWidth?: string }[],
  ): void {
    this.selectionLayer.replaceChildren();
    for (const { territoryId, stroke, strokeWidth } of outlines) {
      const territory = this.territoriesById.get(territoryId);
      if (!territory) continue;
      const outline = document.createElementNS(SVG_NS, 'path');
      outline.setAttribute('d', territory.path);
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', stroke);
      outline.setAttribute('stroke-width', strokeWidth ?? SELECTED_STROKE_WIDTH);
      outline.setAttribute('vector-effect', 'non-scaling-stroke');
      this.selectionLayer.appendChild(outline);
    }
  }

  /** Colors territories by owner, marks capitals, and labels garrison sizes - `viewerId`'s own units
   *  green, their allies' (standing on the same territory or theirs) blue, see drawGarrisonLabel.
   *  Pass a null game state to reset. */
  applyGameState(gameState: GameState | null, viewerId: string | null = null): void {
    this.currentGameState = gameState;
    this.viewerId = viewerId;
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
      const view = garrisonView(gameState, state, viewerId);
      this.drawGarrisonLabel(id, view);
      if ((state.ships ?? 0) > 0) this.drawShipLabel(id, state.ships ?? 0, state.shipsMovedIn ?? 0, state.ownerId === viewerId, this.garrisonTypes(view).length);
    }
    this.paintSeaZones(gameState, viewerId);
  }

  /** Marine-Tab: die Karte wie im Karten-Tab (Land nach Besitzer), aber ohne Landeinheiten-Garnisonen - Seezonen deutlich hervorgehoben, dazu Schiffe in Häfen und Zonen. */
  applyNavalView(gameState: GameState, viewerId: string): void {
    this.currentGameState = gameState;
    this.viewerId = viewerId;
    this.paint(new Map([...gameState.territoryState.entries()].map(([id, st]) => [id, gameState.players.find((p) => p.id === st.ownerId)?.color])));
    this.markerLayer.replaceChildren();
    this.drawMarkers(gameState.players.map((p) => ({ capitalId: p.capitalId, color: p.color })), false);
    for (const [id, state] of gameState.territoryState) {
      if ((state.ships ?? 0) > 0) this.drawShipLabel(id, state.ships ?? 0, state.shipsMovedIn ?? 0, state.ownerId === viewerId);
    }
    this.paintSeaZones(gameState, viewerId, true);
    // Das Land tritt zurück (gedämpft), die See steht im Vordergrund.
    for (const [id, el] of this.pathsById) {
      if (!this.seaIds.has(id)) el.style.fillOpacity = '0.55';
    }
  }

  /** Färbt Seezonen nach Besitzer und zeichnet Name, Schiffsanzahl (verfügbar/gesamt) und eingeschiffte Truppen. */
  private paintSeaZones(gameState: GameState, viewerId: string | null, naval = false): void {
    for (const id of this.seaIds) {
      const el = this.pathsById.get(id);
      const zone = this.territoriesById.get(id);
      if (!el || !zone) continue;
      const state = gameState.seaZones.get(id);
      const owner = state && state.ships > 0 && state.ownerId ? gameState.players.find((p) => p.id === state.ownerId) : undefined;
      el.style.fill = owner?.color ?? (naval ? SEA_FILL_STRONG : SEA_FILL);
      el.style.fillOpacity = owner ? (naval ? SEA_FILL_OPACITY_OWNED_NAVAL : SEA_FILL_OPACITY_OWNED) : SEA_FILL_OPACITY_FREE;
      this.drawSeaLabel(zone, state, state?.ownerId === viewerId);
    }
  }

  private drawSeaLabel(zone: Territory, state: SeaZoneState | undefined, own: boolean): void {
    const [rawCx, rawCy] = zone.centroid;
    const cx = rawCx ?? 0;
    const cy = rawCy ?? 0;
    const group = this.labelGroup(cx, cy);
    const name = document.createElementNS(SVG_NS, 'text');
    name.setAttribute('x', String(cx));
    name.setAttribute('y', String(cy));
    name.setAttribute('text-anchor', 'middle');
    // Seenamen wie auf einer Seekarte: gesperrte Versalien in Seetinte; der Hof in Wasserfarbe hält das Gradnetz aus der Schrift.
    name.setAttribute('font-size', '0.44');
    name.setAttribute('stroke-width', '0.1');
    name.setAttribute('paint-order', 'stroke');
    name.style.fontFamily = 'var(--font-display)';
    name.style.fontWeight = '700';
    name.style.letterSpacing = '0.26em';
    name.style.textTransform = 'uppercase';
    name.style.fill = SEA_INK;
    name.style.stroke = SEA_FILL;
    name.textContent = zone.name;
    group.appendChild(name);
    if (!state) return;
    const row: { readonly icon: string; readonly text: string }[] = [];
    if (state.ships > 0) {
      const avail = state.ships - state.shipsMovedIn;
      row.push({ icon: SHIP_ICON_PATH, text: avail < state.ships ? `${avail}/${state.ships}` : String(state.ships) });
    }
    const troops = totalUnits(state.embarked);
    if (troops > 0) row.push({ icon: UNIT_ICON_PATHS.infantry, text: String(troops) });
    row.forEach((entry, i) => this.drawIconCount(group, cx, cy + 0.55 + i * 0.6, entry.icon, entry.text, own ? OWN_UNITS_COLOR : OTHER_UNITS_COLOR, 0.5));
  }

  /** Ein weißes Symbol (SVG-Pfad) mit Zahl daneben, mittig um `cx`. */
  private drawIconCount(parent: SVGElement, cx: number, y: number, iconPaths: string, text: string, fill: string, fontSize: number): void {
    const iconSize = fontSize * 0.95;
    const icon = document.createElementNS(SVG_NS, 'g');
    icon.setAttribute('transform', `translate(${cx - 0.05 - iconSize}, ${y - iconSize * 0.85}) scale(${iconSize / 16})`);
    icon.setAttribute('fill', 'white');
    icon.setAttribute('stroke', LABEL_OUTLINE);
    icon.setAttribute('stroke-width', '1.4');
    icon.setAttribute('paint-order', 'stroke');
    icon.innerHTML = iconPaths;
    parent.appendChild(icon);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(cx + 0.05));
    label.setAttribute('y', String(y));
    label.setAttribute('text-anchor', 'start');
    label.setAttribute('font-size', String(fontSize));
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill', fill);
    label.setAttribute('stroke', LABEL_OUTLINE);
    label.setAttribute('stroke-width', '0.055');
    label.setAttribute('paint-order', 'stroke');
    label.textContent = text;
    parent.appendChild(label);
  }

  /** Schiffe im Hafen eines Küstengebiets: eine Zeile oberhalb der Garnison (`garrisonRows` = deren Zeilenzahl,
   *  siehe drawGarrisonLabel - 0 im Marine-Tab, wo keine Garnison gezeichnet wird). */
  private drawShipLabel(territoryId: string, ships: number, movedIn: number, own: boolean, garrisonRows = 0): void {
    const territory = this.territoriesById.get(territoryId);
    if (!territory) return;
    const [rawCx, rawCy] = territory.centroid;
    const cy = rawCy ?? 0;
    const group = this.labelGroup(rawCx ?? 0, cy);
    const avail = ships - movedIn;
    const y = garrisonRows > 0 ? cy + 0.5 - ((garrisonRows - 1) * GARRISON_LINE_HEIGHT) / 2 - GARRISON_LINE_HEIGHT : cy - 0.15;
    this.drawIconCount(group, rawCx ?? 0, y, SHIP_ICON_PATH, avail < ships ? `${avail}/${ships}` : String(ships), own ? OWN_UNITS_COLOR : OTHER_UNITS_COLOR, 0.44);
  }

  /** Colors territories by their current Rüstungspunkte-Wert (base value plus factories built
   *  there, see engine/economy.ts) as a heatmap and labels each with its value. */
  applyResourceView(gameState: GameState, territories: readonly Territory[]): void {
    const values = territories.map((t) => resourceValue(gameState, t.id));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const colorByTerritory = new Map<string, string>();
    for (const t of territories) colorByTerritory.set(t.id, resourceHeatColor(resourceValue(gameState, t.id), min, max));
    this.paint(colorByTerritory);
    this.markerLayer.replaceChildren();
    for (const t of territories) this.drawLabel(t.id, String(resourceValue(gameState, t.id)));
  }

  /** Colors territories by `viewerId`'s diplomatic relation with each owner: their own ground
   *  green, their alliance's members blue, anyone they hold an active pact with (but no alliance)
   *  violet, anyone they're at war with red - unoccupied territories fall through to the usual
   *  NEUTRAL_COLOR grey (see `paint`). A rival at plain peace (no pact, no alliance, no war) gets a
   *  muted neutral tone distinct from "unowned" - leaving it identical to unowned ground would hide
   *  real ownership information. */
  applyDiplomacyView(gameState: GameState, viewerId: string): void {
    this.currentGameState = gameState;
    this.viewerId = viewerId;
    const colorByTerritory = new Map<string, string>();
    for (const [id, state] of gameState.territoryState) {
      if (state.ownerId === null) continue; // stays NEUTRAL_COLOR
      if (state.ownerId === viewerId) {
        colorByTerritory.set(id, DIPLOMACY_OWN_COLOR);
        continue;
      }
      const relation = getRelation(gameState, viewerId, state.ownerId);
      if (relation.atWar) colorByTerritory.set(id, DIPLOMACY_WAR_COLOR);
      else if (relation.allied) colorByTerritory.set(id, DIPLOMACY_ALLY_COLOR);
      else if (relation.pact?.active) colorByTerritory.set(id, DIPLOMACY_PACT_COLOR);
      else colorByTerritory.set(id, DIPLOMACY_PEACE_COLOR);
    }
    this.paint(colorByTerritory);
    this.markerLayer.replaceChildren();
    this.drawMarkers(gameState.players.map((p) => ({ capitalId: p.capitalId, color: p.color })), false);
  }

  /** Colors territories by `viewerId`'s Jäger presence there relative to every other player's
   *  combined (green = all theirs, red = all the rival(s)', grey = neither side has any Jäger
   *  projectable there at all - see airSuperiorityColor/engine/airforce.ts's projectableFightersAt)
   *  instead of by owner - "die Farben der Karte sollen am Verhältnis der Flugzeuge dargestellt
   *  werden und nicht am Besitzer des Feldes". Still labels every territory that has a Flugplatz
   *  with its level and currently-stationed aircraft, same as before. */
  applyAirforceView(gameState: GameState, territories: readonly Territory[], viewerId: string): void {
    this.currentGameState = gameState;
    this.viewerId = viewerId;
    const colorByTerritory = new Map<string, string>();
    for (const t of territories) {
      const myFighters = projectableFightersAt(gameState, t.id, viewerId, territories);
      const enemyFighters = gameState.players
        .filter((p) => p.id !== viewerId)
        .reduce((sum, p) => sum + projectableFightersAt(gameState, t.id, p.id, territories), 0);
      const color = airSuperiorityColor(myFighters, enemyFighters);
      if (color) colorByTerritory.set(t.id, color);
    }
    this.paint(colorByTerritory);
    this.markerLayer.replaceChildren();
    this.drawMarkers(gameState.players.map((p) => ({ capitalId: p.capitalId, color: p.color })), false);
    for (const [id, airfield] of gameState.airfields) {
      if (airfield.level === 0) continue;
      this.drawAirfieldLabel(id, airfield);
    }
  }

  /** Colors territories by lobby claims (pre-game) and marks each claimed capital so far. */
  applyLobby(lobby: LobbyState | null): void {
    this.currentGameState = null;
    this.viewerId = null;
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
      if (this.seaIds.has(id)) continue;
      el.style.fill = colorByTerritory.get(id) ?? NEUTRAL_COLOR;
      el.style.fillOpacity = '';
    }
  }

  private drawMarkers(markers: readonly CapitalMarker[], clearFirst: boolean): void {
    if (clearFirst) this.markerLayer.replaceChildren();
    for (const { capitalId, color } of markers) {
      const territory = this.territoriesById.get(capitalId);
      if (!territory) continue;
      const [cx, cy] = territory.centroid;
      // Hauptstädte als Stern in der Fraktionsfarbe mit Tintenrand - die klassische Kartenmarkierung.
      const centreX = cx ?? 0;
      const centreY = cy ?? 0;
      const group = this.labelGroup(centreX, centreY);
      const points = Array.from({ length: 10 }, (_, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const radius = i % 2 === 0 ? 0.3 : 0.13;
        return `${centreX + radius * Math.cos(angle)},${centreY + radius * Math.sin(angle)}`;
      }).join(' ');
      const marker = document.createElementNS(SVG_NS, 'polygon');
      marker.setAttribute('points', points);
      marker.setAttribute('fill', color);
      marker.setAttribute('stroke', INK);
      marker.setAttribute('stroke-width', '1.3');
      marker.setAttribute('stroke-linejoin', 'round');
      marker.setAttribute('vector-effect', 'non-scaling-stroke');
      group.appendChild(marker);
    }
  }

  private drawLabel(territoryId: string, text: string): void {
    const territory = this.territoriesById.get(territoryId);
    if (!territory) return;
    const [cx, cy] = territory.centroid;
    const group = this.labelGroup(cx ?? 0, cy ?? 0);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(cx));
    label.setAttribute('y', String((cy ?? 0) + 0.55));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '0.5');
    label.setAttribute('font-weight', '600');
    label.setAttribute('fill', 'white');
    label.setAttribute('stroke', LABEL_OUTLINE);
    label.setAttribute('stroke-width', '0.05');
    label.setAttribute('paint-order', 'stroke');
    label.textContent = text;
    group.appendChild(label);
  }

  /** One line per unit type actually present at this territory - icon + count (or
   *  "available/total" once some of that type have moved this round) - stacked and centered on
   *  the territory's centroid, same convention as the tactical battle grid's tiles. The count is
   *  sorted by whose units they are and joined with "/", all in one row: the viewer's own in green,
   *  then their allies' in blue behind an "F" ("freundlich"), then anyone else's in white - so 5 of
   *  my own units standing beside 3 of an ally's read "5/F3", an ally's territory I'm not in "F3". */
  /** Die Einheitentypen, für die drawGarrisonLabel eine Zeile zeichnet (mindestens 1 Einheit, egal wessen). */
  private garrisonTypes(view: GarrisonView): (keyof UnitComposition)[] {
    return UNIT_TYPES.filter((type) => view.own[type] + view.friendly[type] + view.other[type] > 0);
  }

  private drawGarrisonLabel(territoryId: string, view: GarrisonView): void {
    const territory = this.territoriesById.get(territoryId);
    if (!territory) return;
    const [rawCx, rawCy] = territory.centroid;
    const cx = rawCx ?? 0;
    const cy = rawCy ?? 0;

    const types = this.garrisonTypes(view);
    if (types.length === 0) return;
    const group = this.labelGroup(cx, cy);

    const lineHeight = GARRISON_LINE_HEIGHT;
    const iconSize = 0.46;
    const gap = 0.1;
    const startY = cy + 0.5 - ((types.length - 1) * lineHeight) / 2;

    types.forEach((type, i) => {
      const y = startY + i * lineHeight;
      const parts: { readonly text: string; readonly fill: string }[] = [];
      const own = view.own[type];
      if (own > 0) {
        const avail = view.ownAvailable[type];
        parts.push({ text: avail < own ? `${avail}/${own}` : String(own), fill: OWN_UNITS_COLOR });
      }
      const friendly = view.friendly[type];
      if (friendly > 0) parts.push({ text: `F${friendly}`, fill: FRIENDLY_UNITS_COLOR });
      const other = view.other[type];
      if (other > 0) {
        const avail = view.otherAvailable[type];
        parts.push({ text: avail < other ? `${avail}/${other}` : String(other), fill: OTHER_UNITS_COLOR });
      }

      const icon = document.createElementNS(SVG_NS, 'g');
      const scale = iconSize / 16;
      icon.setAttribute('transform', `translate(${cx - gap / 2 - iconSize}, ${y - iconSize / 2 - 0.13}) scale(${scale})`);
      icon.setAttribute('fill', 'white');
      icon.setAttribute('stroke', LABEL_OUTLINE);
      icon.setAttribute('stroke-width', '1.4');
      icon.setAttribute('paint-order', 'stroke');
      icon.innerHTML = UNIT_ICON_PATHS[type];
      group.appendChild(icon);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(cx + gap / 2));
      label.setAttribute('y', String(y));
      label.setAttribute('text-anchor', 'start');
      label.setAttribute('font-size', '0.56');
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', OTHER_UNITS_COLOR);
      label.setAttribute('stroke', LABEL_OUTLINE);
      label.setAttribute('stroke-width', '0.055');
      label.setAttribute('paint-order', 'stroke');
      parts.forEach((part, index) => {
        if (index > 0) label.appendChild(this.labelSpan('/', OTHER_UNITS_COLOR));
        label.appendChild(this.labelSpan(part.text, part.fill));
      });
      group.appendChild(label);
    });
  }

  /** One differently-colored run of text inside a garrison label's row (see drawGarrisonLabel). */
  private labelSpan(text: string, fill: string): SVGTSpanElement {
    const span = document.createElementNS(SVG_NS, 'tspan');
    span.setAttribute('fill', fill);
    span.textContent = text;
    return span;
  }

  /** A territory's Flugplatz label: its level on one line above the centroid, then - one row per
   *  aircraft type actually stationed there right now - an icon+count row per type, same
   *  icon-then-number convention as drawGarrisonLabel's per-unit-type rows (rather than the old
   *  compact "J0 C0 B0" text line). */
  private drawAirfieldLabel(territoryId: string, airfield: AirfieldState): void {
    const territory = this.territoriesById.get(territoryId);
    if (!territory) return;
    const [rawCx, rawCy] = territory.centroid;
    const cx = rawCx ?? 0;
    const cy = rawCy ?? 0;
    const group = this.labelGroup(cx, cy);

    const levelLabel = document.createElementNS(SVG_NS, 'text');
    levelLabel.setAttribute('x', String(cx));
    levelLabel.setAttribute('y', String(cy - 0.65));
    levelLabel.setAttribute('text-anchor', 'middle');
    levelLabel.setAttribute('font-size', '0.38');
    levelLabel.setAttribute('font-weight', '600');
    levelLabel.setAttribute('fill', '#facc15');
    levelLabel.setAttribute('stroke', LABEL_OUTLINE);
    levelLabel.setAttribute('stroke-width', '0.05');
    levelLabel.setAttribute('paint-order', 'stroke');
    levelLabel.textContent = `✈ Lvl ${airfield.level}`;
    group.appendChild(levelLabel);

    const types = AIRCRAFT_TYPES.filter((type) => airfield.aircraft[type] > 0);
    if (types.length === 0) return;

    const lineHeight = 0.5;
    const iconSize = 0.38;
    const gap = 0.08;
    const startY = cy - 0.15;

    types.forEach((type, i) => {
      const y = startY + i * lineHeight;
      const count = airfield.aircraft[type];

      const icon = document.createElementNS(SVG_NS, 'g');
      const scale = iconSize / 16;
      icon.setAttribute('transform', `translate(${cx - gap / 2 - iconSize}, ${y - iconSize / 2 - 0.11}) scale(${scale})`);
      icon.setAttribute('fill', 'white');
      icon.setAttribute('stroke', LABEL_OUTLINE);
      icon.setAttribute('stroke-width', '1.4');
      icon.setAttribute('paint-order', 'stroke');
      icon.innerHTML = AIRCRAFT_ICON_PATHS[type];
      group.appendChild(icon);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(cx + gap / 2));
      label.setAttribute('y', String(y));
      label.setAttribute('text-anchor', 'start');
      label.setAttribute('font-size', '0.46');
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', 'white');
      label.setAttribute('stroke', LABEL_OUTLINE);
      label.setAttribute('stroke-width', '0.048');
      label.setAttribute('paint-order', 'stroke');
      label.textContent = String(count);
      group.appendChild(label);
    });
  }

  private onEnter(territory: Territory): void {
    this.hoveredId = territory.id;
    this.setNeighborStroke(territory, true);
    this.showCue(territory.id, RELATED_STROKE, HOVERED_STROKE_WIDTH);
    const state = this.currentGameState?.territoryState.get(territory.id);
    let garrisonText = '';
    if (state && this.currentGameState) {
      // Same split and notation as the map label (see drawGarrisonLabel), summed over all unit types.
      const view = garrisonView(this.currentGameState, state, this.viewerId);
      const counts: string[] = [];
      const own = totalUnits(view.own);
      if (own > 0) {
        const available = totalUnits(view.ownAvailable);
        counts.push(available < own ? `${available}/${own}` : String(own));
      }
      const friendly = totalUnits(view.friendly);
      if (friendly > 0) counts.push(`F${friendly}`);
      const other = totalUnits(view.other);
      if (other > 0) {
        const available = totalUnits(view.otherAvailable);
        counts.push(available < other ? `${available}/${other}` : String(other));
      }
      if (counts.length > 0) garrisonText = ` (${counts.join('/')})`;
    }
    const seaState = this.seaIds.has(territory.id) ? this.currentGameState?.seaZones.get(territory.id) : undefined;
    if (seaState) {
      const owner = this.currentGameState?.players.find((p) => p.id === seaState.ownerId);
      garrisonText = ` (${owner?.name ?? 'neutral'}${seaState.ships > 0 ? `, ${seaState.ships} Schiffe` : ''})`;
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
      this.hideCue(territory.id);
      this.setNeighborStroke(territory, false);
    }
    this.tooltip.classList.add('hidden');
  }

  private setNeighborStroke(territory: Territory, on: boolean): void {
    for (const neighborId of territory.neighbors) {
      if (on) this.showCue(neighborId, RELATED_STROKE, RELATED_STROKE_WIDTH);
      else this.hideCue(neighborId);
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
      this.topSvg.appendChild(this.dragLine);
    }
    this.dragLine.setAttribute('x1', String(sourceCentroid[0] ?? 0));
    this.dragLine.setAttribute('y1', String(sourceCentroid[1] ?? 0));
    this.dragLine.setAttribute('x2', String(local.x));
    this.dragLine.setAttribute('y2', String(local.y));
  }
}
