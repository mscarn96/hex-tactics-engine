import { PreparedAttack } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { unitById } from '@/systems/combat/unitLookup';
import { carrierOf, isPreparedDue, preparedBy } from '@/systems/combat/preparedAttacks';
import { CombatSink } from '@/systems/combat/skillResolution';
import { landWarning } from '@/systems/combat/warnedLanding';

/**
 * Landing a caster's warned attacks that have come due.
 *
 * Called from `beginTurn`, so a landing is the caster's turn rather than an
 * extra event wedged between turns: its action is spent on the strike it
 * announced. Only attacks whose response window is over resolve; one still
 * owed a response waits and the caster acts normally in the meantime.
 *
 * Each one lands through `warnedLanding.landWarning`: the strike is the ordinary
 * resolver, run against the **warned footprint** from the **warned origin** — see
 * `ResolveOptions` — so everything an attack can do (damage types, statuses, pushes,
 * on-hit passives) is the one rule rather than a second implementation that could
 * drift from the preview.
 */
export function resolveDuePrepared(casterId: string, sink: CombatSink): PreparedAttack[] {
  const landed: PreparedAttack[] = [];

  for (const attack of preparedBy(casterId, useCombatStore.getState().preparedAttacks)) {
    const units = useCombatStore.getState().units;
    if (!isPreparedDue(attack, units)) continue;

    const caster = unitById(units, casterId);
    if (!caster || caster.currentHp <= 0) continue;

    landWarning(attack, caster, sink);
    landed.push(attack);
  }
  return landed;
}

/**
 * A carried warning whose carrier has fallen lands at once (`PreparedSpec.carried`: the Furnace Heart
 * bursts on the hex its carrier fell on), through the same landing as one that came due, so the answer
 * tally counts it the same way. Called between turns (`turnStart.beginTurn`), so whatever felled the
 * carrier — a burn at the start of their turn, his Claw, a crossing of the Rift — nobody acts between the
 * fall and the burst. Its caster must still stand; a fallen caster's warnings go with him.
 */
export function resolveFallenCarriers(sink: CombatSink): PreparedAttack[] {
  const landed: PreparedAttack[] = [];
  for (const attack of useCombatStore.getState().preparedAttacks) {
    const carrierId = carrierOf(attack);
    if (!carrierId) continue;
    const units = useCombatStore.getState().units;
    const carrier = unitById(units, carrierId);
    const caster = unitById(units, attack.casterId);
    if (!caster || caster.currentHp <= 0 || (carrier && carrier.currentHp > 0)) continue;
    landWarning(attack, caster, sink);
    landed.push(attack);
  }
  return landed;
}
