import type { Scenario } from './types';
import { europe1939 } from './Europe1939/scenario';
import { eastAsia1937 } from './EastAsia1937/scenario';
import { coldWar1961 } from './ColdWar1961/scenario';

export type { Scenario, ScenarioFaction, ScenarioTerritory } from './types';

/** Every playable scenario. To add a new one: create a folder here (same pattern as
 *  Europe1939/EastAsia1937/ColdWar1961 - a scenario.ts exporting one named Scenario const) and
 *  register it below. Nothing outside this folder needs to change - SetupScreen's scenario picker
 *  and session.ts's createLobby both go through SCENARIOS rather than importing a specific
 *  scenario directly. */
export const SCENARIOS: readonly Scenario[] = [europe1939, eastAsia1937, coldWar1961];

/** Ein Szenario per Id (z.B. LobbyState.scenarioId) - undefined, wenn es keins mit dieser Id gibt. */
export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((sc) => sc.id === id);
}
