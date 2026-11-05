import {
  describeSkill, describeSkillSegments, mult, segmentsText, skillEffectLines, skillStatLine, skillTextColor,
  SkillTextSegment,
} from '@/data/display/skillDisplay';
import { heal, slash, ALL_SKILLS } from '@/data/skills/skillData';
import { burningOut, chainLightning, ignite } from '@/data/skills/mastery/arcanist';
import { bloodthirst } from '@/data/skills/mastery/champion';
import { emergencyBloom } from '@/data/skills/mastery/druid';
import { basicAttackWith } from '@/systems/combat/basicAttack';
import { calculateDamage, healingRange } from '@/systems/combat/damageCalc';
import { useRunSettingsStore } from '@/stores/runSettingsStore';
import { BALANCE } from '@/data/balanceConstants';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { makeStats, makeUnit } from '../support/fixtures';
import { crownfall, foreclosure } from '@/data/templates/aethelred';
import { skyfire } from '@/data/templates/emeraldDragon';
import { AfflictionType, AuraType, HeroSkill, SkillTargetType } from '@/models/types';
import { skillDescription } from '@/data/gameText';

const EVERY_SKILL: HeroSkill[] = [...ALL_SKILLS, ...MASTERY_SKILLS];

it('describes prepared attacks by their warned footprint and counterplay instead of a generic target radius', () => {
  for (const skill of [crownfall, foreclosure, skyfire]) {
    expect(describeSkill(skill)).toBe(skillDescription(skill));
    expect(describeSkill(skill, makeUnit())).toBe(skillDescription(skill));
    expect(describeSkill(skill)).not.toContain('within 0 hexes');
    expect(skillStatLine(skill)).toContain('×');
    expect(skillEffectLines(skill).some(line => line.startsWith('Announced first:'))).toBe(true);
  }
});

const base: HeroSkill = {
  id: 'slash', name: 'Slash', description: 'A strike.',
  targetType: SkillTargetType.Single, range: 1, damage: 1.1,
  unlockLevel: 1, manaCost: 0,
};

describe('skillStatLine', () => {
  it('names the scaling stat', () => {
    expect(skillStatLine(base)).toContain('1.1× ATK');
    expect(skillStatLine({ ...base, scaling: 'magic' })).toContain('1.1× MAG');
  });

  it('says free rather than 0 MP', () => {
    expect(skillStatLine(base)).toContain('free');
    expect(skillStatLine({ ...base, manaCost: 12 })).toContain('12 MP');
  });

  it('mentions a cooldown only when there is one', () => {
    expect(skillStatLine(base)).not.toContain('cooldown');
    expect(skillStatLine({ ...base, cooldown: 3 })).toContain('3t cooldown');
  });

  // A self buff's range of zero is noise; a blink's range is the whole point
  it('shows range on a self skill only when it moves you', () => {
    const buff = { ...base, targetType: SkillTargetType.Self, range: 0, damage: undefined };
    expect(skillStatLine(buff)).toContain('self');
    expect(skillStatLine(buff)).not.toContain('hexes');
    expect(skillStatLine({ ...buff, range: 4 })).toContain('4 hexes');
  });

  it('describes area shapes', () => {
    const arc = { ...base, targetType: SkillTargetType.Arc, range: 2, aoeRadius: 2 };
    expect(skillStatLine(arc)).toContain('arc');
    // An arc's extent is a depth out of the caster, not a radius around a point
    expect(skillStatLine(arc)).toContain('depth 2');
    expect(skillStatLine(arc)).not.toContain('radius');
    expect(
      skillStatLine({ ...base, targetType: SkillTargetType.Ring, range: 0, aoeRadius: 2 })
    ).toContain('radius 2');
  });

  // Every skill in the game gets read by this, so none of them may come out
  // blank or with a dangling separator
  it('produces something legible for every skill', () => {
    const bad = EVERY_SKILL.filter((s) => {
      const line = skillStatLine(s);
      return line.length === 0 || line.includes('undefined') || line.includes('NaN');
    }).map((s) => s.id);
    expect(bad).toEqual([]);
  });
});

