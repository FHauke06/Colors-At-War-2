export interface Territory {
  readonly id: string;
  readonly name: string;
  /** SVG path `d` attribute in the map's projected coordinate space. */
  readonly path: string;
  readonly neighbors: readonly string[];
  /** Projected [x, y], used for label/capital placement. */
  readonly centroid: readonly number[];
}

/** Eine Seezone (Wassergebiet) der Hauptkarte - gleiche Form wie ein Landgebiet, damit MapRenderer sie
 *  genauso zeichnen kann. `neighbors` enthält die angrenzenden Seezonen UND die angrenzenden
 *  Küsten-Landgebiete (Land -> Seezone wird nicht gespeichert, siehe engine/naval.ts's coastalZoneIds).
 *  Die Ids sind über Land- und Seegebiete hinweg eindeutig. Daten: data/MainMaps/*SeaZones.ts. */
export interface SeaZone {
  readonly id: string;
  readonly name: string;
  /** SVG path `d` attribute in the map's projected coordinate space. */
  readonly path: string;
  readonly neighbors: readonly string[];
  /** Projected [x, y] für Namen und Schiffsanzahl-Label. */
  readonly centroid: readonly number[];
}

export interface TerritoryData {
  readonly viewBox: string;
  readonly territories: readonly Territory[];
  /** Die Seezonen dieser Karte (Meer, in Wassergebiete eingeteilt) - Seekampf und Überseetransport
   *  laufen ausschließlich darüber, Landgebiete grenzen nicht mehr direkt über Wasser aneinander. */
  readonly seaZones: readonly SeaZone[];
}

/**
 * A garrison is a headcount per unit type, not individual units - there is no per-unit HP.
 * Combat strength is compared via a common denominator: 5 Infanterie = 2 leichte Panzer =
 * 1 schwerer Panzer, i.e. infantry=1, lightTank=2.5, heavyTank=5 strength points each. Artillery
 * carries no ordinary battle strength at all (offense or defense) - see engine/combat.ts's
 * STRENGTH/reduceByStrength - its entire combat role is the ranged bombardBattleCell action.
 * Motorisierte Infanterie carries the same strength as plain Infanterie (STRENGTH.infantry) - its
 * distinguishing trait isn't combat power but mobility: it may move a second time in the same
 * round/battle-turn, on both the main map and the tactical grid (see engine/movement.ts's
 * availableToMove and engine/combat.ts's moveBattleUnits, both driven by TerritoryState/
 * BattleSubState's extraMoveUsed).
 */
export interface UnitComposition {
  readonly infantry: number;
  readonly lightTank: number;
  readonly heavyTank: number;
  readonly artillery: number;
  readonly motorizedInfantry: number;
}

export type GroundTech = 'lightTank' | 'heavyTank' | 'motorizedInfantry';
export type AirTech = 'fighters' | 'cas' | 'bombers';
/** Support weapons - neither a frontline ground unit nor an aircraft. Artillerie is recruited onto
 *  the map like any other unit (its own combat role is the ranged bombardBattleCell action); the
 *  Atombombe instead is usable mid-battle for a one-off effect (see engine/combat.ts's useNuke)
 *  rather than recruited at all. Grouped together in the Research tab's "Support" tab (see
 *  engine/research.ts's SUPPORT_TECH_TREE) since neither fits the ground/air split. */
export type SupportTech = 'artillery' | 'nuke';
/** Marine - eigene Forschungskategorie (siehe engine/research.ts's NAVAL_TECH_TREE): erst mit `ships`
 *  dürfen Schiffe rekrutiert werden, die man braucht, um Seezonen zu besetzen und Landeinheiten über
 *  Wasser zu schicken (engine/naval.ts). */
export type NavalTech = 'ships';

/** How aggressively and effectively every AI seat in a game plays - chosen once, for the whole
 *  lobby, before the game starts (see LobbyState.aiDifficulty/engine/session.ts's createLobby) and
 *  applied to every AI added to it. Distinct from Player.aiTechAffinity (each AI's own random
 *  personality roll for HOW it diversifies) - this instead scales HOW WELL it plays: see
 *  engine/ai.ts's DIFFICULTY_PROFILES for exactly which thresholds move. */
