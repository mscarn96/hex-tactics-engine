import { bagFrom } from '@/data/items/bag';
import {
  applyMasteryModifiers,
  availableMasteries,
  canChooseMastery,
  canUnlockNode,
  deriveHeroSkills,
  masteryModifiers,
  masteryPassives,
  masteryStatBonus,
  pointsEarnedByLevel,
  pointsSpent,
  unlearnable,
  unlockedNodes,
  maxLevelOf,
} from '@/systems/progression/mastery';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { recruitLevel } from '@/systems/progression/recruiting';
import { calculateStatsForLevel } from '@/systems/progression/leveling';
import { heroMaxHp } from '@/systems/progression/statCalc';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import {
  reflectedDamage,
  skillEffects,
} from '@/systems/combat/statusEffects';
import { resolveEffectMagnitude } from '@/systems/combat/damageCalc';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore, selectGear } from '@/stores/inventoryStore';
import { MASTERY_STARTER_WEAPONS } from '@/data/items/itemTemplates';
import { itemFromTemplateId } from '@/systems/economy/itemFactory';
import { canEquip } from '@/systems/progression/equipRules';
import { MASTERY_PATHS, findMasteryPath } from '@/data/skills/masteryData';
import { MASTERY_GROWTH } from '@/data/skills/masteryGrowth';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { slash, charge, groundSlam, heal } from '@/data/skills/skillData';
import { whirlwind } from '@/data/skills/masterySkills';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';
import { SAVE_VERSION } from '@/systems/save/saveFormat';
import {
  AuraType,
  AfflictionType,
  Hero,
  HeroClass,
  HeroSkill,
  MasteryId,
  SkillTargetType,
} from '@/models/types';

function heroFixture(over: Partial<Hero> = {}): Hero {
  return {
    id: 'h1',
    templateId: 'warrior',
    name: 'Test',
    heroClass: HeroClass.Warrior,
    level: 10,
    xp: 0,
    baseStats: { maxHp: 100, attack: 20, defense: 10, magic: 5, speed: 10, moveRange: 3, maxMana: 20 },
    currentHp: 100,
    currentMana: 20,
    skills: [],
    equipment: {},
    masteryPath: null,
    masteryPoints: 0,
    masteryNodes: {},
    ...over,
  };
}

const hero = heroFixture;

/**
 * Node ids as the id-to-level map a hero carries, all at level 2.
 *
 * **Level 2, not 1** — that is the rung every authored number in a tree is
 * written at, so a fixture asking for a node gets the number the data file
 * says. At level 1 every expectation in this suite would be measuring
 * `LEVEL_SCALE[0]` and the failures would read as balance drift.
 */
const levels = (ids: string[], level = 2): Record<string, number> =>
  Object.fromEntries(ids.map((id) => [id, level]));

const bulwarkHero = (nodes: string[], over: Partial<Hero> = {}) =>
  hero({ masteryPath: 'bulwark', masteryNodes: levels(nodes), ...over });

/** A Druid on the Stoneshaper path — the shield and CC fixtures. */
const stoneHero = (nodes: string[], over: Partial<Hero> = {}) =>
  hero({ masteryPath: 'stoneshaper', heroClass: HeroClass.Healer, masteryNodes: levels(nodes), ...over });

// ─── Point economy ────────────────────────────────────────────────────────────

describe('the point economy', () => {
  it('grants a point per level past the unlock level', () => {
    expect(pointsEarnedByLevel(4)).toBe(0);
    expect(pointsEarnedByLevel(5)).toBe(0);
    expect(pointsEarnedByLevel(6)).toBe(1);
    expect(pointsEarnedByLevel(BALANCE.MAX_LEVEL)).toBe(BALANCE.MASTERY_POINTS_AT_CAP);
  });

  // One more point for each expansion level, levels 21–25 — counted from the
  // level alone, so a point earned at 23 stays earned whatever the cap is now
  it('grants a point per expansion level, and never past the highest cap', () => {
    expect(pointsEarnedByLevel(BALANCE.MAX_LEVEL + 1)).toBe(BALANCE.MASTERY_POINTS_AT_CAP + 1);
    expect(pointsEarnedByLevel(highestLevelCap()))
      .toBe(BALANCE.MASTERY_POINTS_AT_CAP + BALANCE.EXPANSION_LEVELS * BALANCE.MAX_WORLD_CROSSINGS);
    expect(pointsEarnedByLevel(999)).toBe(pointsEarnedByLevel(highestLevelCap()));
  });

  // Every *level* is its own point, which is what makes a node a rank rather
  // than a switch — the same three nodes cost three times as much fully raised.
  it('counts spent points off the levels actually owned', () => {
    const cost = (n: Record<string, number>) => pointsSpent(hero({ masteryPath: 'bulwark', masteryNodes: n }));
    expect(cost({})).toBe(0);
    expect(cost({ bulwark_spite: 1 })).toBe(1);
    expect(cost({ bulwark_spite: 3 })).toBe(3);
    expect(cost({ bulwark_due: 2, bulwark_spite: 1 })).toBe(3);
  });

  // A node deleted from a tree must not keep charging a save that owned it
  it('ignores node ids that no longer exist', () => {
    expect(unlockedNodes(bulwarkHero(['bulwark_spite', 'deleted_node']))).toHaveLength(1);
    expect(pointsSpent(bulwarkHero(['deleted_node']))).toBe(0);
  });

  // The barracks filtered on `masteryNodes.length`, which is `undefined` on a
  // record, so the unlearn list was empty for every hero that ever lived
  it('offers the barracks everyone with a point spent, and nobody else', () => {
    const spent = bulwarkHero(['bulwark_due', 'bulwark_spite']);
    const bare = bulwarkHero([]);
    const pathless = hero({ masteryPath: null, masteryNodes: { bulwark_spite: 1 } });
    const offers = unlearnable([spent, bare, pathless]);
    expect(offers.map((o) => [o.hero, o.spent])).toEqual([[spent, pointsSpent(spent)]]);
    expect(offers[0].spent).toBeGreaterThan(0);
  });
});

// ─── Choosing a path ──────────────────────────────────────────────────────────

describe('choosing a path', () => {
  it('opens only at the unlock level', () => {
    expect(canChooseMastery(hero({ level: 4 }))).toBe(false);
    expect(canChooseMastery(hero({ level: 5 }))).toBe(true);
  });

  it('closes once a path is chosen', () => {
    expect(canChooseMastery(hero({ level: 10, masteryPath: 'bulwark' }))).toBe(false);
  });

  it('offers only the hero’s own class', () => {
    expect(availableMasteries(hero()).sort()).toEqual(['berserker', 'bulwark', 'templar']);
    expect(availableMasteries(hero({ heroClass: HeroClass.Mage })).sort()).toEqual([
      'hydromancer', 'pyromancer', 'stormcaller',
    ]);
  });
});