describe('skillEffectLines', () => {
  it('says nothing about a plain attack', () => {
    expect(skillEffectLines(base)).toEqual([]);
  });

  it('reports drain as a percentage', () => {
    expect(skillEffectLines({ ...base, lifesteal: 0.15 })).toEqual([
      'Heals for 15% of damage dealt',
    ]);
  });

  it('names the status a skill applies, with its magnitude', () => {
    const [line] = skillEffectLines({
      ...base,
      appliesEffect: { type: 'taunt' as never, magnitude: 2, duration: 2 },
    });
    expect(line).toContain('Taunt');
    expect(line).toContain('2 turns');
  });

  it('calls a permanent effect permanent', () => {
    const [line] = skillEffectLines({
      ...base,
      appliesEffect: { type: 'taunt' as never, magnitude: 2, duration: -1 },
    });
    expect(line).toContain('permanent');
  });

  it('explains that a shift toggles', () => {
    expect(skillEffectLines({ ...base, shiftsTo: 'bear' })).toContain(
      'Cast again to return to your own shape'
    );
  });

  it('never emits a placeholder for any real skill', () => {
    const bad = EVERY_SKILL.flatMap((s) =>
      skillEffectLines(s).filter((l) => l.includes('undefined') || l.includes('NaN'))
    );
    expect(bad).toEqual([]);
  });
});

/**
 * No binary floating-point noise anywhere a player can read it.
 *
 * A multiplier is authored to two decimals and then multiplied — by a node's
 * `LEVEL_SCALE`, by a legendary set roll — and `0.7 × 1.5` is
 * `1.0499999999999998`. The Stoneshaper's Living Stone shipped reading
 * "1.0499999999999998× your Magic", three times in one panel: once in the
 * derived sentence, once in the stat line, once in the "At level 1" line under
 * it.
 *
 * The rule is the deliverable rather than any particular number, and it has to
 * be measured on the *rendered string*: the two rounding sites (`scaleSkill`
 * and `mult`) are both easy to add a third caller around, and a skill whose
 * multiplier is computed somewhere new would look completely normal in code
 * review. Sweeping every skill the game fields, at every level a node can hold
 * it at, is what catches that.
 */
