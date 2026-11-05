import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { CombatOutcome, combatOutcome } from '@/systems/combat/combatOutcome';
import { CombatSink } from '@/systems/combat/skillResolution';
import { livingEnemies, pendingWaveCount, planArrival, waveDue } from '@/systems/combat/waves';
import { waveAnnounce } from '@/data/templates/encounterWaves';
import { t } from '@/i18n';

/**
 * Putting an announced wave on the board.
 *
 * Called from `beginTurn`, so reinforcements always arrive *between* two turns:
 * after the blow that earned them has been drawn and before anyone acts into an
 * empty arena. The first call for a wave announces it; a wave the board was too
 * full to take in one go carries on in later calls without announcing again.
 * What a wave *is* — triggers, limits, spawn hexes — lives in `waves`.
 *
 * Returns the names of the units that arrived.
 */
export function resolveWaves(sink: CombatSink): string[] {
  const store = useCombatStore.getState();
  const due = waveDue(store.waves, store.units);
  if (!due) return [];

  const arrival = planArrival(due, store.units, store.hazards);
  if (arrival.templateIds.length === 0) {
    // Nowhere to put anybody. Wait for room — unless there is no opposition at
    // all, where waiting would be a soft-lock: the wave is dropped instead.
    if (livingEnemies(store.units).length === 0) {
      store.patchWave(due.wave.id, { status: 'done', pending: [] });
    } else if (due.status === 'waiting') {
      store.patchWave(due.wave.id, { status: 'arriving' });
    }
    return [];
  }

  if (due.status === 'waiting') {
    const line = waveAnnounce(due.wave.id);
    sink.log(line, '#ff9a4a');
    sink.announce?.(line);
  }

  const { partyLevel, powerScale, spared, contentLevel } = store.waveScale;
  const arrived = createEnemyUnits(arrival.templateIds, arrival.hexes, partyLevel, powerScale, spared, contentLevel);
  store.addUnits(arrived);
  sink.arrive?.(arrived);
  store.patchWave(due.wave.id, {
    status: arrival.remaining.length > 0 ? 'arriving' : 'done',
    pending: arrival.remaining,
  });
  for (const unit of arrived) {
    sink.log(`  ${t('bossLog.waves.arrives', { name: unit.name })}`, '#ff9a4a');
    sink.float(unit.position, t('bossLog.float.arrives'), '#ff9a4a');
  }
  return arrived.map((u) => u.name);
}

/**
 * Whether the fight on the board is over — `combatOutcome` with the store's
 * announced waves counted in. What every driver asks, so none can end a fight
 * between two waves.
 */
export function fightOutcome(): CombatOutcome {
  const { units, waves } = useCombatStore.getState();
  return combatOutcome(units, pendingWaveCount(waves));
}
