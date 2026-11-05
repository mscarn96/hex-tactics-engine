import {
  AfflictionType,
  ArenaHazard,
  AuraType,
  BossScriptState,
  LegionScriptState,
  CombatUnit,
  HeroSkill,
  HexCoord,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { AETHELRED_PHASES } from '@/data/templates/aethelred';
import { hasEffect } from '@/systems/combat/statusEffects';
import { heroesOf } from '@/systems/combat/targetLegality';
import { arenaHexes, inArena, solidKeys } from '@/systems/combat/arenaGeometry';
import { getMovementRange } from '@/systems/combat/movement';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { combatMaxHp } from '@/systems/combat/forms';
import { getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';
import { ForcedMove, traceForcedMove } from '@/systems/combat/forcedMovement';

/**
 * The rules of a scripted boss fight, as pure functions over a roster.
 *
 * Aethelred is the first boss whose fight is a *sequence*: preparations that
 * must run to the end, delayed payoffs that follow people about, reinforcements
 * the party earns and a warning that widens while it is watched. A generic AI
 * that picks the highest immediate damage cannot hold any of that together, so
 * this file owns what his next move is and what each warning covers, and the
 * store-writing half (`bossActions`) puts it on the board.
 *
 * Nothing here imports the store, so the Node suites, the tuning harness and the
 * HUD can all ask the same questions: which hexes does a crown cover, how wide
 * is the black sun *now*, can every hero still get out. The preview and the
 * resolution read these, which is how a warning stays the attack that lands.
 */

export const AETHELRED_TEMPLATE_ID = 'aethelred';

/** Whether this unit's fight is the scripted one. */
export const isScripted = (unit: CombatUnit): boolean =>
  !unit.isPlayer && unit.templateId === AETHELRED_TEMPLATE_ID;

/** What every script's boss starts with. */
export const initialBossScript = (): BossScriptState => ({ step: 0, phaseTurns: 0, unharmedRounds: 0 });

/** The Emperor's own counters, on top of the common ones. */
export const initialLegionScript = (): LegionScriptState => ({
  ...initialBossScript(),
  damageWindow: 0,
  legionResponded: false,
  titheSpent: false,
  pyreDamage: 0,
  overturns: 0,
});

/** The Emperor's counters, when this boss keeps them. */
export const legionOf = (unit: CombatUnit): LegionScriptState | undefined =>
  unit.bossScript && 'damageWindow' in unit.bossScript ? unit.bossScript : undefined;

// ── The Seal tiers ───────────────────────────────────────────────────────────

/**
 * The tier each of his twists arrives at, read off `challengeTier` (the castle run's Seal tier). Each
 * tier keeps every twist below it, and tier 1 has none (the private project notes,
 * *Aethelred's castle-tier twists*).
 */
export const AETHELRED_TWIST = {
  /** A falling Standard mends the others to full. */
  mendingStandards: 2,
  /** Each throw leaves black glass where the heroes stood. */
  throwGlass: 3,
  /** A seal left empty charges the orb twice. */
  hungrySeals: 4,
  /** His last throw brings the black sun down at once. */
  lastThrowRealm: 5,
} as const;

/** Whether a twist is in force on this Aethelred. */
export const aethelredTwist = (boss: CombatUnit | undefined, twist: keyof typeof AETHELRED_TWIST): boolean =>
  (boss?.challengeTier ?? 1) >= AETHELRED_TWIST[twist];

/** The orb charges one seal left empty adds. */
export const emptySealCharges = (boss: CombatUnit): number =>
  aethelredTwist(boss, 'hungrySeals') ? BALANCE.AETHELRED_TIER_SEAL_CHARGES : 1;

/** His last throw has called the black sun, and it has not been raised yet. */
export const realmIsOwed = (boss: CombatUnit): boolean => legionOf(boss)?.realmOwed === true;

// ── The moves ────────────────────────────────────────────────────────────────

export type BossMove =
  | 'blade'
  | 'writ'
  | 'cleave'
  | 'standards'
  | 'foreclosure'
  | 'chains'
  | 'claim'
  | 'crownfall'
  | 'realm';

const MOVE_BY_SKILL: Readonly<Record<string, BossMove>> = {
  emperors_blade: 'blade',
  writ_of_seizure: 'writ',
  imperial_cleave: 'cleave',
  imperial_standards: 'standards',
  foreclosure: 'foreclosure',
  chains_of_tribute: 'chains',
  collateral_claim: 'claim',
  crownfall: 'crownfall',
  the_realm_that_burned: 'realm',
};

export const moveOfSkill = (skill: HeroSkill): BossMove | undefined => MOVE_BY_SKILL[skill.id];

/**
 * Moves whose footprint is not the skill's own shape. The AI hands these to
 * `castScriptedMove` instead of working a target out for them.
 */
const SCRIPTED_MOVES: ReadonlySet<BossMove> = new Set([
  'foreclosure',
  'chains',
  'claim',
  'crownfall',
  'realm',
]);

export const isScriptedSkill = (skill: HeroSkill): boolean => {
  const move = moveOfSkill(skill);
  return move !== undefined && SCRIPTED_MOVES.has(move);
};

/** A delayed attack with a response window — never more than one at a time. */
const MAJOR_MOVES: ReadonlySet<BossMove> = new Set([
  'cleave',
  'foreclosure',
  'chains',
  'claim',
  'crownfall',
  'realm',
]);

export const isMajorMove = (move: BossMove): boolean => MAJOR_MOVES.has(move);

/**
 * The order each phase works through its moves.
 *
 * **Each phase opens on the moves it exists to teach**, because a phase is only
 * three or four of his turns long and a warning takes two of them (the cast and
 * the landing): the banners and the wedge in phase one, the seals and the chain
 * in phase two (the chain first, on the pair Overturn's throw left farthest apart),
 * the crown and the black sun in phase three. The sword fills the
 * gaps — immediate pressure while a warning is open — and a move that cannot be
 * made (a banner already standing, nobody to chain, a cooldown still running)
 * is skipped to the next.
 */
export const ROTATIONS: readonly (readonly BossMove[])[] = [
  ['standards', 'writ', 'cleave', 'blade', 'writ', 'cleave'],
  // Chains first (the boss feel pass): right after Overturn's throw he links the two it left farthest apart
  // (`chainPair`), so the throw picks the partners
  ['chains', 'foreclosure', 'claim', 'blade'],
  ['crownfall', 'realm', 'foreclosure', 'blade'],
];

export interface MoveContext {
  boss: CombatUnit;
  units: CombatUnit[];
  /** Whether the skill for a move may be cast now (cooldown and the like; a black sun that is owed ignores its cooldown). */
  ready: (move: BossMove) => boolean;
  /** A delayed attack of his is already open. */
  majorPending: boolean;
  /** The ground that remembers: black glass the fall left, which a Crownfall must leave a way round. */
  hazards?: readonly ArenaHazard[];
}

export interface ChosenMove {
  move: BossMove;
  /** The rotation index to resume from after this one. */
  nextStep: number;
}

/**
 * His next move: the first the rotation reaches that can be made.
 *
 * While a warning is open only moves that are not themselves a warning are
 * allowed, which is what keeps two delayed attacks from combining into a
 * pattern with no safe answer. For the same reason a black sun his last throw called (tier 5) waits for
 * a warning already open: it is then his next move, whatever its cooldown or the health it costs. The
 * rotation carries on from where it was.
 */
export function chooseMove(ctx: MoveContext): ChosenMove {
  const phase = Math.min(ROTATIONS.length - 1, ctx.boss.bossPhase ?? 0);
  const rotation = ROTATIONS[phase];
  const step = ctx.boss.bossScript?.step ?? 0;

  if (realmIsOwed(ctx.boss) && !ctx.majorPending && ctx.ready('realm')) return { move: 'realm', nextStep: step };

  for (let i = 0; i < rotation.length; i++) {
    const index = (step + i) % rotation.length;
    const move = rotation[index];
    if (move !== 'blade' && !ctx.ready(move)) continue;
    if (isMajorMove(move) && ctx.majorPending) continue;
    if (!canMake(move, ctx)) continue;
    return { move, nextStep: index + 1 };
  }
  // Nothing in the rotation can be made: the sword always can. The step does
  // not advance, so the same line is tried again next turn.
  return { move: 'blade', nextStep: step };
}

function canMake(move: BossMove, ctx: MoveContext): boolean {
  const heroes = heroesOf(ctx.units);
  if (heroes.length === 0) return false;
  switch (move) {
    case 'blade':
      return true;
    case 'writ':
      return heroes.some((h) => !hasEffect(h, AfflictionType.Writ));
    case 'cleave':
      return true;
    case 'standards':
      return standardsStanding(ctx.boss, ctx.units) === 0;
    case 'foreclosure':
      return true;
    case 'chains':
      return heroes.length >= 2 && !heroes.some((h) => hasEffect(h, AfflictionType.Chained));
    case 'claim':
      return true;
    case 'crownfall':
      return crownIsFair(ctx.boss, ctx.units, ctx.hazards);
    case 'realm': {
      const cost = realmCost(ctx.boss);
      // He pays real health for it and must stay alive to see it land
      return ctx.boss.currentHp > cost * 2 && realmRadiusFor(ctx.boss, ctx.units, 0, ctx.boss.position, ctx.hazards) >= BALANCE.AETHELRED_REALM_RADIUS;
    }
  }
}

/** The objective kind of his banners. */
export const STANDARD_KIND = 'imperial_standard';

/** His Imperial Standards still standing. */
export const standardsOf = (boss: CombatUnit, units: readonly CombatUnit[]): CombatUnit[] =>
  units.filter((u) => u.currentHp > 0 && u.objective?.ownerId === boss.id && u.objective.kind === STANDARD_KIND);

export function standardsStanding(boss: CombatUnit, units: CombatUnit[]): number {
  return standardsOf(boss, units).length;
}

// ── The orb ──────────────────────────────────────────────────────────────────

/** Charges the orb holds, read off the boss's own status row. */
export const orbCharges = (boss: CombatUnit): number =>
  Math.max(0, Math.round(boss.activeEffects.find((e) => e.type === AuraType.OrbCharge)?.magnitude ?? 0));

/**
 * The most charges the orb holds in a phase. Whiffed Cleaves charge it in phase 1; empty seals, Blood in
 * the Ledger (phase 2) and Tithe on Mercy (phase 3) charge it after that.
 */
export const orbChargeCap = (phase: number): number =>
  phase === 0 ? BALANCE.AETHELRED_WHIFF_CAP : phase === 1 ? BALANCE.AETHELRED_LEDGER_CAP : BALANCE.AETHELRED_TITHE_CAP;

// ── Footprints ───────────────────────────────────────────────────────────────

/**
 * The hexes Foreclosure stamps: where its targets stand *now*. The seals are
 * fixed to the floor from this moment — moving the hero does not move them.
 * Targets are the heroes hurting him most, so the orb collects from whoever is
 * costing the Emperor the most.
 */
export function foreclosureTargets(boss: CombatUnit, units: CombatUnit[], count: number): CombatUnit[] {
  const power = (u: CombatUnit) => {
    const stats = getCombatEffectiveStats(u);
    return stats.attack + stats.magic;
  };
  return [...heroesOf(units)]
    .sort((a, b) => power(b) - power(a) || (a.id < b.id ? -1 : 1))
    .slice(0, count);
}

/**
 * The hexes Foreclosure stamps: every hero's hex, then the hexes within
 * `AETHELRED_FORECLOSURE_RADIUS` of them (playtest 2026-10-14) — fixed to the
 * floor from this moment, so moving the hero does not move them. A ring hex is
 * stamped only while every hero can still step clear (`everyoneCanLeave`), the
 * promise every one of his warnings keeps; the heroes' own hexes always are.
 */
export function foreclosureSeals(boss: CombatUnit, units: CombatUnit[], hazards: readonly ArenaHazard[] = []): HexCoord[] {
  const heroes = foreclosureTargets(boss, units, Infinity);
  // Black glass and rubble are never stamped: a seal is a hex someone could stand on
  const solid = solidKeys(hazards);
  const hexes: HexCoord[] = [];
  const taken = new Set<string>();
  const stamp = (h: HexCoord) => { taken.add(hexKey(h)); hexes.push({ q: h.q, r: h.r }); };
  for (const hero of heroes) if (!taken.has(hexKey(hero.position))) stamp(hero.position);
  const radius = BALANCE.AETHELRED_FORECLOSURE_RADIUS;
  for (const hero of heroes) {
    const ring = arenaHexes()
      .filter((h) => {
        const d = hexDistance(hero.position, h);
        return d > 0 && d <= radius && !taken.has(hexKey(h)) && !solid.has(hexKey(h)) && hexKey(h) !== hexKey(boss.position);
      })
      .sort((a, b) => a.q - b.q || a.r - b.r);
    for (const h of ring) {
      if (everyoneCanLeave(heroes, [...hexes, h], units, hazards)) stamp(h);
    }
  }
  return hexes;
}

/**
 * Whether every hero can still get out of `footprint`: some hex within a step's
 * reach of it that the warning does not cover, nobody else stands on and no
 * solid ground (rubble, black glass) fills. The promise behind "a widened blast
 * is never hidden or inescapable".
 */
export function everyoneCanLeave(
  heroes: CombatUnit[],
  footprint: readonly HexCoord[],
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): boolean {
  const covered = new Set(footprint.map(hexKey));
  const solid = solidKeys(hazards);
  const occupied = new Set(units.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position)));
  return heroes.every((hero) => {
    if (!covered.has(hexKey(hero.position))) return true;
    const reach = Math.max(1, getCombatEffectiveStats(hero).moveRange);
    return arenaHexes().some(
      (h) =>
        !covered.has(hexKey(h)) &&
        !occupied.has(hexKey(h)) &&
        !solid.has(hexKey(h)) &&
        hexDistance(hero.position, h) <= reach,
    );
  });
}

