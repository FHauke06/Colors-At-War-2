// Regenerates src/data/territories.json from public geodata sources.
//
// Run manually with `npm run generate:map` when the territory split needs to change.
// Not part of the normal build - the app only ever reads the committed JSON output.
//
// Pipeline: fetch country- and region-level borders -> group regions into the game's
// territories (large countries split along historical lines, e.g. Germany into
// West/Süd/Ost) -> union each group into one polygon with turf -> simplify
// (Douglas-Peucker) -> derive a neighbor table from geometric proximity (a 20km
// buffer, so independently-simplified shared borders still touch) plus a short
// curated list of sea lanes (Channel, North Channel, Skagerrak, ...) that no
// buffer distance would both catch and not over-connect -> project to a flat
// SVG-ready coordinate space and emit id/name/path/neighbors/centroid per territory.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as turf from '@turf/turf';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '../src/data/territories.json');

const SOURCES = {
  base: 'https://raw.githubusercontent.com/leakyMirror/map-of-europe/master/GeoJSON/europe.geojson',
  germany: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/germany.geojson',
  franceRegions: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/france-regions.geojson',
  italyRegions: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/italy-regions.geojson',
  spainCommunities: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/spain-communities.geojson',
  unitedKingdom: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/united-kingdom.geojson',
  poland: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/poland.geojson',
  swedenCounties: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/sweden-counties.geojson',
  netherlands: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/the-netherlands.geojson',
  russia: 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/russia.geojson',
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function loadSources() {
  const entries = await Promise.all(
    Object.entries(SOURCES).map(async ([key, url]) => [key, await fetchJson(url)])
  );
  return Object.fromEntries(entries);
}

// ---------- geometry helpers ----------

function polygonToRings(geometry, maxLat = 68) {
  // Outer boundaries only (no donut holes at this map scale); drops remote arctic
  // islands (Franz Josef Land, Novaya Zemlya) that would otherwise blow out the bbox.
  const rings = [];
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    const minLat = Math.min(...ring.map(([, lat]) => lat));
    if (minLat > maxLat) continue;
    rings.push(ring);
  }
  return rings;
}

function perpDist(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
function simplify(points, epsilon) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > epsilon) {
    const left = simplify(points.slice(0, idx + 1), epsilon);
    const right = simplify(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}
const EPS_DEGREES = 0.03; // ~3.3km at this latitude - far finer than the 20km adjacency buffer

const slug = (s) => s.toLowerCase()
  .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]))
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

function unionByGroups(features, groupMap, nameProp = 'name') {
  const results = [];
  for (const [label, units] of Object.entries(groupMap)) {
    const unitSet = new Set(units);
    const feats = features.filter((f) => unitSet.has(f.properties[nameProp]));
    if (feats.length === 0) { console.warn('EMPTY GROUP', label); continue; }
    const merged = feats.length === 1
      ? feats[0]
      : turf.union(turf.featureCollection(feats.map((f) => turf.feature(f.geometry))));
    results.push({ name: label, rings: polygonToRings(merged.geometry) });
  }
  return results;
}

// English source names -> German, for the countries kept as a single territory.
const NAME_DE = {
  Albania: 'Albanien', Austria: 'Österreich', Belarus: 'Belarus', Belgium: 'Belgien',
  'Bosnia and Herzegovina': 'Bosnien und Herzegowina', Bulgaria: 'Bulgarien', Croatia: 'Kroatien',
  Cyprus: 'Zypern', 'Czech Republic': 'Tschechien', Denmark: 'Dänemark', Estonia: 'Estland',
  Finland: 'Finnland', Greece: 'Griechenland', Hungary: 'Ungarn', Iceland: 'Island',
  Ireland: 'Irland', Latvia: 'Lettland', Lithuania: 'Litauen', Macedonia: 'Nordmazedonien',
  Malta: 'Malta', Moldova: 'Moldau', Montenegro: 'Montenegro', Norway: 'Norwegen',
  Portugal: 'Portugal', Romania: 'Rumänien', Serbia: 'Serbien', Slovakia: 'Slowakei',
  Slovenia: 'Slowenien', Switzerland: 'Schweiz', Turkey: 'Türkei', Ukraine: 'Ukraine',
};

