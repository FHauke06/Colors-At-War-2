import { uiIcon } from './uiIcons';
import type { UiIconName } from './uiIcons';
import { secondaryBtnClass } from './styles';

export type TabId = 'map' | 'resources' | 'diplomacy' | 'airforce' | 'naval' | 'research';

/** Reihenfolge der Reiter im Spiel - `1` bis `6` schalten sie per Tastatur um (siehe GameScreen). */
export const TAB_ORDER: readonly TabId[] = ['map', 'resources', 'diplomacy', 'airforce', 'naval', 'research'];

/** Name, Icon und Erklärung jedes Reiters - Quelle für die Reiterleiste, die Spielhilfe und den Text über dem Research-Baum. */
export const TAB_HELP: Record<TabId, { readonly title: string; readonly icon: UiIconName; readonly text: string }> = {
  map: {
    title: 'Karte',
    icon: 'map',
    text: 'Besitz und Truppen auf einen Blick. Ziehe Einheiten auf ein angrenzendes Gebiet, um sie zu verschieben oder ein verteidigtes fremdes Gebiet anzugreifen (erfordert Krieg). Auf Gebieten von Verbündeten dürfen deine Einheiten mit stehen und sie durchqueren. Klicke ein eigenes Gebiet an, um dort Einheiten zu rekrutieren. Zahlen: eigene Einheiten grün, verbündete blau mit „F“ davor (z. B. 5/F3); „4/6“ heißt: 4 von 6 sind diese Runde noch beweglich.',
  },
  resources: {
    title: 'Ressourcen',
    icon: 'resources',
    text: 'Zeigt, wie viele Rüstungspunkte jedes Gebiet pro Runde einbringt (heller/wärmer = mehr). Klicke ein eigenes Gebiet an, um dort Fabriken zu bauen oder die Infrastruktur auszubauen.',
  },
  diplomacy: {
    title: 'Diplomatie',
    icon: 'diplomacy',
    text: 'Zeigt deinen diplomatischen Status: eigene Gebiete grün, Verbündete (Allianz) blau, Gebiete mit aktivem Nichtangriffspakt violett, Gebiete im Krieg rot, unbesetzte Gebiete grau. Andere Gebiete (Frieden ohne Pakt) sind gedämpft grau-blau. Klicke ein Land an, um seine Verbündeten zu sehen - Verbündete sehen alle Einheiten der anderen, ziehen automatisch in jeden Krieg eines Mitglieds und dürfen mit ihren Einheiten gemeinsam auf denselben Gebieten stehen. Krieg erklärst du und Pakte schließt du über das Diplomatie-Menü des jeweiligen Landes.',
  },
  airforce: {
    title: 'Airforce',
    icon: 'airforce',
    text: 'Färbt jedes Gebiet nach dem Verhältnis der dort projizierten Jäger statt nach Besitzer: grün = vollständig deine Luftüberlegenheit, rot = vollständig feindliche, grau = keine Jäger von niemandem in Reichweite. Flugplätze zeigen zusätzlich ihre Stufe und stationierten Flugzeuge als Icons. Klicke ein eigenes Gebiet an, um dort einen Flugplatz zu bauen/auszubauen, Flugzeuge zu rekrutieren oder einen Bomber-/Jägereinsatz zu starten - oder ziehe ein Flugplatz-Gebiet direkt auf ein feindliches Ziel.',
  },
  naval: {
    title: 'Marine',
    icon: 'naval',
    text: 'Wie im Karten-Tab, nur mit Schiffen statt Landeinheiten. Klicke ein eigenes Küstengebiet an (Schiffe bauen, Auswahl), ziehe es auf eine angrenzende Seezone, um Schiffe fahren zu lassen und Landeinheiten einzuschiffen (nur in einer alleinig besetzten Zone mit eigenem Schiff). Zone auf Zone verlegt Schiffe (feindliche Zone im Krieg = Seeschlacht), Zone auf Küstengebiet setzt Truppen in der Folgerunde an Land - auf ein verteidigtes Feindgebiet als Landungsangriff. Schiffe brauchen Research > Marine.',
  },
  research: {
    title: 'Research',
    icon: 'research',
    text: 'Schalte neue Einheiten- und Flugzeugtypen für Rüstungspunkte frei - Infanterie ist von Anfang an verfügbar. Manche Technologien setzen eine andere voraus. Unter Panzern, Motorisierter Infanterie und Artillerie hängen Upgrades (mehr Schaden, bei der Artillerie auch mehr Reichweite), die erst nach der Erforschung der Einheit möglich sind. Fahre mit der Maus über eine Technologie oder ein Upgrade, um die Werte zu sehen.',
  },
};