export type AiDifficulty = 'easy' | 'medium' | 'hard';

/** Which non-Infanterie unit/aircraft types a player has unlocked via the Research tab - see
 *  engine/research.ts. Infanterie needs no unlock, always available. Sparse in GameState.research:
 *  a player with no entry has unlocked nothing (the human default at game start) - AI seats get
 *  every tech unlocked immediately instead (see engine/setup.ts's buildGameStateFromLobby), so
 *  they're never gated by a system they don't spend points playing. */
export interface ResearchState {
  readonly unlockedGround: readonly GroundTech[];
  readonly unlockedAir: readonly AirTech[];
  readonly unlockedSupport: readonly SupportTech[];
  readonly unlockedNaval: readonly NavalTech[];
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** CSS color, unique per player. */
  readonly color: string;
  readonly capitalId: string;
  readonly isAI: boolean;
  /** AI seats only (undefined for humans) - how strongly this particular AI leans into anything
   *  beyond plain Infanterie: Leichte/Schwere Panzer, Artillerie, and the Airforce. Rolled once,
   *  randomly, per AI at game start (see engine/setup.ts's buildGameStateFromLobby) and never
   *  changes after, so each AI seat keeps a consistent "personality" for the rest of the game
   *  instead of re-rolling the question every turn - see engine/ai.ts's techAffinityOf for how
   *  it's used. Range [0, 1]: 0 behaves exactly like a diversification-free, Infanterie-only AI;
   *  1 commits the most any AI ever will. */
  readonly aiTechAffinity?: number;
  /** AI seats only (undefined for humans) - the lobby-wide difficulty in effect when this AI was
   *  added (see LobbyState.aiDifficulty). Copied onto the Player at game start so engine/ai.ts can
   *  read it without needing the lobby around any more. */
  readonly aiDifficulty?: AiDifficulty;
}

/** A headcount per aircraft type stationed somewhere - see engine/airforce.ts. Unlike
 *  UnitComposition, there's no per-unit HP or STRENGTH conversion here; each type's combat effect
 *  (Jäger attrition, Bomber damage, CAS strikes) is its own formula, documented in airforce.ts. */
export interface AirComposition {
  readonly fighters: number;
  readonly cas: number;
  readonly bombers: number;
}

/** A territory's Flugplatz (airfield): `level` 0 means none built yet (capacity 0, nothing can be
 *  stationed there - see engine/airforce.ts's airfieldCapacity). `aircraft` is what's currently
 *  stationed there, available for recruiting into, launching a Bomber raid from, or calling into a
 *  nearby tactical battle - excluding anything currently away on a raid or called into a battle
 *  (see PendingBattle's calledAircraft, and launchBomberRaid, which resolves instantly and never
 *  leaves a lingering "in transit" state on the main map). Sparse in GameState.airfields: a
 *  territory with no entry has no airfield at all (equivalent to level 0, empty aircraft). */
export interface AirfieldState {
  readonly level: number;
  readonly aircraft: AirComposition;
}

