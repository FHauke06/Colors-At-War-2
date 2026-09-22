import type { Scenario } from './types';
import { europe1939 } from './Europe1939/scenario';
import { eastAsia1937 } from './EastAsia1937/scenario';

export type { Scenario, ScenarioFaction, ScenarioTerritory } from './types';

/** Every playable scenario. To add a new one: create a folder here (same pattern as
 *  Europe1939/EastAsia1937 - a scenario.ts exporting one named Scenario const) and register it
 *  below. Nothing outside this folder needs to change - SetupScreen's scenario picker and
 *  LocalGameClient.fromScenario both go through SCENARIOS rather than importing a specific
 *  scenario directly. */
export const SCENARIOS: readonly Scenario[] = [europe1939, eastAsia1937];
