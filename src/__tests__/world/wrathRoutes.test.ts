import { BALANCE } from '@/data/balanceConstants';
import { measureRoutes } from '@/systems/sim/wrathRoutes';

/**
 * Wrath's gains and decay against real Jadeveil routes (`systems/sim/wrathRoutes.ts`;
 * the measured table is in `docs/world.md`). Rules, not numbers: a
 * distant objective pays for its walk, full wrath takes a deliberate push, and
 * time away is a real lull.
 */
const SEEDS = [1, 42, 2026, 31337];
const reports = SEEDS.map(measureRoutes);
const DECAY = BALANCE.WRATH_DECAY_PER_HOUR;

describe('wrath on real routes', () => {
  it('stands in every quest and lair the shrine campaign will place', () => {
    for (const r of reports) {
      expect(r.objectives.filter((o) => o.source === 'quest')).toHaveLength(9);
      expect(r.objectives.filter((o) => o.source === 'lair').map((o) => o.band)).toEqual([2, 3, 4]);
      for (const o of r.objectives) expect(o.blockedHours).toBeGreaterThanOrEqual(o.hours);
    }
  });

  it('pays for the journey: every objective nets wrath from the camp and back, passes refused', () => {
    for (const r of reports) {
      for (const o of r.objectives) {
        expect(BALANCE.WRATH_GAIN[o.source] - DECAY * (2 * o.blockedHours + BALANCE.CAMP_REST_HOURS)).toBeGreaterThan(0);
      }
      // The most remote lair still keeps a good share of what it gives
      expect(r.remoteLairNet).toBeGreaterThan(0.3 * BALANCE.WRATH_GAIN.lair);
    }
  });

  it('fills the bar one sortie at a time only with nearly all the range’s work, earning floors on the way', () => {
    for (const r of reports) {
      expect(r.sortiesToFull).toBeGreaterThanOrEqual(Math.ceil(0.8 * r.objectives.length));
      expect(r.sortieFloor).toBeGreaterThanOrEqual(BALANCE.WRATH_FLOORS[1]);
    }
  });

  it('fills it with a push, of most of the range’s work and not a couple of fights', () => {
    for (const r of reports) {
      expect(r.pushToFull).toBeLessThan(r.sortiesToFull);
      expect(r.pushToFull).toBeGreaterThanOrEqual(6);
    }
  });

  it('lets a trip to the city and a week away be real lulls', () => {
    for (const r of reports) expect(r.cityLull).toBeGreaterThanOrEqual(8);
    expect(DECAY * BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK).toBeGreaterThanOrEqual(BALANCE.WRATH_FLOORS[0]);
    // But the summit's window outlasts the whole walk up from the camp
    for (const r of reports) expect(BALANCE.WRATH_WINDOW_HOURS).toBeGreaterThan(r.summitHours);
  });
});
