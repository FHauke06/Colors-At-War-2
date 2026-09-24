import type { AirComposition, AirTech, BattlePlacement, BattleSubTerritory, CalledAircraft, GameState, GroundTech, NavalTech, PendingBattle, Player, SupportTech, TerritoryData, UnitComposition } from '../engine/types';
import { totalUnits, availableToMove, addGarrisons, subtractGarrisons, stackOf, defenderForce } from '../engine/movement';
import { isEliminated, isGameOver, gameWinner, territoryStandings, remainingPlayers } from '../engine/victory';
import { statsFor, totalTroopsFor, totalFactoriesFor } from '../engine/stats';
import {
  UNIT_COSTS,
  costOf,
  developmentAt,
  factoryCapacity,
  resourceValue,
  FACTORY_COST,
  INFRASTRUCTURE_COST,
  MAX_INFRASTRUCTURE_LEVEL,
  SHIP_COST,
  MAX_SHIPS_PER_STACK,
  isCoastal,
} from '../engine/economy';
import { seaStateOf, availableShips, isSeaZoneId } from '../engine/naval';
import type { SeaBattleResult } from '../engine/naval';
import { renderSeaBattleView } from './SeaBattleView';
import { battleStrength, GRID_SIZE, MAX_BATTLE_ROUNDS, ARTILLERY_RANGE, NUKE_USE_COST, SIMULATED_DEFENSE_MULTIPLIER, STRENGTH, subTerritoryDistance, battleAirSuperiority } from '../engine/combat';
import type { BattleResult } from '../engine/combat';
import {
  PACT_COOLDOWN_ROUNDS,
  allianceConflict,
  alliesOf,
  areAllied,
  areAtWar,
  getRelation,
  hasPendingAllianceProposal,
  hasPendingProposal,
} from '../engine/diplomacy';
import {
  AIRCRAFT_COST_PER_100,
  AIRCRAFT_PACKET_SIZE,
  AIRFIELD_BUILD_COST,
  AIRFIELD_UPGRADE_COST,
  CAS_MIN_AIR_SUPERIORITY,
  CAS_STRIKE_DAMAGE_PER_UNIT,
  FIGHTER_BASE_KILL_RATE,
  BOMBER_DAMAGE_PER_UNIT,
  FACTORY_DAMAGE_PER_BOMBER,
  FIGHTER_RANGE,
  airfieldAt,
  airfieldCapacity,
  airCostOf,
  totalAircraft,
  territoryDistance,
} from '../engine/airforce';
import type { BomberRaidMode } from '../engine/airforce';
import { GROUND_TECH_TREE, AIR_TECH_TREE, SUPPORT_TECH_TREE, NAVAL_TECH_TREE, isGroundUnlocked, isAirUnlocked, isSupportUnlocked, isNavalUnlocked } from '../engine/research';
import { MapRenderer } from '../render/MapRenderer';
import { UNIT_ICON_PATHS, UNIT_LABELS, UNIT_TYPES } from '../render/unitIcons';
import { AIRCRAFT_ICON_PATHS, AIRCRAFT_LABELS, AIRCRAFT_TYPES } from '../render/aircraftIcons';
import { SHIP_ICON_PATH } from '../render/shipIcons';
import { TERRAIN_ICON_PATHS } from '../render/terrainIcons';
import type { GameClient } from '../net/GameClient';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Tab = 'map' | 'resources' | 'diplomacy' | 'airforce' | 'naval' | 'research';

const MAP_HINT =
  'Ziehe Einheiten auf ein angrenzendes Gebiet, um sie zu verschieben oder ein verteidigtes fremdes Gebiet anzugreifen (erfordert Krieg - klicke die Namenskachel eines Spielers oben für Diplomatie). Auf Gebieten von Verbündeten dürfen deine Einheiten mit stehen und sie durchqueren. Klicke ein eigenes Gebiet an, um dort Einheiten zu rekrutieren. Zahlen: eigene Einheiten grün, verbündete blau mit "F" davor (z. B. 5/F3).';
const RESOURCE_HINT =
  'Zeigt, wie viele Rüstungspunkte jedes Gebiet pro Runde einbringt (heller/wärmer = mehr). Klicke ein eigenes Gebiet an, um dort Fabriken zu bauen oder die Infrastruktur auszubauen.';
const DIPLOMACY_HINT =
  'Zeigt deinen diplomatischen Status: eigene Gebiete grün, Verbündete (Allianz) blau, Gebiete mit aktivem Nichtangriffspakt violett, Gebiete im Krieg rot, unbesetzte Gebiete grau. Andere Gebiete (Frieden ohne Pakt) sind gedämpft grau-blau. Klicke ein Land an, um seine Verbündeten zu sehen - Verbündete sehen alle Einheiten der anderen, ziehen automatisch in jeden Krieg eines Mitglieds und dürfen mit ihren Einheiten gemeinsam auf denselben Gebieten stehen.';

/** Outline colors the Diplomatie tab draws around the clicked country's territories and around its
 *  allies' territories (see GameScreen.renderDiplomacyFocus) - both picked to stay visible on top of
 *  every fill that view uses (green/blue/violet/red/grey). */
const DIPLOMACY_FOCUS_STROKE = '#fbbf24'; // amber-400, same as the main map's selection outline
const DIPLOMACY_ALLY_STROKE = '#67e8f9'; // cyan-300
/** Thicker than the main map's single-territory selection outline (0.3): this one rings a whole
 *  group of territories at once and has to stay readable at a glance, not just mark one. */
const DIPLOMACY_FOCUS_STROKE_WIDTH = '2';
const DIPLOMACY_ALLY_STROKE_WIDTH = '1.5';
const AIRFORCE_HINT =
  'Färbt jedes Gebiet nach dem Verhältnis der dort projizierten Jäger statt nach Besitzer: grün = vollständig deine Luftüberlegenheit, rot = vollständig feindliche, grau = keine Jäger von niemandem in Reichweite. Flugplätze zeigen zusätzlich ihre Stufe und stationierten Flugzeuge als Icons. Klicke ein eigenes Gebiet an, um dort einen Flugplatz zu bauen/auszubauen, Flugzeuge zu rekrutieren oder einen Bomber-/Jägereinsatz zu starten - oder ziehe ein Flugplatz-Gebiet direkt auf ein feindliches Ziel.';
const NAVAL_HINT =
  'Marine: wie im Karten-Tab, nur mit Schiffen. Klicke ein eigenes Küstengebiet an (Schiffe bauen, Auswahl), ziehe es auf eine angrenzende Seezone, um Schiffe fahren zu lassen und Landeinheiten einzuschiffen (nur in einer alleinig besetzten Zone mit eigenem Schiff). Zone auf Zone verlegt Schiffe (feindliche Zone im Krieg = Seeschlacht), Zone auf Küstengebiet setzt Truppen in der Folgerunde an Land - auf ein verteidigtes Feindgebiet als Landungsangriff. Schiffe brauchen Research > Marine.';
const RESEARCH_HINT =
  'Schalte neue Einheiten- und Flugzeugtypen für Rüstungspunkte frei - Infanterie ist von Anfang an verfügbar. Manche Technologien setzen eine andere voraus. Fahre mit der Maus über eine Technologie, um ihre Werte zu sehen.';

/** Hover-tooltip text for each researchable ground unit - see engine/research.ts's GROUND_TECH_TREE. */
const GROUND_TECH_STATS: Record<GroundTech, string> = {
  lightTank: `Stärke ${STRENGTH.lightTank} (Infanterie = ${STRENGTH.infantry}) — Rekrutierung: ${UNIT_COSTS.lightTank} Pkt./Einheit`,
  heavyTank: `Stärke ${STRENGTH.heavyTank} — Rekrutierung: ${UNIT_COSTS.heavyTank} Pkt./Einheit`,
  motorizedInfantry: `Stärke ${STRENGTH.motorizedInfantry} (wie Infanterie) — bewegt sich bis zu 2× pro Runde/Kampfzug, auf Hauptkarte und Schlachtfeld — Rekrutierung: ${UNIT_COSTS.motorizedInfantry} Pkt./Einheit`,
};

/** Hover-tooltip text for each researchable aircraft type - see engine/research.ts's AIR_TECH_TREE. */
const AIR_TECH_STATS: Record<AirTech, string> = {
  fighters: `Rekrutierung: ${AIRCRAFT_COST_PER_100.fighters} Pkt. pro Einheit (${AIRCRAFT_PACKET_SIZE} Flugzeuge) — kämpft um Luftüberlegenheit (Basis-Killrate ${FIGHTER_BASE_KILL_RATE} pro Jäger, quadratisch mit eigener Überzahl)`,
  cas: `Rekrutierung: ${AIRCRAFT_COST_PER_100.cas} Pkt. pro Einheit (${AIRCRAFT_PACKET_SIZE} Flugzeuge) — ${CAS_STRIKE_DAMAGE_PER_UNIT} Schaden pro Einsatz (1 Flugzeug besiegt 10 Infanterie) — nur einsetzbar über ${Math.round(CAS_MIN_AIR_SUPERIORITY * 100)}% Luftüberlegenheit`,
  bombers: `Rekrutierung: ${AIRCRAFT_COST_PER_100.bombers} Pkt. pro Einheit (${AIRCRAFT_PACKET_SIZE} Flugzeuge) — Rückkehrquote entspricht der eigenen Luftüberlegenheit am Ziel. Wähle beim Angriff das Ziel: Einheiten (100 Bomber = ${Math.round(100 * BOMBER_DAMAGE_PER_UNIT)} Stärke) oder Fabriken (100 Bomber = ${Math.round(100 * FACTORY_DAMAGE_PER_BOMBER)} Fabriken)`,
};

/** Support weapons don't fit the ground/air split - see engine/research.ts's SUPPORT_TECH_TREE. */
const SUPPORT_TECH_LABELS: Record<SupportTech, string> = { artillery: UNIT_LABELS.artillery, nuke: 'Atombombe' };
const NAVAL_TECH_LABELS: Record<NavalTech, string> = { ships: 'Schiffe' };
const NAVAL_TECH_STATS: Record<NavalTech, string> = {
  ships: `Schiffe werden in Küstengebieten rekrutiert (${SHIP_COST} Pkt. pro Schiff) und besetzen Seezonen. Im Seekampf (Schiffe versenken) ist jedes Schiff genau 1 Kasten. Nur wer eine Seezone alleinig besetzt und dort mindestens 1 Schiff liegen hat, kann Landeinheiten überseetransportieren.`,
};

/** Hover-tooltip text for engine/research.ts's SUPPORT_TECH_TREE. */
const SUPPORT_TECH_STATS: Record<SupportTech, string> = {
  artillery: `Kein gewöhnlicher Kampfwert — Fernbeschuss bis ${ARTILLERY_RANGE} Felder im Kampf, bis zu 1 Infanterie pro Artillerie — Rekrutierung: ${UNIT_COSTS.artillery} Pkt./Einheit`,
  nuke: `Einsatz im taktischen Kampf: ${NUKE_USE_COST} Pkt./Bombe — zerstört ALLE Einheiten in der Schlacht, auch die eigenen, und beendet den Kampf sofort ohne Sieger`,
};

const primaryBtnClass =
  'rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500';
const secondaryBtnClass =
  'rounded-md border border-slate-600 bg-slate-800 px-4 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-600 disabled:hover:bg-slate-900';

/** The escape row's tiles always use this color, in both phases and regardless of who's viewing -
 *  distinct from any player color or the dark "unknown zone" background. */
const ESCAPE_COLOR = '#b45309';
const ESCAPE_GLYPH = '→';

/** Terrain tiles always use these colors, in both phases and regardless of who's viewing - nobody
 *  can ever stand on them, so they never need to show owner colors or unit counts. */
const TERRAIN_STYLE: Record<'river' | 'mountain', { readonly background: string; readonly icon: string }> = {
  river: { background: '#7dd3fc', icon: '#0c4a6e' }, // sky-300 bg, sky-900 icon
  mountain: { background: '#9ca3af', icon: '#1f2937' }, // gray-400 bg, gray-800 icon
};

function createUnitIcon(type: keyof UnitComposition, className = 'h-3.5 w-3.5 shrink-0'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(...className.split(' '));
  svg.innerHTML = UNIT_ICON_PATHS[type];
  return svg;
}

function createShipIcon(className = 'h-3.5 w-3.5 shrink-0'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(...className.split(' '));
  svg.innerHTML = SHIP_ICON_PATH;
  return svg;
}

function createTerrainIcon(terrain: 'river' | 'mountain', className = 'h-3 w-3 shrink-0'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  const color = TERRAIN_STYLE[terrain].icon;
  svg.setAttribute('fill', color);
  svg.setAttribute('stroke', color);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(...className.split(' '));
  svg.innerHTML = TERRAIN_ICON_PATHS[terrain];
  return svg;
}

function createAircraftIcon(type: keyof AirComposition, className = 'h-3.5 w-3.5 shrink-0'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(...className.split(' '));
  svg.innerHTML = AIRCRAFT_ICON_PATHS[type];
  return svg;
}

/** A small mushroom-cloud silhouette - same hand-drawn-pictogram style as UNIT_ICON_PATHS/
 *  AIRCRAFT_ICON_PATHS, just a one-off for the Atombombe specifically (Artillerie, the other
 *  SupportTech, already has its own UNIT_ICON_PATHS entry) rather than a Record keyed by type. */
function createNukeIcon(className = 'h-3.5 w-3.5 shrink-0'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(...className.split(' '));
  svg.innerHTML = '<circle cx="8" cy="5" r="4.2"/><path d="M6 8.3h4l1.4 6.5h-6.8z"/>';
  return svg;
}

function describeComposition(c: UnitComposition): string {
  const parts = UNIT_TYPES.filter((t) => c[t] > 0).map((t) => `${c[t]} ${UNIT_LABELS[t]}`);
  return parts.length > 0 ? parts.join(', ') : '–';
}

function emptyComposition(): UnitComposition {
  return { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };
}

function sumCompositions(items: readonly UnitComposition[]): UnitComposition {
  return items.reduce((sum, item) => addGarrisons(sum, item), emptyComposition());
}

/** What a tile shows: either a fixed glyph (the escape row's arrow), a per-type unit breakdown
 *  (icon + count, one line per type actually present - `available` differs from `total` once some
 *  of that type have moved this battle-turn), or nothing at all. */
type TileContent =
  | { readonly kind: 'glyph'; readonly text: string }
  | { readonly kind: 'composition'; readonly total: UnitComposition; readonly available: UnitComposition }
  | null;

interface BattleGridOptions {
  readonly getColor: (t: BattleSubTerritory) => string;
  readonly getContent: (t: BattleSubTerritory) => TileContent;
  readonly isInteractive: (t: BattleSubTerritory) => boolean;
  /** shiftKey lets a caller step in bulk (e.g. the deployment phase places/removes 10 at once
   *  instead of 1) - see MapRenderer-style click/drag callers that don't need it just ignore it. */
  readonly onClick?: (t: BattleSubTerritory, shiftKey: boolean) => void;
  readonly onRightClick?: (t: BattleSubTerritory, shiftKey: boolean) => void;
  /** Optional press-drag-release gesture, mirroring the main map's drag-to-move (see
   *  MapRenderer's onDragStart/onDragEnd): pointerdown on a tile canDrag allows starts a drag;
   *  releasing back on the same tile still resolves as a plain click (via onClick), releasing on
   *  a different tile calls onDrop instead. Leave both unset to keep a tile click-only, as
   *  deployment/spectator views do. */
  readonly canDrag?: (t: BattleSubTerritory) => boolean;
  readonly onDrop?: (fromId: string, toId: string) => void;
  /** Called after any eligible drag concludes without landing on the source tile itself (i.e.
   *  whenever onDrop fires, and also when the drag is released outside any valid tile) - a chance
   *  to resync visual state setDragVisual touched but doesn't own, e.g. a persistent selection
   *  ring on a field that's still selected after an invalid or aborted drop. */
  readonly onDragSettle?: () => void;
}

export class GameScreen {
  private readonly map: MapRenderer;
  private readonly legend: HTMLDivElement;
  private readonly statsPanel: HTMLDivElement;
  private readonly errorBanner: HTMLDivElement;
  private readonly battleWaitingBanner: HTMLDivElement;
  private readonly turnRow: HTMLDivElement;
  private readonly turnStatus: HTMLDivElement;
  private readonly endTurnBtn: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;
  private readonly mapTabBtn: HTMLButtonElement;
  private readonly resourceTabBtn: HTMLButtonElement;
  private readonly diplomacyTabBtn: HTMLButtonElement;
  private readonly airforceTabBtn: HTMLButtonElement;
  private readonly researchTabBtn: HTMLButtonElement;
  private readonly navalTabBtn: HTMLButtonElement;
  private readonly notificationStack: HTMLDivElement;
  private readonly normalView: HTMLDivElement;
  private readonly tacticalView: HTMLDivElement;
  private readonly gameOverView: HTMLDivElement;
  private readonly moveSelectionSlot: HTMLDivElement;
  private readonly mapRow: HTMLDivElement;
  private readonly researchPanel: { readonly el: HTMLDivElement; readonly refresh: () => void };
  private readonly data: TerritoryData;
  private readonly client: GameClient;
  private readonly unsubscribers: (() => void)[] = [];
  private currentGameState: GameState;
  private activeTab: Tab = 'map';
  /** Targets this player has just declared war on themselves (set right at the button click, read
   *  and consumed by the very next render's notification diff) - without this, that same war
   *  declaration would show up as if the target had declared war on THEM instead. See
   *  detectDiplomacyNotifications; pact offers need no such tracking, see its own comment why. */
  private readonly myRecentWarDeclarations = new Set<string>();
  /** The territory currently "opened" for moving on the main map (clicked, showing the unit
   *  selection panel) - null when nothing is selected. Dragging that same territory onto a
   *  neighbor sends whatever's currently checked in the panel; dragging any other (unopened)
   *  territory falls back to sending everything available, so a quick drag-without-clicking-first
   *  still works exactly like before. */
  private selectedMoveSourceId: string | null = null;
  private currentMoveSelectionPanel: { getSelectedAmount: () => UnitComposition } | null = null;
  /** Marine-Tab: das geöffnete Schiffs-/Truppen-Auswahlpanel (siehe handleNavalClick). */
  private currentNavalPanel: { getSelection: () => { readonly ships: number; readonly units: UnitComposition } } | null = null;
  /** The territory-development modal, if one's open - refreshed on every state update so building
   *  a factory or upgrading infrastructure doesn't require re-clicking the territory each time. */
  private currentDevelopmentPanel: { readonly refresh: () => void } | null = null;
  /** The diplomacy modal, if one's open - refreshed on every state update, same reasoning as
   *  currentDevelopmentPanel. */
  private currentDiplomacyPanel: { readonly refresh: () => void } | null = null;
  /** The player whose country was last clicked in the Diplomatie tab - their allies are listed in
   *  a side panel and outlined on the map (see renderDiplomacyFocus). Null when nothing's selected;
   *  cleared by closeMoveSelection, which every tab switch already goes through. */
  private diplomacyFocusOwnerId: string | null = null;
  /** The Flugplatz-Verwaltung modal, if one's open - refreshed on every state update, same
   *  reasoning as currentDevelopmentPanel. */
  private currentAirforcePanel: { readonly refresh: () => void } | null = null;
  /** Air support call-ins already reflected in a toast (see detectAirSupportNotifications) - so a
   *  re-render doesn't notify twice about the same call, similar to myRecentWarDeclarations but
   *  keyed by CalledAircraft id instead of needing self-suppression (every call is worth notifying
   *  both sides about, including your own, per "beide Seiten werden darüber informiert"). */
  private readonly notifiedAirSupportCallIds = new Set<string>();

