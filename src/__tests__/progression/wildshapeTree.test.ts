import { skillName } from '@/data/gameText';
import { masteryText } from '@/__tests__/support/masteryNodeText';
import { MASTERY_PATHS, findMasteryPath } from '@/data/skills/masteryData';
import { WILD_FORMS, WILD_FORM_IDS } from '@/data/templates/wildForms';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { BALANCE } from '@/data/balanceConstants';
import { skillDisplayName, skillEffectLines } from '@/data/display/skillDisplay';
import { skillsForForm } from '@/systems/combat/wildshape';
import {
  canUnlockNode,
  deriveHeroSkills,
  exclusionFor,
  findSkill,
  mainTreeNodes,
  missingPrerequisites,
  pointsEarnedByLevel,
  prerequisitesFor,
  requiredPrerequisiteCount,
} from '@/systems/progression/mastery';
import {
  CombatUnit,
  Hero,
  HeroSkill,
  HeroStats,
  MasteryNode,
  SkillId,
  WildFormId,
} from '@/models/types';
import { makeUnit } from '../support/fixtures';
import { humanFormName } from '@/data/templates/unitText';

/**
 * Wildshape as a *tree*, which is the half that broke the mould.
 *
 * `wildshape.test.ts` covers shifting — stats, models, which kit a shape wears.
 * This file covers the rules the restructure had to add to the mastery engine to
 * make that tree expressible at all: explicit prerequisites, "any two of these",
 * permanent exclusivity, a path that pays in a point instead of a signature, and
 * skills that live on the hero sheet but only reach the bar with the right paws.
 *
 * Every one of those is a general mechanism used by exactly one path today. That
 * is a deliberate trade — the alternative was a parallel tree implementation —
 * and it means these tests are the only thing standing between the mechanisms
 * and quietly rotting.
 */

const path = findMasteryPath('wildshape')!;
const nodeById = (id: string) => path.nodes.find((n) => n.id === id)!;
/**
 * The three shapes, by their exclusive tag rather than by tier.
 *
 * Tier 1 is five nodes now — the three shapes plus two shape-agnostic talents —
 * and the two side-tree starters draw on that row as well. The tag is what
 * actually means "this is one of the animals".
 */
const shapes = path.nodes.filter((n) => n.exclusiveGroup === 'shape');
const capstones = path.nodes.filter((n) => n.exclusiveGroup === 'capstone');
const apex = path.nodes.find((n) => n.id === 'wild_apex')!;

const skillById = new Map<SkillId, HeroSkill>(
  [...ALL_SKILLS, ...MASTERY_SKILLS].map((s) => [s.id, s]),
);

const STATS: HeroStats = {
  maxHp: 100, attack: 20, defense: 10, magic: 16, speed: 12, moveRange: 3, maxMana: 40,
};

function hero(over: Partial<Hero> = {}): Hero {
  return {
    id: 'h1',
    name: 'Druid',
    templateId: 'healer',
    heroClass: 'healer',
    level: 20,
    xp: 0,
    baseStats: { ...STATS },
    currentHp: 100,
    currentMana: 40,
    skills: [],
    equipment: {},
    masteryPath: 'wildshape',
    masteryPoints: BALANCE.MASTERY_POINTS_AT_CAP,
    masteryNodes: {},
    ...over,
  } as Hero;
}

/**
 * Node ids as the id-to-level map a hero carries, one level each.
 *
 * One level is the right rung for this suite: every case here is about
 * structure — which shape closes which, what feeds Apex, which skills reach the
 * bar — and none of it reads a magnitude.
 */
const own = (...ids: string[]): Record<string, number> =>
  Object.fromEntries(ids.map((id) => [id, 1]));

// ─── The shape choice ─────────────────────────────────────────────────────────

