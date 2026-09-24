import type { Scenario } from '../types';

/** 1937: the Second Sino-Japanese War breaks out. Japan already holds Korea (annexed 1910),
 *  Taiwan (ceded 1895) and Manchuria (occupied 1931, the Manchukuo puppet state) - China holds
 *  everything else on the mainland, including its nominal claim on Tibet. Everywhere else on the
 *  Asia map (Southeast Asia, South Asia, the Middle East, Central Asia) starts owned by its own
 *  small nation instead of sitting unclaimed - mostly the actual 1937 sovereign states and
 *  colonial administrations of the region, see the minor factions after Japan/China below. `wars`
 *  opens the one conflict the scenario is named for - no other faction here has a fitting
 *  historical pact or war to start with (Japan's Anti-Comintern Pact partners, Germany and Italy,
 *  aren't on this map at all), so `pacts` is left unset. */
export const eastAsia1937: Scenario = {
  id: 'east-asia-1937',
  name: 'Ostasien 1937 – Zweiter Japanisch-Chinesischer Krieg',
  description: 'Japan kontrolliert bereits Korea, Taiwan und die Mandschurei und eröffnet nun die Front gegen China. Dazu 18 kleinere Nationen auf der übrigen Karte.',
  mapId: 'asia',
  wars: [['japan', 'jiangnan']],
  factions: [
    {
      name: 'Japan',
      color: '#dc2626',
      capitalId: 'japan',
      resources: 30,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'] },
      territories: [
        { territoryId: 'japan', ships: 10, garrison: { infantry: 20, lightTank: 6, heavyTank: 2, artillery: 4, motorizedInfantry: 0 } },
        { territoryId: 'mandschurei', garrison: { infantry: 15, lightTank: 4, heavyTank: 1, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'nordkorea', garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'suedkorea', garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'taiwan', ships: 2, garrison: { infantry: 5, lightTank: 0, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'China (Republik)',
      color: '#eab308',
      capitalId: 'jiangnan',
      resources: 25,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'] },
      territories: [
        { territoryId: 'jiangnan', ships: 3, garrison: { infantry: 20, lightTank: 2, heavyTank: 0, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'nordchina', garrison: { infantry: 12, lightTank: 1, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'nordwestchina', garrison: { infantry: 10, lightTank: 0, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'suedwestchina', garrison: { infantry: 14, lightTank: 1, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'zentralchina', garrison: { infantry: 14, lightTank: 1, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'suedchina', ships: 2, garrison: { infantry: 12, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'innere-mongolei', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'tibet', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    // ============================== Minor nations (fill the rest of the map) ==============================
    {
      name: 'Afghanistan',
      color: '#944242',
      capitalId: 'afghanistan',
      resources: 7,
      territories: [
        { territoryId: 'afghanistan', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Persien',
      color: '#945e42',
      capitalId: 'iran',
      resources: 7,
      territories: [
        { territoryId: 'iran', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Arabische Halbinsel',
      color: '#947942',
      capitalId: 'saudi-arabien',
      resources: 19,
      territories: [
        { territoryId: 'irak', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'saudi-arabien', garrison: { infantry: 13, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'jemen', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'kuwait', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'oman', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'katar', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'vae', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Levante',
      color: '#949442',
      capitalId: 'syrien',
      resources: 15,
      territories: [
        { territoryId: 'israel', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'jordanien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'palaestina', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'syrien', garrison: { infantry: 11, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'libanon', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Kaukasus-Republiken',
      color: '#799442',
      capitalId: 'georgien',
      resources: 11,
      territories: [
        { territoryId: 'armenien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'aserbaidschan', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'georgien', garrison: { infantry: 9, lightTank: 1, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Zentralasiatische Chanate',
      color: '#5e9442',
      capitalId: 'usbekistan',
      resources: 19,
      territories: [
        { territoryId: 'usbekistan', garrison: { infantry: 13, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'turkmenistan', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'tadschikistan', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'kirgisistan', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'aeltere-horde', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'mittlere-horde', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'juengere-horde', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Mongolei',
      color: '#429442',
      capitalId: 'mongolei',
      resources: 7,
      territories: [
        { territoryId: 'mongolei', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Nepal',
      color: '#42945e',
      capitalId: 'nepal',
      resources: 7,
      territories: [
        { territoryId: 'nepal', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Bhutan',
      color: '#429479',
      capitalId: 'bhutan',
      resources: 7,
      territories: [
        { territoryId: 'bhutan', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Siam',
      color: '#429494',
      capitalId: 'thailand',
      resources: 7,
      territories: [
        { territoryId: 'thailand', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Britisch-Indien (Nord)',
      color: '#427994',
      capitalId: 'hindustan',
      resources: 21,
      territories: [
        { territoryId: 'pakistan', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'punjab', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'kaschmir', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'west-indien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'hindustan', garrison: { infantry: 14, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'bengalen', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'nordost-indien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'bangladesch', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Britisch-Indien (Süd)',
      color: '#425e94',
      capitalId: 'dekkan',
      resources: 13,
      territories: [
        { territoryId: 'zentralindien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'dekkan', garrison: { infantry: 10, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'suedindien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'sri-lanka', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Birma',
      color: '#424294',
      capitalId: 'myanmar',
      resources: 7,
      territories: [
        { territoryId: 'myanmar', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Französisch-Indochina',
      color: '#5e4294',
      capitalId: 'vietnam',
      resources: 11,
      territories: [
        { territoryId: 'vietnam', garrison: { infantry: 9, lightTank: 1, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'laos', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'kambodscha', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Niederländisch-Ostindien',
      color: '#794294',
      capitalId: 'java-bali-nusa',
      resources: 13,
      territories: [
        { territoryId: 'java-bali-nusa', garrison: { infantry: 10, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'sumatra', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'kalimantan-sulawesi', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'papua-molukken', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Britisch-Malaya',
      color: '#944294',
      capitalId: 'west-malaysia',
      resources: 11,
      territories: [
        { territoryId: 'west-malaysia', garrison: { infantry: 9, lightTank: 1, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'ost-malaysia', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'brunei', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Philippinen',
      color: '#944279',
      capitalId: 'philippinen',
      resources: 7,
      territories: [
        { territoryId: 'philippinen', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Portugiesisch-Timor',
      color: '#94425e',
      capitalId: 'osttimor',
      resources: 7,
      territories: [
        { territoryId: 'osttimor', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
  ],
};
