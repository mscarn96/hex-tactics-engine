import type { CombatUnit } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';

/**
 * A rotation boss's scripted move was made: the caster has acted, and the rotation moves on to
 * the step the action carries (`AIAction.bossStep`; none for a move that does not advance it,
 * such as a Fury Sweep). The Emperor and the Troll Chieftain both settle a cast this way.
 */
export function settleRotationCast(caster: CombatUnit, bossStep: number | undefined): void {
  const store = useCombatStore.getState();
  store.markActed(caster.id);
  if (bossStep !== undefined) store.patchBossScript(caster.id, { step: bossStep });
}
