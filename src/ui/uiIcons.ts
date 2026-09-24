import { AIRCRAFT_ICON_PATHS } from '../render/aircraftIcons';
import { SHIP_ICON_PATH } from '../render/shipIcons';

/** Piktogramme für die Bedienoberfläche (Reiter, Zugleiste, Theme, Startbildschirm), 16x16 viewBox - gleiche Bauweise wie
 *  render/unitIcons.ts: kantige, gefüllte Silhouetten, die per `currentColor` die Textfarbe annehmen. Flugzeug und Schiff
 *  sind dieselben Zeichnungen wie auf der Karte. */
export const UI_ICON_PATHS = {
  // Gefaltete Karte: drei Felder im Zickzack.
  map: '<path d="M1 3.5L5 2v10.6L1 14z"/><path d="M6.2 2l3.6 1.5V14l-3.6-1.4z"/><path d="M11 3.5L15 2v10.6L11 14z"/>',
  // Fabrik: Sägedach, Schornstein, Sockel.
  resources: '<path d="M1 14V6l4 2.6V6l4 2.6V2.5h2.8v6.1H15V14z"/>',
  // Fahne an einer Stange.
  diplomacy: '<rect x="2.2" y="1.5" width="1.5" height="13.5"/><path d="M3.7 2.4h9.6l-2.3 3.2 2.3 3.2H3.7z"/>',
  airforce: AIRCRAFT_ICON_PATHS.fighters,
  naval: SHIP_ICON_PATH,
  // Erlenmeyerkolben.
  research: '<path d="M5.8 1.5h4.4v1.2h-.9v3.7l4.2 7c.5.9-.1 2-1.2 2H3.7c-1.1 0-1.7-1.1-1.2-2l4.2-7V2.7h-.9z"/>',
  // Zwei Pfeile nach rechts: nächste Runde.
  endTurn: '<path d="M1.5 2.5L8 8l-6.5 5.5z"/><path d="M8 2.5L14.5 8 8 13.5z"/>',
  // Rüstungspunkte: Münze mit Vierkant-Prägung.
  points: '<path fill-rule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 2.2a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6z"/><rect x="6.4" y="6.4" width="3.2" height="3.2"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M7.3 0.8h1.4v2.4H7.3zM7.3 12.8h1.4v2.4H7.3zM0.8 7.3h2.4v1.4H0.8zM12.8 7.3h2.4v1.4h-2.4zM2.6 3.6l1-1 1.7 1.7-1 1zM10.7 11.7l1-1 1.7 1.7-1 1zM2.6 12.4l1.7-1.7 1 1-1.7 1.7zM10.7 4.3l1.7-1.7 1 1-1.7 1.7z"/>',
  moon: '<path d="M9.5 1.2a6.9 6.9 0 1 0 5.3 9.9A5.6 5.6 0 0 1 9.5 1.2z"/>',
  // Startbildschirm: gegen den Computer (Monitor), mit Freunden (verbundene Knoten).
  computer:
    '<path fill-rule="evenodd" d="M1.5 2.5h13v8.6h-13zM3.1 4.1v5.4h9.8V4.1z"/><rect x="6.2" y="11.6" width="3.6" height="1.6"/><rect x="4" y="13.2" width="8" height="1.5"/>',
  network:
    '<circle cx="8" cy="3.4" r="2.3"/><circle cx="3.2" cy="12" r="2.3"/><circle cx="12.8" cy="12" r="2.3"/><path d="M8 3.4L3.2 12h9.6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  help: '<path fill-rule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.8 10.4h1.6v1.6H7.2zM8 3.6c-1.6 0-2.7 1-2.7 2.5h1.5c0-.7.5-1.1 1.2-1.1.7 0 1.2.4 1.2 1 0 1.2-1.9 1.3-1.9 3.2h1.5c0-1.1 1.9-1.4 1.9-3.2C10.7 4.6 9.6 3.6 8 3.6z"/>',
  close: '<path d="M2.6 4.6l2-2L8 6l3.4-3.4 2 2L10 8l3.4 3.4-2 2L8 10l-3.4 3.4-2-2L6 8z"/>',
} as const;

export type UiIconName = keyof typeof UI_ICON_PATHS;

/** Ein `currentColor`-Icon als SVG-Element - Größe in Pixeln, rein dekorativ (aria-hidden), der Text daneben trägt die Bedeutung. */
export function uiIcon(name: UiIconName, sizePx = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(sizePx));
  svg.setAttribute('height', String(sizePx));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('shrink-0');
  svg.innerHTML = UI_ICON_PATHS[name];
  return svg;
}