export interface WarnedFootprint {
  hexes: HexCoord[];
  /** The part of `hexes` the orb's charges added. */
  bonus: HexCoord[];
}

/**
 * Adds up to `charges` hexes to a warning, each beside what is already marked
 * and as close to the party as it can be — a charge makes the pattern harder to
 * stand in, not larger for its own sake. A hex that would leave a hero with no
 * way out is never added: the warning keeps its escape.
 */
export function addOrbHexes(
  base: readonly HexCoord[],
  charges: number,
  boss: CombatUnit,
  units: CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
): WarnedFootprint {
  const hexes = base.map((h) => ({ ...h }));
  const solid = solidKeys(hazards);
  const bonus: HexCoord[] = [];
  const heroes = heroesOf(units);
  for (let i = 0; i < charges; i++) {
    const taken = new Set(hexes.map(hexKey));
    const candidates = arenaHexes()
      .filter(
        (h) =>
          !taken.has(hexKey(h)) &&
          !solid.has(hexKey(h)) &&
          hexKey(h) !== hexKey(boss.position) &&
          hexes.some((b) => hexDistance(b, h) === 1),
      )
      .sort((a, b) => nearestHero(a, heroes) - nearestHero(b, heroes) || a.q - b.q || a.r - b.r);
    const pick = candidates.find((h) => everyoneCanLeave(heroes, [...hexes, h], units, hazards));
    if (!pick) break;
    hexes.push({ ...pick });
    bonus.push({ ...pick });
  }
  return { hexes, bonus };
}

