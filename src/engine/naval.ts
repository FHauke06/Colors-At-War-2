import type {
  GameState,
  PendingBattle,
  PendingSeaBattle,
  SeaShot,
  SeaZone,
  SeaZoneState,
  Territory,
  TerritoryState,
  UnitComposition,
} from './types';
import {
  addGarrisons,
  subtractGarrisons,
  totalUnits,
  availableToMove,
  stackOf,
  withStack,
  depositUnits,
  defenderForce,
  moveUnits,
} from './movement';
import { areAllied, areAtWar } from './diplomacy';
import { addToPlayerStats } from './stats';
import { MAX_SHIPS_PER_STACK } from './economy';
import { generateSubTerritories } from './combat';
import { pickRandomBattleMap } from '../data/BattleMaps';

/**
 * Seekampf und Überseetransport. Wasser wird nur über Seezonen (data/MainMaps/*SeaZones.ts) überquert:
 * - Schiffe (eigener Zähler, nicht in UnitComposition) liegen in Küstengebieten (TerritoryState.ships) oder
 *   in Seezonen (SeaZoneState.ships) und fahren Küste <-> Zone und Zone <-> Zone, je 1 Zug pro Runde.
 * - Eine Seezone gehört nur dem, der sie in diesem Moment kontrolliert (eigene Schiffe darin): neutral + Schiffe
 *   einlaufen = Besitzanspruch; fahren die letzten Schiffe weg oder werden versenkt, verfällt er sofort und die Zone
 *   ist wieder neutral (setZone löscht den Eintrag).
 *   Keine Gästeflotten: nur der Besitzer hat Schiffe/Truppen dort, auch Verbündete dürfen nicht einlaufen.
 * - Landeinheiten schiffen nur in einer Zone ein, die der Mover alleinig besetzt UND in der mindestens
 *   1 eigenes Schiff liegt (Design-Entscheidung: Schiffe sind Träger und Kampfeinheit der Zone). Eingeschiffte
 *   Einheiten (embarked) laufen frühestens in der Folgerunde in ein angrenzendes Küstengebiet aus. Das letzte
 *   Schiff darf die Zone nicht verlassen, solange dort Truppen an Bord sind.
 * - Eine Zone ohne Schiffe ist immer neutral (frei einlaufen); eine Zone eines Feindes im Krieg hat immer Schiffe = Seeschlacht.
 * - Landungen: auf neutrales, eigenes, verbündetes oder unverteidigtes feindliches Küstengebiet direkt
 *   (disembarkUnits); auf ein verteidigtes feindliches als Landungsangriff (startAmphibiousBattle, läuft über
 *   die normale taktische Schlacht, ein Rückzug auf die Schiffe ist nicht möglich).
 * - Luftwaffe und Artillerie wirken nicht auf Seeschlachten.
 */

export const SEA_GRID_SIZE = 10;
const HALF_CELLS = (SEA_GRID_SIZE * SEA_GRID_SIZE) / 2;

const EMPTY: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

export type NavalOutcome =
  | { readonly ok: true; readonly gameState: GameState }
  | { readonly ok: false; readonly reason: string };

export type SeaShotOutcome =
  | { readonly ok: true; readonly gameState: GameState; readonly concluded: SeaBattleResult | null }
  | { readonly ok: false; readonly reason: string };

export interface SeaBattleResult {
  readonly territoryId: string; // Id der Seezone (Kompatibilität mit BattleResult)
  readonly attackerId: string;
  readonly defenderId: string;
  readonly attackerWon: boolean;
  readonly sea: true;
}

// ------------------------------------------------------------------------------------------------
// Zonen-Helfer
// ------------------------------------------------------------------------------------------------

export function isSeaZoneId(seaZones: readonly SeaZone[], id: string): boolean {
  return seaZones.some((z) => z.id === id);
}

/** Seezonen, an die ein Landgebiet grenzt (aus den `neighbors` der Zonen abgeleitet). */
export function coastalZoneIds(territoryId: string, seaZones: readonly SeaZone[]): string[] {
  return seaZones.filter((z) => z.neighbors.includes(territoryId)).map((z) => z.id);
}

/** Zustand einer Zone. Besitz gibt es nur, solange Schiffe in der Zone liegen: ein Eintrag ohne Schiffe (z.B. aus
 *  einem Spielstand mit der alten "klebrigen" Regel) zählt als neutral und leer. */
export function seaStateOf(gameState: GameState, zoneId: string): SeaZoneState {
  const z = gameState.seaZones.get(zoneId);
  return z && z.ships > 0 ? z : { ownerId: null, ships: 0, shipsMovedIn: 0, embarked: EMPTY, embarkedMovedIn: EMPTY };
}

export function shipsInTerritory(state: TerritoryState | undefined): number {
  return state?.ships ?? 0;
}