// ─── Unlocking nodes ──────────────────────────────────────────────────────────

describe('unlocking nodes', () => {
  it('refuses everything without a path', () => {
    expect(canUnlockNode(hero(), 'bulwark_spite')).toMatchObject({ ok: false, reason: 'no-path' });
  });

  it('allows an affordable tier-1 node', () => {
    expect(canUnlockNode(bulwarkHero([], { masteryPoints: 1 }), 'bulwark_spite').ok).toBe(true);
  });

  // "4 more points in this path" and "you cannot afford this" are the two
  // failures a player hits constantly, and they need different words
  it('distinguishes a gate from an empty wallet', () => {
    // All the points in the world do not buy a capstone whose parents are unowned
    const gated = canUnlockNode(bulwarkHero([], { masteryPoints: 99 }), 'bulwark_vow');
    expect(gated).toMatchObject({ ok: false, reason: 'missing-prerequisite' });
    expect(gated.missing?.length).toBe(2);

    const broke = canUnlockNode(bulwarkHero([], { masteryPoints: 0 }), 'bulwark_spite');
    expect(broke).toMatchObject({ ok: false, reason: 'not-enough-points', shortfall: 1 });
  });

  // Owning a node is no longer a refusal — it is an offer of the next level.
  // Only having all of them closes it, and a node from another tree is still
  // simply not a node this hero has.
  it('offers the next level of an owned node, and refuses one from another tree', () => {
    const h = bulwarkHero(['bulwark_spite'], { masteryPoints: 9 });
    expect(canUnlockNode(h, 'bulwark_spite')).toMatchObject({ ok: true });
    expect(canUnlockNode(h, 'berserker_wrath')).toMatchObject({ reason: 'unknown-node' });
  });

  it('refuses a node already at its last level', () => {
    const node = findMasteryPath('bulwark')!.nodes.find((n) => n.id === 'bulwark_spite')!;
    const full = hero({
      masteryPath: 'bulwark',
      masteryPoints: 9,
      masteryNodes: { bulwark_spite: maxLevelOf(node) },
    });
    expect(canUnlockNode(full, 'bulwark_spite')).toMatchObject({ reason: 'at-max-level' });
  });

  // Challenge sits at tier 2 column 1, so it is fed by tier 1 columns 1 and 2
  it('opens a node once both of its parents are owned', () => {
    const half = bulwarkHero(['bulwark_due'], { masteryPoints: 9 });
    expect(canUnlockNode(half, 'bulwark_challenge')).toMatchObject({
      ok: false,
      reason: 'missing-prerequisite',
    });

    // One level each, so the point count is about the two nodes rather than
    // about how far either has been raised
    const both = hero({
      masteryPath: 'bulwark',
      masteryPoints: 9,
      masteryNodes: { bulwark_due: 1, bulwark_shielded_challenge: 1 },
    });
    expect(pointsSpent(both)).toBe(2);
    expect(canUnlockNode(both, 'bulwark_challenge').ok).toBe(true);
  });

  // Buying wide does not substitute for buying up: the edge is the gate
  it('is not satisfied by spending points elsewhere in the tier', () => {
    const wrongParents = bulwarkHero(
      ['bulwark_spite', 'bulwark_retaliation', 'bulwark_braced'],
      { masteryPoints: 9 },
    );
    expect(canUnlockNode(wrongParents, 'bulwark_challenge').ok).toBe(false);
  });
});

// ─── Derivation ───────────────────────────────────────────────────────────────

describe('derivation', () => {
  const withTier1 = bulwarkHero(['bulwark_anchored', 'bulwark_retaliation']);

  it('collects stat bonuses off the owned nodes', () => {
    expect(masteryStatBonus(withTier1)).toEqual({ defense: 3, shieldPower: 8 });
    expect(masteryStatBonus(bulwarkHero([]))).toEqual({});
  });

  it('collects passives off the owned nodes', () => {
    expect(masteryPassives(withTier1)).toEqual(['retaliation']);
  });

  it('reports exactly the modifier the owned node grants', () => {
    expect(masteryModifiers(bulwarkHero(['bulwark_loud']))).toEqual({ tauntDurationBonus: 1 });
    // A multiplying key is authored as its bonus: Spite Grows makes Thorns stronger, never weaker
    expect(masteryModifiers(bulwarkHero(['bulwark_spite_grows'])).thornsMultiplier).toBeCloseTo(1.25);
    expect(masteryModifiers(bulwarkHero([]))).toEqual({});
  });

  /**
   * Every modifier a node authors has to survive the merge.
   *
   * `burnMagnitudeBonus` was authored on the Pyromancer, labelled on the
   * mastery screen and never merged — so the node cost a point and did nothing
   * for a whole version, invisibly. The merge is a `Record` over every key now,
   * and this walks the real trees to prove it.
   */
  it('carries every modifier a node grants through the merge', () => {
    const dropped: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const node of path.nodes) {
        if (!node.modifier) continue;
        const owner = hero({
          heroClass: path.heroClass,
          masteryPath: path.id,
          masteryNodes: levels([node.id]),
        });
        const merged = masteryModifiers(owner) as Record<string, number | undefined>;
        for (const [key, value] of Object.entries(node.modifier)) {
          // A multiplying key arrives as the factor its authored bonus makes
          const expected = key === 'thornsMultiplier' ? 1 + (value as number) : value;
          if (merged[key] !== expected) dropped.push(`${path.id}/${node.id}: ${key}`);
        }
      }
    }
    expect(dropped).toEqual([]);
  });

  it('grants the signature skill the moment a path is chosen', () => {
    const skills = deriveHeroSkills(bulwarkHero([]), [slash]);
    expect(skills.map((s) => s.id)).toContain('provoking_strike');
  });

  it('adds node skills on top of the baseline', () => {
    const skills = deriveHeroSkills(bulwarkHero(['bulwark_bellow']), [slash]);
    expect(skills.map((s) => s.id)).toEqual(['slash', 'provoking_strike', 'bellow']);
  });

  // Derived rather than accumulated, so retiring a node retires it everywhere
  it('drops a skill from a node that no longer exists', () => {
    const skills = deriveHeroSkills(bulwarkHero(['deleted_node']), [slash]);
    expect(skills.map((s) => s.id)).toEqual(['slash', 'provoking_strike']);
  });

  it('gives an unchosen hero nothing but its baseline', () => {
    expect(deriveHeroSkills(hero(), [slash, charge]).map((s) => s.id)).toEqual(['slash', 'charge']);
  });

  // From level 5 onward every new skill comes from the tree
  it('stops handing out template skills at the unlock level', () => {
    const late: HeroSkill = { ...whirlwind, unlockLevel: 5 };
    const skills = deriveHeroSkills(hero({ level: 20 }), [slash, late]);
    expect(skills.map((s) => s.id)).toEqual(['slash']);
  });

  it('still hands out low-level template skills', () => {
    const skills = deriveHeroSkills(hero({ level: 20 }), [slash, charge]);
    expect(skills.map((s) => s.id)).toEqual(['slash', 'charge']);
  });

  it('leaves no level-5 template skill stranded', () => {
    // The four old "ultimates" moved into trees rather than being retired
    const orphans = heroTemplates
      .flatMap((t) => t.skills)
      .filter((s) => s.unlockLevel >= BALANCE.MASTERY_UNLOCK_LEVEL)
      .map((s) => s.id);
    const granted = new Set(
      ['bulwark', 'templar', 'berserker', 'pyromancer', 'hydromancer', 'stormcaller',
       'lifewarden', 'stoneshaper', 'wildshape', 'marksman', 'skirmisher', 'shadowblade']
        .flatMap((id) => {
          const path = findMasteryPath(id as MasteryId)!;
          return [path.signatureSkill, ...path.nodes.map((n) => n.grantsSkill)];
        })
    );
    expect(orphans.filter((id) => !granted.has(id))).toEqual([]);
  });
});