export interface TerritoryState {
  readonly ownerId: string | null;
  readonly garrison: UnitComposition;
  /** Of `garrison`, how many arrived (by moving, capturing or recruiting) this round - a unit may
   *  only move once per round, so these can't be sent onward again until the round resets. Doesn't
   *  gate Motorisierte Infanterie at all (see extraMoveUsed below) - only every other type. */
  readonly movedIn: UnitComposition;
  /** Motorisierte Infanterie only (always 0 for every other type): of `garrison`, how many have
   *  used up their second move this round and are now just as stuck as everyone else until the
   *  round resets. A motorized unit is available to move whenever garrison - extraMoveUsed > 0,
   *  regardless of movedIn - see engine/movement.ts's availableToMove/splitExtraMoveUnits, which
   *  decide whether a given move is a unit's first (free of movedIn same as usual, but leaves it
   *  still available) or second (adds it to the destination's extraMoveUsed, finally locking it). */
  readonly extraMoveUsed: UnitComposition;
  /** Units of the owner's allies standing on this territory too ("Verbündete dürfen auf demselben
   *  Gebiet stehen") - see engine/movement.ts's stackOf/depositUnits for the rules. Sparse and
   *  optional: a territory nobody is visiting has no entry at all, which also keeps every game state
   *  from before this existed loading unchanged. At most one entry per visiting player, never the
   *  owner themselves, never an empty stack - engine/movement.ts's withStack drops one that empties. */
  readonly guests?: readonly GuestStack[];
  /** Schiffe im Hafen dieses (Küsten-)Gebiets, siehe engine/naval.ts - zählen nicht zur
   *  UnitComposition, sondern als eigener Zähler. Sparse und optional wie `guests`: fehlender Eintrag = 0
   *  Schiffe, damit alle Spielstände von vor dem Seekampf unverändert laden. Nur der Besitzer des
   *  Gebiets kann hier Schiffe haben (keine Gästeflotten an Land). */
  readonly ships?: number;
  /** Davon: Schiffe, die diese Runde hier angekommen sind (rekrutiert oder aus einer Seezone
   *  eingelaufen) und deshalb erst nach dem Rundenwechsel wieder fahren dürfen. Sparse, fehlend = 0. */
  readonly shipsMovedIn?: number;
}

/** One allied player's units stationed on a territory somebody else owns: the same three fields a
 *  TerritoryState keeps for its owner's own garrison (so both are handled by the same movement
 *  rules, see engine/movement.ts's MovableState), plus whose they are. */
export interface GuestStack {
  readonly playerId: string;
  readonly garrison: UnitComposition;
  readonly movedIn: UnitComposition;
  readonly extraMoveUsed: UnitComposition;
}

/** 'river' and 'mountain' are impassable - see data/BattleMaps. */
export type BattleTerrain = 'normal' | 'river' | 'mountain';

/** A "kleines Gebiet" (one grid cell) on the tactical battle map. Static structure (where it
 *  sits, which starting side it belongs to, what it touches); never reveals troop counts by
 *  itself. `side` only marks the initial deployment zone - ownership of the cell itself can
 *  change mid-battle (see BattleSubState). `isEscape` marks the single row beyond the defender's
 *  back line: nobody may deploy there, and units that move onto it break through onto the main
 *  map instead of occupying it (see engine/combat.ts's escapeBattle). A non-'normal' `terrain`
 *  cell is excluded from `neighbors` on every side - nothing can ever stand on it or pass
 *  through it. `isCity` marks one of 3 objective cells per side (deployable and ownable like any
 *  normal cell) - capturing all 3 of the opponent's ends the battle immediately, win condition on
 *  top of (not instead of) wiping out their whole force - see engine/combat.ts's checkConclusion. */
export interface BattleSubTerritory {
  readonly id: string;
  readonly row: number;
  readonly col: number;
  readonly side: 'attacker' | 'defender';
  readonly isEscape: boolean;
  readonly terrain: BattleTerrain;
  readonly isCity: boolean;
  readonly neighbors: readonly string[];
}

/** Garrison sitting on one BattleSubTerritory - ownership can change mid-battle (a cell captured
 *  across the frontier belongs to whoever took it, not fixed to its original side). */
export interface BattleSubState {
  readonly ownerId: string;
  readonly garrison: UnitComposition;
  readonly movedIn: UnitComposition;
  /** Same Motorisierte-Infanterie-only bookkeeping as TerritoryState.extraMoveUsed, just scoped to
   *  a "kleines Gebiet" on the tactical grid and reset every battle-turn instead of every round. */
  readonly extraMoveUsed: UnitComposition;
}

/** One deployment placement: `amount` units placed on a single "kleines Gebiet". Deployment as a
 *  whole is a sparse list of these (most cells on a 16x16 battlefield stay empty), built up by
 *  clicking directly on the grid rather than a quantity menu. */