  constructor(container: HTMLElement, data: TerritoryData, client: GameClient, initialGameState: GameState) {
    this.data = data;
    this.client = client;
    this.currentGameState = initialGameState;

    const shell = document.createElement('div');
    shell.className = 'mx-auto max-w-6xl';

    this.errorBanner = document.createElement('div');
    this.errorBanner.className = 'mb-3 hidden rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-200';

    this.battleWaitingBanner = document.createElement('div');
    this.battleWaitingBanner.className =
      'mb-3 hidden rounded-md border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-200';

    this.turnRow = document.createElement('div');
    this.turnRow.className =
      'mb-3 flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2';
    this.turnStatus = document.createElement('div');
    this.turnStatus.className = 'text-sm text-slate-200';
    this.endTurnBtn = document.createElement('button');
    this.endTurnBtn.type = 'button';
    this.endTurnBtn.textContent = 'Zug beenden';
    this.endTurnBtn.className = primaryBtnClass;
    this.endTurnBtn.addEventListener('click', () => client.endTurn());
    this.turnRow.append(this.turnStatus, this.endTurnBtn);

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
    this.diplomacyTabBtn = document.createElement('button');
    this.diplomacyTabBtn.type = 'button';
    this.diplomacyTabBtn.textContent = 'Diplomatie';
    this.diplomacyTabBtn.addEventListener('click', () => this.setTab('diplomacy'));
    this.airforceTabBtn = document.createElement('button');
    this.airforceTabBtn.type = 'button';
    this.airforceTabBtn.textContent = 'Airforce';
    this.airforceTabBtn.addEventListener('click', () => this.setTab('airforce'));
    this.navalTabBtn = document.createElement('button');
    this.navalTabBtn.type = 'button';
    this.navalTabBtn.textContent = 'Marine';
    this.navalTabBtn.addEventListener('click', () => this.setTab('naval'));
    this.researchTabBtn = document.createElement('button');
    this.researchTabBtn.type = 'button';
    this.researchTabBtn.textContent = 'Research';
    this.researchTabBtn.addEventListener('click', () => this.setTab('research'));
    tabRow.append(this.mapTabBtn, this.resourceTabBtn, this.diplomacyTabBtn, this.airforceTabBtn, this.navalTabBtn, this.researchTabBtn);

    this.notificationStack = document.createElement('div');
    this.notificationStack.className =
      'pointer-events-none fixed right-4 top-32 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2';

    this.hint = document.createElement('p');
    this.hint.className = 'mb-3 text-sm text-slate-400';

    const mapContainer = document.createElement('div');
    mapContainer.className = 'flex-1';
    this.moveSelectionSlot = document.createElement('div');
    this.moveSelectionSlot.className = 'flex flex-col gap-2';
    this.legend = document.createElement('div');
    this.legend.className = 'mt-4 flex flex-wrap gap-2';
    this.statsPanel = document.createElement('div');
    this.statsPanel.className = 'mt-4 flex flex-col gap-2 rounded-md border border-slate-700 bg-slate-800/60 p-3';

    this.mapRow = document.createElement('div');
    this.mapRow.className = 'flex flex-col gap-4 lg:flex-row';
    this.mapRow.append(mapContainer, this.moveSelectionSlot);

    this.researchPanel = this.buildResearchPanel();

    this.normalView = document.createElement('div');
    this.normalView.append(tabRow, this.hint, this.mapRow, this.researchPanel.el, this.legend, this.statsPanel);

    this.tacticalView = document.createElement('div');
    this.tacticalView.className = 'hidden';

    this.gameOverView = document.createElement('div');
    this.gameOverView.className = 'hidden';

    shell.append(
      this.notificationStack,
      this.errorBanner,
      this.battleWaitingBanner,
      this.turnRow,
      this.normalView,
      this.tacticalView,
      this.gameOverView,
    );
    container.appendChild(shell);

    this.map = new MapRenderer(mapContainer, data);
    this.map.setDragHandler({
      canDrag: (territoryId) => {
        if (isGameOver(this.currentGameState)) return false;
        if (this.currentGameState.activePlayerId !== client.playerId) return false;
        if (this.currentGameState.pendingSeaBattle) return false;
        // Marine-Tab: nur Wasser-Bewegungen (Schiffe fahren, Truppen ein-/ausschiffen, Landungsangriff).
        if (this.activeTab === 'naval') {
          const gs = this.currentGameState;
          if (isSeaZoneId(this.data.seaZones, territoryId)) {
            const z = seaStateOf(gs, territoryId);
            return z.ownerId === client.playerId && (z.ships - z.shipsMovedIn > 0 || totalUnits(subtractGarrisons(z.embarked, z.embarkedMovedIn)) > 0);
          }
          const st = gs.territoryState.get(territoryId);
          if (!st || st.ownerId !== client.playerId || !isCoastal(territoryId, this.data.seaZones)) return false;
          return availableShips(gs, client.playerId, territoryId, this.data.seaZones) > 0 || totalUnits(availableToMove(st)) > 0;
        }
        const state = this.currentGameState.territoryState.get(territoryId);
        if (!state) return false;

        // Jäger and Bomber are draggable onto a target the same way ground units are, to attack
        // it directly (fighterSweep/launchBomberRaid) without opening a tactical battle - see
        // handleAirforceDrop. They belong to the territory's own Flugplatz, so only its owner.
        if (this.activeTab === 'airforce') {
          if (state.ownerId !== client.playerId) return false;
          const airfield = airfieldAt(this.currentGameState, territoryId);
          return airfield.aircraft.fighters > 0 || airfield.aircraft.bombers > 0;
        }
        if (this.activeTab !== 'map') return false;
        // Ground units may be picked up wherever they stand: on the player's own territory, or on
        // an ally's where they're stationed as guests.
        const stack = stackOf(state, client.playerId);
        return !!stack && totalUnits(stack.garrison) - totalUnits(stack.movedIn) > 0;
      },
      onDrop: (fromId, toId) => {
        if (this.activeTab === 'airforce') {
          this.handleAirforceDrop(fromId, toId);
          return;
        }
        // Alles, was Wasser berührt (Schiffe fahren, Truppen ein-/ausschiffen, Landungsangriff), läuft im Marine-Tab über ein Menü.
        if (this.activeTab === 'naval') {
          if (isSeaZoneId(this.data.seaZones, fromId) || isSeaZoneId(this.data.seaZones, toId)) this.handleNavalDrop(fromId, toId);
          else this.showError('Im Marine-Tab bewegst du Schiffe und Truppen über Wasser - Landbewegungen gehen im Karten-Tab.');
          return;
        }
        const toState = this.currentGameState.territoryState.get(toId);
        // An ally's ground isn't enemy ground: dropping there moves in beside them (see moveUnits).
        const isEnemyOccupied =
          !!toState &&
          toState.ownerId !== null &&
          toState.ownerId !== client.playerId &&
          !areAllied(this.currentGameState, client.playerId, toState.ownerId);
        if (isEnemyOccupied && !areAtWar(this.currentGameState, client.playerId, toState!.ownerId!)) {
          this.showError('Kein Kriegszustand - erst den Krieg erklären, bevor angegriffen oder erobert werden kann.');
          return;
        }
        const isAttack = isEnemyOccupied && totalUnits(defenderForce(toState!)) > 0;
        if (isAttack) {
          this.openAttackChoiceMenu(fromId, toId);
          return;
        }
        const fromState = this.currentGameState.territoryState.get(fromId);
        const fromStack = fromState ? stackOf(fromState, client.playerId) : null;
        if (!fromStack) return;
        const amount =
          this.selectedMoveSourceId === fromId && this.currentMoveSelectionPanel
            ? this.currentMoveSelectionPanel.getSelectedAmount()
            : availableToMove(fromStack);
        this.client.moveUnits(fromId, toId, amount);
        this.closeMoveSelection();
      },
    });
    this.map.setSeaInteractive(false);
    this.map.setClickHandler((territoryId) => this.handleTerritoryClick(territoryId));

    this.unsubscribers.push(client.onGameState((gameState) => this.render(gameState)));
    this.unsubscribers.push(client.onError((message) => this.showError(message)));
    this.unsubscribers.push(client.onBattle((battle) => this.showBattleConcluded(battle)));

    this.currentGameState = initialGameState;
    this.setTab('map');
    this.render(initialGameState);
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
  }

