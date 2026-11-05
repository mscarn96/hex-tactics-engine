import {
  ArenaHazard,
  AuraType,
  CombatUnit,
  HeroSkill,
  HexCoord,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { arenaHexes, discAround } from '@/systems/combat/arenaGeometry';
import { heroesOf } from '@/systems/combat/targetLegality';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { skillName } from '@/data/gameText';
import { t } from '@/i18n';
import { combatMaxHp } from '@/systems/combat/forms';
import { unharmedRoundsOf } from '@/systems/combat/unharmed';

/**
 * The rules of the Troll Chieftain's fight, as pure functions over a roster.
 *
 * His fight is a *fixed sequence* — Farthest Prey, Bonebreaker Sweep, Bonebreaker
 * Sweep, Boundary Smash (whose landing brings the Warren Collapse down),
 * Bonebreaker Sweep, Bonebreaker Sweep, then round again — so it has a script
 * rather than a scored AI: a highest-damage pick would never leap at the hero it
 * could not reach, and would sweep every turn. Rubble is the fort the pair builds
 * and uses while he keeps kicking it down: the Collapse lays it, the Prey and the
 * brace spend it, every Sweep breaks what stands in its arc. This file owns which
 * move is next, what each warning marks and what the rubble does; `trollActions`
 * puts it on the board. Nothing here imports the store, so the HUD, the Node
 * suites and the tuning harness ask the same questions the fight does.
 */

export const TROLL_TEMPLATE_ID = 'troll_chieftain';

/** Whether this unit is the Troll Chieftain, whose fight is the scripted one. */
export const isTroll = (unit: CombatUnit): boolean =>
  !unit.isPlayer && unit.templateId === TROLL_TEMPLATE_ID;

export type TrollMove = 'prey' | 'sweep' | 'smash' | 'collapse';

/**
 * The fixed six-turn cycle. The Collapse has no slot: the Smash's landing casts it
 * (`trollActions.afterTrollLanding`), over the heroes where the throw left them, so
 * four Sweeps and a Prey stand between a Collapse and the next Smash.
 */
export const TROLL_CYCLE: readonly TrollMove[] = [
  'prey', 'sweep', 'sweep', 'smash', 'sweep', 'sweep',
];

const MOVE_BY_SKILL: Readonly<Record<string, TrollMove>> = {
  farthest_prey: 'prey',
  bonebreaker_sweep: 'sweep',
  boundary_smash: 'smash',
  warren_collapse: 'collapse',
};

export const trollMoveOfSkill = (skill: HeroSkill): TrollMove | undefined => MOVE_BY_SKILL[skill.id];

/** The three delayed attacks: each is a warning with a response window. */
const MAJOR: ReadonlySet<TrollMove> = new Set(['prey', 'smash', 'collapse']);
export const isTrollMajor = (move: TrollMove): boolean => MAJOR.has(move);

/**
 * Moves whose footprint is not the skill's own shape: the script builds it
 * (`trollActions.castTrollMove`). The Smash is an ordinary ring around him and
 * goes through the ordinary preparation.
 */
const SCRIPTED: ReadonlySet<TrollMove> = new Set(['prey', 'collapse']);
export const isTrollScriptedSkill = (skill: HeroSkill): boolean => {
  const move = trollMoveOfSkill(skill);
  return move !== undefined && SCRIPTED.has(move);
};

const SKILL_OF_MOVE: Readonly<Record<TrollMove, string>> = {
  prey: 'farthest_prey',
  sweep: 'bonebreaker_sweep',
  smash: 'boundary_smash',
  collapse: 'warren_collapse',
};

/** A move's full name: its skill's name ("Farthest Prey"), in the current language. */
export const trollMoveLabel = (move: TrollMove): string => skillName({ id: SKILL_OF_MOVE[move] });

// ── Fury ─────────────────────────────────────────────────────────────────────

/** Whether Fury is lit on him. The aura is the truth: it is laid once, at half health, and kept. */
export const isFurious = (unit: CombatUnit): boolean =>
  unit.activeEffects.some((e) => e.type === AuraType.Fury);

/** Actions a turn of his carries: two in Fury, one before it. */
export const actionsPerTurn = (unit: CombatUnit): number => (isFurious(unit) ? 2 : 1);

// ── Regeneration ─────────────────────────────────────────────────────────────

/**
 * Whether no hero has damaged him since his last regular turn began. The counter (`unharmed`) is 0
 * after any hero damage and rises as each regular turn of his begins, so read before this turn adds
 * its own, 1 or more means a whole round passed in which nobody struck him. Fury actions and speed
 * bonus turns never reach it. The panel's gauge row reads the same rule ahead of the turn.
 */
export const isUnharmed = (unit: CombatUnit): boolean => unharmedRoundsOf(unit) >= 1;

/** What a regular turn of his recovers when he is unharmed: `TROLL_REGEN_SHARE` of his maximum health. */
export const regenAmount = (unit: CombatUnit): number =>
  Math.max(1, Math.round(combatMaxHp(unit) * BALANCE.TROLL_REGEN_SHARE));

/**
 * Whether he may regenerate at all: not once only one hero stands, so the last hero is
 * never racing a heal they cannot stop alone.
 */
export const regenerationOn = (units: readonly CombatUnit[]): boolean => heroesOf(units).length > 1;

/** Whether the start of his next regular turn will heal him, if nobody strikes him first. */
export const willRegenerate = (unit: CombatUnit, units: readonly CombatUnit[]): boolean =>
  regenerationOn(units) && isUnharmed(unit) && unit.currentHp > 0 && unit.currentHp < combatMaxHp(unit);

// ── Choosing the move ────────────────────────────────────────────────────────

/** The position in the six-turn cycle — the rotation step the store keeps for him. */
export const cycleStep = (unit: CombatUnit): number => unit.bossScript?.step ?? 0;

/**
 * The next `count` moves of the cycle from his current step, soonest first. The
 * HUD's intent strip reads this, so what it names is what the script will make.
 */
export function upcomingMoves(unit: CombatUnit, count: number): TrollMove[] {
  const step = cycleStep(unit);
  return Array.from({ length: count }, (_, i) => TROLL_CYCLE[(step + i) % TROLL_CYCLE.length]);
}

export interface TrollMoveContext {
  boss: CombatUnit;
  units: CombatUnit[];
  /** A delayed attack of his is already open. */
  majorPending: boolean;
}

export interface ChosenTrollMove {
  move: TrollMove;
  /** The cycle step to resume from once the move is made. */
  nextStep: number;
}

/**
 * His next move: the one the cycle is at.
 *
 * A turn gets exactly one slot, so a speed-granted bonus turn takes the next
 * slot and never skips one. The single exception is a delayed attack the cycle
 * wants while another of his is still open — it falls back to the Sweep and
 * **does not advance**, so the slot is made once the window is over rather than
 * lost. Two warnings never combine into a pattern with no safe answer.
 */
export function chooseTrollMove(ctx: TrollMoveContext): ChosenTrollMove {
  const step = cycleStep(ctx.boss);
  const move = TROLL_CYCLE[step % TROLL_CYCLE.length];
  if (isTrollMajor(move) && ctx.majorPending) return { move: 'sweep', nextStep: step };
  return { move, nextStep: (step + 1) % TROLL_CYCLE.length };
}

// ── Farthest Prey ────────────────────────────────────────────────────────────

/**
 * The hero farthest from him, anywhere in the arena. A tie goes to the one with
 * the lower current health, then the lower id, so the same board always picks
 * the same hero and a tie is never a coin the party cannot read.
 */
export function preyTarget(boss: CombatUnit, units: CombatUnit[]): CombatUnit | null {
  const heroes = heroesOf(units);
  if (heroes.length === 0) return null;
  return [...heroes].sort(
    (a, b) =>
      hexDistance(boss.position, b.position) - hexDistance(boss.position, a.position) ||
      a.currentHp - b.currentHp ||
      (a.id < b.id ? -1 : 1),
  )[0];
}

/** The one-hex area around the hero he has picked out: the marked landing. */
export const preyFootprint = (target: HexCoord): HexCoord[] =>
  discAround(target, BALANCE.TROLL_PREY_RADIUS);

const solidKeys = (hazards: readonly ArenaHazard[]): Set<string> => {
  const keys = new Set<string>();
  for (const h of hazards) if (h.solid) for (const hex of h.hexes) keys.add(hexKey(hex));
  return keys;
};

// ── The fort: his rubble ─────────────────────────────────────────────────────

/** `ArenaHazard.kind` of the Collapse's rubble: the next Collapse replaces the last one's. */
export const RUBBLE_KIND = 'troll_rubble';

/** Whether this ground is his rubble: what the Collapse laid and what the fight breaks. */
export const isRubbleOf = (bossId: string, hazard: ArenaHazard): boolean =>
  hazard.kind === RUBBLE_KIND && hazard.ownerId === bossId && hazard.solid;

/**
 * How long Farthest Prey leaves him Exposed when he comes down on rubble: until his own next
 * regular turn begins, which is the pair's next round and nothing more (a Fury action or a bonus
 * turn ticks no clock).
 */
export const PREY_EXPOSED_TURNS = 1;

/** Every heap of his rubble standing — one hex each — in a fixed order. */
export function heapsOf(bossId: string, hazards: readonly ArenaHazard[]): HexCoord[] {
  return hazards
    .filter((h) => isRubbleOf(bossId, h))
    .flatMap((h) => h.hexes.map((x) => ({ q: x.q, r: x.r })))
    .sort((a, b) => a.q - b.q || a.r - b.r);
}

/**
 * The heaps that stand between a hero and him: a heap touching both of them. Only a hero two
 * hexes off can have one, so only the Sweep's far row is ever sheltered by the fort.
 */
export function heapsBetween(boss: HexCoord, hero: HexCoord, heaps: readonly HexCoord[]): HexCoord[] {
  if (hexDistance(boss, hero) !== 2) return [];
  return heaps.filter((h) => hexDistance(h, boss) === 1 && hexDistance(h, hero) === 1);
}

/**
 * What a Bonebreaker Sweep over `arc` does to the fort: every heap of his in the arc breaks,
 * whether or not anyone stands behind it, and a hero in the arc with a heap between them and him
 * is spared (`covered`: no damage, no wound). The heap that covers a hero is always in the arc,
 * since the arc takes every hex beside him that faces a hero it reaches, so cover is spent as it
 * is used.
 */
export function sweepThroughFort(
  boss: CombatUnit,
  arc: readonly HexCoord[],
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
): { covered: string[]; broken: HexCoord[] } {
  const heaps = heapsOf(boss.id, hazards);
  const inArc = new Set(arc.map(hexKey));
  return {
    covered: heroesOf(units)
      .filter((h) => inArc.has(hexKey(h.position)) && heapsBetween(boss.position, h.position, heaps).length > 0)
      .map((h) => h.id),
    broken: heaps.filter((h) => inArc.has(hexKey(h))),
  };
}

/** Whether a hero stands where a heap shields them from his Sweep, wherever it is aimed. */
export const isCoveredFrom = (boss: CombatUnit, hero: CombatUnit, hazards: readonly ArenaHazard[]): boolean =>
  heapsBetween(boss.position, hero.position, heapsOf(boss.id, hazards)).length > 0;

/**
 * The heap of his rubble inside the Prey's mark he comes down on: the one nearest the mark's
 * centre, then nearest where he leapt from, then by coordinate. None when the mark holds none.
 */
export function rubbleLanding(
  centre: HexCoord,
  footprint: readonly HexCoord[],
  boss: CombatUnit,
  hazards: readonly ArenaHazard[],
): HexCoord | null {
  const marked = new Set(footprint.map(hexKey));
  const [heap] = heapsOf(boss.id, hazards)
    .filter((h) => marked.has(hexKey(h)))
    .sort((a, b) =>
      hexDistance(centre, a) - hexDistance(centre, b) ||
      hexDistance(boss.position, a) - hexDistance(boss.position, b) ||
      a.q - b.q ||
      a.r - b.r);
  return heap ?? null;
}

/**
 * Where Farthest Prey comes down, and whether it is on his rubble. A mark that holds rubble
 * baits him onto it: he lands on the heap nearest its centre, the heap gives way and he is
 * Exposed for the pair's next round. Otherwise the free hex the ordinary leap takes
 * (`preyLanding`). The warning and the landing both ask this, so the banner names the heap
 * he will break.
 */
export function trollPreyLanding(
  centre: HexCoord,
  footprint: readonly HexCoord[],
  boss: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): { hex: HexCoord; onRubble: boolean } | null {
  const heap = rubbleLanding(centre, footprint, boss, hazards);
  if (heap) return { hex: heap, onRubble: true };
  const hex = preyLanding(centre, footprint, boss, units, hazards);
  return hex ? { hex, onRubble: false } : null;
}

/**
 * Where he comes down. Never on a living unit or rubble, and never off the
 * board: the free hex nearest the centre of the marked area, inside it when any
 * hex of it is free. A tie goes to the hex nearer where he leapt from, then by
 * coordinate, so the landing is the same on every replay of the same board.
 */
export function preyLanding(
  centre: HexCoord,
  footprint: readonly HexCoord[],
  boss: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): HexCoord | null {
  const occupied = new Set(
    units.filter((u) => u.currentHp > 0 && u.id !== boss.id).map((u) => hexKey(u.position)),
  );
  const solid = solidKeys(hazards);
  const free = (h: HexCoord) => !occupied.has(hexKey(h)) && !solid.has(hexKey(h));
  const order = (a: HexCoord, b: HexCoord) =>
    hexDistance(centre, a) - hexDistance(centre, b) ||
    hexDistance(boss.position, a) - hexDistance(boss.position, b) ||
    a.q - b.q ||
    a.r - b.r;

  const inside = footprint.filter(free).sort(order);
  if (inside.length > 0) return { q: inside[0].q, r: inside[0].r };
  const anywhere = arenaHexes().filter(free).sort(order);
  return anywhere.length > 0 ? { q: anywhere[0].q, r: anywhere[0].r } : null;
}

// ── Warren Collapse ──────────────────────────────────────────────────────────

/**
 * The centre of the densest cluster of heroes: the hex under which the most
 * heroes fall within the rocks' radius. Ties go to the tighter cluster (smaller
 * summed distance to the centre), then to a centre that is a hero's own hex,
 * then by coordinate — one board, one collapse. Null with no hero to bury.
 */
export function collapseCentre(units: CombatUnit[]): HexCoord | null {
  const heroes = heroesOf(units);
  if (heroes.length === 0) return null;
  const heroHexes = new Set(heroes.map((h) => hexKey(h.position)));
  let best: { hex: HexCoord; count: number; spread: number; onHero: number } | null = null;
  for (const hex of arenaHexes()) {
    const caught = heroes.filter((h) => hexDistance(hex, h.position) <= BALANCE.TROLL_COLLAPSE_RADIUS);
    if (caught.length === 0) continue;
    const spread = caught.reduce((sum, h) => sum + hexDistance(hex, h.position), 0);
    const onHero = heroHexes.has(hexKey(hex)) ? 1 : 0;
    const better =
      !best ||
      caught.length > best.count ||
      (caught.length === best.count &&
        (spread < best.spread ||
          (spread === best.spread &&
            (onHero > best.onHero ||
              (onHero === best.onHero && (hex.q < best.hex.q || (hex.q === best.hex.q && hex.r < best.hex.r)))))));
    if (better) best = { hex: { q: hex.q, r: hex.r }, count: caught.length, spread, onHero };
  }
  return best ? best.hex : null;
}

export const collapseFootprint = (centre: HexCoord): HexCoord[] =>
  discAround(centre, BALANCE.TROLL_COLLAPSE_RADIUS);

/** Whether every hex the arena leaves open can still be reached from every other. */
export function routesConnected(solid: ReadonlySet<string>): boolean {
  const open = arenaHexes().filter((h) => !solid.has(hexKey(h)));
  if (open.length <= 1) return true;
  const openKeys = new Set(open.map(hexKey));
  const seen = new Set<string>([hexKey(open[0])]);
  const stack: HexCoord[] = [open[0]];
  while (stack.length > 0) {
    const here = stack.pop()!;
    for (const h of open) {
      const k = hexKey(h);
      if (seen.has(k) || !openKeys.has(k) || hexDistance(here, h) !== 1) continue;
      seen.add(k);
      stack.push(h);
    }
  }
  return seen.size === open.length;
}

/**
 * The impact hexes that become rubble once the rocks have fallen.
 *
 * Only an **empty** hex — no living unit stands on it, the Troll included — and
 * never one whose loss would cut the arena in two: hexes are taken in a fixed
 * order and each is kept only if every route through the rest of the board
 * survives it, so the rubble can wall off a corner of the floor and cannot seal
 * the party from the fight or from each other. Existing rubble counts.
 */
export function rubbleHexes(
  impact: readonly HexCoord[],
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): HexCoord[] {
  const occupied = new Set(units.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position)));
  const solid = solidKeys(hazards);
  const taken: HexCoord[] = [];
  const ordered = [...impact].sort((a, b) => a.q - b.q || a.r - b.r);
  for (const hex of ordered) {
    const key = hexKey(hex);
    if (occupied.has(key) || solid.has(key)) continue;
    const next = new Set(solid);
    next.add(key);
    if (!routesConnected(next)) continue;
    solid.add(key);
    taken.push({ q: hex.q, r: hex.r });
  }
  return taken;
}

