import { AfflictionType, ArenaHazard, AuraType, CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import { FURNACE_HEART_KIND, furnaceHeart } from '@/data/templates/emeraldDragon';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { resolvedSkill, windowsLeft } from '@/systems/combat/preparedAttacks';
import { BALANCE } from '@/data/balanceConstants';
import { arcHexes, arenaHexes, discAround, HEX_DIRS } from '@/systems/combat/arenaGeometry';
import { preyLanding } from '@/systems/combat/trollScript';
import { hexDistance, hexDot, hexKey } from '@/utils/hexUtils';
import { heroesOf } from '@/systems/combat/targetLegality';

/**
 * The rules of the Emerald Dragon's fight, as pure functions over a roster.
 *
 * Unlike the Troll's and the Emperor's, his fight has **no fixed sequence**: the
 * plan wants him to use his moves through ordinary action selection, with the
 * four signatures resting after use and chosen by what the board offers. This
 * file owns what "offers" means — which moves are worth a turn now and where each
 * warning lands — and `dragonActions` and `dragonLanding` put it on the board.
 * Nothing here imports the store, so the HUD, the Node suites and the tuning
 * harness ask the same questions the fight does.
 */

export const DRAGON_TEMPLATE_ID = 'dragon';

/** Whether this unit is the Emerald Dragon. */
export const isDragon = (unit: CombatUnit): boolean =>
  !unit.isPlayer && unit.templateId === DRAGON_TEMPLATE_ID;

export type DragonMove = 'claw' | 'wing' | 'rift' | 'heart' | 'skyfire';

const MOVE_BY_SKILL: Readonly<Record<string, DragonMove>> = {
  dragon_claw: 'claw',
  wing_thrust: 'wing',
  cinder_rift: 'rift',
  furnace_heart: 'heart',
  skyfire: 'skyfire',
};

export const dragonMoveOfSkill = (skill: HeroSkill): DragonMove | undefined => MOVE_BY_SKILL[skill.id];

/**
 * Moves whose footprint is not the skill's own shape: the script builds it
 * (`dragonActions.castDragonMove`). The wing is an ordinary arc and goes through the
 * ordinary resolver; the Heart is thrown onto a hero and rides on them.
 */
const SCRIPTED: ReadonlySet<DragonMove> = new Set(['rift', 'heart', 'skyfire']);
export const isDragonScriptedSkill = (skill: HeroSkill): boolean => {
  const move = dragonMoveOfSkill(skill);
  return move !== undefined && SCRIPTED.has(move);
};

/** A footprint's hexes as a key set. */
const keysOf = (hexes: readonly HexCoord[]): Set<string> => new Set(hexes.map(hexKey));

/** The arena's centre, which every "opposite half" and "toward the middle" is measured from. */
const CENTRE: HexCoord = { q: 0, r: 0 };

// ── Choosing the move ────────────────────────────────────────────────────────

export interface DragonOffer {
  /** Whether the move can be made now at all: off cooldown, with something to aim at. */
  available: boolean;
  /** How much a turn spent on it is worth now. Higher wins. */
  value: number;
}

export interface DragonMoveContext {
  boss: CombatUnit;
  units: CombatUnit[];
  hazards: readonly ArenaHazard[];
  /** A delayed attack of his is already open: nothing that prepares may be raised. */
  majorPending: boolean;
  /** Regular turns he has begun, this one included. */
  turns: number;
  /** The turn each move was last made on (absent: never), and the turn of his last signature (0: none). */
  lastUsed: Readonly<Record<string, number>>;
  lastSignature: number;
  /** What each move is offering the board, as the script's callers measured it. */
  offers: Readonly<Record<DragonMove, DragonOffer>>;
}

/**
 * The order ties are broken in, rotated by the turn count so no tie is always the same move. The Rift
 * is not in it: it is raised only with a Wing Thrust (`riftFollowsWing`).
 */
const TIE_ORDER: readonly DragonMove[] = ['wing', 'heart', 'skyfire'];

/**
 * His turns between two signatures: a signature is cast on turn t, lands on t+1,
 * and he claws on t+2, so the party is never given two warnings back to back and
 * the Claw is a third of his turns at the least.
 */
export const SIGNATURE_GAP = 3;
/** The first turn each signature may be made on: the party meets the claw and the wing before the rest. */
export const FIRST_TURN: Readonly<Record<Exclude<DragonMove, 'claw'>, number>> = {
  wing: 2,
  rift: 3,
  heart: 4,
  skyfire: 5,
};
/** What each turn a signature has gone unused adds to its worth, up to `STALE_TURNS` turns. */
const STALE_VALUE = 0.4;
const STALE_TURNS = 5;

/**
 * His next move: the best-valued of what the board offers, or the Claw.
 *
 * The Wing Thrust is instant and weak, so it is the exception to every rule below that
 * is about warnings: it is on offer while one is open and between signatures.
 *
 * There is no cycle. Each signature is *available* only off its cooldown and
 * only when the board gives it something to do — a Rift needs a line, a Heart a
 * free hex near the party — and *valued* by what it would do to this party now:
 * a Wing Thrust that catches two heroes is worth more than one that catches one,
 * a Rift that would split the party more than one that would not, and a signature
 * unmade for a while is worth more each turn. The first turns are the Claw and the
 * wing, so the party sees them before it is asked for an answer to Skyfire. Moves that prepare are not on offer while one of his
 * warnings is open: **two warnings never combine into a pattern with no safe
 * answer.** Everything else loses to the Claw only on value, never by rotation.
 */
export function chooseDragonMove(ctx: DragonMoveContext): DragonMove {
  // The wing is instant, so it is the one move that is neither held behind an open
  // warning nor counted as a signature: it competes with the Claw on its own value
  const open = warningOpen(ctx);
  const rotation = ctx.turns % TIE_ORDER.length;
  const order = [...TIE_ORDER.slice(rotation), ...TIE_ORDER.slice(0, rotation)];
  // The longer a signature has gone unmade, the more a turn on it is worth: no
  // move is starved by a stronger one, and none is a fixed rotation either
  const worth = (move: DragonMove) =>
    ctx.offers[move].value + STALE_VALUE * Math.min(STALE_TURNS, ctx.turns - (ctx.lastUsed[move] ?? 0));
  let best: DragonMove = 'claw';
  let bestValue = ctx.offers.claw.available ? ctx.offers.claw.value : -Infinity;
  // A Rift waiting for its wing: ready, its first turn come, but held by an open warning or the gap. The wing
  // waits with it rather than spend itself alone, so the Rift is not starved by the wing's own cooldown
  const riftWaits = ctx.offers.rift.available && ctx.turns >= FIRST_TURN.rift && open;
  for (const move of order) {
    const offer = ctx.offers[move];
    if (open && move !== 'wing') continue;
    if (move === 'wing' && riftWaits) continue;
    if (!offer.available || ctx.turns < FIRST_TURN[move as Exclude<DragonMove, 'claw'>]) continue;
    // A wing that brings the Rift with it is worth whichever of the two is worth more
    const value = move === 'wing' && riftFollowsWing({ ...ctx, rift: ctx.offers.rift })
      ? Math.max(worth('wing'), worth('rift'))
      : worth(move);
    if (value > bestValue) {
      best = move;
      bestValue = value;
    }
  }
  return best;
}

/** A warning of his is open, or one was made too recently for another (`SIGNATURE_GAP`). */
const warningOpen = (ctx: Pick<DragonMoveContext, 'majorPending' | 'turns' | 'lastSignature'>): boolean =>
  ctx.majorPending || (ctx.lastSignature > 0 && ctx.turns - ctx.lastSignature < SIGNATURE_GAP);

/**
 * Whether a Wing Thrust made now brings a Cinder Rift with it, raised over the party where the wing
 * left it: the Rift is on offer (off its cooldown, with a line to rake, none of his burning), its first
 * turn has come, and no warning of his is open or just made — a Rift is a signature like the rest. The
 * chooser values the wing by it and the script raises it by it, so the two never disagree.
 */
export function riftFollowsWing(
  ctx: Pick<DragonMoveContext, 'majorPending' | 'turns' | 'lastSignature'> & { rift: DragonOffer },
): boolean {
  return ctx.rift.available && ctx.turns >= FIRST_TURN.rift && !warningOpen(ctx);
}

// ── Dragon Claw ─────────────────────────────────────────────────────────────

/**
 * The Claw hunts the Heart's carrier: of his six wedges (one per facing, `arcHexes`, as deep as the
 * Claw's `aoeRadius`), the ones that catch the carrier, and of those the one that catches the most heroes
 * besides, then the first in `HEX_DIRS` order. Null when no wedge reaches them: the Claw is aimed as
 * before. A Taunt is the script's to put first; this does not know about it.
 */
export function clawOnCarrier(
  boss: CombatUnit,
  claw: HeroSkill,
  carrier: CombatUnit,
  units: readonly CombatUnit[],
): HexCoord | null {
  const heroes = heroesOf(units as CombatUnit[]);
  let best: { aim: HexCoord; caught: number } | null = null;
  for (const dir of HEX_DIRS) {
    const aim = { q: boss.position.q + dir.q, r: boss.position.r + dir.r };
    const wedge = keysOf(arcHexes(claw, boss.position, aim));
    if (!wedge.has(hexKey(carrier.position))) continue;
    const caught = heroes.filter((h) => wedge.has(hexKey(h.position))).length;
    if (!best || caught > best.caught) best = { aim, caught };
  }
  return best?.aim ?? null;
}

/** The wing's and claw's worth: heroes caught in the footprint, so the arc that catches more is chosen. */
export function arcValue(base: number, caught: number): number {
  return caught <= 0 ? 0 : base + 0.5 * (caught - 1);
}

// ── Cinder Rift ──────────────────────────────────────────────────────────────

/** The level a hex has along each of the three hex axes: constant along a line of that axis. */
const LEVELS: ReadonlyArray<(h: HexCoord) => number> = [
  (h) => h.r,
  (h) => h.q,
  (h) => h.q + h.r,
];

/** Whether a Cinder Rift of his is burning now. */
export const riftActive = (boss: CombatUnit, hazards: readonly ArenaHazard[]): boolean =>
  hazards.some((h) => h.ownerId === boss.id && h.crossDamage !== undefined);

export interface RiftPlan {
  hexes: HexCoord[];
  /** Heroes each side of the line, and standing on it. */
  split: [number, number];
  onLine: number;
}

/**
 * The two lines he rakes across the arena, crossing in an X.
 *
 * Both run through the middle of the party along two of the board's three axes
 * (the pivot is the hex nearest the heroes' centre), the two that best part the
 * heroes — the most on the smaller side first, then the most even — so it asks the
 * question the plan wants: cross it to keep the formation, or split around it and
 * risk being cut off from healing. A tie goes to the axis that runs most nearly
 * square to the line between him and the party, then to the lower axis, so one
 * board makes one X. `split` and `onLine` describe the better of the two lines.
 * His own hex is left out. Null with no hero to part.
 */
export function riftLine(boss: CombatUnit, units: CombatUnit[]): RiftPlan | null {
  const heroes = heroesOf(units);
  if (heroes.length === 0) return null;
  const centre = heroes.reduce(
    (sum, h) => ({ q: sum.q + h.position.q / heroes.length, r: sum.r + h.position.r / heroes.length }),
    { q: 0, r: 0 },
  );
  const pivot = nearestHex(centre);
  const toParty = { q: centre.q - boss.position.q, r: centre.r - boss.position.r };

  const lines = LEVELS.map((level, axis) => {
    const at = level(pivot);
    const hexes = arenaHexes()
      .filter((h) => level(h) === at && hexKey(h) !== hexKey(boss.position))
      .map((h) => ({ q: h.q, r: h.r }));
    let a = 0;
    let b = 0;
    let onLine = 0;
    for (const hero of heroes) {
      const side = level(hero.position) - at;
      if (side === 0) onLine++;
      else if (side < 0) a++;
      else b++;
    }
    // Square to him: the axis whose line has the least overlap with the way he faces the party
    const along = Math.abs(hexDot(axisDir(axis), toParty));
    return { hexes, split: [a, b] as [number, number], onLine, key: [Math.min(a, b), -Math.abs(a - b), -along, -axis] };
  }).sort((x, y) => compareKeys(y.key, x.key));

  const [first, second] = lines;
  const seen = new Set<string>();
  const hexes: HexCoord[] = [];
  for (const h of [...first.hexes, ...second.hexes]) {
    if (seen.has(hexKey(h))) continue;
    seen.add(hexKey(h));
    hexes.push(h);
  }
  const onLine = heroes.filter((h) => seen.has(hexKey(h.position))).length;
  return { hexes, split: first.split, onLine };
}

const axisDir = (axis: number): HexCoord => [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: -1 }][axis];