describe('choosing a shape', () => {
  it('opens all three at once, with nothing above them', () => {
    for (const shape of shapes) {
      expect(prerequisitesFor(path, shape)).toEqual([]);
      expect(canUnlockNode(hero(), shape.id).ok).toBe(true);
    }
  });

  /**
   * The point the path grants is exactly the price of a shape.
   *
   * Not a convenience: it is what makes "no signature" honest. A Druid arriving
   * at level 5 with zero points would spend their first level as a caster who
   * chose the shapeshifting path and cannot shapeshift.
   */
  it('pays for the first shape out of the path grant alone', () => {
    const fresh = hero({ level: 5, masteryPoints: pointsEarnedByLevel(5, 'wildshape') });
    expect(fresh.masteryPoints).toBe(1);
    expect(canUnlockNode(fresh, shapes[0].id).ok).toBe(true);
  });

  it('adds the grant to a path that has one and nothing to a path that does not', () => {
    expect(pointsEarnedByLevel(20, 'wildshape')).toBe(BALANCE.MASTERY_POINTS_AT_CAP + 1);
    expect(pointsEarnedByLevel(20, 'berserker')).toBe(BALANCE.MASTERY_POINTS_AT_CAP);
    expect(pointsEarnedByLevel(20)).toBe(BALANCE.MASTERY_POINTS_AT_CAP);
  });

  /**
   * The grant is flat, which is what keeps it from being paid twice.
   *
   * `gainXp` hands out `earned(new) − earned(old)` every level-up. If that delta
   * read the path, a Druid would be handed another free point on every single
   * level after choosing.
   */
  it('cancels out of the level-to-level delta', () => {
    for (let level = 6; level <= BALANCE.MAX_LEVEL; level++) {
      const delta =
        pointsEarnedByLevel(level, 'wildshape') - pointsEarnedByLevel(level - 1, 'wildshape');
      expect(delta).toBe(pointsEarnedByLevel(level) - pointsEarnedByLevel(level - 1));
    }
  });

  it('closes the other two shapes the moment one is taken', () => {
    const bear = shapes.find((n) => n.id === 'wild_bear')!;
    const bought = hero({ masteryNodes: own(bear.id) });

    for (const other of shapes.filter((n) => n.id !== bear.id)) {
      const check = canUnlockNode(bought, other.id);
      expect(check.ok).toBe(false);
      expect(check.reason).toBe('excluded');
      expect(check.blockedBy?.id).toBe(bear.id);
    }
  });

  // Exclusivity is a tag, not a list of ids on each node, precisely so it cannot
  // be declared on one side and forgotten on the other
  it('is symmetric however the shapes are ordered', () => {
    for (const taken of shapes) {
      const owned = new Set([taken.id]);
      for (const other of shapes.filter((n) => n.id !== taken.id)) {
        expect(exclusionFor(path, other, owned)?.id).toBe(taken.id);
      }
      // And never rules out the one you actually took
      expect(exclusionFor(path, taken, owned)).toBeUndefined();
    }
  });

  /**
   * The two shape-agnostic talents are still *about* a shape.
   *
   * "More of you to get through, in every shape you wear" and "quicker to the
   * throat" are both statements about being an animal, and both sat at tier 1
   * with no prerequisite at all — so a Druid could take the shapeshifting path,
   * spend their first two points on +30 health and +5 attack, and own no shape
   * to wear them in. That is not a build, it is the path's stat nodes bought
   * with the path switched off.
   *
   * Gated through the mechanism `wild_apex` already uses rather than a new one:
   * all three shapes at `requiresCount: 1`, which the tree screen renders as a
   * stub and a sentence. Naming one shape would parent them to it, which is the
   * opposite of what they are for.
   */
  describe('the shape-agnostic talents still need a shape', () => {
    const talents = ['wild_bulk', 'wild_savagery'];

    it('refuses both to a Druid who has not chosen an animal', () => {
      const shapeless = hero();
      const allowed = talents.filter((id) => canUnlockNode(shapeless, id).ok);
      expect(allowed).toEqual([]);
      for (const id of talents) {
        expect(canUnlockNode(shapeless, id).reason).toBe('missing-prerequisite');
      }
    });

    it('opens both on whichever animal was taken', () => {
      const refused: string[] = [];
      for (const shape of shapes) {
        const shaped = hero({ masteryNodes: own(shape.id) });
        for (const id of talents) {
          if (!canUnlockNode(shaped, id).ok) refused.push(`${shape.id} → ${id}`);
        }
      }
      expect(refused).toEqual([]);
    });

    // Any one of them, not a particular one — a talent parented to Bear Form
    // would be a bear node wearing a shape-agnostic description
    it('asks for any shape rather than a named one', () => {
      for (const id of talents) {
        const node = nodeById(id);
        expect(requiredPrerequisiteCount(path, node)).toBe(1);
        expect(prerequisitesFor(path, node).map((n) => n.id).sort()).toEqual(
          shapes.map((n) => n.id).sort(),
        );
        expect(masteryText('node', node, 'requiresLabel')).toBeTruthy();
      }
    });
  });

  it('never rules out a branch node or the capstone', () => {
    const owned = new Set(shapes.map((n) => n.id));
    const wrong = path.nodes
      .filter((n) => n.tier !== 1 && exclusionFor(path, n, owned))
      .map((n) => n.id);
    expect(wrong).toEqual([]);
  });
});

