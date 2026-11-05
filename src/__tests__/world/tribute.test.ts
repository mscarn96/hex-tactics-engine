import {
  isTributeOwed,
  settleTribute,
  siegeArmySize,
  siegeEncounterId,
  siegePowerScale,
  siegeWeekFromId,
  tributeDemand,
} from '@/systems/world/tribute';
import { generateEncounterEnemies } from '@/systems/world/encounterGenerator';
import { useEmpireStore } from '@/stores/empireStore';
import { BALANCE } from '@/data/balanceConstants';
import { useCalendarStore } from '@/stores/calendarStore';
import { useLocationStore } from '@/stores/locationStore';
import { collectCurrentTribute, tributeStopsTravel } from '@/systems/world/tributeCollection';

const GRACE = BALANCE.TRIBUTE_GRACE_WEEKS;

describe('the demand', () => {
  it('asks for nothing during the grace period', () => {
    for (let week = 1; week <= GRACE; week++) {
      expect(tributeDemand(week)).toBe(0);
    }
  });

  it('starts at the base the week grace ends', () => {
    expect(tributeDemand(GRACE + 1)).toBe(BALANCE.TRIBUTE_BASE);
  });

  it('doubles opening bills then uses the later growth without a phase jump', () => {
    for (let bill = 1; bill < BALANCE.TRIBUTE_EARLY_BILLS; bill++) {
      const raw = BALANCE.TRIBUTE_BASE * Math.pow(BALANCE.TRIBUTE_GROWTH, bill);
      expect(tributeDemand(GRACE + bill + 1)).toBe(Math.round(raw / 10) * 10);
    }
    const end = GRACE + BALANCE.TRIBUTE_EARLY_BILLS;
    const opening = BALANCE.TRIBUTE_BASE * Math.pow(BALANCE.TRIBUTE_GROWTH, BALANCE.TRIBUTE_EARLY_BILLS - 1);
    for (let late = 1; late <= 4; late++) {
      const raw = opening * Math.pow(BALANCE.TRIBUTE_LATE_GROWTH, late);
      expect(tributeDemand(end + late)).toBe(Math.round(raw / 10) * 10);
    }
  });

  it('never falls', () => {
    const falling: string[] = [];
    for (let week = 1; week < 40; week++) {
      if (tributeDemand(week + 1) < tributeDemand(week)) falling.push(`week ${week}`);
    }
    expect(falling).toEqual([]);
  });

  // The clock has to outrun a fixed income or idling is free
  it('compounds fast enough to force the player outward', () => {
    const first = tributeDemand(GRACE + 1);
    expect(tributeDemand(GRACE + 5)).toBeGreaterThan(first * 3);
  });

  // Playtest 2026-10-09: the later weeks snowballed. The curve is flatter, not
  // only lower: week 10's bill is about two thirds of what it was (4,050).
  it('snowballs more gently in the later weeks', () => {
    expect(tributeDemand(GRACE + 1)).toBeLessThan(100);
    expect(tributeDemand(10)).toBeLessThan(3000);
    expect(tributeDemand(11) / tributeDemand(10)).toBeLessThan(1.5);
  });

  it('rounds to something a player can read', () => {
    const ugly: number[] = [];
    for (let week = 1; week < 30; week++) {
      const demand = tributeDemand(week);
      if (demand % 10 !== 0) ugly.push(demand);
    }
    expect(ugly).toEqual([]);
  });
});

describe('settlement', () => {
  const rich = 1_000_000;

  it('takes nothing while grace holds', () => {
    const s = settleTribute(1, rich, false);
    expect(s.outcome).toBe('grace');
    expect(s.goldSpent).toBe(0);
  });

  it('pays when the purse covers it', () => {
    const week = GRACE + 1;
    const s = settleTribute(week, rich, false);
    expect(s.outcome).toBe('paid');
    expect(s.goldSpent).toBe(tributeDemand(week));
  });

  it('takes exactly the demand and no more', () => {
    const week = GRACE + 3;
    const demand = tributeDemand(week);
    expect(settleTribute(week, demand, false).goldSpent).toBe(demand);
  });

  // One gold short is short. There is no partial payment and no credit.
  it('sieges one gold short', () => {
    const week = GRACE + 1;
    const s = settleTribute(week, tributeDemand(week) - 1, false);
    expect(s.outcome).toBe('siege');
    expect(s.goldSpent).toBe(0);
  });

  it('stops forever once the emperor is dead', () => {
    const s = settleTribute(50, 0, true);
    expect(s.outcome).toBe('free');
    expect(s.demand).toBe(0);
  });
});

describe('owed weeks', () => {
  it('owes a week it has not settled', () => {
    expect(isTributeOwed(4, 3)).toBe(true);
  });

  it('does not owe a week already settled', () => {
    expect(isTributeOwed(3, 3)).toBe(false);
    expect(isTributeOwed(2, 3)).toBe(false);
  });
});

