import type { Scenario } from '../types';

/** September 1939: Germany has just invaded Poland. Austria (1938 Anschluss), Bohemia-Moravia and
 *  Slovakia (both 1939) are already under German control; the Soviet Union, France, the UK and
 *  Italy are at their pre-war strength. Every other territory (Scandinavia, the Benelux, Iberia,
 *  the Balkans, the Baltics, Ireland, Switzerland, and a few small colonial holdings) starts owned
 *  by its own small neutral nation instead of sitting unclaimed - see the minor factions after the
 *  six Great Powers below. `wars` opens the conflict exactly where the history does: Germany vs.
 *  Poland (the invasion this scenario is named for) plus the UK's and France's declarations two
 *  days later - the Soviet Union hasn't moved on Poland's east yet (that came September 17th), and
 *  isn't at war with anyone here. `pacts` covers the two treaties that made the invasion possible
 *  in the first place: Molotov-Ribbentrop (Aug 23rd) and the Pact of Steel (May 22nd) - the latter
 *  stays a plain pact rather than an alliance, since Italy famously sat the war's first months out
 *  ("non-belligerent") instead of following Germany in. `alliances` is the Western Allies: Poland
 *  and its guarantors the UK and France (the Anglo-Polish and Franco-Polish alliances of 1939) share
 *  their units and the war against Germany, which `wars` already names for all three. */
