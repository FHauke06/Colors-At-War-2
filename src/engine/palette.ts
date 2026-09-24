// Distinct, high-contrast faction colors. Order matters (first N are used for N factions),
// chosen so any prefix of the list still reads as clearly distinguishable.
export const FACTION_COLORS: readonly string[] = [
  '#dc2626', // red
  '#2563eb', // blue
  '#16a34a', // green
  '#eab308', // yellow
  '#9333ea', // purple
  '#ea580c', // orange
  '#0d9488', // teal
  '#db2777', // pink
];

export const MAX_FACTIONS = FACTION_COLORS.length;
export const MIN_FACTIONS = 2;

export const NEUTRAL_COLOR = '#8d8874'; // warm khaki grey (matches the paper/ink theme), unowned territory