const compareKeys = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/** The arena hex nearest a point, ties by coordinate. */
function nearestHex(point: { q: number; r: number }): HexCoord {
  let best = arenaHexes()[0];
  let bestD = Infinity;
  for (const h of arenaHexes()) {
    const d = (h.q - point.q) ** 2 + (h.r - point.r) ** 2 + (h.q + h.r - point.q - point.r) ** 2;
    if (d < bestD - 1e-9) {
      best = h;
      bestD = d;
    }
  }
  return { q: best.q, r: best.r };
}

/** The burning Rift's hexes, or none. */
const riftGround = (boss: CombatUnit, hazards: readonly ArenaHazard[]): HexCoord[] =>
  hazards.filter((h) => h.ownerId === boss.id && h.crossDamage !== undefined).flatMap((h) => h.hexes);

/**
 * The rows of the burning Rift as (axis, level) pairs: a row is one of the Rift's lines when the
 * ground holds all of it but, at most, the hex he stood on when he raked it. A row crossing the
 * Rift in a point or two is not a line.
 */
function riftRows(ground: readonly HexCoord[]): { axis: number; level: number }[] {
  const arena = arenaHexes();
  const rows: { axis: number; level: number }[] = [];
  const lit = new Set(ground.map(hexKey));
  LEVELS.forEach((level, axis) => {
    for (const at of new Set(ground.map(level))) {
      const row = arena.filter((h) => level(h) === at);
      const burning = row.filter((h) => lit.has(hexKey(h))).length;
      if (row.length >= 4 && burning >= row.length - 1) rows.push({ axis, level: at });
    }
  });
  return rows;
}

