import { findMasteryNode, findMasteryPath } from '@/data/skills/masteryData';
import { absoluteZero, aimedShot, arc, bladeRecall, frostbite, ignite, lifebloomSkill, markTarget, provokingStrike, shadowstep } from '@/data/skills/masterySkills';
import { boulderLeap, canopyGuard, groundSlam, rootlashSweep, stoneFist, timberCrush } from '@/data/skills/skillData';
import { tremor } from '@/data/skills/mastery/druid';
import { nodeSimpleText, skillSimpleText } from '@/data/display/simpleText';
import { bloodthirst } from '@/data/skills/masterySkills';
import { withBloodRush } from '@/systems/combat/passives';
import { chargeStage } from '@/systems/combat/chargedCast';
import { nodeSkillAt } from '@/systems/progression/mastery';
import { AuraType } from '@/models/types';
import { makeUnit } from '../support/fixtures';
import { masteryNodeDescription } from '@/data/display/masteryText';

/**
 * Simple descriptions, as rules: literal, short, resolved to the rank on show,
 * and present for every Hydromancer node and skill. Stat nodes on every path get
 * theirs from their own numbers, so none of them can be missing or drift.
 */

const node = (id: string) => findMasteryNode(id)!.node;
const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/).length;

describe('Simple descriptions', () => {
  it('states a stat node as one rank-correct line', () => {
    expect(nodeSimpleText(node('hydro_deep_well'), 1)).toBe('Gives +11 MP. +6% Magic.');
    expect(nodeSimpleText(node('hydro_deep_well'), 2)).toBe('Gives +15 MP. +8% Magic.');
    // An unowned node reads at the rank it would be bought at
    expect(nodeSimpleText(node('hydro_deep_well'), 0)).toBe(nodeSimpleText(node('hydro_deep_well'), 1));
  });

  it('adds a modifier as its own literal sentence', () => {
    const text = nodeSimpleText(node('hydro_thick_ice'), 2)!;
    expect(text).toMatch(/^Gives \+20 HP\./);
    expect(text).toMatch(/\+6% Magic\./);
    expect(text).toMatch(/Shields you grant absorb \+20%\./);
  });

  it('resolves the barrage count to the rank shown, never all three', () => {
    const at = (level: number) => nodeSimpleText(node('hydro_glacial_barrage'), level)!;
    expect(at(1)).toContain('5 ice shards');
    expect(at(2)).toContain('6 ice shards');
    expect(at(3)).toContain('7 ice shards');
    expect(at(2)).not.toMatch(/5\/6\/7/);
  });

  it('resolves passive figures to the rank shown', () => {
    expect(nodeSimpleText(node('hydro_shatterpoint'), 1)).toContain('45%');
    expect(nodeSimpleText(node('hydro_shatterpoint'), 3)).toContain('75%');
  });

  it('covers every Hydromancer node in one or two sentences', () => {
    for (const n of findMasteryPath('hydromancer')!.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('covers every Hydromancer skill, and names Brittle wherever a Chill can freeze', () => {
    const path = findMasteryPath('hydromancer')!;
    const skills = [frostbite, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!)];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
      if (/Frozen|freezes/.test(text!)) expect(text).toMatch(/Brittle/);
    }
  });

  it('describes Frostbite as two hits for a Hydromancer holding Twin Fangs', () => {
    const plain = makeUnit({ passives: [] });
    const fanged = makeUnit({ passives: ['twinFangs'] });
    expect(skillSimpleText(frostbite, plain)).not.toMatch(/twice/);
    expect(skillSimpleText(frostbite, fanged)).toMatch(/twice/);
  });

  it('describes the half of Absolute Zero that the button will do', () => {
    const charging = makeUnit({ activeEffects: [{ type: AuraType.Charging, magnitude: 1, duration: 1 }] });
    expect(skillSimpleText(absoluteZero)).toMatch(/^Charge/);
    expect(skillSimpleText(chargeStage(charging, absoluteZero))).toMatch(/^Fire the charged beam/);
  });

  it('covers every Marksman node and skill in one or two sentences', () => {
    const path = findMasteryPath('marksman')!;
    for (const n of path.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
    expect(sentences(skillSimpleText(markTarget)!)).toBeLessThanOrEqual(2);
  });

  it('resolves Marksman passive numbers to the rank shown', () => {
    expect(nodeSimpleText(node('marks_mark_and_move'), 1)).toMatch(/up to 1 hex before/);
    expect(nodeSimpleText(node('marks_mark_and_move'), 3)).toMatch(/up to 3 hexes before/);
    expect(nodeSimpleText(node('marks_settle_in'), 1)).toMatch(/ignores 15% of defense/);
    expect(nodeSimpleText(node('marks_settle_in'), 3)).toMatch(/ignores 25% of defense/);
  });

  it('describes the half of Aimed Shot the button will do, and Mark Target with Mark and Move', () => {
    const aiming = makeUnit({ activeEffects: [{ type: AuraType.Aiming, magnitude: 1, duration: 1, aimAt: 'x' }] });
    expect(skillSimpleText(aimedShot)).toMatch(/^Aim at one enemy/);
    expect(skillSimpleText(chargeStage(aiming, aimedShot))).toMatch(/^Shoot the enemy you aimed at/);
    expect(skillSimpleText(markTarget, makeUnit({ passives: ['markAndMove'] }))).toMatch(/move a short distance/);
    expect(skillSimpleText(markTarget, makeUnit({ passives: [] }))).not.toMatch(/move/);
  });

  it('covers every Skirmisher node and skill in one or two sentences', () => {
    const path = findMasteryPath('skirmisher')!;
    for (const n of path.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
    const skills = [bladeRecall, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!)];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
  });

  it('describes Blade Recall as a pull, and as a throw then a pull with Fan of Blades', () => {
    expect(skillSimpleText(bladeRecall, makeUnit({ passives: [] }))).toMatch(/^Pull your blades/);
    expect(skillSimpleText(bladeRecall, makeUnit({ passives: ['fanOfBlades'] }))).toMatch(/^Throw blades .* then pull/);
  });

  it('resolves the Skirmisher passives and Smoke Bomb to the rank shown', () => {
    expect(nodeSimpleText(node('skirm_sharpened_steel'), 1)).toContain('ignores 15% of defense');
    expect(nodeSimpleText(node('skirm_sharpened_steel'), 3)).toContain('ignores 25% of defense');
    expect(nodeSimpleText(node('skirm_fan_of_blades'), 1)).toContain('75% of its damage');
    expect(nodeSimpleText(node('skirm_smoke'), 1)).toContain('2 turns');
    expect(nodeSimpleText(node('skirm_smoke'), 3)).toContain('4 turns');
  });

  it('covers every Shadowblade node and skill in one or two sentences', () => {
    const path = findMasteryPath('shadowblade')!;
    for (const n of path.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
    const skills = [shadowstep, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!)];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
  });

  it('names both Shadowstep halves, and the return only for a holder of Shadow Echo', () => {
    const plain = skillSimpleText(shadowstep, makeUnit({ passives: [] }))!;
    expect(plain).toMatch(/Stealth/);
    expect(plain).toMatch(/Poison/);
    expect(plain).not.toMatch(/return/);
    expect(skillSimpleText(shadowstep, makeUnit({ passives: ['shadowEcho'] }))).toMatch(/return .* without spending your action/);
  });

  it('states Shadow Echo’s flat price and what each rank adds, and Assassinate as a delayed mark', () => {
    expect(nodeSimpleText(node('shadow_echo'), 1)).toContain('6 mana');
    expect(nodeSimpleText(node('shadow_echo'), 1)).not.toContain('Stealth');
    expect(nodeSimpleText(node('shadow_echo'), 2)).toContain('gain Stealth');
    expect(nodeSimpleText(node('shadow_echo'), 3)).toContain('critical hit');
    expect(nodeSimpleText(node('shadow_assassinate'), 1)).toMatch(/^Mark one enemy anywhere/);
  });

  it('covers every Bulwark node and skill in one or two sentences', () => {
    const path = findMasteryPath('bulwark')!;
    for (const n of path.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
    const skills = [provokingStrike, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!)];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
  });

  it('resolves the Bulwark passives to the rank shown', () => {
    expect(nodeSimpleText(node('bulwark_last_stand'), 1)).toContain('20% less damage');
    expect(nodeSimpleText(node('bulwark_last_stand'), 3)).toContain('40% less damage');
    expect(nodeSimpleText(node('bulwark_vengeance'), 1)).toContain('25% chance');
    expect(nodeSimpleText(node('bulwark_vengeance'), 3)).toContain('75% chance');
    expect(nodeSimpleText(node('bulwark_shielded_challenge'), 2)).toContain('30% of your Attack');
  });

  it('mentions the Barrier on Provoking Strike only for a Bulwark holding Shielded Challenge', () => {
    expect(skillSimpleText(provokingStrike, makeUnit({ passives: [] }))).not.toMatch(/Barrier/);
    expect(skillSimpleText(provokingStrike, makeUnit({ passives: ['shieldedChallenge'] }))).toMatch(/Barrier/);
  });

  it('builds a stat line for every pure stat node on every path', () => {
    for (const path of ['bulwark', 'pyromancer', 'stormcaller', 'marksman'] as const) {
      for (const n of findMasteryPath(path)!.nodes) {
        if (n.grantsSkill || n.grantsPassive || !n.statBonus) continue;
        expect(nodeSimpleText(n, 1)).toMatch(/^Gives \+/);
      }
    }
  });

  it('covers every Lifewarden node in one or two sentences', () => {
    for (const n of findMasteryPath('lifewarden')!.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('covers every Lifewarden skill and the three the Treant fights with', () => {
    const path = findMasteryPath('lifewarden')!;
    const skills = [
      lifebloomSkill, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!),
      timberCrush, rootlashSweep, canopyGuard,
    ];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
  });

  it('describes Rooted Vitality as the regeneration it is, with no Root', () => {
    const text = nodeSimpleText(node('life_rooted_vitality'), 2)!;
    expect(text).toBe('Give one ally or yourself healing over time.');
    expect(text).not.toMatch(/Root/);
  });

  it('resolves the Lifewarden passives to the rank shown', () => {
    expect(nodeSimpleText(node('life_shared_bloom'), 1)).toContain('38%');
    expect(nodeSimpleText(node('life_shared_bloom'), 3)).toContain('63%');
    expect(nodeSimpleText(node('life_second_spring'), 1)).toContain('15% less damage');
    expect(nodeSimpleText(node('life_second_spring'), 3)).toContain('25% less damage');
    expect(nodeSimpleText(node('life_cycle_of_life'), 2)).toContain('60% of your Magic');
  });

  it('mentions the second heal on Lifebloom only for a Lifewarden holding Shared Bloom', () => {
    expect(skillSimpleText(lifebloomSkill, makeUnit({ passives: [] }))).not.toMatch(/also healed/);
    expect(skillSimpleText(lifebloomSkill, makeUnit({ passives: ['sharedBloom'] }))).toMatch(/also healed/);
  });

  it('leaves a skill with no copy yet to the detailed view', () => {
    expect(skillSimpleText({ ...frostbite, id: 'not_a_skill' as never })).toBeUndefined();
  });
});

describe('Pyromancer Simple descriptions', () => {
  it('covers every Pyromancer node in one or two sentences', () => {
    for (const n of findMasteryPath('pyromancer')!.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('covers every Pyromancer skill in one or two sentences', () => {
    const path = findMasteryPath('pyromancer')!;
    const skills = [ignite, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!)];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
  });

  it('says the Fire Elemental explodes on death, in the node and the skill', () => {
    expect(nodeSimpleText(node('pyro_elemental'), 1)).toMatch(/explodes on death/);
    expect(masteryNodeDescription(findMasteryNode('pyro_elemental')!.node)).toMatch(/explodes on death/);
  });

  it('never gives Burning Out impact damage, nor Ember Shroud a Burn or a shield', () => {
    expect(nodeSimpleText(node('pyro_burning_out'), 1)).not.toMatch(/damage/);
    const shroud = nodeSimpleText(node('pyro_ember_shroud'), 1)!;
    expect(shroud).toMatch(/Flame Guard/);
    expect(shroud).not.toMatch(/Burn|Barrier|absorb/);
  });

  it('describes the extra stack only for a Pyromancer holding Fuel the Flame, at the rank shown', () => {
    expect(skillSimpleText(ignite, makeUnit({ passives: [] }))).not.toMatch(/extra/);
    expect(skillSimpleText(ignite, makeUnit({ passives: ['fuelTheFlame'] }))).toMatch(/extra Burn stack/);
    expect(nodeSimpleText(node('pyro_fuel_the_flame'), 1)).toContain('45%');
    expect(nodeSimpleText(node('pyro_fuel_the_flame'), 3)).toContain('75%');
  });
});

describe('Stormcaller Simple descriptions', () => {
  it('covers every Stormcaller node in one or two sentences', () => {
    for (const n of findMasteryPath('stormcaller')!.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('covers every Stormcaller skill in one or two sentences', () => {
    const path = findMasteryPath('stormcaller')!;
    const skills = [arc, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!)];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
  });

  it('resolves the Thunder Elemental share and Skyfall damage to the rank shown', () => {
    expect(nodeSimpleText(node('storm_thunder_elemental'), 1)).toContain('27% of your MAG');
    expect(nodeSimpleText(node('storm_thunder_elemental'), 2)).toContain('45% of your MAG');
    expect(nodeSimpleText(node('storm_thunder_elemental'), 3)).toContain('63% of your MAG');
    expect(nodeSimpleText(node('storm_skyfall'), 2)).toContain('up to three different random enemies');
    expect(nodeSimpleText(node('storm_skyfall'), 2)).toContain('0.57x MAG');
  });

  it('gives Tempest its three-hex reach, and Conductive Arc its rank figure', () => {
    expect(nodeSimpleText(node('storm_tempest'), 1)).toContain('within 3 hexes of you');
    expect(nodeSimpleText(node('storm_conductive_arc'), 1)).toContain('38%');
    expect(nodeSimpleText(node('storm_conductive_arc'), 3)).toContain('63%');
  });

  it('never calls the elemental a unit that takes turns', () => {
    expect(nodeSimpleText(node('storm_thunder_elemental'), 2)).toMatch(/without taking its own turn/);
  });
});

describe('Stoneshaper Simple descriptions', () => {
  it('covers every Stoneshaper node in one or two sentences', () => {
    for (const n of findMasteryPath('stoneshaper')!.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('covers every Stoneshaper skill and the three the Stone Elemental fights with', () => {
    const path = findMasteryPath('stoneshaper')!;
    const skills = [tremor, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!), stoneFist, groundSlam, boulderLeap];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
  });

  it('resolves Crumble, Aftershock and Rubble Recovery to the rank shown', () => {
    expect(nodeSimpleText(node('stone_crumble'), 1)).toContain('by 5 ');
    expect(nodeSimpleText(node('stone_crumble'), 3)).toContain('by 7 ');
    expect(nodeSimpleText(node('stone_aftershock'), 1)).toContain('20%');
    expect(nodeSimpleText(node('stone_aftershock'), 3)).toContain('40%');
    expect(nodeSimpleText(node('stone_rubble_recovery'), 2)).toContain('25%');
  });

  it('mentions the repeat eruption on Tremor only for a Stoneshaper holding Aftershock', () => {
    expect(skillSimpleText(tremor, makeUnit({ passives: [] }))).not.toMatch(/again/);
    expect(skillSimpleText(tremor, makeUnit({ passives: ['aftershock'] }))).toMatch(/again/);
  });
});

describe('Berserker Simple descriptions', () => {
  it('covers every Berserker node in one or two sentences', () => {
    for (const n of findMasteryPath('berserker')!.nodes) {
      for (const level of [1, 2, 3]) {
        const text = nodeSimpleText(n, level);
        expect({ id: n.id, text }).toEqual({ id: n.id, text: expect.any(String) });
        expect(sentences(text!)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('covers every Berserker skill, Bloodthirst with and without Blood Rush', () => {
    const path = findMasteryPath('berserker')!;
    const rushed = withBloodRush(bloodthirst, { bloodRush: { level: 2, scale: 1 } });
    const skills = [bloodthirst, rushed, ...path.nodes.filter((n) => n.grantsSkill).map((n) => nodeSkillAt(n, 2)!)];
    for (const s of skills) {
      const text = skillSimpleText(s);
      expect({ id: s.id, text }).toEqual({ id: s.id, text: expect.any(String) });
      expect(sentences(text!)).toBeLessThanOrEqual(2);
    }
    expect(skillSimpleText(bloodthirst)).not.toMatch(/Dash/);
    expect(skillSimpleText(rushed)).toContain('Dash up to 2 hexes');
  });

  it('resolves Blood Rush to the rank shown, never all three', () => {
    expect(nodeSimpleText(node('berserker_blood_rush'), 1)).toContain('up to 1 hex');
    expect(nodeSimpleText(node('berserker_blood_rush'), 2)).toContain('up to 2 hexes');
    expect(nodeSimpleText(node('berserker_blood_rush'), 3)).toContain('up to 3 hexes');
    expect(nodeSimpleText(node('berserker_blood_rush'), 2)).not.toMatch(/2\/3\/4/);
  });

  it('gives Carnage two full hits, and Undying its two turns', () => {
    expect(nodeSimpleText(node('berserker_carnage'), 2)).toMatch(/twice at full strength/);
    expect(nodeSimpleText(node('berserker_carnage'), 2)).not.toMatch(/four|half/);
    expect(nodeSimpleText(node('berserker_undying'), 2)).toMatch(/two of your turns/);
  });

  it('says Bleed refreshes rather than stacks wherever Rend applies it', () => {
    expect(nodeSimpleText(node('berserker_rend'), 2)).toMatch(/instead of stacking/);
  });
});
