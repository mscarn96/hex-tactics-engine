import { BALANCE } from '@/data/balanceConstants';
import { HeroClass, MasteryPath } from '@/models/types';
import { node } from '@/data/skills/trees/shared';

// ═══ HUNTER ═════════════════════════════════════════════════════════════════

export const marksman: MasteryPath = {
  id: 'marksman',
  roles: ['damage'],
  heroClass: HeroClass.Ranger,
  signatureSkill: 'mark_target',
  nodes: [
    node(1, 0, 'marks_steady', {
      statBonus: { attack: 4, critChance: 6 },
    }),
    node(1, 1, 'marks_lethality', {
      statBonus: { critDamage: 35, armourPen: 15 },
    }),
    node(1, 2, 'marks_mark_and_move', {
      grantsPassive: 'markAndMove',
    }),
    node(1, 3, 'marks_repositioning', {
      grantsPassive: 'momentum',
    }),
    node(1, 4, 'marks_quarry', {
      modifier: { markedDamageBonus: 0.12 },
    }),
    node(2, 0, 'marks_hamstring', {
      grantsSkill: 'hamstring_shot',
    }),
    node(2, 1, 'marks_ricochet', {
      grantsSkill: 'ricochet_shot',
    }),
    node(2, 2, 'marks_concussive', {
      grantsSkill: 'concussive_shot',
    }),
    node(2, 3, 'marks_rain', {
      grantsSkill: 'rain_of_arrows',
    }),
    node(3, 0, 'marks_aimed', {
      grantsSkill: 'aimed_shot',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'marks_rapid_fire', {
      grantsSkill: 'rapid_fire',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'marks_covering_fire', {
      grantsSkill: 'covering_fire',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'marks_escape_route', {
      grantsPassive: 'escapeRoute',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['marks_aimed', 'marks_rapid_fire', 'marks_covering_fire'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 6, 'marks_settle_in', {
      grantsPassive: 'settleIn',
      sideTree: 'a',
      requires: ['marks_escape_route'],
    }),
    node(2, 7, 'marks_fleet', {
      statBonus: { speed: 4 },
      sideTree: 'a',
      requires: ['marks_escape_route'],
    }),

    node(1, 10, 'marks_longshot', {
      modifier: { skillRangeBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['marks_aimed', 'marks_rapid_fire', 'marks_covering_fire'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 9, 'marks_deadeye', {
      statBonus: { critChance: 6 },
      sideTree: 'b',
      requires: ['marks_longshot'],
    }),
    node(2, 10, 'marks_killing_shot', {
      statBonus: { critDamage: 30 },
      sideTree: 'b',
      requires: ['marks_longshot'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'marks_opening_volley', {
      modifier: { highHpDamageBonus: 0.15 },
      requires: ['marks_aimed', 'marks_rapid_fire', 'marks_covering_fire'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'marks_eagle_eye', {
      grantsPassive: 'eagleEye',
      requires: ['marks_aimed', 'marks_rapid_fire', 'marks_covering_fire'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'marks_next_quarry', {
      grantsPassive: 'nextQuarry',
      masteryRow: 2,
      requires: ['marks_aimed', 'marks_rapid_fire', 'marks_covering_fire'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};

export const skirmisher: MasteryPath = {
  id: 'skirmisher',
  roles: ['damage'],
  heroClass: HeroClass.Ranger,
  signatureSkill: 'blade_recall',
  nodes: [
    node(1, 0, 'skirm_slipstream', {
      grantsPassive: 'slipstream',
    }),
    node(1, 1, 'skirm_sharpened_steel', {
      grantsPassive: 'sharpenedSteel',
    }),
    node(1, 2, 'skirm_fan_of_blades', {
      grantsPassive: 'fanOfBlades',
    }),
    node(1, 3, 'skirm_precision', {
      statBonus: { critChance: 8, armourPen: 12 },
    }),
    node(1, 4, 'skirm_follow_up', {
      grantsPassive: 'momentum',
    }),
    node(2, 0, 'skirm_smoke', {
      grantsSkill: 'smoke_bomb',
    }),
    node(2, 1, 'skirm_barbed', {
      grantsSkill: 'barbed_blades',
    }),
    node(2, 2, 'skirm_bolas', {
      grantsSkill: 'bolas',
    }),
    node(2, 3, 'skirm_hit_and_run', {
      grantsSkill: 'hit_and_run',
    }),
    node(3, 0, 'skirm_knife_dance', {
      grantsSkill: 'knife_dance',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'skirm_bladestorm', {
      grantsSkill: 'bladestorm',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'skirm_flurry', {
      grantsSkill: 'flurry',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'skirm_braced_stance', {
      grantsPassive: 'immovable',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['skirm_knife_dance', 'skirm_bladestorm', 'skirm_flurry'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 6, 'skirm_sure_grip', {
      statBonus: { attack: 4 },
      sideTree: 'a',
      requires: ['skirm_braced_stance'],
    }),
    node(2, 7, 'skirm_open_ground', {
      statBonus: { dodgeChance: 8 },
      sideTree: 'a',
      requires: ['skirm_braced_stance'],
    }),

    node(1, 10, 'skirm_wide_throw', {
      modifier: { aoeRadiusBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['skirm_knife_dance', 'skirm_bladestorm', 'skirm_flurry'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 9, 'skirm_storm_of_steel', {
      modifier: { aoeDamageBonus: 0.2 },
      sideTree: 'b',
      requires: ['skirm_wide_throw'],
    }),
    node(2, 10, 'skirm_long_legs', {
      statBonus: { speed: 3 },
      sideTree: 'b',
      requires: ['skirm_wide_throw'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'skirm_light_step', {
      statBonus: { moveRange: 1 },
      maxLevel: 1,
      requires: ['skirm_knife_dance', 'skirm_bladestorm', 'skirm_flurry'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'skirm_open_seams', {
      grantsPassive: 'openSeams',
      requires: ['skirm_knife_dance', 'skirm_bladestorm', 'skirm_flurry'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'skirm_buried_steel', {
      modifier: { bladesCapBonus: BALANCE.ADVANCED_HUNTER.BURIED_STEEL_CAP_BONUS },
      masteryRow: 2,
      requires: ['skirm_knife_dance', 'skirm_bladestorm', 'skirm_flurry'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};

export const shadowblade: MasteryPath = {
  id: 'shadowblade',
  roles: ['damage'],
  heroClass: HeroClass.Ranger,
  signatureSkill: 'shadowstep',
  nodes: [
    node(1, 0, 'shadow_lethality', {
      statBonus: { critDamage: 40, armourPen: 18 },
    }),
    node(1, 1, 'shadow_evasion', {
      statBonus: { dodgeChance: 10 },
    }),
    node(1, 2, 'shadow_echo', {
      grantsPassive: 'shadowEcho',
    }),
    node(1, 3, 'shadow_opportunist', {
      statBonus: { critChance: 12 },
    }),
    node(1, 4, 'shadow_leech', {
      modifier: { lifestealBonus: 0.12 },
    }),
    node(2, 0, 'shadow_cheap_shot', {
      grantsSkill: 'cheap_shot',
    }),
    node(2, 1, 'shadow_hemlock', {
      grantsSkill: 'hemlock',
    }),
    node(2, 2, 'shadow_venomed', {
      grantsSkill: 'venomed_blades',
    }),
    node(2, 3, 'shadow_garrote', {
      grantsSkill: 'garrote',
    }),
    node(3, 0, 'shadow_assassinate', {
      grantsSkill: 'assassinate',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'shadow_creeping_death', {
      grantsSkill: 'creeping_death',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'shadow_vanish', {
      grantsSkill: 'vanish',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'shadow_nightfall', {
      grantsPassive: 'nightfall',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['shadow_assassinate', 'shadow_creeping_death', 'shadow_vanish'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 6, 'shadow_from_behind', {
      statBonus: { critDamage: 35 },
      sideTree: 'a',
      requires: ['shadow_nightfall'],
    }),
    node(2, 7, 'shadow_ghostfoot', {
      statBonus: { speed: 3 },
      sideTree: 'a',
      requires: ['shadow_nightfall'],
    }),

    node(1, 10, 'shadow_venom_transfer', {
      grantsPassive: 'venomTransfer',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['shadow_assassinate', 'shadow_creeping_death', 'shadow_vanish'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 9, 'shadow_distillation', {
      statBonus: { poisonPower: 12 },
      sideTree: 'b',
      requires: ['shadow_venom_transfer'],
    }),
    node(2, 10, 'shadow_critical_mass', {
      modifier: { poisonBurstBonus: 0.25 },
      sideTree: 'b',
      requires: ['shadow_venom_transfer'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'shadow_coup_de_grace', {
      modifier: { lowHpDamageBonus: 0.2 },
      requires: ['shadow_assassinate', 'shadow_creeping_death', 'shadow_vanish'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'shadow_unseen_blade', {
      grantsPassive: 'unseenBlade',
      requires: ['shadow_assassinate', 'shadow_creeping_death', 'shadow_vanish'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'shadow_into_the_dark', {
      grantsPassive: 'intoTheDark',
      masteryRow: 2,
      requires: ['shadow_assassinate', 'shadow_creeping_death', 'shadow_vanish'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};
