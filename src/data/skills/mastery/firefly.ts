import { AfflictionType, HeroSkill, SkillTargetType, AuraType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The Firefly's skills — the Monk's support path, vestment, staff and lantern
 * (the private project notes, "### Firefly"): its bolts carry light to the hurt.
 *
 * A file of its own rather than a `monk.ts`, so each Monk path's skills land and
 * are tuned without touching the other two. Costs are **chi**, authored as the
 * rank-two value, and plain numbers: no caster multiplier reaches a Monk path
 * (`BALANCE.MASTERY_MANA` names none). Cadences in the plan are words — "every
 * other turn" is `cooldown: 1`, "every third" is `2`.
 *
 * Every skill borrows a drawn picture through `icon` until its own is approved
 * (`npm run icons:status` lists them under `borrowed`).
 */

const TREE = 5;

/** The Firefly's amber (`MASTERY_COLOR.firefly`). */
const AMBER = '#ff9e00';

/**
 * The signature. Costs chi like every Monk signature — a free one would always
 * beat the Basic Attack, and the chi loop (swing to refill, spend on a spell)
 * would never turn. The mote's share and reach live in `BALANCE.FIREFLY`;
 * Brighter Motes raises both (`fireflyRules.moteSpec`).
 */
export const glowmote: HeroSkill = {
  id: 'glowmote',
  spell: 'holy',
  targetType: SkillTargetType.Single, range: 3, damage: 0.9, scaling: 'magic',
  mote: { share: BALANCE.FIREFLY.MOTE_SHARE, reach: BALANCE.FIREFLY.MOTE_REACH },
  unlockLevel: TREE, manaCost: BALANCE.CHI.SIGNATURE, vfxColor: AMBER, vfxKind: 'bolt', icon: 'plasma_orb',
};

/**
 * A ring of two around the Firefly that hurts one side and mends the other, the
 * resolver's long-standing mixed area (`thornrow`, `wild_sanctuary`). The Firefly
 * stands at its centre and is not one of the allies it heals (`sparesCaster`).
 * Self-centred, so like Whirlwind it is offered only with an enemy inside.
 */
export const lanternSweep: HeroSkill = {
  id: 'lantern_sweep',
  spell: 'holy',
  targetType: SkillTargetType.Ring, range: 0, aoeRadius: 2,
  damage: 0.7, healing: 0.4, scaling: 'magic', sparesCaster: true,
  unlockLevel: TREE, manaCost: 20, cooldown: 1, vfxColor: AMBER, vfxKind: 'nova', vfxAftermath: 'motes',
  icon: 'arcane_burst',
};

/**
 * Bond an ally: whenever the Firefly deals damage, they heal a share of each
 * blow (`AuraType.Lightbond`, `combatEvents.applyLightbond`). The magnitude is
 * the percentage, so the rung scales it like any other number; one bond per
 * Firefly, and a new one lifts the old.
 */
export const lightbond: HeroSkill = {
  id: 'lightbond',
  targetType: SkillTargetType.Single, range: 3, targetSide: 'ally',
  appliesEffect: { type: AuraType.Lightbond, magnitude: BALANCE.FIREFLY.LIGHTBOND_SHARE, duration: BALANCE.FIREFLY.LIGHTBOND_DURATION },
  unlockLevel: TREE, manaCost: 20, cooldown: 2, vfxColor: AMBER, vfxKind: 'buff', icon: 'heal',
};

/** The cleanse, with a heal on it. Aimed at an ally or at the Firefly itself, as every mend is. */
export const purifyingLight: HeroSkill = {
  id: 'purifying_light',
  targetType: SkillTargetType.Single, range: 3, healing: 0.6, cleanse: true,
  unlockLevel: TREE, manaCost: 15, cooldown: 1, vfxColor: AMBER, vfxKind: 'bloom', vfxAftermath: 'motes',
  icon: 'divine_light',
};

/**
 * A free blink, Thunderstep's shape with a heal in place of the thunder: the ring
 * is round the landing, the Firefly at its centre and spared (`sparesCaster`), so
 * it is the allies beside where it lands who are healed. `freeAction` leaves the
 * turn's action for the bolt.
 */
export const lanternGlide: HeroSkill = {
  id: 'lantern_glide',
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1,
  healing: 0.4, scaling: 'magic', sparesCaster: true,
  selfMove: { kind: 'blink', range: 3 },
  freeAction: true,
  unlockLevel: TREE, manaCost: 15, cooldown: 1, vfxColor: AMBER, vfxKind: 'bloom', icon: 'flare_dash',
};

// ── The three exclusive capstones ────────────────────────────────────────────
//
// Each costs `CHI.CAPSTONE` — a capstone and one regular spell empty the pool, which
// is what keeps the chi loop turning (the private project notes, "The chi loop").

const FIREFLY_CAPSTONE_CHI = BALANCE.CHI.CAPSTONE;
const F = BALANCE.FIREFLY;

/**
 * Self-cast: motes of light land on random free hexes round the Firefly and wait
 * there for the fight. Whoever arrives on one first — walking, dashing, blinking
 * or shoved — puts it out: an ally takes its heal, Attack and Critical Chance, an
 * enemy takes nothing. The count is the rung (`perRank.motes`); the heal is fixed
 * from the Firefly's Magic when laid. See `fireflyRules.moteHexes` and
 * `combatStore.moveUnit`.
 */
export const fireflyMotes: HeroSkill = {
  id: 'firefly_motes',
  spell: 'holy',
  targetType: SkillTargetType.Self, range: 0,
  motes: { count: F.MOTES_COUNT, heal: F.MOTE_HEAL },
  perRank: { motes: 1 },
  unlockLevel: TREE, manaCost: FIREFLY_CAPSTONE_CHI, cooldown: 4,
  vfxColor: AMBER, vfxKind: 'bloom', vfxAftermath: 'motes', icon: 'lifebloom_skill',
};

/**
 * A cloud of fireflies on a small area: magic damage, a turn of Silence and two
 * of Attack Down. A boss refuses the Silence as it refuses every disable
 * (`bossControl.BOSS_IGNORED_DISABLES`) and keeps the damage and the Attack Down.
 */
export const fireflySwarm: HeroSkill = {
  id: 'firefly_swarm',
  spell: 'holy',
  targetType: SkillTargetType.Ring, range: 3, aoeRadius: 1,
  damage: 1.2, scaling: 'magic',
  appliesEffect: [
    { type: AfflictionType.Silence, magnitude: 1, duration: F.SWARM_SILENCE_DURATION },
    { type: AfflictionType.AttackDown, magnitude: F.SWARM_ATTACK_DOWN, duration: F.SWARM_ATTACK_DOWN_DURATION },
  ],
  unlockLevel: TREE, manaCost: FIREFLY_CAPSTONE_CHI, cooldown: 3,
  vfxColor: AMBER, vfxKind: 'nova', vfxAftermath: 'motes', icon: 'silencing_depths',
};

/**
 * Plant a lantern on a free hex within two: a stationary summon with a share of
 * the Firefly's health and no turn of its own. At the start of each Firefly turn
 * it heals the allies in its light, then burns a third of its maximum — three
 * turns unhealed, longer if the Firefly's heals reach it — and while it stands
 * its light lends allies Critical Chance and opens enemies to every blow
 * (`AuraType.BeaconLight` / `BeaconLit`). Enemies can smash it. A recast
 * replaces the one standing.
 */
export const lanternBeacon: HeroSkill = {
  id: 'lantern_beacon',
  targetType: SkillTargetType.Single, range: 2,
  unlockLevel: TREE, manaCost: FIREFLY_CAPSTONE_CHI, cooldown: 5,
  vfxColor: AMBER, vfxKind: 'surge', vfxAftermath: 'motes', icon: 'rune_dome',
  summons: {
    templateId: 'lantern_beacon',
    count: 1,
    placement: 'aimed',
    ofCasterMaxHp: F.BEACON_HP_SHARE,
  },
};
