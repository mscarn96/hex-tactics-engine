import { useCombatStore } from '@/stores/combatStore';
import { afterEliteCast } from '@/systems/combat/eliteActions';
import { afterEliteLanding, afterEliteStrike, castFractureSlam, followFractures, landEliteWarning } from '@/systems/combat/eliteWarnings';
import { launchIntent, strikeDelivery } from '@/systems/combat/soundIntents';
import type { EncounterScript } from '@/systems/combat/encounterScript';

/**
 * The elites of the first factions: the Bog Hulk's undertow, the Delve Overseer's
 * Ground Slam, the Coven Matriarch's briar seed, the Orc Warchief's horn and the
 * Berserker's feast.
 *
 * They share a script because they share a shape, not a boss: each is one signature
 * skill with something it leaves behind (`afterCast`) or lands its own way (`land`),
 * recognised by the skill or the warning rather than by whose it is.
 */
export const elitesScript: EncounterScript = {
  id: 'elites',

  cast({ caster, skill, target, sink }) {
    // The Delve Overseer's Ground Slam against a Fractured party is announced, over the
    // ground round him and round every marked hero; against none it strikes at once
    if (skill.id !== 'fracture_slam') return false;
    void target;
    if (!castFractureSlam(caster, skill, sink).ok) return false;
    sink.sound?.(launchIntent(caster, skill, strikeDelivery(skill, caster)));
    useCombatStore.getState().markActed(caster.id);
    return true;
  },

  /** The fractures follow their heroes between turns. */
  betweenTurns: (sink) => followFractures(sink),
  land: (landing, caster, sink) => landEliteWarning(landing, caster, sink),
  afterLanding: (attack, caster, sink) => afterEliteLanding(attack, caster, sink),

  afterCast(caster, skill, kind, sink) {
    // A warning's riders (the Berserker's feast spends its Rage when announced)...
    if (kind === 'prepare') afterEliteCast(caster, skill, sink);
    // ...or what a strike leaves behind: the Hulk's marsh, the Matriarch's seed, the Warchief's backup
    else afterEliteStrike(caster, skill, sink);
  },
};
