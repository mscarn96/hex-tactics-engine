import { unitById } from '@/systems/combat/unitLookup';
import { useCombatStore } from '@/stores/combatStore';
import {
  afterUndermineLanding, beforeTombLanding, beforeUndermineLanding, castChallenge, castTomb, castUndermine,
  performTwinRaid,
} from '@/systems/combat/factionEliteActions';
import { launchIntent, strikeDelivery } from '@/systems/combat/soundIntents';
import type { EncounterScript } from '@/systems/combat/encounterScript';

/**
 * The elites of the new factions: the Burrowmother's undermine, the Herd-Khan's twin
 * raid, the Rime Jarl's challenge and the Glacier Colossus's tomb.
 *
 * Each signature is built and announced by its own rules, so the scene and the
 * simulator raise the same one. A burrow and a tomb change where the ordinary
 * strike is made from (`beforeLanding`, in that order: the Burrowmother comes up in
 * the footprint, then the tomb gives way).
 */
export const factionElitesScript: EncounterScript = {
  id: 'factionElites',

  cast({ caster, skill, target, sink }) {
    const store = useCombatStore.getState();
    switch (skill.id) {
      case 'undermine':
        if (castUndermine(caster, sink).ok) {
          sink.sound?.(launchIntent(caster, skill, strikeDelivery(skill, caster)));
          store.markActed(caster.id);
        }
        return true;
      case 'twin_raid': {
        // Where he stands *now*: the first dash was the move before this action, and the
        // snapshot this turn began with is from before it
        const landed = unitById(useCombatStore.getState().units, caster.id) ?? caster;
        performTwinRaid(landed, target, sink);
        store.startCooldown(caster.id, skill);
        store.markActed(caster.id);
        return true;
      }
      case 'jarls_challenge':
        if (castChallenge(caster, skill, target, sink).ok) store.markActed(caster.id);
        return true;
      case 'glacial_tomb':
        if (castTomb(caster, skill, target, sink).ok) {
          sink.sound?.(launchIntent(caster, skill, strikeDelivery(skill, caster)));
          store.markActed(caster.id);
        }
        return true;
      default:
        return false;
    }
  },

  beforeLanding: (attack, striker, sink) => beforeTombLanding(attack, beforeUndermineLanding(attack, striker, sink), sink),
  afterLanding: (attack, caster, sink) => afterUndermineLanding(attack, caster, sink),
};
