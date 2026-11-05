import { BALANCE } from '@/data/balanceConstants';
import { HeroClass, MasteryPath } from '@/models/types';
import { node } from '@/data/skills/trees/shared';

// ═══ ARCANIST ═══════════════════════════════════════════════════════════════

export const pyromancer: MasteryPath = {
  id: 'pyromancer',
  roles: ['damage'],
  heroClass: HeroClass.Mage,
  signatureSkill: 'ignite',
  nodes: [
    node(1, 0, 'pyro_emberstep', {
      grantsPassive: 'momentum',
    }),
    node(1, 1, 'pyro_inner_flame', {
      statBonus: { critChance: 8 },
      modifier: { magicPercentBonus: 0.06 },
    }),
    node(1, 2, 'pyro_fuel_the_flame', {
      grantsPassive: 'fuelTheFlame',
    }),
    node(1, 3, 'pyro_hot_blood', {
      modifier: { burnMagnitudeBonus: 0.35 },
    }),
    node(1, 4, 'pyro_slow_burn', {
      grantsPassive: 'kindle',
    }),
    node(2, 0, 'pyro_ember_shroud', {
      grantsSkill: 'ember_shroud',
    }),
    node(2, 1, 'pyro_cinder_burst', {
      grantsSkill: 'cinder_burst',
    }),
    node(2, 2, 'pyro_wildfire', {
      grantsSkill: 'wildfire',
    }),
    node(2, 3, 'pyro_meteor', {
      grantsSkill: 'meteor',
    }),
    node(3, 0, 'pyro_immolation', {
      grantsSkill: 'immolation',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'pyro_burning_out', {
      grantsSkill: 'burning_out',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'pyro_elemental', {
      grantsSkill: 'summon_elemental',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 8, 'pyro_far_flame', {
      modifier: { skillRangeBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['pyro_immolation', 'pyro_burning_out', 'pyro_elemental'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 7, 'pyro_deep_furnace', {
      statBonus: { maxMana: 30 },
      sideTree: 'a',
      requires: ['pyro_far_flame'],
    }),
    node(2, 8, 'pyro_firemind', {
      grantsPassive: 'firemind',
      sideTree: 'a',
      requires: ['pyro_far_flame'],
    }),

    node(1, 10, 'pyro_conflagration', {
      modifier: { aoeRadiusBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['pyro_immolation', 'pyro_burning_out', 'pyro_elemental'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 9, 'pyro_spark', {
      grantsPassive: 'spark',
      sideTree: 'b',
      requires: ['pyro_conflagration'],
    }),
    node(2, 10, 'pyro_detonation', {
      grantsPassive: 'detonation',
      sideTree: 'b',
      requires: ['pyro_conflagration'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'pyro_white_heat', {
      modifier: { burnCapBonus: 0.4 },
      requires: ['pyro_immolation', 'pyro_burning_out', 'pyro_elemental'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'pyro_cataclysm', {
      modifier: { detonationBonus: 0.3 },
      requires: ['pyro_immolation', 'pyro_burning_out', 'pyro_elemental'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 2, 'pyro_pyre_heart', {
      modifier: { magicPercentBonus: 0.08, burnMagnitudeBonus: 0.2 },
      requires: ['pyro_immolation', 'pyro_burning_out', 'pyro_elemental'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'pyro_brimming_over', {
      modifier: { burnOverflowShare: BALANCE.ARCANIST_ROW_TWO.BURN_OVERFLOW_SHARE },
      masteryRow: 2,
      requires: ['pyro_immolation', 'pyro_burning_out', 'pyro_elemental'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};

export const hydromancer: MasteryPath = {
  id: 'hydromancer',
  roles: ['damage', 'support'],
  heroClass: HeroClass.Mage,
  signatureSkill: 'frostbite',
  nodes: [
    node(1, 0, 'hydro_deep_well', {
      statBonus: { maxMana: 15 },
      modifier: { magicPercentBonus: 0.08 },
    }),
    node(1, 1, 'hydro_shatterpoint', {
      grantsPassive: 'shatterpoint',
    }),
    node(1, 2, 'hydro_twin_fangs', {
      grantsPassive: 'twinFangs',
    }),
    node(1, 3, 'hydro_thick_ice', {
      statBonus: { maxHp: 20 },
      modifier: { magicPercentBonus: 0.06, shieldPowerBonus: 0.2 },
    }),
    node(1, 4, 'hydro_meltwater', {
      grantsPassive: 'meltwater',
    }),
    node(2, 0, 'hydro_frost_lance', {
      grantsSkill: 'frost_lance',
    }),
    node(2, 1, 'hydro_cold_snap', {
      grantsSkill: 'cold_snap',
    }),
    node(2, 2, 'hydro_ice_barrier', {
      grantsSkill: 'ice_barrier',
    }),
    node(2, 3, 'hydro_silence', {
      grantsSkill: 'silencing_depths',
    }),
    node(3, 0, 'hydro_blizzard', {
      grantsSkill: 'blizzard',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'hydro_glacial_barrage', {
      grantsSkill: 'glacial_barrage',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'hydro_absolute_zero', {
      grantsSkill: 'absolute_zero',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 7, 'hydro_cryostasis', {
      grantsPassive: 'cryostasis',
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['hydro_blizzard', 'hydro_glacial_barrage', 'hydro_absolute_zero'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 6, 'hydro_whiteout', {
      modifier: { aoeDamageBonus: 0.15 },
      sideTree: 'a',
      requires: ['hydro_cryostasis'],
    }),
    node(2, 7, 'hydro_shatterstep', {
      grantsPassive: 'shatterstep',
      sideTree: 'a',
      requires: ['hydro_cryostasis'],
    }),

    node(1, 10, 'hydro_glacial', {
      modifier: { skillRangeBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['hydro_blizzard', 'hydro_glacial_barrage', 'hydro_absolute_zero'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 9, 'hydro_deep_cold', {
      grantsPassive: 'deepCold',
      sideTree: 'b',
      requires: ['hydro_glacial'],
    }),
    node(2, 10, 'hydro_killing_frost', {
      grantsPassive: 'killingFrost',
      sideTree: 'b',
      requires: ['hydro_glacial'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'hydro_permafrost', {
      modifier: { freezeDurationBonus: 1 },
      maxLevel: 1,
      requires: ['hydro_blizzard', 'hydro_glacial_barrage', 'hydro_absolute_zero'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'hydro_bitter_cold', {
      modifier: { chilledDamageBonus: 0.15 },
      requires: ['hydro_blizzard', 'hydro_glacial_barrage', 'hydro_absolute_zero'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 2, 'hydro_glacial_bulwark', {
      statBonus: { maxHp: 25 },
      modifier: { shieldPowerBonus: 0.25 },
      requires: ['hydro_blizzard', 'hydro_glacial_barrage', 'hydro_absolute_zero'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'hydro_flying_shards', {
      grantsPassive: 'flyingShards',
      masteryRow: 2,
      requires: ['hydro_blizzard', 'hydro_glacial_barrage', 'hydro_absolute_zero'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};

export const stormcaller: MasteryPath = {
  id: 'stormcaller',
  roles: ['damage'],
  heroClass: HeroClass.Mage,
  signatureSkill: 'arc',
  nodes: [
    node(1, 0, 'storm_carrion_charge', {
      modifier: { lowHpDamageBonus: 0.15 },
    }),
    node(1, 1, 'storm_overload', {
      grantsPassive: 'overload',
    }),
    node(1, 2, 'storm_conductive_arc', {
      grantsPassive: 'conductiveArc',
    }),
    node(1, 3, 'storm_live_wire', {
      statBonus: { speed: 5 },
      modifier: { magicPercentBonus: 0.1 },
    }),
    node(1, 4, 'storm_groundfall', {
      modifier: { highHpDamageBonus: 0.15 },
    }),
    node(2, 0, 'storm_static_burst', {
      grantsSkill: 'static_burst',
    }),
    node(2, 1, 'storm_thunderbolt', {
      grantsSkill: 'thunderbolt',
    }),
    node(2, 2, 'storm_thunderstep', {
      grantsSkill: 'thunderstep',
    }),
    node(2, 3, 'storm_skyfall', {
      grantsSkill: 'skyfall',
    }),
    node(3, 0, 'storm_tempest', {
      grantsSkill: 'tempest',
      exclusiveGroup: 'capstone',
    }),
    node(3, 1, 'storm_chain', {
      grantsSkill: 'chain_lightning',
      exclusiveGroup: 'capstone',
    }),
    node(3, 2, 'storm_thunder_elemental', {
      grantsSkill: 'summon_thunder_elemental',
      exclusiveGroup: 'capstone',
    }),

    // ── The two side trees ───────────────────────────────────────────────
    //
    // Not tiers. They hang off the capstones rather than off a column, so
    // every pyramid invariant skips them; `tier` says only which row they
    // draw on. Both starters share `exclusiveGroup: 'side'` — you take one.

    node(1, 8, 'storm_conductor', {
      modifier: { skillRangeBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'a',
      requires: ['storm_tempest', 'storm_chain', 'storm_thunder_elemental'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 7, 'storm_momentum', {
      grantsPassive: 'momentum',
      sideTree: 'a',
      requires: ['storm_conductor'],
    }),
    node(2, 8, 'storm_capacitor', {
      statBonus: { maxMana: 40 },
      sideTree: 'a',
      requires: ['storm_conductor'],
    }),

    node(1, 11, 'storm_squall', {
      modifier: { aoeRadiusBonus: 1 },
      maxLevel: 1,
      exclusiveGroup: 'side',
      sideTree: 'b',
      requires: ['storm_tempest', 'storm_chain', 'storm_thunder_elemental'],
      requiresCount: 1,
      requiresLabel: 'firstCapstone',
    }),
    node(2, 10, 'storm_squall_line', {
      modifier: { aoeDamageBonus: 0.15 },
      sideTree: 'b',
      requires: ['storm_squall'],
    }),
    node(2, 11, 'storm_thunderhead', {
      grantsPassive: 'thunderhead',
      sideTree: 'b',
      requires: ['storm_squall'],
    }),

    // ── Advanced: level 21 and past a capstone ───────────────────────────
    //
    // Tier 4 is not a pyramid row. Each node names the capstones in
    // `requires` and asks for one; `canUnlockNode` adds the level gate.
    node(4, 0, 'storm_high_voltage', {
      modifier: { shockChainBonus: 0.5 },
      requires: ['storm_tempest', 'storm_chain', 'storm_thunder_elemental'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 1, 'storm_ionize', {
      modifier: { shockedDamageBonus: 0.15 },
      requires: ['storm_tempest', 'storm_chain', 'storm_thunder_elemental'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
    node(4, 2, 'storm_quickening', {
      statBonus: { speed: 8 },
      modifier: { magicPercentBonus: 0.08 },
      requires: ['storm_tempest', 'storm_chain', 'storm_thunder_elemental'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),

    // ── Advanced row 2: `BALANCE.MASTERY_ROW_LEVELS[1]` and past a capstone ─
    node(4, 0, 'storm_forked_current', {
      modifier: { shockSecondHop: BALANCE.ARCANIST_ROW_TWO.SECOND_HOP_SHARE },
      masteryRow: 2,
      requires: ['storm_tempest', 'storm_chain', 'storm_thunder_elemental'],
      requiresCount: 1,
      requiresLabel: 'advanced',
    }),
  ],
};