// ─── Modifiers on skills ──────────────────────────────────────────────────────

describe('modifiers baked into skills', () => {
  it('leaves a skill untouched when there are no modifiers', () => {
    expect(applyMasteryModifiers(slash, {})).toBe(slash);
  });

  it('extends range without touching melee', () => {
    const ranged: HeroSkill = { ...slash, range: 3 };
    expect(applyMasteryModifiers(ranged, { skillRangeBonus: 1 }).range).toBe(4);
    const selfCast: HeroSkill = { ...slash, range: 0 };
    expect(applyMasteryModifiers(selfCast, { skillRangeBonus: 1 }).range).toBe(0);
  });

  it('extends an area radius', () => {
    const ring: HeroSkill = { ...slash, targetType: SkillTargetType.Ring, aoeRadius: 1 };
    expect(applyMasteryModifiers(ring, { aoeRadiusBonus: 1 }).aoeRadius).toBe(2);
  });

  /**
   * An arc takes both bonuses, each meaning what it means everywhere else.
   *
   * This used to assert the opposite — a radius bonus landed on `range` and a
   * range bonus was refused — because a `Cone`'s extent *was* its range and its
   * `aoeRadius` was dead. That collapsed two different questions ("how far can I
   * aim it" and "how much does it cover") into one number, which is why the
   * exception existed and why it is gone: `Arc` reads depth off `aoeRadius`.
   */
  it('grows an arc by its radius bonus and reaches further by its range bonus', () => {
    const arc: HeroSkill = { ...slash, targetType: SkillTargetType.Arc, range: 2, aoeRadius: 2 };
    expect(applyMasteryModifiers(arc, { aoeRadiusBonus: 1 }).aoeRadius).toBe(3);
    expect(applyMasteryModifiers(arc, { aoeRadiusBonus: 1 }).range).toBe(2);
    expect(applyMasteryModifiers(arc, { skillRangeBonus: 1 }).range).toBe(3);
    expect(applyMasteryModifiers(arc, { skillRangeBonus: 1 }).aoeRadius).toBe(2);
  });

  it('adds lifesteal only to skills that deal damage', () => {
    expect(applyMasteryModifiers(slash, { lifestealBonus: 0.15 }).lifesteal).toBe(0.15);
    expect(applyMasteryModifiers(heal, { lifestealBonus: 0.15 }).lifesteal).toBeUndefined();
  });

  it('stacks lifesteal on a skill that already drains', () => {
    const drain: HeroSkill = { ...slash, lifesteal: 0.3 };
    expect(applyMasteryModifiers(drain, { lifestealBonus: 0.15 }).lifesteal).toBeCloseTo(0.45);
  });

  it('extends taunt duration and nothing else', () => {
    const base = skillEffects(groundSlam)[0];
    const longer = applyMasteryModifiers(groundSlam, { tauntDurationBonus: 1 });
    expect(skillEffects(longer)[0].duration).toBe(base.duration + 1);

    const barrier = { ...groundSlam, appliesEffect: { ...base, type: AuraType.Barrier } };
    expect(
      skillEffects(applyMasteryModifiers(barrier, { tauntDurationBonus: 1 }))[0].duration,
    ).toBe(base.duration);
  });

  // A skill that taunts *and* does something else keeps the something else at
  // its authored duration — the modifier names one status, not the payload.
  it('leaves the other half of a mixed payload alone', () => {
    const mixed: HeroSkill = {
      ...groundSlam,
      appliesEffect: [
        { type: AfflictionType.Taunt, magnitude: 2, duration: 2 },
        { type: AfflictionType.Bleed, magnitude: 0.3, duration: 3 },
      ],
    };
    const out = skillEffects(applyMasteryModifiers(mixed, { tauntDurationBonus: 2 }));
    expect(out.find((e) => e.type === AfflictionType.Taunt)?.duration).toBe(4);
    expect(out.find((e) => e.type === AfflictionType.Bleed)?.duration).toBe(3);
  });

  it('does not mutate the skill it was given', () => {
    const ranged: HeroSkill = { ...slash, range: 3 };
    applyMasteryModifiers(ranged, { skillRangeBonus: 2 });
    expect(ranged.range).toBe(3);
  });
});

// ─── Stat layering ────────────────────────────────────────────────────────────

describe('stat layering', () => {
  /**
   * Base 100, Deep Plates' +30, and the path's own per-level growth.
   *
   * That last term is the one that arrived with per-path levelling: the fixture
   * hero is level 10 and a path is chosen at 5, so the Bulwark has banked five
   * levels of `MASTERY_GROWTH.bulwark` — 5 × 5 HP. Written as the sum rather
   * than as 155 so it stays readable as three separate contributions.
   */
  it('applies mastery bonuses before equipment', () => {
    const h = hero({ masteryPath: 'templar', masteryNodes: levels(['templar_vigil']) });
    const pathHp = MASTERY_GROWTH.templar.maxHp! * (10 - BALANCE.MASTERY_UNLOCK_LEVEL);
    expect(getEffectiveStats(h, []).maxHp).toBe(100 + 20 + pathHp);
  });

  it('folds a crit node onto the baseline rather than replacing it', () => {
    const h = hero({
      heroClass: HeroClass.Warrior,
      masteryPath: 'berserker',
      masteryNodes: levels(['berserker_offhand_fury']),
    });
    expect(getEffectiveStats(h, []).critChance).toBe(BALANCE.BASE_CRIT_CHANCE + 10);
  });

  // Reckless trades defence for attack; a stat below zero inverts damage maths
  it('floors a trade-off node at zero rather than going negative', () => {
    const h = hero({
      masteryPath: 'berserker',
      masteryNodes: levels(['berserker_reckless']),
      baseStats: { ...hero().baseStats, defense: 1 },
    });
    expect(getEffectiveStats(h, []).defense).toBe(0);
  });

  it("leaves an unchosen hero's sheet alone", () => {
    expect(getEffectiveStats(hero(), []).maxHp).toBe(100);
  });
});

