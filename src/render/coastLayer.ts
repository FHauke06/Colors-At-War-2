import type { TerritoryData } from '../engine/types';

/**
 * Die Küstenlinien der Karte: zwei weiche Wasserbänder außen an jeder Küste ("coastal echo", wie bei einer gedruckten Seekarte) und
 * darüber die Küstenlinie in Tinte. Alles wird auf das Wasser beschnitten (die Vereinigung aller Seezonen) - übrig bleibt jeweils nur
 * die äußere Hälfte der Linie, und auf dem Papier neben dem Land (dort ist die Karte einfach zu Ende) erscheint nichts.
 *
 * Als <canvas> statt als SVG-Gruppe, weil das die Kosten aus dem laufenden Spiel nimmt: Breite Striche auf den riesigen Küstenpfaden,
 * beschnitten mit den Seezonen, waren so teuer, dass jedes Hovern (und jeder Wechsel zurück von einem ausgeblendeten Reiter) sie neu
 * rasterte - gemessen 25 statt 17 ms pro Mausschritt. Hier wird die Ebene einmal gezeichnet und danach nur noch bei einer anderen
 * Größe oder einem Theme-Wechsel neu (ein Bitmap überlebt display:none). Die Linienbreiten sind Bildschirm-Pixel, wie zuvor.
 */

/** [Breite in Pixeln, Deckkraft] der beiden Wasserbänder, breites zuerst. */
const ECHO_BANDS: readonly (readonly [number, number])[] = [[12, 0.24], [5.5, 0.34]];
const COAST_INK = '#1c1b16';
const COAST_INK_WIDTH = 1.8;
const COAST_INK_ALPHA = 0.92;
/** Größte Breite des Bitmaps in Geräte-Pixeln - darüber wird kleiner gezeichnet und vom Browser hochskaliert. */
const MAX_BITMAP_WIDTH = 3072;
const REDRAW_DELAY_MS = 120;

/** Alle Canvas-Ebenen, die auf einen Theme-Wechsel (Klassenwechsel an <html>) reagieren müssen. */
const layers = new Set<{ readonly canvas: HTMLCanvasElement; readonly refresh: () => void }>();
let themeObserver: MutationObserver | null = null;

function watchTheme(layer: { readonly canvas: HTMLCanvasElement; readonly refresh: () => void }): void {
  layers.add(layer);
  if (themeObserver) return;
  themeObserver = new MutationObserver(() => {
    for (const l of layers) {
      // Ebenen, die nicht mehr im Dokument hängen (ein anderer Bildschirm hat sie ersetzt), räumen sich hier selbst weg.
      if (!l.canvas.isConnected) layers.delete(l);
      else l.refresh();
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

export function createCoastLayer(data: TerritoryData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'pointer-events-none absolute inset-0 h-full w-full';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const [x0, y0, viewBoxWidth] = data.viewBox.split(/\s+/).map(Number) as [number, number, number];
  const sea = new Path2D();
  for (const zone of data.seaZones) sea.addPath(new Path2D(zone.path));
  const lands = data.territories.map((t) => new Path2D(t.path));

  let drawnKey = '';
  let timer: number | undefined;

  const draw = (): void => {
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) return; // ausgeblendet: das Bitmap bleibt, wie es ist
    const echoColor = getComputedStyle(canvas).getPropertyValue('--color-sea-line').trim() || '#a3b8b8';
    const dpr = window.devicePixelRatio || 1;
    const ratio = Math.min(dpr, MAX_BITMAP_WIDTH / cssWidth);
    const width = Math.round(cssWidth * ratio);
    const height = Math.round(cssHeight * ratio);
    const key = `${width}x${height}|${echoColor}`;
    if (key === drawnKey) return;
    drawnKey = key;

    canvas.width = width;
    canvas.height = height;
    // Karteneinheiten -> Bitmap-Pixel; die Linienbreiten stehen in Bildschirm-Pixeln (wie vector-effect: non-scaling-stroke).
    const scale = width / viewBoxWidth;
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    ctx.lineJoin = 'round';
    ctx.save();
    ctx.clip(sea, 'evenodd');
    ctx.strokeStyle = echoColor;
    for (const [pixels, alpha] of ECHO_BANDS) {
      ctx.lineWidth = (pixels * ratio) / scale;
      ctx.globalAlpha = alpha;
      for (const land of lands) ctx.stroke(land);
    }
    ctx.strokeStyle = COAST_INK;
    ctx.lineWidth = (COAST_INK_WIDTH * ratio) / scale;
    ctx.globalAlpha = COAST_INK_ALPHA;
    for (const land of lands) ctx.stroke(land);
    ctx.restore();
  };

  /** Größenänderungen laufen entprellt (beim Ziehen am Fenster nicht bei jedem Schritt neu zeichnen); bis dahin skaliert das Bitmap. */
  const schedule = (delay: number): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(draw, delay);
  };

  new ResizeObserver(() => schedule(drawnKey ? REDRAW_DELAY_MS : 0)).observe(canvas);
  watchTheme({ canvas, refresh: () => schedule(0) });
  return canvas;
}