// ─── Branches ─────────────────────────────────────────────────────────────────

describe('a shape opens its own branch and no other', () => {
  const branches: [string, MasteryNode[]][] = shapes.map((s) => [
    s.id,
    path.nodes.filter((n) => n.requires?.length === 1 && n.requires[0] === s.id),
  ]);

  it('gates every branch node on its own shape alone', () => {
    for (const [shapeId, branch] of branches) {
      for (const node of branch) {
        expect(prerequisitesFor(path, node).map((p) => p.id)).toEqual([shapeId]);
      }
    }
  });

  it('refuses a branch node to a Druid who took a different animal', () => {
    const bear = hero({ masteryNodes: own('wild_bear') });
    const wolfNode = nodeById('wild_wolf_throat');
    const check = canUnlockNode(bear, wolfNode.id);
    expect(check.ok).toBe(false);
    // Missing its prerequisite, not "excluded": Wolf Form is what it wants, and
    // the fact that Wolf Form is itself closed off is a separate sentence
    expect(check.reason).toBe('missing-prerequisite');
    expect(check.missing?.map((n) => n.id)).toEqual(['wild_wolf']);
  });

  /**
   * Four learnable skills per shape, and nothing else.
   *
   * It used to be two skills and two stat talents. Two learnable buttons on top
   * of the shape's two innate ones left every animal with a kit that was
   * entirely on cooldown every second turn — the same complaint the Hawk's
   * at-will was added to answer, one shape at a time. The talents did not go
   * away, they moved: `wild_bulk` and `wild_savagery` are shape-agnostic tier-1
   * nodes now, so they are worth the same whichever animal you took.
   */
  it('gives every shape four skills of its own and no stat talents', () => {
    for (const [shapeId, branch] of branches) {
      const skills = branch.filter((n) => n.grantsSkill);
      const talents = branch.filter((n) => !n.grantsSkill);
      expect([shapeId, skills.length, talents.length]).toEqual([shapeId, 4, 0]);
      // The two skills a shape can learn belong to that shape and no other
      for (const node of skills) {
        expect(skillById.get(node.grantsSkill!)!.formSkill).toBe(shapeFor(shapeId));
      }
    }
  });

  const shapeFor = (nodeId: string): WildFormId =>
    skillById.get(nodeById(nodeId).grantsSkill!)!.shiftsTo!;
});

// ─── Apex ─────────────────────────────────────────────────────────────────────