export interface BattlePlacement {
  readonly subId: string;
  readonly amount: UnitComposition;
}

/**
 * One call-in of Jäger or CAS support into a tactical battle - see engine/combat.ts's
 * callAirSupport/processAirSupportArrivals/casStrike. `fromTerritoryId` is the home airfield it
 * came from (and returns to) - kept on every entry, including once active, specifically so a
 * battle's end can return surviving Jäger to the airfield they actually launched from rather than
 * some aggregate pool with no memory of that. Lifecycle by type:
 * - Jäger: 'incoming' (roundsRemaining counts down from 1) -> 'active' (joins the battle's shared
 *   Luftüberlegenheit contest - see engine/combat.ts's battleAirSuperiority/
 *   resolveInBattleAirCombat - and is subject to attrition each full round; `count` shrinks in
 *   place as losses are taken, entry removed once it hits 0). Survivors return to fromTerritoryId
 *   the moment the battle concludes.
 * - CAS: 'incoming' (roundsRemaining counts down from 3) -> 'ready' (available for one casStrike,
 *   no time limit to use it) -> 'returning' (roundsRemaining counts down from 3 after striking) ->
 *   removed, `count` added back to fromTerritoryId's airfield. If the battle concludes at any
 *   point before that, the CAS returns to fromTerritoryId immediately instead of waiting out the
 *   remaining transit time.
 */
export interface CalledAircraft {
  readonly id: string;
  readonly side: 'attacker' | 'defender';
  readonly type: 'fighter' | 'cas';
  readonly count: number;
  readonly fromTerritoryId: string;
  readonly status: 'incoming' | 'active' | 'ready' | 'returning';
  readonly roundsRemaining: number;
}

/**
 * A battle in progress - see engine/combat.ts. Two phases:
 * - Deployment: attackerDeployed/defenderDeployed track progress only (booleans, not the actual
 *   placement) so neither side can see the other's tactical choice before committing their own;
 *   subState is null until both are in.
 * - Battle: subState holds the live (fully visible to both, and to anyone else watching) tactical
 *   map. activeSide alternates between the two combatants - a turn cycle of its own, independent
 *   of the main game's turn order - until one side has zero units left anywhere on the map.
 * Blocks every other action (see engine/movement.ts, economy.ts, turns.ts) until it concludes.
 */
export interface PendingBattle {
  readonly territoryId: string;
  /** Wo der Angriff gestartet wurde: ein Landgebiet des Angreifers (oder eines Verbündeten) - oder,
   *  bei einem Landungsangriff (`fromSeaZone`), die Seezone, in der die Truppen eingeschifft sind. */
  readonly fromId: string;
  /** Nur gesetzt (`true`) bei einem Landungsangriff von einer Seezone aus (engine/naval.ts's
   *  startAmphibiousBattle): dann bezieht sich `fromId` auf eine Seezone, `attackerMax` auf die dort
   *  eingeschifften Landeinheiten, und ein geschlagener Angreifer kann sich nicht zurückziehen. */
  readonly fromSeaZone?: true;
  readonly attackerId: string;
  readonly defenderId: string;
  readonly attackerMax: UnitComposition;
  readonly defenderMax: UnitComposition;
  readonly attackerDeployed: boolean;
  readonly defenderDeployed: boolean;
  /** Which of data/BattleMaps' BATTLE_MAPS was rolled for this fight - purely informational
   *  (the terrain itself already lives on each subTerritory), shown in the tactical view header. */
  readonly battleMapName: string;
  readonly subTerritories: readonly BattleSubTerritory[];
  readonly subState: ReadonlyMap<string, BattleSubState> | null;
  readonly activeSide: 'attacker' | 'defender' | null;
  /** 0 during deployment; 1 once the fighting starts, incrementing every time it wraps back to
   *  the attacker (a full round). Both sides know the round limit (see engine/combat.ts's
   *  MAX_BATTLE_ROUNDS) - past it, the defender wins outright, having simply outlasted the clock. */
  readonly battleRound: number;
  /** Jäger and CAS called into this specific battle, at every stage of their round trip - see
   *  CalledAircraft. A side's current Luftüberlegenheit (the bar next to the tactical grid, and the
   *  >50% gate on calling CAS) is always derived from this list's 'active' Jäger entries - see
   *  engine/combat.ts's battleAirSuperiority - rather than cached separately. */
  readonly calledAircraft: readonly CalledAircraft[];
  /** Unentschieden-Angebote (engine/combat.ts's proposeBattleDraw): sparse, nur als `true` vorhanden. Sobald beide
   *  Seiten zugestimmt haben, endet die Schlacht unverändert (kein Gebietswechsel, voller Restbestand bleibt). */
  readonly attackerDrawOffer?: true;
  readonly defenderDrawOffer?: true;
}