export function availableShips(gameState: GameState, playerId: string, placeId: string, seaZones: readonly SeaZone[]): number {
  if (isSeaZoneId(seaZones, placeId)) {
    const z = seaStateOf(gameState, placeId);
    return z.ownerId === playerId ? z.ships - z.shipsMovedIn : 0;
  }
  const t = gameState.territoryState.get(placeId);
  return t && t.ownerId === playerId ? (t.ships ?? 0) - (t.shipsMovedIn ?? 0) : 0;
}

export function totalShips(gameState: GameState, playerId: string): number {
  let n = 0;
  for (const t of gameState.territoryState.values()) if (t.ownerId === playerId) n += t.ships ?? 0;
  for (const z of gameState.seaZones.values()) if (z.ownerId === playerId) n += z.ships;
  return n;
}

function setZone(gameState: GameState, zoneId: string, zone: SeaZoneState): GameState {
  const next = new Map(gameState.seaZones);
  // Der Besitzanspruch verfällt, sobald die letzten Schiffe wegfahren oder untergehen: kein Eintrag = neutral (sparse).
  if (zone.ownerId === null || zone.ships <= 0) next.delete(zoneId);
  else next.set(zoneId, zone);
  return { ...gameState, seaZones: next };
}

function setTerritoryShips(state: TerritoryState, ships: number, shipsMovedIn: number): TerritoryState {
  const { ships: _s, shipsMovedIn: _m, ...rest } = state;
  return ships > 0 ? { ...rest, ships, ...(shipsMovedIn > 0 ? { shipsMovedIn } : {}) } : rest;
}

function fits(amount: UnitComposition, available: UnitComposition): boolean {
  return (['infantry', 'lightTank', 'heavyTank', 'artillery', 'motorizedInfantry'] as const).every(
    (k) => amount[k] >= 0 && amount[k] <= available[k],
  );
}

/** Setzt in turns.ts beim Rundenwechsel alle Schiffs-/Truppenzüge auf See zurück. */
export function resetNavalMovement(gameState: GameState): GameState {
  const territoryState = new Map<string, TerritoryState>();
  for (const [id, s] of gameState.territoryState) {
    if (s.shipsMovedIn === undefined) {
      territoryState.set(id, s);
    } else {
      const { shipsMovedIn: _m, ...rest } = s;
      territoryState.set(id, rest);
    }
  }
  const seaZones = new Map<string, SeaZoneState>();
  for (const [id, z] of gameState.seaZones) seaZones.set(id, { ...z, shipsMovedIn: 0, embarkedMovedIn: EMPTY });
  return { ...gameState, territoryState, seaZones };
}

// ------------------------------------------------------------------------------------------------
// Schiffe bewegen
// ------------------------------------------------------------------------------------------------

/**
 * Bewegt `count` Schiffe zwischen Küstengebiet und Seezone bzw. zwischen zwei Seezonen. Fährt der Mover in eine
 * feindliche (Krieg!) Zone mit Schiffen, beginnt stattdessen eine Seeschlacht (pendingSeaBattle) - `battleStarted`
 * ist dann true; die Schiffe verlassen ihren Ausgangsort erst, wenn beide Seiten aufgestellt haben.
 */
