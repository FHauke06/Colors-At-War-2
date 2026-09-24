// Schreibt public/favicon.svg (nur das Siegel mit "2"-Abzeichen, transparente Ecken) und public/app-icon.svg (Siegel auf Kartenpapier, randlos -
// Quelle für die PNG-Icons apple-touch-icon.png, icon-192.png und icon-512.png, die daraus mit einem Browser gerendert werden).
// Aufruf: npx tsx scripts/build-icons.ts
import { writeFileSync } from 'node:fs';
import { logoMarkMarkup } from '../src/ui/logo';

const INK = '#1c1b16';
const PAPER = '#f0ebdc';
const svg = (size: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${body}</svg>\n`;

writeFileSync('public/favicon.svg', svg(64, logoMarkMarkup(INK, PAPER, 'cw-mark-clip', true)));
// 96x96-Fläche: Papier als Hintergrund, das Siegel (64x64) mittig und etwas verkleinert - genug Rand für runde Maskierung.
writeFileSync(
  'public/app-icon.svg',
  svg(96, `<rect width="96" height="96" fill="${PAPER}"/><g transform="translate(9 9) scale(1.1875)">${logoMarkMarkup(INK, PAPER, 'cw-mark-clip', true)}</g>`),
);
console.log('public/favicon.svg und public/app-icon.svg geschrieben');
