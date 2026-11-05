import type { LessonId } from '@/data/templates/lastLesson';
import {
  ActiveEffect, AfflictionType, ArenaHazard, AuraType, BossScriptState, CombatUnit, HeroSkill, HexCoord, LegionScriptState, PreparedAttack,
  StatusEffectType,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import {
  addOrbHexes, AETHELRED_TEMPLATE_ID, foreclosureSeals, initialBossScript, initialLegionScript, isScripted, legionOf, orbChargeCap,
  nextOverturnAt,
  orbCharges,
} from '@/systems/combat/bossScript';
import { heapsOf, isFurious, isTroll, TROLL_TEMPLATE_ID, TrollMove, upcomingMoves, willRegenerate } from '@/systems/combat/trollScript';
import { DRAGON_TEMPLATE_ID, heartRoundsLeft, heartWarning, isDragon } from '@/systems/combat/dragonScript';
import { heatAfterQuench, heatOf, heatStrength, nextHeatOf } from '@/systems/combat/dragonHeat';
import {
  ANCHOR_KIND, anchorSpots, HEART_RECHAINED_PHASE, HEART_TEMPLATE_ID, heartIntent, heartStart, isHeart, risenAnchorSpots,
} from '@/systems/combat/heartScript';
import { createObjective } from '@/systems/combat/objectives';
import { directionToward } from '@/systems/combat/facing';
import { afterRegularTurnBegun } from '@/systems/combat/unharmed';
import { hexDistance } from '@/utils/hexUtils';
import { castleTwistsAt } from '@/systems/world/castle';
import { heartTwistsAt } from '@/systems/world/heartRefight';
// Jadeveil: Silent Hall / Fallen Order
import { initialLessonScript, isLastLesson, LAST_LESSON_ID, lessonMemory, lessonsNamed } from '@/systems/combat/lastLessonRules';
// Jadeveil: Silk Hollow / Yokai
import { isJorogumo, JOROGUMO_TEMPLATE, THREAD_KIND, threadSpots, weaverPerch } from '@/systems/combat/yokaiKits';
// Jadeveil: Kairen
import { hasWeather, initialKairenScript, isKairen, KAIREN_TEMPLATE_ID, tierOf } from '@/systems/combat/kairenRules';

/**
 * Every boss in the game, one entry each, and the questions asked of all of them.
 *
 * An entry is a boss's pure half: who it is, the script state it starts with, where it opens,
 * what it writes when a hero is healed, whether it owes itself a second action, what its panel
 * shows and how many points its briefing has. Its effectful half — how it decides, casts and
 * lands — is the `EncounterScript` named by `script` in `scriptRegistry`. The two halves are
 * split only because the store imports this one: the scripts import the store, so a boss's
 * hooks cannot sit in the entry the store reads (the import-cycle suite holds that line).
 *
 * Callers never ask for a boss by name. The store asks `scriptStateFor`, `arrangeOpening`,
 * `grantsExtraAction`, and how each boss answers what happens on the board: a hero healed
 * (`mercyWrites`), a unit's step (`stepVoids`), a warning broken (`brokenWrites`) and a phase
 * turning over (`intoNewPhase`). The scene asks `bossReadout` and `bossChains` once each; the turn
 * start asks `turnBegun`. A new boss is one entry here and one script.
 *
 * **The readout is values, not words.** What a boss shows is a list of facts (`BossSummaryFact`,
 * `BossGaugeFact`, `BossLessonFact`) — counts, shares, move and skill ids — and the HUD words
 * them from the catalog (`components/combat/hud/bossReadoutText.ts`), so a rule's test asserts
 * the number and a language change is only a re-render.
 */

// ── The readout ──────────────────────────────────────────────────────────────

/** What a boss's panel line says after the phase, in a few words each. */
export type BossSummaryFact =
  /** The Heart's anchors still stand: the share of damage it takes. */
  | { kind: 'restrained'; takes: number }
  /** The Heart is torn open and takes extra. */
  | { kind: 'torn' }
  /** The Troll's Fury: every turn carries a second Sweep. */
  | { kind: 'fury' }
  /** The move the Troll's cycle holds next. */
  | { kind: 'next'; move: TrollMove }
  /** Kairen's Storm Seal tier, from the second. */
  | { kind: 'stormTier'; tier: number }
  /** The weather Kairen's phase has brought, by phase index. */
  | { kind: 'weather'; phase: number }
  /** The boss is open to a blow (Kairen, the Troll on a broken heap): the extra share of damage it takes. */
  | { kind: 'exposed'; takes: number };

/** One signature move still cooling, and for how many of his turns. */
export interface Cooling {
  skill: HeroSkill;
  turns: number;
}

/**
 * The gauge row under a boss's health bar: what its fight counts, what its next step will do, the
 * signature moves still cooling and, once a move is committed, which way it faces.
 */
export type BossGaugeFact =
  /** The Troll is hurt and nobody has struck him since his last turn: he will regenerate. */
  | { kind: 'regenerates' }
  /** The Troll's fort: the heaps of his rubble standing. */
  | { kind: 'rubble'; heaps: number }
  /** Aethelred's orb: its charges, and the hexes the next orb warning will add. */
  | { kind: 'orb'; charges: number; hexes: number }
  /** Foreclosure is open: how many of its seals have been paid. */
  | { kind: 'seals'; paid: number; total: number }
  /** Aethelred's next Overturn: the share of his health it comes at. */
  | { kind: 'overturn'; at: number }
  /** Signature moves still cooling. */
  | { kind: 'cooling'; moves: Cooling[] }
  /** The Dragon's heat, as strength now and on his next turn (fractions). */
  | { kind: 'heat'; now: number; next: number }
  /**
   * The Dragon's carried Furnace Heart: who holds it, and the rounds of the heroes' turns before it
   * bursts (`heartRoundsLeft`; 0 is due: it bursts as his next turn begins).
   */
  | { kind: 'heart'; carrierId: string; rounds: number }
  /** A move is committed: the nearest hero standing the way it faces (`unitId`), or empty ground (`null`). */
  | { kind: 'facing'; unitId: string | null };

/** One of the Last Lesson's standing lessons, on the warning banner; the first carries the repeat rule. */
export interface BossLessonFact {
  bossId: string;
  lesson: LessonId;
  first: boolean;
}

/** What one boss shows; a boss that shows nothing at a place leaves it out. */
export interface BossShows {
  summary?: BossSummaryFact[];
  gauge?: BossGaugeFact[];
  lessons?: BossLessonFact[];
}

/** The board a readout reads. */
export interface BoardView {
  units: CombatUnit[];
  prepared: PreparedAttack[];
  hazards: ArenaHazard[];
}

/** Every living boss's readout, gathered in roster order, and the queue's one boss question. */
export interface BossReadout {
  summary: BossSummaryFact[];
  gauge: BossGaugeFact[];
  lessons: BossLessonFact[];
  /** The unit whose turn ends in an extra action of its own, so the queue can show it next. */
  extraActionId: string | null;
}

/** The chains drawn on the board: slack ones, and the ones a warning is straining. */
export interface BossChains {
  slack: [HexCoord, HexCoord][];
  taut: [HexCoord, HexCoord][];
}

// ── The entry ────────────────────────────────────────────────────────────────

/** A change a boss asks the store to make, as data, so this half stays pure. */
export interface ScriptWrite {
  unitId: string;
  patch?: Partial<LegionScriptState>;
  removeEffect?: StatusEffectType;
  setEffect?: ActiveEffect;
}

export interface Boss {
  /** The boss's template id: its briefing's key in the `bossBriefing` namespace. */
  templateId: string;
  /** The `EncounterScript` that decides, casts and lands for it (`scriptRegistry`). */
  script: string;
  /** Whether this unit is this boss. */
  is(unit: CombatUnit): boolean;
  /** The script state the boss starts its fight with. */
  initialState(): BossScriptState;
  /** How many dangers (1–5) and opportunities (1–2) its briefing has: `<id>.danger1`/`avoid1` …, `<id>.chance1`/`use1` …. */
  briefing: { dangers: number; chances: number };
  /** What its panel shows now. */
  readout(boss: CombatUnit, view: BoardView): BossShows;
  /** The chains it draws on the board. */
  chains?(boss: CombatUnit, units: CombatUnit[]): BossChains;
  /**
   * Where its units start and what stands with them: returns the enemy roster rearranged and
   * anything it puts on the board of its own.
   */
  arrange?(enemies: CombatUnit[]): { enemies: CombatUnit[]; extra: CombatUnit[] };
  /** After a regular turn of this boss has just ended: whether it takes a second action at once. */
  extraAction?(boss: CombatUnit): boolean;
  /** A hero was healed or shielded: what the boss writes in answer, if anything. */
  onMercy?(units: CombatUnit[]): ScriptWrite[];
  /** A unit has taken a step: what of the boss's the step voids on it. */
  onStep?(unit: CombatUnit): StatusEffectType[];
  /** A warning was broken as it came due (`removePreparedAttack(id, 'broken')`): what the boss writes in answer. */
  onBroken?(attack: PreparedAttack, units: CombatUnit[]): ScriptWrite[];
  /**
   * The boss's phase is turning over (one that does not keep the script): the script state it
   * carries into the next (cleared, by default) and the effects the old phase takes with it.
   */
  onPhase?(boss: CombatUnit): { state?: NonNullable<CombatUnit['bossScript']>; sheds?: StatusEffectType[] };
  /** The twists a Seal tier adds to its fight, each in one line, in the current language (its briefing lists them). */
  twists?(tier: number): string[];
  /** The boss has just entered a phase (`boss.bossPhase`): the objectives it raises on the board. */
  raise?(boss: CombatUnit, units: CombatUnit[]): CombatUnit[];
}

// ── Shared gauge facts ───────────────────────────────────────────────────────

/** Signature moves that are still cooling. */
function cooling(boss: CombatUnit): BossGaugeFact[] {
  const moves = boss.skills
    .filter((s) => s.prepares && (boss.cooldowns?.[s.id] ?? 0) > 0)
    .map((skill) => ({ skill, turns: boss.cooldowns![skill.id] }));
  return moves.length > 0 ? [{ kind: 'cooling', moves }] : [];
}

/** After a committed move: the hero standing the way he faces, or empty ground. */
function facing(boss: CombatUnit, view: BoardView): BossGaugeFact[] {
  const committed = view.prepared.some((p) => p.casterId === boss.id);
  if (!committed || boss.facing === undefined) return [];
  const ahead = view.units
    .filter((u) => u.currentHp > 0 && !u.objective && u.isPlayer !== boss.isPlayer
      && directionToward(boss.position, u.position) === boss.facing)
    .sort((a, b) => hexDistance(boss.position, a.position) - hexDistance(boss.position, b.position))[0];
  return [{ kind: 'facing', unitId: ahead?.id ?? null }];
}

/** Open to a blow: the extra share of damage the Exposed on it adds, said on the summary line. */
function exposed(boss: CombatUnit): BossSummaryFact[] {
  const open = boss.activeEffects.find((e) => e.type === AuraType.Exposed);
  return open ? [{ kind: 'exposed', takes: open.magnitude }] : [];
}

// ── The bosses ───────────────────────────────────────────────────────────────

const aethelred: Boss = {
  templateId: AETHELRED_TEMPLATE_ID,
  script: 'aethelred',
  is: isScripted,
  initialState: initialLegionScript,
  briefing: { dangers: 5, chances: 2 },
  /**
   * The health share his next Overturn comes at, the orb's charges (what the party owes) and the hexes the next orb warning will add before it
   * is cast, and while Foreclosure is open how many of its seals have been paid.
   */
  readout(boss, view) {
    const { units, prepared, hazards } = view;
    const charges = orbCharges(boss);
    const orb: BossGaugeFact[] = charges > 0 || (boss.bossPhase ?? 0) > 0
      ? [{
        kind: 'orb',
        charges,
        hexes: charges > 0 ? addOrbHexes(foreclosureSeals(boss, units, hazards), charges, boss, units, hazards).bonus.length : 0,
      }]
      : [];
    const sealed = prepared.find((p) => p.casterId === boss.id && p.spec.sealed && p.bound);
    const seals: BossGaugeFact[] = sealed ? [{ kind: 'seals', paid: sealed.tolls?.length ?? 0, total: sealed.bound!.length }] : [];
    // Overturn: the health share his next throw comes at, while one is still to come
    const next = nextOverturnAt(boss);
    const heave: BossGaugeFact[] = next !== null ? [{ kind: 'overturn', at: next }] : [];
    return { gauge: [...heave, ...orb, ...seals, ...cooling(boss), ...facing(boss, view)] };
  },
  /**
   * Tithe on Mercy: a hero healed or shielded charges the orb once between two of his turns, in
   * phase 3 only (`bossPhase` 2, counted from zero).
   */
  onMercy(units) {
    const boss = units.find((u) => u.currentHp > 0 && isScripted(u) && (u.bossPhase ?? 0) === 2);
    if (!boss || legionOf(boss)?.titheSpent) return [];
    const held = orbCharges(boss);
    const cap = orbChargeCap(2);
    const writes: ScriptWrite[] = [{ unitId: boss.id, patch: { titheSpent: true } }];
    if (held < cap) {
      writes.push({
        unitId: boss.id,
        removeEffect: AuraType.OrbCharge,
        setEffect: { type: AuraType.OrbCharge, magnitude: Math.min(cap, held + 1), duration: -1, sourceUnitId: boss.id },
      });
    }
    return writes;
  },
  /** A step voids his Writ: standing on the order is the price of the strong action, and walking away is the answer. */
  onStep: () => [AfflictionType.Writ],
  /** His castle Seal tier's twists (`castle.ts`). */
  twists: castleTwistsAt,
  /**
   * The rotation starts over and what the orb collected stays in the phase that collected it; the
   * Legion Responds, which happens once, is remembered.
   */
  onPhase(boss) {
    const legion = legionOf(boss);
    return {
      state: legion ? { ...initialLegionScript(), legionResponded: legion.legionResponded, overturns: legion.overturns ?? 0 } : initialBossScript(),
      sheds: [AuraType.OrbCharge],
    };
  },
};

const troll: Boss = {
  templateId: TROLL_TEMPLATE_ID,
  script: 'troll',
  is: isTroll,
  initialState: initialBossScript,
  briefing: { dangers: 5, chances: 2 },
  /**
   * His Fury, whether a heap gave way under him (Exposed) and the move his cycle holds next; under the bar,
   * the regeneration said before it happens (never once one hero is left), the heaps of rubble standing,
   * so the pair sees the fort shrink, and the way he faces.
   */
  readout: (boss, view) => ({
    summary: [
      ...(isFurious(boss) ? [{ kind: 'fury' } as const] : []),
      ...exposed(boss),
      { kind: 'next', move: upcomingMoves(boss, 1)[0] },
    ],
    gauge: [
      ...(willRegenerate(boss, view.units) ? [{ kind: 'regenerates' } as const] : []),
      { kind: 'rubble', heaps: heapsOf(boss.id, view.hazards).length },
      ...facing(boss, view),
    ],
  }),
  /** Fury: a second action after every regular turn and bonus turn, never after the extra itself. */
  extraAction: isFurious,
};

/** The Dragon's carried Heart on his gauge row: who holds it and how long until it bursts. */
function heartGauge(boss: CombatUnit, view: BoardView): BossGaugeFact[] {
  const attack = heartWarning(boss, view.prepared);
  const carrierId = attack?.bound?.[0];
  return attack && carrierId ? [{ kind: 'heart', carrierId, rounds: heartRoundsLeft(attack, view.units) }] : [];
}

const dragon: Boss = {
  templateId: DRAGON_TEMPLATE_ID,
  script: 'dragon',
  is: isDragon,
  initialState: initialBossScript,
  briefing: { dangers: 5, chances: 2 },
  /** His heat, as strength now and on his next turn; the Heart's countdown beside it; his signature moves cooling. */
  readout: (boss, view) => ({
    gauge: [
      { kind: 'heat', now: heatStrength(heatOf(boss)), next: heatStrength(nextHeatOf(boss)) },
      ...heartGauge(boss, view),
      ...cooling(boss),
      ...facing(boss, view),
    ],
  }),
  /** A broken warning that quenches his heat (`quenchedOnBreak`: the Furnace Heart, Skyfire) knocks it down. */
  onBroken(attack, units) {
    const caster = attack.spec.quenchedOnBreak ? units.find((u) => u.id === attack.casterId) : undefined;
    return caster && isDragon(caster) ? [{ unitId: caster.id, patch: { heat: heatAfterQuench(caster) } }] : [];
  },
};

const heart: Boss = {
  templateId: HEART_TEMPLATE_ID,
  script: 'heart',
  is: isHeart,
  initialState: initialBossScript,
  briefing: { dangers: 3, chances: 1 },
  /** Its restraints: the share of damage the anchors left let through, or that it is torn open. */
  readout(boss, view) {
    const intent = heartIntent(boss, view.units);
    if (intent.exposed) return { summary: [{ kind: 'torn' }] };
    return intent.anchors > 0 ? { summary: [{ kind: 'restrained', takes: 1 - intent.protection }] } : {};
  },
  /**
   * The Blood-Iron chains: each anchor still standing to the Heart it holds, and the one a Reprisal
   * is straining against, drawn brighter and heavier until it snaps or is broken.
   */
  chains(boss, units) {
    const anchors = units.filter((u) => u.currentHp > 0 && u.objective?.kind === ANCHOR_KIND);
    const pair = (a: CombatUnit): [HexCoord, HexCoord] => [a.position, boss.position];
    return {
      slack: anchors.filter((a) => !a.objective?.bindsPrepared).map(pair),
      taut: anchors.filter((a) => a.objective?.bindsPrepared).map(pair),
    };
  },
  /** Its Winter Seal tier's twists (`heartRefight.ts`). */
  twists: heartTwistsAt,
  /** It fights from near the middle, chained to three anchors that are on the board from turn one. */
  arrange(enemies) {
    const moved = enemies.map((u) => (isHeart(u) ? { ...u, position: heartStart() as HexCoord } : u));
    const extra = moved.filter(isHeart).flatMap((boss) =>
      anchorSpots(boss.position, moved.map((u) => u.position)).map((position) => heartAnchor(boss, position)),
    );
    return { enemies: moved, extra };
  },
  /**
   * Tier 5: at a quarter health two anchors rise on the spots farthest from the heroes and chain it
   * again (`HEART_RECHAINED_PHASE`), with the first chain's health, protection and release.
   */
  raise(boss, units) {
    if (boss.bossPhase !== HEART_RECHAINED_PHASE) return [];
    return risenAnchorSpots(boss, units, BALANCE.HEART_SEAL.RECHAIN_ANCHORS).map((position) => heartAnchor(boss, position));
  },
};

/** One Blood-Iron anchor holding the Heart: a share of its guard, and the last of them tears it free. */
function heartAnchor(boss: CombatUnit, position: HexCoord): CombatUnit {
  return createObjective({
    kind: ANCHOR_KIND,
    owner: boss,
    position,
    hp: Math.max(1, Math.round(boss.stats.maxHp * BALANCE.HEART_ANCHOR_HP)),
    protection: BALANCE.HEART_ANCHOR_PROTECTION,
    onLast: 'release',
  });
}

// Jadeveil: Silent Hall / Fallen Order — the Last Lesson's memory of the round
const lastLesson: Boss = {
  templateId: LAST_LESSON_ID,
  script: 'lastLesson',
  is: isLastLesson,
  initialState: initialLessonScript,
  briefing: { dangers: 4, chances: 1 },
  /**
   * His standing lessons, on the warning banner beside the warned attacks, from the moment he
   * names them until his next turn names the next.
   */
  readout: (boss) => ({
    lessons: lessonsNamed(lessonMemory(boss)).map((lesson, i) => ({ bossId: boss.id, lesson: lesson.id, first: i === 0 })),
  }),
};

// ── Jadeveil: Silk Hollow / Yokai ────────────────────────────────────────────
const weaver: Boss = {
  templateId: JOROGUMO_TEMPLATE,
  script: 'yokai',
  is: isJorogumo,
  initialState: initialBossScript,
  briefing: { dangers: 4, chances: 2 },
  /** Her threads and her web are on the board and the banner; her panel adds nothing. */
  readout: () => ({}),
  /**
   * She opens hanging over her perch on the back row, held up by three threads standing on the
   * ring round it. Every thread cut costs her its backlash, up there or not; the last releases
   * her second phase.
   */
  arrange(enemies) {
    const moved = enemies.map((u) =>
      isJorogumo(u)
        ? {
            ...u,
            position: weaverPerch() as HexCoord,
            activeEffects: [
              ...u.activeEffects.filter((e) => e.type !== AuraType.Suspended),
              { type: AuraType.Suspended, magnitude: 1, duration: -1, sourceUnitId: u.id },
            ],
          }
        : u,
    );
    const extra = moved.filter(isJorogumo).flatMap((boss) =>
      threadSpots(boss.position, moved.map((u) => u.position)).map((position) => {
        const thread = createObjective({
          kind: THREAD_KIND,
          owner: boss,
          position,
          hp: Math.max(1, Math.round(boss.stats.maxHp * BALANCE.JOROGUMO_WEAVER.THREAD_HP)),
          // Each thread cut tears at her, even up on the others: the last one also drags her down
          backlash: BALANCE.JOROGUMO_WEAVER.THREAD_BACKLASH,
          onLast: 'release',
        });
        return { ...thread, stats: { ...thread.stats, magicDefense: 0 } };
      }),
    );
    return { enemies: moved, extra };
  },
  /** A boss hanging on threads that were cut is on the board now. */
  onPhase: () => ({ sheds: [AuraType.Suspended] }),
};

// ── Jadeveil: Kairen ─────────────────────────────────────────────────────────
const kairen: Boss = {
  templateId: KAIREN_TEMPLATE_ID,
  script: 'kairen',
  is: isKairen,
  initialState: initialKairenScript,
  briefing: { dangers: 4, chances: 1 },
  /** The Storm Seal tier he is fought at (from the second), the weather his phase has brought, and whether he is open to a blow. */
  readout(boss) {
    const tier = tierOf(boss);
    const phase = boss.bossPhase ?? 0;
    return {
      summary: [
        ...(tier > 1 ? [{ kind: 'stormTier', tier } as const] : []),
        ...(hasWeather(phase) ? [{ kind: 'weather', phase } as const] : []),
        ...exposed(boss),
      ],
    };
  },
  /** He opens near the top of the summit. */
  arrange(enemies) {
    const start: HexCoord = { q: BALANCE.KAIREN.START_Q, r: BALANCE.KAIREN.START_R };
    return { enemies: enemies.map((u) => (isKairen(u) ? { ...u, position: { ...start } } : u)), extra: [] };
  },
  /**
   * He remembers his whole fight — the brood, the gales, the phase the board was put right for —
   * and comes down from the sky.
   */
  onPhase(boss) {
    const script = boss.bossScript;
    return {
      state: script && 'kairen' in script ? { ...initialBossScript(), kairen: script.kairen } : initialBossScript(),
      sheds: [AuraType.Aloft],
    };
  },
};

/** Every boss, in the order the hand-written ladders ran: the order openings are arranged in. */
export const BOSSES: readonly Boss[] = [aethelred, troll, dragon, heart, lastLesson, weaver, kairen];

// ── The questions ────────────────────────────────────────────────────────────

/** The boss this unit is, if it is one. */
export const bossOf = (unit: CombatUnit): Boss | undefined => BOSSES.find((b) => b.is(unit));

/** A boss by template id. */
export const bossNamed = (templateId: string): Boss | undefined => BOSSES.find((b) => b.templateId === templateId);

/** A scripted boss starts its fight with a clean sheet. */
export const scriptStateFor = (unit: CombatUnit): BossScriptState | undefined => bossOf(unit)?.initialState();

/** Each boss's opening arrangement of the enemy roster, in registration order. */
export function arrangeOpening(enemies: CombatUnit[]): { enemies: CombatUnit[]; extra: CombatUnit[] } {
  let roster = enemies;
  const extra: CombatUnit[] = [];
  for (const boss of BOSSES) {
    const arranged = boss.arrange?.(roster);
    if (!arranged) continue;
    roster = arranged.enemies;
    extra.push(...arranged.extra);
  }
  return { enemies: roster, extra };
}

/** Whether a boss owes this unit a second action as its turn ends. */
export const grantsExtraAction = (unit: CombatUnit): boolean => bossOf(unit)?.extraAction?.(unit) ?? false;

/** What every boss writes when a hero is healed or shielded. */
export const mercyWrites = (units: CombatUnit[]): ScriptWrite[] => BOSSES.flatMap((b) => b.onMercy?.(units) ?? []);

/** What a unit's step voids on it, whichever boss laid it. */
export const stepVoids = (unit: CombatUnit): StatusEffectType[] => BOSSES.flatMap((b) => b.onStep?.(unit) ?? []);

/** What a boss raises on the board as it enters the phase it is in now. */
export const phaseRaises = (boss: CombatUnit, units: CombatUnit[]): CombatUnit[] => bossOf(boss)?.raise?.(boss, units) ?? [];

/** What every boss writes when a warning is broken. */
export const brokenWrites = (attack: PreparedAttack, units: CombatUnit[]): ScriptWrite[] =>
  BOSSES.flatMap((b) => b.onBroken?.(attack, units) ?? []);

/**
 * A unit as its phase turns over, past what the phase itself sets: its script state cleared
 * (less what its boss entry carries across) and the effects its old phase takes with it.
 */
export function intoNewPhase(unit: CombatUnit): Pick<CombatUnit, 'activeEffects'> & Partial<Pick<CombatUnit, 'bossScript'>> {
  const turned = bossOf(unit)?.onPhase?.(unit);
  const sheds = turned?.sheds ?? [];
  return {
    ...(unit.bossScript && { bossScript: turned?.state ?? initialBossScript() }),
    activeEffects: unit.activeEffects.filter((e) => !sheds.includes(e.type)),
  };
}

/**
 * What every boss counts as a regular turn of its own begins, after its script's own turn start
 * has run (`scriptRegistry`): the turns lived in this phase, which hold its big moves back from the
 * opening turns and a deferred phase change until it has acted in this one; and the rounds since
 * a hero last damaged it (`unharmed`). Fury actions and bonus turns never come here.
 */
export const turnBegun = (boss: CombatUnit): Partial<BossScriptState> => ({
  phaseTurns: (boss.bossScript?.phaseTurns ?? 0) + 1,
  unharmedRounds: afterRegularTurnBegun(boss),
});

const living = (units: CombatUnit[]) => units.filter((u) => u.currentHp > 0 && !u.isPlayer);

/** What every living boss shows, in roster order, and whose turn ends in an extra action. */
export function bossReadout(view: BoardView & { currentUnitId?: string | null; extraActive?: boolean }): BossReadout {
  const shows = living(view.units).flatMap((unit) => {
    const boss = bossOf(unit);
    return boss ? [boss.readout(unit, view)] : [];
  });
  const current = view.units.find((u) => u.id === view.currentUnitId);
  return {
    summary: shows.flatMap((s) => s.summary ?? []),
    gauge: shows.flatMap((s) => s.gauge ?? []),
    lessons: shows.flatMap((s) => s.lessons ?? []),
    extraActionId: current && current.currentHp > 0 && !view.extraActive && grantsExtraAction(current) ? current.id : null,
  };
}

/** The chains every living boss draws on the board. */
export function bossChains(units: CombatUnit[]): BossChains {
  const chains = living(units).flatMap((unit) => {
    const drawn = bossOf(unit)?.chains?.(unit, units);
    return drawn ? [drawn] : [];
  });
  return { slack: chains.flatMap((c) => c.slack), taut: chains.flatMap((c) => c.taut) };
}
