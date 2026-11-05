import { BALANCE } from '@/data/balanceConstants';
import { composeShrineKeepers } from '@/systems/world/encounterGenerator';
import { encounterPowerScale } from '@/systems/combat/encounterSetup';
import { SHRINE_KEEPERS, shrineBand, shrineEncounterId } from '@/systems/world/shrines';

/**
 * A shrine's keepers (playtest 2026-10-28): the first shrine fielded three Yokai, far too easy for a
 * claim that opens the band above. Now six, one of every kind the faction fields, and stronger.
 */
describe("a shrine's keepers", () => {
  it.each([1, 2, 3, 4])('are six of different kinds at shrine %i', (shrine) => {
    for (let i = 0; i < 50; i++) {
      const fight = composeShrineKeepers(SHRINE_KEEPERS[shrine], shrineBand(shrine));
      expect(fight.enemies).toHaveLength(BALANCE.SHRINE_KEEPERS);
      expect(new Set(fight.enemies).size).toBe(BALANCE.SHRINE_KEEPERS);
      expect(fight.shape.roles).toHaveLength(BALANCE.SHRINE_KEEPERS);
    }
  });

  it('field the whole Yokai roster at the first shrine', () => {
    expect([...composeShrineKeepers('yokai', shrineBand(1)).enemies].sort())
      .toEqual(['kappa', 'kitsune', 'kodama', 'nue', 'onibi', 'tanuki']);
  });

  it('stand above the ground they hold', () => {
    const terms = { threatBand: 1, groundDepth: 0, haunted: false, guardsChest: false, world: 'jadeveil' } as const;
    const base = { terms, castleRun: null, sim: { active: false, powerScale: 1 } } as unknown as Parameters<typeof encounterPowerScale>[0];
    // Any curated fight on the same ground: not wandering, so not thinned for its width
    const curated = encounterPowerScale({ ...base, encounterId: 'curated_site' });
    const keepers = encounterPowerScale({ ...base, encounterId: shrineEncounterId(1) });
    expect(keepers).toBeCloseTo(curated * BALANCE.SHRINE_KEEPER_POWER, 5);
  });
});