const SUBDIVIDED_COUNTRIES = new Set([
  'Germany', 'France', 'Italy', 'Spain', 'United Kingdom', 'Poland', 'Sweden', 'Netherlands', 'Russia',
]);
// Micro-states folded into a neighbor rather than kept as their own (unplayable-sized) territory.
const MICRO_MERGE = {
  Andorra: 'Spain', Monaco: 'France', Liechtenstein: 'Switzerland',
  'San Marino': 'Italy', 'Holy See (Vatican City)': 'Italy', Luxembourg: 'Belgium',
  'The former Yugoslav Republic of Macedonia': 'Macedonia', 'Republic of Moldova': 'Moldova',
};
// Outside the game's scope: Caucasus states, Levant, and non-European exclaves/islands.
const EXCLUDE = new Set(['Armenia', 'Azerbaijan', 'Georgia', 'Israel', 'Faroe Islands']);

function buildTerritories(src) {
  const territories = [];

  // Countries kept whole (with micro-states folded in, and Andorra/Monaco/San
  // Marino/Vatican deferred to their target country's dedicated block below).
  const wholeGroups = new Map();
  for (const f of src.base.features) {
    const orig = f.properties.NAME;
    if (EXCLUDE.has(orig)) continue;
    if (SUBDIVIDED_COUNTRIES.has(orig)) continue;
    if (orig === 'Andorra') continue;
    let name = MICRO_MERGE[orig] || orig;
    if (SUBDIVIDED_COUNTRIES.has(name)) continue; // folds into a subdivided country, handled there
    name = NAME_DE[name] || name;
    if (!wholeGroups.has(name)) wholeGroups.set(name, []);
    wholeGroups.get(name).push(...polygonToRings(f.geometry));
  }
  for (const [name, rings] of wholeGroups) territories.push({ name, rings });

  // Germany: West/Süd/Ost. Ost = former DDR; Süd = Bayern + Baden-Württemberg
  // (independent kingdoms until 1871); West = the remaining former BRD states.
  territories.push(...unionByGroups(src.germany.features, {
    'West-Deutschland': ['Nordrhein-Westfalen', 'Niedersachsen', 'Bremen', 'Hamburg', 'Schleswig-Holstein', 'Hessen', 'Rheinland-Pfalz', 'Saarland'],
    'Süd-Deutschland': ['Baden-Württemberg', 'Bayern'],
    'Ost-Deutschland': ['Berlin', 'Brandenburg', 'Mecklenburg-Vorpommern', 'Sachsen', 'Sachsen-Anhalt', 'Thüringen'],
  }));

  // France: Nord/Ost/Süd. Monaco folds into Süd-Frankreich.
  const franceRegions = src.franceRegions.features;
  const monacoFeat = src.base.features.find((f) => f.properties.NAME === 'Monaco');
  territories.push(...unionByGroups(franceRegions, {
    'Nord-Frankreich': ['Nord-Pas de Calais', 'Picardy', 'Ile-de-France', 'Upper Normandy', 'Lower Normandy', 'Brittany', 'Pays-de-la-Loire', 'Centre'],
    'Ost-Frankreich': ['Alsace', 'Lorraine', 'Champagne-Ardenne', 'Franche-Comté', 'Burgundy', 'Rhone-Alpes', 'Auvergne'],
  }));
  {
    const units = new Set(['Aquitaine', 'Midi-Pyrenées', 'Languedoc-Roussilion', "Provence-Alpes-Cote d'Azur", 'Corsica', 'Limousin', 'Poitou-Charentes']);
    const feats = franceRegions.filter((f) => units.has(f.properties.name)).map((f) => turf.feature(f.geometry));
    if (monacoFeat) feats.push(turf.feature(monacoFeat.geometry));
    const merged = turf.union(turf.featureCollection(feats));
    territories.push({ name: 'Süd-Frankreich', rings: polygonToRings(merged.geometry) });
  }

  // Italy: Nord/Mitte/Süd, echoing Kgr. Italien / Kirchenstaat / Kgr. beider Sizilien.
  // San Marino + Vatican fold into Mittel-Italien.
  const italyRegions = src.italyRegions.features;
  const sanMarinoFeat = src.base.features.find((f) => f.properties.NAME === 'San Marino');
  const vaticanFeat = src.base.features.find((f) => f.properties.NAME === 'Holy See (Vatican City)');
  territories.push(...unionByGroups(italyRegions, {
    'Nord-Italien': ['Piemonte', "Valle D'Aosta/Vallée D'Aoste", 'Lombardia', 'Veneto', 'Trentino-Alto Adige/Sudtirol', 'Friuli Venezia Giulia', 'Liguria', 'Emilia-Romagna'],
    'Süd-Italien': ['Campania', 'Puglia', 'Basilicata', 'Calabria', 'Sicilia', 'Sardegna'],
  }));
  {
    const units = new Set(['Toscana', 'Umbria', 'Marche', 'Lazio', 'Abruzzo', 'Molise']);
    const feats = italyRegions.filter((f) => units.has(f.properties.name)).map((f) => turf.feature(f.geometry));
    if (sanMarinoFeat) feats.push(turf.feature(sanMarinoFeat.geometry));
    if (vaticanFeat) feats.push(turf.feature(vaticanFeat.geometry));
    const merged = turf.union(turf.featureCollection(feats));
    territories.push({ name: 'Mittel-Italien', rings: polygonToRings(merged.geometry) });
  }

  // Spain: Nord/Ost/Süd, echoing Kastilien-León+Baskenland / Krone Aragón / Andalusien-Zentrum.
  // Andorra folds into Nord-Spanien. Ceuta/Melilla/Kanaren excluded (non-European exclaves).
  const spainRegions = src.spainCommunities.features;
  const andorraFeat = src.base.features.find((f) => f.properties.NAME === 'Andorra');
  {
    const units = new Set(['Galicia', 'Asturias', 'Cantabria', 'Castilla-Leon', 'Pais Vasco', 'La Rioja', 'Navarra']);
    const feats = spainRegions.filter((f) => units.has(f.properties.name)).map((f) => turf.feature(f.geometry));
    if (andorraFeat) feats.push(turf.feature(andorraFeat.geometry));
    const merged = turf.union(turf.featureCollection(feats));
    territories.push({ name: 'Nord-Spanien', rings: polygonToRings(merged.geometry) });
  }
  territories.push(...unionByGroups(spainRegions, {
    'Ost-Spanien': ['Cataluña', 'Aragon', 'Valencia', 'Baleares'],
    'Süd-Spanien': ['Madrid', 'Castilla-La Mancha', 'Extremadura', 'Murcia', 'Andalucia'],
  }));

  // United Kingdom: the four historical nations.
  const ukUnits = src.unitedKingdom.features;
  const SCOTLAND = new Set(['Clackmannanshire', 'Aberdeenshire', 'East Renfrewshire', 'Argyll and Bute', 'Dumfries and Galloway', 'Eilean Siar', 'Highland', 'North Ayrshire', 'Orkney Islands', 'Shetland Islands', 'Aberdeen', 'Angus', 'Dundee', 'East Ayrshire', 'Edinburgh', 'Renfrewshire', 'East Lothian', 'Fife', 'Glasgow', 'Moray', 'South Lanarkshire', 'West Lothian', 'Perthshire and Kinross', 'Stirling', 'West Dunbartonshire', 'Scottish Borders', 'South Ayrshire', 'Falkirk', 'East Dunbartonshire', 'Midlothian', 'North Lanarkshire', 'Inverclyde']);
  const WALES = new Set(['Pembrokeshire', 'Torfaen', 'Gwynedd', 'Cardiff', 'Newport', 'Caerphilly', 'Bridgend', 'Anglesey', 'Blaenau Gwent', 'Carmarthenshire', 'Ceredigion', 'Conwy', 'Denbighshire', 'Flintshire', 'Merthyr Tydfil', 'Monmouthshire', 'Neath Port Talbot', 'Swansea', 'Powys', 'Rhondda, Cynon, Taff', 'Vale of Glamorgan', 'Wrexham']);
  const NORTHERN_IRELAND = new Set(['Newtownabbey', 'North Down', 'Belfast', 'Castlereagh', 'Magherafelt', 'Limavady', 'Lisburn', 'Craigavon', 'Cookstown', 'Coleraine', 'Ballymena', 'Armagh', 'Antrim', 'Ballymoney', 'Banbridge', 'Ards', 'Fermanagh', 'Down', 'Dungannon', 'Strabane', 'Omagh', 'Derry', 'Larne', 'Moyle', 'Newry and Mourne', 'Carrickfergus']);
  function ukUnion(nameSet, label) {
    const feats = ukUnits.filter((f) => nameSet.has(f.properties.name)).map((f) => turf.feature(f.geometry));
    const merged = turf.union(turf.featureCollection(feats));
    territories.push({ name: label, rings: polygonToRings(merged.geometry) });
  }
  ukUnion(SCOTLAND, 'Schottland');
  ukUnion(WALES, 'Wales');
  ukUnion(NORTHERN_IRELAND, 'Nordirland');
  const nonEngland = new Set([...SCOTLAND, ...WALES, ...NORTHERN_IRELAND]);
  ukUnion(new Set(ukUnits.map((f) => f.properties.name).filter((n) => !nonEngland.has(n))), 'England');

  // Poland: West/Ost/Süd, echoing the former Prussian/Russian/Austrian partition zones.
  territories.push(...unionByGroups(src.poland.features, {
    'West-Polen': ['Pomorskie', 'Zachodniopomorskie', 'Kujawsko-Pomorskie', 'Lubuskie', 'Wielkopolskie'],
    'Ost-Polen': ['Mazowieckie', 'Łódzkie', 'Lubelskie', 'Podlaskie', 'Warmińsko-Mazurskie', 'Świętokrzyskie'],
    'Süd-Polen': ['Dolnośląskie', 'Opolskie', 'Śląskie', 'Małopolskie', 'Podkarpackie'],
  }));

  // Sweden: Süd (Svea-/Götaland) / Nord (Norrland) - the traditional cultural macro-regions.
  territories.push(...unionByGroups(src.swedenCounties.features, {
    'Süd-Schweden': ['Skåne', 'Halland', 'Blekinge', 'Kalmar', 'Kronoberg', 'Jönköping', 'Östergötland', 'Västra Götaland', 'Gotland', 'Södermanland', 'Stockholm', 'Uppsala', 'Västmanland', 'Örebro'],
    'Nord-Schweden': ['Värmland', 'Dalarna', 'Gävleborg', 'Västernorrland', 'Jämtland', 'Västerbotten', 'Norrbotten'],
  }));

  // Netherlands: West ("Holland" proper) / Ost (the Republic's other historic provinces).
  territories.push(...unionByGroups(src.netherlands.features, {
    'West-Niederlande': ['Noord-Holland', 'Zuid-Holland', 'Utrecht', 'Zeeland', 'Flevoland'],
    'Ost-Niederlande': ['Groningen', 'Friesland', 'Drenthe', 'Overijssel', 'Gelderland', 'Noord-Brabant', 'Limburg'],
  }));

  // European Russia only: Nordwest/Zentral/Süd (Volga+Kaukasus), plus the Kaliningrad
  // exclave as its own small territory (it has no land link to the rest of the group).
  territories.push(...unionByGroups(src.russia.features, {
    'Nordwest-Russland': ['Карелия', 'Республика Карелия', 'Коми', 'Республика Коми', 'Архангельская область', 'Ненецкий автономный округ', 'Вологодская область', 'Ленинградская область', 'Мурманская область', 'Новгородская область', 'Псковская область', 'Санкт-Петербург'],
    'Zentral-Russland': ['Белгородская область', 'Брянская область', 'Владимирская область', 'Воронежская область', 'Ивановская область', 'Калужская область', 'Костромская область', 'Курская область', 'Липецкая область', 'Московская область', 'Москва', 'Орловская область', 'Рязанская область', 'Смоленская область', 'Тамбовская область', 'Тверская область', 'Тульская область', 'Ярославская область'],
    'Süd-Russland': ['Адыгея', 'Республика Калмыкия', 'Краснодарский край', 'Астраханская область', 'Волгоградская область', 'Ростовская область', 'Ставропольский край', 'Дагестан', 'Ингушетия', 'Кабардино-Балкарская республика', 'Карачаево-Черкесская республика', 'Северная Осетия - Алания', 'Чеченская республика', 'Башкортостан', 'Кировская область', 'Марий Эл', 'Республика Мордовия', 'Нижегородская область', 'Оренбургская область', 'Пензенская область', 'Пермский край', 'Самарская область', 'Саратовская область', 'Татарстан', 'Удмуртская республика', 'Ульяновская область', 'Чувашия'],
    Kaliningrad: ['Калининградская область'],
  }));

  return territories;
}