  /** One researchable ground unit or aircraft type, as a hoverable card: name/icon, its
   *  Rüstungspunkte cost, and either a "Freischalten" button (affordable and its prerequisite, if
   *  any, is already unlocked), a locked hint naming that prerequisite, or an "Erforscht" badge.
   *  Hovering anywhere on the card reveals its stats line (see GROUND_TECH_STATS/AIR_TECH_STATS) -
   *  "wenn man über die Technologien hovert sollen dort die Werte angezeigt werden". */
  private buildTechCard(opts: {
    readonly icon: Node;
    readonly label: string;
    readonly cost: number;
    readonly requiresLabel: string | null;
    readonly statsText: string;
    readonly unlocked: boolean;
    readonly prereqMet: boolean;
    readonly canAfford: boolean;
    readonly onUnlock: () => void;
  }): HTMLDivElement {
    const card = document.createElement('div');
    card.className = `flex flex-col gap-2 rounded-md border p-3 ${
      opts.unlocked ? 'border-emerald-700 bg-emerald-950/20' : 'border-slate-700 bg-slate-900/60'
    }`;

    const header = document.createElement('div');
    header.className = 'flex items-center gap-2';
    const label = document.createElement('span');
    label.className = 'text-sm font-semibold text-slate-100';
    label.textContent = opts.label;
    header.append(opts.icon, label);
    card.appendChild(header);

    const stats = document.createElement('p');
    stats.className = 'hidden text-xs text-slate-400';
    stats.textContent = opts.statsText;
    card.addEventListener('mouseenter', () => stats.classList.remove('hidden'));
    card.addEventListener('mouseleave', () => stats.classList.add('hidden'));
    card.appendChild(stats);

    if (opts.unlocked) {
      const badge = document.createElement('span');
      badge.className = 'text-xs font-semibold text-emerald-400';
      badge.textContent = '✓ Erforscht';
      card.appendChild(badge);
    } else if (!opts.prereqMet) {
      const hint = document.createElement('p');
      hint.className = 'text-xs text-slate-500';
      hint.textContent = `Benötigt zuerst: ${opts.requiresLabel}`;
      card.appendChild(hint);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Freischalten (${opts.cost} Pkt.)`;
      btn.className = `${primaryBtnClass} w-full`;
      btn.disabled = !opts.canAfford;
      btn.addEventListener('click', opts.onUnlock);
      card.appendChild(btn);
    }

    return card;
  }

  /** The Research tab's panel: two sub-tabs (Boden/Flugzeuge), each a grid of buildTechCard
   *  entries for engine/research.ts's GROUND_TECH_TREE/AIR_TECH_TREE. Built once, refreshed on
   *  every state update while active (same pattern as the map-recoloring tabs) since affordability
   *  and unlock state both change as the game goes on. */
  private buildResearchPanel(): { readonly el: HTMLDivElement; readonly refresh: () => void } {
    const el = document.createElement('div');
    el.className = 'hidden flex-col gap-4';

    const subTabRow = document.createElement('div');
    subTabRow.className = 'flex gap-2';
    const groundBtn = document.createElement('button');
    groundBtn.type = 'button';
    groundBtn.textContent = 'Boden';
    groundBtn.className = primaryBtnClass;
    const airBtn = document.createElement('button');
    airBtn.type = 'button';
    airBtn.textContent = 'Flugzeuge';
    airBtn.className = secondaryBtnClass;
    const supportBtn = document.createElement('button');
    supportBtn.type = 'button';
    supportBtn.textContent = 'Support';
    supportBtn.className = secondaryBtnClass;
    const navalBtn = document.createElement('button');
    navalBtn.type = 'button';
    navalBtn.textContent = 'Marine';
    navalBtn.className = secondaryBtnClass;
    subTabRow.append(groundBtn, airBtn, supportBtn, navalBtn);

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3';

    let subTab: 'ground' | 'air' | 'support' | 'naval' = 'ground';

    const refresh = (): void => {
      grid.replaceChildren();
      const myId = this.client.playerId;
      const points = this.currentGameState.resources.get(myId) ?? 0;

      if (subTab === 'ground') {
        for (const tech of ['lightTank', 'heavyTank', 'motorizedInfantry'] as const) {
          const def = GROUND_TECH_TREE[tech];
          grid.appendChild(
            this.buildTechCard({
              icon: createUnitIcon(tech, 'h-5 w-5 shrink-0'),
              label: UNIT_LABELS[tech],
              cost: def.cost,
              requiresLabel: def.requires ? UNIT_LABELS[def.requires] : null,
              statsText: GROUND_TECH_STATS[tech],
              unlocked: isGroundUnlocked(this.currentGameState, myId, tech),
              prereqMet: !def.requires || isGroundUnlocked(this.currentGameState, myId, def.requires),
              canAfford: points >= def.cost,
              onUnlock: () => this.client.unlockGroundTech(tech),
            }),
          );
        }
      } else if (subTab === 'air') {
        for (const tech of ['fighters', 'cas', 'bombers'] as const) {
          const def = AIR_TECH_TREE[tech];
          grid.appendChild(
            this.buildTechCard({
              icon: createAircraftIcon(tech, 'h-5 w-5 shrink-0'),
              label: AIRCRAFT_LABELS[tech],
              cost: def.cost,
              requiresLabel: def.requires ? AIRCRAFT_LABELS[def.requires] : null,
              statsText: AIR_TECH_STATS[tech],
              unlocked: isAirUnlocked(this.currentGameState, myId, tech),
              prereqMet: !def.requires || isAirUnlocked(this.currentGameState, myId, def.requires),
              canAfford: points >= def.cost,
              onUnlock: () => this.client.unlockAirTech(tech),
            }),
          );
        }
      } else if (subTab === 'naval') {
        for (const tech of ['ships'] as const) {
          const def = NAVAL_TECH_TREE[tech];
          grid.appendChild(
            this.buildTechCard({
              icon: createShipIcon('h-5 w-5 shrink-0'),
              label: NAVAL_TECH_LABELS[tech],
              cost: def.cost,
              requiresLabel: null,
              statsText: NAVAL_TECH_STATS[tech],
              unlocked: isNavalUnlocked(this.currentGameState, myId, tech),
              prereqMet: true,
              canAfford: points >= def.cost,
              onUnlock: () => this.client.unlockNavalTech(tech),
            }),
          );
        }
      } else {
        for (const tech of ['artillery', 'nuke'] as const) {
          const def = SUPPORT_TECH_TREE[tech];
          grid.appendChild(
            this.buildTechCard({
              icon: tech === 'artillery' ? createUnitIcon('artillery', 'h-5 w-5 shrink-0') : createNukeIcon('h-5 w-5 shrink-0'),
              label: SUPPORT_TECH_LABELS[tech],
              cost: def.cost,
              requiresLabel: def.requires ? SUPPORT_TECH_LABELS[def.requires] : null,
              statsText: SUPPORT_TECH_STATS[tech],
              unlocked: isSupportUnlocked(this.currentGameState, myId, tech),
              prereqMet: !def.requires || isSupportUnlocked(this.currentGameState, myId, def.requires),
              canAfford: points >= def.cost,
              onUnlock: () => this.client.unlockSupportTech(tech),
            }),
          );
        }
      }
    };

    const activateTab = (tab: 'ground' | 'air' | 'support' | 'naval'): void => {
      subTab = tab;
      groundBtn.className = tab === 'ground' ? primaryBtnClass : secondaryBtnClass;
      airBtn.className = tab === 'air' ? primaryBtnClass : secondaryBtnClass;
      supportBtn.className = tab === 'support' ? primaryBtnClass : secondaryBtnClass;
      navalBtn.className = tab === 'naval' ? primaryBtnClass : secondaryBtnClass;
      refresh();
    };
    groundBtn.addEventListener('click', () => activateTab('ground'));
    airBtn.addEventListener('click', () => activateTab('air'));
    supportBtn.addEventListener('click', () => activateTab('support'));
    navalBtn.addEventListener('click', () => activateTab('naval'));

    el.append(subTabRow, grid);
    return { el, refresh };
  }

  private showError(message: string): void {
    this.errorBanner.textContent = message;
    this.errorBanner.classList.remove('hidden');
  }

  /**
   * Diffs `previous` against `next`'s diplomacy state and pushes a notification for anything that
   * just happened TO this player: a new war declared against them, or a new pact offer sent to
   * them. Runs on every render (covering both a direct action and everything an AI cascade did in
   * between two renders), so it catches AI-initiated diplomacy the same way as another human's.
   *
   * War declarations need self-suppression (myRecentWarDeclarations) because engine/diplomacy.ts's
   * relations are keyed by an order-independent pair - the relation itself doesn't record who
   * declared it, so without tracking our own outgoing declareWar calls we'd notify ourselves of our
   * own war. Pact offers don't have this problem: a proposal is keyed "fromId->toId", and a
   * newly-appeared one addressed to *this* player could only ever have been sent by someone else.
   */
  private detectDiplomacyNotifications(previous: GameState, next: GameState): void {
    const myId = this.client.playerId;

    for (const [key, relation] of next.diplomacy.relations) {
      if (!relation.atWar) continue;
      const [a, b] = key.split('|');
      const otherId = a === myId ? b : b === myId ? a : null;
      if (!otherId) continue;
      if (previous.diplomacy.relations.get(key)?.atWar) continue; // already at war, nothing new
      const other = next.players.find((p) => p.id === otherId);
      const name = `${other?.name ?? 'Ein Spieler'}${other?.isAI ? ' (KI)' : ''}`;
      // A war that exists only because an alliance joined it (see engine/diplomacy.ts's
      // propagateAllianceWars) was never declared by or against this pair directly - so it's neither
      // "my own declaration" nor worth phrasing as someone declaring war on me.
      if (relation.viaAlliance) {
        this.pushNotification(`Bündnisfall: Du bist jetzt mit ${name} im Krieg.`, 'war');
        continue;
      }
      if (this.myRecentWarDeclarations.delete(otherId)) continue; // that was my own declaration
      this.pushNotification(`${name} hat dir den Krieg erklärt!`, 'war');
    }

    for (const key of next.diplomacy.pactProposals) {
      if (previous.diplomacy.pactProposals.has(key)) continue;
      const [fromId, toId] = key.split('->');
      if (toId !== myId) continue;
      const from = next.players.find((p) => p.id === fromId);
      const name = `${from?.name ?? 'Ein Spieler'}${from?.isAI ? ' (KI)' : ''}`;
      this.pushNotification(`${name} bietet dir einen Nichtangriffspakt an.`, 'pact');
    }

    // Alliance offers are keyed the same way as pact offers, so a newly-appeared one addressed to
    // this player can likewise only have come from someone else. The other half of the flow - an
    // AI (or another human) taking *my* offer - shows up as the alliance itself appearing while my
    // own offer was still pending in the previous state.
    for (const key of next.diplomacy.allianceProposals) {
      if (previous.diplomacy.allianceProposals.has(key)) continue;
      const [fromId, toId] = key.split('->');
      if (toId !== myId) continue;
      const from = next.players.find((p) => p.id === fromId);
      const name = `${from?.name ?? 'Ein Spieler'}${from?.isAI ? ' (KI)' : ''}`;
      this.pushNotification(`${name} bietet dir eine Allianz an.`, 'pact');
    }
    for (const key of previous.diplomacy.allianceProposals) {
      const [fromId, toId] = key.split('->');
      if (fromId !== myId || !toId) continue;
      if (!areAllied(next, myId, toId) || areAllied(previous, myId, toId)) continue;
      const other = next.players.find((p) => p.id === toId);
      const name = `${other?.name ?? 'Ein Spieler'}${other?.isAI ? ' (KI)' : ''}`;
      this.pushNotification(`${name} hat dein Bündnisangebot angenommen.`, 'pact');
    }
  }

  /** Notifies both battle participants (including the caller themselves) the moment Jäger or CAS
   *  are called into their currently pending battle - "beide Seiten werden darüber informiert".
   *  Dedupes via notifiedAirSupportCallIds (keyed by CalledAircraft.id) rather than diffing
   *  previous/next, since a call-in stays 'incoming' across several renders while it's in transit -
   *  the set is what actually stops it firing more than once, not the diff itself. */
  private detectAirSupportNotifications(previous: GameState, next: GameState): void {
    void previous;
    const pending = next.pendingBattle;
    if (!pending) return;
    const myId = this.client.playerId;
    if (pending.attackerId !== myId && pending.defenderId !== myId) return;

    for (const entry of pending.calledAircraft) {
      if (entry.status !== 'incoming') continue;
      if (this.notifiedAirSupportCallIds.has(entry.id)) continue;
      this.notifiedAirSupportCallIds.add(entry.id);

      const callerId = entry.side === 'attacker' ? pending.attackerId : pending.defenderId;
      const caller = next.players.find((p) => p.id === callerId);
      const name = callerId === myId ? 'Du hast' : `${caller?.name ?? 'Ein Spieler'}${caller?.isAI ? ' (KI)' : ''} hat`;
      const aircraftLabel = entry.type === 'fighter' ? 'Jäger' : 'CAS';
      this.pushNotification(`${name} ${entry.count} ${aircraftLabel} gerufen — Ankunft in ${entry.roundsRemaining} Runde(n).`, 'pact');
    }
  }

  /** A dismissible toast in the top-right corner (see notificationStack) - auto-clears itself after
   *  a while so unread ones don't pile up forever, but can also be closed early. */
  private pushNotification(text: string, accent: 'war' | 'pact'): void {
    const toast = document.createElement('div');
    toast.className =
      accent === 'war'
        ? 'pointer-events-auto flex items-start justify-between gap-2 rounded-md border border-red-700 bg-red-950/90 px-3 py-2 text-sm text-red-100 shadow-lg shadow-slate-950/50'
        : 'pointer-events-auto flex items-start justify-between gap-2 rounded-md border border-sky-700 bg-sky-950/90 px-3 py-2 text-sm text-sky-100 shadow-lg shadow-slate-950/50';

    const textEl = document.createElement('span');
    textEl.textContent = text;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.className = 'shrink-0 text-xs opacity-70 hover:opacity-100';
    closeBtn.addEventListener('click', () => toast.remove());

    toast.append(textEl, closeBtn);
    this.notificationStack.appendChild(toast);
    setTimeout(() => toast.remove(), 10000);
  }

  private setTab(tab: Tab): void {
    this.activeTab = tab;
    this.mapTabBtn.className = tab === 'map' ? primaryBtnClass : secondaryBtnClass;
    this.resourceTabBtn.className = tab === 'resources' ? primaryBtnClass : secondaryBtnClass;
    this.diplomacyTabBtn.className = tab === 'diplomacy' ? primaryBtnClass : secondaryBtnClass;
    this.airforceTabBtn.className = tab === 'airforce' ? primaryBtnClass : secondaryBtnClass;
    this.researchTabBtn.className = tab === 'research' ? primaryBtnClass : secondaryBtnClass;
    this.navalTabBtn.className = tab === 'naval' ? primaryBtnClass : secondaryBtnClass;
    this.map.setSeaInteractive(tab === 'naval');
    this.hint.textContent =
      tab === 'map'
        ? MAP_HINT
        : tab === 'resources'
          ? RESOURCE_HINT
          : tab === 'diplomacy'
            ? DIPLOMACY_HINT
            : tab === 'airforce'
              ? AIRFORCE_HINT
              : tab === 'naval'
                ? NAVAL_HINT
                : RESEARCH_HINT;
    // Research isn't tied to any one territory (unlike the other tabs, which recolor the map) -
    // it replaces the map/move-selection row entirely with its own tech-tree panel instead.
    this.mapRow.classList.toggle('hidden', tab === 'research');
    this.researchPanel.el.classList.toggle('hidden', tab !== 'research');
    this.researchPanel.el.classList.toggle('flex', tab === 'research');
    if (tab === 'map') {
      this.map.applyGameState(this.currentGameState, this.client.playerId);
    } else if (tab === 'resources') {
      this.closeMoveSelection();
      this.map.applyResourceView(this.currentGameState, this.data.territories);
    } else if (tab === 'diplomacy') {
      this.closeMoveSelection();
      this.map.applyDiplomacyView(this.currentGameState, this.client.playerId);
    } else if (tab === 'airforce') {
      this.closeMoveSelection();
      this.map.applyAirforceView(this.currentGameState, this.data.territories, this.client.playerId);
    } else if (tab === 'naval') {
      this.closeMoveSelection();
      this.map.applyNavalView(this.currentGameState, this.client.playerId);
    } else {
      this.closeMoveSelection();
      this.researchPanel.refresh();
    }
  }

  private render(gameState: GameState): void {
    this.detectDiplomacyNotifications(this.currentGameState, gameState);
    this.detectAirSupportNotifications(this.currentGameState, gameState);
    this.currentGameState = gameState;
    if (this.activeTab === 'map') {
      this.map.applyGameState(gameState, this.client.playerId);
    } else if (this.activeTab === 'resources') {
      // Resource values are no longer static (factories change them), so this tab needs to
      // refresh on every state update too, not just when the player switches onto it.
      this.map.applyResourceView(gameState, this.data.territories);
    } else if (this.activeTab === 'diplomacy') {
      // Relations shift mid-game (a war declared, a pact or alliance formed) - refresh live like
      // the other tabs, including the clicked country's ally list/outlines if one is open.
      this.map.applyDiplomacyView(gameState, this.client.playerId);
      if (this.diplomacyFocusOwnerId) this.renderDiplomacyFocus();
    } else if (this.activeTab === 'airforce') {
      // Airfield levels/stationed aircraft (and the Jäger-ratio coloring they drive) change
      // mid-game too - refresh live like the other tabs.
      this.map.applyAirforceView(gameState, this.data.territories, this.client.playerId);
    } else if (this.activeTab === 'naval') {
      this.map.applyNavalView(gameState, this.client.playerId);
    } else {
      // Newly-affordable/unlocked techs change mid-game too - refresh live like the other tabs.
      this.researchPanel.refresh();
    }
    this.currentDevelopmentPanel?.refresh();
    this.currentDiplomacyPanel?.refresh();
    this.currentAirforcePanel?.refresh();

    const activePlayer = gameState.players.find((p) => p.id === gameState.activePlayerId);
    const isMyTurn = gameState.activePlayerId === this.client.playerId;
    const myPoints = gameState.resources.get(this.client.playerId) ?? 0;
    const gameOver = isGameOver(gameState);
    this.turnStatus.textContent = `Runde ${gameState.turn} — ${
      isMyTurn ? 'Du bist am Zug' : `${activePlayer?.name ?? '?'} ist am Zug`
    } — ${myPoints} Rüstungspunkte`;
    this.endTurnBtn.disabled = !isMyTurn || gameState.pendingBattle !== null || gameState.pendingSeaBattle !== null || gameOver;

    this.legend.replaceChildren();
    for (const player of gameState.players) {
      const capital = this.data.territories.find((t) => t.id === player.capitalId);
      const isSelf = player.id === this.client.playerId;
      const eliminated = isEliminated(gameState, player.id);
      const chip = document.createElement(isSelf || eliminated ? 'div' : 'button');
      if (!isSelf && !eliminated) (chip as HTMLButtonElement).type = 'button';
      chip.className =
        'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm' +
        (eliminated ? ' border-slate-800 bg-slate-900 text-slate-500' : ' text-slate-100') +
        (!eliminated && player.id === gameState.activePlayerId ? ' border-amber-400 bg-slate-800' : '') +
        (!eliminated && player.id !== gameState.activePlayerId ? ' border-slate-700 bg-slate-800' : '') +
        (!isSelf && !eliminated ? ' hover:border-amber-500 hover:bg-slate-700' : '');
      const swatch = document.createElement('span');
      swatch.className = 'h-3 w-3 shrink-0 rounded-full' + (eliminated ? ' opacity-40' : '');
      swatch.style.background = player.color;
      const text = document.createElement('span');
      if (eliminated) text.className = 'line-through';
      const suffix = player.isAI ? ' (KI)' : '';
      let relationSuffix = '';
      if (!isSelf && !eliminated) {
        const relation = getRelation(gameState, this.client.playerId, player.id);
        if (relation.atWar) relationSuffix = ' · Krieg';
        else if (relation.allied) relationSuffix = ' · Allianz';
        else if (relation.pact?.active) relationSuffix = ' · Pakt';
      }
      const statusSuffix = eliminated ? ' — ausgeschieden' : relationSuffix;
      text.textContent = `${player.name}${suffix} — ${capital?.name ?? player.capitalId}${statusSuffix}`;
      chip.append(swatch, text);
      if (!isSelf && !eliminated) chip.addEventListener('click', () => this.openDiplomacyMenu(player.id));
      this.legend.appendChild(chip);
    }

    this.renderStatsPanel(gameState);

    if (gameOver) {
      this.turnRow.classList.add('hidden');
      this.battleWaitingBanner.classList.add('hidden');
      this.normalView.classList.add('hidden');
      this.tacticalView.classList.add('hidden');
      this.gameOverView.classList.remove('hidden');
      this.renderGameOverScreen(gameState);
    } else {
      this.turnRow.classList.remove('hidden');
      this.gameOverView.classList.add('hidden');
      this.handlePendingBattle(gameState);
    }
  }

  /** Right below the legend: how many territories each faction currently holds, sorted
   *  most-held-first, as both a proportional bar and an exact count - "wie viele Felder welcher
   *  Farbe gehören". Rebuilt on every state update since ownership changes every turn. */
  private renderStatsPanel(gameState: GameState): void {
    this.statsPanel.replaceChildren();

    const title = document.createElement('div');
    title.className = 'text-center text-xs font-semibold uppercase tracking-wide text-slate-400';
    title.textContent = 'Gebietsverteilung';
    this.statsPanel.appendChild(title);

    const standings = territoryStandings(gameState);
    const total = this.data.territories.length;

    const bar = document.createElement('div');
    bar.className = 'flex h-4 w-full overflow-hidden rounded-full bg-slate-900';
    for (const { player, count } of standings) {
      if (count === 0) continue;
      const segment = document.createElement('div');
      segment.style.width = `${(count / total) * 100}%`;
      segment.style.background = player.color;
      segment.title = `${player.name}: ${count}`;
      bar.appendChild(segment);
    }
    this.statsPanel.appendChild(bar);

    const list = document.createElement('div');
    list.className = 'flex flex-col gap-1 text-sm';
    for (const { player, count } of standings) {
      const eliminated = count === 0;
      const row = document.createElement('div');
      row.className = `flex items-center justify-between gap-2 ${eliminated ? 'text-slate-500' : 'text-slate-200'}`;
      const left = document.createElement('span');
      left.className = 'flex items-center gap-2';
      const swatch = document.createElement('span');
      swatch.className = `h-2.5 w-2.5 shrink-0 rounded-full ${eliminated ? 'opacity-40' : ''}`;
      swatch.style.background = player.color;
      const name = document.createElement('span');
      name.className = eliminated ? 'line-through' : '';
      name.textContent = `${player.name}${player.isAI ? ' (KI)' : ''}`;
      left.append(swatch, name);
      const countEl = document.createElement('span');
      countEl.className = 'tabular-nums';
      countEl.textContent = `${count} / ${total}`;
      row.append(left, countEl);
      list.appendChild(row);
    }
    this.statsPanel.appendChild(list);
  }

  /** The dedicated end-of-game screen (see engine/victory.ts's isGameOver) that fully replaces the
   *  map/tactical views once the game is decided - not a dismissible popup, since the outcome and
   *  its stats stay relevant for as long as anyone's still looking at this session. Rebuilt on
   *  every render so it stays in sync if, e.g., a late-arriving state update changes a stat. */
  private renderGameOverScreen(gameState: GameState): void {
    this.gameOverView.replaceChildren();

    const winner = gameWinner(gameState);
    const lastStanding = remainingPlayers(gameState).length <= 1;
    const viewerEliminated = isEliminated(gameState, this.client.playerId);
    const title = document.createElement('h2');
    title.className = 'mb-1 text-center text-2xl font-bold text-slate-100';
    title.textContent = 'Spiel beendet';
    const subtitle = document.createElement('p');
    subtitle.className = 'mb-6 text-center text-sm font-semibold text-emerald-300';
    const winnerLabel = winner ? `${winner.name}${winner.isAI ? ' (KI)' : ''}` : null;
    subtitle.textContent = !winner
      ? 'Das Spiel ist beendet.'
      : lastStanding
        ? winner.id === this.client.playerId
          ? 'Du hast gewonnen — alle Gegner sind ausgeschieden.'
          : `${winnerLabel} hat gewonnen — alle anderen Fraktionen sind ausgeschieden.`
        : viewerEliminated
          ? `Du bist ausgeschieden — ${winnerLabel} führt zu diesem Zeitpunkt und wird als Sieger gewertet.`
          : `${winnerLabel} wird als Sieger gewertet, nachdem alle menschlichen Spieler ausgeschieden sind.`;
    this.gameOverView.append(title, subtitle);

    const standings = territoryStandings(gameState);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'overflow-x-auto rounded-md border border-slate-700';
    const table = document.createElement('table');
    table.className = 'w-full min-w-[760px] border-collapse text-sm';

    const columns = [
      'Spieler',
      'Gebiete',
      'Truppen',
      'Fabriken',
      'Schlachten gewonnen',
      'Gebiete erobert',
      'Einheiten besiegt',
      'Einheiten verloren',
    ];
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.className = 'bg-slate-800 text-xs uppercase tracking-wide text-slate-400';
    for (const col of columns) {
      const th = document.createElement('th');
      th.className = `px-3 py-2 font-semibold ${col === 'Spieler' ? 'text-left' : 'text-right'}`;
      th.textContent = col;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const { player, count } of standings) {
      const eliminated = count === 0;
      const stats = statsFor(gameState, player.id);
      const troops = totalTroopsFor(gameState, player.id);
      const factories = totalFactoriesFor(gameState, player.id);
      const isWinner = player.id === winner?.id;

      const row = document.createElement('tr');
      row.className =
        `border-t border-slate-800 ${eliminated ? 'text-slate-500' : 'text-slate-200'}` +
        (isWinner ? ' bg-emerald-950/30' : '');

      const nameCell = document.createElement('td');
      nameCell.className = 'flex items-center gap-2 px-3 py-2';
      const swatch = document.createElement('span');
      swatch.className = `h-2.5 w-2.5 shrink-0 rounded-full ${eliminated ? 'opacity-40' : ''}`;
      swatch.style.background = player.color;
      const name = document.createElement('span');
      name.className = eliminated ? 'line-through' : '';
      const suffix = player.isAI ? ' (KI)' : '';
      const selfSuffix = player.id === this.client.playerId ? ' (Du)' : '';
      name.textContent = `${player.name}${suffix}${selfSuffix}`;
      nameCell.append(swatch, name);
      row.appendChild(nameCell);

      const values = [count, troops, factories, stats.battlesWon, stats.territoriesConquered, stats.unitsDefeated, stats.unitsLost];
      for (const value of values) {
        const td = document.createElement('td');
        td.className = 'px-3 py-2 text-right tabular-nums';
        td.textContent = String(value);
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    this.gameOverView.appendChild(tableWrap);
  }

  /** Swaps the whole screen to the zoomed tactical view for whoever's actually fighting. Everyone
   *  else keeps the normal map while deployment is still hidden (nothing meaningful to show yet -
   *  neither side's placement is revealed until both commit), but once the tactical phase begins
   *  - subState is "fully visible to both, and to anyone else watching" per its own doc comment -
   *  they get a live, read-only view of the same grid instead of just a passive banner. */
  private handlePendingBattle(gameState: GameState): void {
    const sea = gameState.pendingSeaBattle;
    if (sea) {
      this.battleWaitingBanner.classList.add('hidden');
      this.normalView.classList.add('hidden');
      this.tacticalView.classList.remove('hidden');
      this.closeMoveSelection();
      renderSeaBattleView(this.tacticalView, {
        pending: sea,
        zoneName: this.data.seaZones.find((z) => z.id === sea.zoneId)?.name ?? sea.zoneId,
        players: gameState.players,
        viewerId: this.client.playerId,
        onDeploy: (cells) => this.client.deploySeaFleet(cells),
        onShoot: (cell) => this.client.seaShoot(cell),
        onCancel: () => this.client.cancelSeaBattle(),
        onProposeSimulation: () => this.client.proposeSeaSimulation(),
        onDeclineSimulation: () => this.client.declineSeaSimulation(),
        primaryBtnClass,
        secondaryBtnClass,
      });
      return;
    }
    const pending = gameState.pendingBattle;
    if (!pending) {
      this.battleWaitingBanner.classList.add('hidden');
      this.normalView.classList.remove('hidden');
      this.tacticalView.classList.add('hidden');
      return;
    }

    const amAttacker = pending.attackerId === this.client.playerId;
    const amDefender = pending.defenderId === this.client.playerId;

    if (amAttacker || amDefender) {
      this.battleWaitingBanner.classList.add('hidden');
      this.normalView.classList.add('hidden');
      this.tacticalView.classList.remove('hidden');
      this.closeMoveSelection();
      this.renderTacticalBattleView(pending);
      return;
    }

    if (pending.subState) {
      this.battleWaitingBanner.classList.add('hidden');
      this.normalView.classList.add('hidden');
      this.tacticalView.classList.remove('hidden');
      this.tacticalView.replaceChildren();
      this.appendBattleHeader(pending);
      this.renderSpectatorView(pending);
      return;
    }

    this.normalView.classList.remove('hidden');
    this.tacticalView.classList.add('hidden');
    const territoryName = this.data.territories.find((t) => t.id === pending.territoryId)?.name ?? pending.territoryId;
    this.battleWaitingBanner.textContent = `Kampf um ${territoryName} läuft...`;
    this.battleWaitingBanner.classList.remove('hidden');
  }

  // ============================== Tactical battle view ==============================

  private appendBattleHeader(pending: PendingBattle): void {
    const territoryName = this.data.territories.find((t) => t.id === pending.territoryId)?.name ?? pending.territoryId;
    const fromName = this.mapName(pending.fromId);
    const attacker = this.currentGameState.players.find((p) => p.id === pending.attackerId);
    const defender = this.currentGameState.players.find((p) => p.id === pending.defenderId);

    const header = document.createElement('div');
    header.className = 'mb-3 text-center';
    const title = document.createElement('h2');
    title.className = 'text-lg font-semibold text-slate-100';
    title.textContent = `Kampf um ${territoryName}`;
    const subtitle = document.createElement('p');
    subtitle.className = 'text-sm text-slate-400';
    subtitle.textContent = `${attacker?.name ?? '?'} (von ${fromName} aus) gegen ${defender?.name ?? '?'}`;
    const mapLine = document.createElement('p');
    mapLine.className = 'text-xs text-slate-500';
    mapLine.textContent = `Schlachtfeld: ${pending.battleMapName}`;
    header.append(title, subtitle, mapLine);
    this.tacticalView.appendChild(header);
  }

  private renderTacticalBattleView(pending: PendingBattle): void {
    this.tacticalView.replaceChildren();
    this.appendBattleHeader(pending);

    if (!pending.subState) {
      this.renderDeploymentPhase(pending);
    } else {
      this.renderMovementPhase(pending);
    }
  }

  /** Read-only view for anyone watching a battle they're not part of: the same live grid and
   *  force sidebar a participant sees, just with no click handlers, no unit-selection panel, and
   *  no end-turn button - nothing here can affect the fight. */
  private renderSpectatorView(pending: PendingBattle): void {
    const subState = pending.subState!;
    const attacker = this.currentGameState.players.find((p) => p.id === pending.attackerId);
    const defender = this.currentGameState.players.find((p) => p.id === pending.defenderId);
    const attackerColor = attacker?.color ?? '#38bdf8';
    const defenderColor = defender?.color ?? '#f87171';

    const statusRow = document.createElement('div');
    statusRow.className =
      'mb-3 flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2';
    const statusText = document.createElement('div');
    statusText.className = 'text-sm text-slate-200';
    const activeName = pending.activeSide === 'attacker' ? attacker?.name : defender?.name;
    statusText.textContent = `Zuschauer-Modus — ${activeName ?? '?'} ist am Zug — Runde ${pending.battleRound}/${MAX_BATTLE_ROUNDS}`;
    statusRow.appendChild(statusText);
    this.tacticalView.appendChild(statusRow);

    const layout = document.createElement('div');
    layout.className = 'flex flex-col gap-4 lg:flex-row';
    this.tacticalView.appendChild(layout);

    const mainCol = document.createElement('div');
    mainCol.className = 'flex flex-1 flex-col gap-3';
    layout.appendChild(mainCol);

    const sumOwnedBy = (ownerId: string): UnitComposition => {
      const items: UnitComposition[] = [];
      for (const s of subState.values()) if (s.ownerId === ownerId) items.push(s.garrison);
      return sumCompositions(items);
    };
    const cities = pending.subTerritories.filter((t) => t.isCity);
    const cityStatus = {
      capturedCities: cities.filter((c) => subState.get(c.id)?.ownerId === pending.attackerId).length,
      totalCities: cities.length,
    };
    const sidebar = this.buildBattleSidebar(
      sumOwnedBy(pending.attackerId),
      sumOwnedBy(pending.defenderId),
      attackerColor,
      defenderColor,
      cityStatus,
    );

    const { grid } = this.buildBattleGrid(pending, {
      getColor: (t) => {
        if (t.isEscape) return ESCAPE_COLOR;
        const state = subState.get(t.id);
        const owner = state ? this.currentGameState.players.find((p) => p.id === state.ownerId) : undefined;
        if (!owner) return '#1e293b';
        return totalUnits(state!.garrison) > 0 ? owner.color : `color-mix(in srgb, ${owner.color} 28%, #0f172a)`;
      },
      getContent: (t): TileContent => {
        if (t.isEscape) return { kind: 'glyph', text: ESCAPE_GLYPH };
        const state = subState.get(t.id);
        if (!state || totalUnits(state.garrison) === 0) return null;
        return { kind: 'composition', total: state.garrison, available: state.garrison };
      },
      isInteractive: () => false,
    });
    mainCol.appendChild(grid);
    layout.append(sidebar.el);

