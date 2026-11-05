import { useCombatStore } from '@/stores/combatStore';
import { AfflictionType, VfxSpec } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { deathBurstOf } from '@/data/templates/summonTemplates';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { passiveDescription, PASSIVE_DEFS } from '@/systems/combat/passives';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * PT-22 (playtest 2026-10-21): the Frost Mote was meant to explode and did not —
 * death bursts were summon-only. An enemy template now carries a `deathBurst`,
 * and the Mote's is a radius-1 cold blast sized by its Magic that Chills.
 */

const state = () => useCombatStore.getState();
const hero = (id: string, q: number, r: number) =>
  makeUnit({ id, position: at(q, r), stats: makeStats({ maxHp: 200, defense: 0, magicDefense: 0 }) });

const setup = () => {
  const [mote] = createEnemyUnits(['frost_mote'], [at(0, 0)]);
  state().reset();
  state().initCombat([hero('near', 1, 0), hero('far', 3, 0)], [{ ...mote, id: 'mote' }]);
};
const hpOf = (id: string) => state().units.find((u) => u.id === id)!.currentHp;
const chill = (id: string) => state().units.find((u) => u.id === id)!.activeEffects.find((e) => e.type === AfflictionType.Chill);

describe('the Frost Mote shatters', () => {
  it('carries a magic, cold burst of radius 1 and the passive that states it', () => {
    const template = enemyTemplates.find((t) => t.id === 'frost_mote')!;
    expect(template.deathBurst).toEqual(expect.objectContaining({
      radius: 1, scaling: 'magic', damageType: 'magic', aftermath: 'rime',
      effect: expect.objectContaining({ type: AfflictionType.Chill }),
    }));
    expect(template.passives).toContain('frostBurst');
    expect(PASSIVE_DEFS.frostBurst).toBeDefined();
    expect(passiveDescription('frostBurst')).toContain(`${Math.round(BALANCE.FROST_MOTE_BURST.AMOUNT * 100)}%`);
  });

  it('every enemy that bursts says so on its card', () => {
    const silent = enemyTemplates.filter((t) => t.deathBurst && !(t.passives ?? []).includes('frostBurst')).map((t) => t.id);
    expect(silent).toEqual([]);
  });

  it('explodes on death, striking and Chilling only the heroes within its radius', () => {
    setup();
    const mote = state().units.find((u) => u.id === 'mote')!;
    expect(deathBurstOf(mote)).toBeDefined();
    const { deathEvents } = state().damageUnit('mote', 9999, 'near');
    const blast = (deathEvents ?? []).find((e) => (e.vfx as VfxSpec | undefined)?.kind === 'explosion');
    expect(blast?.vfx).toEqual(expect.objectContaining({ aftermath: 'rime', color: '#bfe6f5' }));
    expect(hpOf('near')).toBeLessThan(200);
    expect(hpOf('far')).toBe(200);
    expect(chill('near')).toBeDefined();
    expect(chill('far')).toBeUndefined();
    // Once per death
    expect(state().detonateDeathBurst('mote')).toEqual([]);
  });

  it('is sized by its Magic, not its Attack', () => {
    setup();
    const mote = state().units.find((u) => u.id === 'mote')!;
    state().damageUnit('mote', 9999, 'near');
    const lost = 200 - hpOf('near');
    // Undefended target, no crit floor: roughly AMOUNT × Magic, nowhere near Attack's 2
    expect(lost).toBeGreaterThanOrEqual(Math.floor(mote.stats.magic * BALANCE.FROST_MOTE_BURST.AMOUNT * 0.9));
  });
});