/**
 * Where a unit stands in relation to the Rift: the side it is on (a key made of its side of each
 * line), or `null` when it stands in the fire, on one of the lines.
 */
function riftSideOf(rows: readonly { axis: number; level: number }[], position: HexCoord): string | null {
  const signs = rows.map((r) => Math.sign(LEVELS[r.axis](position) - r.level));
  return signs.includes(0) ? null : signs.join(',');
}

/**
 * Whom his Claw and Wing Thrust may go to while a Rift burns: **the side of the Rift with fewer
 * heroes**, and anyone standing in the fire (within reach of both sides). A tie in numbers goes to
 * the side holding the lower-health hero, then to the side nearer where he faces (the hero nearest
 * the hex in front of him), then to the lower side key, so one board makes one answer. With no
 * Rift burning, or no hero beside it to choose between, it is everyone.
 */
export function riftTargets(boss: CombatUnit, foes: CombatUnit[], hazards: readonly ArenaHazard[]): CombatUnit[] {
  const rows = riftRows(riftGround(boss, hazards));
  if (rows.length === 0) return foes;
  const sides = new Map<string, CombatUnit[]>();
  const inFire: CombatUnit[] = [];
  for (const foe of foes) {
    const key = riftSideOf(rows, foe.position);
    if (key === null) inFire.push(foe);
    else sides.set(key, [...(sides.get(key) ?? []), foe]);
  }
  if (sides.size < 2) return foes;
  const front = boss.facing !== undefined
    ? { q: boss.position.q + HEX_DIRS[boss.facing].q, r: boss.position.r + HEX_DIRS[boss.facing].r }
    : boss.position;
  const weakest = (units: CombatUnit[]) => Math.min(...units.map((u) => u.currentHp));
  const nearest = (units: CombatUnit[]) => Math.min(...units.map((u) => hexDistance(front, u.position)));
  const [thin] = [...sides.entries()].sort(([ka, a], [kb, b]) =>
    a.length - b.length || weakest(a) - weakest(b) || nearest(a) - nearest(b) || (ka < kb ? -1 : ka > kb ? 1 : 0));
  return [...thin[1], ...inFire];
}

