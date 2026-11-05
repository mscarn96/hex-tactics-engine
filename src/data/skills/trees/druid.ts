import { BALANCE } from '@/data/balanceConstants';
import { HeroClass, MasteryPath } from '@/models/types';
import { node } from '@/data/skills/trees/shared';

// ═══ DRUID ══════════════════════════════════════════════════════════════════

export const lifewarden: MasteryPath = {
  id: 'lifewarden',
  roles: ['support'],
  heroClass: HeroClass.Healer,
  signatureSkill: 'lifebloom_skill',
  nodes: [
    node(1, 0, 'life_cycle_of_life', {
      grantsPassive: 'cycleOfLife',
    }),
    node(1, 1, 'life_second_spring', {
      grantsPassive: 'secondSpring',
    }),
    node(1, 2, 'life_shared_bloom', {
      grantsPassive: 'sharedBloom',
    }),
    node(1, 3, 'life_lingering_growth', {
      grantsPassive: 'lifebloom',
    }),
    node(1, 4, 'life_barkskin', {
      modifier: { healGrantsDefense: 3 },
    }),
    node(2, 0, 'life_rooted_vitality', {
      grantsSkill: 'rooted_vitality',
    }),
    node(2, 1, 'life_thornrow', {
      grantsSkill: 'thornrow',
    }),
    node(2, 2, 'life_warding_bloom', {
      grantsSkill: 'warding_bloom',
    }),
    node(2, 3, 'life_second_wind', {
      grantsSkill: 'emergency_bloom',
    }),
    node(3, 0, 'life_wellspring', {
      grantsSkill: 'wellspring',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'life_wild_sanctuary', {
      grantsSkill: 'wild_sanctuary',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'life_treant', {
      grantsSkill: 'summon_treant',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 8, 'life_far_reach', {
      modifier: { skillRangeBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['life_wellspring', 'life_wild_sanctuary', 'life_treant'],
      requiresCount: 1,
    }),
    node(2, 7, 'life_deep_loam', {
      modifier: { shieldPowerBonus: 0.2 },
      sideTree: 'a',
      requires: ['life_far_reach'],
    }),
    node(2, 8, 'life_patient_hands', {
      statBonus: { manaRegen: 3 },
      sideTree: 'a',
      requires: ['life_far_reach'],
    }),

    node(1, 10, 'life_broad_bloom', {
      modifier: { aoeRadiusBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['life_wellspring', 'life_wild_sanctuary', 'life_treant'],
      requiresCount: 1,
    }),
    node(2, 9, 'life_overgrowth', {
      modifier: { regenMagnitudeBonus: 0.25 },
      sideTree: 'b',
      requires: ['life_broad_bloom'],
    }),
    node(2, 10, 'life_communion', {
      modifier: { healRestoresMana: 4 },
      sideTree: 'b',
      requires: ['life_broad_bloom'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'life_overflowing_grace', {
      modifier: { overhealBarrier: 0.5 },
      requires: ['life_wellspring', 'life_wild_sanctuary', 'life_treant'],
      requiresCount: 1,
    }),
    node(4, 1, 'life_verdant_hands', {
      statBonus: { healPower: 12 },
      modifier: { magicPercentBonus: 0.06 },
      requires: ['life_wellspring', 'life_wild_sanctuary', 'life_treant'],
      requiresCount: 1,
    }),
    node(4, 2, 'life_evergreen', {
      statBonus: { maxMana: 15 },
      modifier: { regenMagnitudeBonus: 0.2 },
      requires: ['life_wellspring', 'life_wild_sanctuary', 'life_treant'],
      requiresCount: 1,
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'life_last_bloom', {
      modifier: { hotBloomShare: BALANCE.ADVANCED_DRUID.LAST_BLOOM_SHARE },
      masteryRow: 2,
      requires: ['life_wellspring', 'life_wild_sanctuary', 'life_treant'],
      requiresCount: 1,
    }),
  ],
};

export const stoneshaper: MasteryPath = {
  id: 'stoneshaper',
  roles: ['support', 'damage'],
  heroClass: HeroClass.Healer,
  signatureSkill: 'tremor',
  nodes: [
    node(1, 0, 'stone_aegis', {
      modifier: { shieldPowerBonus: 0.2 },
    }),
    node(1, 1, 'stone_deep_roots', {
      statBonus: { maxMana: 12 },
      modifier: { magicPercentBonus: 0.1 },
    }),
    node(1, 2, 'stone_aftershock', {
      grantsPassive: 'aftershock',
    }),
    node(1, 3, 'stone_rubble_recovery', {
      grantsPassive: 'rubbleRecovery',
    }),
    node(1, 4, 'stone_crumble', {
      grantsPassive: 'crumble',
    }),
    node(2, 0, 'stone_upheaval', {
      grantsSkill: 'upheaval',
    }),
    node(2, 1, 'stone_stoneskin', {
      grantsSkill: 'stoneskin',
    }),
    node(2, 2, 'stone_grasping', {
      grantsSkill: 'grasping_earth',
    }),
    node(2, 3, 'stone_ward', {
      grantsSkill: 'stone_ward',
    }),
    node(3, 0, 'stone_heart', {
      grantsSkill: 'stone_heart',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'stone_living_stone', {
      grantsSkill: 'living_stone',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'stone_bedrock_stand', {
      grantsSkill: 'bedrock_stand',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'stone_immovable', {
      grantsPassive: 'immovable',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['stone_heart', 'stone_living_stone', 'stone_bedrock_stand'],
      requiresCount: 1,
    }),
    node(2, 6, 'stone_unyielding', {
      grantsPassive: 'unyielding',
      sideTree: 'a',
      requires: ['stone_immovable'],
    }),
    node(2, 7, 'stone_ballast', {
      grantsPassive: 'groundedFocus',
      sideTree: 'a',
      requires: ['stone_immovable'],
    }),

    node(1, 10, 'stone_long_arm', {
      modifier: { skillRangeBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['stone_heart', 'stone_living_stone', 'stone_bedrock_stand'],
      requiresCount: 1,
    }),
    node(2, 9, 'stone_fault_line', {
      modifier: { aoeDamageBonus: 0.12 },
      sideTree: 'b',
      requires: ['stone_long_arm'],
    }),
    node(2, 10, 'stone_seismic_sense', {
      grantsPassive: 'seismicSense',
      sideTree: 'b',
      requires: ['stone_long_arm'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'stone_deep_grip', {
      modifier: { rootDurationBonus: 1 },
      maxLevel: 1,
      requires: ['stone_heart', 'stone_living_stone', 'stone_bedrock_stand'],
      requiresCount: 1,
    }),
    node(4, 1, 'stone_crushing_weight', {
      modifier: { pinnedDamageBonus: 0.15 },
      requires: ['stone_heart', 'stone_living_stone', 'stone_bedrock_stand'],
      requiresCount: 1,
    }),
    node(4, 2, 'stone_granite_mantle', {
      modifier: { magicPercentBonus: 0.08, shieldPowerBonus: 0.25 },
      requires: ['stone_heart', 'stone_living_stone', 'stone_bedrock_stand'],
      requiresCount: 1,
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'stone_stones_answer', {
      grantsPassive: 'stonesAnswer',
      masteryRow: 2,
      requires: ['stone_heart', 'stone_living_stone', 'stone_bedrock_stand'],
      requiresCount: 1,
    }),
  ],
};

export const wildshape: MasteryPath = {
  id: 'wildshape',
  roles: ['tank', 'damage'],
  heroClass: HeroClass.Healer,
  signatureSkill: null,
  bonusPoints: 1,
  tierWidths: [5, 12, 3],
  nodes: [
    node(1, 0, 'wild_bear', {
      grantsSkill: 'bear_form',
      exclusiveGroup: 'shape',
      x: 1.5,
    }),
    node(1, 1, 'wild_wolf', {
      grantsSkill: 'wolf_form',
      exclusiveGroup: 'shape',
      x: 5.5,
    }),
    node(1, 2, 'wild_hawk', {
      grantsSkill: 'hawk_form',
      exclusiveGroup: 'shape',
      x: 9.5,
    }),
    node(1, 3, 'wild_bulk', {
      statBonus: { maxHp: 30, defense: 3 },
      requires: ['wild_bear', 'wild_wolf', 'wild_hawk'],
      requiresCount: 1,
      x: 12.5,
    }),
    node(1, 4, 'wild_savagery', {
      statBonus: { attack: 5, critChance: 8 },
      requires: ['wild_bear', 'wild_wolf', 'wild_hawk'],
      requiresCount: 1,
      x: 14.5,
    }),
    node(2, 0, 'wild_bear_slam', {
      grantsSkill: 'bear_slam',
      requires: ['wild_bear'],
      x: 0,
    }),
    node(2, 1, 'wild_bear_hibernate', {
      grantsSkill: 'hibernate',
      requires: ['wild_bear'],
      x: 1,
    }),
    node(2, 2, 'wild_bear_leap', {
      grantsSkill: 'crushing_leap',
      requires: ['wild_bear'],
      x: 2,
    }),
    node(2, 3, 'wild_bear_shrug', {
      grantsSkill: 'bear_shrug',
      requires: ['wild_bear'],
      x: 3,
    }),
    node(2, 4, 'wild_wolf_throat', {
      grantsSkill: 'throat_tear',
      requires: ['wild_wolf'],
      x: 4,
    }),
    node(2, 5, 'wild_wolf_howl', {
      grantsSkill: 'blood_howl',
      requires: ['wild_wolf'],
      x: 5,
    }),
    node(2, 6, 'wild_wolf_slip', {
      grantsSkill: 'slip_the_net',
      requires: ['wild_wolf'],
      x: 6,
    }),
    node(2, 7, 'wild_wolf_rending', {
      grantsSkill: 'rending_circle',
      requires: ['wild_wolf'],
      x: 7,
    }),
    node(2, 8, 'wild_hawk_screech', {
      grantsSkill: 'screech',
      requires: ['wild_hawk'],
      x: 8,
    }),
    node(2, 9, 'wild_hawk_cyclone', {
      grantsSkill: 'cyclone',
      requires: ['wild_hawk'],
      x: 9,
    }),
    node(2, 10, 'wild_hawk_shear', {
      grantsSkill: 'hawk_shear',
      requires: ['wild_hawk'],
      x: 10,
    }),
    node(2, 11, 'wild_hawk_mark', {
      grantsSkill: 'hunters_mark',
      requires: ['wild_hawk'],
      x: 11,
    }),
    node(3, 0, 'wild_apex', {
      grantsSkill: 'apex_form',
      exclusiveGroup: 'capstone',
      requires: [
        'wild_bear_slam',
        'wild_bear_hibernate',
        'wild_bear_leap',
        'wild_bear_shrug',
        'wild_wolf_throat',
        'wild_wolf_howl',
        'wild_wolf_slip',
        'wild_wolf_rending',
        'wild_hawk_screech',
        'wild_hawk_cyclone',
        'wild_hawk_shear',
        'wild_hawk_mark',
      ],
      requiresCount: 4,
      x: 2,
    }),
    node(3, 1, 'wild_primal_surge', {
      grantsSkill: 'primal_surge',
      exclusiveGroup: 'capstone',
      requires: [
        'wild_bear_slam',
        'wild_bear_hibernate',
        'wild_bear_leap',
        'wild_bear_shrug',
        'wild_wolf_throat',
        'wild_wolf_howl',
        'wild_wolf_slip',
        'wild_wolf_rending',
        'wild_hawk_screech',
        'wild_hawk_cyclone',
        'wild_hawk_shear',
        'wild_hawk_mark',
      ],
      requiresCount: 4,
      x: 5.5,
    }),
    node(3, 2, 'wild_ancestral_hunt', {
      grantsSkill: 'ancestral_hunt',
      exclusiveGroup: 'capstone',
      requires: [
        'wild_bear_slam',
        'wild_bear_hibernate',
        'wild_bear_leap',
        'wild_bear_shrug',
        'wild_wolf_throat',
        'wild_wolf_howl',
        'wild_wolf_slip',
        'wild_wolf_rending',
        'wild_hawk_screech',
        'wild_hawk_cyclone',
        'wild_hawk_shear',
        'wild_hawk_mark',
      ],
      requiresCount: 4,
      x: 9,
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'wild_second_skin', {
      grantsPassive: 'secondSkin',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['wild_apex', 'wild_primal_surge', 'wild_ancestral_hunt'],
      requiresCount: 1,
      x: 17,
    }),
    node(2, 13, 'wild_thicker_hide', {
      statBonus: { maxHp: 30 },
      sideTree: 'a',
      requires: ['wild_second_skin'],
      x: 16,
    }),
    node(2, 14, 'wild_deeper_claws', {
      statBonus: { attack: 5 },
      sideTree: 'a',
      requires: ['wild_second_skin'],
      x: 18,
    }),

    node(1, 10, 'wild_verdant_blood', {
      grantsPassive: 'verdantBlood',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['wild_apex', 'wild_primal_surge', 'wild_ancestral_hunt'],
      requiresCount: 1,
      x: 21,
    }),
    node(2, 16, 'wild_sap', {
      modifier: { lifestealBonus: 0.12 },
      sideTree: 'b',
      requires: ['wild_verdant_blood'],
      x: 20,
    }),
    node(2, 17, 'wild_root_and_branch', {
      statBonus: { manaRegen: 3, maxMana: 15 },
      sideTree: 'b',
      requires: ['wild_verdant_blood'],
      x: 22,
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'wild_deep_hide', {
      modifier: { formVigorBonus: 0.12 },
      requires: ['wild_apex', 'wild_primal_surge', 'wild_ancestral_hunt'],
      requiresCount: 1,
    }),
    node(4, 1, 'wild_fang_and_talon', {
      modifier: { formSkillDamageBonus: 0.15 },
      requires: ['wild_apex', 'wild_primal_surge', 'wild_ancestral_hunt'],
      requiresCount: 1,
    }),
    node(4, 2, 'wild_feral_instinct', {
      statBonus: { speed: 6, critChance: 6 },
      requires: ['wild_apex', 'wild_primal_surge', 'wild_ancestral_hunt'],
      requiresCount: 1,
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'wild_second_nature', {
      modifier: { shapeSettledBonus: BALANCE.ADVANCED_DRUID.SECOND_NATURE_STEP },
      masteryRow: 2,
      requires: ['wild_apex', 'wild_primal_surge', 'wild_ancestral_hunt'],
      requiresCount: 1,
    }),
  ],
};