function nearestHero(hex: HexCoord, heroes: CombatUnit[]): number {
  return heroes.reduce((best, h) => Math.min(best, hexDistance(h.position, hex)), 99);
}

/**
 * The outer arena the crown marks: everything beyond the safe ring around him, less ground that is
 * already solid (the black glass of an earlier fall is not marked again).
 */
export function crownHexes(boss: CombatUnit, hazards: readonly ArenaHazard[] = []): HexCoord[] {
  const solid = solidKeys(hazards);
  return arenaHexes()
    .filter((h) => hexDistance(boss.position, h) > BALANCE.AETHELRED_CROWN_SAFE_RADIUS && !solid.has(hexKey(h)))
    .map((h) => ({ q: h.q, r: h.r }));
}

/** The kind of the ground a fallen Crownfall leaves: solid, lasting until the phase turns. */
export const BLACK_GLASS_KIND = 'black_glass';

/** Whether every free hex of the arena can still be walked to from every other, over `solid` ground. */
function floorConnected(solid: ReadonlySet<string>): boolean {
  const open = arenaHexes().filter((h) => !solid.has(hexKey(h)));
  if (open.length === 0) return true;
  const openKeys = new Set(open.map(hexKey));
  const seen = new Set<string>([hexKey(open[0])]);
  const frontier: HexCoord[] = [open[0]];
  while (frontier.length > 0) {
    const here = frontier.pop()!;
    for (const next of getNeighbors(here)) {
      const key = hexKey(next);
      if (openKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        frontier.push(next);
      }
    }
  }
  return seen.size === open.length;
}