// ─── Into combat ──────────────────────────────────────────────────────────────

describe('what reaches the arena', () => {
  it('carries passives onto the combat unit', () => {
    const h = bulwarkHero(['bulwark_retaliation']);
    const [unit] = createPlayerUnits([h], [{ q: 0, r: 0 }]);
    expect(unit.passives).toEqual(['retaliation']);
  });

  it('bakes modifiers into the unit’s skills', () => {
    const h = bulwarkHero(['bulwark_loud'], { skills: [groundSlam] });
    const [unit] = createPlayerUnits([h], [{ q: 0, r: 0 }]);
    // `skills[0]` is the Basic Attack the (empty) main hand makes; the kit follows it
    const slam = unit.skills.find((s) => s.id === groundSlam.id)!;
    expect(skillEffects(slam)[0].duration).toBe(skillEffects(groundSlam)[0].duration + 1);
  });

  // Thorns is often applied *to* a unit by an ally, so "your thorns bite deeper"
  // has to be read off the wearer at reflect time, not baked into the aura.
  // The multiplier is set directly: no path grants one today, and a rule about
  // where a modifier is read should not die with the node that happened to
  // carry it.
  it('applies the thorns multiplier to an aura somebody else cast', () => {
    const [unit] = createPlayerUnits([stoneHero([])], [{ q: 0, r: 0 }]);
    const thorny = {
      ...unit,
      masteryModifiers: { thornsMultiplier: 2 },
      activeEffects: [{ type: AuraType.Thorns, magnitude: 0.25, duration: 3 }],
    };
    expect(reflectedDamage(thorny, 40)).toBe(20);   // 0.25 × 2 × 40
  });

  /**
   * A shield bonus has to reach both authoring styles.
   *
   * Barrier is the one aura authored two ways — a flat pool (Rune Dome's 30) or
   * a fraction of the caster's magic (Stone Ward's 0.9) — so the amplification
   * is applied to the *resolved* number rather than to the authored one.
   */
  it('amplifies a flat barrier and a fractional one alike', () => {
    const [plain] = createPlayerUnits([stoneHero([])], [{ q: 0, r: 0 }]);
    const warded = { ...plain, masteryModifiers: { shieldPowerBonus: 0.25 } };

    const flatBase = resolveEffectMagnitude(AuraType.Barrier, 40, plain, 'magic');
    const flatUp = resolveEffectMagnitude(AuraType.Barrier, 40, warded, 'magic');
    expect(flatBase).toBe(40);
    expect(flatUp).toBe(50);

    const fracBase = resolveEffectMagnitude(AuraType.Barrier, 0.9, plain, 'magic');
    const fracUp = resolveEffectMagnitude(AuraType.Barrier, 0.9, warded, 'magic');
    expect(fracUp).toBe(Math.round(fracBase * 1.25));
    expect(fracUp).toBeGreaterThan(fracBase);
  });

  it('leaves other auras alone', () => {
    const [plain] = createPlayerUnits([stoneHero([])], [{ q: 0, r: 0 }]);
    const warded = { ...plain, masteryModifiers: { shieldPowerBonus: 0.25 } };
    expect(resolveEffectMagnitude(AuraType.DefenseBuff, 8, warded)).toBe(
      resolveEffectMagnitude(AuraType.DefenseBuff, 8, plain),
    );
  });

  it('leaves an unchosen hero with no passives and no modifiers', () => {
    const [unit] = createPlayerUnits([hero()], [{ q: 0, r: 0 }]);
    expect(unit.passives).toEqual([]);
    expect(unit.masteryModifiers).toEqual({});
  });

  /**
   * The wire that was missing, pinned at the seam it was missing from.
   *
   * `masteryPassiveRanks` and every ranked resolver can be individually correct
   * while a combat unit is still built without ranks — which is precisely the
   * state this shipped in for a version, with `createPlayerUnits` handing over
   * `passives` alone. `nodeLevels.test.ts` measures the resolvers against ranks
   * it constructs itself and so cannot see this; only a real unit can.
   */
  it('carries the rank of every passive its tree granted', () => {
    const [unit] = createPlayerUnits(
      [
        hero({
          masteryPath: 'bulwark',
          masteryNodes: { bulwark_retaliation: 3, bulwark_braced: 1 },
        }),
      ],
      [{ q: 0, r: 0 }],
    );
    expect(unit.passives).toEqual(expect.arrayContaining(['retaliation', 'braced']));
    expect(unit.passiveRanks?.retaliation).toEqual({ level: 3, scale: 1.25 });
    expect(unit.passiveRanks?.braced).toEqual({ level: 1, scale: 0.75 });
  });
});

// ─── Store actions ────────────────────────────────────────────────────────────

describe('partyStore', () => {
  const heroNow = () => usePartyStore.getState().heroes[0];

  beforeEach(() => {
    usePartyStore.setState({ heroes: [] });
    usePartyStore.getState().addHero('warrior');
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, level: 10, masteryPoints: 5 })),
    }));
  });

  it('refuses a path from another class', () => {
    expect(usePartyStore.getState().chooseMastery(heroNow().id, 'pyromancer')).toBe(false);
    expect(heroNow().masteryPath).toBeNull();
  });

  it('commits a path and grants the signature immediately', () => {
    expect(usePartyStore.getState().chooseMastery(heroNow().id, 'bulwark')).toBe(true);
    expect(heroNow().masteryPath).toBe('bulwark');
    expect(heroNow().skills.map((s) => s.id)).toContain('provoking_strike');
  });

  // Irreversible by design — the choice is the point
  it('refuses to change a path once chosen', () => {
    usePartyStore.getState().chooseMastery(heroNow().id, 'bulwark');
    expect(usePartyStore.getState().chooseMastery(heroNow().id, 'berserker')).toBe(false);
    expect(heroNow().masteryPath).toBe('bulwark');
  });

  it('back-pays points earned before the path was chosen', () => {
    usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, masteryPoints: 0 })) }));
    usePartyStore.getState().chooseMastery(heroNow().id, 'bulwark');
    expect(heroNow().masteryPoints).toBe(pointsEarnedByLevel(10));
  });

  it('buys a node, spends the points and grants the skill', () => {
    usePartyStore.getState().chooseMastery(heroNow().id, 'bulwark');
    const before = heroNow().masteryPoints;
    expect(usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_spite')).toBe(true);
    expect(heroNow().masteryPoints).toBe(before - 1);
    expect(heroNow().masteryNodes).toEqual({ bulwark_spite: 1 });
  });

  it('refuses a gated node and leaves the points alone', () => {
    usePartyStore.getState().chooseMastery(heroNow().id, 'bulwark');
    const before = heroNow().masteryPoints;
    expect(usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_vow')).toBe(false);
    expect(heroNow().masteryPoints).toBe(before);
    expect(heroNow().masteryNodes).toEqual({});
  });

  // Buying an owned node again raises it. The refusal moved to the last level,
  // which is the only place ownership still closes anything off.
  it('raises an owned node rather than refusing it, up to its last level', () => {
    usePartyStore.getState().chooseMastery(heroNow().id, 'bulwark');
    const node = findMasteryPath('bulwark')!.nodes.find((n) => n.id === 'bulwark_spite')!;
    const max = maxLevelOf(node);

    for (let i = 0; i < max; i++) {
      expect(usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_spite')).toBe(true);
      expect(heroNow().masteryNodes.bulwark_spite).toBe(i + 1);
    }

    expect(usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_spite')).toBe(false);
    expect(heroNow().masteryNodes.bulwark_spite).toBe(max);
  });

  it('grants a mastery point on each level past the unlock', () => {
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, level: 6, xp: 0, masteryPoints: 0 })),
    }));
    const events = usePartyStore.getState().gainXp(heroNow().id, 100000);
    expect(heroNow().level).toBe(BALANCE.MAX_LEVEL);
    expect(heroNow().masteryPoints).toBe(BALANCE.MASTERY_POINTS_AT_CAP - pointsEarnedByLevel(6));
    expect(events[0].masteryPointsGained).toBeGreaterThan(0);
  });

  // Computed from the level rather than incremented, so a double-fire cannot
  // hand out the same point twice
  it('grants no points for XP that does not level the hero', () => {
    usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, masteryPoints: 3 })) }));
    usePartyStore.getState().gainXp(heroNow().id, 1);
    expect(heroNow().masteryPoints).toBe(3);
  });

  it('flags the level-up that opens the choice', () => {
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, level: 4, xp: 0, masteryPath: null })),
    }));
    const events = usePartyStore.getState().gainXp(heroNow().id, xpFor(4));
    expect(events[0].masteryUnlocked).toBe(true);
  });
});

