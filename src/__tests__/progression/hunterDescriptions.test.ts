import { nodeDescription } from '@/__tests__/support/masteryNodeText';
import { skillDescription } from '@/data/gameText';
import { BALANCE } from '@/data/balanceConstants';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { STATUS_DISPLAY, statusDescription } from '@/data/display/statusDisplay';
import { resolvePassives } from '@/systems/combat/passives';
import { skillEffects } from '@/systems/combat/statusEffects';
import { BOSS_IGNORED_DISABLES } from '@/systems/combat/bossControl';
import {
  AfflictionType, AuraType, HeroClass, HeroSkill, MasteryNode, StatusEffectType,
} from '@/models/types';
import { at, makeEffect, makeUnit } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * The Hunter paths say what they do.
 *
 * Marksman, Skirmisher and Shadowblade were not redesigned, but their text could
 * mislead a player about an encounter counter: a silence "on an isolated target"
 * that silences anyone, a stun that "costs the next turn" of a boss that ignores
 * it, a Creeping Death that "turns every dose" without consuming one. A node or
 * skill description is a claim, so each claim here is checked against the effect
 * it resolves to:
 *
 * - every control or damage-over-time word names a status the skill applies, and
 *   every control status it applies is named;
 * - anything said about a boss or an interrupt matches an ignored disable;
 * - a gate is described as a gate, and only a gate;
 * - the few numbers stated in words are the numbers the skill resolves to.
 */

const byId = new Map<string, HeroSkill>(
  [...ALL_SKILLS, ...MASTERY_SKILLS].map((s) => [s.id, s]),
);
const HUNTER_PATHS = MASTERY_PATHS.filter((p) => p.heroClass === HeroClass.Ranger);

interface Claim {
  skill: HeroSkill;
  /** Where the text came from, for the failure message. */
  source: string;
  text: string;
}

/** Every description a player can read for a Hunter skill: the skill's and its node's. */
const claims: Claim[] = HUNTER_PATHS.flatMap((path) => {
  const out: Claim[] = [];
  const signature = byId.get(path.signatureSkill as string)!;
  out.push({ skill: signature, source: `${path.id}/${signature.id} skill`, text: skillDescription(signature) });
  for (const node of path.nodes) {
    if (!node.grantsSkill) continue;
    const skill = byId.get(node.grantsSkill)!;
    out.push({ skill, source: `${path.id}/${node.id} skill`, text: skillDescription(skill) });
    out.push({ skill, source: `${path.id}/${node.id} node`, text: masteryNodeDescription(node) });
  }
  return out;
});

/** What each word in a description promises, in the statuses that can keep it. */
const WORDS: { word: RegExp; kept: StatusEffectType[]; label: string }[] = [
  { word: /\bsilenc/i, kept: [AfflictionType.Silence], label: 'Silence' },
  { word: /\bstun/i, kept: [AfflictionType.Stun], label: 'Stun' },
  { word: /\broot\b|\btangle/i, kept: [AfflictionType.Root], label: 'Root' },
  // The Bladestorm aura is the one thing that bleeds without a Bleed skill effect
  { word: /\bbleed/i, kept: [AfflictionType.Bleed, AuraType.BladeStorm], label: 'Bleed' },
  {
    word: /\bpoison|\bdose|\bvenom/i,
    kept: [AfflictionType.Poison, AuraType.Envenomed],
    label: 'Poison',
  },
  { word: /\bmark(ed)?\b/i, kept: [AfflictionType.Mark], label: 'Mark' },
];

const appliedTypes = (skill: HeroSkill): StatusEffectType[] => [
  ...skillEffects(skill).map((e) => e.type),
  // Concussive Shot's Stun lands on a collision rather than on the hit
  ...(skill.collisionEffect ? [skill.collisionEffect.type] : []),
  ...skillEffects({ ...skill, appliesEffect: skill.occupiedVariant?.appliesEffect }).map((e) => e.type),
];

