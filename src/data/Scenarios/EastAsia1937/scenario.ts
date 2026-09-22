import type { Scenario } from '../types';

/** 1937: the Second Sino-Japanese War breaks out. Japan already holds Korea (annexed 1910),
 *  Taiwan (ceded 1895) and Manchuria (occupied 1931, the Manchukuo puppet state) - China holds
 *  everything else on the mainland, including its nominal claim on Tibet. Everywhere else on the
 *  Asia map (Southeast Asia, South Asia, the Middle East, Central Asia) starts neutral/unowned. */
export const eastAsia1937: Scenario = {
  id: 'east-asia-1937',
  name: 'Ostasien 1937 – Zweiter Japanisch-Chinesischer Krieg',
  description: 'Japan kontrolliert bereits Korea, Taiwan und die Mandschurei und eröffnet nun die Front gegen China.',
  mapId: 'asia',
  factions: [
    {
      name: 'Japan',
      color: '#dc2626',
      capitalId: 'japan',
      resources: 30,
      territories: [
        { territoryId: 'japan', garrison: { infantry: 20, lightTank: 6, heavyTank: 2, artillery: 4, motorizedInfantry: 0 } },
        { territoryId: 'mandschurei', garrison: { infantry: 15, lightTank: 4, heavyTank: 1, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'nordkorea', garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'suedkorea', garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'taiwan', garrison: { infantry: 5, lightTank: 0, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'China (Republik)',
      color: '#eab308',
      capitalId: 'jiangnan',
      resources: 25,
      territories: [
        { territoryId: 'jiangnan', garrison: { infantry: 20, lightTank: 2, heavyTank: 0, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'nordchina', garrison: { infantry: 12, lightTank: 1, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'nordwestchina', garrison: { infantry: 10, lightTank: 0, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'suedwestchina', garrison: { infantry: 14, lightTank: 1, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'zentralchina', garrison: { infantry: 14, lightTank: 1, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'suedchina', garrison: { infantry: 12, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'innere-mongolei', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'tibet', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
  ],
};