export function moveShips(
  gameState: GameState,
  playerId: string,
  fromId: string,
  toId: string,
  count: number,
  seaZones: readonly SeaZone[],
): (NavalOutcome & { readonly battleStarted?: boolean }) {
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  if (!Number.isInteger(count) || count <= 0) return { ok: false, reason: 'Keine Schiffe ausgewählt.' };

  const fromZone = seaZones.find((z) => z.id === fromId);
  const toZone = seaZones.find((z) => z.id === toId);
  if (!fromZone && !toZone) return { ok: false, reason: 'Schiffe fahren nur zwischen Küste und Seezone.' };
  const adjacent = fromZone ? fromZone.neighbors.includes(toId) : toZone!.neighbors.includes(fromId);
  if (!adjacent) return { ok: false, reason: 'Gebiete sind nicht benachbart.' };

  const available = availableShips(gameState, playerId, fromId, seaZones);
  if (available <= 0) return { ok: false, reason: 'Keine verfügbaren Schiffe dort - sie haben sich diese Runde schon bewegt.' };
  if (count > available) return { ok: false, reason: 'Nicht genug verfügbare Schiffe.' };

  if (fromZone) {
    const z = seaStateOf(gameState, fromId);
    if (count === z.ships && totalUnits(z.embarked) > 0) {
      return { ok: false, reason: 'Das letzte Schiff kann nicht ablegen, solange Truppen an Bord sind.' };
    }
  }

  // Ziel prüfen
  let battle: PendingSeaBattle | null = null;
  let destZone: SeaZoneState | null = null;
  let destTerritory: TerritoryState | null = null;
  if (toZone) {
    const z = seaStateOf(gameState, toId);
    if (z.ownerId === null || z.ownerId === playerId) {
      if (z.ships + count > MAX_SHIPS_PER_STACK) return { ok: false, reason: `Höchstens ${MAX_SHIPS_PER_STACK} Schiffe pro Seezone.` };
      destZone = { ...z, ownerId: playerId, ships: z.ships + count, shipsMovedIn: z.shipsMovedIn + count };
    } else if (areAllied(gameState, playerId, z.ownerId)) {
      return { ok: false, reason: 'Seezonen gehören nur dem alleinigen Besetzer - keine Gästeflotten.' };
    } else if (!areAtWar(gameState, playerId, z.ownerId)) {
      return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor eine fremde Seezone angegriffen wird.' };
    } else {
      // Eine besetzte Zone hat immer Schiffe (der Besitz verfällt mit ihnen) - ein Feind im Krieg bedeutet also Seeschlacht.
      battle = {
        zoneId: toId,
        fromId,
        fromIsZone: fromZone !== undefined,
        attackerId: playerId,
        defenderId: z.ownerId,
        attackerShips: count,
        defenderShips: z.ships,
        gridSize: SEA_GRID_SIZE,
        attackerDeployed: false,
        defenderDeployed: false,
        attackerFleet: [],
        defenderFleet: [],
        attackerRemaining: count,
        defenderRemaining: z.ships,
        attackerShots: [],
        defenderShots: [],
        activeSide: null,
      };
    }
  } else {
    const t = gameState.territoryState.get(toId);
    if (!t || t.ownerId !== playerId) return { ok: false, reason: 'Schiffe laufen nur in eigene Häfen ein.' };
    if ((t.ships ?? 0) + count > MAX_SHIPS_PER_STACK) return { ok: false, reason: `Höchstens ${MAX_SHIPS_PER_STACK} Schiffe pro Hafen.` };
    destTerritory = setTerritoryShips(t, (t.ships ?? 0) + count, (t.shipsMovedIn ?? 0) + count);
  }

  if (battle) return { ok: true, gameState: { ...gameState, pendingSeaBattle: battle }, battleStarted: true };

  let next = gameState;
  next = removeShipsAt(next, playerId, fromId, count, seaZones);
  if (destZone) next = setZone(next, toId, destZone);
  if (destTerritory) {
    const ts = new Map(next.territoryState);
    ts.set(toId, destTerritory);
    next = { ...next, territoryState: ts };
  }
  return { ok: true, gameState: next, battleStarted: false };
}

function removeShipsAt(gameState: GameState, playerId: string, placeId: string, count: number, seaZones: readonly SeaZone[]): GameState {
  if (isSeaZoneId(seaZones, placeId)) {
    const z = seaStateOf(gameState, placeId);
    return setZone(gameState, placeId, { ...z, ships: z.ships - count });
  }
  const t = gameState.territoryState.get(placeId)!;
  const ts = new Map(gameState.territoryState);
  ts.set(placeId, setTerritoryShips(t, (t.ships ?? 0) - count, t.shipsMovedIn ?? 0));
  void playerId;
  return { ...gameState, territoryState: ts };
}

// ------------------------------------------------------------------------------------------------
// Transport: einschiffen / ausschiffen
// ------------------------------------------------------------------------------------------------

/** Schifft `amount` Landeinheiten (verfügbare Einheiten des Gebiets) in eine angrenzende, alleinig besetzte Zone mit mindestens 1 eigenem Schiff ein. */
export function embarkUnits(
  gameState: GameState,
  playerId: string,
  territoryId: string,
  zoneId: string,
  amount: UnitComposition,
  seaZones: readonly SeaZone[],
): NavalOutcome {
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  const zone = seaZones.find((z) => z.id === zoneId);
  if (!zone || !zone.neighbors.includes(territoryId)) return { ok: false, reason: 'Gebiete sind nicht benachbart.' };
  const t = gameState.territoryState.get(territoryId);
  const stack = t ? stackOf(t, playerId) : null;
  if (!t || !stack) return { ok: false, reason: 'Das Gebiet gehört dir nicht.' };
  if (totalUnits(amount) === 0) return { ok: false, reason: 'Keine Einheiten ausgewählt.' };
  const z = seaStateOf(gameState, zoneId);
  if (z.ownerId !== playerId) return { ok: false, reason: 'Du musst die Seezone alleinig besetzen, um Truppen überzusetzen.' };
  if (z.ships < 1) return { ok: false, reason: 'Mindestens 1 eigenes Schiff muss in der Seezone liegen.' };
  if (!fits(amount, availableToMove(stack))) {
    return { ok: false, reason: 'Nicht genug verfügbare Einheiten - manche haben sich diese Runde schon bewegt.' };
  }
  const ts = new Map(gameState.territoryState);
  ts.set(
    territoryId,
    withStack(t, playerId, {
      garrison: subtractGarrisons(stack.garrison, amount),
      movedIn: stack.movedIn,
      extraMoveUsed: stack.extraMoveUsed,
    }),
  );
  const next = setZone({ ...gameState, territoryState: ts }, zoneId, {
    ...z,
    embarked: addGarrisons(z.embarked, amount),
    embarkedMovedIn: addGarrisons(z.embarkedMovedIn, amount),
  });
  return { ok: true, gameState: next };
}

