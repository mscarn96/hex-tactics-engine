import type { TickEvent } from '@/stores/combatStore';
import { unitName } from '@/data/templates/unitText';
import { useCombatStore } from '@/stores/combatStore';
import { unitById } from '@/systems/combat/unitLookup';
import type { CombatSink } from '@/systems/combat/combatSink';

/**
 * Puts what the store handed back — the fire a body took crossing a Cinder Rift
 * — on the board: its picture, its log line and its number over the unit.
 * `turnStart` plays its own ticks the same way; this is for the callers that
 * move a unit mid-action (a hero's step, a shove) and hold a sink.
 */
export function playTickEvents(events: TickEvent[], sink: Pick<CombatSink, 'log' | 'float' | 'vfx'>,
): void {
  for (const ev of events) {
    if (ev.vfx) sink.vfx(ev.vfx);
    const target = unitById(useCombatStore.getState().units, ev.unitId);
    if (!target) continue;
    sink.log(`${unitName(target)} ${ev.log ?? ev.text}`, ev.color);
    sink.float(target.position, ev.text, ev.color);
  }
}
