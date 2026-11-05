import {
  AfflictionType,
  AuraType,
  CombatUnit,
  Hero,
  HeroSkill,
  LEVEL_SCALE,
  MasteryNode,
  NODE_MAX_LEVEL,
  PassiveId,
  SkillId,
} from '@/models/types';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import {
  canUnlockNode,
  deriveHeroSkills,
  findSkill,
  levelScale,
  masteryModifiers,
  masteryPassiveRanks,
  masteryStatBonus,
  maxLevelOf,
  nodeLevel,
  ownsNode,
  pointsSpent,
  unlockedNodes,
} from '@/systems/progression/mastery';
import { PASSIVE_DEFS } from '@/systems/combat/passives';
import { slash } from '@/data/skills/skillData';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * A mastery node is a rank, not a switch.
 *
 * The rule the whole thing rests on: **every authored number in a tree is the
 * level-2 value.** That is what let three levels arrive without any of the
 * twelve trees being retuned, and it is the thing a future "let's make level 1
 * the baseline" refactor would silently break — every node in the game would
 * quietly become 33% stronger at the top with nothing failing.
 *
 * Everything here is measured against the *shipped* trees rather than fixtures,
 * because the failures worth catching are a node authored in a way the scale
 * cannot express — an integer step on a three-level node, a magnitude that
 * rounds to nothing at 0.75.
 */

const STATS = {
  maxHp: 100, attack: 10, defense: 5, magic: 10, speed: 10, moveRange: 3, maxMana: 40,
};

function hero(over: Partial<Hero> = {}): Hero {
  return {
    id: 'h1', name: 'T', templateId: 'warrior', heroClass: 'warrior',
    level: 20, xp: 0, baseStats: { ...STATS }, currentHp: 100, currentMana: 40,
    skills: [], equipment: {}, masteryPath: null, masteryPoints: 99, masteryNodes: {},
    ...over,
  } as Hero;
}

/** Every node in the game, with the path it belongs to. */
const ALL_NODES: { path: (typeof MASTERY_PATHS)[number]; node: MasteryNode }[] =
  MASTERY_PATHS.flatMap((path) => path.nodes.map((node) => ({ path, node })));

const heroWith = (path: (typeof MASTERY_PATHS)[number], node: MasteryNode, level: number): Hero =>
  hero({ heroClass: path.heroClass, masteryPath: path.id, masteryNodes: { [node.id]: level } });

// ─── Probes for the passive sweep ─────────────────────────────────────────────

/**
 * A unit rigged so that every rankable passive's *condition* is satisfied.
 *
 * One unit rather than a table of per-passive fixtures, because a table is a
 * second list of which passives exist and would silently stop covering a new
 * one. The two genuine conflicts are handled by id: `feralHeart` measures the
 * shape a Druid is **not** wearing and returns nothing while shifted, while
 * `verdantBlood` and `secondSkin` require the opposite.
 */
function probeUnit(id: PassiveId, rank: { level: number; scale: number }): CombatUnit {
  const shifted = id === 'verdantBlood' || id === 'secondSkin';
  return makeUnit({
    id: 'probe',
    isPlayer: true,
    stats: makeStats({ maxHp: 100, attack: 20, defense: 10, magic: 20 }),
    // Low enough to satisfy every "how hurt is it" gate at once — Wrath's ramp,
    // Last Stand's 30% window and Regeneration's not-full check.
    currentHp: 20,
    // `chosenForm` reads the shift skill off the unit's own bar, so Wildshape's
    // capstone needs one present whether or not the shape is currently worn.
    skills: [{ ...slash, id: 'wild_bear' as SkillId, shiftsTo: 'bear' }] as HeroSkill[],
    wildForm: shifted ? 'bear' : null,
    /**
     * A unit **mid-fight**, not a pristine one, and the second entry is why.
     *
     * A passive whose rank moves a *ceiling* rather than a magnitude grants the
     * identical thing on its first trigger at every rung — Braced adds its flat
     * two points of defence whether the cap is 8 or 13, and only differs once
     * the stack is deep enough for the cap to bind. Probing an untouched unit
     * therefore reported it as flat, which is the opposite of true: the rung
     * buys the whole top of the ladder.
     *
     * Nine is chosen to sit *between* the rank-1 and rank-3 ceilings, so the
     * next application is capped at one rung and not at the other. Nothing else
     * in the roster reads `DefenseBuff`, so this costs the other passives
     * nothing.
     */
    activeEffects: [
      { type: AuraType.Stealth, magnitude: 1, duration: 3 },
      { type: AuraType.DefenseBuff, magnitude: 9, duration: -1 },
    ],
    passives: [id],
    passiveRanks: { [id]: rank },
  });
}