/** JSON-safe wire form of PendingBattle (subState Map -> entry array). */
export interface PendingBattleWire {
  readonly territoryId: string;
  readonly fromId: string;
  readonly fromSeaZone?: true;
  readonly attackerId: string;
  readonly defenderId: string;
  readonly attackerMax: UnitComposition;
  readonly defenderMax: UnitComposition;
  readonly attackerDeployed: boolean;
  readonly defenderDeployed: boolean;
  readonly battleMapName: string;
  readonly subTerritories: readonly BattleSubTerritory[];
  readonly subState: readonly (readonly [string, BattleSubState])[] | null;
  readonly activeSide: 'attacker' | 'defender' | null;
  readonly battleRound: number;
  readonly calledAircraft: readonly CalledAircraft[];
  readonly attackerDrawOffer?: true;
  readonly defenderDrawOffer?: true;
}

/**
 * Der dynamische Zustand einer Seezone (die statische Geometrie liegt in SeaZone) - siehe
 * engine/naval.ts. Sparse in GameState.seaZones: eine Zone ohne Eintrag ist neutral und leer.
 * Der Besitz einer Zone hängt an den Schiffen: nur wer in diesem Moment Schiffe darin hat, besitzt sie. Fahren die letzten
 * Schiffe weg oder werden versenkt, verfällt der Anspruch und der Eintrag wird gelöscht (Zone neutral, sparse - siehe
 * engine/naval.ts's setZone). Keine Gästestacks: nur der Besitzer hat Schiffe/Truppen in der Zone.
 */
export interface SeaZoneState {
  readonly ownerId: string | null;
  /** Schiffe des Besitzers in dieser Zone. */
  readonly ships: number;
  /** Davon: Schiffe, die diese Runde eingelaufen oder nach einer gewonnenen Seeschlacht hier
   *  verblieben sind - sie fahren erst nach dem Rundenwechsel wieder (1-Move-Regel, wie `movedIn`). */
  readonly shipsMovedIn: number;
  /** An Bord gegangene Landeinheiten (Kopfzahl pro Typ). Wer eine Zone alleinig besetzt und mindestens
   *  1 eigenes Schiff dort liegen hat, darf Landeinheiten aus angrenzenden Küstengebieten einschiffen. */
  readonly embarked: UnitComposition;
  /** Davon: in dieser Runde eingeschiffte Einheiten - sie laufen erst in der Folgerunde aus. */
  readonly embarkedMovedIn: UnitComposition;
}

/** Ein abgegebener Schuss der Seeschlacht: `cell` = row * gridSize + col, `hit` = ein Schiff wurde
 *  versenkt. Beide Seiten sehen alle Schüsse (Treffer und Fehlschüsse). */
export interface SeaShot {
  readonly cell: number;
  readonly hit: boolean;
}