describe('apex', () => {
  /**
   * All four of one shape, said without naming which four.
   *
   * It asked for *two* until the v3 rework, which opened tier 3 at four points
   * — two levels earlier than any other path. Four is what puts a Druid on the
   * same six-point gate as everyone else, and it says something the old number
   * did not: the price of an ending is having finished your animal.
   */
  it('asks for a whole shape rather than any particular animal', () => {
    for (const capstone of capstones) {
      expect(requiredPrerequisiteCount(path, capstone)).toBe(4);
      expect(prerequisitesFor(path, capstone).length).toBeGreaterThan(4);
    }
  });

  it('opens on the last branch node of whichever shape was taken', () => {
    for (const shape of shapes) {
      const branch = path.nodes.filter((n) => n.requires?.[0] === shape.id);
      const short = hero({ masteryNodes: own(shape.id, ...branch.slice(0, -1).map((n) => n.id)) });
      const whole = hero({ masteryNodes: own(shape.id, ...branch.map((n) => n.id)) });

      expect(missingPrerequisites(path, apex, new Set(Object.keys(short.masteryNodes))).length)
        .toBeGreaterThan(0);
      expect(missingPrerequisites(path, apex, new Set(Object.keys(whole.masteryNodes)))).toEqual([]);
    }
  });

  /**
   * The other ten are not "missing" — they are simply not the two that were
   * taken. If they read as missing, the screen would tell a bear to go and buy
   * four hawk nodes it can never own.
   */
  it('reports nothing missing once a whole shape is held', () => {
    const owned = new Set([
      'wild_bear', 'wild_bear_slam', 'wild_bear_hibernate',
      'wild_bear_leap', 'wild_bear_shrug',
    ]);
    expect(missingPrerequisites(path, apex, owned)).toEqual([]);
  });

  it('carries the only kit in the game with three innate skills', () => {
    const threes = WILD_FORM_IDS.filter((f) => WILD_FORMS[f].skills.length === 3);
    expect(threes).toEqual(['apex']);
  });
});

// ─── Every shape can act ──────────────────────────────────────────────────────

describe('every shape has something to press', () => {
  /**
   * The complaint that started this: a Hawk holding only Dive and Screech spent
   * every second turn flying in circles. A shape's first skill is therefore free
   * *and* off cooldown, always — an at-will is not a nicety in a game where the
   * alternative is forfeiting the turn.
   */
  it('opens every kit with a free, cooldown-less attack', () => {
    const offenders: string[] = [];
    for (const form of WILD_FORM_IDS) {
      const basic = findSkill(WILD_FORMS[form].skills[0])!;
      if (basic.manaCost !== 0) offenders.push(`${form}: basic costs ${basic.manaCost} mana`);
      if (basic.cooldown) offenders.push(`${form}: basic has a ${basic.cooldown}t cooldown`);
      if (!basic.damage) offenders.push(`${form}: basic deals no damage`);
    }
    expect(offenders).toEqual([]);
  });

  it('charges no mana for anything worn as a beast', () => {
    const paying = MASTERY_SKILLS.filter((s) => s.formSkill && s.manaCost > 0).map((s) => s.id);
    expect(paying).toEqual([]);
  });

  // The mana is paid at the shift instead, which is the whole reason form skills
  // can be free — and a shift nobody can afford at level 5 is a path that opens
  // with a button it cannot press
  it('prices every shift inside a fresh Druid’s mana pool', () => {
    const tooDear = shapes
      .map((n) => findSkill(n.grantsSkill!)!)
      .filter((s) => s.manaCost > STATS.maxMana)
      .map((s) => s.id);
    expect(tooDear).toEqual([]);
  });
});

// ─── Form skills reach the bar only in their shape ────────────────────────────

describe('form skills need the right paws', () => {
  const learned = (ids: SkillId[]) => ids.map((id) => skillById.get(id)!);

  it('keeps a learned bear skill off the upright kit', () => {
    const human = learned(['bear_form', 'bear_slam', 'heal']);
    const upright = skillsForForm(null, human, undefined).map((s) => s.id);
    expect(upright).toEqual(['bear_form', 'heal']);
  });

  it('hands it over the moment the shape is worn', () => {
    const human = learned(['bear_form', 'bear_slam', 'heal']);
    const asBear = skillsForForm('bear', human, undefined).map((s) => s.id);
    // Innate pair, then what the tree taught, then the shifts that survive
    expect(asBear).toEqual(['maul', 'roar', 'bear_slam', 'bear_form']);
  });

  it('does not leak one shape’s lessons into another', () => {
    const human = learned(['bear_form', 'wolf_form', 'bear_slam', 'throat_tear']);
    expect(skillsForForm('wolf', human, undefined).map((s) => s.id)).toEqual([
      'rip', 'pounce', 'throat_tear', 'bear_form', 'wolf_form',
    ]);
  });

  it('never lists an innate skill twice', () => {
    // `maul` is Bear's innate basic; a hero holding it as a granted skill too
    // must not see two Maul buttons
    const human = learned(['bear_form', 'maul']);
    const ids = skillsForForm('bear', human, undefined).map((s) => s.id);
    expect(ids.filter((id) => id === 'maul')).toHaveLength(1);
  });

  it('leaves a kit with no form skills at all untouched', () => {
    const human = learned(['heal', 'slash']);
    // Identity, not just equality — this is every non-Druid in the game, on
    // every combat unit build
    expect(skillsForForm(null, human, undefined)).toBe(human);
  });

  it('marks every beast skill with the shape it belongs to', () => {
    const innate = WILD_FORM_IDS.flatMap((f) =>
      WILD_FORMS[f].skills.map((id) => [id, f] as const),
    );
    const wrong = innate
      .filter(([id, form]) => skillById.get(id)!.formSkill !== form)
      .map(([id]) => id);
    expect(wrong).toEqual([]);
  });

  it('says so on the tooltip, since the sheet shows them regardless', () => {
    const lines = skillEffectLines(skillById.get('bear_slam')!);
    expect(lines).toContain('Only in Bear shape');
  });
});