    const legendRow = document.createElement('p');
    legendRow.className = 'mt-3 text-center text-xs text-slate-500';
    legendRow.textContent = 'Du beobachtest diesen Kampf und kannst nicht eingreifen.';
    this.tacticalView.appendChild(legendRow);
  }

  /** Deployment is direct: click your own field to drop one unit of the selected type there,
   *  right-click to take one back. No quantity menu - the field grid *is* the form. */
  private renderDeploymentPhase(pending: PendingBattle): void {
    const amAttacker = pending.attackerId === this.client.playerId;
    const role: 'attacker' | 'defender' | null = amAttacker
      ? 'attacker'
      : pending.defenderId === this.client.playerId
        ? 'defender'
        : null;
    if (!role) return; // shouldn't happen - only participants ever see this view

    const alreadyDeployed = role === 'attacker' ? pending.attackerDeployed : pending.defenderDeployed;
    if (alreadyDeployed) {
      const otherId = role === 'attacker' ? pending.defenderId : pending.attackerId;
      const other = this.currentGameState.players.find((p) => p.id === otherId);
      const note = document.createElement('p');
      note.className = 'text-center text-sm text-slate-400';
      note.textContent = `Aufstellung bestätigt. Warte auf ${other?.name ?? 'den Gegner'}...`;
      this.tacticalView.appendChild(note);
      return;
    }

    const max = role === 'attacker' ? pending.attackerMax : pending.defenderMax;
    const enemyMax = role === 'attacker' ? pending.defenderMax : pending.attackerMax;
    const myColor = this.currentGameState.players.find((p) => p.id === this.client.playerId)?.color ?? '#38bdf8';
    const enemyId = role === 'attacker' ? pending.defenderId : pending.attackerId;
    const enemyColor = this.currentGameState.players.find((p) => p.id === enemyId)?.color ?? '#f87171';

    const placements = new Map<string, UnitComposition>();
    const remaining = { ...max };
    let selectedType: keyof UnitComposition = UNIT_TYPES.find((t) => max[t] > 0) ?? 'infantry';

    const layout = document.createElement('div');
    layout.className = 'flex flex-col gap-4 lg:flex-row';
    this.tacticalView.appendChild(layout);

    const mainCol = document.createElement('div');
    mainCol.className = 'flex flex-1 flex-col gap-3';
    layout.appendChild(mainCol);

    const info = document.createElement('p');
    info.className = 'text-center text-sm text-slate-300';
    info.textContent = 'Klicke auf deine Felder, um Einheiten zu platzieren - Rechtsklick nimmt sie zurück. Shift+Klick platziert bzw. entfernt 10 auf einmal.';
    const cityInfo = document.createElement('p');
    cityInfo.className = 'text-center text-xs text-yellow-400';
    cityInfo.textContent =
      role === 'attacker'
        ? `Gelb umrandete Felder sind Städte - erobere alle 6, um sofort zu gewinnen. Nach Runde ${MAX_BATTLE_ROUNDS} ohne Erfolg gewinnt der Verteidiger automatisch - also nicht zu lange zögern.`
        : `Gelb umrandete Felder sind deine Städte - verliere nicht alle 6, dann gewinnst du automatisch nach Runde ${MAX_BATTLE_ROUNDS}.`;
    mainCol.append(info, cityInfo);

    const toolbar = document.createElement('div');
    toolbar.className = 'flex flex-wrap justify-center gap-2';
    mainCol.appendChild(toolbar);

    const typeButtons = new Map<keyof UnitComposition, { btn: HTMLButtonElement; text: HTMLSpanElement }>();
    function refreshToolbar(): void {
      for (const [type, { btn, text }] of typeButtons) {
        text.textContent = `${UNIT_LABELS[type]}: ${remaining[type]}`;
        btn.className =
          type === selectedType
            ? 'flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-900'
            : 'flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700';
      }
    }
    for (const type of UNIT_TYPES) {
      if (max[type] <= 0) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      const text = document.createElement('span');
      btn.append(createUnitIcon(type), text);
      btn.addEventListener('click', () => {
        selectedType = type;
        refreshToolbar();
      });
      typeButtons.set(type, { btn, text });
      toolbar.appendChild(btn);
    }

    const remainingText = document.createElement('p');
    remainingText.className = 'text-center text-xs text-slate-500';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Aufstellung bestätigen';
    confirmBtn.className = primaryBtnClass;
    confirmBtn.addEventListener('click', () => {
      const placementArray: BattlePlacement[] = [...placements.entries()].map(([subId, amount]) => ({ subId, amount }));
      this.client.deployBattle(placementArray);
    });

    const sidebar = this.buildBattleSidebar(sumCompositions([...placements.values()]), enemyMax, myColor, enemyColor);

    function refreshAll(): void {
      remainingText.textContent = `Verbleibend im Pool: ${describeComposition(remaining)}`;
      confirmBtn.disabled = totalUnits(sumCompositions([...placements.values()])) === 0;
      refreshToolbar();
      sidebar.update(sumCompositions([...placements.values()]), enemyMax);
    }

    const { grid, refreshTile } = this.buildBattleGrid(pending, {
      getColor: (t) => {
        if (t.isEscape) return ESCAPE_COLOR;
        if (t.side !== role) return '#0f172a';
        const amount = placements.get(t.id);
        return amount && totalUnits(amount) > 0 ? myColor : '#334155';
      },
      getContent: (t): TileContent => {
        if (t.isEscape) return { kind: 'glyph', text: ESCAPE_GLYPH };
        if (t.side !== role) return null;
        const amount = placements.get(t.id);
        if (!amount || totalUnits(amount) === 0) return null;
        return { kind: 'composition', total: amount, available: amount };
      },
      isInteractive: (t) => t.side === role && !t.isEscape,
      onClick: (t, shiftKey) => {
        if (t.side !== role || t.isEscape || remaining[selectedType] <= 0) return;
        const step = Math.min(shiftKey ? 10 : 1, remaining[selectedType]);
        remaining[selectedType] -= step;
        const current = placements.get(t.id) ?? emptyComposition();
        placements.set(t.id, { ...current, [selectedType]: current[selectedType] + step });
        refreshTile(t.id);
        refreshAll();
      },
      onRightClick: (t, shiftKey) => {
        if (t.side !== role || t.isEscape) return;
        const current = placements.get(t.id);
        if (!current || current[selectedType] <= 0) return;
        const step = Math.min(shiftKey ? 10 : 1, current[selectedType]);
        const updated = { ...current, [selectedType]: current[selectedType] - step };
        remaining[selectedType] += step;
        if (totalUnits(updated) === 0) placements.delete(t.id);
        else placements.set(t.id, updated);
        refreshTile(t.id);
        refreshAll();
      },
    });
    mainCol.append(grid, remainingText);

    const actions = document.createElement('div');
    actions.className = 'flex justify-center gap-2';
    if (role === 'attacker') {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Angriff abbrechen';
      cancelBtn.className = secondaryBtnClass;
      cancelBtn.addEventListener('click', () => this.client.cancelAttack());
      actions.appendChild(cancelBtn);
    }
    actions.appendChild(confirmBtn);
    mainCol.appendChild(actions);

    layout.appendChild(sidebar.el);
    refreshAll();
  }

  private renderMovementPhase(pending: PendingBattle): void {
    const subState = pending.subState!;
    const amAttacker = pending.attackerId === this.client.playerId;
    const mySide: 'attacker' | 'defender' = amAttacker ? 'attacker' : 'defender';
    const isMyBattleTurn = pending.activeSide === mySide;
    const myId = this.client.playerId;
    const enemyId = mySide === 'attacker' ? pending.defenderId : pending.attackerId;
    const activeName =
      pending.activeSide === 'attacker'
        ? this.currentGameState.players.find((p) => p.id === pending.attackerId)?.name
        : this.currentGameState.players.find((p) => p.id === pending.defenderId)?.name;

    const statusRow = document.createElement('div');
    statusRow.className =
      'mb-3 flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2';
    const statusText = document.createElement('div');
    statusText.className = 'text-sm text-slate-200';
    const turnLabel = isMyBattleTurn ? 'Du bist am Zug (Kampf)' : `${activeName ?? '?'} ist am Zug (Kampf)`;
    statusText.textContent = `${turnLabel} — Runde ${pending.battleRound}/${MAX_BATTLE_ROUNDS} (läuft die Zeit ab, gewinnt der Verteidiger)`;

    const actionBtns = document.createElement('div');
    actionBtns.className = 'flex items-center gap-2';
    const hasAnyAvailableArtillery = [...subState.values()].some(
      (s) => s.ownerId === myId && s.garrison.artillery - s.movedIn.artillery > 0,
    );
    let bombardMode = false;
    const bombardBtn = document.createElement('button');
    bombardBtn.type = 'button';
    bombardBtn.textContent = 'Beschießen';
    bombardBtn.className = `${secondaryBtnClass}${hasAnyAvailableArtillery ? '' : ' hidden'}`;
    bombardBtn.disabled = !isMyBattleTurn;
    const airSupportBtn = document.createElement('button');
    airSupportBtn.type = 'button';
    airSupportBtn.textContent = 'Luftunterstützung';
    airSupportBtn.className = secondaryBtnClass;
    const nukeUnlocked = isSupportUnlocked(this.currentGameState, myId, 'nuke');
    const myPoints = this.currentGameState.resources.get(myId) ?? 0;
    const myNukeStockpile = this.currentGameState.nukeStockpiles.get(myId);
    const nukeBtn = document.createElement('button');
    nukeBtn.type = 'button';
    nukeBtn.textContent = myNukeStockpile !== undefined ? `Atombombe einsetzen (${myNukeStockpile} übrig)` : 'Atombombe einsetzen';
    nukeBtn.className = `${secondaryBtnClass}${nukeUnlocked ? '' : ' hidden'}`;
    nukeBtn.disabled = !isMyBattleTurn || myPoints < NUKE_USE_COST || myNukeStockpile === 0;
    nukeBtn.addEventListener('click', () => this.openNukeConfirm());
    const endBattleTurnBtn = document.createElement('button');
    endBattleTurnBtn.type = 'button';
    endBattleTurnBtn.textContent = 'Kampfzug beenden';
    endBattleTurnBtn.className = primaryBtnClass;
    endBattleTurnBtn.disabled = !isMyBattleTurn;
    endBattleTurnBtn.addEventListener('click', () => this.client.endBattleTurn());
    // Unentschieden: jederzeit in der Kampfphase, unabhängig vom Zug; beide Seiten müssen zustimmen.
    const myDrawOffered = amAttacker ? !!pending.attackerDrawOffer : !!pending.defenderDrawOffer;
    const enemyDrawOffered = amAttacker ? !!pending.defenderDrawOffer : !!pending.attackerDrawOffer;
    const drawBtn = document.createElement('button');
    drawBtn.type = 'button';
    drawBtn.textContent = myDrawOffered ? 'Unentschieden angeboten...' : enemyDrawOffered ? 'Unentschieden annehmen' : 'Unentschieden anbieten';
    drawBtn.className = enemyDrawOffered && !myDrawOffered ? primaryBtnClass : secondaryBtnClass;
    drawBtn.title = 'Beide Seiten müssen zustimmen - die Schlacht endet dann unverändert: keine Gebiete wechseln, der Restbestand beider Seiten bleibt.';
    drawBtn.disabled = myDrawOffered;
    drawBtn.addEventListener('click', () => this.client.proposeBattleDraw());
    actionBtns.append(bombardBtn, airSupportBtn, nukeBtn, drawBtn, endBattleTurnBtn);
    statusRow.append(statusText, actionBtns);
    this.tacticalView.appendChild(statusRow);

    const casArmedBanner = document.createElement('div');
    casArmedBanner.className = 'mb-3 hidden items-center justify-between gap-3 rounded-md border border-purple-700 bg-purple-950/40 px-3 py-2 text-sm text-purple-200';
    const casArmedText = document.createElement('span');
    casArmedText.textContent = 'CAS-Ziel wählen: klicke ein feindliches Feld.';
    const casArmedCancelBtn = document.createElement('button');
    casArmedCancelBtn.type = 'button';
    casArmedCancelBtn.textContent = 'Abbrechen';
    casArmedCancelBtn.className = secondaryBtnClass;
    casArmedBanner.append(casArmedText, casArmedCancelBtn);
    this.tacticalView.appendChild(casArmedBanner);

    const layout = document.createElement('div');
    layout.className = 'flex flex-col gap-4 lg:flex-row';
    this.tacticalView.appendChild(layout);

    const mainCol = document.createElement('div');
    mainCol.className = 'flex flex-1 flex-col gap-3';
    layout.appendChild(mainCol);

    const myColor = this.currentGameState.players.find((p) => p.id === myId)?.color ?? '#38bdf8';
    const enemyColor = this.currentGameState.players.find((p) => p.id === enemyId)?.color ?? '#f87171';

    // --- Vertical Luftüberlegenheit bar, right next to the battlefield ---
    const airSup = battleAirSuperiority(pending);
    const airSupTotal = airSup.attackerFighters + airSup.defenderFighters;
    const myFighterShare = mySide === 'attacker' ? airSup.attackerFighters : airSup.defenderFighters;
    const myFighterPct = airSupTotal > 0 ? Math.round((myFighterShare / airSupTotal) * 100) : 50;

    const airSupCol = document.createElement('div');
    airSupCol.className = 'flex w-16 shrink-0 flex-col items-center gap-1';
    const airSupTitle = document.createElement('span');
    airSupTitle.className = 'text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400';
    airSupTitle.textContent = 'Luftüberlegenheit';
    const airSupTopPct = document.createElement('span');
    airSupTopPct.className = 'text-xs font-semibold text-slate-300';
    airSupTopPct.textContent = airSupTotal > 0 ? `${100 - myFighterPct}%` : '—';
    const airSupBarOuter = document.createElement('div');
    airSupBarOuter.className = 'flex w-5 flex-1 flex-col overflow-hidden rounded-full bg-slate-900';
    const airSupEnemySeg = document.createElement('div');
    airSupEnemySeg.style.height = `${airSupTotal > 0 ? 100 - myFighterPct : 50}%`;
    airSupEnemySeg.style.background = enemyColor;
    const airSupMineSeg = document.createElement('div');
    airSupMineSeg.style.height = `${airSupTotal > 0 ? myFighterPct : 50}%`;
    airSupMineSeg.style.background = myColor;
    airSupBarOuter.append(airSupEnemySeg, airSupMineSeg);
    const airSupBottomPct = document.createElement('span');
    airSupBottomPct.className = 'text-xs font-semibold text-slate-300';
    airSupBottomPct.textContent = airSupTotal > 0 ? `${myFighterPct}%` : '—';
    airSupCol.append(airSupTitle, airSupTopPct, airSupBarOuter, airSupBottomPct);
    layout.appendChild(airSupCol);

    const sumOwnedBy = (ownerId: string): UnitComposition => {
      const items: UnitComposition[] = [];
      for (const s of subState.values()) if (s.ownerId === ownerId) items.push(s.garrison);
      return sumCompositions(items);
    };

    // All 6 cities sit in the defender's (much larger) zone now - one shared count works for
    // both viewers: the attacker watches it climb toward 6, the defender watches it stay at 0.
    const cities = pending.subTerritories.filter((t) => t.isCity);
    const cityStatus = {
      capturedCities: cities.filter((c) => subState.get(c.id)?.ownerId === pending.attackerId).length,
      totalCities: cities.length,
    };
    const sidebar = this.buildBattleSidebar(sumOwnedBy(myId), sumOwnedBy(enemyId), myColor, enemyColor, cityStatus);
    const airStatusPanel = this.buildAirSupportStatusPanel(pending, myId, enemyId, myColor, enemyColor);
    const selectionPanel = this.buildUnitSelectionPanel();

    let selected: string | null = null;
    let casStrikeTarget: CalledAircraft | null = null;
    const neighborsOf = (subId: string): readonly string[] =>
      pending.subTerritories.find((t) => t.id === subId)?.neighbors ?? [];
    const canSelect = (subId: string): boolean => {
      if (!isMyBattleTurn) return false;
      const state = subState.get(subId);
      if (!state || state.ownerId !== myId) return false;
      return totalUnits(state.garrison) - totalUnits(state.movedIn) > 0;
    };
    const availableAt = (subId: string): UnitComposition => {
      const state = subState.get(subId)!;
      return subtractGarrisons(state.garrison, state.movedIn);
    };
    const canSelectForBombard = (subId: string): boolean => canSelect(subId) && availableAt(subId).artillery > 0;
    const isValidBombardTarget = (fromSubId: string, targetSubId: string): boolean => {
      const fromT = pending.subTerritories.find((t) => t.id === fromSubId);
      const targetT = pending.subTerritories.find((t) => t.id === targetSubId);
      if (!fromT || !targetT) return false;
      if (subTerritoryDistance(fromT, targetT) > ARTILLERY_RANGE) return false;
      const targetState = subState.get(targetSubId);
      if (!targetState || targetState.ownerId === myId) return false;
      return targetState.garrison.infantry > 0;
    };
    const isValidCasStrikeTarget = (subId: string): boolean => {
      const state = subState.get(subId);
      if (!state || state.ownerId === myId) return false;
      return totalUnits(state.garrison) > 0;
    };

    let tileEls: Map<string, HTMLDivElement> = new Map();
    function updateHighlights(): void {
      for (const [subId, tile] of tileEls) {
        if (subId === selected) {
          tile.style.boxShadow = 'inset 0 0 0 2px #fbbf24';
        } else if (casStrikeTarget && isValidCasStrikeTarget(subId)) {
          tile.style.boxShadow = 'inset 0 0 0 2px rgba(192,132,252,0.75)';
        } else if (bombardMode && selected && isValidBombardTarget(selected, subId)) {
          tile.style.boxShadow = 'inset 0 0 0 2px rgba(248,113,113,0.75)';
        } else if (!bombardMode && !casStrikeTarget && selected && neighborsOf(selected).includes(subId)) {
          tile.style.boxShadow = 'inset 0 0 0 2px rgba(251,191,36,0.6)';
        } else {
          tile.style.boxShadow = 'none';
        }
      }
    }
    const armCasStrike = (entry: CalledAircraft | null): void => {
      casStrikeTarget = entry;
      casArmedBanner.classList.toggle('hidden', !entry);
      casArmedBanner.classList.toggle('flex', Boolean(entry));
      updateHighlights();
    };
    casArmedCancelBtn.addEventListener('click', () => armCasStrike(null));
    // Shared by the click flow (select a field, then click a neighbor) and the drag flow (press a
    // field, drag straight onto a neighbor) below - both end up moving/attacking the same way.
    const executeMove = (fromSubId: string, toSubId: string, amount: UnitComposition): void => {
      const targetIsEscape = pending.subTerritories.find((t) => t.id === toSubId)?.isEscape ?? false;
      selected = null;
      selectionPanel.hide();
      updateHighlights();
      if (totalUnits(amount) === 0) return;
      if (targetIsEscape) this.openEscapeMenu(pending, fromSubId, amount);
      else this.client.battleMove(fromSubId, toSubId, amount);
    };
    const onTileClick = (subId: string): void => {
      if (casStrikeTarget) {
        if (isValidCasStrikeTarget(subId)) {
          const entryId = casStrikeTarget.id;
          armCasStrike(null);
          this.client.casStrike(entryId, subId);
        }
        return;
      }
      if (selected === subId) {
        selected = null;
        selectionPanel.hide();
        updateHighlights();
        return;
      }
      if (bombardMode) {
        if (selected && isValidBombardTarget(selected, subId)) {
          const fromSubId = selected;
          const artilleryCount = availableAt(fromSubId).artillery;
          selected = null;
          updateHighlights();
          this.client.bombardBattleCell(fromSubId, subId, artilleryCount);
          return;
        }
        selected = canSelectForBombard(subId) ? subId : null;
        updateHighlights();
        return;
      }
      if (selected && neighborsOf(selected).includes(subId)) {
        executeMove(selected, subId, selectionPanel.getSelectedAmount());
        return;
      }
      if (canSelect(subId)) {
        selected = subId;
        selectionPanel.showFor(availableAt(subId));
      } else {
        selected = null;
        selectionPanel.hide();
      }
      updateHighlights();
    };

    bombardBtn.addEventListener('click', () => {
      bombardMode = !bombardMode;
      selected = null;
      selectionPanel.hide();
      armCasStrike(null);
      bombardBtn.className = `${bombardMode ? primaryBtnClass : secondaryBtnClass}${hasAnyAvailableArtillery ? '' : ' hidden'}`;
      updateHighlights();
    });

    airSupportBtn.addEventListener('click', () => {
      bombardMode = false;
      selected = null;
      selectionPanel.hide();
      bombardBtn.className = `${secondaryBtnClass}${hasAnyAvailableArtillery ? '' : ' hidden'}`;
      this.openAirSupportMenu(pending, mySide, (entry) => armCasStrike(entry));
    });

    const { grid, tiles } = this.buildBattleGrid(pending, {
      getColor: (t) => {
        if (t.isEscape) return ESCAPE_COLOR;
        const state = subState.get(t.id);
        const owner = state ? this.currentGameState.players.find((p) => p.id === state.ownerId) : undefined;
        if (!owner) return '#1e293b';
        // Every cell starts "owned" by its starting side even before anyone stands on it - only
        // tint those empty cells faintly, so the full color stays a signal for actual troops.
        return totalUnits(state!.garrison) > 0 ? owner.color : `color-mix(in srgb, ${owner.color} 28%, #0f172a)`;
      },
      getContent: (t): TileContent => {
        if (t.isEscape) return { kind: 'glyph', text: ESCAPE_GLYPH };
        const state = subState.get(t.id);
        if (!state || totalUnits(state.garrison) === 0) return null;
        const available = subtractGarrisons(state.garrison, state.movedIn);
        return { kind: 'composition', total: state.garrison, available };
      },
      // A ready CAS strike may be resolved regardless of whose battle-turn it currently is (the
      // engine doesn't gate casStrike on activeSide either - calling in air support is a standing
      // order, not a battle-turn action) - every other interaction still requires isMyBattleTurn.
      isInteractive: () => isMyBattleTurn || casStrikeTarget !== null,
      onClick: (t) => onTileClick(t.id),
      // Dragging only drives plain movement/attack, same as the main map - bombard and an armed
      // CAS strike stay click-only since their targets aren't limited to neighbors.
      canDrag: (t) => !bombardMode && !casStrikeTarget && canSelect(t.id),
      onDrop: (fromId, toId) => {
        if (!neighborsOf(fromId).includes(toId)) return;
        const amount = selected === fromId ? selectionPanel.getSelectedAmount() : availableAt(fromId);
        executeMove(fromId, toId, amount);
      },
      onDragSettle: () => updateHighlights(),
    });
    tileEls = tiles;
    mainCol.appendChild(grid);
    layout.append(selectionPanel.el, sidebar.el, airStatusPanel);
    updateHighlights();

    const legendRow = document.createElement('p');
    legendRow.className = 'mt-3 text-center text-xs text-slate-500';
    const artilleryHint = hasAnyAvailableArtillery
      ? ` Mit "Beschießen" feuert deine gesamte verfügbare Artillerie eines Feldes auf ein feindliches Feld mit Infanterie bis zu ${ARTILLERY_RANGE} Felder entfernt (rot markiert) - kein Nachbarfeld nötig, aber sie wehrt sich dabei nicht selbst.`
      : '';
    legendRow.textContent =
      `Ziehe ein eigenes Feld mit verfügbaren Einheiten direkt auf ein angrenzendes Ziel (auch diagonal), um es zu bewegen oder anzugreifen - oder klicke es erst an, um rechts einzelne Einheiten abzuwählen, und klicke danach das Ziel.${artilleryHint} Mit "Luftunterstützung" rufst du Jäger oder CAS von Flugplätzen auf dem umkämpften oder einem angrenzenden Gebiet - Jäger kommen nach 1 Runde, CAS nach 3 und darf erst gerufen werden, wenn über 50% der Jäger in der Schlacht deine sind. Die goldenen Felder am oberen und unteren Rand führen zurück auf die Hauptkarte.`;
    this.tacticalView.appendChild(legendRow);
  }

  /** Builds the GRID_SIZE x GRID_SIZE tactical grid once; `refreshTile` re-applies getColor/
   *  getContent for a single cell afterwards, so callers don't have to rebuild all 256+ tiles on
   *  every small change. */
  private buildBattleGrid(
    pending: PendingBattle,
    options: BattleGridOptions,
  ): { grid: HTMLDivElement; tiles: Map<string, HTMLDivElement>; refreshTile: (subId: string) => void } {
    const grid = document.createElement('div');
    grid.className = 'grid gap-px rounded-md bg-slate-950 p-1';
    grid.style.gridTemplateColumns = `repeat(${GRID_SIZE}, minmax(0, 1fr))`;

    const tiles = new Map<string, HTMLDivElement>();
    const byId = new Map<string, BattleSubTerritory>();

    // Drag state for the optional press-drag-release gesture (see canDrag/onDrop on
    // BattleGridOptions) - mirrors MapRenderer's onDragStart/onDragEnd, including why click and
    // drag share one pointerdown/pointerup pair instead of also registering a native 'click'
    // listener: once setPointerCapture is in play, whether a native click still fires afterwards
    // isn't reliably predictable across browsers.
    let dragSourceId: string | null = null;
    let dragEligible = false;
    const tileAtPoint = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y);
      const tileEl = el instanceof HTMLElement ? el.closest<HTMLElement>('[data-sub-id]') : null;
      return tileEl?.dataset.subId ?? null;
    };
    const setDragVisual = (sourceId: string, on: boolean): void => {
      const sourceTile = tiles.get(sourceId);
      if (sourceTile) sourceTile.style.boxShadow = on ? 'inset 0 0 0 2px #fbbf24' : 'none';
      for (const neighborId of byId.get(sourceId)?.neighbors ?? []) {
        const neighborTile = tiles.get(neighborId);
        if (neighborTile) neighborTile.style.boxShadow = on ? 'inset 0 0 0 2px rgba(251,191,36,0.6)' : 'none';
      }
    };

    const refreshTile = (subId: string): void => {
      const t = byId.get(subId);
      const tile = tiles.get(subId);
      if (!t || !tile) return;
      tile.replaceChildren();

      // Terrain is static and identical in every phase, for every viewer - nothing can ever stand
      // on it, so it never asks the phase-specific callbacks what to show.
      if (t.terrain !== 'normal') {
        tile.style.background = TERRAIN_STYLE[t.terrain].background;
        tile.appendChild(createTerrainIcon(t.terrain));
        return;
      }

      tile.style.background = options.getColor(t);
      const content = options.getContent(t);
      if (!content) return;
      if (content.kind === 'glyph') {
        tile.textContent = content.text;
        return;
      }
      for (const type of UNIT_TYPES) {
        const total = content.total[type];
        if (total <= 0) continue;
        const available = content.available[type];
        const row = document.createElement('div');
        row.className = 'flex items-center gap-0.5 leading-none';
        row.append(
          createUnitIcon(type, 'h-3 w-3 shrink-0'),
          document.createTextNode(available < total ? `${available}/${total}` : String(total)),
        );
        tile.appendChild(row);
      }
    };

    for (const t of pending.subTerritories) {
      byId.set(t.id, t);
      const tile = document.createElement('div');
      tile.dataset.subId = t.id;
      const interactive = t.terrain === 'normal' && options.isInteractive(t);
      tile.className = `aspect-square flex flex-col items-center justify-center gap-px overflow-hidden text-[9px] font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] ${interactive ? 'cursor-pointer' : ''}`;
      // A city's objective status is static and permanent, drawn as an outline (not box-shadow,
      // which the movement phase's selection highlight already uses) so both can show at once.
      if (t.isCity) {
        tile.style.outline = '2px solid #fde047';
        tile.style.outlineOffset = '-2px';
      }
      if (t.terrain === 'normal') {
        if (options.canDrag && options.onDrop) {
          tile.addEventListener('pointerdown', (e) => {
            dragSourceId = t.id;
            dragEligible = options.canDrag!(t);
            if (!dragEligible) return;
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            setDragVisual(t.id, true);
          });
          tile.addEventListener('pointerup', (e) => {
            if (!dragSourceId) return;
            const sourceId = dragSourceId;
            const wasEligible = dragEligible;
            if (wasEligible) setDragVisual(sourceId, false);
            const targetId = tileAtPoint(e.clientX, e.clientY);
            dragSourceId = null;
            dragEligible = false;
            if (targetId === sourceId) {
              options.onClick?.(t, e.shiftKey);
            } else if (wasEligible) {
              // Covers both a genuine drop (valid or not - onDrop itself decides) and a release
              // outside any tile (targetId null) - either way, setDragVisual just cleared a ring
              // that may still belong to unrelated persistent state (e.g. a click-selected field
              // being dragged again), so the caller gets a chance to resync via onDragSettle.
              if (targetId) options.onDrop!(sourceId, targetId);
              options.onDragSettle?.();
            }
          });
          tile.addEventListener('pointercancel', () => {
            if (dragSourceId && dragEligible) {
              setDragVisual(dragSourceId, false);
              options.onDragSettle?.();
            }
            dragSourceId = null;
            dragEligible = false;
          });
        } else if (options.onClick) {
          tile.addEventListener('click', (e) => options.onClick!(t, e.shiftKey));
        }
        if (options.onRightClick) {
          tile.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            options.onRightClick!(t, e.shiftKey);
          });
        }
      }
      tiles.set(t.id, tile);
      grid.appendChild(tile);
    }
    for (const id of tiles.keys()) refreshTile(id);

    return { grid, tiles, refreshTile };
  }

  /** Right-edge panel: a pie chart of the overall force ratio, plus a per-type breakdown of
   *  friendly and enemy troops, and (once the battle's underway) the city-objective tally.
   *  `update` lets the caller refresh it as the numbers change. */
  private buildBattleSidebar(
    mine: UnitComposition,
    enemy: UnitComposition,
    myColor: string,
    enemyColor: string,
    cityStatus?: { readonly capturedCities: number; readonly totalCities: number },
  ): { el: HTMLDivElement; update: (mine: UnitComposition, enemy: UnitComposition) => void } {
    const el = document.createElement('div');
    el.className = 'flex w-full shrink-0 flex-col gap-3 rounded-md border border-slate-700 bg-slate-800/60 p-3 lg:w-56';

    if (cityStatus) {
      const cityBox = document.createElement('div');
      cityBox.className = 'rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-slate-200';
      const captured = document.createElement('div');
      captured.className = 'flex justify-between';
      captured.append(
        document.createTextNode('Eroberte Städte'),
        Object.assign(document.createElement('span'), {
          className: 'tabular-nums font-semibold',
          textContent: `${cityStatus.capturedCities}/${cityStatus.totalCities}`,
        }),
      );
      cityBox.appendChild(captured);
      el.appendChild(cityBox);
    }

    const chartTitle = document.createElement('div');
    chartTitle.className = 'text-center text-xs font-semibold uppercase tracking-wide text-slate-400';
    chartTitle.textContent = 'Kräfteverhältnis';

    const chart = document.createElement('div');
    chart.className = 'mx-auto h-28 w-28 rounded-full border border-slate-700';

    const chartLabel = document.createElement('div');
    chartLabel.className = 'text-center text-xs text-slate-400';

    const mineBox = document.createElement('div');
    const enemyBox = document.createElement('div');

    const renderForceBox = (box: HTMLDivElement, title: string, color: string, composition: UnitComposition): void => {
      box.className = 'rounded-md border border-slate-700 bg-slate-900/60 p-2';
      box.replaceChildren();

      const titleRow = document.createElement('div');
      titleRow.className = 'mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-300';
      const swatch = document.createElement('span');
      swatch.className = 'h-2 w-2 shrink-0 rounded-full';
      swatch.style.background = color;
      titleRow.append(swatch, document.createTextNode(title));
      box.appendChild(titleRow);

      for (const type of UNIT_TYPES) {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between text-xs text-slate-400';
        const label = document.createElement('span');
        label.className = 'flex items-center gap-1.5';
        label.append(createUnitIcon(type), document.createTextNode(UNIT_LABELS[type]));
        const value = document.createElement('span');
        value.className = 'tabular-nums text-slate-200';
        value.textContent = String(composition[type]);
        row.append(label, value);
        box.appendChild(row);
      }

      const totalRow = document.createElement('div');
      totalRow.className = 'mt-1 flex justify-between border-t border-slate-700 pt-1 text-xs font-semibold text-slate-200';
      const label = document.createElement('span');
      label.textContent = 'Gesamt';
      const value = document.createElement('span');
      value.className = 'tabular-nums';
      value.textContent = String(totalUnits(composition));
      totalRow.append(label, value);
      box.appendChild(totalRow);
    };

    const update = (nextMine: UnitComposition, nextEnemy: UnitComposition): void => {
      const myStrength = battleStrength(nextMine);
      const enemyStrength = battleStrength(nextEnemy);
      const total = myStrength + enemyStrength;
      const myPercent = total > 0 ? (myStrength / total) * 100 : 50;
      chart.style.background =
        total > 0 ? `conic-gradient(${myColor} 0% ${myPercent}%, ${enemyColor} ${myPercent}% 100%)` : '#334155';
      chartLabel.textContent = total > 0 ? `${myPercent.toFixed(0)}% / ${(100 - myPercent).toFixed(0)}%` : '–';
      renderForceBox(mineBox, 'Eigene Truppen', myColor, nextMine);
      renderForceBox(enemyBox, 'Feindliche Truppen', enemyColor, nextEnemy);
    };

    el.append(chartTitle, chart, chartLabel, mineBox, enemyBox);
    update(mine, enemy);
    return { el, update };
  }

  /** Shows every aircraft tied up in this battle right now, grouped by side: what's already there
   *  (active Jäger in the Luftüberlegenheit pool, 'ready' CAS waiting for a target) and what's
   *  still incoming (with its remaining ETA in rounds) - "welche Flugzeuge gerade da sind und
   *  welche eintreffen werden". calledAircraft is visible to both participants, same as subState,
   *  so both sides' entries are shown, not just the viewer's own. */
  private buildAirSupportStatusPanel(
    pending: PendingBattle,
    myId: string,
    enemyId: string,
    myColor: string,
    enemyColor: string,
  ): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'flex w-full shrink-0 flex-col gap-3 rounded-md border border-slate-700 bg-slate-800/60 p-3 lg:w-56';

    const title = document.createElement('div');
    title.className = 'text-center text-xs font-semibold uppercase tracking-wide text-slate-400';
    title.textContent = 'Luftunterstützung';
    el.appendChild(title);

    const airSup = battleAirSuperiority(pending);
    const sides: readonly { readonly side: 'attacker' | 'defender'; readonly id: string; readonly color: string; readonly label: string }[] = [
      { side: pending.attackerId === myId ? 'attacker' : 'defender', id: myId, color: myColor, label: 'Eigene' },
      { side: pending.attackerId === enemyId ? 'attacker' : 'defender', id: enemyId, color: enemyColor, label: 'Feindliche' },
    ];

    let anyContent = false;
    for (const { side, color, label } of sides) {
      const activeFighters = side === 'attacker' ? airSup.attackerFighters : airSup.defenderFighters;
      const readyCas = pending.calledAircraft.filter((c) => c.side === side && c.type === 'cas' && c.status === 'ready');
      const incoming = pending.calledAircraft.filter((c) => c.side === side && c.status === 'incoming');
      const returning = pending.calledAircraft.filter((c) => c.side === side && c.status === 'returning');
      if (activeFighters === 0 && readyCas.length === 0 && incoming.length === 0 && returning.length === 0) continue;
      anyContent = true;

      const box = document.createElement('div');
      box.className = 'rounded-md border border-slate-700 bg-slate-900/60 p-2 text-xs';
      const titleRow = document.createElement('div');
      titleRow.className = 'mb-1 flex items-center gap-1.5 font-semibold text-slate-300';
      const swatch = document.createElement('span');
      swatch.className = 'h-2 w-2 shrink-0 rounded-full';
      swatch.style.background = color;
      titleRow.append(swatch, document.createTextNode(label));
      box.appendChild(titleRow);

      const addRow = (text: string): void => {
        const row = document.createElement('div');
        row.className = 'text-slate-400';
        row.textContent = text;
        box.appendChild(row);
      };

      if (activeFighters > 0) addRow(`Vor Ort: ${activeFighters} Jäger`);
      for (const entry of readyCas) addRow(`Vor Ort: ${entry.count} CAS (einsatzbereit)`);
      for (const entry of incoming) {
        const typeLabel = entry.type === 'fighter' ? 'Jäger' : 'CAS';
        addRow(`Ankommend: ${entry.count} ${typeLabel} (noch ${entry.roundsRemaining} Runde${entry.roundsRemaining === 1 ? '' : 'n'})`);
      }
      for (const entry of returning) {
        addRow(`Rückflug: ${entry.count} CAS (noch ${entry.roundsRemaining} Runde${entry.roundsRemaining === 1 ? '' : 'n'})`);
      }

      el.appendChild(box);
    }

    if (!anyContent) {
      const none = document.createElement('p');
      none.className = 'text-center text-xs text-slate-500';
      none.textContent = 'Keine Flugzeuge in dieser Schlacht im Einsatz.';
      el.appendChild(none);
    }

    return el;
  }

  /** Right-edge panel that replaces the old quantity-stepper modal: appears once a field with
   *  available units is selected, listing every individual unit there (not just a per-type
   *  count) as a toggleable row - click to include/exclude it from the pending move. Everything
   *  starts checked, so a plain select-then-click-target still sends the whole stack like before;
   *  unchecking some is how you send a partial force. */
  /** A floating drawer, not a layout sibling: fixed to the viewport (top-right) rather than sized
   *  into the surrounding flex row, so opening or closing it never resizes or shifts the map or
   *  the tactical grid next to it - it simply overlays on top, same as a modal. */
  private buildUnitSelectionPanel(options?: { readonly title?: string; readonly hint?: string }): {
    el: HTMLDivElement;
    showFor: (available: UnitComposition) => void;
    hide: () => void;
    getSelectedAmount: () => UnitComposition;
  } {
    const el = document.createElement('div');
    el.className =
      'fixed right-4 top-56 z-30 hidden max-h-[65vh] w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto rounded-md border border-amber-500/50 bg-amber-500/10 p-3 shadow-lg shadow-slate-950/50';

    const title = document.createElement('div');
    title.className = 'text-center text-xs font-semibold uppercase tracking-wide text-amber-400';
    title.textContent = options?.title ?? 'Einheiten auswählen';

    const bulkRow = document.createElement('div');
    bulkRow.className = 'flex gap-1.5';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.textContent = 'Alle auswählen';
    selectAllBtn.className =
      'flex-1 rounded px-1.5 py-1 text-[11px] text-amber-300 bg-amber-500/10 hover:bg-amber-500/20';
    const selectNoneBtn = document.createElement('button');
    selectNoneBtn.type = 'button';
    selectNoneBtn.textContent = 'Alle abwählen';
    selectNoneBtn.className =
      'flex-1 rounded px-1.5 py-1 text-[11px] text-slate-400 bg-slate-900/50 hover:bg-slate-800';
    bulkRow.append(selectAllBtn, selectNoneBtn);

    const list = document.createElement('div');
    list.className = 'flex max-h-64 flex-col gap-1 overflow-y-auto';

    const summary = document.createElement('div');
    summary.className = 'text-center text-xs text-slate-300';

    const hint = document.createElement('p');
    hint.className = 'text-center text-[11px] text-slate-500';
    hint.textContent = options?.hint ?? 'Klicke ein angrenzendes Feld an, um die markierten Einheiten zu bewegen.';

    let units: { readonly key: string; readonly type: keyof UnitComposition }[] = [];
    let selectedKeys = new Set<string>();

    const getSelectedAmount = (): UnitComposition => {
      const amount: Record<keyof UnitComposition, number> = { ...emptyComposition() };
      for (const u of units) if (selectedKeys.has(u.key)) amount[u.type] += 1;
      return amount;
    };

    const refresh = (): void => {
      list.replaceChildren();
      for (const u of units) {
        const isSelected = selectedKeys.has(u.key);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs ${
          isSelected ? 'bg-amber-500/30 text-slate-100' : 'bg-slate-900/50 text-slate-500 line-through'
        }`;
        row.append(createUnitIcon(u.type, 'h-4 w-4 shrink-0'), document.createTextNode(UNIT_LABELS[u.type]));
        row.addEventListener('click', () => {
          if (isSelected) selectedKeys.delete(u.key);
          else selectedKeys.add(u.key);
          refresh();
        });
        list.appendChild(row);
      }
      const amount = getSelectedAmount();
      summary.textContent = `Ausgewählt: ${describeComposition(amount)} (Stärke ${battleStrength(amount).toFixed(1)})`;
    };

    const showFor = (available: UnitComposition): void => {
      units = UNIT_TYPES.flatMap((type) =>
        Array.from({ length: available[type] }, (_, i) => ({ key: `${type}-${i}`, type })),
      );
      selectedKeys = new Set(units.map((u) => u.key));
      refresh();
      el.classList.remove('hidden');
      el.classList.add('flex');
    };

    const hide = (): void => {
      el.classList.add('hidden');
      el.classList.remove('flex');
    };

    selectAllBtn.addEventListener('click', () => {
      selectedKeys = new Set(units.map((u) => u.key));
      refresh();
    });
    selectNoneBtn.addEventListener('click', () => {
      selectedKeys = new Set();
      refresh();
    });

    el.append(title, bulkRow, list, summary, hint);
    return { el, showFor, hide, getSelectedAmount };
  }

  /** Opens from the tactical battle's "Luftunterstützung" button: call Jäger or CAS from an
   *  eligible Flugplatz (the contested territory itself, or one of its main-map neighbors - see
   *  engine/combat.ts's callAirSupport) into the battle, and - once any of my own CAS has arrived
   *  and is 'ready' - arm one for a strike (closes this modal and hands off to onArmCasStrike,
   *  which lets the caller put the tactical grid into target-picking mode). */
  private openAirSupportMenu(
    pending: PendingBattle,
    mySide: 'attacker' | 'defender',
    onArmCasStrike: (entry: CalledAircraft) => void,
  ): void {
    const myId = this.client.playerId;
    const { card, close } = this.openModal('Luftunterstützung');

    const contested = this.data.territories.find((t) => t.id === pending.territoryId);
    const eligibleIds = [pending.territoryId, ...(contested?.neighbors ?? [])];
    const eligibleSources = eligibleIds
      .map((id) => ({ id, name: this.data.territories.find((t) => t.id === id)?.name ?? id, state: this.currentGameState.territoryState.get(id) }))
      .filter((x) => x.state?.ownerId === myId)
      .map((x) => ({ id: x.id, name: x.name, airfield: airfieldAt(this.currentGameState, x.id) }))
      .filter((x) => x.airfield.level > 0);

    if (eligibleSources.length === 0) {
      const none = document.createElement('p');
      none.className = 'text-sm text-amber-400';
      none.textContent = 'Kein eigener Flugplatz auf dem umkämpften oder einem angrenzenden Gebiet.';
      card.appendChild(none);
    }

    let sourceId: string | null = eligibleSources[0]?.id ?? null;
    if (eligibleSources.length > 1) {
      const sourceList = document.createElement('div');
      sourceList.className = 'flex flex-col gap-1';
      const sourceButtons = new Map<string, HTMLButtonElement>();
      const refreshSourceButtons = (): void => {
        for (const [id, btn] of sourceButtons) {
          btn.className =
            id === sourceId
              ? 'rounded-md border border-amber-400 bg-amber-500/20 px-3 py-1.5 text-left text-sm text-slate-100'
              : 'rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800';
        }
      };
      for (const src of eligibleSources) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = src.name;
        btn.addEventListener('click', () => {
          sourceId = src.id;
          refreshSourceButtons();
          refresh();
        });
        sourceButtons.set(src.id, btn);
        sourceList.appendChild(btn);
      }
      refreshSourceButtons();
      card.appendChild(sourceList);
    }

    const fighterInfo = document.createElement('p');
    fighterInfo.className = 'text-xs text-slate-400';
    const fighterStepperHolder = document.createElement('div');
    let fighterCount = 0;
    const { row: fighterRow, refresh: refreshFighterStepper } = this.createAircraftStepperRow(
      'Jäger rufen',
      0,
      () => {
        const airfield = sourceId ? airfieldAt(this.currentGameState, sourceId) : null;
        return Boolean(airfield && fighterCount < airfield.aircraft.fighters);
      },
      (value) => {
        fighterCount = value;
        refresh();
      },
    );
    fighterStepperHolder.appendChild(fighterRow);
    const callFighterBtn = document.createElement('button');
    callFighterBtn.type = 'button';
    callFighterBtn.textContent = 'Jäger rufen (Ankunft in 1 Runde)';
    callFighterBtn.className = `${secondaryBtnClass} w-full`;
    callFighterBtn.addEventListener('click', () => {
      if (!sourceId || fighterCount <= 0) return;
      this.client.callAirSupport('fighter', sourceId, fighterCount);
      fighterCount = 0;
      refresh();
    });

    const casInfo = document.createElement('p');
    casInfo.className = 'text-xs text-slate-400';
    let casCount = 0;
    const { row: casRow, refresh: refreshCasStepper } = this.createAircraftStepperRow(
      'CAS rufen',
      0,
      () => {
        const airfield = sourceId ? airfieldAt(this.currentGameState, sourceId) : null;
        return Boolean(airfield && casCount < airfield.aircraft.cas);
      },
      (value) => {
        casCount = value;
        refresh();
      },
    );
    const callCasBtn = document.createElement('button');
    callCasBtn.type = 'button';
    callCasBtn.textContent = 'CAS rufen (Ankunft in 3 Runden)';
    callCasBtn.className = `${secondaryBtnClass} w-full`;
    callCasBtn.addEventListener('click', () => {
      if (!sourceId || casCount <= 0) return;
      this.client.callAirSupport('cas', sourceId, casCount);
      casCount = 0;
      refresh();
    });

    const readySection = document.createElement('div');
    readySection.className = 'flex flex-col gap-1';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Schließen';
    closeBtn.className = `${secondaryBtnClass} w-full`;
    closeBtn.addEventListener('click', () => close());

    const refresh = (): void => {
      const airfield = sourceId ? airfieldAt(this.currentGameState, sourceId) : null;
      fighterInfo.textContent = airfield ? `Verfügbare Jäger: ${airfield.aircraft.fighters}` : '';
      casInfo.textContent = airfield ? `Verfügbare CAS: ${airfield.aircraft.cas}` : '';
      refreshFighterStepper();
      refreshCasStepper();
      callFighterBtn.disabled = !sourceId || fighterCount <= 0;

      const pendingNow = this.currentGameState.pendingBattle;
      const sup = pendingNow ? battleAirSuperiority(pendingNow) : { attackerFighters: 0, defenderFighters: 0 };
      const mine = mySide === 'attacker' ? sup.attackerFighters : sup.defenderFighters;
      const total = sup.attackerFighters + sup.defenderFighters;
      const hasAirSuperiority = total > 0 && mine / total > CAS_MIN_AIR_SUPERIORITY;
      callCasBtn.disabled = !sourceId || casCount <= 0 || !hasAirSuperiority;
      casInfo.textContent += hasAirSuperiority
        ? ''
        : ' — CAS erst einsetzbar, wenn über 50% der Jäger in der Schlacht deine sind.';

      readySection.replaceChildren();
      const myReadyCas = (pendingNow?.calledAircraft ?? []).filter((c) => c.type === 'cas' && c.status === 'ready' && c.side === mySide);
      if (myReadyCas.length > 0) {
        const title = document.createElement('p');
        title.className = 'text-xs font-semibold uppercase tracking-wide text-slate-400';
        title.textContent = 'Einsatzbereite CAS';
        readySection.appendChild(title);
        for (const entry of myReadyCas) {
          const row = document.createElement('div');
          row.className = 'flex items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-900/60 p-2';
          const label = document.createElement('span');
          label.className = 'text-xs text-slate-300';
          label.textContent = `${entry.count} CAS bereit`;
          const strikeBtn = document.createElement('button');
          strikeBtn.type = 'button';
          strikeBtn.textContent = 'Ziel wählen';
          strikeBtn.className = secondaryBtnClass;
          strikeBtn.addEventListener('click', () => {
            close();
            onArmCasStrike(entry);
          });
          row.append(label, strikeBtn);
          readySection.appendChild(row);
        }
      }
    };

    card.append(fighterInfo, fighterStepperHolder, callFighterBtn, casInfo, casRow, callCasBtn, readySection, closeBtn);
    refresh();
  }

  /** Opens when a player moves units from a sub-territory adjacent to the escape row onto that
   *  row: instead of occupying it, those units leave the tactical battle entirely and land on a
   *  chosen neighbor of the contested territory on the main map. `amount` was already chosen via
   *  the unit-selection panel - this modal only picks the destination. */
  private openEscapeMenu(pending: PendingBattle, fromSubId: string, amount: UnitComposition): void {
    const battleTerritory = this.data.territories.find((t) => t.id === pending.territoryId);
    const candidates = (battleTerritory?.neighbors ?? []).map((id) => {
      const territory = this.data.territories.find((t) => t.id === id);
      const state = this.currentGameState.territoryState.get(id);
      const defended =
        !!state &&
        state.ownerId !== null &&
        state.ownerId !== this.client.playerId &&
        !areAllied(this.currentGameState, this.client.playerId, state.ownerId) &&
        totalUnits(defenderForce(state)) > 0;
      const owner = state?.ownerId ? this.currentGameState.players.find((p) => p.id === state.ownerId) : undefined;
      return { id, name: territory?.name ?? id, defended, ownerName: owner?.name ?? null };
    });

    let destinationId: string | null = candidates.find((c) => !c.defended)?.id ?? null;

    const { card, close } = this.openModal('Vom Schlachtfeld fliehen');

    const info = document.createElement('p');
    info.className = 'text-xs text-slate-400';
    info.textContent = `${describeComposition(amount)} verlassen den Kampf und ziehen auf ein angrenzendes Gebiet der Hauptkarte.`;
    card.appendChild(info);

    const destList = document.createElement('div');
    destList.className = 'flex flex-col gap-1.5';
    card.appendChild(destList);

    if (candidates.length === 0 || candidates.every((c) => c.defended)) {
      const none = document.createElement('p');
      none.className = 'text-xs text-amber-400';
      none.textContent = 'Kein Fluchtweg verfügbar - alle Nachbargebiete sind verteidigt.';
      destList.appendChild(none);
    }

    const destButtons = new Map<string, HTMLButtonElement>();
    const refreshDestButtons = (): void => {
      for (const [id, btn] of destButtons) {
        btn.className =
          id === destinationId
            ? 'rounded-md border border-amber-400 bg-amber-500/20 px-3 py-1.5 text-left text-sm text-slate-100'
            : 'rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800';
      }
    };
    for (const candidate of candidates) {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (candidate.defended) {
        btn.disabled = true;
        btn.className = 'rounded-md border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-left text-sm text-slate-600';
        btn.textContent = `${candidate.name} (verteidigt von ${candidate.ownerName ?? 'jemandem'})`;
      } else {
        btn.textContent = candidate.ownerName ? `${candidate.name} (${candidate.ownerName})` : `${candidate.name} (neutral)`;
        btn.addEventListener('click', () => {
          destinationId = candidate.id;
          refreshDestButtons();
          updateConfirmState();
        });
        destButtons.set(candidate.id, btn);
      }
      destList.appendChild(btn);
    }
    refreshDestButtons();

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Fliehen';
    confirmBtn.className = primaryBtnClass;
    confirmBtn.addEventListener('click', () => {
      if (!destinationId) return;
      this.client.escapeBattle(fromSubId, destinationId, amount);
      close();
    });

    const updateConfirmState = (): void => {
      confirmBtn.disabled = !destinationId;
    };
    updateConfirmState();

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

  /** Confirmation gate in front of GameClient.useNuke() - the one battle action that destroys the
   *  caller's own units too, so it gets a dedicated "are you sure" modal instead of firing
   *  straight off the button click like bombardBattleCell/moveBattleUnits do. */
  private openNukeConfirm(): void {
    const { card, close } = this.openModal('Atombombe einsetzen?');
    const stockpile = this.currentGameState.nukeStockpiles.get(this.client.playerId);
    const warning = document.createElement('p');
    warning.className = 'text-sm text-slate-200';
    warning.textContent =
      `Zerstört sofort ALLE Einheiten in dieser Schlacht - auch deine eigenen - und beendet den Kampf ohne Sieger. ` +
      `Kostet ${NUKE_USE_COST} Rüstungspunkte.` +
      (stockpile !== undefined ? ` Verbraucht 1 von ${stockpile} verbleibenden Sprengköpfen.` : '') +
      ` Das kann nicht rückgängig gemacht werden.`;
    card.appendChild(warning);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.className = secondaryBtnClass;
    cancelBtn.addEventListener('click', () => close());

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Abwerfen';
    confirmBtn.className = primaryBtnClass;
    confirmBtn.addEventListener('click', () => {
      this.client.useNuke();
      close();
    });

    const actions = document.createElement('div');
    actions.className = 'flex justify-end gap-2 pt-2';
    actions.append(cancelBtn, confirmBtn);
    card.appendChild(actions);
  }

  /** A lightweight "the battle is over" notice - the fight itself was watched live on the
   *  tactical map, so this is just the final tally, not a replay. */
  private showBattleConcluded(battle: BattleResult | SeaBattleResult): void {
    const territoryName = this.mapName(battle.territoryId);
    const attacker = this.currentGameState.players.find((p) => p.id === battle.attackerId);
    const defender = this.currentGameState.players.find((p) => p.id === battle.defenderId);

    if ('sea' in battle) {
      const { card, close } = this.openModal(`Seeschlacht um ${territoryName} entschieden`);
      const text = document.createElement('p');
      text.className = 'text-sm font-semibold text-slate-100';
      text.textContent = battle.attackerWon
        ? `${attacker?.name ?? 'Der Angreifer'} hat die Flotte von ${defender?.name ?? 'dem Verteidiger'} versenkt und besetzt ${territoryName}!`
        : `${defender?.name ?? 'Der Verteidiger'} hat den Angriff von ${attacker?.name ?? 'dem Angreifer'} abgewehrt und hält ${territoryName}!`;
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Schließen';
      closeBtn.className = primaryBtnClass;
      closeBtn.addEventListener('click', () => close());
      const actions = document.createElement('div');
      actions.className = 'flex justify-end pt-2';
      actions.appendChild(closeBtn);
      card.append(text, actions);
      return;
    }

    const { card, close } = this.openModal(`Kampf um ${territoryName} ${battle.draw ? 'beendet' : 'entschieden'}`);
    const verdict = document.createElement('p');
    verdict.className = 'text-sm font-semibold text-slate-100';
    verdict.textContent = battle.draw
      ? `Unentschieden: ${attacker?.name ?? 'Der Angreifer'} und ${defender?.name ?? 'der Verteidiger'} haben den Kampf um ${territoryName} beendet - kein Gebiet wechselt den Besitzer, alle verbleibenden Einheiten bleiben erhalten.`
      : battle.nuked
      ? `Eine Atombombe hat alle Streitkräfte von ${attacker?.name ?? 'dem Angreifer'} und ${defender?.name ?? 'dem Verteidiger'} in ${territoryName} ausgelöscht - niemand hat das Gebiet erobert.`
      : battle.attackerWon
        ? `${attacker?.name ?? 'Der Angreifer'} hat ${defender?.name ?? 'den Verteidiger'} besiegt und erobert ${territoryName}!`
        : `${defender?.name ?? 'Der Verteidiger'} hat den Angriff von ${attacker?.name ?? 'dem Angreifer'} abgewehrt!`;
    card.appendChild(verdict);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Schließen';
    closeBtn.className = primaryBtnClass;
    closeBtn.addEventListener('click', () => close());

    const actions = document.createElement('div');
    actions.className = 'flex justify-end pt-2';
    actions.appendChild(closeBtn);
    card.appendChild(actions);
  }

  // ============================== Shared modal helpers ==============================

  /** Backdrop + card shell shared by every modal. */
  private openModal(title: string, onClose?: () => void): { card: HTMLDivElement; close: () => void } {
    const backdrop = document.createElement('div');
    backdrop.className = 'fixed inset-0 z-20 flex items-center justify-center bg-slate-950/70 p-4';
    // Routes both the returned close() and a backdrop click through the same path, so a caller's
    // onClose (e.g. clearing a tracked "this modal is open" reference) fires either way.
    const close = (): void => {
      backdrop.remove();
      onClose?.();
    };
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

  /** Opens when dropping onto a defended enemy territory: choose between the full tactical battle
   *  (deployment + the zoomed sub-map) and an instant random simulation. */
  private openAttackChoiceMenu(fromId: string, toId: string): void {
    const fromName = this.data.territories.find((t) => t.id === fromId)?.name ?? fromId;
    const toName = this.data.territories.find((t) => t.id === toId)?.name ?? toId;
    const { card, close } = this.openModal(`${fromName} → ${toName}`);

    const info = document.createElement('p');
    info.className = 'text-sm text-slate-300';
    info.textContent = 'Wie möchtest du angreifen?';
    card.appendChild(info);

    // Sieg-Chance bei Simulation: exactly simulateAttack's own formula (engine/combat.ts) -
    // attackerStrength / (attackerStrength + defenderStrength * SIMULATED_DEFENSE_MULTIPLIER) -
    // using the same available-to-move force the simulation would actually commit. Only meaningful
    // for the simulate option; the tactical battle is played out by hand, not rolled.
    const fromState = this.currentGameState.territoryState.get(fromId);
    const fromStack = fromState ? stackOf(fromState, this.client.playerId) : null;
    const toState = this.currentGameState.territoryState.get(toId);
    const attackerStrength = fromStack ? battleStrength(availableToMove(fromStack)) : 0;
    // The whole defending force: the owner's garrison plus any allied guests standing with it.
    const defenderStrength = toState ? battleStrength(defenderForce(toState)) * SIMULATED_DEFENSE_MULTIPLIER : 0;
    const totalStrength = attackerStrength + defenderStrength;
    const winChance = totalStrength > 0 ? attackerStrength / totalStrength : 0;
    const winPercent = Math.round(winChance * 100);

    const chanceWrap = document.createElement('div');
    chanceWrap.className = 'flex flex-col gap-1';
    const chanceLabel = document.createElement('div');
    chanceLabel.className = 'flex items-center justify-between text-xs text-slate-400';
    const chanceLabelText = document.createElement('span');
    chanceLabelText.textContent = 'Sieg-Chance bei Simulation';
    const chanceValue = document.createElement('span');
    chanceValue.className = 'font-semibold text-slate-200';
    chanceValue.textContent = `${winPercent}%`;
    chanceLabel.append(chanceLabelText, chanceValue);

    const chanceBarBg = document.createElement('div');
    chanceBarBg.className = 'h-2.5 w-full overflow-hidden rounded-full bg-slate-900';
    const chanceBarFill = document.createElement('div');
    chanceBarFill.className = 'h-full rounded-full transition-[width]';
    chanceBarFill.style.width = `${winPercent}%`;
    chanceBarFill.style.background = winChance >= 0.5 ? '#16a34a' : winChance >= 0.25 ? '#eab308' : '#dc2626';
    chanceBarBg.appendChild(chanceBarFill);

    chanceWrap.append(chanceLabel, chanceBarBg);
    card.appendChild(chanceWrap);

    const tacticalBtn = document.createElement('button');
    tacticalBtn.type = 'button';
    tacticalBtn.textContent = 'Taktische Schlacht';
    tacticalBtn.className = primaryBtnClass;
    tacticalBtn.addEventListener('click', () => {
      this.client.attack(fromId, toId);
      close();
    });

    const simulateBtn = document.createElement('button');
    simulateBtn.type = 'button';
    simulateBtn.textContent = 'Angriff simulieren';
    simulateBtn.className = secondaryBtnClass;
    simulateBtn.addEventListener('click', () => {
      this.client.simulateAttack(fromId, toId);
      close();
    });

    const note = document.createElement('p');
    note.className = 'text-xs text-slate-500';
    note.textContent = 'Simulation: sofortiges Zufallsergebnis ohne taktische Karte - der Verteidiger zählt dabei doppelte Stärke.';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.className = secondaryBtnClass;
    cancelBtn.addEventListener('click', () => close());

    const choices = document.createElement('div');
    choices.className = 'flex flex-col gap-2';
    choices.append(tacticalBtn, simulateBtn);

    const actions = document.createElement('div');
    actions.className = 'flex justify-end pt-1';
    actions.appendChild(cancelBtn);

    card.append(choices, note, actions);
  }

  /** Click on an owned, available territory: opens the unit-selection panel at the screen edge
   *  (same table as the tactical grid) instead of jumping straight to recruiting. Dragging that
   *  same territory afterward sends whatever's checked; recruiting now lives behind its own
   *  button next to the table. Clicking the already-selected territory again closes it. */
  /** Name eines Land- oder Seegebiets. */
  private mapName(id: string): string {
    return this.data.territories.find((t) => t.id === id)?.name ?? this.data.seaZones.find((z) => z.id === id)?.name ?? id;
  }

  private handleTerritoryClick(territoryId: string): void {
    if (this.currentGameState.pendingBattle || this.currentGameState.pendingSeaBattle) return;
    if (isGameOver(this.currentGameState)) return;
    if (this.activeTab === 'resources') {
      this.handleResourceTerritoryClick(territoryId);
      return;
    }
    if (this.activeTab === 'airforce') {
      this.handleAirforceTerritoryClick(territoryId);
      return;
    }
    if (this.activeTab === 'diplomacy') {
      this.handleDiplomacyTerritoryClick(territoryId);
      return;
    }
    if (this.activeTab === 'naval') {
      this.handleNavalClick(territoryId);
      return;
    }
    if (this.activeTab !== 'map') return;
    const state = this.currentGameState.territoryState.get(territoryId);
    // Either the player's own territory or one of an ally's where their units are stationed.
    const stack = state ? stackOf(state, this.client.playerId) : null;
    if (!state || !stack) return;
    if (this.currentGameState.activePlayerId !== this.client.playerId) return;

    if (this.selectedMoveSourceId === territoryId) {
      this.closeMoveSelection();
      return;
    }

    const isGuest = state.ownerId !== this.client.playerId;
    this.selectedMoveSourceId = territoryId;
    this.map.setSelectedTerritory(territoryId);
    const territoryName = this.data.territories.find((t) => t.id === territoryId)?.name ?? territoryId;
    const panel = this.buildUnitSelectionPanel({
      title: isGuest ? `${territoryName} (bei Verbündeten)` : territoryName,
      hint: isGuest
        ? 'Deine Einheiten stehen hier als Gast. Ziehe dieses Gebiet auf ein angrenzendes Ziel, um die markierten Einheiten zu bewegen oder anzugreifen.'
        : 'Ziehe dieses Gebiet auf ein angrenzendes Ziel, um die markierten Einheiten zu bewegen oder anzugreifen.',
    });
    panel.showFor(availableToMove(stack));
    this.currentMoveSelectionPanel = panel;

    if (!isGuest) {
      const recruitBtn = document.createElement('button');
      recruitBtn.type = 'button';
      recruitBtn.textContent = 'Hier rekrutieren';
      recruitBtn.className = `${secondaryBtnClass} w-full`;
      recruitBtn.addEventListener('click', () => this.openRecruitMenu(territoryId));
      panel.el.appendChild(recruitBtn);
    }

    this.moveSelectionSlot.replaceChildren(panel.el);
  }

  /**
   * Marine-Tab, Klick - wie der Klick auf ein Gebiet im Karten-Tab: öffnet das Auswahl-Panel mit den verfügbaren Schiffen
   * (und den Landeinheiten, die dort ein-/ausgeschifft werden können) als einzeln abwählbare Zeilen. Eigene
   * Küstengebiete haben zusätzlich "Hier Schiffe bauen". Danach das Gebiet auf ein angrenzendes Ziel ziehen
   * (handleNavalDrop). Erneutes Klicken schließt das Panel.
   */
  private handleNavalClick(id: string): void {
    const gs = this.currentGameState;
    const me = this.client.playerId;
    const zones = this.data.seaZones;
    if (gs.activePlayerId !== me) return;
    if (this.selectedMoveSourceId === id) {
      this.closeMoveSelection();
      return;
    }
    const isZone = isSeaZoneId(zones, id);
    const st = gs.territoryState.get(id);
    const ownPort = !isZone && !!st && st.ownerId === me && isCoastal(id, zones);
    if (!isZone && !ownPort) return;
    const ships = availableShips(gs, me, id, zones);
    let units = emptyComposition();
    if (isZone) {
      const z = seaStateOf(gs, id);
      if (z.ownerId !== me) return;
      units = subtractGarrisons(z.embarked, z.embarkedMovedIn);
    } else {
      const stack = stackOf(st!, me);
      if (stack) units = availableToMove(stack);
    }

    this.closeMoveSelection();
    this.selectedMoveSourceId = id;
    this.map.setSelectedTerritory(id);
    const panel = this.buildNavalSelectionPanel(this.mapName(id), ships, units, ownPort);
    this.currentNavalPanel = panel;
    if (ownPort) {
      const recruitBtn = document.createElement('button');
      recruitBtn.type = 'button';
      recruitBtn.textContent = 'Hier Schiffe bauen';
      recruitBtn.className = `${secondaryBtnClass} w-full`;
      recruitBtn.addEventListener('click', () => this.openShipRecruitMenu(id));
      panel.el.appendChild(recruitBtn);
    }
    this.moveSelectionSlot.replaceChildren(panel.el);
  }

  /**
   * Das Auswahl-Panel des Marine-Tabs (gleiche Gestalt wie buildUnitSelectionPanel): zuerst die verfügbaren Schiffe, dann
   * die Landeinheiten, jeweils als einzeln an-/abwählbare Zeilen. Alles startet ausgewählt.
   */
  private buildNavalSelectionPanel(
    title: string,
    ships: number,
    units: UnitComposition,
    isPort: boolean,
  ): { el: HTMLDivElement; getSelection: () => { readonly ships: number; readonly units: UnitComposition } } {
    const el = document.createElement('div');
    el.className =
      'fixed right-4 top-56 z-30 flex max-h-[65vh] w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto rounded-md border border-amber-500/50 bg-amber-500/10 p-3 shadow-lg shadow-slate-950/50';
    const titleEl = document.createElement('div');
    titleEl.className = 'text-center text-xs font-semibold uppercase tracking-wide text-amber-400';
    titleEl.textContent = title;

    type Row = { readonly key: string; readonly kind: 'ship' | keyof UnitComposition };
    const rows: Row[] = [
      ...Array.from({ length: ships }, (_, i): Row => ({ key: `ship-${i}`, kind: 'ship' })),
      ...UNIT_TYPES.flatMap((type) => Array.from({ length: units[type] }, (_, i): Row => ({ key: `${type}-${i}`, kind: type }))),
    ];
    let selected = new Set(rows.map((r) => r.key));
    const list = document.createElement('div');
    list.className = 'flex max-h-64 flex-col gap-1 overflow-y-auto';
    const summary = document.createElement('div');
    summary.className = 'text-center text-xs text-slate-300';
    const hint = document.createElement('p');
    hint.className = 'text-center text-[11px] text-slate-500';
    hint.textContent = isPort
      ? 'Ziehe das Gebiet auf eine angrenzende Seezone: markierte Schiffe fahren, markierte Landeinheiten werden eingeschifft (nur in einer alleinig besetzten Zone mit eigenem Schiff).'
      : 'Ziehe die Zone auf eine andere Zone (Schiffe verlegen, feindliche Zone = Seeschlacht) oder auf ein Küstengebiet (Truppen ausschiffen, Schiffe einlaufen; verteidigtes Feindgebiet = Landungsangriff).';

    const selection = (): { ships: number; units: UnitComposition } => {
      const u: Record<keyof UnitComposition, number> = { ...emptyComposition() };
      let n = 0;
      for (const r of rows) {
        if (!selected.has(r.key)) continue;
        if (r.kind === 'ship') n += 1;
        else u[r.kind] += 1;
      }
      return { ships: n, units: u };
    };
    const refresh = (): void => {
      list.replaceChildren();
      for (const r of rows) {
        const on = selected.has(r.key);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs ${on ? 'bg-amber-500/30 text-slate-100' : 'bg-slate-900/50 text-slate-500 line-through'}`;
        row.append(r.kind === 'ship' ? createShipIcon('h-4 w-4 shrink-0') : createUnitIcon(r.kind, 'h-4 w-4 shrink-0'), document.createTextNode(r.kind === 'ship' ? 'Schiff' : UNIT_LABELS[r.kind]));
        row.addEventListener('click', () => {
          if (on) selected.delete(r.key);
          else selected.add(r.key);
          refresh();
        });
        list.appendChild(row);
      }
      const sel = selection();
      const parts = [sel.ships > 0 ? `${sel.ships} Schiffe` : '', totalUnits(sel.units) > 0 ? describeComposition(sel.units) : ''].filter(Boolean);
      summary.textContent = rows.length === 0 ? 'Hier ist nichts verfügbar.' : `Ausgewählt: ${parts.join(', ') || 'nichts'}`;
    };
    refresh();

    const bulk = document.createElement('div');
    bulk.className = 'flex gap-1.5';
    const all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'Alle auswählen';
    all.className = 'flex-1 rounded px-1.5 py-1 text-[11px] text-amber-300 bg-amber-500/10 hover:bg-amber-500/20';
    all.addEventListener('click', () => {
      selected = new Set(rows.map((r) => r.key));
      refresh();
    });
    const none = document.createElement('button');
    none.type = 'button';
    none.textContent = 'Alle abwählen';
    none.className = 'flex-1 rounded px-1.5 py-1 text-[11px] text-slate-400 bg-slate-900/50 hover:bg-slate-800';
    none.addEventListener('click', () => {
      selected = new Set();
      refresh();
    });
    bulk.append(all, none);
    el.append(titleEl, bulk, list, summary, hint);
    return { el, getSelection: selection };
  }

  /**
   * Marine-Tab, Ziehen: wie die Bewegung im Karten-Tab, nur mit Schiffen. Schickt die im Panel markierte Auswahl (ohne
   * geöffnetes Panel alles Verfügbare): Schiffe fahren (Küste -> Zone, Zone -> Zone, Zone -> eigener Hafen; in eine feindliche
   * Zone mit Schiffen = Seeschlacht), Landeinheiten werden ein- (Küste -> Zone) oder ausgeschifft (Zone -> Küste), und ein
   * Ziehen von einer Zone auf ein verteidigtes feindliches Küstengebiet ist ein Landungsangriff.
   */
  private handleNavalDrop(fromId: string, toId: string): void {
    const gs = this.currentGameState;
    const me = this.client.playerId;
    const zones = this.data.seaZones;
    const fromIsZone = isSeaZoneId(zones, fromId);
    const toIsZone = isSeaZoneId(zones, toId);
    if (!fromIsZone && !toIsZone) {
      this.showError('Im Marine-Tab bewegst du Schiffe über Wasser - Landbewegungen gehen im Karten-Tab.');
      return;
    }
    let ships = availableShips(gs, me, fromId, zones);
    let units = emptyComposition();
    if (fromIsZone) {
      const z = seaStateOf(gs, fromId);
      if (z.ownerId === me) units = subtractGarrisons(z.embarked, z.embarkedMovedIn);
    } else {
      const st = gs.territoryState.get(fromId);
      const stack = st ? stackOf(st, me) : null;
      if (stack) units = availableToMove(stack);
    }
    if (this.selectedMoveSourceId === fromId && this.currentNavalPanel) {
      const sel = this.currentNavalPanel.getSelection();
      ships = sel.ships;
      units = sel.units;
    }

    const toState = gs.territoryState.get(toId);
    const enemyDefended =
      !toIsZone && !!toState && toState.ownerId !== null && toState.ownerId !== me && !areAllied(gs, me, toState.ownerId) && totalUnits(defenderForce(toState)) > 0;
    if (fromIsZone && enemyDefended) {
      if (totalUnits(units) === 0) {
        this.showError('Keine ausgeschifften Truppen für einen Landungsangriff verfügbar.');
        return;
      }
      if (!areAtWar(gs, me, toState!.ownerId!)) {
        this.showError('Kein Kriegszustand - erst den Krieg erklären, bevor angegriffen werden kann.');
        return;
      }
      this.client.attack(fromId, toId);
      this.closeMoveSelection();
      return;
    }

    const moveShipsOk = ships > 0 && (toIsZone || (fromIsZone && toState?.ownerId === me));
    const moveUnitsOk = totalUnits(units) > 0 && fromIsZone !== toIsZone;
    if (!moveShipsOk && !moveUnitsOk) {
      this.showError('Von dort ist nach dorthin nichts zu bewegen - Schiffe fahren Küste/Zone, Truppen werden nur ein- oder ausgeschifft.');
      return;
    }
    // Einschiffen: erst die Schiffe (sie besetzen ggf. die Zone); Ausschiffen: erst die Truppen (das letzte Schiff darf nicht mit Truppen an Bord ablegen).
    if (fromIsZone) {
      if (moveUnitsOk) this.client.moveUnits(fromId, toId, units);
      if (moveShipsOk) this.client.moveShips(fromId, toId, ships);
    } else {
      if (moveShipsOk) this.client.moveShips(fromId, toId, ships);
      if (moveUnitsOk) this.client.moveUnits(fromId, toId, units);
    }
    this.closeMoveSelection();
  }

  /** Schiffe im Hafen eines Küstengebiets bauen (siehe engine/economy.ts's recruitShips). */
  private openShipRecruitMenu(territoryId: string): void {
    const points = this.currentGameState.resources.get(this.client.playerId) ?? 0;
    const state = this.currentGameState.territoryState.get(territoryId);
    const { card, close } = this.openModal(`Schiffe: ${this.mapName(territoryId)}`);
    const unlocked = isNavalUnlocked(this.currentGameState, this.client.playerId, 'ships');
    if (!unlocked) {
      const p = document.createElement('p');
      p.className = 'text-sm text-slate-300';
      p.textContent = 'Schiffe sind noch nicht erforscht - siehe Research > Marine.';
      card.appendChild(p);
    }
    let count = 0;
    const max = Math.max(0, Math.min(Math.floor(points / SHIP_COST), MAX_SHIPS_PER_STACK - (state?.ships ?? 0)));
    const info = document.createElement('p');
    info.className = 'text-sm text-slate-300';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Bauen';
    confirmBtn.className = primaryBtnClass;
    confirmBtn.addEventListener('click', () => {
      this.client.recruitShips(territoryId, count);
      close();
    });
    const update = (): void => {
      info.textContent = `Kosten: ${count * SHIP_COST} / ${points} Rüstungspunkte verfügbar`;
      confirmBtn.disabled = !unlocked || count === 0;
    };
    update();
    card.appendChild(info);
    const { row } = this.createShipStepper(`Schiff (${SHIP_COST} Pkt.)`, () => count < max, (v) => {
      count = v;
      update();
    });
    card.appendChild(row);
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

  /** Ein +/- Zeilen-Zähler mit frei wählbarer Beschriftung (für Schiffe und Truppen auf See). */
  private createShipStepper(label: string, canIncrement: () => boolean, onChange: (value: number) => void, initial = 0): { row: HTMLDivElement } {
    const { row } = this.createStepperRow('infantry', null, initial, canIncrement, onChange);
    const labelEl = row.firstElementChild as HTMLElement;
    labelEl.replaceChildren(createShipIcon(), document.createTextNode(label));
    return { row };
  }

  private closeMoveSelection(): void {
    this.selectedMoveSourceId = null;
    this.currentMoveSelectionPanel = null;
    this.currentNavalPanel = null;
    this.diplomacyFocusOwnerId = null;
    this.moveSelectionSlot.replaceChildren();
    this.map.setSelectedTerritory(null);
  }

  /** Clicking a country in the Diplomatie tab selects its owner: their allies are listed in a side
   *  panel and every territory of theirs and of their allies gets outlined - clicking the same
   *  country again (or one nobody owns) clears it. See renderDiplomacyFocus. */
  private handleDiplomacyTerritoryClick(territoryId: string): void {
    const ownerId = this.currentGameState.territoryState.get(territoryId)?.ownerId ?? null;
    if (!ownerId || ownerId === this.diplomacyFocusOwnerId) {
      this.closeMoveSelection();
      return;
    }
    this.diplomacyFocusOwnerId = ownerId;
    this.renderDiplomacyFocus();
  }

  /** (Re)builds the Diplomatie tab's clicked-country panel and map outlines from the current game
   *  state - called on the click itself and again on every state update while it's open, since
   *  alliances form and dissolve mid-game. Closes itself if the country has since been eliminated. */
  private renderDiplomacyFocus(): void {
    const ownerId = this.diplomacyFocusOwnerId;
    const state = this.currentGameState;
    const owner = ownerId ? state.players.find((p) => p.id === ownerId) : undefined;
    if (!ownerId || !owner || isEliminated(state, ownerId)) {
      this.closeMoveSelection();
      return;
    }

    this.moveSelectionSlot.replaceChildren(this.buildDiplomacyFocusPanel(owner.id));

    const allyIds = new Set(alliesOf(state, ownerId));
    const outlines: { territoryId: string; stroke: string; strokeWidth: string }[] = [];
    for (const [id, territoryState] of state.territoryState) {
      if (territoryState.ownerId === ownerId) {
        outlines.push({ territoryId: id, stroke: DIPLOMACY_FOCUS_STROKE, strokeWidth: DIPLOMACY_FOCUS_STROKE_WIDTH });
      } else if (territoryState.ownerId && allyIds.has(territoryState.ownerId)) {
        outlines.push({ territoryId: id, stroke: DIPLOMACY_ALLY_STROKE, strokeWidth: DIPLOMACY_ALLY_STROKE_WIDTH });
      }
    }
    // The clicked country's own outline is drawn last so it stays on top where it borders an ally.
    outlines.sort((a, b) => (a.stroke === DIPLOMACY_FOCUS_STROKE ? 1 : 0) - (b.stroke === DIPLOMACY_FOCUS_STROKE ? 1 : 0));
    this.map.setOutlinedTerritories(outlines);
  }

  /** The list of `ownerId`'s allies as color-dotted name chips ("Du" for the viewer themselves),
   *  or a "Keine Verbündeten." line - shared by the clicked-country panel and the diplomacy modal.
   *  Eliminated players are left out: they have nothing on the map to show anymore. */
  private buildAlliesList(ownerId: string): HTMLDivElement {
    const state = this.currentGameState;
    const el = document.createElement('div');
    el.className = 'flex flex-col gap-1';

    const title = document.createElement('p');
    title.className = 'text-xs font-semibold uppercase tracking-wide text-slate-400';
    title.textContent = 'Verbündete';
    el.appendChild(title);

    const allies = alliesOf(state, ownerId)
      .map((id) => state.players.find((p) => p.id === id))
      .filter((p): p is Player => p !== undefined && !isEliminated(state, p.id));

    if (allies.length === 0) {
      const none = document.createElement('p');
      none.className = 'text-sm text-slate-500';
      none.textContent = 'Keine Verbündeten.';
      el.appendChild(none);
      return el;
    }

    const chips = document.createElement('div');
    chips.className = 'flex flex-wrap gap-1.5';
    for (const ally of allies) {
      const chip = document.createElement('span');
      chip.className = 'flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-xs text-slate-100';
      const swatch = document.createElement('span');
      swatch.className = 'h-2.5 w-2.5 shrink-0 rounded-full';
      swatch.style.background = ally.color;
      const isMe = ally.id === this.client.playerId;
      chip.append(swatch, document.createTextNode(isMe ? 'Du' : `${ally.name}${ally.isAI ? ' (KI)' : ''}`));
      chips.appendChild(chip);
    }
    el.appendChild(chips);
    return el;
  }

  /** The floating card for the country clicked in the Diplomatie tab - same fixed top-right drawer
   *  style as buildUnitSelectionPanel, so opening it never shifts the map. Shows who they are, how
   *  they stand with the viewer, and their allies; "Diplomatie öffnen" jumps to the usual
   *  war/pact/alliance modal for them. */
  private buildDiplomacyFocusPanel(ownerId: string): HTMLDivElement {
    const state = this.currentGameState;
    const owner = state.players.find((p) => p.id === ownerId)!;
    const isMe = ownerId === this.client.playerId;

    const el = document.createElement('div');
    el.className =
      'fixed right-4 top-56 z-30 flex max-h-[65vh] w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto rounded-md border border-sky-500/50 bg-slate-900/95 p-3 shadow-lg shadow-slate-950/50';

    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center gap-2 text-sm font-semibold text-slate-100';
    const swatch = document.createElement('span');
    swatch.className = 'h-3 w-3 shrink-0 rounded-full';
    swatch.style.background = owner.color;
    titleRow.append(swatch, document.createTextNode(`${owner.name}${owner.isAI ? ' (KI)' : ''}${isMe ? ' (du)' : ''}`));

    const relationText = document.createElement('p');
    relationText.className = 'text-xs text-slate-400';
    if (isMe) {
      relationText.textContent = 'Deine Allianz - ihre Mitglieder sehen deine Einheiten und du ihre.';
    } else {
      const relation = getRelation(state, this.client.playerId, ownerId);
      relationText.textContent = relation.atWar
        ? relation.viaAlliance
          ? 'Im Krieg (Bündnisfall).'
          : 'Im Krieg mit dir.'
        : relation.allied
          ? 'Mit dir verbündet.'
          : relation.pact?.active
            ? 'Nichtangriffspakt mit dir.'
            : 'Frieden.';
    }

    el.append(titleRow, relationText, this.buildAlliesList(ownerId));

    if (!isMe) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.textContent = 'Diplomatie öffnen';
      openBtn.className = `${secondaryBtnClass} w-full`;
      openBtn.addEventListener('click', () => this.openDiplomacyMenu(ownerId));
      el.appendChild(openBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Schließen';
    closeBtn.className = `${secondaryBtnClass} w-full`;
    closeBtn.addEventListener('click', () => this.closeMoveSelection());
    el.appendChild(closeBtn);

    return el;
  }

  private handleResourceTerritoryClick(territoryId: string): void {
    const state = this.currentGameState.territoryState.get(territoryId);
    if (!state || state.ownerId !== this.client.playerId) return;
    if (this.currentGameState.activePlayerId !== this.client.playerId) return;
    this.openDevelopmentMenu(territoryId);
  }

  private handleAirforceTerritoryClick(territoryId: string): void {
    const state = this.currentGameState.territoryState.get(territoryId);
    if (!state || state.ownerId !== this.client.playerId) return;
    if (this.currentGameState.activePlayerId !== this.client.playerId) return;
    this.openAirforceMenu(territoryId);
  }

  /** Dropping a Flugplatz territory (dragged on the Airforce tab) onto an enemy-at-war target
   *  sends every Jäger and Bomber currently stationed there against it - fighterSweep and
   *  launchBomberRaid both resolve instantly, no tactical battle involved, same as dragging ground
   *  units normally sends everything available when no partial selection is open. The two attacks
   *  are independent: an out-of-range Jäger sweep (see FIGHTER_RANGE) still leaves an in-range
   *  Bomber raid to go through on its own, and vice versa. For picking a smaller force than "all
   *  of it", use the Jägereinsatz/Bomber-Angriff buttons in the Flugplatz menu instead. */
  private handleAirforceDrop(fromId: string, toId: string): void {
    const toState = this.currentGameState.territoryState.get(toId);
    if (!toState || toState.ownerId === null || toState.ownerId === this.client.playerId) {
      this.showError('Kein gültiges Ziel für einen Luftangriff.');
      return;
    }
    if (!areAtWar(this.currentGameState, this.client.playerId, toState.ownerId)) {
      this.showError('Kein Kriegszustand - erst den Krieg erklären, bevor angegriffen werden kann.');
      return;
    }
    const airfield = airfieldAt(this.currentGameState, fromId);
    if (airfield.aircraft.fighters > 0) this.client.fighterSweep(fromId, toId, airfield.aircraft.fighters);
    // Defaults to 'units' - dragging is the quick, no-questions-asked gesture; picking 'factories'
    // instead requires going through the Bomber-Angriff menu.
    if (airfield.aircraft.bombers > 0) this.client.launchBomberRaid(fromId, toId, airfield.aircraft.bombers, 'units');
  }

  /** Opens a modal to build factories (+1 Rüstungspunkt/Runde each, up to the territory's factory
   *  capacity) or upgrade infrastructure (+1 factory capacity per level, up to
   *  MAX_INFRASTRUCTURE_LEVEL) at an owned territory. Stays open and refreshes itself as the game
   *  state updates, so building several factories in a row doesn't need re-clicking the territory
   *  each time. */
  private openDevelopmentMenu(territoryId: string): void {
    const territoryName = this.data.territories.find((t) => t.id === territoryId)?.name ?? territoryId;
    const { card, close } = this.openModal(territoryName, () => {
      this.currentDevelopmentPanel = null;
    });

    const valueText = document.createElement('p');
    valueText.className = 'text-sm text-slate-300';

    const factoryRow = document.createElement('div');
    factoryRow.className = 'flex items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-900/60 p-2';
    const factoryInfo = document.createElement('div');
    factoryInfo.className = 'text-xs text-slate-300';
    const buildFactoryBtn = document.createElement('button');
    buildFactoryBtn.type = 'button';
    buildFactoryBtn.textContent = `Fabrik bauen (${FACTORY_COST} Pkt.)`;
    buildFactoryBtn.className = primaryBtnClass;
    buildFactoryBtn.addEventListener('click', () => this.client.buildFactory(territoryId));
    factoryRow.append(factoryInfo, buildFactoryBtn);

    const infraRow = document.createElement('div');
    infraRow.className = 'flex items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-900/60 p-2';
    const infraInfo = document.createElement('div');
    infraInfo.className = 'text-xs text-slate-300';
    const upgradeInfraBtn = document.createElement('button');
    upgradeInfraBtn.type = 'button';
    upgradeInfraBtn.textContent = `Ausbauen (${INFRASTRUCTURE_COST} Pkt.)`;
    upgradeInfraBtn.className = secondaryBtnClass;
    upgradeInfraBtn.addEventListener('click', () => this.client.upgradeInfrastructure(territoryId));
    infraRow.append(infraInfo, upgradeInfraBtn);

    const refresh = (): void => {
      const points = this.currentGameState.resources.get(this.client.playerId) ?? 0;
      const dev = developmentAt(this.currentGameState, territoryId);
      const capacity = factoryCapacity(dev);
      const value = resourceValue(this.currentGameState, territoryId);
      valueText.textContent = `Ertrag: ${value} Rüstungspunkte/Runde — ${points} verfügbar`;
      factoryInfo.textContent = `Fabriken: ${dev.factories}/${capacity}`;
      buildFactoryBtn.disabled = dev.factories >= capacity || points < FACTORY_COST;
      infraInfo.textContent = `Infrastruktur: Stufe ${dev.infrastructureLevel}/${MAX_INFRASTRUCTURE_LEVEL}`;
      upgradeInfraBtn.disabled = dev.infrastructureLevel >= MAX_INFRASTRUCTURE_LEVEL || points < INFRASTRUCTURE_COST;
    };

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Schließen';
    closeBtn.className = `${secondaryBtnClass} w-full`;
    closeBtn.addEventListener('click', () => close());

    card.append(valueText, factoryRow, infraRow, closeBtn);
    this.currentDevelopmentPanel = { refresh };
    refresh();
  }

  /** Opens a modal to build/upgrade a Flugplatz and recruit Jäger/CAS/Bomber at an owned
   *  territory, plus (once any Bomber are stationed there) launch a raid. Stays open and refreshes
   *  itself as the game state updates, same reasoning as openDevelopmentMenu. */
  private openAirforceMenu(territoryId: string): void {
    const territoryName = this.data.territories.find((t) => t.id === territoryId)?.name ?? territoryId;
    const { card, close } = this.openModal(territoryName, () => {
      this.currentAirforcePanel = null;
    });

    const statusText = document.createElement('p');
    statusText.className = 'text-sm text-slate-300';

    const buildBtn = document.createElement('button');
    buildBtn.type = 'button';
    buildBtn.className = `${primaryBtnClass} w-full`;
    buildBtn.addEventListener('click', () => {
      const airfield = airfieldAt(this.currentGameState, territoryId);
      if (airfield.level === 0) this.client.buildAirfield(territoryId);
      else this.client.upgradeAirfield(territoryId);
    });

    const recruitRows = document.createElement('div');
    recruitRows.className = 'flex flex-col gap-2';

    // Aircraft are only ever bought a whole Einheit (AIRCRAFT_PACKET_SIZE = 100 aircraft) at a
    // time - each stepper click below adds/removes exactly one Einheit. The stepper's own displayed
    // count is the number of Einheiten queued, not the raw aircraft count; `amount[type]` (what
    // actually gets sent to recruitAircraft) is that count times AIRCRAFT_PACKET_SIZE.
    const amount: Record<keyof AirComposition, number> = { fighters: 0, cas: 0, bombers: 0 };
    const stepperRefreshers: (() => void)[] = [];
    const stepperResets: (() => void)[] = [];
    for (const type of AIRCRAFT_TYPES) {
      const { row, refresh: refreshStepper, resetValue } = this.createAircraftStepperRow(
        `${AIRCRAFT_LABELS[type]} (${AIRCRAFT_COST_PER_100[type]} Pkt./Einheit, 1 Einheit = ${AIRCRAFT_PACKET_SIZE} Flugzeuge)`,
        0,
        () => {
          const airfield = airfieldAt(this.currentGameState, territoryId);
          const points = this.currentGameState.resources.get(this.client.playerId) ?? 0;
          const capacityLeft = airfieldCapacity(airfield.level) - totalAircraft(airfield.aircraft) - totalAircraft(amount);
          const nextAmount = { ...amount, [type]: amount[type] + AIRCRAFT_PACKET_SIZE };
          return capacityLeft >= AIRCRAFT_PACKET_SIZE && airCostOf(nextAmount) <= points;
        },
        (einheiten) => {
          amount[type] = einheiten * AIRCRAFT_PACKET_SIZE;
          refreshAll();
        },
      );
      recruitRows.appendChild(row);
      stepperRefreshers.push(refreshStepper);
      stepperResets.push(resetValue);
    }

    const recruitCostText = document.createElement('p');
    recruitCostText.className = 'text-xs text-slate-400';

    const recruitBtn = document.createElement('button');
    recruitBtn.type = 'button';
    recruitBtn.textContent = 'Rekrutieren';
    recruitBtn.className = `${secondaryBtnClass} w-full`;
    recruitBtn.addEventListener('click', () => {
      this.client.recruitAircraft(territoryId, { ...amount });
      amount.fighters = 0;
      amount.cas = 0;
      amount.bombers = 0;
      for (const reset of stepperResets) reset();
      refreshAll();
    });

    const raidBtn = document.createElement('button');
    raidBtn.type = 'button';
    raidBtn.textContent = 'Bomber-Angriff starten';
    raidBtn.className = `${secondaryBtnClass} w-full`;
    raidBtn.addEventListener('click', () => {
      close();
      this.openBomberRaidMenu(territoryId);
    });

    const sweepBtn = document.createElement('button');
    sweepBtn.type = 'button';
    sweepBtn.textContent = 'Jägereinsatz starten';
    sweepBtn.className = `${secondaryBtnClass} w-full`;
    sweepBtn.addEventListener('click', () => {
      close();
      this.openFighterSweepMenu(territoryId);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Schließen';
    closeBtn.className = `${secondaryBtnClass} w-full`;
    closeBtn.addEventListener('click', () => close());

    const refreshAll = (): void => {
      const airfield = airfieldAt(this.currentGameState, territoryId);
      const points = this.currentGameState.resources.get(this.client.playerId) ?? 0;
      if (airfield.level === 0) {
        statusText.textContent = 'Kein Flugplatz auf diesem Gebiet.';
        buildBtn.textContent = `Flugplatz bauen (${AIRFIELD_BUILD_COST} Pkt.)`;
        buildBtn.disabled = points < AIRFIELD_BUILD_COST;
        recruitRows.classList.add('hidden');
        recruitCostText.classList.add('hidden');
        recruitBtn.classList.add('hidden');
        raidBtn.classList.add('hidden');
        sweepBtn.classList.add('hidden');
        return;
      }

      const capacity = airfieldCapacity(airfield.level);
      const stationed = totalAircraft(airfield.aircraft);
      statusText.textContent =
        `Flugplatz Stufe ${airfield.level} — ${stationed}/${capacity} Flugzeuge stationiert ` +
        `(Jäger ${airfield.aircraft.fighters}, CAS ${airfield.aircraft.cas}, Bomber ${airfield.aircraft.bombers})`;
      buildBtn.textContent = `Ausbauen (${AIRFIELD_UPGRADE_COST} Pkt.)`;
      buildBtn.disabled = points < AIRFIELD_UPGRADE_COST;
      recruitRows.classList.remove('hidden');
      recruitCostText.classList.remove('hidden');
      recruitBtn.classList.remove('hidden');
      raidBtn.classList.toggle('hidden', airfield.aircraft.bombers === 0);
      sweepBtn.classList.toggle('hidden', airfield.aircraft.fighters === 0);

      for (const refreshStepper of stepperRefreshers) refreshStepper();
      const cost = airCostOf(amount);
      recruitCostText.textContent = `Kosten: ${cost} / ${points} Rüstungspunkte verfügbar — Kapazität: ${stationed + totalAircraft(amount)}/${capacity}`;
      recruitBtn.disabled = totalAircraft(amount) === 0 || cost > points || stationed + totalAircraft(amount) > capacity;
    };

    card.append(statusText, buildBtn, recruitRows, recruitCostText, recruitBtn, raidBtn, sweepBtn, closeBtn);
    this.currentAirforcePanel = { refresh: refreshAll };
    refreshAll();
  }

  /** A +/- stepper row for one aircraft type - same visual pattern as createStepperRow, just
   *  driven by a plain label instead of a UnitComposition key (AirComposition has no matching
   *  icon set, and only 3 fixed types ever need this). */
  private createAircraftStepperRow(
    label: string,
    initial: number,
    canIncrement: () => boolean,
    onChange: (value: number) => void,
  ): { row: HTMLDivElement; refresh: () => void; resetValue: () => void } {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3';

    const labelEl = document.createElement('span');
    labelEl.className = 'text-sm text-slate-300';
    labelEl.textContent = label;

    let value = initial;
    const valueEl = document.createElement('span');
    valueEl.className = 'w-8 text-center text-sm tabular-nums';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.textContent = '-';
    minusBtn.className =
      'h-7 w-7 rounded-md border border-slate-600 bg-slate-900 text-base leading-none hover:bg-slate-700 disabled:opacity-40';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    plusBtn.className =
      'h-7 w-7 rounded-md border border-slate-600 bg-slate-900 text-base leading-none hover:bg-slate-700 disabled:opacity-40';

    const refresh = (): void => {
      valueEl.textContent = String(value);
      minusBtn.disabled = value <= 0;
      plusBtn.disabled = !canIncrement();
    };

    minusBtn.addEventListener('click', (e) => {
      for (let i = 0, steps = e.shiftKey ? 10 : 1; i < steps && value > 0; i++) {
        value -= 1;
        onChange(value);
      }
      refresh();
    });
    plusBtn.addEventListener('click', (e) => {
      for (let i = 0, steps = e.shiftKey ? 10 : 1; i < steps && canIncrement(); i++) {
        value += 1;
        onChange(value);
      }
      refresh();
    });
    refresh();

    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-2';
    controls.append(minusBtn, valueEl, plusBtn);

    row.append(labelEl, controls);
    const resetValue = (): void => {
      value = 0;
      refresh();
    };
    return { row, refresh, resetValue };
  }

  /** Opens a target-territory picker to launch a Bomber raid from `fromTerritoryId` (which must
   *  have at least one Bomber stationed there) - no range limit, any enemy-held territory on the
   *  map is a valid target. Resolves instantly, so this modal just shows the outcome once
   *  confirmed rather than staying open like the other panels. */
  private openBomberRaidMenu(fromTerritoryId: string): void {
    const fromName = this.data.territories.find((t) => t.id === fromTerritoryId)?.name ?? fromTerritoryId;
    const airfield = airfieldAt(this.currentGameState, fromTerritoryId);
    const { card, close } = this.openModal(`Bomber-Angriff von ${fromName}`);

    const info = document.createElement('p');
    info.className = 'text-xs text-slate-400';
    info.textContent = `${airfield.aircraft.bombers} Bomber verfügbar. Wähle ein feindliches Zielgebiet - wie viele zurückkehren, hängt von der Jäger-Luftüberlegenheit dort ab.`;
    card.appendChild(info);

    // Whether a raid hits the garrison or the target's factories - never both in one sortie (see
    // engine/airforce.ts's launchBomberRaid).
    let mode: BomberRaidMode = 'units';
    const modeRow = document.createElement('div');
    modeRow.className = 'flex gap-2';
    const unitsBtn = document.createElement('button');
    unitsBtn.type = 'button';
    unitsBtn.textContent = `Einheiten treffen (100 = ${Math.round(100 * BOMBER_DAMAGE_PER_UNIT)} Stärke)`;
    unitsBtn.className = `${primaryBtnClass} flex-1`;
    const factoriesBtn = document.createElement('button');
    factoriesBtn.type = 'button';
    factoriesBtn.textContent = `Fabriken zerstören (100 = ${Math.round(100 * FACTORY_DAMAGE_PER_BOMBER)} Fabriken)`;
    factoriesBtn.className = `${secondaryBtnClass} flex-1`;
    const refreshModeButtons = (): void => {
      unitsBtn.className = `${mode === 'units' ? primaryBtnClass : secondaryBtnClass} flex-1`;
      factoriesBtn.className = `${mode === 'factories' ? primaryBtnClass : secondaryBtnClass} flex-1`;
    };
    unitsBtn.addEventListener('click', () => {
      mode = 'units';
      refreshModeButtons();
    });
    factoriesBtn.addEventListener('click', () => {
      mode = 'factories';
      refreshModeButtons();
    });
    modeRow.append(unitsBtn, factoriesBtn);
    card.appendChild(modeRow);

    const targets = this.data.territories.filter((t) => {
      const state = this.currentGameState.territoryState.get(t.id);
      return (
        state &&
        state.ownerId !== null &&
        state.ownerId !== this.client.playerId &&
        areAtWar(this.currentGameState, this.client.playerId, state.ownerId)
      );
    });

    if (targets.length === 0) {
      const none = document.createElement('p');
      none.className = 'text-xs text-amber-400';
      none.textContent = 'Kein gültiges Ziel - erkläre erst jemandem den Krieg.';
      card.appendChild(none);
    }

    let targetId: string | null = targets[0]?.id ?? null;
    const targetList = document.createElement('div');
    targetList.className = 'flex max-h-40 flex-col gap-1 overflow-y-auto';
    const targetButtons = new Map<string, HTMLButtonElement>();
    const refreshTargetButtons = (): void => {
      for (const [id, btn] of targetButtons) {
        btn.className =
          id === targetId
            ? 'rounded-md border border-amber-400 bg-amber-500/20 px-3 py-1.5 text-left text-sm text-slate-100'
            : 'rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800';
      }
    };
    for (const t of targets) {
      const owner = this.currentGameState.players.find((p) => p.id === this.currentGameState.territoryState.get(t.id)?.ownerId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${t.name} (${owner?.name ?? '?'})`;
      btn.addEventListener('click', () => {
        targetId = t.id;
        refreshTargetButtons();
      });
      targetButtons.set(t.id, btn);
      targetList.appendChild(btn);
    }
    refreshTargetButtons();
    card.appendChild(targetList);

    let count = Math.min(airfield.aircraft.bombers, 1);
    const { row: stepperRow, refresh: refreshStepper } = this.createAircraftStepperRow(
      'Bomber einsetzen',
      count,
      () => count < airfield.aircraft.bombers,
      (value) => {
        count = value;
      },
    );
    card.appendChild(stepperRow);

    const launchBtn = document.createElement('button');
    launchBtn.type = 'button';
    launchBtn.textContent = 'Angriff starten';
    launchBtn.className = `${primaryBtnClass} w-full`;
    launchBtn.disabled = targets.length === 0;
    launchBtn.addEventListener('click', () => {
      if (!targetId || count <= 0) return;
      this.client.launchBomberRaid(fromTerritoryId, targetId, count, mode);
      close();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.className = `${secondaryBtnClass} w-full`;
    cancelBtn.addEventListener('click', () => close());

    card.append(launchBtn, cancelBtn);
    refreshStepper();
  }

  /** Opens a modal to send Jäger from an owned Flugplatz to fight an immediate air-to-air
   *  engagement over an enemy-held target - see engine/airforce.ts's fighterSweep. Same shape as
   *  openBomberRaidMenu, except the target list is additionally narrowed to FIGHTER_RANGE hops
   *  (Jäger, unlike Bomber, can't operate at unlimited range). */
  private openFighterSweepMenu(fromTerritoryId: string): void {
    const fromName = this.data.territories.find((t) => t.id === fromTerritoryId)?.name ?? fromTerritoryId;
    const airfield = airfieldAt(this.currentGameState, fromTerritoryId);
    const { card, close } = this.openModal(`Jägereinsatz von ${fromName}`);

    const info = document.createElement('p');
    info.className = 'text-xs text-slate-400';
    info.textContent = `${airfield.aircraft.fighters} Jäger verfügbar. Wähle ein feindliches Zielgebiet innerhalb der Reichweite (${FIGHTER_RANGE} Gebiet(e)) - ein sofortiges Luftgefecht gegen die dort projizierten feindlichen Jäger, ohne Bodenschlacht.`;
    card.appendChild(info);

    const targets = this.data.territories.filter((t) => {
      const state = this.currentGameState.territoryState.get(t.id);
      return (
        state &&
        state.ownerId !== null &&
        state.ownerId !== this.client.playerId &&
        areAtWar(this.currentGameState, this.client.playerId, state.ownerId) &&
        territoryDistance(fromTerritoryId, t.id, this.data.territories, FIGHTER_RANGE) !== null
      );
    });

    if (targets.length === 0) {
      const none = document.createElement('p');
      none.className = 'text-xs text-amber-400';
      none.textContent = 'Kein gültiges Ziel in Reichweite - erkläre erst jemandem den Krieg, oder das Ziel liegt zu weit entfernt.';
      card.appendChild(none);
    }

    let targetId: string | null = targets[0]?.id ?? null;
    const targetList = document.createElement('div');
    targetList.className = 'flex max-h-40 flex-col gap-1 overflow-y-auto';
    const targetButtons = new Map<string, HTMLButtonElement>();
    const refreshTargetButtons = (): void => {
      for (const [id, btn] of targetButtons) {
        btn.className =
          id === targetId
            ? 'rounded-md border border-amber-400 bg-amber-500/20 px-3 py-1.5 text-left text-sm text-slate-100'
            : 'rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800';
      }
    };
    for (const t of targets) {
      const owner = this.currentGameState.players.find((p) => p.id === this.currentGameState.territoryState.get(t.id)?.ownerId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${t.name} (${owner?.name ?? '?'})`;
      btn.addEventListener('click', () => {
        targetId = t.id;
        refreshTargetButtons();
      });
      targetButtons.set(t.id, btn);
      targetList.appendChild(btn);
    }
    refreshTargetButtons();
    card.appendChild(targetList);

    let count = Math.min(airfield.aircraft.fighters, 1);
    const { row: stepperRow, refresh: refreshStepper } = this.createAircraftStepperRow(
      'Jäger einsetzen',
      count,
      () => count < airfield.aircraft.fighters,
      (value) => {
        count = value;
      },
    );
    card.appendChild(stepperRow);

    const launchBtn = document.createElement('button');
    launchBtn.type = 'button';
    launchBtn.textContent = 'Einsatz starten';
    launchBtn.className = `${primaryBtnClass} w-full`;
    launchBtn.disabled = targets.length === 0;
    launchBtn.addEventListener('click', () => {
      if (!targetId || count <= 0) return;
      this.client.fighterSweep(fromTerritoryId, targetId, count);
      close();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.className = `${secondaryBtnClass} w-full`;
    cancelBtn.addEventListener('click', () => close());

    card.append(launchBtn, cancelBtn);
    refreshStepper();
  }

  /** Opens from clicking another player's legend chip (or "Diplomatie öffnen" on the Diplomatie
   *  tab's clicked-country panel): shows the current relation, that player's allies, and whichever
   *  actions apply (declare war, propose/withdraw/cancel a pact, propose/withdraw an alliance or
   *  leave the one you're in). Stays open and refreshes itself as the game state updates, same
   *  reasoning as openDevelopmentMenu. */
  /** Opens right when a player's chip is clicked ("wenn er sie anklickt soll er eine Schätzung
   *  sehen") and stays live for as long as the modal is open: a spy-report-style range for that
   *  player's true total Einheiten/Fabriken/Luftwaffe - see engine/intel.ts's estimateForces for
   *  exactly how it's fuzzed. Requested fresh every time this modal opens, never cached, so the
   *  numbers shift a little each time you check back in. */
  private buildForceEstimatePanel(targetId: string): { readonly el: HTMLDivElement; readonly unsubscribe: () => void } {
    const el = document.createElement('div');
    el.className = 'flex flex-col gap-1 rounded-md border border-slate-700 bg-slate-900/60 p-3';

    const title = document.createElement('p');
    title.className = 'text-xs font-semibold uppercase tracking-wide text-slate-400';
    title.textContent = 'Geschätzte Streitkräfte';

    const body = document.createElement('p');
    body.className = 'text-sm text-slate-300';
    body.textContent = 'Schätzung wird eingeholt...';

    const formatRange = (label: string, range: { readonly low: number; readonly high: number }): string =>
      `${label}: ${range.low === range.high ? range.low : `${range.low}–${range.high}`}`;

    const unsubscribe = this.client.onForceEstimate((estimateTargetId, estimate) => {
      if (estimateTargetId !== targetId) return; // a stale/unrelated request's answer - ignore it
      body.textContent = [
        formatRange('Einheiten', estimate.units),
        formatRange('Fabriken', estimate.factories),
        formatRange('Luftwaffe', estimate.airforce),
      ].join(' · ');
    });
    this.client.estimateEnemyForces(targetId);

    el.append(title, body);
    return { el, unsubscribe };
  }

  private openDiplomacyMenu(targetId: string): void {
    const target = this.currentGameState.players.find((p) => p.id === targetId);
    const estimatePanel = this.buildForceEstimatePanel(targetId);
    const { card, close } = this.openModal(target?.name ?? targetId, () => {
      this.currentDiplomacyPanel = null;
      estimatePanel.unsubscribe();
    });

    const statusText = document.createElement('p');
    statusText.className = 'text-sm text-slate-300';

    const warBtn = document.createElement('button');
    warBtn.type = 'button';
    warBtn.textContent = 'Krieg erklären';
    warBtn.className = `${primaryBtnClass} w-full`;
    warBtn.addEventListener('click', () => {
      this.myRecentWarDeclarations.add(targetId);
      this.client.declareWar(targetId);
    });

    const pactBtn = document.createElement('button');
    pactBtn.type = 'button';
    pactBtn.textContent = 'Nichtangriffspakt vorschlagen';
    pactBtn.className = `${secondaryBtnClass} w-full`;
    pactBtn.addEventListener('click', () => this.client.proposePact(targetId));

    const withdrawBtn = document.createElement('button');
    withdrawBtn.type = 'button';
    withdrawBtn.textContent = 'Paktangebot zurückziehen';
    withdrawBtn.className = `${secondaryBtnClass} w-full`;
    withdrawBtn.addEventListener('click', () => this.client.withdrawPactProposal(targetId));

    const cancelPactBtn = document.createElement('button');
    cancelPactBtn.type = 'button';
    cancelPactBtn.textContent = 'Pakt kündigen';
    cancelPactBtn.className = `${secondaryBtnClass} w-full`;
    cancelPactBtn.addEventListener('click', () => this.client.cancelPact(targetId));

    const allianceBtn = document.createElement('button');
    allianceBtn.type = 'button';
    allianceBtn.textContent = 'Allianz vorschlagen';
    allianceBtn.className = `${secondaryBtnClass} w-full`;
    allianceBtn.addEventListener('click', () => this.client.proposeAlliance(targetId));

    // Why an alliance isn't possible right now (see engine/diplomacy.ts's allianceConflict) - shown
    // under the button instead of leaving it disabled with no explanation.
    const allianceHint = document.createElement('p');
    allianceHint.className = 'text-xs text-slate-500';

    const withdrawAllianceBtn = document.createElement('button');
    withdrawAllianceBtn.type = 'button';
    withdrawAllianceBtn.textContent = 'Bündnisangebot zurückziehen';
    withdrawAllianceBtn.className = `${secondaryBtnClass} w-full`;
    withdrawAllianceBtn.addEventListener('click', () => this.client.withdrawAllianceProposal(targetId));

    const leaveAllianceBtn = document.createElement('button');
    leaveAllianceBtn.type = 'button';
    leaveAllianceBtn.textContent = 'Allianz verlassen';
    leaveAllianceBtn.className = `${secondaryBtnClass} w-full`;
    leaveAllianceBtn.addEventListener('click', () => this.client.leaveAlliance());

    // Leaving takes you out of the whole alliance, not just this one member's relation to you - say
    // so before someone clicks it expecting a one-on-one break-up.
    const leaveHint = document.createElement('p');
    leaveHint.className = 'text-xs text-slate-500';
    leaveHint.textContent = `Du verlässt die ganze Allianz, nicht nur ${target?.name ?? 'diesen Spieler'}. Laufende Kriege bleiben bestehen; ein Krieg gegen die bisherigen Verbündeten ist danach ${PACT_COOLDOWN_ROUNDS} Runden lang blockiert.`;

    const alliesSlot = document.createElement('div');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Schließen';
    closeBtn.className = `${secondaryBtnClass} w-full`;
    closeBtn.addEventListener('click', () => close());

    const refresh = (): void => {
      const state = this.currentGameState;
      const myId = this.client.playerId;
      const isMyTurn = state.activePlayerId === myId;
      const relation = getRelation(state, myId, targetId);
      const iOffered = hasPendingProposal(state, myId, targetId);
      const theyOffered = hasPendingProposal(state, targetId, myId);
      const iOfferedAlliance = hasPendingAllianceProposal(state, myId, targetId);
      const theyOfferedAlliance = hasPendingAllianceProposal(state, targetId, myId);
      const allied = relation.allied === true;
      const pact = relation.pact;
      const pactActive = pact?.active === true;
      // Rounds (including this one) still blocking a new war - matches engine/diplomacy.ts's
      // declareWar check (`currentRound > blocksWarUntilRound`) exactly. Also what leaving an
      // alliance leaves behind, see engine/diplomacy.ts's leaveAlliance.
      const pactCooldownRemaining =
        pact && !pact.active ? Math.max(0, pact.blocksWarUntilRound - state.turn + 1) : 0;
      const warBlocked = relation.atWar || allied || pactActive || pactCooldownRemaining > 0;

      let status: string;
      if (relation.atWar) status = relation.viaAlliance ? 'Im Krieg (Bündnisfall - über eine Allianz beigetreten).' : 'Im Krieg.';
      else if (allied) status = 'Verbündet.';
      else if (pactActive) status = 'Nichtangriffspakt aktiv.';
      else if (pactCooldownRemaining > 0) status = `Pakt/Bündnis gekündigt - Krieg noch ${pactCooldownRemaining} Runde(n) blockiert.`;
      else status = 'Frieden.';
      if (allied && pactActive) status += ' Nichtangriffspakt aktiv.';
      if (iOffered) status += ' Dein Paktangebot ist noch offen.';
      if (theyOffered) status += ' Paktangebot erhalten - ein eigenes Angebot nimmt es sofort an.';
      if (iOfferedAlliance) status += ' Dein Bündnisangebot ist noch offen.';
      if (theyOfferedAlliance) status += ' Bündnisangebot erhalten - ein eigenes Angebot nimmt es sofort an.';
      statusText.textContent = status;

      alliesSlot.replaceChildren(this.buildAlliesList(targetId));

      warBtn.classList.toggle('hidden', relation.atWar || allied);
      warBtn.disabled = !isMyTurn || warBlocked;

      pactBtn.classList.toggle('hidden', pactActive || allied);
      pactBtn.disabled = !isMyTurn || pactActive || iOffered;

      withdrawBtn.classList.toggle('hidden', !iOffered);
      withdrawBtn.disabled = !isMyTurn;

      cancelPactBtn.classList.toggle('hidden', !pactActive || allied);
      cancelPactBtn.disabled = !isMyTurn;

      const conflict = allied ? null : allianceConflict(state, myId, targetId);
      allianceBtn.classList.toggle('hidden', allied);
      allianceBtn.textContent = theyOfferedAlliance ? 'Bündnisangebot annehmen' : 'Allianz vorschlagen';
      allianceBtn.disabled = !isMyTurn || iOfferedAlliance || conflict !== null;
      allianceHint.textContent = conflict ?? '';
      allianceHint.classList.toggle('hidden', conflict === null);

      withdrawAllianceBtn.classList.toggle('hidden', !iOfferedAlliance);
      withdrawAllianceBtn.disabled = !isMyTurn;

      leaveAllianceBtn.classList.toggle('hidden', !allied);
      leaveAllianceBtn.disabled = !isMyTurn;
      leaveHint.classList.toggle('hidden', !allied);
    };

    card.append(
      statusText,
      alliesSlot,
      estimatePanel.el,
      warBtn,
      pactBtn,
      withdrawBtn,
      cancelPactBtn,
      allianceBtn,
      allianceHint,
      withdrawAllianceBtn,
      leaveAllianceBtn,
      leaveHint,
      closeBtn,
    );
    this.currentDiplomacyPanel = { refresh };
    refresh();
  }

  /** Opens a modal to spend Rüstungspunkte on new units at an owned territory. New units count
   *  as having already moved this round, same as a captured or relocated stack. */
  private openRecruitMenu(territoryId: string): void {
    const points = this.currentGameState.resources.get(this.client.playerId) ?? 0;
    const territoryName = this.data.territories.find((t) => t.id === territoryId)?.name ?? territoryId;

    const amount: Record<keyof UnitComposition, number> = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };
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

    for (const type of UNIT_TYPES) {
      const max = Math.floor(points / UNIT_COSTS[type]);
      if (max <= 0) continue;
      const { row } = this.createStepperRow(type, `(${UNIT_COSTS[type]} Pkt.)`, amount[type], () => amount[type] < max, (value) => {
        amount[type] = value;
        updateState();
      });
      card.appendChild(row);
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
    type: keyof UnitComposition,
    suffix: string | null,
    initial: number,
    canIncrement: () => boolean,
    onChange: (value: number) => void,
  ): { row: HTMLDivElement; refresh: () => void } {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3';

    const labelEl = document.createElement('span');
    labelEl.className = 'flex items-center gap-1.5 text-sm text-slate-300';
    labelEl.append(createUnitIcon(type), document.createTextNode(suffix ? `${UNIT_LABELS[type]} ${suffix}` : UNIT_LABELS[type]));

    let value = initial;
    const valueEl = document.createElement('span');
    valueEl.className = 'w-8 text-center text-sm tabular-nums';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.textContent = '-';
    minusBtn.className =
      'h-7 w-7 rounded-md border border-slate-600 bg-slate-900 text-base leading-none hover:bg-slate-700 disabled:opacity-40';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    plusBtn.className =
      'h-7 w-7 rounded-md border border-slate-600 bg-slate-900 text-base leading-none hover:bg-slate-700 disabled:opacity-40';

    const refresh = (): void => {
      valueEl.textContent = String(value);
      minusBtn.disabled = value <= 0;
      plusBtn.disabled = !canIncrement();
    };

    minusBtn.addEventListener('click', (e) => {
      for (let i = 0, steps = e.shiftKey ? 10 : 1; i < steps && value > 0; i++) {
        value -= 1;
        onChange(value);
      }
      refresh();
    });
    plusBtn.addEventListener('click', (e) => {
      for (let i = 0, steps = e.shiftKey ? 10 : 1; i < steps && canIncrement(); i++) {
        value += 1;
        onChange(value);
      }
      refresh();
    });
    refresh();

    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-2';
    controls.append(minusBtn, valueEl, plusBtn);

    row.append(labelEl, controls);
    return { row, refresh };
  }
}