/**
 * Eine Seeschlacht in Gang ("Schiffe versenken") - siehe engine/naval.ts. Blockiert wie
 * PendingBattle alle anderen Aktionen, ist aber ein eigener Zustand (`GameState.pendingSeaBattle`).
 * Ablauf: Beide Seiten platzieren VERDECKT ihre Flotte auf einem gridSize x gridSize-Raster (jedes Schiff
 * genau 1 Kasten, Angreifer in der oberen, Verteidiger in der unteren Rasterhälfte; genau so viele Schiffe,
 * wie in die Schlacht geschickt werden). Danach schießen die Seiten abwechselnd auf je einen Kasten der
 * gegnerischen Hälfte - jeder Treffer versenkt genau 1 Schiff, Fehlschüsse werden als Wasser markiert. Wer
 * alle gegnerischen Schiffe versenkt hat, gewinnt; das Raster terminiert von selbst.
 *
 * Geheimhaltung: `attackerFleet`/`defenderFleet` enthalten die Zellen der noch schwimmenden Schiffe und
 * stehen nur im autoritativen Zustand - engine/visibility.ts leert die Flotte einer Seite für jeden
 * Betrachter außer ihrem Besitzer (Server sendet nie fremde Flotten). Öffentlich sind nur die
 * Deployed-Flags, die Schüsse und die verbleibende Schiffsanzahl.
 */
export interface PendingSeaBattle {
  readonly zoneId: string;
  /** Woher der Angriff kam: Küstengebiet des Angreifers oder eine angrenzende Seezone (`fromIsZone`). */
  readonly fromId: string;
  readonly fromIsZone: boolean;
  readonly attackerId: string;
  readonly defenderId: string;
  /** Flottengröße zu Beginn: die bewegten Schiffe (Angreifer) bzw. alle Schiffe der Zone (Verteidiger). */
  readonly attackerShips: number;
  readonly defenderShips: number;
  readonly gridSize: number;
  readonly attackerDeployed: boolean;
  readonly defenderDeployed: boolean;
  /** Zellen der noch schwimmenden Schiffe - leer, solange nicht aufgestellt (oder für Fremde verdeckt). */
  readonly attackerFleet: readonly number[];
  readonly defenderFleet: readonly number[];
  /** Verbleibende Schiffe je Seite (öffentlich, auch wenn die Flotte selbst verdeckt ist). */
  readonly attackerRemaining: number;
  readonly defenderRemaining: number;
  /** Schüsse des Angreifers (auf die Hälfte des Verteidigers) bzw. umgekehrt. */
  readonly attackerShots: readonly SeaShot[];
  readonly defenderShots: readonly SeaShot[];
  /** null während der Aufstellung; danach wechselt die aktive Seite nach jedem Schuss. */
  readonly activeSide: 'attacker' | 'defender' | null;
  /** Angebote, die Seeschlacht zu SIMULIEREN (engine/naval.ts's proposeSeaSimulation): sparse, nur als `true` vorhanden.
   *  Stimmen beide Seiten zu (KIs immer), wird sie automatisch ausgetragen. Ein Mensch kann ablehnen (das Angebot
   *  des Gegners verfällt, es wird normal weitergespielt). */
  readonly attackerSimOffer?: true;
  readonly defenderSimOffer?: true;
}

/** Factories and infrastructure built at a territory - see engine/economy.ts. Sparse: a
 *  territory with nothing built has no entry (treat a missing entry as {factories: 0,
 *  infrastructureLevel: 0}). Tracked per territory id, not per owner - conquering a developed
 *  territory keeps whatever was built there. */
export interface TerritoryDevelopment {
  readonly factories: number;
  readonly infrastructureLevel: number;
}

/** A non-aggression pact between two players - see engine/diplomacy.ts. `active` pacts block a
 *  war declaration outright; a cancelled one still blocks it until `blocksWarUntilRound` has
 *  passed (a 3-round cooldown), after which the relation reverts to plain peace. */
export type PactState =
  | { readonly active: true }
  | { readonly active: false; readonly blocksWarUntilRound: number };

/** Relation between one specific pair of players. Missing from `relations` means the default:
 *  at peace, no pact, not allied - which already forbids attacking (see engine/diplomacy.ts's
 *  areAtWar). `allied` and `viaAlliance` are only ever present (as `true`) when they apply, never
 *  stored as `false`, so a relation with neither reads exactly like one from before alliances
 *  existed. */
