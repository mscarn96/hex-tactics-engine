import { ArenaHazard, AuraType, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { ANCHOR_KIND, SPIRE_KIND } from '@/data/templates/heartOfWinter';
import { boundWholeness } from '@/systems/combat/warnedAnswers';
import { arenaHexes, discAround, inArena } from '@/systems/combat/arenaGeometry';
import { objectivesOf } from '@/systems/combat/objectives';
import { getHexLine, getNeighbors, hexDistance, hexKey, hexToPixel } from '@/utils/hexUtils';
import { heroesOf } from '@/systems/combat/targetLegality';

/**
 * The rules of the Heart of Winter's fight, as pure functions over a roster.
 *
 * Like the Emerald Dragon's, its fight has **no fixed sequence**: the four spells
 * are chosen by what the board offers (`chooseHeartMove`), the Pulse is what it does
 * when nothing else is worth a turn, and at most one delayed attack is ever open.
 * This file owns what "offers" means and where each warning lands; `heartActions`
 * and `heartLanding` put it on the board. Nothing here imports the store, so the
 * HUD, the Node suites and the tuning harness ask the same questions the fight does.
 */

export const HEART_TEMPLATE_ID = 'heart_of_winter';

/** Whether this unit is the Heart of Winter. */
export const isHeart = (unit: CombatUnit): boolean =>
  !unit.isPlayer && unit.templateId === HEART_TEMPLATE_ID;

// ── The Seal tiers ───────────────────────────────────────────────────────────

/**
 * The Winter Seal tier it is fought at: 1 in its lair, the refight's tier from the Barrow's door
 * (`encounterSetup` sets `challengeTier`). Each tier keeps every twist below it
 * (the private project notes, *The Heart's twists*).
 */
export const heartTierOf = (boss: CombatUnit | undefined): number =>
  Math.min(BALANCE.HEART_SEAL.MAX_TIER, Math.max(1, Math.round(boss?.challengeTier ?? 1)));

/** The tier each twist arrives at. */
export const HEART_TWIST = {
  /** The Pulse's fracture runs on down a line of heroes. */
  fractureChain: 2,
  /** Icebound Reprisal binds two anchors at once. */
  twinReprisal: 3,
  /** A spire left standing freezes the ground it bursts over. */
  spireFrost: 4,
  /** At a quarter health two anchors rise and chain it again. */
  rechain: 5,
} as const;

/** Whether a twist is in force on this Heart. */
export const heartTwist = (boss: CombatUnit | undefined, twist: keyof typeof HEART_TWIST): boolean =>
  heartTierOf(boss) >= HEART_TWIST[twist];

/** The phase index of the chain a tier-5 Heart is bound in again (`HEART_PHASES`), and the one it is torn from it into. */
export const HEART_RECHAINED_PHASE = 2;
export const HEART_TORN_PHASE = 3;

/** Whether it is chained now: its opening phase, or the tier-5 chain that rises at a quarter health. */
export const heartChained = (boss: CombatUnit): boolean => {
  const phase = boss.bossPhase ?? 0;
  return phase === 0 || phase === HEART_RECHAINED_PHASE;
};

/** The objective kinds the fight places: the kit names them, because its warnings are answered by breaking them. */
export { ANCHOR_KIND, SPIRE_KIND };
/** The one hazard its ice is kept in. */
export const HEART_ICE_ID = 'heart_ice';

export type HeartMove = 'pulse' | 'winter' | 'reprisal' | 'convergence';

const MOVE_BY_SKILL: Readonly<Record<string, HeartMove>> = {
  splintering_pulse: 'pulse',
  creeping_winter: 'winter',
  icebound_reprisal: 'reprisal',
  whiteout_convergence: 'convergence',
};

export const heartMoveOfSkill = (skill: HeroSkill): HeartMove | undefined => MOVE_BY_SKILL[skill.id];

/**
 * The three warned spells have footprints the script builds. The Pulse does not
 * warn at all: it is instant, so it is run straight from its turn.
 */
const SCRIPTED: ReadonlySet<HeartMove> = new Set(['winter', 'reprisal', 'convergence']);
export const isHeartScriptedSkill = (skill: HeroSkill): boolean => {
  const move = heartMoveOfSkill(skill);
  return move !== undefined && SCRIPTED.has(move);
};

const keyOf = (hex: HexCoord): string => hexKey(hex);

/** Hexes a living body occupies, the Heart's own among them. */
const occupiedKeys = (units: readonly CombatUnit[]): Set<string> =>
  new Set(units.filter((u) => u.currentHp > 0).map((u) => keyOf(u.position)));

const solidKeys = (hazards: readonly ArenaHazard[]): Set<string> => {
  const keys = new Set<string>();
  for (const h of hazards) if (h.solid) for (const hex of h.hexes) keys.add(keyOf(hex));
  return keys;
};

// ── Choosing the move ────────────────────────────────────────────────────────

export interface HeartOffer {
  /** Whether the move can be made now at all: off cooldown, with something to aim at. */
  available: boolean;
  /** How much a turn spent on it is worth now. Higher wins. */
  value: number;
}

export interface HeartMoveContext {
  /** A delayed attack of its own is already open: nothing that prepares may be raised. */
  majorPending: boolean;
  /** Regular turns it has begun in this phase, this one included. */
  turns: number;
  /** The turn each move was last made on (absent: never), and the turn of its last warning (0: none). */
  lastUsed: Readonly<Record<string, number>>;
  lastSignature: number;
  offers: Readonly<Record<HeartMove, HeartOffer>>;
  /** The first turn each spell may be made on in this phase; `HEART_FIRST_TURN` when absent. */
  firstTurn?: Readonly<Record<Exclude<HeartMove, 'pulse'>, number>>;
}

/** Its turns between two warnings: cast on t, lands on t+1, a Pulse on t+2, so the party gets a clear turn. */
export const HEART_SIGNATURE_GAP = 3;
/**
 * The first turn each spell may be made on. It opens with the Pulse, introduces Creeping
 * Winter before the first Reprisal, and Convergence is not made on the turn it is released.
 */
export const HEART_FIRST_TURN: Readonly<Record<Exclude<HeartMove, 'pulse'>, number>> = {
  winter: 2,
  reprisal: 4,
  convergence: 2,
};
/**
 * The chain that rises at a quarter health (tier 5) is short: the Reprisal it exists to cast comes
 * on its second turn, Creeping Winter after it.
 */
export const HEART_RECHAINED_FIRST_TURN: Readonly<Record<Exclude<HeartMove, 'pulse'>, number>> = {
  winter: 3,
  reprisal: 2,
  convergence: 2,
};
const STALE_VALUE = 0.4;
const STALE_TURNS = 5;
const TIE_ORDER: readonly Exclude<HeartMove, 'pulse'>[] = ['winter', 'reprisal', 'convergence'];

/**
 * Its next move: the best-valued of what the board offers, or the Pulse.
 *
 * No cycle. A warned spell is *available* only off its cooldown and only when the
 * board gives it something to do, and *valued* by what it would do to this party now
 * plus a bonus for each turn it has gone unused, so none is starved and none is a
 * rotation. While one warning is open nothing that prepares may be raised: **two
 * warnings never combine into a pattern with no safe answer.**
 */
export function chooseHeartMove(ctx: HeartMoveContext): HeartMove {
  const open = ctx.majorPending || (ctx.lastSignature > 0 && ctx.turns - ctx.lastSignature < HEART_SIGNATURE_GAP);
  if (open) return 'pulse';
  const rotation = ctx.turns % TIE_ORDER.length;
  const order = [...TIE_ORDER.slice(rotation), ...TIE_ORDER.slice(0, rotation)];
  let best: HeartMove = 'pulse';
  let bestValue = ctx.offers.pulse.available ? ctx.offers.pulse.value : -Infinity;
  for (const move of order) {
    const offer = ctx.offers[move];
    if (!offer.available || ctx.turns < (ctx.firstTurn ?? HEART_FIRST_TURN)[move]) continue;
    const idle = Math.min(STALE_TURNS, ctx.turns - (ctx.lastUsed[move] ?? 0));
    const value = offer.value + STALE_VALUE * idle;
    if (value > bestValue) {
      best = move;
      bestValue = value;
    }
  }
  return best;
}

// ── The anchors ──────────────────────────────────────────────────────────────

/** Where the Heart stands when the fight opens. */
export const heartStart = (): HexCoord => ({ q: BALANCE.HEART_START_Q, r: BALANCE.HEART_START_R });

/**
 * Three distinct free hexes around it for the Blood-Iron anchors: on the ring they
 * are picked from, as far from one another as the board allows, then by coordinate.
 * They are never on a body, never beside another anchor and never in the Heart's own
 * hex, so every one can be walked up to and the routes between them stay open.
 */
export function anchorSpots(heart: HexCoord, taken: readonly HexCoord[] = []): HexCoord[] {
  const blocked = new Set(taken.map(keyOf));
  blocked.add(keyOf(heart));
  const ring = arenaHexes()
    .filter((h) => hexDistance(heart, h) === BALANCE.HEART_ANCHOR_RING && !blocked.has(keyOf(h)))
    .map((h) => ({ q: h.q, r: h.r }))
    .sort((a, b) => a.q - b.q || a.r - b.r);
  const picked: HexCoord[] = [];
  while (picked.length < 3 && picked.length < ring.length) {
    let best: HexCoord | null = null;
    let bestGap = -1;
    for (const hex of ring) {
      if (picked.some((p) => keyOf(p) === keyOf(hex))) continue;
      const gap = picked.length === 0 ? 0 : Math.min(...picked.map((p) => hexDistance(p, hex)));
      if (gap > bestGap) {
        best = hex;
        bestGap = gap;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked;
}

/**
 * Where the anchors that rise at a quarter health stand (tier 5): free hexes on the anchor ring, the
 * ones farthest from the heroes first (then by coordinate), never beside one another, so the party
 * has to cross the arena for them.
 */
export function risenAnchorSpots(heart: CombatUnit, units: readonly CombatUnit[], count: number): HexCoord[] {
  const heroes = heroesOf(units as CombatUnit[]);
  const blocked = occupiedKeys(units);
  const nearest = (hex: HexCoord) =>
    heroes.length === 0 ? 0 : Math.min(...heroes.map((h) => hexDistance(hex, h.position)));
  const ring = arenaHexes()
    .filter((h) => hexDistance(heart.position, h) === BALANCE.HEART_ANCHOR_RING && !blocked.has(keyOf(h)))
    .map((h) => ({ q: h.q, r: h.r }))
    .sort((a, b) => nearest(b) - nearest(a) || a.q - b.q || a.r - b.r);
  const picked: HexCoord[] = [];
  for (const hex of ring) {
    if (picked.length >= count) break;
    if (picked.some((p) => hexDistance(p, hex) < 2)) continue;
    picked.push(hex);
  }
  return picked;
}

/** The anchors still standing. */
export const anchorsOf = (boss: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] =>
  objectivesOf(boss.id, units as CombatUnit[]).filter((o) => o.objective?.kind === ANCHOR_KIND);

/** The spires still standing. */
export const spiresOf = (boss: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] =>
  objectivesOf(boss.id, units as CombatUnit[]).filter((o) => o.objective?.kind === SPIRE_KIND);

/** The protection the standing anchors give, by count: 99, 66, 33 or 0 per cent. */
export const anchorProtection = (standing: number): number =>
  Math.min(1, Math.max(0, standing) * BALANCE.HEART_ANCHOR_PROTECTION);

// ── Splintering Pulse ────────────────────────────────────────────────────────

/**
 * The hex directly behind a target as seen from the Heart: the neighbour of the target
 * that lies most nearly along the line from it through them. Null when it is off the board.
 * Fixed by the two positions alone, so the fracture can never retarget.
 */
export function fractureHex(from: HexCoord, target: HexCoord): HexCoord | null {
  const a = hexToPixel(from);
  const b = hexToPixel(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let best: HexCoord | null = null;
  let bestDot = -Infinity;
  for (const n of getNeighbors(target)) {
    const p = hexToPixel(n);
    const dot = (p.x - b.x) * dx + (p.y - b.y) * dy;
    if (dot > bestDot + 1e-9) {
      best = n;
      bestDot = dot;
    }
  }
  return best && inArena(best) ? { q: best.q, r: best.r } : null;
}

// ── Frozen ground ────────────────────────────────────────────────────────────

/** The ground the Heart has frozen. */
export const iceOf = (boss: CombatUnit, hazards: readonly ArenaHazard[]): HexCoord[] =>
  hazards.filter((h) => h.id === HEART_ICE_ID && h.ownerId === boss.id).flatMap((h) => h.hexes);

/** Whether a hex is frozen ground. */
export const isFrozen = (hex: HexCoord, hazards: readonly ArenaHazard[]): boolean =>
  hazards.some((h) => h.id === HEART_ICE_ID && h.hexes.some((x) => keyOf(x) === keyOf(hex)));

/** How many hexes one Creeping Winter marks: its share of the whole arena. */
export const winterCount = (): number => Math.round(arenaHexes().length * BALANCE.HEART_WINTER_SHARE);

/**
 * The ground Creeping Winter spares: every arena hex beside a standing anchor (the anchor's own
 * hex is a body and is never marked anyway). **Fixed at the cast like the rest of the footprint**:
 * the warning stores it (`PreparedAttack.sheltered`), so an anchor that falls afterwards changes
 * nothing, and the preview draws it. Empty once the Heart is unbound, when no anchor stands.
 */
export function winterShelter(boss: CombatUnit, units: readonly CombatUnit[]): HexCoord[] {
  const anchors = anchorsOf(boss, units);
  const anchorKeys = new Set(anchors.map((a) => keyOf(a.position)));
  const seen = new Set<string>();
  const ring: HexCoord[] = [];
  for (const anchor of anchors) {
    for (const hex of getNeighbors(anchor.position)) {
      const key = keyOf(hex);
      if (!inArena(hex) || anchorKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      ring.push({ q: hex.q, r: hex.r });
    }
  }
  return ring.sort((a, b) => a.q - b.q || a.r - b.r);
}

/**
 * Creeping Winter's marked hexes: up to `winterCount()` clear hexes anywhere on the
 * board (half the arena), chosen to threaten the party — a hex a hero stands on first,
 * then the ones nearest the heroes, spread first so the cover is a lattice rather than
 * one clump, then filled in. Never on another body, solid ground or ice already there,
 * and **never beside a standing anchor** (`winterShelter`).
 * Fewer when the board offers fewer; empty when it offers none. Frozen ground can be
 * walked on at a price, so no pattern can wall off a route.
 */
export function winterHexes(
  boss: CombatUnit,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
): HexCoord[] {
  const heroes = heroesOf(units as CombatUnit[]);
  const occupiedExceptHeroes = new Set(
    units.filter((u) => u.currentHp > 0 && u.isPlayer === false).map((u) => keyOf(u.position)),
  );
  const solid = solidKeys(hazards);
  const ice = new Set(iceOf(boss, hazards).map(keyOf));
  const sheltered = new Set(winterShelter(boss, units).map(keyOf));

  const candidates = arenaHexes()
    .filter((h) => {
      const key = keyOf(h);
      return !solid.has(key) && !ice.has(key) && !sheltered.has(key) && !occupiedExceptHeroes.has(key);
    })
    .map((h) => ({ q: h.q, r: h.r }));
  const nearest = (hex: HexCoord) =>
    heroes.length === 0 ? 0 : Math.min(...heroes.map((h) => hexDistance(hex, h.position)));
  const ranked = candidates.sort((a, b) => nearest(a) - nearest(b) || a.q - b.q || a.r - b.r);

  const count = winterCount();
  const picked: HexCoord[] = [];
  const pickedKeys = new Set<string>();
  for (const spread of [2, 0]) {
    for (const hex of ranked) {
      if (picked.length >= count) break;
      if (pickedKeys.has(keyOf(hex))) continue;
      if (spread > 0 && picked.some((p) => hexDistance(p, hex) < spread)) continue;
      picked.push(hex);
      pickedKeys.add(keyOf(hex));
    }
  }
  return picked;
}

// ── Icebound Reprisal ────────────────────────────────────────────────────────

export interface ReprisalPlan {
  anchor: CombatUnit;
  /** The chain between it and the Heart, the ends left out. */
  hexes: HexCoord[];
  /** Heroes standing on it now. */
  caught: number;
}

/**
 * The anchor it strains against, and the line to it: the surviving anchor whose chain
 * crosses the most heroes, then the nearer to the party, then by coordinate. A chain with
 * nobody on it is still a plan — the Barrier it earns is the cost of not answering it.
 * Null with no anchor left or no hex between it and the Heart.
 */
export function reprisalPlan(boss: CombatUnit, units: readonly CombatUnit[]): ReprisalPlan | null {
  return reprisalPlans(boss, units, 1)[0] ?? null;
}

/**
 * The anchors a Reprisal binds, best first by `reprisalPlan`'s order: one, or from tier 3 two
 * (`HEART_TWIST.twinReprisal`) — the two whose chains cross the most heroes, or one if only one stands.
 */
export function reprisalPlans(boss: CombatUnit, units: readonly CombatUnit[], count: number): ReprisalPlan[] {
  const heroes = heroesOf(units as CombatUnit[]);
  const plans: (ReprisalPlan & { near: number })[] = [];
  for (const anchor of anchorsOf(boss, units)) {
    const line = getHexLine(anchor.position, boss.position).slice(1, -1).filter(inArena);
    if (line.length === 0) continue;
    const keys = new Set(line.map(keyOf));
    const caught = heroes.filter((h) => keys.has(keyOf(h.position))).length;
    const near = heroes.length === 0 ? 0 : Math.min(...heroes.map((h) => hexDistance(anchor.position, h.position)));
    plans.push({ anchor, hexes: line.map((h) => ({ q: h.q, r: h.r })), caught, near });
  }
  plans.sort((a, b) =>
    b.caught - a.caught || a.near - b.near
    || a.anchor.position.q - b.anchor.position.q || a.anchor.position.r - b.anchor.position.r);
  return plans.slice(0, count).map(({ anchor, hexes, caught }) => ({ anchor, hexes, caught }));
}

/** How many anchors a Reprisal binds on this Heart. */
export const reprisalBinds = (boss: CombatUnit): number => (heartTwist(boss, 'twinReprisal') ? 2 : 1);

/**
 * How whole the bound anchor is, as the share of the chain's strength that will land: its remaining
 * health over its maximum, read from the board as it stands. A whole anchor is today's chain (1), a
 * half-broken one half of it. Nothing (0) once the anchor is gone: a killed anchor cancels the
 * warning, so a chain with none to strain against never lands.
 */
export const reprisalGrade = (attackId: string, units: readonly CombatUnit[]): number =>
  boundWholeness(attackId, ANCHOR_KIND, units);

// ── Whiteout Convergence ─────────────────────────────────────────────────────

export interface ConvergencePlan {
  /** Where each spire rises. */
  spires: HexCoord[];
  /** Every hex any blast covers. */
  footprint: HexCoord[];
  /** Heroes standing in a blast now. */
  caught: number;
}

/** The hexes a spire's blast covers. */
export const blastArea = (spire: HexCoord): HexCoord[] => discAround(spire, BALANCE.HEART_CONVERGENCE_RADIUS);

/**
 * Where the spires rise: up to `HEART_SPIRES` distinct free hexes near the party, each chosen
 * for how many heroes its blast catches now (then how many are within one more hex, then
 * apart from the other spires, then by coordinate). **A spire is only raised if every hero
 * still has somewhere to stand that no blast covers** within the hex it is on and one step
 * from it, so the pattern never leaves a hero with no safe answer; fewer spires are made if
 * that is what it takes, and none when even one would do it.
 */
export function convergencePlan(
  boss: CombatUnit,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
): ConvergencePlan | null {
  const heroes = heroesOf(units as CombatUnit[]);
  if (heroes.length === 0) return null;
  const taken = occupiedKeys(units);
  for (const h of heroes) taken.delete(keyOf(h.position));
  const solid = solidKeys(hazards);

  const everyHeroSafe = (spires: HexCoord[]): boolean => {
    const covered = new Set(spires.flatMap(blastArea).map(keyOf));
    // The spires themselves are bodies: a hero cannot stand on one
    const bodies = new Set([...taken, ...spires.map(keyOf)]);
    return heroes.every((hero) => {
      const reach = [hero.position, ...getNeighbors(hero.position)];
      return reach.some((hex) => {
        const key = keyOf(hex);
        const free = keyOf(hex) === keyOf(hero.position) || !bodies.has(key);
        return inArena(hex) && free && !solid.has(key) && !covered.has(key);
      });
    });
  };

  const spires: HexCoord[] = [];
  for (let i = 0; i < BALANCE.HEART_SPIRES; i++) {
    let best: { hex: HexCoord; caught: number; near: number; apart: number } | null = null;
    for (const hex of arenaHexes()) {
      const key = keyOf(hex);
      if (taken.has(key) || solid.has(key) || spires.some((s) => keyOf(s) === key)) continue;
      if (heroes.some((h) => keyOf(h.position) === key)) continue;
      const caught = heroes.filter((h) => hexDistance(hex, h.position) <= BALANCE.HEART_CONVERGENCE_RADIUS).length;
      const near = heroes.filter((h) => hexDistance(hex, h.position) <= BALANCE.HEART_CONVERGENCE_RADIUS + 1).length;
      if (near === 0) continue;
      const apart = spires.length === 0 ? 9 : Math.min(...spires.map((s) => hexDistance(s, hex)));
      const better =
        !best ||
        caught > best.caught ||
        (caught === best.caught &&
          (near > best.near ||
            (near === best.near &&
              (apart > best.apart ||
                (apart === best.apart && (hex.q < best.hex.q || (hex.q === best.hex.q && hex.r < best.hex.r)))))));
      if (!better) continue;
      if (!everyHeroSafe([...spires, hex])) continue;
      best = { hex: { q: hex.q, r: hex.r }, caught, near, apart };
    }
    if (!best) break;
    spires.push(best.hex);
  }
  if (spires.length === 0) return null;

  const seen = new Set<string>();
  const footprint: HexCoord[] = [];
  for (const hex of spires.flatMap(blastArea)) {
    if (seen.has(keyOf(hex))) continue;
    seen.add(keyOf(hex));
    footprint.push(hex);
  }
  const caught = heroes.filter((h) => seen.has(keyOf(h.position))).length;
  return { spires, footprint, caught };
}

// ── What the HUD says ────────────────────────────────────────────────────────

export interface HeartIntent {
  /** Anchors standing, and the share of damage they turn aside. */
  anchors: number;
  protection: number;
  /** Torn open now: it takes extra damage. */
  exposed: boolean;
}

export function heartIntent(boss: CombatUnit, units: readonly CombatUnit[]): HeartIntent {
  const anchors = anchorsOf(boss, units).length;
  return {
    anchors,
    protection: anchorProtection(anchors),
    exposed: boss.activeEffects.some((e) => e.type === AuraType.Exposed),
  };
}