/**
 * A recruit arrives partway up the curve, and has to arrive *whole*.
 *
 * The level is only half of it: a hero handed a number with level-1 stats, a
 * level-1 skill list and no mastery points is worse than one who honestly
 * joined at 1, because the screen now claims otherwise. All four have to come
 * from the same place they would have come from had the hero levelled there.
 */
describe('recruits joining partway up the curve', () => {
  const second = () => usePartyStore.getState().heroes[1];

  beforeEach(() => {
    usePartyStore.setState({ heroes: [] });
    usePartyStore.getState().addHero('warrior');
    usePartyStore.getState().addHero('mage');
  });

  it('starts the first hero at 1 and brings the second in above them', () => {
    expect(usePartyStore.getState().heroes[0].level).toBe(recruitLevel(0));
    expect(second().level).toBe(recruitLevel(1));
  });

  it('gives them the stats of the level they arrive at', () => {
    const template = heroTemplates.find((t) => t.id === 'mage')!;
    expect(second().baseStats).toEqual(calculateStatsForLevel(template, second().level));
    // Full, and full means the *effective* ceiling: they arrive wearing a
    // starter kit, so `baseStats.maxHp` is not the bar they are standing at.
    // See `heroHp.test.ts`.
    expect(second().currentHp).toBe(heroMaxHp(second()));
  });

  it('gives them the skills of the level they arrive at', () => {
    const template = heroTemplates.find((t) => t.id === 'mage')!;
    const seed = { masteryPath: null, masteryNodes: {} };
    expect(second().skills.map((s) => s.id)).toEqual(
      deriveHeroSkills({ ...seed, level: second().level }, template.skills).map((s) => s.id),
    );
    // Not vacuous: the mage's level-1 kit is strictly smaller, so a recruit
    // handed a level number but the opening skill list would fail here
    expect(second().skills.length).toBeGreaterThan(
      deriveHeroSkills({ ...seed, level: 1 }, template.skills).length,
    );
  });

  // Otherwise a hero joining at or above the unlock level opens a tree they
  // cannot afford one node of
  it('pays the mastery points those levels are worth', () => {
    expect(second().masteryPoints).toBe(pointsEarnedByLevel(second().level));
  });

  it('leaves the path unchosen — arriving is not deciding', () => {
    expect(second().masteryPath).toBeNull();
    expect(second().masteryNodes).toEqual({});
  });
});