/**
 * The crown points that leave black glass: those that fell on a hex nobody occupies (a living body
 * there was struck instead), outermost first, each kept only if the floor stays one connected piece.
 * `struck` are the hexes of the bodies the fall struck, living or not: a hero it killed stood there, so the
 * hex is theirs and stays open.
 * So the glass walls the arena in toward him and can wall off a corner, and it can never seal a hero
 * who held outer ground from the rest of the board or from each other.
 */
export function glassHexes(
  boss: CombatUnit,
  impact: readonly HexCoord[],
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[] = [],
  struck: readonly HexCoord[] = [],
): HexCoord[] {
  const occupied = new Set(units.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position)));
  for (const h of struck) occupied.add(hexKey(h));
  const solid = solidKeys(hazards);
  const taken: HexCoord[] = [];
  const ordered = [...impact].sort(
    (a, b) => hexDistance(boss.position, b) - hexDistance(boss.position, a) || a.q - b.q || a.r - b.r,
  );
  for (const hex of ordered) {
    const key = hexKey(hex);
    if (occupied.has(key) || solid.has(key)) continue;
    const next = new Set(solid);
    next.add(key);
    if (!floorConnected(next)) continue;
    solid.add(key);
    taken.push({ q: hex.q, r: hex.r });
  }
  return taken;
}

