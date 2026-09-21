import type { AirComposition } from '../engine/types';

export const AIRCRAFT_TYPES: readonly (keyof AirComposition)[] = ['fighters', 'cas', 'bombers'];

export const AIRCRAFT_LABELS: Record<keyof AirComposition, string> = {
  fighters: 'Jäger',
  cas: 'CAS',
  bombers: 'Bomber',
};

/** Small hand-drawn top-down aircraft pictograms, 16x16 viewBox - same convention as
 *  render/unitIcons.ts's UNIT_ICON_PATHS, shared between the Flugplatz label on the main map
 *  (MapRenderer.ts) and any HTML aircraft icon (GameScreen.ts, filled via currentColor). Silhouette
 *  differs by role: Jäger is a slim swept-wing single-tail jet, CAS a stubbier straight-wing
 *  attack plane, Bomber a bulky swept-wing twin-tail heavy. */
export const AIRCRAFT_ICON_PATHS: Record<keyof AirComposition, string> = {
  fighters:
    '<rect x="7.3" y="1.5" width="1.4" height="12" rx="0.5"/><path d="M8 5 L15 10.5 L15 12 L8 9.5 L1 12 L1 10.5 Z"/><path d="M8 10.5 L11 14.5 L11 15.5 L8 14 L5 15.5 L5 14.5 Z"/>',
  cas: '<rect x="7.2" y="1.5" width="1.6" height="12.5" rx="0.5"/><rect x="1" y="7.4" width="14" height="2.4" rx="0.6"/><path d="M8 11 L10.6 14.6 L10.6 15.6 L8 14.2 L5.4 15.6 L5.4 14.6 Z"/>',
  bombers:
    '<rect x="6.8" y="1" width="2.4" height="13" rx="0.8"/><path d="M8 5.5 L15.5 9.5 L15.5 11 L8 8.7 L0.5 11 L0.5 9.5 Z"/><path d="M6.2 11 L6.2 14.8 L4.6 15.8 L4.6 14.3 Z"/><path d="M9.8 11 L9.8 14.8 L11.4 15.8 L11.4 14.3 Z"/>',
};
