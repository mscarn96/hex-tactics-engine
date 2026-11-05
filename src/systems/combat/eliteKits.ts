import { heroesOf, isAlive } from '@/systems/combat/targetLegality';
import { AfflictionType, ArenaHazard, AuraType, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { painFeastSlash } from '@/data/skills/eliteSkills';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { arenaHexes, discAround, solidKeys } from '@/systems/combat/arenaGeometry';
import { ForcedMove, traceForcedMove } from '@/systems/combat/forcedMovement';
import { hasPassive } from '@/systems/combat/passives';
import { hasEffect } from '@/systems/combat/statusEffects';
import { spawnsBehind } from '@/systems/combat/formation';
import { getHexLine, hexDistance, hexKey } from '@/utils/hexUtils';
import { t } from '@/i18n';

/**
 * The rules of the ten elites' signatures, as pure functions over a roster.
 *
 * Each elite has one thing that belongs to it and to nobody else (the plan's
 * "Elite concepts"): this file owns what each one decides and measures, and the
 * store (`combatStore`) and `eliteActions` put it on the board — the same split
 * the bosses have (`trollScript` / `trollActions`). Nothing here imports the
 * store, so the HUD, the Node suites and the tuning harness ask the same questions
 * the fight does.
 */

export const ELITE_TEMPLATE = {
  bear: 'cave_bear',
  mage: 'dark_mage',
  hulk: 'bog_hulk',
  berserker: 'orc_berserker',
  warchief: 'orc_warchief',
  revenant: 'revenant',
  matriarch: 'coven_matriarch',
  crone: 'ashwood_crone',
  overseer: 'delve_overseer',
  captain: 'brigand_captain',
} as const;

export type EliteKey = keyof typeof ELITE_TEMPLATE;

/** Whether this unit is that elite. A hero never is: heroes carry no template. */
export const isElite = (unit: CombatUnit, key: EliteKey): boolean =>
  unit.templateId === ELITE_TEMPLATE[key] && !unit.objective;


export const occupiedKeys = (units: CombatUnit[], except?: string): Set<string> =>
  new Set(units.filter((u) => isAlive(u) && u.id !== except).map((u) => hexKey(u.position)));

/** Defined beside movement, which needs it too; kept importable from here for the kits. */
export { solidKeys };

export const byHex = (a: HexCoord, b: HexCoord): number => a.q - b.q || a.r - b.r;

// ── Revenant: Soul Fracture ──────────────────────────────────────────────────

export const SOUL_FRAGMENT_KIND = 'soulFragment';

/** Whether this body is lying inert while its fragments race home. */
export const isSoulSplit = (unit: CombatUnit): boolean => hasEffect(unit, AuraType.SoulSplit);

/** The fragments of `body` still on the board. */
export const fragmentsOf = (body: CombatUnit, units: CombatUnit[]): CombatUnit[] =>
  units.filter(
    (u) => isAlive(u) && u.objective?.kind === SOUL_FRAGMENT_KIND && u.objective.ownerId === body.id,
  );

/**
 * Where the fragments are laid: the grave marks. Free hexes three to five from
 * the body, chosen one after another so each is as far from the ones already
 * chosen as the board allows (the first from the hero centre of the party, so the
 * marks are never all behind them). A fixed order breaks every tie — the same
 * board lays the same graves — and a board too crowded to hold three is given
 * fewer, never a hex under a living unit.
 */
export function soulSpots(
  body: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
  count: number = BALANCE.SOUL_FRAGMENTS,
): HexCoord[] {
  const taken = occupiedKeys(units);
  const solid = solidKeys(hazards);
  const free = arenaHexes().filter(
    (h) =>
      !taken.has(hexKey(h)) &&
      !solid.has(hexKey(h)) &&
      hexDistance(h, body.position) >= 3 &&
      hexDistance(h, body.position) <= 5,
  );
  const heroes = heroesOf(units);
  const centre = heroes.length
    ? {
        q: heroes.reduce((n, h) => n + h.position.q, 0) / heroes.length,
        r: heroes.reduce((n, h) => n + h.position.r, 0) / heroes.length,
      }
    : body.position;
  const gap = (a: HexCoord, b: { q: number; r: number }) =>
    Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

  const picked: HexCoord[] = [];
  const pool = [...free].sort(byHex);
  while (picked.length < count && pool.length > 0) {
    const score = (h: HexCoord) =>
      picked.length === 0
        ? gap(h, centre)
        : Math.min(...picked.map((p) => hexDistance(p, h)));
    let best = pool[0];
    for (const h of pool) if (score(h) > score(best)) best = h;
    picked.push({ q: best.q, r: best.r });
    pool.splice(pool.indexOf(best), 1);
  }
  return picked;
}

/** The hexes a fragment crosses to reach `body`, nearest first, ending beside it. */
export function soulRoute(from: HexCoord, body: HexCoord): HexCoord[] {
  return getHexLine(from, body)
    .slice(1)
    .filter((h) => hexDistance(h, body) >= 1)
    .map((h) => ({ q: h.q, r: h.r }));
}

/**
 * One fragment's step: along its route up to `BALANCE.SOUL_FRAGMENT_STEP` hexes,
 * round whatever stands on the way (a hero in the path blocks that hex, not the
 * fragment — it takes the free hex that is nearest the body, so a wall of bodies
 * delays it and cannot hold it for ever), and home when it is beside the body.
 */
export function stepFragment(
  fragment: CombatUnit,
  body: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): { position: HexCoord; arrived: boolean } {
  const taken = occupiedKeys(units, fragment.id);
  const solid = solidKeys(hazards);
  let here = fragment.position;
  for (let i = 0; i < BALANCE.SOUL_FRAGMENT_STEP; i++) {
    if (hexDistance(here, body.position) <= 1) break;
    const options = arenaHexes()
      .filter(
        (h) =>
          hexDistance(h, here) === 1 &&
          hexDistance(h, body.position) < hexDistance(here, body.position) &&
          !taken.has(hexKey(h)) &&
          !solid.has(hexKey(h)),
      )
      .sort(
        (a, b) =>
          hexDistance(a, body.position) - hexDistance(b, body.position) ||
          onLine(a, fragment.objective?.route) - onLine(b, fragment.objective?.route) ||
          byHex(a, b),
      );
    if (options.length === 0) break;
    here = { q: options[0].q, r: options[0].r };
  }
  return { position: here, arrived: hexDistance(here, body.position) <= 1 };
}

/** 0 for a hex on the fragment's drawn route, 1 for one off it — the route wins a tie. */
const onLine = (hex: HexCoord, route: readonly HexCoord[] | undefined): number =>
  route?.some((r) => r.q === hex.q && r.r === hex.r) ? 0 : 1;

/** The share of maximum health the reformed body wakes with, from the arrivals. */
export const reformedFraction = (arrived: number): number =>
  Math.min(1, arrived * BALANCE.SOUL_REFORM_PER_FRAGMENT);

// ── Orc Berserker: Pain Feast ────────────────────────────────────────────────

/** Rage the unit is holding: the separate blows it has taken since its last feast, to the cap. */
export const rageStacks = (unit: CombatUnit): number =>
  Math.round(unit.activeEffects.find((e) => e.type === AuraType.Rage)?.magnitude ?? 0);

/** Whether the unit's next Slash is the feast: it carries Pain Feast and its Rage is full. */
export const feastReady = (unit: CombatUnit): boolean =>
  hasPassive(unit, 'painFeast') && rageStacks(unit) >= BALANCE.PAIN_FEAST_THRESHOLD;

export const isFeastSlash = (skill: HeroSkill): boolean => skill.id === painFeastSlash.id;

/**
 * The skills a unit chooses among this turn. Ordinary units choose among their
 * own; a Berserker whose Rage is full has its Slash replaced by the feast, so the
 * empowered swing is the one thing it can do with that skill — it is *the next
 * Slash*, not an extra button — and goes back to its ordinary Slash the turn the
 * Rage is spent (`eliteActions.afterEliteCast`).
 */
export function eliteSkillsFor(unit: CombatUnit): HeroSkill[] {
  if (!feastReady(unit)) return unit.skills;
  return unit.skills.map((s) => (s.id === 'slash' ? painFeastSlash : s));
}

// ── Dark Mage: Mind Control ──────────────────────────────────────────────────

const isHero = (u: CombatUnit): boolean =>
  u.isPlayer && u.heroId !== undefined && !u.summonedBy && !u.objective;

/**
 * Whether the Mage's spell may take this unit: a hero, with another living hero
 * beside them. The last hero standing is never taken — the plan's explicit rule —
 * so a party of one cannot be turned on itself, and a party whose other members
 * have fallen by the time the turn comes is freed (`controlVerdict`).
 */
export const canBeSeized = (unit: CombatUnit, units: CombatUnit[]): boolean =>
  isHero(unit) &&
  !unit.seized &&
  units.some((u) => u.id !== unit.id && isHero(u) && isAlive(u) && !u.seized);

export type ControlVerdict = 'none' | 'seize' | 'free';

/**
 * What a unit's turn beginning does about the Mind Control it carries: nothing
 * (it carries none), take the turn for the Mage, or free it. The control holds only
 * while the Mage that cast it stands and another hero does; either falling frees
 * the hero for good, so killing the Mage is a real answer and a party cannot be
 * turned on its own last member.
 */
export function controlVerdict(unit: CombatUnit, units: CombatUnit[]): ControlVerdict {
  const held = unit.activeEffects.find((e) => e.type === AfflictionType.MindControl);
  if (!held) return 'none';
  const source = held.sourceUnitId ? units.find((u) => u.id === held.sourceUnitId) : undefined;
  if (!source || !isAlive(source)) return 'free';
  return canBeSeized(unit, units) ? 'seize' : 'free';
}

// ── Bog Hulk: Mire Undertow ──────────────────────────────────────────────────

/** The marsh the slam leaves: every hex within reach of the Hulk but the one he stands on. */
export const mireHexes = (hulk: HexCoord): HexCoord[] =>
  discAround(hulk, BALANCE.MIRE_RADIUS).filter((h) => h.q !== hulk.q || h.r !== hulk.r);

/**
 * Where the marsh drags one body: toward `origin`, up to `distance` hexes, stopping
 * before the first hex that is off the board, holds a unit or an objective, or is
 * solid ground — the same stops a shove has, because it is the same trace run the
 * other way. A body that refuses to be moved (Immovable) stays where it is, and so
 * does one that is already beside `origin`.
 *
 * The pull is a push from the mirror of `origin` through the target, which makes it
 * `traceForcedMove` and not a second walk that could disagree with it about a wall.
 */
export function traceForcedPull(
  origin: HexCoord,
  target: CombatUnit,
  distance: number,
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
): ForcedMove {
  const mirror = {
    q: 2 * target.position.q - origin.q,
    r: 2 * target.position.r - origin.r,
  };
  return traceForcedMove(mirror, target, distance, units, hazards);
}

/** The nearest to the Hulk is pulled first, so the front of a crowd clears the way for the rest. */
export const pullOrder = (origin: HexCoord, targets: CombatUnit[]): CombatUnit[] =>
  [...targets].sort(
    (a, b) =>
      hexDistance(origin, a.position) - hexDistance(origin, b.position) ||
      a.position.q - b.position.q ||
      a.position.r - b.position.r,
  );

/**
 * Every pull of one marsh, in the order it will resolve, each seeing where the
 * ones before it left their bodies — the preview and the resolution are this one
 * function, so the hexes the party is shown are the hexes it is dragged to.
 */
export function previewPulls(
  origin: HexCoord,
  targets: CombatUnit[],
  distance: number,
  units: CombatUnit[],
  hazards: ArenaHazard[] = [],
): ForcedMove[] {
  let occupancy = units;
  const moves: ForcedMove[] = [];
  for (const target of pullOrder(origin, targets)) {
    const move = traceForcedPull(origin, target, distance, occupancy, hazards);
    moves.push(move);
    if (move.moved) {
      occupancy = occupancy.map((u) => (u.id === target.id ? { ...u, position: move.to } : u));
    }
  }
  return moves;
}

// ── Delve Overseer: Fracture ─────────────────────────────────────────────────

/** Living heroes carrying a Fracture mark. */
export const fracturedHeroes = (units: CombatUnit[]): CombatUnit[] =>
  heroesOf(units).filter((h) => hasEffect(h, AfflictionType.Fracture));

/**
 * What a Fracture Slam erupts over: the ground round the Overseer, and the ground
 * round every Fractured hero wherever they stand. Hexes are listed once — two
 * rings that overlap are one blast, not two.
 */
export function fractureFootprint(overseer: HexCoord, marked: readonly HexCoord[]): HexCoord[] {
  const seen = new Set<string>();
  const out: HexCoord[] = [];
  for (const centre of [overseer, ...marked]) {
    for (const h of discAround(centre, BALANCE.FRACTURE_RADIUS)) {
      if (seen.has(hexKey(h))) continue;
      seen.add(hexKey(h));
      out.push(h);
    }
  }
  return out;
}

// ── Coven Matriarch: Briar Claim ─────────────────────────────────────────────

export const SEED_KIND = 'briarSeed';
export const THRALL_TEMPLATE = 'coven_thrall';

/** Heroes the Matriarch's own poison is on. */
export const poisonedBy = (hero: CombatUnit, matriarch: CombatUnit): boolean =>
  hero.activeEffects.some(
    (e) => e.type === AfflictionType.Poison && e.sourceUnitId === matriarch.id,
  );

export const seedsOf = (matriarch: CombatUnit, units: CombatUnit[]): CombatUnit[] =>
  units.filter(
    (u) => isAlive(u) && u.objective?.kind === SEED_KIND && u.objective.ownerId === matriarch.id,
  );

export const thrallsOf = (matriarch: CombatUnit, units: CombatUnit[]): CombatUnit[] =>
  units.filter(
    (u) =>
      isAlive(u) && u.summonedBy === matriarch.id && u.templateId === THRALL_TEMPLATE && !u.objective,
  );

/**
 * The hero a seed is planted beside: of those her Blight has poisoned, the one with
 * the most doses, then the lowest health, then the lowest id — one board, one seed.
 */
export function briarTarget(matriarch: CombatUnit, units: CombatUnit[]): CombatUnit | null {
  const doses = (h: CombatUnit) =>
    h.activeEffects.find((e) => e.type === AfflictionType.Poison)?.stacks ?? 1;
  const poisoned = heroesOf(units).filter((h) => poisonedBy(h, matriarch));
  if (poisoned.length === 0) return null;
  return [...poisoned].sort(
    (a, b) => doses(b) - doses(a) || a.currentHp - b.currentHp || (a.id < b.id ? -1 : 1),
  )[0];
}

/**
 * Where the seed goes: the free hex beside `hero` that is nearest the Matriarch (it
 * is hers, and it grows between them), then by coordinate. Never under a living
 * unit or in solid ground; null when the hero is boxed in on every side.
 */
export function seedHex(
  matriarch: CombatUnit,
  hero: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): HexCoord | null {
  const taken = occupiedKeys(units);
  const solid = solidKeys(hazards);
  const options = arenaHexes()
    .filter(
      (h) =>
        hexDistance(h, hero.position) === 1 && !taken.has(hexKey(h)) && !solid.has(hexKey(h)),
    )
    .sort(
      (a, b) =>
        hexDistance(a, matriarch.position) - hexDistance(b, matriarch.position) || byHex(a, b),
    );
  return options.length > 0 ? { q: options[0].q, r: options[0].r } : null;
}

/** Whether she may plant a seed now: none is standing and the Thralls are under their cap. */
export const canPlantSeed = (matriarch: CombatUnit, units: CombatUnit[]): boolean =>
  seedsOf(matriarch, units).length === 0 &&
  thrallsOf(matriarch, units).length < BALANCE.BRIAR_THRALL_CAP;

// ── Ashwood Crone: Witch's Geas ──────────────────────────────────────────────

/** A basic attack is the one action the Geas never punishes. */
export const isBasicAction = (skill: HeroSkill): boolean => skill.id === BASIC_ATTACK_ID;

/** What the Geas erupts over: the ring round the hero who cast, fixed at the cast. */
export const geasFootprint = (caster: HexCoord): HexCoord[] => discAround(caster, BALANCE.GEAS_RADIUS);

// ── Orc Warchief: Warband Order ──────────────────────────────────────────────

/** The warband: the Orcs an order reaches. Goblins are not Orcs and do not answer the horn. */
export const ORC_TEMPLATES: readonly string[] = ['orc_grunt', 'orc_berserker', ELITE_TEMPLATE.warchief];

export const GRUNT_TEMPLATE = 'orc_grunt';

/** Living Orcs on the Warchief's side other than himself: the ones an order is shouted to. */
export const warbandOf = (warchief: CombatUnit, units: CombatUnit[]): CombatUnit[] =>
  units.filter(
    (u) =>
      isAlive(u) &&
      !u.objective &&
      u.id !== warchief.id &&
      u.isPlayer === warchief.isPlayer &&
      ORC_TEMPLATES.includes(u.templateId ?? ''),
  );

/** Whether the Warchief can still shout: alive, and neither silenced, stunned nor frozen. */
export const canCommand = (warchief: CombatUnit | undefined): boolean =>
  !!warchief &&
  isAlive(warchief) &&
  !hasEffect(warchief, AfflictionType.Silence) &&
  !hasEffect(warchief, AfflictionType.Stun) &&
  !hasEffect(warchief, AfflictionType.Freeze);

/**
 * The hero this unit has been ordered to converge on, or null. Only an Orc of the
 * Warchief's own side answers, only while the order stands on a hero and the Warchief
 * who gave it can still command — silence or fell him and the horn goes unanswered.
 * Nearest marked hero first when there is more than one, then by id.
 */
export function warbandTargetFor(unit: CombatUnit, units: CombatUnit[]): CombatUnit | null {
  if (unit.objective || unit.templateId === ELITE_TEMPLATE.warchief) return null;
  if (!ORC_TEMPLATES.includes(unit.templateId ?? '')) return null;
  const marked = units.filter((h) => {
    if (!isAlive(h) || h.isPlayer === unit.isPlayer) return false;
    const order = h.activeEffects.find((e) => e.type === AfflictionType.Warband);
    const giver = order?.sourceUnitId ? units.find((u) => u.id === order.sourceUnitId) : undefined;
    return !!giver && giver.isPlayer === unit.isPlayer && canCommand(giver);
  });
  if (marked.length === 0) return null;
  return [...marked].sort(
    (a, b) =>
      hexDistance(unit.position, a.position) - hexDistance(unit.position, b.position) ||
      (a.id < b.id ? -1 : 1),
  )[0];
}

/**
 * Whether he may still call a Grunt: nobody of his warband is standing, and he has
 * called fewer than `WARBAND_BACKUP_TOTAL` over the fight. Counted off every Grunt he
 * ever called, the fallen included, because the cap is what stops a fight against him
 * being a queue of replacements.
 */
export function canCallBackup(warchief: CombatUnit, units: CombatUnit[]): boolean {
  if (warbandOf(warchief, units).length > 0) return false;
  const called = units.filter(
    (u) => u.summonedBy === warchief.id && u.templateId === GRUNT_TEMPLATE,
  ).length;
  return called < BALANCE.WARBAND_BACKUP_TOTAL;
}

/** Whether a Warchief's order is already standing on some hero. */
export const orderStanding = (warchief: CombatUnit, units: CombatUnit[]): boolean =>
  units.some(
    (h) =>
      isAlive(h) &&
      h.activeEffects.some((e) => e.type === AfflictionType.Warband && e.sourceUnitId === warchief.id),
  );

// ── Brigand Captain: Captain's Authority ─────────────────────────────────────

/** The share of every combat stat the Captain's word is worth to one unit, 0 when it is not wearing it. */
export const authorityBonus = (unit: CombatUnit): number =>
  unit.activeEffects.find((e) => e.type === AuraType.Authority)?.magnitude ?? 0;

/** Whether this unit leads under the aura: it carries the passive and stands. */
const isCaptain = (u: CombatUnit): boolean =>
  isAlive(u) && !u.objective && hasPassive(u, 'captainsAuthority');

/**
 * Whether a unit should be wearing the Captain's word right now: a living Captain
 * other than itself stands on its side. Not a shield, a summon of the other side or
 * an objective, and never a hero the Mage is borrowing for a turn. One Captain is
 * enough — a second adds nothing, which is what keeps the aura from stacking — and a
 * Captain is not buffed by himself but is by another.
 */
export function wearsAuthority(unit: CombatUnit, units: CombatUnit[]): boolean {
  if (!isAlive(unit) || unit.objective || unit.seized) return false;
  return units.some((c) => c.id !== unit.id && c.isPlayer === unit.isPlayer && isCaptain(c));
}

/** Every unit whose Authority differs from what it should be: the ones to lay it on and lift it from. */
export function authorityChanges(units: CombatUnit[]): { lay: CombatUnit[]; lift: CombatUnit[] } {
  const lay: CombatUnit[] = [];
  const lift: CombatUnit[] = [];
  for (const u of units) {
    const has = hasEffect(u, AuraType.Authority);
    const should = wearsAuthority(u, units);
    if (should && !has) lay.push(u);
    if (!should && has) lift.push(u);
  }
  return { lay, lift };
}

// ── Formations: a screen in front of the one who must not be reached ─────────

/**
 * Templates whose place is behind the rest of the warband: the Captain, and every
 * template whose `formation` is `behind` (the Legion's Stalker and Arcanist, PT-12).
 */
export const SCREENED_TEMPLATES: readonly string[] = [ELITE_TEMPLATE.captain];
const screenedAtSpawn = (id: string) => SCREENED_TEMPLATES.includes(id) || spawnsBehind(id);

const FRONT_ROW = -3;
const BACK_ROW = -4;

/**
 * Where an enemy warband stands: the two spawn ranks, with whoever must be screened
 * on the back rank directly behind the middle of the others. A roster with nobody
 * to screen is laid out exactly as it always was (`placements` returns null and the
 * caller keeps its own rows). A Captain with guards gets two of them in the hexes in
 * front of him, so reaching him means going round, through, or over them.
 */
export function enemyFormation(templateIds: readonly string[]): HexCoord[] | null {
  const screened = templateIds.map(screenedAtSpawn);
  const guards = screened.filter(Boolean).length;
  const front = templateIds.length - guards;
  if (guards === 0 || front === 0) return null;

  const rowHexes = (r: number): HexCoord[] =>
    arenaHexes().filter((h) => h.r === r).sort(byHex);
  const frontRow = rowHexes(FRONT_ROW);
  const backRow = rowHexes(BACK_ROW);
  if (front > frontRow.length || guards > backRow.length) return null;

  const start = Math.floor((frontRow.length - front) / 2);
  const standing = frontRow.slice(start, start + front);
  const standingKeys = new Set(standing.map(hexKey));
  const centre = standing.reduce((n, h) => n + h.q, 0) / standing.length;

  // The back hexes with the most of the front rank in front of them (a hex on the back rank
  // is touched by the two front-rank hexes q-1 and q), then the nearest the middle
  const behind = (h: HexCoord) =>
    [{ q: h.q - 1, r: FRONT_ROW }, { q: h.q, r: FRONT_ROW }].filter((n) => standingKeys.has(hexKey(n))).length;
  const guarded = [...backRow]
    .sort((a, b) => behind(b) - behind(a) || Math.abs(a.q - centre) - Math.abs(b.q - centre) || byHex(a, b))
    .slice(0, guards);

  let nextFront = 0;
  let nextBack = 0;
  return templateIds.map((_, i) =>
    screened[i]
      ? { q: guarded[nextBack].q, r: guarded[nextBack++].r }
      : { q: standing[nextFront].q, r: standing[nextFront++].r },
  );
}

/**
 * What the skill panel says about a skill the unit is about to press while carrying the
 * Crone's Geas: that a basic attack lifts the curse, or that this spell still works and
 * will raise a warned eruption round them. Null for a unit with no Geas — the panel says
 * nothing about a curse nobody is under. The words are the rule `eliteWarnings.triggerGeas`
 * runs, read from the same `isBasicAction`, so the card cannot promise what the resolver
 * does not do.
 */
export function geasWarning(skill: HeroSkill, unit: CombatUnit): string | null {
  if (!hasEffect(unit, AfflictionType.Geas)) return null;
  return t(isBasicAction(skill) ? 'bossLog.elite.geasBasic' : 'bossLog.elite.geasSpell');
}