/**
 * Whether a crown cast now would be fair: every hero either already in the safety around him or able to
 * walk into it this turn, over the ground as it stands (bodies and black glass block the way). A hero
 * left in the far corner, or cut off by glass, would be a warning with no answer, so he closes the
 * distance first and the crown waits.
 */
export function crownIsFair(boss: CombatUnit, units: CombatUnit[], hazards: readonly ArenaHazard[] = []): boolean {
  const safe = BALANCE.AETHELRED_CROWN_SAFE_RADIUS;
  const solid = solidKeys(hazards);
  return heroesOf(units).every((hero) => {
    if (hexDistance(hero.position, boss.position) <= safe) return true;
    return getMovementRange(hero, units, [...hazards]).some(
      (h) => hexDistance(h, boss.position) <= safe && !solid.has(hexKey(h)),
    );
  });
}

export const realmCost = (boss: CombatUnit): number =>
  Math.max(1, Math.round(combatMaxHp(boss) * BALANCE.AETHELRED_REALM_COST));

/** The black sun's blast: every hex within `radius` of where he stood when he opened it. */
export function realmHexes(origin: HexCoord, radius: number, hazards: readonly ArenaHazard[] = []): HexCoord[] {
  const solid = solidKeys(hazards);
  return arenaHexes()
    .filter((h) => hexDistance(origin, h) <= radius && !solid.has(hexKey(h)))
    .map((h) => ({ q: h.q, r: h.r }));
}

