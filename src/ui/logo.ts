/** Das Wappen von "Colors at War 2": ein Schild, in dem fünf unregelmäßige Gebiete (die ersten fünf Fraktionsfarben aus
 *  engine/palette.ts) mit Tintengrenzen wie auf der Spielkarte aneinanderstoßen, eine Hauptstadt-Markierung am Vierländereck -
 *  auf Kartenpapier, doppelt gerahmt. Liefert nur das Innere einer 64x64-viewBox; `ink`/`paper` sind beliebige CSS-Farben
 *  (im UI Theme-Variablen, für die statische Favicon-Datei feste Werte - siehe scripts/build-icons.ts). Mit `badge` trägt das
 *  Wappen unten rechts das rote "2"-Abzeichen - für Favicon und App-Icons, wo kein Schriftzug danebensteht. */
export function logoMarkMarkup(ink: string, paper: string, clipId = 'cw-mark-clip', badge = false): string {
  const outer = 'M9 6H55V33C55 47 45 56 32 61C19 56 9 47 9 33Z';
  const inner = 'M13.5 10.5H50.5V33C50.5 44.5 42.5 52 32 56.5C21.5 52 13.5 44.5 13.5 33Z';
  // Die Gebiete reichen über den Rand hinaus und werden am inneren Rahmen beschnitten; jede geteilte Grenze steht in beiden Polygonen.
  const regions: readonly (readonly [string, string])[] = [
    ['#dc2626', '-4,-4 30,-4 28,10 32,20 27,28 19,31 13,26 -4,29'],
    ['#2563eb', '30,-4 70,-4 70,27 54,25 45,29 38,33 27,28 32,20 28,10'],
    ['#eab308', '70,27 70,44 56,42 47,45 41,41 38,33 45,29 54,25'],
    ['#16a34a', '-4,29 13,26 19,31 27,28 38,33 41,41 33,46 26,52 24,70 -4,70'],
    ['#9333ea', '41,41 47,45 56,42 70,44 70,70 24,70 26,52 33,46'],
  ];
  return (
    `<defs><clipPath id="${clipId}"><path d="${inner}"/></clipPath></defs>` +
    `<path d="${outer}" fill="${paper}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>` +
    `<g clip-path="url(#${clipId})" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round">` +
    regions.map(([color, points]) => `<polygon points="${points}" fill="${color}"/>`).join('') +
    `</g>` +
    `<path d="${inner}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<circle cx="39.5" cy="37.5" r="3.4" fill="${paper}" stroke="${ink}" stroke-width="1.8"/>` +
    (badge
      ? // Eine blockige "2" aus einem einzigen Linienzug (kein Schriftschnitt nötig, damit die statischen Icons überall gleich aussehen).
        `<circle cx="50.5" cy="50.5" r="11.5" fill="#b3311c" stroke="${paper}" stroke-width="2.6"/>` +
        `<path d="M45.2 45.4H53.8V50.4H45.2V55.6H54.4" fill="none" stroke="#fff" stroke-width="2.7" stroke-linejoin="miter" stroke-linecap="butt"/>`
      : '')
  );
}

let markCount = 0;

/** Nur das Siegel als SVG-Element, in Theme-Farben (Tinte und Papier folgen Hell/Dunkel). Jede Instanz bekommt eine eigene
 *  clipPath-Id - sonst verwiese das zweite Logo im DOM auf das erste (und mit ihm auf dessen Sichtbarkeit). */
export function buildLogoMark(sizePx: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(sizePx));
  svg.setAttribute('height', String(sizePx));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('shrink-0');
  svg.innerHTML = logoMarkMarkup('var(--color-slate-100)', 'var(--color-slate-900)', `cw-mark-clip-${markCount++}`);
  return svg;
}

/** Siegel + Schriftzug: "COLORS" in Stencil-Versalien, darunter "AT WAR" als rot hinterlegtes Band in derselben Breite -
 *  wie ein Beschriftungsschild auf einer Kiste - und rechts die große rote "2" (es ist Colors at War 2). `sm` für die
 *  Kopfzeile, `lg` für den Startbildschirm. */
export function buildLogo(size: 'sm' | 'lg' = 'sm'): HTMLElement {
  const lg = size === 'lg';
  const wrap = document.createElement('div');
  wrap.className = `flex select-none items-center ${lg ? 'gap-5' : 'gap-3'}`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Colors at War 2');

  const text = document.createElement('div');
  text.className = 'flex flex-col items-stretch';
  const top = document.createElement('div');
  top.className = `font-stencil font-extrabold uppercase leading-[0.82] text-slate-100 ${lg ? 'text-[68px] tracking-[0.1em]' : 'text-[26px] tracking-[0.11em]'}`;
  top.textContent = 'Colors';
  const band = document.createElement('div');
  band.className = `bg-signal text-center font-stencil font-extrabold uppercase leading-none text-white ${lg ? 'mt-1.5 py-1 text-[26px] tracking-[0.62em]' : 'mt-[3px] py-[2px] text-[11px] tracking-[0.62em]'}`;
  // Der letzte Buchstabe trägt sonst noch den Zeichenabstand - ohne diesen Ausgleich wirkte das Band nach links versetzt.
  band.style.paddingLeft = '0.62em';
  band.textContent = 'at war';
  text.append(top, band);

  const sequel = document.createElement('div');
  sequel.className = `font-stencil font-extrabold leading-[0.8] text-signal ${lg ? '-ml-1 text-[132px]' : '-ml-0.5 text-[52px]'}`;
  sequel.textContent = '2';

  wrap.append(buildLogoMark(lg ? 92 : 38), text, sequel);
  return wrap;
}