function xpFor(level: number): number {
  return BALANCE.XP_LINEAR * level + BALANCE.XP_QUADRATIC * level * level;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

describe('save format', () => {
  // A deliberate tripwire, not a fact worth knowing. There are no migrations —
  // a mismatched save is discarded — so every change to a persisted shape has to
  // bump the version. Failing here means either the bump was forgotten, or it
  // happened and this line needs updating with it.
  it('has been bumped for the current persisted shape', () => {
    // 15: two shapes landed at once, and each had independently claimed 14 —
    // `city.drill` (the barracks' weekly stamp) and `MapTile.npcId` (written on
    // the `POIType.Wayside` tiles the generator now places for the three people
    // who live outside the city). A save written against either half would have
    // called itself 14 while being a different shape from the other half, which
    // is the one thing the version exists to make impossible. 15 is neither.
    //
    // 16: two fields on `Item`, landing together — `affixes` (the named riders
    // rolled at acquisition) and `setBonus` (a legendary set piece's rolled
    // skill). One number for both, exactly as 15 covered two shapes. The affix
    // stats are baked into `modifiers`, so a version-15 save would have loaded
    // without complaint — and every rare in it would have been a clean baseline
    // for the rest of the campaign, indistinguishable from a save whose rolls
    // had genuinely all come up empty. A save that loads and is quietly wrong is
    // the case the exact-match rule exists for.
    //
    // 17: the calendar left `worldMap` for a store of its own, and the encounter
    // pre-roll became daily. `dayNumber` and `weekNumber` are gone from the file
    // — both are `Math.floor` of `totalHours`, so storing them stored one clock
    // twice — and `weeklyEncounterTiles` is `activeEncounterTiles`. A
    // version-16 save would have loaded and come up with no live encounters
    // anywhere on the map until the next dawn, which is the same "loads and is
    // quietly wrong" failure 16 was written about.
    //
    // 18: `MapTile` gained `zone` and lost `isDanger` and `road`. The overworld
    // is three zones now — road, corridor, haunted — where it was two booleans
    // that could in principle contradict each other. A version-17 map
    // deserialises with `zone` undefined on every tile, so the daily encounter
    // roll finds no rate to apply and the entire world has no fights in it,
    // forever, while looking completely normal. Same failure class as 16.
    //
    // 19: `Hero.masteryNodes` is a map of node id to level, not a list of ids.
    // Every node holds three levels now and each is its own point, so ownership
    // stopped being a boolean. The old value is an array, and an array *is* an
    // object — so a version-18 save would deserialise without throwing and
    // every lookup would miss, giving a hero who has spent fifteen points no
    // tree skills, no tree stats and a full balance to spend again. It reads as
    // a hero who never picked anything rather than as a broken save, which is
    // the same failure class as 16 and 18.
    //
    // 20: `inventory.rations` — food, bought at the tavern and spent on one
    // hero. The mildest bump in the list and taken anyway, because the rule is
    // that a new persisted field means a bump and nothing else. A version-19
    // save would read `rations` as undefined, and `undefined - 1` is `NaN`: a
    // pack that neither holds food nor can be filled, in a save that looks
    // completely normal. Milder than 18 or 19, same class as both. A `?? 0` on
    // the load would paper over exactly this, which is the migration path the
    // format says it does not have.
    //
    // 21: every saved item carries `itemLevel`, the level its modifiers are
    // scaled to. A version-20 item has none and there is nothing honest to
    // default it to, so the save goes — and within 21 a missing or malformed
    // level refuses the save too (`isLoadable`), rather than being patched.
    //
    // 22: `Item.upgradeLevel` is gone; a legendary's Crystal upgrades are item
    // levels past the cap. A version-21 +3 would load as a +0, silently.
    //
    // 23: heroes lost their class at-will to the weapon-driven Basic Attack.
    // A version-22 hero carries its old Slash or Thorn Lash in `skills`, and
    // would take it into every fight beside the attack its weapon makes.
    // 24: socket capacity, embedded gems and loose gem stacks are saved.
    // 25: held items carry the named model variant they were minted as.
    //
    // 26: the `of_the_bulwark` affix id is `of_the_aegis`.
    // 27: the frozen north — `MapTile.frost` and `TileType.Tundra`.
    // 28: the lair reorder — the ice lair's new floor under `lair_barrow`.
    // 29: distinct city roles — purchased expedition meal replaces drill/Market stamps.
    // 30: named quest destinations and revised stages require a fresh campaign.
    // 31: fixed campaign difficulty and Hardcore eligibility.
    // 32: deduplicated campaign victory ids; earned achievements live outside the run.
    // 33: resource nodes are gone; the world map persists the week's exploration finds.
    // 35: playtest mastery replacements and scenario campaigns.
    // 36: fixed encounter entry checkpoints and eligible hunt miss streaks.
    // 37: the Hydromancer remaster removes three node ids from the tree.
    // 38: the Pyromancer remaster replaces Kindling with Fuel the Flame.
    // 39: the Lifewarden remaster removes four node ids from the tree.
    // 40: the Bulwark remaster removes three node ids and moves three more.
    // 41: the Marksman remaster removes five node ids from the tree.
    // 42: the Stormcaller remaster removes Quickened and Afterimage.
    // 43: the Templar remaster swaps four nodes, changing derived prerequisites.
    // 44: the Stoneshaper remaster removes three node ids from the tree.
    // 45: the Skirmisher remaster removes four node ids from the tree.
    // 46: the Berserker remaster removes Thick Hide.
    // 47: the Wildshape remaster replaces six node ids in the tree.
    // 48: the Shadowblade remaster removes Quick Hands and Rot and moves Lethality.
    // 49: heroes persist `wildForm`, the Wildshape animal carried between fights.
    // 50: penetration splits into Armour Pen and Magic Pen; pen and lifesteal affixes are repriced.
    // 51: a committed encounter snapshot stores each scripted boss's own counters, not the Emperor's on every boss.
    // 52: heroes persist their choices and state only; the kit, the stats and the class are derived on load.
    // 53: one carried consumable town portal.
    // 54: item class locks are lists.
    // 55: the Monk ships whole; path armour weight holds at every rarity.
    // 56: warding incense.
    // 57: worlds are saved as seed plus explored and defeated marks.
    // 58: Jadeveil Range generates as its own range.
    // 59: Jadeveil's wrath stamp and the monastery's vows.
    // 60: Jadeveil's shrines claimed.
    // 61: Kairen's summit — slain, the Storm Seals held, the highest tier cleared.
    // 62: Jadeveil's equipment — collections, motifs, weapons, the bonus path, Ink and patterns.
    // 63: the unified bag — one `inventory.bag` list of entries with a kind.
    // 64: item instances carry no name or description; both are built when shown.
    // 65: the prospector chain's Delve fight adds a named quest site.
    // 66: `city.sackedUntilDay` — a lost siege leaves the town sacked for `SACK_DAYS`.
    // 67: the biome lock moves the Wyrm's door and the Fallen Order's shrine onto their ground.
    // 68: Jadeveil's Spirit gem tier — twelve gem ids in every stock and socket.
    // 69: `city.recruitNoticeShownFor` — the recruit notice is said once per opening.
    // 70: Hoofprints in the Mud replaces What the Reeds Hide, with two new named sites.
    // 71: the castle's haunted ring, and Jadeveil's camp in its map's corner.
    // 72: boss tactics, shared systems: new warning, hazard and boss-script fields.
    // 73: the Emerald Dragon's heat gauge, its quench flag, and a Rift that lasts until Skyfire.
    // 74: boss tactics, Aethelred: a warning remembers the seals paid; an objective pays its breaker.
    // 75: the Heart's Creeping Winter spares the ground beside a standing anchor (`PreparedAttack.sheltered`).
    // 76: villages: the generator places four on the Empire's map.
    // 77: village buffs: `worldMap.villageBuff`.
    // 78: travelling merchants: each world snapshot carries `merchants`.
    // 79: Aethelred carries his Seal tier, and his standards a backlash that falls with it.
    // 80: `quests.trackedVillage`, a held village followed in a quest's place.
    // 81: the Troll's six-slot cycle is Prey, Sweep, Sweep, Smash, Sweep, Sweep: a saved step names another move.
    // 82: the Dragon's Furnace Heart rides on a hero (`carrierId`), `seared`, and the Rift counts its own turns.
    // 83: the Heart of Winter's refight: `empire.winterSeals` and `empire.heartTier`.
    // 84: Aethelred's script remembers Overturn's throws, his phase 2 opens on the Chains, Crownfall's held points.
    // 85: Aethelred's castle-tier twists: his script remembers a fallen Standard and an owed black sun.
    // 86: the world band ledger (`worldBands`).
    // 87: the mythic bad-luck counter (`mythicKills`).
    expect(SAVE_VERSION).toBe(87);
  });
});

// ─── Mastery starter weapons ──────────────────────────────────────────────────

describe('mastery starter weapons', () => {
  const heroNow = () => usePartyStore.getState().heroes[0];
  const itemsNow = () => selectGear(useInventoryStore.getState());

  beforeEach(() => {
    usePartyStore.setState({ heroes: [] });
    useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
    usePartyStore.getState().addHero('ranger');
    usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, level: 10 })) }));
  });

  it('names only templates that exist', () => {
    for (const grant of Object.values(MASTERY_STARTER_WEAPONS)) {
      expect(itemFromTemplateId(grant.mainHand)).not.toBeNull();
      if (grant.offHand) expect(itemFromTemplateId(grant.offHand)).not.toBeNull();
    }
  });

  // Same trap as the sets: a starter weapon the path's own class cannot hold
  // would be granted, equipped, and then refused by every rule downstream
  it('grants only weapons the path’s class can hold', () => {
    const illegal: string[] = [];
    for (const path of MASTERY_PATHS) {
      const grant = MASTERY_STARTER_WEAPONS[path.id];
      const wearer = { ...heroFixture(), heroClass: path.heroClass, masteryPath: path.id };
      for (const templateId of [grant.mainHand, grant.offHand].filter(Boolean) as string[]) {
        const it = itemFromTemplateId(templateId)!;
        const slot = templateId === grant.mainHand ? 'mainHand' : 'offHand';
        if (!canEquip(wearer, it, slot as never, {}).ok) illegal.push(`${path.id}/${templateId}`);
      }
    }
    expect(illegal).toEqual([]);
  });

  it('covers every path', () => {
    for (const path of MASTERY_PATHS) {
      expect(MASTERY_STARTER_WEAPONS[path.id]).toBeDefined();
    }
  });

  // The whole reason this exists: a Hunter taking Shadowblade is a dual-wield
  // assassin holding a bow
  it('arms a Shadowblade with daggers rather than a bow', () => {
    usePartyStore.getState().chooseMastery(heroNow().id, 'shadowblade');
    const worn = heroNow().equipment;
    const main = itemsNow().find((i) => i.id === worn.mainHand);
    const off = itemsNow().find((i) => i.id === worn.offHand);
    expect(main?.templateId).toBe('dagger_iron');
    expect(off?.templateId).toBe('dagger_iron');
  });

  it('equips a weapon the new path can legally hold', () => {
    usePartyStore.getState().chooseMastery(heroNow().id, 'shadowblade');
    const hero = heroNow();
    const worn = itemsNow().filter((i) => Object.values(hero.equipment).includes(i.id));
    for (const item of worn.filter((i) => i.slot === 'mainHand')) {
      expect(canEquip(hero, item, 'mainHand', {}).ok).toBe(true);
    }
  });

  // Never destroy gear: the old bow is still worth selling
  it('leaves the replaced weapons in the bag', () => {
    const before = heroNow().equipment.mainHand;
    usePartyStore.getState().chooseMastery(heroNow().id, 'shadowblade');
    expect(heroNow().equipment.mainHand).not.toBe(before);
    expect(itemsNow().some((i) => i.id === before)).toBe(true);
  });

  // Playtest 2026-10-23 (PT-05): a hand already holding what the path may carry
  // keeps it, at any rarity, and nothing is minted for it
  it('keeps a weapon the path may hold, and mints nothing for that hand', () => {
    const bow = useInventoryStore.getState().addItem(itemFromTemplateId('bow_plain')!);
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, equipment: { ...h.equipment, mainHand: bow } })),
    }));
    const offBefore = heroNow().equipment.offHand;

    usePartyStore.getState().chooseMastery(heroNow().id, 'marksman');
    expect(heroNow().equipment.mainHand).toBe(bow);
    expect(heroNow().equipment.offHand).toBe(offBefore);
    expect(itemsNow().some((i) => i.templateId === 'bow_iron')).toBe(false);
  });

  it('fills an empty hand the path issues for', () => {
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, equipment: { ...h.equipment, offHand: undefined } })),
    }));
    usePartyStore.getState().chooseMastery(heroNow().id, 'marksman');
    const off = itemsNow().find((i) => i.id === heroNow().equipment.offHand);
    expect(off?.templateId).toBe('quiver_iron');
  });

  it('keeps a legal main hand but still gives a dual-wielder its second weapon', () => {
    const dagger = useInventoryStore.getState().addItem(itemFromTemplateId('dagger_plain')!);
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, equipment: { ...h.equipment, mainHand: dagger } })),
    }));
    usePartyStore.getState().chooseMastery(heroNow().id, 'shadowblade');
    expect(heroNow().equipment.mainHand).toBe(dagger);
    const off = itemsNow().find((i) => i.id === heroNow().equipment.offHand);
    expect(off?.templateId).toBe('dagger_iron');
  });

  it('grants nothing when the choice is refused', () => {
    const before = itemsNow().length;
    usePartyStore.getState().chooseMastery(heroNow().id, 'bulwark');   // wrong class
    expect(itemsNow()).toHaveLength(before);
    expect(heroNow().masteryPath).toBeNull();
  });

  it('does not re-grant on a second attempt', () => {
    usePartyStore.getState().chooseMastery(heroNow().id, 'shadowblade');
    const after = itemsNow().length;
    usePartyStore.getState().chooseMastery(heroNow().id, 'marksman');
    expect(itemsNow()).toHaveLength(after);
  });

  // The path issues weapons only (playtest 2026-10-17, PT-03): armour of
  // another weight goes to the bag and its slot is left empty; armour already
  // in the weight stays on
  it('issues no armour, and bags armour outside the path’s weight', () => {
    const plate = itemFromTemplateId('plate_chest_plain')!;
    const plateId = useInventoryStore.getState().addItem(plate);
    usePartyStore.getState().equipItem(heroNow().id, 'chest', plateId);
    const legsBefore = heroNow().equipment.legs;

    usePartyStore.getState().chooseMastery(heroNow().id, 'marksman');
    const worn = heroNow().equipment;
    expect(worn.chest).toBeUndefined();
    expect(itemsNow().some((i) => i.id === plateId)).toBe(true);
    expect(itemsNow().some((i) => i.templateId === 'hide_chest_iron')).toBe(false);
    expect(worn.legs).toBe(legsBefore);
  });
});

