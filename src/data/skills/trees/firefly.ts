import { HeroClass, MasteryPath } from '@/models/types';
import { node } from '@/data/skills/trees/shared';

// ═══ MONK · FIREFLY ═════════════════════════════════════════════════════════

export const firefly: MasteryPath = {
  id: 'firefly',
  roles: ['support', 'damage'],
  heroClass: HeroClass.Monk,
  signatureSkill: 'glowmote',
  nodes: [
    node(1, 0, 'firefly_glowing_wraps', {
      statBonus: { magicDefense: 2 },
      modifier: { magicPercentBonus: 0.06 },
    }),
    node(1, 1, 'firefly_lantern_breath', {
      grantsPassive: 'lanternBreath',
    }),
    node(1, 2, 'firefly_brighter_motes', {
      grantsPassive: 'brighterMotes',
    }),
    node(1, 3, 'firefly_afterglow', {
      grantsPassive: 'afterglow',
    }),
    node(1, 4, 'firefly_wingbeat', {
      statBonus: { speed: 2, maxMana: 8 },
    }),
    node(2, 0, 'firefly_lantern_sweep', {
      grantsSkill: 'lantern_sweep',
    }),
    node(2, 1, 'firefly_lightbond', {
      grantsSkill: 'lightbond',
    }),
    node(2, 2, 'firefly_purifying_light', {
      grantsSkill: 'purifying_light',
    }),
    node(2, 3, 'firefly_lantern_glide', {
      grantsSkill: 'lantern_glide',
    }),
    node(3, 0, 'firefly_motes', {
      grantsSkill: 'firefly_motes',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'firefly_swarm', {
      grantsSkill: 'firefly_swarm',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'firefly_lantern_beacon', {
      grantsSkill: 'lantern_beacon',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 8, 'firefly_far_light', {
      grantsPassive: 'farLight',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['firefly_motes', 'firefly_swarm', 'firefly_lantern_beacon'],
      requiresCount: 1,
    }),
    node(2, 7, 'firefly_kindled_light', {
      statBonus: { healPower: 20 },
      sideTree: 'a',
      requires: ['firefly_far_light'],
    }),
    node(2, 8, 'firefly_steady_flame', {
      grantsPassive: 'steadyFlame',
      sideTree: 'a',
      requires: ['firefly_far_light'],
    }),

    node(1, 10, 'firefly_twin_motes', {
      grantsPassive: 'twinMotes',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['firefly_motes', 'firefly_swarm', 'firefly_lantern_beacon'],
      requiresCount: 1,
    }),
    node(2, 9, 'firefly_bright_bolt', {
      modifier: { singleTargetDamageBonus: 0.2 },
      sideTree: 'b',
      requires: ['firefly_twin_motes'],
    }),
    node(2, 10, 'firefly_second_light', {
      grantsPassive: 'secondLight',
      sideTree: 'b',
      requires: ['firefly_twin_motes'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'firefly_searing_light', {
      grantsPassive: 'searingLight',
      requires: ['firefly_motes', 'firefly_swarm', 'firefly_lantern_beacon'],
      requiresCount: 1,
    }),
    node(4, 1, 'firefly_shared_glow', {
      modifier: { healRestoresMana: 4 },
      requires: ['firefly_motes', 'firefly_swarm', 'firefly_lantern_beacon'],
      requiresCount: 1,
    }),
    node(4, 2, 'firefly_radiant_core', {
      statBonus: { healPower: 8 },
      modifier: { magicPercentBonus: 0.08 },
      requires: ['firefly_motes', 'firefly_swarm', 'firefly_lantern_beacon'],
      requiresCount: 1,
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'firefly_spilled_light', {
      grantsPassive: 'spilledLight',
      masteryRow: 2,
      requires: ['firefly_motes', 'firefly_swarm', 'firefly_lantern_beacon'],
      requiresCount: 1,
    }),
  ],
};