/**
 * How wide the black sun is for `pyreDamage` dealt since it opened: the opening
 * radius, one more hex per step of damage, never past the cap — and never so
 * wide that a hero could no longer leave it. A radius is only ever returned if
 * the party can get out of it, so widening stops where escape would.
 */
export function realmRadiusFor(
  boss: CombatUnit,
  units: CombatUnit[],
  pyreDamage: number,
  origin: HexCoord = boss.position,
  hazards: readonly ArenaHazard[] = [],
): number {
  const step = Math.max(1, combatMaxHp(boss) * BALANCE.AETHELRED_REALM_WIDEN_PER);
  const wanted = Math.min(
    BALANCE.AETHELRED_REALM_MAX_RADIUS,
    BALANCE.AETHELRED_REALM_RADIUS + Math.floor(pyreDamage / step),
  );
  const heroes = heroesOf(units);
  for (let radius = wanted; radius > BALANCE.AETHELRED_REALM_RADIUS; radius--) {
    if (everyoneCanLeave(heroes, realmHexes(origin, radius, hazards), units, hazards)) return radius;
  }
  return BALANCE.AETHELRED_REALM_RADIUS;
}

/**
 * The soldiers a claim brands: the `count` nearest the party, nearest first, a tie going to the
 * lower id. Nearest is the distance to the closest hero, so the soldiers the party can reach are
 * the ones that carry the claim.
 */
export function claimBrands(soldiers: readonly CombatUnit[], party: readonly CombatUnit[], count: number): CombatUnit[] {
  const nearest = (u: CombatUnit) =>
    party.reduce((best, h) => Math.min(best, hexDistance(h.position, u.position)), 99);
  return [...soldiers]
    .sort((a, b) => nearest(a) - nearest(b) || (a.id < b.id ? -1 : 1))
    .slice(0, count);
}

/** The hexes within `radius` of each soldier, merged — a claim's blast. */
export function claimHexes(centres: readonly HexCoord[], hazards: readonly ArenaHazard[] = []): HexCoord[] {
  const out = new Map<string, HexCoord>();
  const solid = solidKeys(hazards);
  for (const c of centres) {
    for (const h of arenaHexes()) {
      if (hexDistance(c, h) <= BALANCE.AETHELRED_CLAIM_RADIUS && !solid.has(hexKey(h))) out.set(hexKey(h), { q: h.q, r: h.r });
    }
  }
  return [...out.values()];
}

/** Whether a hex lies on the board — re-exported so callers need not import the engine for it. */
export const onBoard = inArena;

// ── Chains ───────────────────────────────────────────────────────────────────

/**
 * Who a chain links: the two heroes standing farthest apart, so a regroup is a
 * real decision and not a formality. A tie goes to the lower id, so the same
 * board always chains the same pair.
 */
export function chainPair(units: CombatUnit[]): [CombatUnit, CombatUnit] | null {
  const heroes = [...heroesOf(units)].sort((a, b) => (a.id < b.id ? -1 : 1));
  let best: [CombatUnit, CombatUnit] | null = null;
  let bestDistance = -1;
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      const d = hexDistance(heroes[i].position, heroes[j].position);
      if (d > bestDistance) {
        bestDistance = d;
        best = [heroes[i], heroes[j]];
      }
    }
  }
  return best;
}

export interface ChainClaim {
  /** `split` when both end close enough to share it; `alone` when the weaker pays all of it. */
  mode: 'split' | 'alone';
  /** Who takes what share of the claim, 1 meaning all of it. */
  shares: { unitId: string; share: number }[];
}

/**
 * How a chain settles when it comes due.
 *
 * Both ends close together split the claim; apart, the weaker — the one with
 * less health left — takes all of it. Decided at the collection from where they
 * stand then, so the response is the regroup or the cleanse, not the guess.
 */
