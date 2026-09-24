import type { GameState, PendingSeaBattle, SeaZone, SeaZoneState, Territory, TerritoryDevelopment, TerritoryState, UnitComposition } from './types';
import { allianceMembers } from './diplomacy';

const EMPTY_GARRISON: UnitComposition = { infantry: 0, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 };

/** A territory's garrison is visible to a viewer if they - or anyone in their alliance, "Allianzen
 *  sehen alle ihre Einheiten" - own it, or own any neighboring territory: matching how far a real
 *  front line's reconnaissance would reach, which allies share. `observerIds` is the viewer plus
 *  their allies. Ownership itself (the map's coloring) is always public; only troop counts are
 *  gated. */
function garrisonVisible(
  gameState: GameState,
  observerIds: ReadonlySet<string>,
  territoryId: string,
  neighborsById: ReadonlyMap<string, readonly string[]>,
): boolean {
  const owner = gameState.territoryState.get(territoryId)?.ownerId;
  if (owner && observerIds.has(owner)) return true;
  const neighbors = neighborsById.get(territoryId) ?? [];
  return neighbors.some((id) => {
    const neighborOwner = gameState.territoryState.get(id)?.ownerId;
    return neighborOwner !== null && neighborOwner !== undefined && observerIds.has(neighborOwner);
  });
}

/**
 * Builds the game state as `viewerId` is allowed to see it: garrisons on territories they can't
 * see (not owned by them or an ally, not adjacent to anything they or an ally own) are blanked out
 * - which also suppresses the unit-count label on the map, since a zero garrison already draws
 * nothing (see render/MapRenderer.ts). Factories/infrastructure are stricter still: visible only on
 * territories the viewer owns outright, no neighbor exception and no ally exception. Ownership,
 * resources (each player's point balance) and pendingBattle are unaffected - see engine/combat.ts's
 * own doc comments for why battle visibility already has its own rules.
 */
export function filterGameStateForViewer(
  gameState: GameState,
  viewerId: string,
  territories: readonly Territory[],
  seaZones: readonly SeaZone[] = [],
): GameState {
  const neighborsById = new Map(territories.map((t) => [t.id, t.neighbors]));
  const observerIds = new Set(allianceMembers(gameState, viewerId));

  const territoryState = new Map<string, TerritoryState>();
  for (const [id, state] of gameState.territoryState) {
    if (garrisonVisible(gameState, observerIds, id, neighborsById)) {
      territoryState.set(id, state);
    } else {
      // Allied guests standing there are troops too - hidden along with the owner's garrison.
      // Schiffe im Hafen sind ebenfalls verdeckt.
      const { guests: _guests, ships: _ships, shipsMovedIn: _moved, ...withoutGuests } = state;
      territoryState.set(id, { ...withoutGuests, garrison: EMPTY_GARRISON, movedIn: EMPTY_GARRISON, extraMoveUsed: EMPTY_GARRISON });
    }
  }

  const development = new Map<string, TerritoryDevelopment>();
  for (const [id, dev] of gameState.development) {
    if (gameState.territoryState.get(id)?.ownerId === viewerId) development.set(id, dev);
  }

  // Seezonen: Besitz und Schiffe nur in der Nähe eigener (oder verbündeter) Gebiete/Zonen sichtbar - analog zu
  // Garnisonen an Land; alles andere erscheint neutral.
  const zoneById = new Map(seaZones.map((z) => [z.id, z]));
  const seaState = new Map<string, SeaZoneState>();
  for (const [id, zone] of gameState.seaZones) {
    const neighbors = zoneById.get(id)?.neighbors ?? [];
    const visible =
      (zone.ownerId !== null && observerIds.has(zone.ownerId)) ||
      neighbors.some((n) => {
        const owner = gameState.territoryState.get(n)?.ownerId ?? gameState.seaZones.get(n)?.ownerId;
        return owner !== null && owner !== undefined && observerIds.has(owner);
      });
    // Besitz hängt an den Schiffen: eine Zone außer Sichtweite erscheint neutral (Eintrag fehlt).
    if (visible) seaState.set(id, zone);
  }

  return { ...gameState, territoryState, development, seaZones: seaState, pendingSeaBattle: filterSeaBattle(gameState.pendingSeaBattle, viewerId) };
}

/** Verdeckte Aufstellung: die noch schwimmenden Schiffe einer Seite sieht nur ihr Besitzer. */
function filterSeaBattle(pending: PendingSeaBattle | null, viewerId: string): PendingSeaBattle | null {
  if (!pending) return null;
  return {
    ...pending,
    attackerFleet: pending.attackerId === viewerId ? pending.attackerFleet : [],
    defenderFleet: pending.defenderId === viewerId ? pending.defenderFleet : [],
  };
}
