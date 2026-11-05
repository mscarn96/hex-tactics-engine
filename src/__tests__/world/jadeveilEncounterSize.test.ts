import { BALANCE } from '@/data/balanceConstants';
import { TileType } from '@/models/types';
import { planForEncounter } from '@/systems/world/encounterGenerator';
import { THREAT_BANDS } from '@/systems/world/threat';

describe('Jadeveil wandering fights', () => {
  it('field the party-sized body count at every band, with the band\'s own elites', () => {
    for (const band of THREAT_BANDS) {
      for (let i = 0; i < 20; i++) {
        const jade = planForEncounter('random_danger', band, TileType.Forest, Infinity, 'jadeveil');
        const empire = planForEncounter('random_danger', band, TileType.Forest, Infinity, 'empire');
        expect(jade.enemies.length).toBe(BALANCE.JADEVEIL_ENCOUNTER_SIZE[band]);
        expect(jade.enemies.length).toBeGreaterThanOrEqual(4);
        expect(jade.enemies.length).toBeLessThanOrEqual(6);
        expect(jade.shape?.roles.filter((r) => r === 'elite').length)
          .toBe(empire.shape?.roles.filter((r) => r === 'elite').length);
      }
    }
  });
});
