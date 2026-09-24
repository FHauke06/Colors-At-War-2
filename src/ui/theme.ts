import { uiIcon } from './uiIcons';
import { secondaryBtnClass } from './styles';

const THEME_KEY = 'colors-at-war-theme';

/** Toggles the `dark` class on <html>, which flips every bg-slate, text-slate and amber class in
 *  the app between the default paper-and-ink theme and its dark "Nachtlage" negative (see
 *  style.css) - persisted so it survives a reload. Lives at the page level, in the header
 *  next to the site logo, rather than inside GameScreen - it needs to work from the very first
 *  paint, before a game (or even a lobby) exists yet. Shows the icon and name of the theme
 *  you would switch TO. */
export function buildThemeToggle(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = secondaryBtnClass;
  const refresh = (): void => {
    const isDark = document.documentElement.classList.contains('dark');
    btn.replaceChildren(uiIcon(isDark ? 'sun' : 'moon'), document.createTextNode(isDark ? 'Hell' : 'Dunkel'));
    btn.title = isDark ? 'Zum hellen Kartenpapier wechseln' : 'Zur dunklen Nachtlage wechseln';
  };
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    refresh();
  });
  refresh();
  return btn;
}
