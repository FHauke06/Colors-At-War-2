import type { Scenario } from '../types';

/** September 1939: Germany has just invaded Poland. Austria (1938 Anschluss), Bohemia-Moravia and
 *  Slovakia (both 1939) are already under German control; the Soviet Union, France, the UK and
 *  Italy are at their pre-war strength. Everything not listed below (Scandinavia, the Benelux,
 *  Iberia, the Balkans, the Baltics, Ireland, Switzerland) starts neutral/unowned, same as any
 *  other territory in a normal game. */
export const europe1939: Scenario = {
  id: 'europe-1939',
  name: 'Europa 1939 – Kriegsbeginn',
  description: 'Deutschland ist gerade in Polen einmarschiert. Sechs Großmächte, jede mit ihrer historischen Startaufstellung.',
  mapId: 'europe',
  factions: [
    {
      name: 'Deutsches Reich',
      color: '#18181b',
      capitalId: 'ost-deutschland',
      resources: 40,
      territories: [
        { territoryId: 'ost-deutschland', garrison: { infantry: 20, lightTank: 8, heavyTank: 4, artillery: 5, motorizedInfantry: 0 } },
        { territoryId: 'west-deutschland', garrison: { infantry: 15, lightTank: 6, heavyTank: 2, artillery: 4, motorizedInfantry: 0 } },
        { territoryId: 'sued-deutschland', garrison: { infantry: 12, lightTank: 4, heavyTank: 2, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'oesterreich', garrison: { infantry: 8, lightTank: 2, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'tschechien', garrison: { infantry: 8, lightTank: 2, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'kaliningrad', garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'slowakei', garrison: { infantry: 5, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Polen',
      color: '#eab308',
      capitalId: 'ost-polen',
      resources: 15,
      territories: [
        { territoryId: 'ost-polen', garrison: { infantry: 15, lightTank: 3, heavyTank: 0, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'west-polen', garrison: { infantry: 10, lightTank: 2, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'sued-polen', garrison: { infantry: 8, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Sowjetunion',
      color: '#dc2626',
      capitalId: 'zentral-russland',
      resources: 35,
      territories: [
        { territoryId: 'zentral-russland', garrison: { infantry: 25, lightTank: 8, heavyTank: 3, artillery: 6, motorizedInfantry: 0 } },
        { territoryId: 'nordwest-russland', garrison: { infantry: 12, lightTank: 3, heavyTank: 1, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'sued-russland', garrison: { infantry: 12, lightTank: 3, heavyTank: 1, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'belarus', garrison: { infantry: 8, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'ukraine', garrison: { infantry: 10, lightTank: 2, heavyTank: 1, artillery: 2, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Vereinigtes Königreich',
      color: '#2563eb',
      capitalId: 'england',
      resources: 30,
      territories: [
        { territoryId: 'england', garrison: { infantry: 15, lightTank: 4, heavyTank: 1, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'schottland', garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'wales', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'nordirland', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Frankreich',
      color: '#0d9488',
      capitalId: 'nord-frankreich',
      resources: 30,
      territories: [
        { territoryId: 'nord-frankreich', garrison: { infantry: 18, lightTank: 6, heavyTank: 2, artillery: 4, motorizedInfantry: 0 } },
        { territoryId: 'ost-frankreich', garrison: { infantry: 10, lightTank: 3, heavyTank: 1, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'sued-frankreich', garrison: { infantry: 8, lightTank: 2, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Italien',
      color: '#16a34a',
      capitalId: 'mittel-italien',
      resources: 20,
      territories: [
        { territoryId: 'mittel-italien', garrison: { infantry: 14, lightTank: 3, heavyTank: 1, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'nord-italien', garrison: { infantry: 8, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'sued-italien', garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
  ],
};
