import type { Scenario } from '../types';

/** August 1961: the Berlin Wall has just gone up and Europe is at its most rigidly bipolar - NATO
 *  and the Warsaw Pact are each a real alliance (see `alliances` below): members see each other's
 *  units and any war involving one of them is joined by all the rest, with a belt of genuinely
 *  non-aligned states between and around them (Switzerland, Austria, Sweden, Finland, Ireland,
 *  Franco's Spain, Tito's Yugoslavia, Cyprus). Nobody starts at war - the Cold War stayed cold in
 *  Europe itself, so `wars` is left unset. Three of the Great Powers already have the bomb, each
 *  capped at its real-world-flavored arsenal size (see engine/combat.ts's useNuke and
 *  GameState.nukeStockpiles): the Soviet Union (10, first tested 1949), the United Kingdom (5,
 *  first tested 1952) and France (5, first tested 1960) - the other 25 factions have no nuclear
 *  capability at all, matching history. */
export const coldWar1961: Scenario = {
  id: 'cold-war-1961',
  name: 'Kalter Krieg 1961 – Geteiltes Europa',
  description: 'Die Berliner Mauer steht gerade. NATO und Warschauer Pakt stehen sich mit ihren Bündnissen gegenüber - UdSSR, Frankreich und das Vereinigte Königreich verfügen bereits über Atomwaffen.',
  mapId: 'europe',
  // NATO and the Warsaw Pact as real alliances (see engine/diplomacy.ts): every member sees every
  // other member's units and joins any war one of them is in.
  alliances: [
    // NATO
    ['england', 'nord-frankreich', 'west-deutschland', 'mittel-italien', 'west-niederlande', 'belgien', 'daenemark', 'norwegen', 'island', 'portugal', 'griechenland', 'tuerkei'],
    // Warschauer Pakt
    ['zentral-russland', 'sued-polen', 'ost-deutschland', 'tschechien', 'ungarn', 'rumaenien', 'bulgarien', 'albanien'],
  ],
  factions: [
    // ============================== NATO ==============================
    {
      name: 'Vereinigtes Königreich',
      color: '#2563eb',
      capitalId: 'england',
      resources: 40,
      nukeStockpile: 5,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'], unlockedSupport: ['nuke'] },
      territories: [
        { territoryId: 'england', ships: 7, garrison: { infantry: 26, lightTank: 5, heavyTank: 2, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'schottland', ships: 5, garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'wales', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'nordirland', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'malta', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Frankreich',
      color: '#0d9488',
      capitalId: 'nord-frankreich',
      resources: 34,
      nukeStockpile: 5,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'], unlockedSupport: ['nuke'] },
      territories: [
        { territoryId: 'nord-frankreich', ships: 4, garrison: { infantry: 22, lightTank: 5, heavyTank: 2, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'ost-frankreich', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'sued-frankreich', ships: 4, garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Bundesrepublik Deutschland',
      color: '#64748b',
      capitalId: 'west-deutschland',
      resources: 31,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'west-deutschland', ships: 3, garrison: { infantry: 20, lightTank: 5, heavyTank: 2, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'sued-deutschland', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Italien',
      color: '#16a34a',
      capitalId: 'mittel-italien',
      resources: 34,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'mittel-italien', ships: 3, garrison: { infantry: 22, lightTank: 5, heavyTank: 2, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'nord-italien', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'sued-italien', ships: 4, garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Niederlande',
      color: '#ea580c',
      capitalId: 'west-niederlande',
      resources: 12,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'west-niederlande', garrison: { infantry: 10, lightTank: 1, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'ost-niederlande', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Belgien',
      color: '#eab308',
      capitalId: 'belgien',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'belgien', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Dänemark',
      color: '#dc2626',
      capitalId: 'daenemark',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'daenemark', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Norwegen',
      color: '#7c3aed',
      capitalId: 'norwegen',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'norwegen', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Island',
      color: '#0891b2',
      capitalId: 'island',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'island', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Portugal',
      color: '#059669',
      capitalId: 'portugal',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'portugal', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Griechenland',
      color: '#4f46e5',
      capitalId: 'griechenland',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'griechenland', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Türkei',
      color: '#c026d3',
      capitalId: 'tuerkei',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'tuerkei', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    // ============================== Warschauer Pakt ==============================
    {
      name: 'Sowjetunion',
      color: '#b91c1c',
      capitalId: 'zentral-russland',
      resources: 52,
      nukeStockpile: 10,
      researchState: { unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'], unlockedSupport: ['nuke'] },
      territories: [
        { territoryId: 'zentral-russland', garrison: { infantry: 34, lightTank: 5, heavyTank: 2, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'nordwest-russland', ships: 8, garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'sued-russland', ships: 5, garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'belarus', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'ukraine', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'estland', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'lettland', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'litauen', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'kaliningrad', ships: 3, garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Polen',
      color: '#e11d48',
      capitalId: 'sued-polen',
      resources: 14,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'ost-polen', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'west-polen', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'sued-polen', garrison: { infantry: 12, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'DDR',
      color: '#991b1b',
      capitalId: 'ost-deutschland',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas'], unlockedNaval: ['ships'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'ost-deutschland', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Tschechoslowakei',
      color: '#be123c',
      capitalId: 'tschechien',
      resources: 12,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'tschechien', garrison: { infantry: 10, lightTank: 1, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'slowakei', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Ungarn',
      color: '#c2410c',
      capitalId: 'ungarn',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'ungarn', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Rumänien',
      color: '#a16207',
      capitalId: 'rumaenien',
      resources: 12,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'rumaenien', garrison: { infantry: 10, lightTank: 1, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'moldau', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Bulgarien',
      color: '#9a3412',
      capitalId: 'bulgarien',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'bulgarien', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Albanien',
      color: '#78350f',
      capitalId: 'albanien',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'albanien', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    // ============================== Blockfrei / neutral ==============================
    {
      name: 'Schweiz',
      color: '#525252',
      capitalId: 'schweiz',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'schweiz', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Österreich',
      color: '#78716c',
      capitalId: 'oesterreich',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'oesterreich', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Schweden',
      color: '#0369a1',
      capitalId: 'sued-schweden',
      resources: 12,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'sued-schweden', garrison: { infantry: 10, lightTank: 1, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'nord-schweden', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Finnland',
      color: '#0e7490',
      capitalId: 'finnland',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'finnland', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Irland',
      color: '#15803d',
      capitalId: 'irland',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'irland', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Spanien',
      color: '#d97706',
      capitalId: 'nord-spanien',
      resources: 14,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'nord-spanien', garrison: { infantry: 12, lightTank: 1, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'ost-spanien', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
        { territoryId: 'sued-spanien', garrison: { infantry: 4, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Jugoslawien',
      color: '#a21caf',
      capitalId: 'serbien',
      resources: 43,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'serbien', garrison: { infantry: 28, lightTank: 5, heavyTank: 2, artillery: 3, motorizedInfantry: 0 } },
        { territoryId: 'bosnien-und-herzegowina', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'kroatien', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'montenegro', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'slowenien', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
        { territoryId: 'nordmazedonien', garrison: { infantry: 9, lightTank: 2, heavyTank: 0, artillery: 1, motorizedInfantry: 0 } },
      ],
    },
    {
      name: 'Zypern',
      color: '#a8a29e',
      capitalId: 'zypern',
      resources: 10,
      researchState: { unlockedGround: ['lightTank', 'heavyTank', 'motorizedInfantry'], unlockedAir: ['fighters', 'cas', 'bombers'], unlockedSupport: ['artillery'] },
      territories: [
        { territoryId: 'zypern', garrison: { infantry: 8, lightTank: 0, heavyTank: 0, artillery: 0, motorizedInfantry: 0 } },
      ],
    },
  ],
};