describe('Hunter descriptions against what the skills apply', () => {
  it.each(claims.map((c) => [c.source, c] as const))(
    '%s only names statuses it applies',
    (_source, claim) => {
      const applied = appliedTypes(claim.skill);
      for (const { word, kept, label } of WORDS) {
        // Aimed Shot's "marked" is a condition it reads, not a status it lays
        if (label === 'Mark' && claim.skill.bonusVs?.condition === 'marked') continue;
        // Assassinate's mark is its Death Mark, laid by `deathMark` rather than `appliesEffect`
        if (label === 'Mark' && claim.skill.deathMark) continue;
        // Assassinate's "poisoned" is the gate it reads, not a dose it lays
        const gated = label === 'Poison' && !!claim.skill.requiresTarget?.includes('poisoned');
        if (word.test(claim.text)) {
          expect([claim.source, label, gated || kept.some((k) => applied.includes(k))]).toEqual([
            claim.source, label, true,
          ]);
        }
      }
    },
  );

  it.each(claims.map((c) => [c.source, c] as const))(
    '%s names every control status it lands',
    (_source, claim) => {
      const applied = appliedTypes(claim.skill);
      for (const control of [AfflictionType.Stun, AfflictionType.Silence, AfflictionType.Root]) {
        if (!applied.includes(control)) continue;
        const entry = WORDS.find((w) => w.kept.includes(control))!;
        expect([claim.source, control, entry.word.test(claim.text)]).toEqual([claim.source, control, true]);
      }
    },
  );

  it('anything said about a boss, an interrupt or a cancel belongs to a disable a boss ignores', () => {
    for (const claim of claims) {
      if (!/\bboss\b|interrupt|cancel|cut short/i.test(claim.text)) continue;
      const applied = appliedTypes(claim.skill);
      expect([claim.source, BOSS_IGNORED_DISABLES.some((d) => applied.includes(d))]).toEqual([
        claim.source, true,
      ]);
    }
  });

  it('a skill that lands a disable a boss ignores says what a boss does with it', () => {
    for (const claim of claims) {
      if (!claim.source.endsWith('skill')) continue;
      if (!appliedTypes(claim.skill).some((t) => BOSS_IGNORED_DISABLES.includes(t as AfflictionType))) continue;
      expect([claim.source, /\bboss\b/i.test(claim.text)]).toEqual([claim.source, true]);
    }
  });

  it('no Hunter text claims a counter that is a plain damage or a bleed', () => {
    for (const claim of claims) {
      if (!/counter|interrupt/i.test(claim.text)) continue;
      expect(appliedTypes(claim.skill).some((t) => BOSS_IGNORED_DISABLES.includes(t as AfflictionType))).toBe(true);
    }
  });

  it('a gate is described as a gate, and a skill without one is not', () => {
    for (const claim of claims) {
      const gates = claim.skill.requiresTarget ?? [];
      if (/already going down|going down|near death/i.test(claim.text)) {
        expect([claim.source, gates.includes('executable')]).toEqual([claim.source, true]);
      }
      if (/\bonly\b|\bneeds?\b|\brequires?\b/i.test(claim.text) && gates.length === 0) {
        throw new Error(`${claim.source} describes a requirement it does not have: "${claim.text}"`);
      }
      if (gates.includes('poisoned')) expect(claim.text).toMatch(/poison/i);
    }
  });

  it('an isolation bonus is a damage bonus, not a condition on the status', () => {
    const garrote = byId.get('garrote')!;
    expect(garrote.requiresTarget).toBeUndefined();
    expect(garrote.bonusVs?.condition).toBe('isolated');
    expect(skillDescription(garrote)).toMatch(/harder/);
    expect(skillDescription(garrote)).toMatch(/Silence/i);
  });

  it('a barbed or creeping dose boosts the hit and does not consume the dose it reads', () => {
    for (const id of ['creeping_death', 'barbed_blades']) {
      const skill = byId.get(id)!;
      expect(skill.amplifiedBy).toBeDefined();
      expect(skill.detonates).toBeUndefined();
      expect(skillDescription(skill)).not.toMatch(/turn(s)? at once|consume|spend/i);
    }
  });
});

