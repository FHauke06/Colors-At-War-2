/**
 * Rüstungspunkte-Wert je Gebiet (siehe engine/economy.ts), abgeleitet aus realen
 * Wirtschaftsdaten statt eines pauschalen Werts pro Gebiet.
 *
 * Grundlage: aktuelles nominales BIP je Land (IMF/Worldometers), bei den geteilten Ländern
 * (Deutschland, Frankreich, Italien, Spanien, UK, Polen, Schweden, Niederlande, Russland)
 * anteilig aus offiziellen regionalen BIP-Zahlen (Destatis, INSEE/Eurostat, ISTAT, INE,
 * ONS/gov.scot, GUS/Eurostat, SCB, CBS, Rosstat) auf die im Kartengenerator definierten
 * Nord/Süd/Ost/West-Zuschnitte umgelegt. Die BIP-Werte wurden anschließend auf eine
 * Punkteskala von 1-15 gestaucht (Log-Skala mit Exponent, damit nicht fast alle "normal
 * großen" Länder im selben schmalen Band landen) - die Rangfolge folgt den realen Daten,
 * die absoluten Punktwerte sind Spielbalance, keine Wirtschaftsstatistik.
 *
 * Kein automatisch generierter Teil der Kartenpipeline (anders als territories.json) - von
 * Hand gepflegt, da wirtschaftliche Kennzahlen nicht aus der Geodaten-Quelle ableitbar sind.
 */
export const TERRITORY_RESOURCES: Readonly<Record<string, number>> = {
  albanien: 2,
  belarus: 4,
  belgien: 9,
  'bosnien-und-herzegowina': 2,
  bulgarien: 5,
  daenemark: 8,
  england: 15,
  estland: 3,
  finnland: 7,
  griechenland: 6,
  irland: 9,
  island: 2,
  kaliningrad: 1,
  kroatien: 4,
  lettland: 3,
  litauen: 4,
  malta: 2,
  'mittel-italien': 8,
  moldau: 2,
  montenegro: 1,
  'nord-frankreich': 12,
  'nord-italien': 12,
  'nord-schweden': 4,
  'nord-spanien': 8,
  nordirland: 4,
  nordmazedonien: 1,
  'nordwest-russland': 6,
  norwegen: 8,
  oesterreich: 9,
  'ost-deutschland': 10,
  'ost-frankreich': 9,
  'ost-niederlande': 9,
  'ost-polen': 8,
  'ost-spanien': 9,
  portugal: 7,
  rumaenien: 8,
  schottland: 7,
  schweiz: 11,
  serbien: 4,
  slowakei: 5,
  slowenien: 3,
  'sued-deutschland': 12,
  'sued-frankreich': 10,
  'sued-italien': 8,
  'sued-polen': 7,
  'sued-russland': 5,
  'sued-schweden': 9,
  'sued-spanien': 10,
  tschechien: 7,
  tuerkei: 11,
  ukraine: 6,
  ungarn: 6,
  wales: 5,
  'west-deutschland': 14,
  'west-niederlande': 9,
  'west-polen': 6,
  'zentral-russland': 9,
  zypern: 2,
};

/** Fallback for any territory id missing from the table above (shouldn't happen once every
 *  territory in territories.json has an entry). */
export const DEFAULT_TERRITORY_RESOURCE = 1;
