const THEME_KEY = 'colors-at-war-theme';

const toggleBtnClass =
  'rounded-md border border-slate-600 bg-slate-800 px-4 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-700';

/** Toggles the `dark` class on <html>, which flips every bg-slate, text-slate and amber class in
 *  the app between the default white/black-accent theme and its photographic-negative dark theme
 *  (see style.css) - persisted so it survives a reload. Lives at the page level, in the header
 *  next to the site title, rather than inside GameScreen - it needs to work from the very first
 *  paint, before a game (or even a lobby) exists yet. */
export function buildThemeToggle(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = toggleBtnClass;
  const refresh = (): void => {
    btn.textContent = document.documentElement.classList.contains('dark') ? 'Hell' : 'Dunkel';
  };
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    refresh();
  });
  refresh();
  return btn;
}