export interface DiplomaticRelation {
  readonly atWar: boolean;
  readonly pact: PactState | null;
  /** The two players belong to the same alliance - see engine/diplomacy.ts: allies can't fight
   *  each other, see each other's units (engine/visibility.ts) and are dragged into each other's
   *  wars. Alliance membership is a group, kept as a full clique: every pair of members carries
   *  this flag, so "who are X's allies" is just "everyone X has this flag with". */
  readonly allied?: true;
  /** Set only on a war (`atWar`) that exists because of an alliance's automatic war-joining rather
   *  than a direct declaration - used for wording (notifications, the diplomacy modal), it has no
   *  effect on the rules. Cleared whenever the war ends. */
  readonly viaAlliance?: true;
}

/** All diplomacy between every pair of players. `relations` is keyed by engine/diplomacy.ts's
 *  `pairKey(a, b)` (order-independent). `pactProposals` and `allianceProposals` hold one-sided,
 *  not-yet-mutual offers, keyed by `"<fromId>->" + toId` - once both sides have proposed the same
 *  thing to each other it activates immediately and both entries are cleared. */
export interface DiplomacyState {
  readonly relations: ReadonlyMap<string, DiplomaticRelation>;
  readonly pactProposals: ReadonlySet<string>;
  readonly allianceProposals: ReadonlySet<string>;
}

/** JSON-safe wire form of DiplomacyState (Map/Set -> arrays). */
export interface DiplomacyStateWire {
  readonly relations: readonly (readonly [string, DiplomaticRelation])[];
  readonly pactProposals: readonly string[];
  readonly allianceProposals: readonly string[];
}

/** A player's running totals across the whole game so far - unlike territoryState/development
 *  (current snapshots), these only ever accumulate, tracked for the end-of-game stats screen (see
 *  engine/stats.ts and ui/GameScreen.ts's renderStatsView). territoriesConquered only counts
 *  ground taken from an enemy (a peaceful claim onto unowned territory isn't "conquering" it), and
 *  battlesWon only counts a whole engagement's outcome (see engine/stats.ts) - not each individual
 *  tactical sub-map cell exchange along the way. unitsDefeated/unitsLost count raw unit counts
 *  (infantry+lightTank+heavyTank as 1 each), not strength points. */
export interface PlayerStats {
  readonly battlesWon: number;
  readonly territoriesConquered: number;
  readonly unitsDefeated: number;
  readonly unitsLost: number;
}

export interface GameState {
  /** Round number - increments each time the active player wraps back to the first player. */
  readonly turn: number;
  /** Whose turn it currently is; only this player may move units or end the turn. */
  readonly activePlayerId: string;
  readonly players: readonly Player[];
  readonly territoryState: ReadonlyMap<string, TerritoryState>;
  /** Rüstungspunkte per player, spent on recruiting new units, factories and infrastructure. */
  readonly resources: ReadonlyMap<string, number>;
  readonly development: ReadonlyMap<string, TerritoryDevelopment>;
  readonly diplomacy: DiplomacyState;
  /** Cumulative per-player stats for the end-of-game stats screen - see PlayerStats. */
  readonly stats: ReadonlyMap<string, PlayerStats>;
  /** Flugplätze and the aircraft stationed at them - see engine/airforce.ts. Sparse, same
   *  convention as `development`: a territory with no entry has no airfield. */
  readonly airfields: ReadonlyMap<string, AirfieldState>;
  /** Which unit/aircraft types each player has unlocked via the Research tab - see
   *  engine/research.ts. Sparse: a player with no entry has unlocked nothing but Infanterie. */
  readonly research: ReadonlyMap<string, ResearchState>;
  /** A hard cap on how many nukes a player may ever fire (see engine/combat.ts's useNuke), on top
   *  of the usual research+Rüstungspunkte cost - decrements by 1 per use, blocks at 0 regardless of
   *  resources. Sparse and optional by design: a player with no entry here has no cap at all (the
   *  normal game's behavior, unchanged) - only scenarios that explicitly hand out a stockpile (see
   *  data/Scenarios/types.ts's ScenarioFaction.nukeStockpile) are limited this way. */
  readonly nukeStockpiles: ReadonlyMap<string, number>;
  /** Set while a battle (deployment or the tactical fight itself) is in progress; blocks all
   *  other actions (see engine/combat.ts) until it concludes. */
  readonly pendingBattle: PendingBattle | null;
  /** Der dynamische Zustand aller Seezonen (Besitzer, Schiffe, eingeschiffte Landeinheiten) - sparse:
   *  eine Zone ohne Eintrag ist neutral und leer. Siehe SeaZoneState und engine/naval.ts. */
  readonly seaZones: ReadonlyMap<string, SeaZoneState>;
  /** Gesetzt, solange eine Seeschlacht läuft; blockiert wie pendingBattle alle anderen Aktionen. */
  readonly pendingSeaBattle: PendingSeaBattle | null;
}