export const europe1939: Scenario = {
  id: 'europe-1939',
  name: 'Europa 1939 – Kriegsbeginn',
  description: 'Deutschland ist gerade in Polen einmarschiert. Sechs Großmächte, jede mit ihrer historischen Startaufstellung, dazu 23 kleinere Nationen auf der übrigen Karte. Polen, das Vereinigte Königreich und Frankreich sind verbündet.',
  mapId: 'europe',
  wars: [
    ['ost-deutschland', 'ost-polen'],
    ['ost-deutschland', 'england'],
    ['ost-deutschland', 'nord-frankreich'],
  ],
  pacts: [
    ['ost-deutschland', 'zentral-russland'], // Molotov-Ribbentrop-Pakt
    ['ost-deutschland', 'mittel-italien'], // Stahlpakt
  ],
  alliances: [
    ['ost-polen', 'england', 'nord-frankreich'], // Polen und seine Garantiemächte
  ],
  factions: [
    {
      name: 'Deutsches Reich',
      color: '#18181b',
      capitalId: 'ost-deutschland',
      resources: 40,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'] },
      territories: [
        { territoryId: 'ost-deutschland', ships: 4, garrison: { infantry: 20, lightTank: 8, heavyTank: 4, artillery: 5, motorizedInfantry: 0 } },
        { territoryId: 'west-deutschland', ships: 3, garrison: { infantry: 15, lightTank: 6, heavyTank: 2, artillery: 4, motorizedInfantry: 0 } },
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
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'] },
      territories: [
        { territoryId: 'zentral-russland', garrison: { infantry: 25, lightTank: 8, heavyTank: 3, artillery: 6, motorizedInfantry: 0 } },
        { territoryId: 'nordwest-russland', ships: 3, garrison: { infantry: 12, lightTank: 3, heavyTank: 1, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'sued-russland', ships: 3, garrison: { infantry: 12, lightTank: 3, heavyTank: 1, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'belarus', garrison: { infantry: 8, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'ukraine', garrison: { infantry: 10, lightTank: 2, heavyTank: 1, artillery: 2, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Vereinigtes Königreich',
      color: '#2563eb',
      capitalId: 'england',
      resources: 30,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'] },
      territories: [
        { territoryId: 'england', ships: 8, garrison: { infantry: 15, lightTank: 4, heavyTank: 1, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'schottland', ships: 6, garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'wales', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'nordirland', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Frankreich',
      color: '#0d9488',
      capitalId: 'nord-frankreich',
      resources: 30,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'] },
      territories: [
        { territoryId: 'nord-frankreich', ships: 4, garrison: { infantry: 18, lightTank: 6, heavyTank: 2, artillery: 4, motorizedInfantry: 0 } },
        { territoryId: 'ost-frankreich', garrison: { infantry: 10, lightTank: 3, heavyTank: 1, artillery: 2, motorizedInfantry: 0 } },
        { territoryId: 'sued-frankreich', ships: 4, garrison: { infantry: 8, lightTank: 2, heavyTank: 0, artillery: 2, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Italien',
      color: '#16a34a',
      capitalId: 'mittel-italien',
      resources: 20,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'] },
      territories: [
        { territoryId: 'mittel-italien', ships: 3, garrison: { infantry: 14, lightTank: 3, heavyTank: 1, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'nord-italien', garrison: { infantry: 8, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'sued-italien', ships: 4, garrison: { infantry: 6, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    // ============================== Minor nations (fill the rest of the map) ==============================
    {
      name: 'Dänemark',
      color: '#944242',
      capitalId: 'daenemark',
      resources: 7,
      territories: [
        { territoryId: 'daenemark', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Norwegen',
      color: '#945842',
      capitalId: 'norwegen',
      resources: 7,
      territories: [
        { territoryId: 'norwegen', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Schweden',
      color: '#946c42',
      capitalId: 'sued-schweden',
      resources: 9,
      territories: [
        { territoryId: 'sued-schweden', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'nord-schweden', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Finnland',
      color: '#948242',
      capitalId: 'finnland',
      resources: 7,
      territories: [
        { territoryId: 'finnland', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Island',
      color: '#909442',
      capitalId: 'island',
      resources: 7,
      territories: [
        { territoryId: 'island', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Irland',
      color: '#7b9442',
      capitalId: 'irland',
      resources: 7,
      territories: [
        { territoryId: 'irland', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Estland',
      color: '#669442',
      capitalId: 'estland',
      resources: 7,
      territories: [
        { territoryId: 'estland', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Lettland',
      color: '#509442',
      capitalId: 'lettland',
      resources: 7,
      territories: [
        { territoryId: 'lettland', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Litauen',
      color: '#429449',
      capitalId: 'litauen',
      resources: 7,
      territories: [
        { territoryId: 'litauen', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Belgien',
      color: '#42945f',
      capitalId: 'belgien',
      resources: 7,
      territories: [
        { territoryId: 'belgien', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Niederlande',
      color: '#429475',
      capitalId: 'west-niederlande',
      resources: 9,
      territories: [
        { territoryId: 'west-niederlande', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'ost-niederlande', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Schweiz',
      color: '#429489',
      capitalId: 'schweiz',
      resources: 7,
      territories: [
        { territoryId: 'schweiz', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Spanien',
      color: '#428994',
      capitalId: 'nord-spanien',
      resources: 11,
      territories: [
        { territoryId: 'nord-spanien', garrison: { infantry: 9, lightTank: 1, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'ost-spanien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'sued-spanien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Portugal',
      color: '#427594',
      capitalId: 'portugal',
      resources: 7,
      territories: [
        { territoryId: 'portugal', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Jugoslawien',
      color: '#425f94',
      capitalId: 'serbien',
      resources: 17,
      territories: [
        { territoryId: 'bosnien-und-herzegowina', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'kroatien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'montenegro', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'serbien', garrison: { infantry: 12, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'slowenien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'nordmazedonien', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Albanien',
      color: '#424994',
      capitalId: 'albanien',
      resources: 7,
      territories: [
        { territoryId: 'albanien', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Griechenland',
      color: '#504294',
      capitalId: 'griechenland',
      resources: 7,
      territories: [
        { territoryId: 'griechenland', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Bulgarien',
      color: '#664294',
      capitalId: 'bulgarien',
      resources: 7,
      territories: [
        { territoryId: 'bulgarien', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Rumänien',
      color: '#7b4294',
      capitalId: 'rumaenien',
      resources: 9,
      territories: [
        { territoryId: 'rumaenien', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'moldau', garrison: { infantry: 3, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Ungarn',
      color: '#904294',
      capitalId: 'ungarn',
      resources: 7,
      territories: [
        { territoryId: 'ungarn', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Türkei',
      color: '#944282',
      capitalId: 'tuerkei',
      resources: 7,
      territories: [
        { territoryId: 'tuerkei', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Zypern',
      color: '#94426c',
      capitalId: 'zypern',
      resources: 7,
      territories: [
        { territoryId: 'zypern', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Malta',
      color: '#944258',
      capitalId: 'malta',
      resources: 7,
      territories: [
        { territoryId: 'malta', garrison: { infantry: 7, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
  ],
};
