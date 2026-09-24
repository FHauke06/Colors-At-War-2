/** Gemeinsame Klassen für Buttons, Karten und Eingabefelder (vorher in GameScreen, SetupScreen und theme.ts je einmal kopiert).
 *  Befehle sind Versalien in der kondensierten Anzeigeschrift (`font-display`), Flächen fast eckig mit einfacher Tintenlinie -
 *  die Farben kommen aus den Theme-Variablen in style.css und folgen so Hell/Dunkel. `leading-5` hält die Höhe bei 32px, damit
 *  Panels und Kartenlayout dieselben Maße behalten wie mit den früheren Standard-Buttons. `inline-flex` gilt nur, solange der
 *  Knopf nicht `hidden` ist - sonst überstimmte es die vielen classList.toggle('hidden', ...) an Buttons. */
const buttonBase =
  '[&:not(.hidden)]:inline-flex items-center justify-center gap-2 rounded-md border py-1.5 font-display text-[15px] font-bold uppercase leading-5 tracking-[0.09em] transition-colors active:translate-y-px';

export const primaryBtnClass = `${buttonBase} px-4 border-slate-100 bg-amber-500 text-slate-900 shadow-sm hover:bg-amber-400 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none`;

export const secondaryBtnClass = `${buttonBase} px-4 border-slate-500 bg-slate-800 text-slate-100 hover:border-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-600 disabled:hover:border-slate-700 disabled:hover:bg-slate-900`;

/** Der eine laute Knopf: Zug beenden. */
export const dangerBtnClass = `${buttonBase} px-4 border-signal bg-signal text-white shadow-md hover:brightness-110 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none disabled:hover:brightness-100`;

export const cardClass = 'frame rounded-lg bg-slate-800 p-6';

export const inputClass =
  'rounded-md border border-slate-500 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-100';

/** Reiter der Spielansicht: wie Karteireiter - der aktive ist Tinte auf Papier mit rotem Fuß, die anderen tragen nur eine Linie. */
export function tabBtnClass(active: boolean): string {
  return `${buttonBase} px-3.5 ${
    active
      ? 'border-slate-100 bg-amber-500 text-slate-900 shadow-[inset_0_-3px_0_0_var(--color-signal)]'
      : 'border-slate-500 bg-slate-800 text-slate-300 hover:border-slate-100 hover:text-slate-100'
  }`;
}
