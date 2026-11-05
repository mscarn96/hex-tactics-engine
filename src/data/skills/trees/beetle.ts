import { HeroClass, MasteryPath } from '@/models/types';
import { node } from '@/data/skills/trees/shared';

// ═══ MONK: BEETLE ═══════════════════════════════════════════════════════════

export const beetle: MasteryPath = {
  id: 'beetle',
  roles: ['tank', 'support'],
  heroClass: HeroClass.Monk,
  signatureSkill: 'iron_carapace',
  nodes: [
    node(1, 0, 'beetle_thick_plates', {
      statBonus: { defense: 3, magicDefense: 2 },
    }),
    node(1, 1, 'beetle_shell_breath', {
      grantsPassive: 'shellBreath',
    }),
    node(1, 2, 'beetle_hardened_shell', {
      grantsPassive: 'hardenedShell',
    }),
    node(1, 3, 'beetle_shoulder_to_shoulder', {
      grantsPassive: 'shoulderToShoulder',
    }),
    node(1, 4, 'beetle_steady_breath', {
      statBonus: { attack: 2, maxMana: 8 },
    }),
    node(2, 0, 'beetle_horn_sweep', {
      grantsSkill: 'horn_sweep',
    }),
    node(2, 1, 'beetle_carapace_leap', {
      grantsSkill: 'carapace_leap',
    }),
    node(2, 2, 'beetle_grip_and_throw', {
      grantsSkill: 'grip_and_throw',
    }),
    node(2, 3, 'beetle_shell_wall', {
      grantsSkill: 'shell_wall',
    }),
    node(3, 0, 'beetle_vengeful_shell', {
      grantsSkill: 'vengeful_shell',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'beetle_carapace_bastion', {
      grantsSkill: 'carapace_bastion',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'beetle_shell_swap', {
      grantsSkill: 'shell_swap',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'beetle_second_watch', {
      grantsPassive: 'secondWatch',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: [
        'beetle_vengeful_shell',
        'beetle_carapace_bastion',
        'beetle_shell_swap',
      ],
      requiresCount: 1,
    }),
    node(2, 6, 'beetle_lasting_shell', {
      modifier: { shieldPowerBonus: 0.3 },
      sideTree: 'a',
      requires: ['beetle_second_watch'],
    }),
    node(2, 7, 'beetle_retribution', {
      grantsPassive: 'retribution',
      sideTree: 'a',
      requires: ['beetle_second_watch'],
    }),

    node(1, 10, 'beetle_numbing_staff', {
      grantsPassive: 'numbingStaff',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: [
        'beetle_vengeful_shell',
        'beetle_carapace_bastion',
        'beetle_shell_swap',
      ],
      requiresCount: 1,
    }),
    node(2, 9, 'beetle_heavy_hands', {
      grantsPassive: 'heavyHands',
      sideTree: 'b',
      requires: ['beetle_numbing_staff'],
    }),
    node(2, 10, 'beetle_planted_guard', {
      grantsPassive: 'plantedGuard',
      sideTree: 'b',
      requires: ['beetle_numbing_staff'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'beetle_shell_ward', {
      grantsPassive: 'shellWard',
      requires: [
        'beetle_vengeful_shell',
        'beetle_carapace_bastion',
        'beetle_shell_swap',
      ],
      requiresCount: 1,
    }),
    node(4, 1, 'beetle_ironbound_shell', {
      statBonus: { defense: 4, magicDefense: 4 },
      requires: [
        'beetle_vengeful_shell',
        'beetle_carapace_bastion',
        'beetle_shell_swap',
      ],
      requiresCount: 1,
    }),
    node(4, 2, 'beetle_rooted_stance', {
      grantsPassive: 'immovable',
      maxLevel: 1,
      requires: [
        'beetle_vengeful_shell',
        'beetle_carapace_bastion',
        'beetle_shell_swap',
      ],
      requiresCount: 1,
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'beetle_returned_blow', {
      grantsPassive: 'returnedBlow',
      masteryRow: 2,
      requires: [
        'beetle_vengeful_shell',
        'beetle_carapace_bastion',
        'beetle_shell_swap',
      ],
      requiresCount: 1,
    }),
  ],
};