describe('no float noise reaches a tooltip', () => {
  /** More than two decimals in a number that is followed by a `×`. */
  const NOISE = /\d+\.\d{3,}\s*×/;

  it('renders every skill in the game to two decimals', () => {
    const offenders = EVERY_SKILL.filter((s) =>
      NOISE.test(`${skillStatLine(s)} ${describeSkill(s)} ${skillEffectLines(s).join(' ')}`),
    ).map((s) => s.id);
    expect(offenders).toEqual([]);
  });

  /**
   * The case that actually shipped broken. A node's granted skill is scaled by
   * the level it is held at, so the noise only appears on ranks 1 and 3 —
   * `LEVEL_SCALE[1]` is exactly 1 and returns the skill untouched, which is why
   * a spot check of any single node at its middle rank finds nothing.
   */
  it('renders every node-granted skill at every rank it can be held at', () => {
    const offenders: string[] = [];
    for (const path of MASTERY_PATHS) {
      for (const node of path.nodes) {
        if (!node.grantsSkill) continue;
        for (let level = 1; level <= 3; level++) {
          const skill = nodeSkillAt(node, level);
          if (!skill) continue;
          const rendered = `${skillStatLine(skill)} ${describeSkill(skill)}`;
          if (NOISE.test(rendered)) offenders.push(`${node.id} @${level}: ${rendered}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('drops a trailing zero rather than inventing precision', () => {
    expect(mult(1.5)).toBe('1.5');
    expect(mult(2)).toBe('2');
    expect(mult(1.0499999999999998)).toBe('1.05');
  });
});

describe('skillEffectLines — fractional status strength', () => {
  const mage = makeUnit({ id: 'mage', stats: makeStats({ attack: 10, magic: 40 }) });
  const ignite = EVERY_SKILL.find((s) => s.id === 'ignite')!;

  it('resolves Ignite\'s Burn against the caster, as the first tick will', () => {
    const line = skillEffectLines(ignite, mage).find((l) => l.includes('Burn'))!;
    // 0.27 of 40 Magic
    expect(line).toContain('Applies Burn 11/turn');
  });

  it('states the rule when there is no caster', () => {
    const line = skillEffectLines(ignite).find((l) => l.includes('Burn'))!;
    expect(line).toContain('Burn 27% of Magic/turn');
  });

  it('leaves flat magnitudes alone, with or without a caster', () => {
    const flat: HeroSkill = {
      ...base, appliesEffect: { type: AfflictionType.Bleed, magnitude: 9, duration: 3 },
    };
    expect(skillEffectLines(flat, mage).join()).toContain('Bleed 9/turn');
    expect(skillEffectLines(flat).join()).toContain('Bleed 9/turn');
  });

  it('pins the fraction for Poison and the flat case for Regen', () => {
    const poison: HeroSkill = {
      ...base, appliesEffect: { type: AfflictionType.Poison, magnitude: 0.4, duration: 3 },
    };
    expect(skillEffectLines(poison).join()).toContain('Poison 40% of Attack/turn');
    expect(skillEffectLines(poison, mage).join()).not.toMatch(/Poison 0\//);
    const regen: HeroSkill = {
      ...base, appliesEffect: { type: AuraType.HealOverTime, magnitude: 8, duration: 3 },
    };
    expect(skillEffectLines(regen, mage).join()).toContain('Regen 8/turn');
  });

  it('never shows a zero magnitude for any skill, caster or not', () => {
    for (const skill of EVERY_SKILL) {
      for (const caster of [undefined, mage]) {
        for (const line of skillEffectLines(skill, caster)) {
          expect(line).not.toMatch(/Applies [A-Za-z ]+ 0(\/turn| dmg|%)?( |$)/);
        }
      }
    }
  });
});

/**
 * With a caster, the sentence states the caster's numbers — computed by the
 * functions the cast calls — and marks each one with the kind of payload it is,
 * so the renderer can colour it. Without one (the mastery tree) it keeps the
 * multiplier, which is what ranks are compared by.
 */
describe('describeSkill with a caster', () => {
  const kinds = (segments: SkillTextSegment[]) =>
    segments.filter((s) => s.kind).map((s) => `${s.text}:${s.kind}`);

  beforeEach(() => useRunSettingsStore.getState().begin());
  afterEach(() => useRunSettingsStore.getState().begin());

  it("states a Goblin Whelp's Slash as the damage it deals", () => {
    const whelp = makeUnit({ isPlayer: false, stats: makeStats({ attack: 14 }) });
    const segments = describeSkillSegments(slash, whelp);
    expect(segmentsText(segments)).toBe('Strike one enemy within reach for 15 damage.');
    expect(kinds(segments)).toEqual(['15:physical']);
    // The stat line keeps the rule
    expect(skillStatLine(slash)).toBe('1.1× ATK physical · range 1 · free');
  });

  it('includes the campaign difficulty in an enemy number, and never in a hero one', () => {
    useRunSettingsStore.getState().begin({ difficulty: 'hard', hardcore: false });
    const whelp = makeUnit({ isPlayer: false, stats: makeStats({ attack: 14 }) });
    const hero = makeUnit({ isPlayer: true, stats: makeStats({ attack: 14 }) });
    expect(describeSkill(slash, whelp)).toContain('for 19 damage');
    expect(describeSkill(slash, hero)).toContain('for 15 damage');
  });

  it("states a Druid's Heal as the mend and the shield", () => {
    const druid = makeUnit({ stats: makeStats({ magic: 41 }) });
    const segments = describeSkillSegments(heal, druid);
    expect(segmentsText(segments)).toBe(
      'Mend an ally up to 2 hexes away for 21 and shield them for 16 for 3 turns.',
    );
    expect(kinds(segments)).toEqual(['21:heal', '16:shield']);
    expect(skillEffectLines(heal, druid)).toContain('Applies Barrier 16 · 3 turns');
  });

  it('grows with a buff, as the cast does', () => {
    const druid = makeUnit({
      stats: makeStats({ magic: 41 }),
      activeEffects: [{ type: AuraType.MagicBuff, magnitude: 10, duration: 2 }],
    });
    expect(describeSkill(heal, druid)).toContain('for 27 and shield them for 20');
  });

  it('says a damage-over-time rider as the second half of the blow, in its own colour', () => {
    const mage = makeUnit({ stats: makeStats({ magic: 30 }) });
    const segments = describeSkillSegments(ignite, mage);
    expect(segmentsText(segments)).toBe(
      'Strike one enemy up to 3 hexes away for 19 damage, then burn them for 8 per turn for 3 turns.',
    );
    expect(kinds(segments)).toEqual(['19:magic', '8:status']);
    const burn = segments.find((s) => s.kind === 'status')!;
    expect(burn.status).toBe(AfflictionType.Burn);
    expect(skillTextColor(burn, 'light')).toBeDefined();
  });

  it('says a status-only damage-over-time with its number', () => {
    // Burning Out's Burn is a fraction of Magic (0.18 × 30), not of Attack
    const mage = makeUnit({ stats: makeStats({ attack: 20, magic: 30 }) });
    expect(describeSkill(burningOut, mage)).toBe(
      'Burn every enemy in the arena for 5 per turn for 3 turns.',
    );
  });

  it('says a chain hits each enemy for the number', () => {
    const mage = makeUnit({ stats: makeStats({ magic: 30 }) });
    expect(describeSkill(chainLightning, mage)).toBe(
      'Strike an enemy, leaping on to 3 more, for 36 damage to each enemy hit.',
    );
  });

  it('says what a drain gives back', () => {
    const berserker = makeUnit({ stats: makeStats({ attack: 20 }) });
    const segments = describeSkillSegments(bloodthirst, berserker);
    expect(segmentsText(segments)).toBe('Strike one enemy within reach for 18 damage, healing you for 3.');
    expect(kinds(segments)).toEqual(['18:physical', '3:heal']);
  });

  it('gives a wound-scaled heal as its range', () => {
    const druid = makeUnit({ stats: makeStats({ magic: 30 }) });
    const range = healingRange(druid, emergencyBloom);
    expect(describeSkill(emergencyBloom, druid)).toContain(
      `for ${range.min}–${range.max}, more the more wounded they are`,
    );
  });

  it('counts the blows of a two-weapon attack', () => {
    const rogue = makeUnit({ stats: makeStats({ attack: 20 }) });
    const twoHands = basicAttackWith(undefined, true);
    const each = Math.max(1, Math.round(
      calculateDamage(rogue, makeUnit({ stats: makeStats({ defense: 0, magicDefense: 0 }) }), twoHands)
        * BALANCE.DUAL_WIELD_STRIKE_SCALE,
    ));
    expect(describeSkill(twoHands, rogue)).toContain(`twice for ${each} damage each`);
  });

  it('keeps the multiplier for a form skill the caster is not wearing the form for', () => {
    const druid = makeUnit({ stats: makeStats({ attack: 20 }) });
    const formSkill = EVERY_SKILL.find((s) => s.formSkill && s.damage)!;
    expect(describeSkill(formSkill, druid)).toMatch(/× your/);
  });

  it('keeps the rule without a caster', () => {
    expect(describeSkill(slash)).toBe('Strike one enemy within reach for 1.1× your Attack.');
    expect(describeSkill(heal)).toBe('Mend an ally up to 2 hexes away for 0.52× your Magic.');
  });

  it('renders every skill in the game legibly for a caster', () => {
    const hero = makeUnit({ stats: makeStats({ attack: 23, magic: 31 }) });
    const foe = makeUnit({ isPlayer: false, stats: makeStats({ attack: 23, magic: 31 }) });
    const bad: string[] = [];
    // A form skill keeps its multiplier for a caster not wearing the form
    for (const skill of EVERY_SKILL.filter((s) => !s.formSkill)) {
      for (const who of [hero, foe]) {
        const text = describeSkill(skill, who);
        if (/undefined|NaN|\d\.\d|, ,|\.\./.test(text) || text.length === 0) bad.push(`${skill.id}: ${text}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