/** Landet eingeschiffte Einheiten (die nicht in dieser Runde an Bord gingen) auf einem angrenzenden Küstengebiet, das neutral, eigen, verbündet oder unverteidigt (Krieg!) ist. */
export function disembarkUnits(
  gameState: GameState,
  playerId: string,
  zoneId: string,
  toId: string,
  amount: UnitComposition,
  seaZones: readonly SeaZone[],
): NavalOutcome {
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Ein Kampf läuft noch.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  const zone = seaZones.find((z) => z.id === zoneId);
  if (!zone || !zone.neighbors.includes(toId)) return { ok: false, reason: 'Gebiete sind nicht benachbart.' };
  const z = seaStateOf(gameState, zoneId);
  if (z.ownerId !== playerId) return { ok: false, reason: 'Die Seezone gehört dir nicht.' };
  if (totalUnits(amount) === 0) return { ok: false, reason: 'Keine Einheiten ausgewählt.' };
  if (!fits(amount, subtractGarrisons(z.embarked, z.embarkedMovedIn))) {
    return { ok: false, reason: 'Nicht genug verfügbare Truppen - in dieser Runde Eingeschiffte laufen erst nächste Runde aus.' };
  }
  const to = gameState.territoryState.get(toId);
  if (!to) return { ok: false, reason: `Unbekanntes Gebiet "${toId}".` };

  const remainingZone: SeaZoneState = { ...z, embarked: subtractGarrisons(z.embarked, amount) };
  // Gelandete Motorisierte Infanterie hat ihren zweiten Zug damit verbraucht (Einschiffen war der erste).
  const secondHop: UnitComposition = { ...EMPTY, motorizedInfantry: amount.motorizedInfantry };
  const ts = new Map(gameState.territoryState);
  let next: GameState = gameState;
  if (to.ownerId === null || to.ownerId === playerId || areAllied(gameState, playerId, to.ownerId)) {
    ts.set(toId, depositUnits(to, playerId, amount, secondHop));
  } else if (totalUnits(defenderForce(to)) === 0) {
    if (!areAtWar(gameState, playerId, to.ownerId)) {
      return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor Gebiete erobert werden können.' };
    }
    ts.set(toId, { ownerId: playerId, garrison: amount, movedIn: amount, extraMoveUsed: secondHop });
    next = addToPlayerStats(gameState, playerId, { territoriesConquered: 1 });
  } else {
    return { ok: false, reason: 'Das Gebiet ist verteidigt - starte einen Landungsangriff.' };
  }
  return { ok: true, gameState: setZone({ ...next, territoryState: ts }, zoneId, remainingZone) };
}

/**
 * Einheitlicher Einstieg für Bewegungen von Landeinheiten: zwei Landgebiete -> moveUnits, Küste -> Zone ->
 * embarkUnits, Zone -> Küste -> disembarkUnits. Wird von den Net-Layern statt moveUnits aufgerufen.
 */
export function moveUnitsAnywhere(
  gameState: GameState,
  playerId: string,
  fromId: string,
  toId: string,
  territories: readonly Territory[],
  seaZones: readonly SeaZone[],
  amount: UnitComposition,
): NavalOutcome {
  if (isSeaZoneId(seaZones, fromId) && isSeaZoneId(seaZones, toId)) {
    return { ok: false, reason: 'Eingeschiffte Truppen können nur an Land gehen (Küstengebiet wählen).' };
  }
  if (isSeaZoneId(seaZones, fromId)) return disembarkUnits(gameState, playerId, fromId, toId, amount, seaZones);
  if (isSeaZoneId(seaZones, toId)) return embarkUnits(gameState, playerId, fromId, toId, amount, seaZones);
  return moveUnits(gameState, playerId, fromId, toId, territories, amount);
}

// ------------------------------------------------------------------------------------------------
// Landungsangriff
// ------------------------------------------------------------------------------------------------

