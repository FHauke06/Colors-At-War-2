import type { UnitComposition } from '../engine/types';

export const UNIT_TYPES: readonly (keyof UnitComposition)[] = ['infantry', 'motorizedInfantry', 'lightTank', 'heavyTank', 'artillery'];

export const UNIT_LABELS: Record<keyof UnitComposition, string> = {
  infantry: 'Infanterie',
  lightTank: 'Leichte Panzer',
  heavyTank: 'Schwere Panzer',
  artillery: 'Artillerie',
  motorizedInfantry: 'Motorisierte Infanterie',
};

/** Small hand-drawn pictograms, 16x16 viewBox - shared between the HTML tactical-battle UI
 *  (GameScreen.ts, filled via `currentColor`) and the SVG main map (MapRenderer.ts, filled
 *  explicitly), so both places draw the exact same shapes. */
export const UNIT_ICON_PATHS: Record<keyof UnitComposition, string> = {
  infantry:
    '<circle cx="8" cy="4.3" r="2.1"/><path d="M8 6.6c-2.3 0-4.1 1.7-4.1 4.3V15h8.2v-4.1c0-2.6-1.8-4.3-4.1-4.3z"/>',
  lightTank:
    '<rect x="2" y="8.3" width="12" height="3.6" rx="1"/><rect x="5.6" y="5.6" width="3.8" height="3" rx="0.6"/><rect x="9.2" y="6.6" width="4.2" height="1.1" rx="0.4"/><circle cx="4.6" cy="12.4" r="1"/><circle cx="8" cy="12.4" r="1"/><circle cx="11.4" cy="12.4" r="1"/>',
  heavyTank:
    '<rect x="1" y="7.6" width="14" height="4.4" rx="1"/><rect x="4.6" y="4.6" width="6" height="3.4" rx="0.6"/><rect x="9.8" y="5.7" width="5.4" height="1.5" rx="0.4"/><circle cx="3.4" cy="12.8" r="1.2"/><circle cx="6.6" cy="12.8" r="1.2"/><circle cx="9.8" cy="12.8" r="1.2"/><circle cx="13" cy="12.8" r="1.2"/>',
  artillery:
    '<rect x="2.5" y="9.6" width="9" height="2.8" rx="1"/><rect x="6.8" y="3.6" width="7.2" height="2.1" rx="0.6" transform="rotate(-32 6.8 3.6)"/><circle cx="5" cy="12.6" r="1.3"/><circle cx="9.4" cy="12.6" r="1.3"/>',
  // A small truck: flat cargo bed + cab, same silhouette-on-two-wheels convention as the tanks
  // above, distinguished by the stepped cab roofline instead of a turret/barrel.
  motorizedInfantry:
    '<rect x="1.5" y="7.4" width="8" height="3.6" rx="0.6"/><path d="M9.5 6.2h3.2c.5 0 .9.3 1.1.7l1 2.1c.2.4-.1.9-.6.9H9.5z"/><circle cx="4.2" cy="12.4" r="1.3"/><circle cx="11.6" cy="12.4" r="1.3"/>',
};