// ---------- adjacency ----------

const ADJACENCY_BUFFER_KM = 20; // bridges independent-simplification gaps + narrow straits (Öresund, Dover, North Channel)

// Sea lanes wider than the buffer above but too important to leave unreachable.
const EXTRA_ADJACENCY_PAIRS = [
  ['england', 'nord-frankreich'],  // Dover-Calais
  ['nordirland', 'schottland'],    // North Channel
  ['daenemark', 'norwegen'],       // Skagerrak
  ['malta', 'sued-italien'],       // Sicilian Channel
  ['zypern', 'tuerkei'],           // closest mainland
  ['zypern', 'griechenland'],      // cultural/historical tie
  ['island', 'schottland'],
  ['island', 'norwegen'],
];

function computeAdjacency(territories) {
  const simplified = territories.map((t) => ({
    name: t.name,
    rings: t.rings.map((r) => simplify(r, EPS_DEGREES)).filter((r) => r.length >= 4), // JSTS needs closed rings with >=4 points
  }));
  for (const t of simplified) {
    if (t.rings.length === 0) console.warn('NO RINGS LEFT after simplify for', t.name);
  }

  const withIds = simplified.map((t) => ({ ...t, id: slug(t.name) }));
  const turfFeatures = withIds.map((t) => turf.multiPolygon(t.rings.map((r) => [r])));
  const buffered = turfFeatures.map((f) => turf.buffer(f, ADJACENCY_BUFFER_KM, { units: 'kilometers' }));

  const neighbors = new Map(withIds.map((t) => [t.id, new Set()]));
  for (let i = 0; i < withIds.length; i++) {
    for (let j = i + 1; j < withIds.length; j++) {
      if (turf.booleanIntersects(buffered[i], turfFeatures[j])) {
        neighbors.get(withIds[i].id).add(withIds[j].id);
        neighbors.get(withIds[j].id).add(withIds[i].id);
      }
    }
  }
  for (const [a, b] of EXTRA_ADJACENCY_PAIRS) {
    if (!neighbors.has(a) || !neighbors.has(b)) {
      console.warn('EXTRA_ADJACENCY_PAIRS: unknown id in', [a, b]);
      continue;
    }
    neighbors.get(a).add(b);
    neighbors.get(b).add(a);
  }

  return { simplified: withIds, turfFeatures, neighbors };
}