/** Wie combat.ts's startBattle, aber der Angriff startet von den in `zoneId` eingeschifften Truppen. */
export function startAmphibiousBattle(
  gameState: GameState,
  playerId: string,
  zoneId: string,
  toId: string,
  seaZones: readonly SeaZone[],
): NavalOutcome {
  if (gameState.pendingBattle || gameState.pendingSeaBattle) return { ok: false, reason: 'Es läuft bereits ein Kampf.' };
  if (gameState.activePlayerId !== playerId) return { ok: false, reason: 'Du bist nicht am Zug.' };
  const zone = seaZones.find((z) => z.id === zoneId);
  if (!zone || !zone.neighbors.includes(toId)) return { ok: false, reason: 'Gebiete sind nicht benachbart.' };
  const z = seaStateOf(gameState, zoneId);
  if (z.ownerId !== playerId) return { ok: false, reason: 'Die Seezone gehört dir nicht.' };
  const attackerMax = subtractGarrisons(z.embarked, z.embarkedMovedIn);
  if (totalUnits(attackerMax) === 0) return { ok: false, reason: 'Keine ausgeschifften Truppen verfügbar - in dieser Runde Eingeschiffte laufen erst nächste Runde aus.' };
  const to = gameState.territoryState.get(toId);
  if (!to) return { ok: false, reason: `Unbekanntes Gebiet "${toId}".` };
  if (to.ownerId === null || to.ownerId === playerId || areAllied(gameState, playerId, to.ownerId)) {
    return { ok: false, reason: 'Das Gebiet ist nicht feindlich besetzt - normal an Land gehen statt angreifen.' };
  }
  const defenders = defenderForce(to);
  if (totalUnits(defenders) === 0) return { ok: false, reason: 'Das Gebiet ist unverteidigt - normal an Land gehen statt angreifen.' };
  if (!areAtWar(gameState, playerId, to.ownerId)) {
    return { ok: false, reason: 'Kein Kriegszustand - erst den Krieg erklären, bevor angegriffen werden kann.' };
  }
  const battleMap = pickRandomBattleMap();
  const pendingBattle: PendingBattle = {
    territoryId: toId,
    fromId: zoneId,
    fromSeaZone: true,
    attackerId: playerId,
    defenderId: to.ownerId,
    attackerMax,
    defenderMax: defenders,
    attackerDeployed: false,
    defenderDeployed: false,
    battleMapName: battleMap.name,
    subTerritories: generateSubTerritories(battleMap),
    subState: null,
    activeSide: null,
    battleRound: 0,
    calledAircraft: [],
  };
  return { ok: true, gameState: { ...gameState, pendingBattle } };
}

// ------------------------------------------------------------------------------------------------
// Seeschlacht: "Schiffe versenken"
// ------------------------------------------------------------------------------------------------

/** Zellen (row * gridSize + col) der eigenen Rasterhälfte: Angreifer oben (Reihen 0-4), Verteidiger unten (5-9). */
export function halfCells(side: 'attacker' | 'defender'): number[] {
  const start = side === 'attacker' ? 0 : HALF_CELLS;
  return Array.from({ length: HALF_CELLS }, (_, i) => start + i);
}

export function cancelSeaBattle(gameState: GameState, playerId: string): NavalOutcome {
  const p = gameState.pendingSeaBattle;
  if (!p) return { ok: false, reason: 'Keine Seeschlacht im Gange.' };
  if (p.attackerId !== playerId) return { ok: false, reason: 'Nur der Angreifer kann abbrechen.' };
  if (p.attackerDeployed) return { ok: false, reason: 'Die Aufstellung ist bereits bestätigt.' };
  return { ok: true, gameState: { ...gameState, pendingSeaBattle: null } };
}

/** Bestätigt die (verdeckte) Aufstellung einer Seite; sind beide fertig, beginnt die Schussphase (der Verteidiger schießt zuerst - wie bei Landschlachten). */
export function deploySeaFleet(gameState: GameState, playerId: string, cells: readonly number[]): NavalOutcome {
  const p = gameState.pendingSeaBattle;
  if (!p) return { ok: false, reason: 'Keine Seeschlacht im Gange.' };
  let side: 'attacker' | 'defender';
  if (p.attackerId === playerId && !p.attackerDeployed) side = 'attacker';
  else if (p.defenderId === playerId && !p.defenderDeployed) side = 'defender';
  else return { ok: false, reason: 'Du kannst hier nicht aufstellen.' };

  const ships = side === 'attacker' ? p.attackerShips : p.defenderShips;
  const allowed = new Set(halfCells(side));
  if (cells.length !== ships || new Set(cells).size !== cells.length || !cells.every((c) => Number.isInteger(c) && allowed.has(c))) {
    return { ok: false, reason: `Ungültige Aufstellung - genau ${ships} verschiedene Kästen in der eigenen Hälfte wählen.` };
  }
  const sorted = [...cells].sort((a, b) => a - b);
  let next: PendingSeaBattle =
    side === 'attacker' ? { ...p, attackerDeployed: true, attackerFleet: sorted } : { ...p, defenderDeployed: true, defenderFleet: sorted };
  let state: GameState = { ...gameState, pendingSeaBattle: next };
  if (next.attackerDeployed && next.defenderDeployed) {
    next = { ...next, activeSide: 'defender' };
    state = { ...state, pendingSeaBattle: next };
    // Die angreifenden Schiffe verlassen jetzt ihren Ausgangsort.
    state = removeShipsForBattle(state, next);
  }
  return { ok: true, gameState: state };
}