/** Somebody held by `self`'s taunt, which is what Braced and Vengeance ask about. */
const taunted = (self: CombatUnit): CombatUnit =>
  makeUnit({
    id: 'held',
    isPlayer: false,
    currentHp: 50,
    activeEffects: [
      { type: AfflictionType.Taunt, magnitude: 1, duration: 3, sourceUnitId: self.id },
    ],
  });

/**
 * Rolls the chance-based passives are measured across.
 *
 * Chosen to straddle every rank-1/rank-3 threshold pair the trees produce:
 * Thunderhead spans 0.1875–0.3125, Shatterstep 0.2625–0.4375 and Vengeance
 * 0.5–1.0.
 */
const ROLLS = [0.05, 0.22, 0.28, 0.3, 0.4, 0.44, 0.6, 0.8, 0.95];

/**
 * Passives whose entire payload is one extra action.
 *
 * See the exemption test below — they are allowed to be flat across ranks
 * because a turn has no fraction, not because scaling them was forgotten.
 */
const FREE_TURN_PASSIVES = new Set<PassiveId>(['frenzy']);

/** The target Shatterstep is charged against, and the `other` every onHeal/onHit wants. */
const frozenFoe = (): CombatUnit =>
  makeUnit({
    id: 'foe',
    isPlayer: false,
    currentHp: 50,
    activeEffects: [{ type: AfflictionType.Freeze, magnitude: 1, duration: 2 }],
  });

