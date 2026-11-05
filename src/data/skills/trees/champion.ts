import { BALANCE } from '@/data/balanceConstants';
import { HeroClass, MasteryPath } from '@/models/types';
import { node } from '@/data/skills/trees/shared';

// ═══ CHAMPION ═══════════════════════════════════════════════════════════════

export const bulwark: MasteryPath = {
  id: 'bulwark',
  roles: ['tank'],
  heroClass: HeroClass.Warrior,
  signatureSkill: 'provoking_strike',
  nodes: [
    node(1, 0, 'bulwark_spite', {
      grantsPassive: 'intimidating',
    }),
    node(1, 1, 'bulwark_due', {
      modifier: { incomingSupportBonus: 0.15 },
    }),
    node(1, 2, 'bulwark_shielded_challenge', {
      grantsPassive: 'shieldedChallenge',
    }),
    node(1, 3, 'bulwark_retaliation', {
      grantsPassive: 'retaliation',
    }),
    node(1, 4, 'bulwark_braced', {
      grantsPassive: 'braced',
    }),
    node(2, 0, 'bulwark_reposition', {
      grantsSkill: 'reposition',
    }),
    node(2, 1, 'bulwark_challenge', {
      grantsSkill: 'challenge',
    }),
    node(2, 2, 'bulwark_intercept', {
      grantsSkill: 'intercept',
    }),
    node(2, 3, 'bulwark_bellow', {
      grantsSkill: 'bellow',
    }),
    node(3, 0, 'bulwark_vow', {
      grantsSkill: 'unbreakable_vow',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'bulwark_shield_avalanche', {
      grantsSkill: 'shield_avalanche',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'bulwark_reckoning', {
      grantsSkill: 'reckoning',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'bulwark_last_stand', {
      grantsPassive: 'lastStand',
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['bulwark_vow', 'bulwark_shield_avalanche', 'bulwark_reckoning'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 6, 'bulwark_loud', {
      modifier: { tauntDurationBonus: 1 },
      maxLevel: 1,
      sideTree: 'a',
      requires: ['bulwark_last_stand'],
    }),
    node(2, 7, 'bulwark_deep_plates', {
      modifier: { maxHpPercentBonus: 0.12 },
      sideTree: 'a',
      requires: ['bulwark_last_stand'],
    }),

    node(1, 10, 'bulwark_vengeance', {
      grantsPassive: 'vengeance',
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['bulwark_vow', 'bulwark_shield_avalanche', 'bulwark_reckoning'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 9, 'bulwark_spite_grows', {
      modifier: { thornsMultiplier: 0.25 },
      sideTree: 'b',
      requires: ['bulwark_vengeance'],
    }),
    node(2, 10, 'bulwark_anchored', {
      statBonus: { defense: 3, shieldPower: 8 },
      sideTree: 'b',
      requires: ['bulwark_vengeance'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'bulwark_rallying_taunt', {
      grantsPassive: 'rallyingTaunt',
      requires: ['bulwark_vow', 'bulwark_shield_avalanche', 'bulwark_reckoning'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'bulwark_unbowed', {
      statBonus: { defense: 4, magicDefense: 4 },
      requires: ['bulwark_vow', 'bulwark_shield_avalanche', 'bulwark_reckoning'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'bulwark_dropped_guard', {
      modifier: { tauntedExposure: BALANCE.ADVANCED_CHAMPION.DROPPED_GUARD_EXPOSURE },
      masteryRow: 2,
      requires: ['bulwark_vow', 'bulwark_shield_avalanche', 'bulwark_reckoning'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};

export const templar: MasteryPath = {
  id: 'templar',
  roles: ['damage', 'support'],
  heroClass: HeroClass.Warrior,
  signatureSkill: 'smite',
  nodes: [
    node(1, 0, 'templar_zealotry', {
      statBonus: { attack: 3 },
      modifier: { magicPercentBonus: 0.06 },
    }),
    node(1, 1, 'templar_vigil', {
      statBonus: { maxHp: 20, magicDefense: 2 },
    }),
    node(1, 2, 'templar_zeal', {
      grantsPassive: 'zeal',
    }),
    node(1, 3, 'templar_faith', {
      statBonus: { maxMana: 10 },
      modifier: { magicPercentBonus: 0.08 },
    }),
    node(1, 4, 'templar_blessed_hands', {
      grantsPassive: 'lifebloom',
    }),
    node(2, 0, 'templar_sanction', {
      grantsSkill: 'sanction',
    }),
    node(2, 1, 'templar_judgement', {
      grantsSkill: 'judgement',
    }),
    node(2, 2, 'templar_lay_on_hands', {
      grantsSkill: 'lay_on_hands',
    }),
    node(2, 3, 'templar_divine_light', {
      grantsSkill: 'divine_light',
    }),
    node(3, 0, 'templar_righteous_fury', {
      grantsSkill: 'righteous_fury',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'templar_martyr', {
      grantsSkill: 'martyr',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'templar_consecrate', {
      grantsSkill: 'consecrate',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'templar_reach', {
      grantsPassive: 'sacredRhythm',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['templar_righteous_fury', 'templar_martyr', 'templar_consecrate'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 6, 'templar_sword_of_the_word', {
      modifier: { singleTargetDamageBonus: 0.15 },
      sideTree: 'a',
      requires: ['templar_reach'],
    }),
    node(2, 7, 'templar_oath', {
      grantsPassive: 'oath',
      sideTree: 'a',
      requires: ['templar_reach'],
    }),

    node(1, 9, 'templar_steadfast', {
      grantsPassive: 'unstoppable',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['templar_righteous_fury', 'templar_martyr', 'templar_consecrate'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 8, 'templar_consecrated_ground', {
      modifier: { aoeDamageBonus: 0.15 },
      sideTree: 'b',
      requires: ['templar_steadfast'],
    }),
    node(2, 9, 'templar_mercy', {
      statBonus: { healPower: 12 },
      sideTree: 'b',
      requires: ['templar_steadfast'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'templar_aegis_of_faith', {
      modifier: { healGrantsDefense: 3 },
      requires: ['templar_righteous_fury', 'templar_martyr', 'templar_consecrate'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'templar_crusader', {
      statBonus: { attack: 5 },
      modifier: { magicPercentBonus: 0.1 },
      requires: ['templar_righteous_fury', 'templar_martyr', 'templar_consecrate'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'templar_carrying_word', {
      modifier: { allyHealSpill: BALANCE.ADVANCED_CHAMPION.CARRYING_WORD_SHARE },
      masteryRow: 2,
      requires: ['templar_righteous_fury', 'templar_martyr', 'templar_consecrate'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};

export const berserker: MasteryPath = {
  id: 'berserker',
  roles: ['damage'],
  heroClass: HeroClass.Warrior,
  signatureSkill: 'bloodthirst',
  nodes: [
    node(1, 0, 'berserker_reckless', {
      statBonus: { attack: 6, defense: -4, armourPen: 20 },
    }),
    node(1, 1, 'berserker_offhand_fury', {
      statBonus: { critChance: 10 },
    }),
    node(1, 2, 'berserker_blood_rush', {
      grantsPassive: 'bloodRush',
    }),
    node(1, 3, 'berserker_bloodscent', {
      grantsPassive: 'bloodscent',
    }),
    node(1, 4, 'berserker_wrath', {
      grantsPassive: 'wrath',
    }),
    node(2, 0, 'berserker_cleaving_throw', {
      grantsSkill: 'cleaving_throw',
    }),
    node(2, 1, 'berserker_rend', {
      grantsSkill: 'rend',
    }),
    node(2, 2, 'berserker_executioner', {
      grantsSkill: 'executioner',
    }),
    node(2, 3, 'berserker_blood_price', {
      grantsSkill: 'blood_price',
    }),
    node(3, 0, 'berserker_whirlwind', {
      grantsSkill: 'whirlwind',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'berserker_carnage', {
      grantsSkill: 'carnage',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'berserker_undying', {
      grantsPassive: 'undyingFury',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'berserker_frenzy', {
      grantsPassive: 'frenzy',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['berserker_whirlwind', 'berserker_carnage', 'berserker_undying'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 6, 'berserker_rhythm', {
      grantsPassive: 'cadence',
      sideTree: 'a',
      requires: ['berserker_frenzy'],
    }),
    node(2, 7, 'berserker_onrush', {
      grantsPassive: 'momentum',
      sideTree: 'a',
      requires: ['berserker_frenzy'],
    }),

    node(1, 9, 'berserker_unstoppable', {
      grantsPassive: 'unstoppable',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['berserker_whirlwind', 'berserker_carnage', 'berserker_undying'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 8, 'berserker_savage_edge', {
      grantsPassive: 'savageEdge',
      sideTree: 'b',
      requires: ['berserker_unstoppable'],
    }),
    node(2, 9, 'berserker_killing_eye', {
      grantsPassive: 'killingEye',
      sideTree: 'b',
      requires: ['berserker_unstoppable'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'berserker_red_mist', {
      grantsPassive: 'redMist',
      requires: ['berserker_whirlwind', 'berserker_carnage', 'berserker_undying'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'berserker_gorge', {
      modifier: { lifestealBonus: 0.08 },
      requires: ['berserker_whirlwind', 'berserker_carnage', 'berserker_undying'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'berserker_bottomless_thirst', {
      modifier: { thirstMissingBonus: BALANCE.ADVANCED_CHAMPION.BOTTOMLESS_THIRST_BONUS },
      masteryRow: 2,
      requires: ['berserker_whirlwind', 'berserker_carnage', 'berserker_undying'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};