function removeShipsForBattle(gameState: GameState, p: PendingSeaBattle): GameState {
  if (p.fromIsZone) {
    const z = seaStateOf(gameState, p.fromId);
    return setZone(gameState, p.fromId, { ...z, ships: z.ships - p.attackerShips });
  }
  const t = gameState.territoryState.get(p.fromId);
  if (!t) return gameState;
  const ts = new Map(gameState.territoryState);
  ts.set(p.fromId, setTerritoryShips(t, (t.ships ?? 0) - p.attackerShips, t.shipsMovedIn ?? 0));
  return { ...gameState, territoryState: ts };
}

/** Ein Schuss auf `cell` (in der gegnerischen Hälfte). Ein Treffer versenkt genau 1 Schiff; die Seiten wechseln sich immer ab. */
export function seaShoot(gameState: GameState, playerId: string, cell: number): SeaShotOutcome {
  const p = gameState.pendingSeaBattle;
  if (!p || !p.activeSide) return { ok: false, reason: 'Keine Schussphase im Gange.' };
  const shooter = p.activeSide;
  if ((shooter === 'attacker' ? p.attackerId : p.defenderId) !== playerId) return { ok: false, reason: 'Du bist nicht am Zug in dieser Seeschlacht.' };
  const targetSide = shooter === 'attacker' ? 'defender' : 'attacker';
  if (!Number.isInteger(cell) || !halfCells(targetSide).includes(cell)) return { ok: false, reason: 'Du kannst nur auf die gegnerische Hälfte schießen.' };
  const myShots = shooter === 'attacker' ? p.attackerShots : p.defenderShots;
  if (myShots.some((s) => s.cell === cell)) return { ok: false, reason: 'Auf dieses Feld hast du schon geschossen.' };

  const enemyFleet = targetSide === 'attacker' ? p.attackerFleet : p.defenderFleet;
  const hit = enemyFleet.includes(cell);
  const shot: SeaShot = { cell, hit };
  const newFleet = hit ? enemyFleet.filter((c) => c !== cell) : enemyFleet;
  const enemyRemaining = (targetSide === 'attacker' ? p.attackerRemaining : p.defenderRemaining) - (hit ? 1 : 0);

  let next: PendingSeaBattle = {
    ...p,
    ...(shooter === 'attacker' ? { attackerShots: [...myShots, shot] } : { defenderShots: [...myShots, shot] }),
    ...(targetSide === 'attacker'
      ? { attackerFleet: newFleet, attackerRemaining: enemyRemaining }
      : { defenderFleet: newFleet, defenderRemaining: enemyRemaining }),
    activeSide: targetSide,
  };
  if (enemyRemaining <= 0) {
    const result: SeaBattleResult = {
      territoryId: p.zoneId,
      attackerId: p.attackerId,
      defenderId: p.defenderId,
      attackerWon: shooter === 'attacker',
      sea: true,
    };
    next = { ...next, activeSide: null };
    return { ok: true, gameState: applySeaConclusion({ ...gameState, pendingSeaBattle: next }, result), concluded: result };
  }
  return { ok: true, gameState: { ...gameState, pendingSeaBattle: next }, concluded: null };
}

function applySeaConclusion(gameState: GameState, result: SeaBattleResult): GameState {
  const p = gameState.pendingSeaBattle!;
  const z = seaStateOf(gameState, p.zoneId);
  let next: GameState;
  if (result.attackerWon) {
    // Die Flotte des Verteidigers ist versenkt - Truppen an Bord gehen mit unter.
    next = setZone(gameState, p.zoneId, {
      ownerId: p.attackerId,
      ships: p.attackerRemaining,
      shipsMovedIn: p.attackerRemaining,
      embarked: EMPTY,
      embarkedMovedIn: EMPTY,
    });
  } else {
    next = setZone(gameState, p.zoneId, { ...z, ownerId: p.defenderId, ships: p.defenderRemaining, shipsMovedIn: p.defenderRemaining });
  }
  const winnerId = result.attackerWon ? p.attackerId : p.defenderId;
  const loserId = result.attackerWon ? p.defenderId : p.attackerId;
  const winnerLost = (result.attackerWon ? p.attackerShips - p.attackerRemaining : p.defenderShips - p.defenderRemaining);
  const loserLost = result.attackerWon ? p.defenderShips : p.attackerShips;
  next = addToPlayerStats(next, winnerId, { battlesWon: 1, territoriesConquered: 0, unitsLost: winnerLost, unitsDefeated: loserLost });
  next = addToPlayerStats(next, loserId, { unitsLost: loserLost, unitsDefeated: winnerLost });
  return { ...next, pendingSeaBattle: null };
}

