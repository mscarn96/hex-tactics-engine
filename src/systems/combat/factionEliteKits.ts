import { heroesOf, isAlive } from '@/systems/combat/targetLegality';
import { AuraType, ArenaHazard, CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { arenaHexes, discAround } from '@/systems/combat/arenaGeometry';
import { byHex, occupiedKeys, solidKeys } from '@/systems/combat/eliteKits';
import { duelBars, inDuelCircle } from '@/systems/combat/duelRules';
import { expectedDamage } from '@/systems/combat/damageCalc';
import { hasEffect } from '@/systems/combat/statusEffects';
import { getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';

/**
 * The rules of the four new-faction elites' signatures, as pure functions over a roster.
 *
 * The Burrowmother's Undermine, the Herd-Khan's Twin Raid, the Rime Jarl's Challenge and
 * the Glacier Colossus's Glacial Tomb (the private project notes). Like
 * `eliteKits`, this file decides and measures and `factionEliteActions` puts it on the
 * board, so the HUD, the Node suites and the tuning harness ask what the fight asks.
 *
 * Nothing here imports the store.
 */

export const FACTION_ELITE_TEMPLATE = {
  mother: 'burrowmother',
  khan: 'herd_khan',
  jarl: 'rime_jarl',
  colossus: 'glacier_colossus',
} as const;

export type FactionEliteKey = keyof typeof FACTION_ELITE_TEMPLATE;

/** Whether this unit is that elite. A hero never is: heroes carry no template. */
export const isFactionElite = (unit: CombatUnit, key: FactionEliteKey): boolean =>
  unit.templateId === FACTION_ELITE_TEMPLATE[key] && !unit.objective;


const centreOf = (hexes: HexCoord[]): { q: number; r: number } => ({
  q: hexes.reduce((n, h) => n + h.q, 0) / hexes.length,
  r: hexes.reduce((n, h) => n + h.r, 0) / hexes.length,
});

const gap = (a: HexCoord, b: { q: number; r: number }): number =>
  Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

// ── Burrowmother: Undermine ──────────────────────────────────────────────────

/** Whether she is under the sand: nothing can aim at her and nothing lands on her. */
export const isBurrowed = (unit: CombatUnit): boolean => hasEffect(unit, AuraType.Burrowed);

export const SAND_MITE_TEMPLATE = 'sand_mite';

/** Living Sand Mites she has made and that still stand. */
export const mitesOf = (mother: CombatUnit, units: CombatUnit[]): CombatUnit[] =>
  units.filter(
    (u) => isAlive(u) && u.summonedBy === mother.id && u.templateId === SAND_MITE_TEMPLATE && !u.objective,
  );

/** The six hexes at exactly the footprint's radius from its centre: where a vent can open. */
const ringAround = (centre: HexCoord): HexCoord[] =>
  discAround(centre, BALANCE.UNDERMINE_RADIUS).filter((h) => hexDistance(centre, h) === BALANCE.UNDERMINE_RADIUS);

export interface UndermineShape {
  centre: HexCoord;
  /** The ground that will erupt, solid ground left out. */
  hexes: HexCoord[];
  /** The openings on its edge. */
  vents: HexCoord[];
}

/**
 * Where the eruption will be, and where its vents open.
 *
 * The centre is the hex that puts the most heroes in the footprint (then one nobody
 * stands on, so she has somewhere to surface, then the one nearest the party's
 * middle, then by coordinate): "marked under the party". Vents are two on the edge,
 * three against a party of three or more, spread as far round the ring as it allows
 * and turned to the arrangement that leaves the most of them unplugged on the cast
 * (so the party has something to plug). Solid ground is never marked. Null when the
 * board offers no footprint at all.
 */
export function undermineShape(
  mother: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): UndermineShape | null {
  const heroes = heroesOf(units);
  if (heroes.length === 0) return null;
  const solid = solidKeys(hazards);
  const taken = occupiedKeys(units, mother.id);
  const middle = centreOf(heroes.map((h) => h.position));
  const heroKeys = new Set(heroes.map((h) => hexKey(h.position)));

  const covered = (c: HexCoord) =>
    discAround(c, BALANCE.UNDERMINE_RADIUS).filter((h) => heroKeys.has(hexKey(h))).length;
  const centres = arenaHexes()
    .filter((h) => !solid.has(hexKey(h)))
    .map((h) => ({ q: h.q, r: h.r }))
    .sort(
      (a, b) =>
        covered(b) - covered(a) ||
        Number(taken.has(hexKey(a))) - Number(taken.has(hexKey(b))) ||
        gap(a, middle) - gap(b, middle) ||
        byHex(a, b),
    );
  const centre = centres[0];
  if (!centre) return null;

  const hexes = discAround(centre, BALANCE.UNDERMINE_RADIUS).filter((h) => !solid.has(hexKey(h)));
  const ring = ringAround(centre)
    .filter((h) => !solid.has(hexKey(h)))
    // Round the ring in a fixed order, so the same board lays the same vents
    .sort((a, b) => Math.atan2(a.r - centre.r, a.q - centre.q) - Math.atan2(b.r - centre.r, b.q - centre.q));
  const count = Math.min(
    ring.length,
    heroes.length >= 3 ? BALANCE.UNDERMINE_VENTS_LARGE_PARTY : BALANCE.UNDERMINE_VENTS,
  );
  if (count === 0) return null;

  let best: HexCoord[] = [];
  let bestOpen = -1;
  for (let turn = 0; turn < ring.length; turn++) {
    const picked = Array.from({ length: count }, (_, i) => ring[(turn + Math.floor((i * ring.length) / count)) % ring.length]);
    const open = picked.filter((h) => !taken.has(hexKey(h))).length;
    if (open > bestOpen) {
      best = picked;
      bestOpen = open;
    }
  }
  return { centre, hexes, vents: best.map((h) => ({ q: h.q, r: h.r })) };
}

/**
 * Where she surfaces: the centre if it is free, else the free hex of the footprint
 * nearest it, else wherever she is. The party is shown the centre; nobody is ever
 * displaced to make room.
 */
export function surfaceHex(
  mother: CombatUnit,
  attack: PreparedAttack,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): HexCoord {
  const taken = occupiedKeys(units, mother.id);
  const solid = solidKeys(hazards);
  const centre = attack.centres?.[0] ?? attack.aim;
  const free = [...attack.hexes, centre]
    .filter((h) => !taken.has(hexKey(h)) && !solid.has(hexKey(h)))
    .sort((a, b) => hexDistance(a, centre) - hexDistance(b, centre) || byHex(a, b));
  return free[0] ? { q: free[0].q, r: free[0].r } : mother.position;
}

/** A vent is plugged while a hero stands on it. */
export const ventPlugged = (vent: HexCoord, units: CombatUnit[]): boolean =>
  heroesOf(units).some((h) => hexKey(h.position) === hexKey(vent));

/**
 * The vents that will open a Sand Mite when the eruption lands: every one no hero
 * stands on, nothing else stands on, and the cap on mites standing leaves room for.
 * The preview and the landing both read this, so the party is shown what spawns.
 */
export function ventsThatSpawn(
  mother: CombatUnit,
  vents: HexCoord[],
  units: CombatUnit[],
): HexCoord[] {
  const taken = occupiedKeys(units, mother.id);
  const room = Math.max(0, BALANCE.UNDERMINE_MITE_CAP - mitesOf(mother, units).length);
  return vents.filter((v) => !ventPlugged(v, units) && !taken.has(hexKey(v))).slice(0, room);
}

// ── Herd-Khan: Twin Raid ─────────────────────────────────────────────────────

export interface RaidLeg {
  from: HexCoord;
  to: HexCoord;
  /** The hexes crossed, excluding the start and including the landing. */
  path: HexCoord[];
  /** Heroes within the burst of the landing, as it would stand now. */
  caught: string[];
}

/**
 * Every hex a dash from `from` can land on and the route to it: up to `reach` steps
 * across free ground, never through a body or a solid hex, never off the board.
 * Breadth-first with a fixed neighbour order so one board always plans one route.
 */
export function dashRoutes(
  from: HexCoord,
  reach: number,
  blocked: ReadonlySet<string>,
): Map<string, HexCoord[]> {
  const board = new Set(arenaHexes().map(hexKey));
  const routes = new Map<string, HexCoord[]>();
  let frontier: { hex: HexCoord; path: HexCoord[] }[] = [{ hex: from, path: [] }];
  const seen = new Set([hexKey(from)]);
  for (let step = 0; step < reach; step++) {
    const next: { hex: HexCoord; path: HexCoord[] }[] = [];
    for (const { hex, path } of frontier) {
      for (const n of getNeighbors(hex).sort(byHex)) {
        const key = hexKey(n);
        if (seen.has(key) || !board.has(key) || blocked.has(key)) continue;
        seen.add(key);
        const route = [...path, { q: n.q, r: n.r }];
        routes.set(key, route);
        next.push({ hex: n, path: route });
      }
    }
    frontier = next;
  }
  return routes;
}

const caughtBy = (landing: HexCoord, heroes: CombatUnit[]): string[] =>
  heroes
    .filter((h) => hexDistance(h.position, landing) <= BALANCE.TWIN_RAID_RADIUS)
    .map((h) => h.id);

/**
 * The Khan's two dashes, planned against the board as it stands.
 *
 * Each is up to `TWIN_RAID_DASH` hexes to an empty reachable hex, and the second starts
 * where the first ended. The pair is chosen jointly for the most heroes caught across
 * both arrivals (a hero caught twice counts twice, one more distinct hero breaks a tie),
 * then for finishing nearer the party. If no second dash is legal the raid ends after
 * the first burst. Empty when no landing catches anybody: he does not raid for show.
 */
export function planTwinRaid(
  khan: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): RaidLeg[] {
  const heroes = heroesOf(units);
  if (heroes.length === 0) return [];
  const blocked = new Set([...occupiedKeys(units, khan.id), ...solidKeys(hazards)]);
  const middle = centreOf(heroes.map((h) => h.position));

  type Plan = { legs: RaidLeg[]; hits: number; distinct: number; end: number };
  let best: Plan | null = null;
  const consider = (legs: RaidLeg[]) => {
    const hits = legs.reduce((n, l) => n + l.caught.length, 0);
    if (hits === 0) return;
    const distinct = new Set(legs.flatMap((l) => l.caught)).size;
    const end = gap(legs[legs.length - 1].to, middle);
    if (
      !best ||
      hits > best.hits ||
      (hits === best.hits && distinct > best.distinct) ||
      (hits === best.hits && distinct === best.distinct && end < best.end)
    ) {
      best = { legs, hits, distinct, end };
    }
  };

  const first = dashRoutes(khan.position, BALANCE.TWIN_RAID_DASH, blocked);
  for (const [key1, path1] of [...first].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const to1 = path1[path1.length - 1];
    const leg1: RaidLeg = { from: khan.position, to: to1, path: path1, caught: caughtBy(to1, heroes) };
    consider([leg1]);
    // The first landing is taken by the Khan now: his old hex is free again for the second
    const blocked2 = new Set(blocked);
    blocked2.add(key1);
    const second = dashRoutes(to1, BALANCE.TWIN_RAID_DASH, blocked2);
    for (const [, path2] of [...second].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const to2 = path2[path2.length - 1];
      consider([leg1, { from: to1, to: to2, path: path2, caught: caughtBy(to2, heroes) }]);
    }
  }
  return (best as Plan | null)?.legs ?? [];
}

// ── Rime Jarl: Jarl's Challenge ──────────────────────────────────────────────

/** The hexes the rune circle covers: a disc round its fixed centre, solid ground left out. */
export function duelHexes(
  centre: HexCoord,
  radius: number,
  hazards: readonly ArenaHazard[] = [],
): HexCoord[] {
  const solid = solidKeys(hazards);
  return discAround(centre, radius).filter((h) => !solid.has(hexKey(h)));
}

export { duelBars, inDuelCircle };

/** The Jarl and the hero in a duel, else empty. */
export const duelists = (units: CombatUnit[]): CombatUnit[] => units.filter((u) => isAlive(u) && !!u.duel);

/** Whether a challenge has been issued and not yet answered, or a duel is on. */
export const challengeOpen = (units: CombatUnit[]): boolean =>
  units.some((u) => isAlive(u) && (!!u.duel || !!u.challenge));

/**
 * Whether the Jarl can name `hero` now: no challenge is open, and both stand on
 * connected walkable ground inside the circle that would form round the Jarl's hex.
 */
export function canChallenge(
  jarl: CombatUnit,
  hero: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): boolean {
  if (!isAlive(jarl) || !isAlive(hero) || challengeOpen(units)) return false;
  if (hero.isPlayer === jarl.isPlayer || hero.objective || hero.summonedBy) return false;
  const ring = duelHexes(jarl.position, BALANCE.CHALLENGE_RADIUS, hazards);
  const inside = new Set(ring.map(hexKey));
  if (!inside.has(hexKey(hero.position))) return false;
  // Connected: a walk from the Jarl to the hero that never leaves the circle
  const seen = new Set([hexKey(jarl.position)]);
  const queue = [jarl.position];
  while (queue.length > 0) {
    const here = queue.shift() as HexCoord;
    if (hexKey(here) === hexKey(hero.position)) return true;
    for (const n of getNeighbors(here)) {
      const key = hexKey(n);
      if (!seen.has(key) && inside.has(key)) {
        seen.add(key);
        queue.push(n);
      }
    }
  }
  return false;
}

/** The pending challenge a hero has been issued, if any, with the Jarl who issued it. */
export function challengeFor(
  hero: CombatUnit,
  units: CombatUnit[],
): { jarl: CombatUnit } | null {
  if (!hero.challenge) return null;
  const jarl = units.find((u) => u.id === hero.challenge!.jarlId);
  return jarl && isAlive(jarl) ? { jarl } : null;
}

/**
 * Whether a pending challenge still stands: both are alive and both are still inside the
 * circle that was previewed. Checked as the answer is asked for, and as either of them
 * moves or falls.
 */
export function challengeStands(hero: CombatUnit, units: CombatUnit[]): boolean {
  const open = challengeFor(hero, units);
  if (!open || !isAlive(hero)) return false;
  const { centre, radius } = hero.challenge!;
  return (
    hexDistance(centre, open.jarl.position) <= radius && hexDistance(centre, hero.position) <= radius
  );
}

/**
 * How an AI-driven hero (a harness's, or one the Dark Mage is holding) answers: accept when
 * they can comfortably outlast the Jarl's best blows, at the duel's bonus, for the turns
 * the duel runs and have something to hit him with; refuse otherwise. The player is shown
 * the same numbers (`duelOffer`) and decides for themselves.
 */
export function decideChallenge(hero: CombatUnit, jarl: CombatUnit, units: CombatUnit[]): boolean {
  const best = Math.max(
    0,
    ...jarl.skills
      .filter((s) => (s.damage ?? 0) > 0)
      .map((s) => expectedDamage(jarl, hero, s, 'front', units)),
  );
  const exposure = best * (1 + BALANCE.DUEL_DAMAGE_BONUS) * BALANCE.DUEL_TURNS;
  const canHurt = hero.skills.some((s) => (s.damage ?? 0) > 0);
  return canHurt && hero.currentHp > exposure * 1.5;
}

/** What the hero is shown before they commit: the Jarl's reach in the duel, in plain numbers. */
export function duelOffer(
  hero: CombatUnit,
  jarl: CombatUnit,
): { bonus: number; turns: number; barrier: number; barrierTurns: number } {
  return {
    bonus: BALANCE.DUEL_DAMAGE_BONUS,
    turns: BALANCE.DUEL_TURNS,
    barrier: Math.round(jarl.stats.maxHp * BALANCE.REFUSE_BARRIER),
    barrierTurns: BALANCE.REFUSE_BARRIER_TURNS,
  };
}

/** Whether the duel has run its course: both duelists have ended their turns. */
export function duelRunOut(units: CombatUnit[]): boolean {
  const bound = duelists(units);
  return bound.length > 0 && bound.every((u) => (u.duel?.turns ?? 0) >= BALANCE.DUEL_TURNS);
}

// ── Glacier Colossus: Glacial Tomb ───────────────────────────────────────────

export const TOMB_KIND = 'glacialTomb';

/** The tomb the Colossus has standing, if any: at most one. */
export const tombOf = (colossus: CombatUnit, units: CombatUnit[]): CombatUnit | undefined =>
  units.find((u) => isAlive(u) && u.objective?.kind === TOMB_KIND && u.objective.ownerId === colossus.id);

/** Whether this hero is sealed. */
export const isEncased = (unit: CombatUnit): boolean => hasEffect(unit, AuraType.Encased);

/** The hero a tomb holds. */
export const tombHero = (tomb: CombatUnit, units: CombatUnit[]): CombatUnit | undefined =>
  tomb.objective?.linkedUnitId ? units.find((u) => u.id === tomb.objective!.linkedUnitId) : undefined;

/** Whether the Colossus may seal a hero now: none is sealed and a second hero stands to answer. */
export const canTomb = (colossus: CombatUnit, units: CombatUnit[]): boolean =>
  !tombOf(colossus, units) && heroesOf(units).filter((h) => !isEncased(h)).length >= 2;

/**
 * Who the tomb takes: the hero who would hurt the party most if freed to act (the
 * hardest hitter, then the sturdiest), among those within `range`. Never one already
 * sealed, hidden or out of reach.
 */
export function tombTarget(
  colossus: CombatUnit,
  skill: Pick<HeroSkill, 'range'>,
  units: CombatUnit[],
): CombatUnit | null {
  return (
    heroesOf(units)
      .filter((h) => !isEncased(h) && hexDistance(colossus.position, h.position) <= skill.range)
      .sort(
        (a, b) =>
          Math.max(b.stats.attack, b.stats.magic) - Math.max(a.stats.attack, a.stats.magic) ||
          b.stats.maxHp - a.stats.maxHp ||
          (a.id < b.id ? -1 : 1),
      )[0] ?? null
  );
}

/** The six hexes a broken tomb bursts over. */
export const shatterHexes = (tomb: HexCoord): HexCoord[] => getNeighbors(tomb).filter((h) => arenaHexes().some((a) => hexKey(a) === hexKey(h)));
