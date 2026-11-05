import { HeroClass, MasteryPath } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { node } from '@/data/skills/trees/shared';

/** The three capstones, any one of which opens either side tree. */
const CAPSTONES = ['mantis_marked_prey', 'mantis_threefold_scythe', 'mantis_execution'];

/**
 * The Mantis, the Monk's blade dancer: hide, a handblade in each hand, Twin Reap
 * reaping the Bleed its swings lay (the private project notes, "### Mantis").
 *
 * **Hand-written, unlike the tree files beside it.** `scripts/mastery-trees.mjs`
 * generates the Champion, Arcanist, Druid and Hunter trees and the Firefly's and
 * Beetle's from the private project notes, which carries no Mantis; until the draft
 * does, this file is the source.
 *
 * The shipped shape: five feeders and four actives, three exclusive capstones
 * (Marked Prey, Threefold Scythe, Mantis Execution), and two side trees whose
 * one-rank starters open with any capstone — Bleed Harvest (Fresh Kill, Evasive
 * Weave) and Deep Cuts (Haemorrhage, Scent of Blood). The side trees' figures are
 * `BALANCE.MANTIS`; their rules are `systems/combat/mantis`.
 */
export const mantis: MasteryPath = {
  id: 'mantis',
  roles: ['damage'],
  heroClass: HeroClass.Monk,
  signatureSkill: 'twin_reap',
  nodes: [
    node(1, 0, 'mantis_chitin_grace', {
      statBonus: { attack: 2, defense: 2 },
    }),
    node(1, 1, 'mantis_bleeding_blades', {
      grantsPassive: 'bleedingBlades',
    }),
    node(1, 2, 'mantis_reaping_momentum', {
      grantsPassive: 'reapingMomentum',
    }),
    node(1, 3, 'mantis_predators_breath', {
      grantsPassive: 'predatorsBreath',
    }),
    node(1, 4, 'mantis_light_frame', {
      statBonus: { speed: 2, maxMana: 8 },
    }),
    node(2, 0, 'mantis_scything_step', {
      grantsSkill: 'scything_step',
    }),
    node(2, 1, 'mantis_flicker_cut', {
      grantsSkill: 'flicker_cut',
    }),
    node(2, 2, 'mantis_pinning_cut', {
      grantsSkill: 'pinning_cut',
    }),
    node(2, 3, 'mantis_pounce', {
      grantsSkill: 'mantis_pounce',
    }),
    node(3, 0, 'mantis_marked_prey', {
      grantsSkill: 'marked_prey',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'mantis_threefold_scythe', {
      grantsSkill: 'threefold_scythe',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'mantis_execution', {
      grantsSkill: 'mantis_execution',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.
    // Side A spends the Bleed and pays for the kill; side B makes the Bleed
    // itself worth more.

    node(1, 7, 'mantis_bleed_harvest', {
      grantsPassive: 'bleedHarvest',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: CAPSTONES,
      requiresCount: 1,
    }),
    node(2, 6, 'mantis_fresh_kill', {
      grantsPassive: 'freshKill',
      sideTree: 'a',
      requires: ['mantis_bleed_harvest'],
    }),
    node(2, 7, 'mantis_evasive_weave', {
      grantsPassive: 'evasiveWeave',
      sideTree: 'a',
      requires: ['mantis_bleed_harvest'],
    }),

    node(1, 10, 'mantis_deep_cuts', {
      modifier: { bleedDurationBonus: BALANCE.MANTIS.DEEP_CUTS_TURNS },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: CAPSTONES,
      requiresCount: 1,
    }),
    node(2, 9, 'mantis_haemorrhage', {
      modifier: { bleedMagnitudeBonus: BALANCE.MANTIS.HAEMORRHAGE },
      sideTree: 'b',
      requires: ['mantis_deep_cuts'],
    }),
    node(2, 10, 'mantis_scent_of_blood', {
      modifier: { bleedingDamageBonus: BALANCE.MANTIS.SCENT_OF_BLOOD },
      sideTree: 'b',
      requires: ['mantis_deep_cuts'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    // The Mantis's row is bounded movement: Reaping Stride's step comes
    // once a turn, at most `BALANCE.MONK_ADVANCED.REAPING_STRIDE_STEP`'s last hexes.
    node(4, 0, 'mantis_reaping_stride', {
      grantsPassive: 'reapingStride',
      requires: CAPSTONES,
      requiresCount: 1,
    }),
    node(4, 1, 'mantis_stalking_rush', {
      grantsPassive: 'momentum',
      requires: CAPSTONES,
      requiresCount: 1,
    }),
    node(4, 2, 'mantis_honed_edges', {
      statBonus: { attack: 3, critDamage: 25 },
      requires: CAPSTONES,
      requiresCount: 1,
    }),
    // Level 26: row 2 of the advanced nodes
    node(4, 0, 'mantis_reapers_breath', {
      grantsPassive: 'reapersBreath',
      masteryRow: 2,
      requires: CAPSTONES,
      requiresCount: 1,
    }),
  ],
};