export function settleChain(a: CombatUnit, b: CombatUnit): ChainClaim {
  if (hexDistance(a.position, b.position) <= BALANCE.AETHELRED_CHAINS_SPLIT_RANGE) {
    return {
      mode: 'split',
      shares: [
        { unitId: a.id, share: 0.5 },
        { unitId: b.id, share: 0.5 },
      ],
    };
  }
  const weaker = a.currentHp < b.currentHp || (a.currentHp === b.currentHp && a.id < b.id) ? a : b;
  return { mode: 'alone', shares: [{ unitId: weaker.id, share: 1 }] };
}

// ── Overturn ─────────────────────────────────────────────────────────────────

/**
 * Which of Overturn's throws is due as his turn begins (0, 1 or 2), or null. The first two land as the phase
 * turns: entering phase 2 owes the first, entering phase 3 the second (a fight opened in phase 3 owes only the
 * second). The third is owed once his health is at `AETHELRED_OVERTURN_LAST` or under, inside phase 3. Each is
 * thrown once (`LegionScriptState.overturns`), and only one a turn.
 */
export function overturnDue(boss: CombatUnit): number | null {
  const script = legionOf(boss);
  if (!script || boss.currentHp <= 0 || !isScripted(boss)) return null;
  const phase = Math.min(ROTATIONS.length - 1, boss.bossPhase ?? 0);
  const thrown = script.overturns ?? 0;
  if (thrown < phase) return phase - 1;
  const last = BALANCE.AETHELRED_OVERTURN_DISTANCES.length - 1;
  if (phase === ROTATIONS.length - 1 && thrown === last
    && boss.currentHp <= combatMaxHp(boss) * BALANCE.AETHELRED_OVERTURN_LAST) return last;
  return null;
}

/** Overturn's thresholds as shares of his health, first to last: the phases' own two, then the last. */
export const OVERTURN_THRESHOLDS: readonly number[] = [
  ...AETHELRED_PHASES.slice(1).map((phase) => phase.threshold),
  BALANCE.AETHELRED_OVERTURN_LAST,
];

/** The health share at which his next throw comes, or null once all three are thrown. */
export function nextOverturnAt(boss: CombatUnit): number | null {
  const thrown = legionOf(boss)?.overturns ?? 0;
  return thrown < OVERTURN_THRESHOLDS.length ? OVERTURN_THRESHOLDS[thrown] : null;
}

/** The six directions a hero can be thrown, in a fixed order the dice index. */
const THROW_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

/**
 * Where Overturn's throw `index` puts every hero: each, in id order, a random distance in that throw's range
 * (`AETHELRED_OVERTURN_DISTANCES`) in a random direction, both drawn from `dice` (the fight's own, so a replay
 * throws the same). Each is traced like a shove (`traceForcedMove`, from one step behind the hero along the
 * direction), seeing where the heroes before it landed: walls, bodies, objectives and solid ground (black glass)
 * stop it short, and Immovable is not moved.
 */
export function overturnThrows(
  index: number,
  units: readonly CombatUnit[],
  hazards: readonly ArenaHazard[],
  dice: () => number,
): ForcedMove[] {
  const [low, high] = BALANCE.AETHELRED_OVERTURN_DISTANCES[Math.max(0, Math.min(index, BALANCE.AETHELRED_OVERTURN_DISTANCES.length - 1))];
  const heroes = [...heroesOf(units)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let occupancy = [...units];
  const moves: ForcedMove[] = [];
  for (const hero of heroes) {
    const direction = THROW_DIRECTIONS[Math.min(5, Math.floor(dice() * 6))];
    const distance = low + Math.min(high - low, Math.floor(dice() * (high - low + 1)));
    const body = occupancy.find((u) => u.id === hero.id) ?? hero;
    const origin = { q: body.position.q - direction.q, r: body.position.r - direction.r };
    const move = traceForcedMove(origin, body, distance, occupancy, [...hazards]);
    moves.push(move);
    if (move.moved) occupancy = occupancy.map((u) => (u.id === hero.id ? { ...u, position: move.to } : u));
  }
  return moves;
}
