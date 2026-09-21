/** Small pictograms (16x16 viewBox) for impassable battle-grid terrain. Unlike unitIcons.ts these
 *  aren't filled with `currentColor` - each terrain always renders on its own fixed background, so
 *  the icon color is just hardcoded per-terrain by the caller instead. Paths rely on inherited
 *  `fill`/`stroke` from whatever wrapper element sets them (mountain uses fill, river uses stroke
 *  with `fill="none"` on its own wavy lines). */
export const TERRAIN_ICON_PATHS: Record<'river' | 'mountain', string> = {
  river:
    '<path d="M1 5.6c1.4-1.4 2.9-1.4 4.3 0s2.9 1.4 4.3 0 2.9-1.4 4.3 0" fill="none" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M1 9.3c1.4-1.4 2.9-1.4 4.3 0s2.9 1.4 4.3 0 2.9-1.4 4.3 0" fill="none" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M1 13c1.4-1.4 2.9-1.4 4.3 0s2.9 1.4 4.3 0 2.9-1.4 4.3 0" fill="none" stroke-width="1.6" stroke-linecap="round"/>',
  mountain: '<path d="M1 14.5 5.5 6l2.7 3.8 1.8-2.3L15 14.5z"/>',
};