// ------------------------------------------------------------------------------------------------
// Seeschlacht simulieren (beide Seiten müssen zustimmen, KIs stimmen immer zu)
// ------------------------------------------------------------------------------------------------

/**
 * Bietet an, die Seeschlacht zu simulieren, bzw. stimmt einem Angebot des Gegners zu. Jederzeit möglich (auch schon
 * während der Aufstellung). Haben BEIDE Seiten zugestimmt, wird sofort simulateSeaBattle ausgeführt und `concluded` gesetzt.
 */
export function proposeSeaSimulation(gameState: GameState, playerId: string): SeaShotOutcome {
  const p = gameState.pendingSeaBattle;
  if (!p) return { ok: false, reason: 'Keine Seeschlacht im Gange.' };
  const side = p.attackerId === playerId ? 'attacker' : p.defenderId === playerId ? 'defender' : null;
  if (!side) return { ok: false, reason: 'Du bist an dieser Seeschlacht nicht beteiligt.' };
  const next: PendingSeaBattle = { ...p, ...(side === 'attacker' ? { attackerSimOffer: true as const } : { defenderSimOffer: true as const }) };
  const state: GameState = { ...gameState, pendingSeaBattle: next };
  if (next.attackerSimOffer && next.defenderSimOffer) return simulateSeaBattle(state);
  return { ok: true, gameState: state, concluded: null };
}

/** Lehnt das Simulations-Angebot des Gegners ab: es verfällt, die Seeschlacht wird normal weitergespielt (er kann erneut anbieten). */
export function declineSeaSimulation(gameState: GameState, playerId: string): NavalOutcome {
  const p = gameState.pendingSeaBattle;
  if (!p) return { ok: false, reason: 'Keine Seeschlacht im Gange.' };
  if (p.attackerId !== playerId && p.defenderId !== playerId) return { ok: false, reason: 'Du bist an dieser Seeschlacht nicht beteiligt.' };
  const { attackerSimOffer: _a, defenderSimOffer: _d, ...rest } = p;
  const kept: PendingSeaBattle = p.attackerId === playerId ? { ...rest, ...(p.attackerSimOffer ? { attackerSimOffer: true as const } : {}) } : { ...rest, ...(p.defenderSimOffer ? { defenderSimOffer: true as const } : {}) };
  return { ok: true, gameState: { ...gameState, pendingSeaBattle: kept } };
}

/**
 * Trägt die laufende Seeschlacht automatisch aus - mit exakt den Regeln der manuellen Schlacht, nur ohne Klicks:
 * 1. Eine Seite, die noch nicht aufgestellt hat, bekommt eine ZUFÄLLIGE Aufstellung (autoPlaceFleet); bereits
 *    bestätigte Flotten und schon gefallene Schüsse bleiben erhalten.
 * 2. Danach wird abwechselnd geschossen (der Verteidiger beginnt, wie in der manuellen Schlacht): jede Seite wählt mit
 *    chooseAiShot ein Feld - zufällig unter den unbeschossenen Feldern der gegnerischen Hälfte, nach einem Treffer
 *    bevorzugt dessen Nachbarfelder. Ein Treffer versenkt genau 1 Schiff, bis eine Flotte ausgelöscht ist.
 * Das Ergebnis ist also die Bilanz eines echten, zufällig verlaufenden Schiffe-versenken-Spiels mit gleich guten
 * Schützen: mehr Schiffe gewinnen deutlich häufiger, aber ein Sieg ist nie sicher. Verlierer verliert alle Schiffe der
 * Schlacht (eingeschiffte Truppen des Verlierers gehen unter), der Sieger behält seine Überlebenden und besetzt die Zone
 * (applySeaConclusion).
 */
export function simulateSeaBattle(gameState: GameState): SeaShotOutcome {
  let state = gameState;
  const p0 = state.pendingSeaBattle;
  if (!p0) return { ok: false, reason: 'Keine Seeschlacht im Gange.' };
  for (const side of ['attacker', 'defender'] as const) {
    const p = state.pendingSeaBattle!;
    const deployed = side === 'attacker' ? p.attackerDeployed : p.defenderDeployed;
    if (deployed) continue;
    const id = side === 'attacker' ? p.attackerId : p.defenderId;
    const out = deploySeaFleet(state, id, autoPlaceFleet(side === 'attacker' ? p.attackerShips : p.defenderShips, side));
    if (!out.ok) return out;
    state = out.gameState;
  }
  for (let guard = 0; guard < SEA_GRID_SIZE * SEA_GRID_SIZE + 5; guard++) {
    const p = state.pendingSeaBattle;
    if (!p?.activeSide) break;
    const id = p.activeSide === 'attacker' ? p.attackerId : p.defenderId;
    const out = seaShoot(state, id, chooseAiShot(p, p.activeSide));
    if (!out.ok) return out;
    state = out.gameState;
    if (out.concluded) return { ok: true, gameState: state, concluded: out.concluded };
  }
  return { ok: false, reason: 'Die Simulation ist nicht zu Ende gekommen.' };
}