// ─── Deriving a Druid ─────────────────────────────────────────────────────────

describe('what the tree actually grants', () => {
  it('gives a shapeless Druid no shift skill at all', () => {
    const skills = deriveHeroSkills(hero({ level: 20, masteryNodes: {} }), []);
    expect(skills).toEqual([]);
  });

  it('grants exactly the shape bought, and its branch on top', () => {
    const built = hero({ masteryNodes: own('wild_wolf', 'wild_wolf_howl') });
    const ids = deriveHeroSkills(built, []).map((s) => s.id);
    expect(ids.sort()).toEqual(['blood_howl', 'wolf_form']);
  });
});

// ─── The button says what pressing it does ────────────────────────────────────

describe('a shift button names the shape it takes you to', () => {
  const combatUnit = (wildForm?: WildFormId): CombatUnit =>
    makeUnit({
      id: 'u', name: 'Druid', stats: { ...STATS },
      wildForm,
      formStats: wildForm ? WILD_FORMS[wildForm].stats : undefined,
    });

  const bearForm = skillById.get('bear_form')!;

  it('reads as the beast while upright', () => {
    expect(skillDisplayName(bearForm, combatUnit())).toBe('Bear Form');
  });

  /**
   * The whole point. One button covers both directions of the toggle, so while
   * you *are* the bear it has to say what pressing it does — which is turn you
   * back — rather than name the shape you are already standing in.
   */
  it('reads as the Druid while wearing that shape', () => {
    expect(skillDisplayName(bearForm, combatUnit('bear'))).toBe(humanFormName());
  });

  it('still names the destination when shifting between shapes', () => {
    expect(skillDisplayName(bearForm, combatUnit('wolf'))).toBe('Bear Form');
  });

  it('leaves every other skill alone', () => {
    const unchanged = [...MASTERY_SKILLS, ...ALL_SKILLS]
      .filter((s) => !s.shiftsTo)
      .filter((s) => skillDisplayName(s, combatUnit('bear')) !== skillName(s))
      .map((s) => s.id);
    expect(unchanged).toEqual([]);
  });

  it('falls back to the plain name with no unit to ask', () => {
    expect(skillDisplayName(bearForm)).toBe('Bear Form');
  });
});

// ─── Nothing else moved ───────────────────────────────────────────────────────

describe('the pyramid is untouched', () => {
  /**
   * Every other path's *main tree* still derives its prerequisites from position.
   *
   * The exemptions are named rather than loosened: the three capstones lock each
   * other out, and the two side trees hang off them by an authored `requires`.
   * Anything else in an eleven-path main tree naming its own edges means the
   * pyramid has quietly stopped being one.
   */
  it('leaves every other main tree deriving its prerequisites from position', () => {
    const authored = MASTERY_PATHS.filter((p) => p.id !== 'wildshape')
      .flatMap((p) => mainTreeNodes(p))
      .filter((n) => n.exclusiveGroup !== 'capstone')
      .filter((n) => n.requires || n.requiresCount || n.exclusiveGroup || n.x !== undefined)
      .map((n) => n.id);
    expect(authored).toEqual([]);
  });
});