/** A human seat in the pre-game lobby. */
export interface LobbySlot {
  readonly playerId: string;
  readonly name: string;
  readonly color: string;
  readonly capitalId: string | null;
  readonly isHost: boolean;
}

/** An AI seat, added interactively in the lobby - it gets a capital immediately, not at start. */
export interface AiSlot {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly capitalId: string;
}

export interface LobbyState {
  readonly code: string;
  /** Which of data/MainMaps' MAIN_MAPS this lobby plays on (see MainMapEntry.id) - set once, by
   *  whoever creates the lobby, same as aiDifficulty below. A joining online client resolves it
   *  locally against its own MAIN_MAPS rather than receiving the map data itself over the wire. */
  readonly mapId: string;
  /** Caps how many human slots may join; unrelated to how many AI get added. */
  readonly maxHumans: number;
  readonly slots: readonly LobbySlot[];
  readonly aiSlots: readonly AiSlot[];
  readonly status: 'lobby' | 'started';
  /** Set once, by whoever creates the lobby (see engine/session.ts's createLobby) - applies to
   *  every AI seat added to this lobby, "am Spielbeginn einstellen, wie gut die KI ist" rather
   *  than a per-seat choice. Copied onto each AI's Player at game start (see
   *  Player.aiDifficulty/engine/setup.ts's buildGameStateFromLobby). */
  readonly aiDifficulty: AiDifficulty;
  /** Optional (sparse - fehlt in alten Lobbys/Spielständen): Id eines Szenarios aus data/Scenarios. Dann wählen die
   *  Menschen keine freie Hauptstadt, sondern eine Szenario-Fraktion (claimCapital mit deren capitalId), alle nicht
   *  gewählten Fraktionen werden KI-Sitze und buildGameStateFromLobby baut den Startzustand des Szenarios. `mapId`
   *  ist dann die Karte des Szenarios. */
  readonly scenarioId?: string;
}

/** JSON-safe wire form of GameState (Map -> entry array). */
export interface GameStateWire {
  readonly turn: number;
  readonly activePlayerId: string;
  readonly players: readonly Player[];
  readonly territoryState: readonly (readonly [string, TerritoryState])[];
  readonly resources: readonly (readonly [string, number])[];
  readonly development: readonly (readonly [string, TerritoryDevelopment])[];
  readonly diplomacy: DiplomacyStateWire;
  readonly stats: readonly (readonly [string, PlayerStats])[];
  readonly airfields: readonly (readonly [string, AirfieldState])[];
  readonly research: readonly (readonly [string, ResearchState])[];
  readonly nukeStockpiles: readonly (readonly [string, number])[];
  readonly pendingBattle: PendingBattleWire | null;
  readonly seaZones: readonly (readonly [string, SeaZoneState])[];
  /** Schon JSON-sicher (keine Maps/Sets) - wird 1:1 übertragen. */
  readonly pendingSeaBattle: PendingSeaBattle | null;
}