const SHORTCUTS: readonly (readonly [string, string])[] = [
  ['1 – 6', 'Reiter wechseln'],
  ['?', 'diese Hilfe öffnen'],
  ['Esc', 'Dialog schließen'],
];

let dialog: HTMLDialogElement | null = null;

function buildDialog(): HTMLDialogElement {
  const dlg = document.createElement('dialog');
  dlg.className = 'frame m-auto max-h-[88vh] w-[min(46rem,calc(100vw-2rem))] overflow-hidden rounded-lg bg-slate-900 p-0 text-slate-100 shadow-lg';
  dlg.setAttribute('aria-labelledby', 'help-title');

  const shell = document.createElement('div');
  shell.className = 'flex max-h-[88vh] flex-col';

  const head = document.createElement('div');
  head.className = 'flex items-center justify-between gap-4 border-b border-slate-600 px-6 py-4';
  const title = document.createElement('h2');
  title.id = 'help-title';
  title.className = 'label-caps text-2xl leading-none';
  title.textContent = 'Spielhilfe';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = secondaryBtnClass;
  close.append(uiIcon('close', 12), document.createTextNode('Schließen'));
  close.addEventListener('click', () => dlg.close());
  head.append(title, close);

  const body = document.createElement('div');
  body.className = 'flex flex-col gap-5 overflow-y-auto px-6 py-5 outline-none';
  body.tabIndex = -1;

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-300';
  intro.textContent =
    'Jede Runde ziehst du nacheinander mit deinen Einheiten, baust aus und rekrutierst - mit „Zug beenden“ gibst du an die nächste Fraktion weiter. Die Reiter über der Karte zeigen dieselbe Welt aus sechs Blickwinkeln:';
  body.appendChild(intro);

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-4';
  TAB_ORDER.forEach((id, i) => {
    const entry = TAB_HELP[id];
    const row = document.createElement('div');
    row.className = 'grid grid-cols-[2.25rem_1fr] gap-x-3';
    const badge = document.createElement('div');
    badge.className = 'flex h-9 w-9 items-center justify-center rounded-md border border-slate-500 bg-slate-800 text-slate-100';
    badge.appendChild(uiIcon(entry.icon, 20));
    const text = document.createElement('div');
    const heading = document.createElement('div');
    heading.className = 'label-caps flex items-baseline gap-2 text-lg leading-tight';
    const key = document.createElement('span');
    key.className = 'font-mono text-xs font-medium tracking-normal text-slate-500';
    key.textContent = `[${i + 1}]`;
    heading.append(document.createTextNode(entry.title), key);
    const p = document.createElement('p');
    p.className = 'mt-0.5 text-sm text-slate-300';
    p.textContent = entry.text;
    text.append(heading, p);
    row.append(badge, text);
    list.appendChild(row);
  });
  body.appendChild(list);

  const keys = document.createElement('div');
  keys.className = 'flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-600 pt-4 text-sm text-slate-300';
  for (const [combo, meaning] of SHORTCUTS) {
    const item = document.createElement('span');
    item.className = 'flex items-center gap-2';
    const kbd = document.createElement('kbd');
    kbd.className = 'rounded-sm border border-slate-500 bg-slate-800 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-100';
    kbd.textContent = combo;
    item.append(kbd, document.createTextNode(meaning));
    keys.appendChild(item);
  }
  body.appendChild(keys);

  shell.append(head, body);
  dlg.appendChild(shell);
  // Ein Klick auf den abgedunkelten Hintergrund trifft das <dialog> selbst (der Inhalt füllt es sonst komplett aus).
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  return dlg;
}

export function openHelp(): void {
  if (!dialog) {
    dialog = buildDialog();
    document.body.appendChild(dialog);
  }
  if (!dialog.open) dialog.showModal();
  // Fokus auf den Textbereich statt auf "Schließen": Pfeiltasten und Bild auf/ab scrollen sofort, ohne einen Fokusring am Knopf.
  dialog.querySelector<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true });
}

export function isHelpOpen(): boolean {
  return dialog?.open ?? false;
}

/** Der "Hilfe"-Knopf der Kopfzeile. */
export function buildHelpButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = secondaryBtnClass;
  btn.title = 'Spielhilfe (?)';
  btn.append(uiIcon('help'), document.createTextNode('Hilfe'));
  btn.addEventListener('click', openHelp);
  return btn;
}