describe('the siege army', () => {
  it('grows with the calendar', () => {
    expect(siegePowerScale(10)).toBeGreaterThan(siegePowerScale(2));
  });

  it('starts from the flat siege strength in week one', () => {
    expect(siegePowerScale(1)).toBe(BALANCE.SIEGE_BASE_POWER);
  });

  // Playtest 2026-10-08: the first siege that can happen must be a real threat.
  // Playtest 2026-10-09: it overshot, and came down 12% (×1.37 → ×1.21).
  it('arrives in the first billed week stronger than a parity fight, short of the overshoot', () => {
    expect(siegePowerScale(GRACE + 1)).toBeGreaterThan(1.15);
    expect(siegePowerScale(GRACE + 1)).toBeLessThan(1.3);
    expect(siegeArmySize(GRACE + 1)).toBeGreaterThanOrEqual(4);
  });

  it('never shrinks', () => {
    const shrinking: number[] = [];
    for (let week = 1; week < 50; week++) {
      if (siegeArmySize(week + 1) < siegeArmySize(week)) shrinking.push(week);
      if (siegePowerScale(week + 1) < siegePowerScale(week)) shrinking.push(week);
    }
    expect(shrinking).toEqual([]);
  });

  /**
   * The spawn row physically holds five — `generateEnemyPositions` lays units
   * along `r = -4` and `inArena` admits only `q ∈ [-1, 3]`. A sixth would be
   * placed outside the arena, unreachable and unable to move.
   */
  it('never asks for more bodies than the arena can hold', () => {
    const oversized: number[] = [];
    for (let week = 1; week < 200; week++) {
      if (siegeArmySize(week) > BALANCE.SIEGE_MAX_ENEMIES) oversized.push(week);
    }
    expect(oversized).toEqual([]);
  });

  it('builds an encounter of the right size', () => {
    const mismatched: string[] = [];
    for (const week of [1, 5, 12, 40]) {
      const enemies = generateEncounterEnemies(siegeEncounterId(week));
      if (enemies.length !== siegeArmySize(week)) {
        mismatched.push(`week ${week}: ${enemies.length} vs ${siegeArmySize(week)}`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});

describe('siege encounter ids', () => {
  it('round-trips the week', () => {
    expect(siegeWeekFromId(siegeEncounterId(7))).toBe(7);
  });

  it('ignores every other encounter kind', () => {
    for (const id of ['boss_0', 'quest_1', 'random_danger', 'easy', '']) {
      expect(siegeWeekFromId(id)).toBeNull();
    }
  });
});

describe('empireStore', () => {
  beforeEach(() => useEmpireStore.getState().reset());

  it('starts owing week one', () => {
    expect(isTributeOwed(1, useEmpireStore.getState().lastSettledWeek)).toBe(true);
  });

  // Playtest 2026-10-08: the weekly dialog opened on day one of a new game
  it('asks nothing until the first week has ended', () => {
    useCalendarStore.getState().reset();
    useLocationStore.getState().leave();
    expect(collectCurrentTribute()).toBeNull();
    useCalendarStore.getState().loadClock(7 * 24);
    expect(useCalendarStore.getState().weekNumber).toBe(2);
    expect(collectCurrentTribute()?.settlement.outcome).toBe('grace');
  });

  // Playtest 2026-10-09: every multi-hex trip in week one stopped after one hex
  it('lets a journey run through week one, and stops it only when a decision is due', () => {
    useCalendarStore.getState().reset();
    useLocationStore.getState().leave();
    expect(tributeStopsTravel()).toBe(false);
    useCalendarStore.getState().loadClock(7 * 24);
    expect(tributeStopsTravel()).toBe(true);
    useEmpireStore.getState().settleWeek(2, 0);
    expect(tributeStopsTravel()).toBe(false);
  });

  // Playtest 2026-10-24: a "no tribute is due" dialog every week after Aethelred fell
  it('asks nothing and stops no journey once the emperor is dead', () => {
    useCalendarStore.getState().reset();
    useLocationStore.getState().leave();
    useCalendarStore.getState().loadClock(5 * 7 * 24);
    useEmpireStore.getState().setEmperorDefeated(true);
    expect(collectCurrentTribute()).toBeNull();
    expect(tributeStopsTravel()).toBe(false);
  });

  it('records a payment', () => {
    useEmpireStore.getState().settleWeek(3, 250);
    const s = useEmpireStore.getState();
    expect(s.lastSettledWeek).toBe(3);
    expect(s.tributePaid).toBe(1);
    expect(s.goldPaid).toBe(250);
  });

  // A siege settles the week too — it is resolved, just not paid
  it('closes the week without counting an unpaid one as paid', () => {
    useEmpireStore.getState().settleWeek(3, 0);
    const s = useEmpireStore.getState();
    expect(s.lastSettledWeek).toBe(3);
    expect(s.tributePaid).toBe(0);
    expect(isTributeOwed(3, s.lastSettledWeek)).toBe(false);
  });

  // Guards against a stale settlement reopening a week already dealt with
  it('never walks the settled week backwards', () => {
    useEmpireStore.getState().settleWeek(6, 100);
    useEmpireStore.getState().settleWeek(2, 100);
    expect(useEmpireStore.getState().lastSettledWeek).toBe(6);
  });

  it('forgets everything on reset', () => {
    useEmpireStore.getState().settleWeek(9, 500);
    useEmpireStore.getState().recordSiege();
    useEmpireStore.getState().setEmperorDefeated(true);
    useEmpireStore.getState().reset();
    expect(useEmpireStore.getState()).toMatchObject({
      lastSettledWeek: 0,
      tributePaid: 0,
      goldPaid: 0,
      siegesFought: 0,
      emperorDefeated: false,
    });
  });
});
