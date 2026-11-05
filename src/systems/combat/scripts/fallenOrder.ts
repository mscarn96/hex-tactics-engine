import { AfflictionType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { liftedDooms } from '@/systems/combat/fallenOrderKits';
import { unitById } from '@/systems/combat/unitLookup';
import { supportIntent } from '@/systems/combat/soundIntents';
import type { EncounterScript } from '@/systems/combat/encounterScript';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';

const BELL_VIOLET = '#9a6ae0';

/**
 * The Fallen Order's board rule: a Bell-Keeper's toll dies with it.
 *
 * Every other piece of the Order's kits is a field the shared resolver already reads
 * (the Warden's Bastion, the Mantis's blink, the Firefly's mote, the Abbot's Vow, the
 * Keeper's announced Great Ring), and their AI values are `fallenOrderKits`. What is
 * left is the Doom: between turns, any Doom a fallen Keeper laid is lifted before it
 * can land, so killing the Keeper inside the clock is an answer to the toll.
 */
export const fallenOrderScript: EncounterScript = {
  id: 'fallenOrder',

  betweenTurns(sink) {
    const store = useCombatStore.getState();
    for (const { unitId } of liftedDooms(store.units)) {
      store.removeEffect(unitId, AfflictionType.Doom);
      const freed = unitById(useCombatStore.getState().units, unitId);
      if (!freed) continue;
      sink.log('  ' + t('bossLog.fallen.tollLifted', { name: unitName(freed) }), BELL_VIOLET);
      sink.sound?.(supportIntent(freed, { family: 'cleanse' }));
      sink.float(freed.position, t('bossLog.fallen.float.tollLifted'), BELL_VIOLET);
    }
  },
};