// ─── What a path takes away ───────────────────────────────────────────────────

/**
 * Committing to a path is the one event that can invalidate gear retroactively,
 * and the hard weapon lock is what made it possible to be wearing something the
 * rules now refuse.
 *
 * The rule: **it goes back in the bag.** Leaving it equipped makes the lock a
 * lie — the equipment screen would refuse to re-equip the weapon the hero is
 * visibly holding — and destroying it is theft of something earned four levels
 * before the rule existed.
 */
describe('choosing a path strips what it may no longer hold', () => {
  const heroNow = () => usePartyStore.getState().heroes[0];
  const itemsNow = () => selectGear(useInventoryStore.getState());

  beforeEach(() => {
    usePartyStore.setState({ heroes: [] });
    useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
    usePartyStore.getState().addHero('ranger');
    usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, level: 10 })) }));
  });

  /**
   * A ring is not a weapon and nothing about a path touches it, so it is the
   * control: the sweep has to be surgical or it is a wipe with better manners.
   */
  it('leaves everything still legal exactly where it was', () => {
    const ring = useInventoryStore.getState().addItem(itemFromTemplateId('band_plain')!);
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, equipment: { ...h.equipment, ring1: ring } })),
    }));

    usePartyStore.getState().chooseMastery(heroNow().id, 'marksman');
    expect(heroNow().equipment.ring1).toBe(ring);
  });

  it('unequips a weapon the new path refuses', () => {
    // A Marksman keeps the bow it is handed; the spear it was carrying is not
    // on its list, so it comes off — into a slot the grant does not fill
    const spear = useInventoryStore.getState().addItem(itemFromTemplateId('spear_iron')!);
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, equipment: { ...h.equipment, ring1: spear } })),
    }));

    usePartyStore.getState().chooseMastery(heroNow().id, 'marksman');
    // It was never legal in a ring slot either; what matters is the direction
    expect(heroNow().equipment.ring1).toBeUndefined();
    expect(itemsNow().some((i) => i.id === spear)).toBe(true);
  });

  /**
   * The end-to-end shape: after committing, nothing the hero is wearing may
   * fail the rules the hero is now subject to. Checked across every path rather
   * than for one, because the sweep is a general rule and a per-path exception
   * is exactly what it exists to make impossible.
   */
  it('leaves no hero wearing something their own path refuses', () => {
    const offenders: string[] = [];
    for (const path of MASTERY_PATHS.filter((p) => p.heroClass === HeroClass.Ranger)) {
      usePartyStore.setState({ heroes: [] });
      useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
      usePartyStore.getState().addHero('ranger');
      usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, level: 10 })) }));

      // Arm them with one of everything their class can hold before the choice
      for (const templateId of ['bow_iron', 'crossbow_iron', 'dagger_iron', 'spear_iron']) {
        const id = useInventoryStore.getState().addItem(itemFromTemplateId(templateId)!);
        usePartyStore.setState((s) => ({
          heroes: s.heroes.map((h) => ({ ...h, equipment: { ...h.equipment, mainHand: id } })),
        }));
      }

      usePartyStore.getState().chooseMastery(heroNow().id, path.id);

      const hero = heroNow();
      const worn: Record<string, unknown> = {};
      for (const [slot, id] of Object.entries(hero.equipment)) {
        const item = itemsNow().find((i) => i.id === id);
        if (item) worn[slot] = item;
      }
      for (const [slot, item] of Object.entries(worn)) {
        const others = { ...worn } as never;
        delete (others as Record<string, unknown>)[slot];
        if (!canEquip(hero, item as never, slot as never, others).ok) {
          offenders.push(`${path.id}: ${slot}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A path's armour weight holds at every rarity, and a Monk's focus waits for
   * the Firefly (the private project notes, "Equipment rules"). An apprentice
   * who became a Beetle in a plain hide hood and holding a lantern — the hood
   * in a slot the issue never fills — keeps neither on, and loses neither.
   */
  it('bags a Beetle’s common hood in another weight and its focus', () => {
    usePartyStore.setState({ heroes: [] });
    usePartyStore.getState().addHero('monk');
    usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, level: 10 })) }));
    const hood = useInventoryStore.getState().addItem(itemFromTemplateId('hide_head_plain')!);
    const lantern = useInventoryStore.getState().addItem(itemFromTemplateId('lantern_iron')!);
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, equipment: { ...h.equipment, head: hood, offHand: lantern } })),
    }));

    expect(usePartyStore.getState().chooseMastery(heroNow().id, 'beetle')).toBe(true);
    expect(heroNow().equipment.head).toBeUndefined();
    expect(heroNow().equipment.offHand).toBeUndefined();
    expect(itemsNow().filter((i) => i.id === hood || i.id === lantern)).toHaveLength(2);
  });
});

// ─── Unlearning ───────────────────────────────────────────────────────────────

/**
 * The picks inside a path can be bought back; the path cannot.
 *
 * This is a deliberate loosening of a rule that used to read "un-spending is the
 * thing a player must never do". It never needed to cover both halves of the
 * decision. *Which discipline* a hero commits to is the permanent one — it
 * decides their capstones, their silhouette and, since the weapon locks, what
 * they are allowed to hold. The fifteen picks inside it are a different kind of
 * mistake: one a player makes at level six out of ignorance and lives with until
 * twenty, which is not interesting, only punishing.
 */
describe('unlearning a tree', () => {
  const heroNow = () => usePartyStore.getState().heroes[0];
  const retrain = () => usePartyStore.getState().retrainMastery(heroNow().id);

  beforeEach(() => {
    usePartyStore.setState({ heroes: [] });
    usePartyStore.getState().addHero('warrior');
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, level: 10 })),
    }));
    usePartyStore.getState().chooseMastery(heroNow().id, 'bulwark');
  });

  it('hands every spent point back and keeps the path', () => {
    usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_spite');
    usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_spite');
    expect(pointsSpent(heroNow())).toBe(2);

    expect(retrain()).toBe(true);
    expect(heroNow().masteryNodes).toEqual({});
    expect(heroNow().masteryPath).toBe('bulwark');
    expect(heroNow().masteryPoints).toBe(pointsEarnedByLevel(10, 'bulwark'));
  });

  /**
   * A node-granted skill has to leave the bar with the node. The signature does
   * not — that comes from the path, which is not what was unlearned.
   */
  it('takes back the skills those nodes granted, but not the signature', () => {
    usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_due');
    usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_shielded_challenge');
    usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_challenge');
    const granted = findMasteryPath('bulwark')!.nodes
      .filter((n) => ['bulwark_loud', 'bulwark_spite', 'bulwark_challenge'].includes(n.id))
      .map((n) => n.grantsSkill)
      .filter(Boolean);

    retrain();
    const bar = new Set<string>(heroNow().skills.map((s) => s.id));
    expect(granted.filter((id) => bar.has(id as string))).toEqual([]);
    expect(bar).toContain('provoking_strike');
  });

  /**
   * Refused rather than silently succeeding, so the shop cannot take gold for a
   * button that would do nothing.
   */
  it('refuses when there is nothing spent to give back', () => {
    expect(retrain()).toBe(false);
  });

  it('refuses a hero who has no path at all', () => {
    usePartyStore.setState((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, masteryPath: null, masteryNodes: {} })),
    }));
    expect(retrain()).toBe(false);
  });

  /**
   * Points are recomputed from the level rather than counted back off the nodes,
   * so a hero who levelled since spending is made whole rather than refunded the
   * smaller, older number.
   */
  it('pays out at the hero current level, not the level they spent at', () => {
    usePartyStore.getState().unlockMasteryNode(heroNow().id, 'bulwark_spite');
    usePartyStore.setState((s) => ({ heroes: s.heroes.map((h) => ({ ...h, level: 20 })) }));

    retrain();
    expect(heroNow().masteryPoints).toBe(pointsEarnedByLevel(20, 'bulwark'));
  });
});