describe('the level scale', () => {
  it('is a discount, the authored value, then a premium', () => {
    expect(LEVEL_SCALE).toEqual([0.75, 1, 1.25]);
    expect(NODE_MAX_LEVEL).toBe(LEVEL_SCALE.length);
  });

  /**
   * The load-bearing one. Level 2 is the rung the data files are written at, so
   * a node bought to level 2 grants exactly what its `statBonus` says — no
   * rounding, no drift. Swept over every node in the game rather than asserted
   * on one, because "the authored number is level 2" is a property of the whole
   * table and a single fixture would pass through any number of retunes.
   */
  it('gives back exactly the authored number at level 2', () => {
    const wrong: string[] = [];
    for (const { path, node } of ALL_NODES) {
      if (!node.statBonus || maxLevelOf(node) < 2) continue;
      const got = masteryStatBonus(heroWith(path, node, 2));
      for (const [key, value] of Object.entries(node.statBonus)) {
        if (got[key as keyof typeof got] !== value) {
          wrong.push(`${path.id}/${node.id}.${key}: ${got[key as keyof typeof got]} ≠ ${value}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never scales a node that holds only one level', () => {
    const single = ALL_NODES.filter(({ node }) => maxLevelOf(node) === 1);
    expect(single.map(({ node }) => levelScale(node, 1))).toEqual(single.map(() => 1));
  });

  it('is worth nothing at level zero, which is what unowned means', () => {
    const [{ node }] = ALL_NODES;
    expect(levelScale(node, 0)).toBe(0);
  });
});

describe('what a level costs', () => {
  it('charges the node cost per level, not per node', () => {
    for (const { path, node } of ALL_NODES.slice(0, 40)) {
      const levels = maxLevelOf(node);
      expect(pointsSpent(heroWith(path, node, levels))).toBe(node.cost * levels);
    }
  });

  it('offers the next level of an owned node and refuses the one past the last', () => {
    const offers: string[] = [];
    for (const { path, node } of ALL_NODES) {
      // Tier 1 only: anything deeper is refused for a prerequisite it has not
      // bought, which is a different rule and has its own tests.
      if (node.tier !== 1 || node.requires) continue;
      const max = maxLevelOf(node);
      if (max > 1 && !canUnlockNode(heroWith(path, node, 1), node.id).ok) {
        offers.push(`${path.id}/${node.id}: no second level`);
      }
      const full = canUnlockNode(heroWith(path, node, max), node.id);
      if (full.ok || full.reason !== 'at-max-level') {
        offers.push(`${path.id}/${node.id}: buyable past level ${max}`);
      }
    }
    expect(offers).toEqual([]);
  });

  it('reads a zero as unowned rather than as a node held at nothing', () => {
    const h = hero({ masteryPath: 'bulwark', masteryNodes: { bulwark_loud: 0 } });
    expect(ownsNode(h, 'bulwark_loud')).toBe(false);
    expect(nodeLevel(h, 'bulwark_loud')).toBe(0);
    expect(unlockedNodes(h)).toEqual([]);
    expect(pointsSpent(h)).toBe(0);
  });
});

/**
 * Modifiers counted in whole hexes or whole turns cannot be scaled — 0.75 of a
 * hex of range is either nothing or all of it depending on where it rounds, and
 * both answers are wrong. The nodes carrying them are `maxLevel: 1` in the
 * shipped trees, but the guard is in `masteryModifiers` and this pins the guard
 * rather than the authoring, because the authoring is what a retune moves.
 */
describe('integer modifiers', () => {
  const INTEGER_KEYS = ['skillRangeBonus', 'aoeRadiusBonus', 'tauntDurationBonus'] as const;

  it('hold their authored value at every level', () => {
    const drifted: string[] = [];
    for (const { path, node } of ALL_NODES) {
      if (!node.modifier) continue;
      for (const key of INTEGER_KEYS) {
        const authored = node.modifier[key];
        if (authored === undefined) continue;
        for (let level = 1; level <= NODE_MAX_LEVEL; level++) {
          const got = masteryModifiers(heroWith(path, node, level))[key];
          if (got !== authored) drifted.push(`${path.id}/${node.id}.${key}@${level}: ${got}`);
        }
      }
    }
    expect(drifted).toEqual([]);
  });

  it('covers every whole-unit key the trees actually grant', () => {
    // Vacuity guard: if the trees stop granting these the test above passes by
    // finding nothing, and the guard would rot unnoticed.
    const granted = new Set<string>();
    for (const { node } of ALL_NODES) {
      for (const key of INTEGER_KEYS) if (node.modifier?.[key] !== undefined) granted.add(key);
    }
    expect([...granted].sort()).toEqual([...INTEGER_KEYS].sort());
  });
});

describe('a skill granted by a node', () => {
  const nodeGranting = (id: string) => {
    const found = ALL_NODES.find(({ node }) => node.grantsSkill === id)!;
    return found;
  };

  it('scales its output with the level of the node that granted it', () => {
    const { path, node } = nodeGranting('judgement');
    const at = (level: number) =>
      deriveHeroSkills(heroWith(path, node, level), []).find((s) => s.id === 'judgement')!;

    const base = at(2);
    expect(at(1).damage!).toBeCloseTo(base.damage! * LEVEL_SCALE[0]);
    expect(at(3).damage!).toBeCloseTo(base.damage! * LEVEL_SCALE[2]);
  });

  /**
   * Output only. A level-1 Meteor is a weaker Meteor — it is not a Meteor that
   * also reaches less far, covers less ground and costs the same, which would
   * read as a different and worse spell rather than as an unfinished one.
   */
  it('leaves reach and cooldown alone while upgrades reduce mana cost', () => {
    const { path, node } = nodeGranting('meteor');
    const at = (level: number) =>
      deriveHeroSkills(heroWith(path, node, level), []).find((s) => s.id === 'meteor')!;

    for (const level of [1, 3]) {
      expect(at(level).range).toBe(at(2).range);
      expect(at(level).aoeRadius).toBe(at(2).aoeRadius);
      expect(at(level).cooldown).toBe(at(2).cooldown);
      expect(at(level).manaCost).toBe(level === 1
        ? Math.round(at(2).manaCost * 1.1) : Math.round(at(2).manaCost * 0.9));
    }
  });

  /**
   * A path's signature is handed over on choosing it, not bought, so it has no
   * level to be scaled by — and reading one off an unowned node would give it
   * `levelScale(…, 0)` and hand every hero a signature that does nothing.
   */
  it('hands every path signature over unscaled', () => {
    const scaled: string[] = [];
    for (const path of MASTERY_PATHS) {
      if (!path.signatureSkill) continue;
      const granted = deriveHeroSkills(
        hero({ heroClass: path.heroClass, masteryPath: path.id, masteryNodes: {} }),
        [],
      ).find((s) => s.id === path.signatureSkill);
      // Compared against the skill as authored, so a retune moves both together
      // and only a *scaling* of the signature fails here.
      const authored = findSkill(path.signatureSkill)!;
      if (!granted) scaled.push(`${path.id}: no signature granted`);
      else if (granted.damage !== authored.damage || granted.healing !== authored.healing) {
        scaled.push(`${path.id}: signature arrived scaled`);
      }
    }
    expect(scaled).toEqual([]);
  });
});

/**
 * A passive granted by a rankable node has to *do* something different at each
 * rank — and this is the suite that exists because for a whole version it did
 * not.
 *
 * `masteryPassiveScales` was written, documented and never called from
 * anywhere: `createPlayerUnits` handed `passives` over as a bare id list, so
 * twenty-two nodes across all twelve paths took a point per level and granted
 * nothing beyond the first. Every one of them looked correct in the tree, in the
 * save and in the code that computed the scale nobody read.
 *
 * So the assertion is deliberately behavioural rather than structural: it does
 * not check that a resolver *mentions* the rank, it checks that the numbers
 * coming out of rank 1 and rank 3 differ. A resolver that takes the rank and
 * forgets to multiply by it passes every type check and fails here.
 */
describe('a passive granted by a node', () => {
  /** Every passive a multi-level node grants, with the node that grants it. */
  const RANKED_PASSIVES = ALL_NODES.filter(
    ({ node }) => node.grantsPassive && maxLevelOf(node) > 1,
  );

  it('is granted by nodes that actually hold ranks', () => {
    // Guards the guard: if the trees were ever re-authored so that every
    // passive node became `maxLevel: 1`, everything below would pass vacuously.
    expect(RANKED_PASSIVES.length).toBeGreaterThan(15);
  });

  it('reaches the unit that bought it, at the rank it was bought to', () => {
    const missing: string[] = [];
    for (const { path, node } of RANKED_PASSIVES) {
      const ranks = masteryPassiveRanks(heroWith(path, node, 3));
      const rank = ranks[node.grantsPassive!];
      if (!rank) missing.push(`${path.id}/${node.id}: no rank reported`);
      else if (rank.level !== 3) missing.push(`${path.id}/${node.id}: level ${rank.level}`);
      else if (rank.scale !== LEVEL_SCALE[2]) {
        missing.push(`${path.id}/${node.id}: scale ${rank.scale}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * The behavioural half. Each passive is resolved through its own real
   * definition at rank 1 and rank 3 against an identical unit, and the two are
   * required to differ somewhere.
   *
   * Resolved through `PASSIVE_DEFS` rather than a table of expected numbers
   * here, for the reason `lairBosses.test.ts` gives about the same file: a
   * second copy of a magnitude is the thing that drifts, and a rule is only
   * worth having if it tracks the passive it is about. What the numbers *are* is
   * the tuning pass's business; that they move is this suite's.
   */
  it('grants measurably more at rank 3 than at rank 1', () => {
    const flat: string[] = [];

    for (const { path, node } of RANKED_PASSIVES) {
      const id = node.grantsPassive!;
      if (FREE_TURN_PASSIVES.has(id)) continue;

      const def = PASSIVE_DEFS[id];
      if (!def) {
        flat.push(`${path.id}/${node.id}: ${id} is not a passive`);
        continue;
      }

      const outcomeAt = (level: number, roll: number) => {
        const rank = { level, scale: LEVEL_SCALE[level - 1] };
        const self = probeUnit(id, rank);
        const ctx = {
          self,
          allUnits: [self, taunted(self)],
          other: frozenFoe(),
          amount: 100,
          hpBefore: 100,
          crit: true,
          // A heal that restored something and a cleanse that removed something,
          // so Oath's resolver has a reason to fire at both ranks.
          restored: 100,
          cleansed: 1,
          movedLastTurn: false,
          rng: () => roll,
        };
        return JSON.stringify([
          def.resolved?.(rank) ?? null,
          def.resolve?.(ctx, rank) ?? null,
          def.statMod?.(self, rank) ?? null,
          def.onLethalSave?.(ctx, rank) ?? null,
        ]);
      };

      // Swept rather than pinned, because three of these buy *reliability*
      // rather than size — Shatterstep, Thunderhead and Vengeance move a
      // threshold a roll is compared against, so a single pinned roll reports
      // them as flat whenever it falls the same side of both ranks. What is
      // being asserted is that a roll exists which rank 3 wins and rank 1 does
      // not, which is exactly what "the rank did something" means for a chance.
      if (!ROLLS.some((roll) => outcomeAt(1, roll) !== outcomeAt(3, roll))) {
        flat.push(`${path.id}/${node.id} (${id})`);
      }
    }

    expect(flat).toEqual([]);
  });

  /**
   * The exemption is a rule, not a list of names that grew.
   *
   * A free turn has no fraction — `extraAction` carries no magnitude, and
   * "0.75 of an extra action" is not a thing the turn order can express. So a
   * passive whose whole payload is one is allowed to be flat, on one condition:
   * the node granting it must grant something else that *does* scale, or the
   * player is buying ranks that do nothing. Frenzy takes the other way out and
   * is authored `maxLevel: 1`, which is why it never reaches this sweep.
   */
  it('only exempts a free turn when its node scales something else', () => {
    const wasted: string[] = [];
    for (const { path, node } of RANKED_PASSIVES) {
      if (!FREE_TURN_PASSIVES.has(node.grantsPassive!)) continue;
      if (!node.grantsSkill && !node.statBonus && !node.modifier) {
        wasted.push(`${path.id}/${node.id}: ranks buy nothing`);
      }
    }
    expect(wasted).toEqual([]);
  });
});
