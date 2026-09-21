/** 150 first names and 100 last names, drawn from across European regions (Germanic, French,
 *  Italian, Iberian, British & Irish, Nordic, Finnish, Dutch & Flemish, Polish, Czech & Slovak,
 *  Hungarian, Romanian & Bulgarian, Balkan, Greek, Russian & Ukrainian, Baltic, Turkish, Scottish &
 *  Welsh) - combined at random to give each AI faction a distinct human-sounding name instead of
 *  the generic "KI 1", "KI 2", ... placeholder (see randomAiName, used by engine/session.ts's
 *  addAi). Purely cosmetic; carries no gameplay meaning. */

export const AI_FIRST_NAMES: readonly string[] = [
  // German / Austrian / Swiss
  'Hans', 'Klaus', 'Werner', 'Matthias', 'Stefan', 'Florian', 'Ingrid', 'Petra',
  // French
  'Jean', 'Pierre', 'Louis', 'Antoine', 'Nicolas', 'Marie', 'Camille', 'Claire',
  // Italian
  'Marco', 'Luca', 'Matteo', 'Alessandro', 'Giulia', 'Francesca', 'Chiara', 'Valentina',
  // Spanish
  'Carlos', 'Javier', 'Diego', 'Manuel', 'Lucia', 'Carmen', 'Isabel', 'Marta',
  // Portuguese
  'João', 'Miguel', 'Tiago', 'Rui', 'Ana', 'Beatriz', 'Catarina', 'Inês',
  // British & Irish
  'James', 'William', 'Thomas', 'Oliver', 'Charlotte', 'Emily', 'Amelia', 'Aoife',
  // Nordic - Sweden/Norway/Denmark/Iceland
  'Erik', 'Lars', 'Nils', 'Magnus', 'Astrid', 'Karin', 'Freya', 'Solveig',
  // Finnish
  'Mikko', 'Juhani', 'Pekka', 'Antti', 'Aino', 'Kaisa', 'Saara', 'Liisa',
  // Dutch & Flemish
  'Jan', 'Willem', 'Pieter', 'Bram', 'Sanne', 'Anke', 'Femke', 'Lotte',
  // Polish
  'Krzysztof', 'Wojciech', 'Tomasz', 'Piotr', 'Magdalena', 'Agnieszka', 'Katarzyna', 'Zofia',
  // Czech & Slovak
  'Josef', 'Tomáš', 'Jaroslav', 'Milan', 'Eva', 'Věra', 'Jana', 'Zuzana',
  // Hungarian
  'István', 'Bence', 'Gábor', 'Zoltán', 'Ilona', 'Eszter', 'Katalin', 'Réka',
  // Romanian & Bulgarian
  'Andrei', 'Mihai', 'Ion', 'Radu', 'Ioana', 'Simona', 'Dimitar', 'Georgi',
  // Balkan - Serbian/Croatian/Bosnian/Slovenian
  'Marko', 'Nikola', 'Vuk', 'Goran', 'Jovana', 'Ivana', 'Marija', 'Dragana',
  // Greek
  'Nikos', 'Dimitris', 'Yannis', 'Kostas', 'Eleni', 'Sofia', 'Katerina', 'Anastasia',
  // Russian & Ukrainian
  'Ivan', 'Dmitri', 'Sergei', 'Nikolai', 'Olga', 'Irina', 'Svetlana', 'Tatiana',
  // Baltic - Lithuanian/Latvian/Estonian
  'Jonas', 'Kestutis', 'Andris', 'Toomas', 'Rasa', 'Inga', 'Kristiina', 'Laura',
  // Turkish - European Turkey
  'Emre', 'Mehmet', 'Ali', 'Ayşe', 'Elif', 'Zeynep', 'Deniz',
  // Scottish & Welsh
  'Angus', 'Fergus', 'Iona', 'Isla', 'Rhys', 'Gwen', 'Owen',
];

export const AI_LAST_NAMES: readonly string[] = [
  // German / Austrian / Swiss
  'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Hoffmann',
  // French
  'Martin', 'Bernard', 'Dubois', 'Moreau', 'Laurent', 'Girard',
  // Italian
  'Rossi', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Marino',
  // Spanish
  'García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez',
  // Portuguese
  'Silva', 'Santos', 'Pereira', 'Oliveira', 'Costa', 'Carvalho',
  // British & Irish
  'Smith', 'Taylor', 'Brown', 'Walsh', 'Murphy', 'Kelly',
  // Nordic
  'Andersson', 'Johansson', 'Karlsson', 'Hansen', 'Nilsen', 'Berg', 'Lindqvist',
  // Finnish
  'Korhonen', 'Virtanen', 'Mäkinen', 'Nieminen', 'Laine',
  // Dutch & Flemish
  'de Jong', 'Jansen', 'Visser', 'Bakker', 'Peeters', 'Willems',
  // Polish
  'Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Lewandowski',
  // Czech & Slovak
  'Novák', 'Svoboda', 'Dvořák', 'Horák', 'Král',
  // Hungarian
  'Nagy', 'Kovács', 'Tóth', 'Szabó', 'Horváth',
  // Romanian & Bulgarian
  'Popescu', 'Ionescu', 'Dumitrescu', 'Georgiev', 'Ivanov',
  // Balkan
  'Petrović', 'Jovanović', 'Horvat', 'Novak', 'Kovačević',
  // Greek
  'Papadopoulos', 'Nikolaou', 'Georgiou', 'Vasiliou', 'Antoniou',
  // Russian & Ukrainian
  'Smirnov', 'Petrov', 'Sokolov', 'Volkov', 'Kovalenko',
  // Baltic
  'Kazlauskas', 'Bērziņš', 'Tamm', 'Sabaliauskas', 'Ozols',
  // Turkish
  'Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik',
];

/** A random "Vorname Nachname" combination, avoiding anything already in `usedNames` (the other
 *  AI factions already added to this lobby) as long as that's feasible - with 150x100 = 15000
 *  combinations, a collision is rare, but not impossible on a small map with many AI seats. Falls
 *  back to an unchecked pick after a few tries rather than looping indefinitely. */
export function randomAiName(usedNames: ReadonlySet<string> = new Set()): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = AI_FIRST_NAMES[Math.floor(Math.random() * AI_FIRST_NAMES.length)];
    const last = AI_LAST_NAMES[Math.floor(Math.random() * AI_LAST_NAMES.length)];
    const name = `${first} ${last}`;
    if (!usedNames.has(name)) return name;
  }
  const first = AI_FIRST_NAMES[Math.floor(Math.random() * AI_FIRST_NAMES.length)];
  const last = AI_LAST_NAMES[Math.floor(Math.random() * AI_LAST_NAMES.length)];
  return `${first} ${last}`;
}
