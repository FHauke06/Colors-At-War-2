import type { TerritoryData } from '../../engine/types';
import europe from './europe.json';
import asia from './asia.json';
import { EUROPE_SEA_ZONES } from './europeSeaZones';
import { ASIA_SEA_ZONES } from './asiaSeaZones';

export interface MainMapEntry {
  readonly id: string;
  readonly name: string;
  readonly data: TerritoryData;
}

/** Die JSON-Karten enthalten nur die Landgebiete - die Seezonen (Seekampf, Überseetransport) liegen pro
 *  Karte in einer eigenen Datei (z.B. europeSeaZones.ts) und werden hier dazugesetzt. */
type LandOnlyMap = Omit<TerritoryData, 'seaZones'>;

/**
 * Every playable main (strategic) map. To add a new one: drop its territories JSON (same shape as
 * europe.json - `viewBox` plus a `territories` array of {id, name, path, neighbors, centroid}) and
 * a matching sea-zone file (see europeSeaZones.ts - Land- und Seegebiete brauchen eindeutige Ids,
 * Wasserquerungen laufen NUR über die Seezonen, nicht über direkte Landnachbarschaft) into this
 * folder and add one entry here pointing at them. Nothing outside this folder needs to
 * change - src/main.ts and server/index.ts both go through defaultMainMap()/MAIN_MAPS rather than
 * importing a specific map's JSON directly.
 */
export const MAIN_MAPS: readonly MainMapEntry[] = [
  { id: 'europe', name: 'Europa', data: { ...(europe as LandOnlyMap), seaZones: EUROPE_SEA_ZONES } },
  { id: 'asia', name: 'Asien', data: { ...(asia as LandOnlyMap), seaZones: ASIA_SEA_ZONES } },
];

export const DEFAULT_MAIN_MAP_ID = 'europe';

/** The map used when nothing else was picked - resolved by id (not just index 0) so reordering
 *  MAIN_MAPS later can't silently change it. */
export function defaultMainMap(): TerritoryData {
  return mainMapById(DEFAULT_MAIN_MAP_ID);
}

/** Resolves a map picked in the setup UI (see SetupScreen's map selector) or a joining online
 *  client's lobby.mapId back to its data. Falls back to the default map for an unknown id (e.g. an
 *  older client that doesn't know about a map added later) rather than failing outright. */
export function mainMapById(id: string): TerritoryData {
  const found = MAIN_MAPS.find((m) => m.id === id);
  if (found) return found.data;
  const fallback = MAIN_MAPS.find((m) => m.id === DEFAULT_MAIN_MAP_ID);
  if (!fallback) throw new Error(`default main map "${DEFAULT_MAIN_MAP_ID}" not found in MAIN_MAPS`);
  return fallback.data;
}