// ── What the HUD says ────────────────────────────────────────────────────────

export interface TrollIntent {
  /**
   * What his warning in the air will do when its window is over — the next thing
   * he does, ahead of the cycle — or none.
   */
  landing?: string;
  /** The moves the cycle holds next, soonest first. */
  upcoming: TrollMove[];
  /** The rule of the move due next, said in a few words. */
  hint?: string;
  furious: boolean;
}

/**
 * The boss-intent line the HUD draws: what lands, then what comes next, off the
 * same cycle the script runs. `pending` is the skill name of a warning of his
 * that is still open.
 */
export function trollIntent(boss: CombatUnit, pending?: string): TrollIntent {
  const hint = trollMoveHint(upcomingMoves(boss, 1)[0]);
  return {
    ...(pending && { landing: pending }),
    upcoming: upcomingMoves(boss, 3),
    ...(hint && { hint }),
    furious: isFurious(boss),
  };
}

/** A move's rule in a few words, for the next-move line and the intent strip ("hunts the farthest; bait him onto rubble"). */
export const trollMoveHint = (move: TrollMove): string => t(`bossLog.troll.hint.${move}`);

/** A move's one-word name for the intent strip's chips ("Prey"), in the current language. */
export const trollMoveShort = (move: TrollMove): string => t(`bossLog.troll.short.${move}`);