describe('Hunter numbers stated in words', () => {
  const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  /** Every number word a Hunter description is allowed to use, and the number it resolves to. */
  const RESOLVED: Record<string, () => number> = {
    'hemlock:three': () => skillEffects(byId.get('hemlock')!)[0].duration,
    'flurry:two': () => BALANCE.FLURRY_FOLLOWUPS_SINGLE,
    'bladestorm:two': () => BALANCE.BLADESTORM_RADIUS,
    'covering_fire:two': () => byId.get('covering_fire')!.reaction!.duration,
    'knife_dance:three': () => (byId.get('knife_dance')!.chainJumps ?? 0) + 1,
    'concussive_shot:two': () => byId.get('concussive_shot')!.pushDistance!,
  };

  it('every number word is one a test resolves', () => {
    for (const claim of claims) {
      for (const word of Object.keys(NUMBER_WORDS)) {
        if (!new RegExp(`\\b${word}\\b`, 'i').test(claim.text)) continue;
        const key = `${claim.skill.id}:${word}`;
        expect([claim.source, key in RESOLVED]).toEqual([claim.source, true]);
        expect(RESOLVED[key]()).toBe(NUMBER_WORDS[word]);
      }
    }
  });

  it('Rapid Fire and Flurry state the burst they fire', () => {
    expect(statusDescription(AuraType.RapidFire)).toContain(`${BALANCE.RAPID_FIRE_STRIKES} times`);
    const each = Math.round((BALANCE.RAPID_FIRE_TOTAL / BALANCE.RAPID_FIRE_STRIKES) * 100);
    expect(statusDescription(AuraType.RapidFire)).toContain(`${each}% each`);
    expect(statusDescription(AuraType.Flurry)).toMatch(/two after a single-target attack and one after an area attack/);
    expect([BALANCE.FLURRY_FOLLOWUPS_SINGLE, BALANCE.FLURRY_FOLLOWUPS_AREA]).toEqual([2, 1]);
  });

  it('Bladestorm says unlimited movement and the sweep reaches only the hexes beside the carrier', () => {
    expect(statusDescription(AuraType.BladeStorm)).toMatch(/without limit/);
    // Wider than the whole arena (|q| <= 3, |r| <= 5): it never runs out of ground
    expect(BALANCE.BLADESTORM_MOVE).toBeGreaterThanOrEqual(10);
    expect(statusDescription(AuraType.BladeStorm)).toMatch(/standing next to you/);
  });
});

describe('Hunter node text against the passives and stats it grants', () => {
  const nodes: { node: MasteryNode; path: string }[] = HUNTER_PATHS.flatMap((p) =>
    p.nodes.map((node) => ({ node, path: p.id })),
  );

  it('Nightfall refunds only while the Shadowblade is hidden, as its text says', () => {
    const node = nodes.find((n) => n.node.id === 'shadow_nightfall')!.node;
    expect(node.grantsPassive).toBe('nightfall');
    expect(masteryNodeDescription(node)).toMatch(/while you are hidden/);
    const visible = makeUnit({ id: 's', position: at(0, 0), passives: ['nightfall'] });
    const hidden = makeUnit({
      id: 's', position: at(0, 0), passives: ['nightfall'],
      activeEffects: [makeEffect(AuraType.Stealth)],
    });
    expect(resolvePassives('onTurnStart', { self: visible, allUnits: [visible] })).toEqual([]);
    expect(resolvePassives('onTurnStart', { self: hidden, allUnits: [hidden] })[0]?.kind).toBe('refundCooldown');
  });

  it('every node with a stat bonus names the stat it raises, or says nothing contradicting it', () => {
    for (const { node, path } of nodes) {
      if (!node.statBonus?.speed) continue;
      // A Speed node must not promise turn order, only the chance of an extra turn
      expect([path, node.id, /\bfirst\b|\balways\b/i.test(masteryNodeDescription(node))]).toEqual([path, node.id, false]);
    }
  });

  it('Venom Transfer and Hemlock say what the tree resolves them to', () => {
    expect(nodes.find((n) => n.node.id === 'shadow_venom_transfer')!.node.grantsPassive).toBe('venomTransfer');
    expect(byId.get('hemlock')!.appliesEffect).toMatchObject({
      type: AuraType.Envenomed, duration: BALANCE.HEMLOCK_DURATION,
    });
  });
});