// ------------------------------------------------------------------------------------------------
// KI-Helfer (Platzierung + Zielen)
// ------------------------------------------------------------------------------------------------

/** Zufällige Aufstellung: `ships` verschiedene Kästen der eigenen Hälfte. */
export function autoPlaceFleet(ships: number, side: 'attacker' | 'defender'): number[] {
  const cells = halfCells(side);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  }
  return cells.slice(0, ships);
}

/** Zielwahl der KI: zuerst unbeschossene Nachbarfelder bisheriger Treffer, sonst ein zufälliges unbeschossenes Feld. */
export function chooseAiShot(p: PendingSeaBattle, side: 'attacker' | 'defender'): number {
  const targetSide = side === 'attacker' ? 'defender' : 'attacker';
  const shots = side === 'attacker' ? p.attackerShots : p.defenderShots;
  const fired = new Set(shots.map((s) => s.cell));
  const valid = new Set(halfCells(targetSide));
  const n = p.gridSize;
  const near: number[] = [];
  for (const s of shots) {
    if (!s.hit) continue;
    const r = Math.floor(s.cell / n);
    const c = s.cell % n;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const cell = rr * n + cc;
      if (valid.has(cell) && !fired.has(cell)) near.push(cell);
    }
  }
  const pool = near.length > 0 ? near : [...valid].filter((c) => !fired.has(c));
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/**
 * Trägt eine Seeschlacht aus, solange die aktive Seite eine KI ist: stellt fehlende KI-Flotten automatisch auf
 * und schießt für die KI, bis ein Mensch am Zug ist oder die Schlacht entschieden ist. `concluded` meldet ein Ende.
 */
export function cascadeAiSeaBattle(gameState: GameState): { readonly gameState: GameState; readonly concluded: SeaBattleResult | null } {
  let state = gameState;
  let concluded: SeaBattleResult | null = null;
  const isAi = (id: string) => state.players.find((pl) => pl.id === id)?.isAI ?? false;

  // Simulation: KIs stimmen immer zu - bei zwei KIs wird sofort automatisch simuliert, bei einem Menschen gegen eine KI
  // sobald der Mensch anbietet (die KI zieht nach).
  const first = state.pendingSeaBattle;
  if (first) {
    if (isAi(first.attackerId) && isAi(first.defenderId)) {
      const sim = simulateSeaBattle(state);
      if (sim.ok) return { gameState: sim.gameState, concluded: sim.concluded };
    }
    for (const id of [first.attackerId, first.defenderId]) {
      const p = state.pendingSeaBattle;
      if (!p || !isAi(id)) continue;
      const mine = id === p.attackerId ? p.attackerSimOffer : p.defenderSimOffer;
      const theirs = id === p.attackerId ? p.defenderSimOffer : p.attackerSimOffer;
      if (!theirs || mine) continue;
      const out = proposeSeaSimulation(state, id);
      if (out.ok) {
        state = out.gameState;
        if (out.concluded) return { gameState: state, concluded: out.concluded };
      }
    }
  }

  // Fehlende KI-Aufstellungen
  for (const side of ['attacker', 'defender'] as const) {
    const p = state.pendingSeaBattle;
    if (!p) break;
    const id = side === 'attacker' ? p.attackerId : p.defenderId;
    const deployed = side === 'attacker' ? p.attackerDeployed : p.defenderDeployed;
    if (!deployed && isAi(id)) {
      const out = deploySeaFleet(state, id, autoPlaceFleet(side === 'attacker' ? p.attackerShips : p.defenderShips, side));
      if (out.ok) state = out.gameState;
    }
  }
  for (let guard = 0; guard < 500; guard++) {
    const p = state.pendingSeaBattle;
    if (!p?.activeSide) break;
    const id = p.activeSide === 'attacker' ? p.attackerId : p.defenderId;
    if (!isAi(id)) break;
    const out = seaShoot(state, id, chooseAiShot(p, p.activeSide));
    if (!out.ok) break;
    state = out.gameState;
    if (out.concluded) {
      concluded = out.concluded;
      break;
    }
  }
  return { gameState: state, concluded };
}