/** The fire a crossing of the Rift costs: a share of his attack, fixed when it is laid. */
export const riftCrossDamage = (attack: number): number =>
  Math.max(1, Math.round(attack * BALANCE.DRAGON_RIFT_CROSS));

// ── Furnace Heart ────────────────────────────────────────────────────────────

/**
 * Who he throws the Heart onto: the hero with the most health now, ties by the lower id, so the
 * crystal starts on whoever can carry it longest. Null with no hero standing.
 */
export function heartCarrier(units: readonly CombatUnit[]): CombatUnit | null {
  const [first] = heroesOf(units as CombatUnit[])
    .sort((a, b) => b.currentHp - a.currentHp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return first ?? null;
}

/** His Heart while it stands: the crystal riding on its carrier. */
export const heartOf = (boss: CombatUnit, units: readonly CombatUnit[]): CombatUnit | undefined =>
  units.find((u) => u.currentHp > 0 && u.objective?.kind === FURNACE_HEART_KIND && u.objective.ownerId === boss.id);

/** The Heart's warning while it is carried: the burst it counts down to. */
export const heartWarning = (boss: CombatUnit, attacks: readonly PreparedAttack[]): PreparedAttack | undefined =>
  attacks.find((p) => p.casterId === boss.id && p.skill.id === 'furnace_heart' && p.spec.carried);

/**
 * Rounds of the heroes' turns before the Heart bursts: the windows still owed by the hero furthest
 * behind (a fallen hero owes nothing). 1 is the last round: it bursts at the start of his next turn after it.
 */
export const heartRoundsLeft = (attack: PreparedAttack, units: readonly CombatUnit[]): number => windowsLeft(attack, units);

/** The Heart's burn as a blow, `kept` turns into one carrier's hold: its fire, one step hotter per turn. */
export const heartBurnBlow = (kept: number): HeroSkill => ({
  ...resolvedSkill(furnaceHeart),
  damage: BALANCE.DRAGON_HEART_BURN + BALANCE.DRAGON_HEART_BURN_STEP * kept,
  aoeRadius: 0,
});

/** What the Heart's next burn will take off `carrier` as their turn begins: the step their hold has reached (`Seared.stacks`). */
export function nextHeartBurn(dragon: CombatUnit, carrier: CombatUnit, units: readonly CombatUnit[]): number {
  const kept = carrier.activeEffects.find((e) => e.type === AfflictionType.Seared)?.stacks ?? 0;
  return calculateDamage(dragon, carrier, heartBurnBlow(kept), 'front', units as CombatUnit[]);
}

/**
 * Whether the burst's footprint is drawn on the board now: on its last round (it bursts as his next turn
 * begins, or after the round under way), and whenever the next burn could fell its carrier (their health and
 * Barrier together), when the burst is the hex they fall on. Otherwise the crystal and its countdown say it.
 */
export function heartBurstDrawn(attack: PreparedAttack, units: readonly CombatUnit[]): boolean {
  if (heartRoundsLeft(attack, units) <= 1) return true;
  const carrier = units.find((u) => u.id === attack.bound?.[0]);
  const dragon = units.find((u) => u.id === attack.casterId);
  if (!carrier || carrier.currentHp <= 0 || !dragon) return true;
  const barrier = carrier.activeEffects.filter((e) => e.type === AuraType.Barrier).reduce((sum, e) => sum + e.magnitude, 0);
  return nextHeartBurn(dragon, carrier, units) >= carrier.currentHp + barrier;
}

// ── Pass the Heart ───────────────────────────────────────────────────────────

/** The Furnace Heart riding on `unit`, when they carry one. */
export const carriedHeart = (unit: CombatUnit, units: readonly CombatUnit[]): CombatUnit | undefined =>
  units.find((u) => u.currentHp > 0 && u.objective?.kind === FURNACE_HEART_KIND && u.objective.carrierId === unit.id);

/**
 * Who `giver` may pass the Heart to now, or take it from: the carrier hands it to any other living hero
 * within `DRAGON_HEART_PASS_RANGE`, and any other hero within that reach of the carrier takes it from
 * them — so a carrier with no action left can still be saved by an ally. Empty when no pass is legal;
 * the skill bar shows Pass the Heart only then.
 */
export function passTargets(giver: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] {
  if (giver.currentHp <= 0 || !giver.isPlayer || giver.objective || giver.summonedBy) return [];
  const reach = BALANCE.DRAGON_HEART_PASS_RANGE;
  const heroes = heroesOf(units).filter((h) => h.id !== giver.id && hexDistance(h.position, giver.position) <= reach);
  if (carriedHeart(giver, units)) return heroes;
  return heroes.filter((h) => !!carriedHeart(h, units));
}

// ── Skyfire ──────────────────────────────────────────────────────────────────

/** Every hex of the arena: Skyfire's flame leaves no safe tile. */
export const wholeArena = (): HexCoord[] => arenaHexes().map((h) => ({ q: h.q, r: h.r }));

/**
 * Where he comes down: the centre of the marked landing area.
 *
 * The opposite half of the arena from where he stands, **biased toward the
 * middle**: among the free hexes there, the one that catches the most heroes in
 * the landing radius, then the one nearest the centre, then by coordinate — so
 * the area is a real threat and never the far rim. Standing on the centre line
 * he has no opposite, so the half away from the party is used. Chosen once, at
 * the cast, and locked: the warning cannot retarget.
 */
export function skyfireLandingCentre(
  boss: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): HexCoord | null {
  const heroes = heroesOf(units);
  const taken = new Set(units.filter((u) => u.currentHp > 0 && u.id !== boss.id).map((u) => hexKey(u.position)));
  const solid = new Set<string>();
  for (const z of hazards) if (z.solid) for (const h of z.hexes) solid.add(hexKey(h));

  let away = { q: boss.position.q - CENTRE.q, r: boss.position.r - CENTRE.r };
  if (away.q === 0 && away.r === 0 && heroes.length > 0) {
    const mean = heroes.reduce(
      (sum, h) => ({ q: sum.q + h.position.q / heroes.length, r: sum.r + h.position.r / heroes.length }),
      { q: 0, r: 0 },
    );
    away = { q: -mean.q, r: -mean.r };
  }
  const opposite = (h: HexCoord) => hexDot({ q: h.q - CENTRE.q, r: h.r - CENTRE.r }, away) < 0;

  let best: { hex: HexCoord; caught: number; middle: number } | null = null;
  for (const hex of arenaHexes()) {
    const key = hexKey(hex);
    if (taken.has(key) || solid.has(key) || !opposite(hex)) continue;
    const caught = heroes.filter((h) => hexDistance(hex, h.position) <= BALANCE.DRAGON_LANDING_RADIUS).length;
    const middle = hexDistance(hex, CENTRE);
    const better =
      !best ||
      caught > best.caught ||
      (caught === best.caught &&
        (middle < best.middle ||
          (middle === best.middle && (hex.q < best.hex.q || (hex.q === best.hex.q && hex.r < best.hex.r)))));
    if (better) best = { hex: { q: hex.q, r: hex.r }, caught, middle };
  }
  return best ? best.hex : null;
}

/** The landing area marked around the landing centre. */
export const skyfireLandingArea = (centre: HexCoord): HexCoord[] =>
  discAround(centre, BALANCE.DRAGON_LANDING_RADIUS);

/**
 * The hex he actually comes down on: never a living body or solid ground — the
 * free hex nearest the marked centre, inside the area when any of it is free.
 * The Troll's leap lands by the same rule, so it is the one function.
 */
export const dragonLandingHex = preyLanding;

// ── Wing Thrust ──────────────────────────────────────────────────────────────

/**
 * The flame wave's footprint: the whole arc, and the hexes the shove puts the
 * heroes on. Built from the same landings the warning draws, so a hero thrown
 * out of the arc is still under the wave that follows them.
 */
export function waveFootprint(arc: readonly HexCoord[], landings: readonly HexCoord[]): HexCoord[] {
  const seen = keysOf(arc);
  const out = arc.map((h) => ({ q: h.q, r: h.r }));
  for (const h of landings) {
    if (seen.has(hexKey(h))) continue;
    seen.add(hexKey(h));
    out.push({ q: h.q, r: h.r });
  }
  return out;
}