// ---------- projection + SVG output ----------

const PROJECTION_LAT0 = 54; // reference latitude for the cos() aspect correction (central Europe)
const cosLat0 = Math.cos((PROJECTION_LAT0 * Math.PI) / 180);
function project([lon, lat]) {
  return [lon * cosLat0, -lat]; // flip so north is up; not a true geographic projection, just a flat game-board space
}
function ringToPath(ring) {
  return 'M' + ring.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L') + 'Z';
}

async function main() {
  console.log('fetching source geometries...');
  const src = await loadSources();

  const territories = buildTerritories(src);
  console.log('territories:', territories.length);

  const { simplified, turfFeatures, neighbors } = computeAdjacency(territories);

  let bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const out = simplified.map((t, i) => {
    const projRings = t.rings.map((r) => r.map(project));
    for (const r of projRings) for (const [x, y] of r) {
      if (x < bbox[0]) bbox[0] = x;
      if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x;
      if (y > bbox[3]) bbox[3] = y;
    }
    const [lon, lat] = turf.centerOfMass(turfFeatures[i]).geometry.coordinates;
    const [cx, cy] = project([lon, lat]);
    return {
      id: t.id,
      name: t.name,
      path: projRings.map(ringToPath).join(' '),
      neighbors: [...neighbors.get(t.id)].sort(),
      centroid: [Number(cx.toFixed(2)), Number(cy.toFixed(2))],
    };
  });

  const [minX, minY, maxX, maxY] = bbox;
  const pad = 1;
  const viewBox = `${(minX - pad).toFixed(2)} ${(minY - pad).toFixed(2)} ${(maxX - minX + 2 * pad).toFixed(2)} ${(maxY - minY + 2 * pad).toFixed(2)}`;

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ viewBox, territories: out }, null, 2));
  console.log('wrote', OUT_FILE, '-', out.length, 'territories, viewBox', viewBox);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
