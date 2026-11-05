import { hoursToNextDawn, quoteTavernRest, restAtTavern } from '@/systems/economy/tavernRest';
import { collectCurrentTribute, payCurrentTribute, weeklyDecisionDue } from '@/systems/world/tributeCollection';
import { tributeDemand } from '@/systems/world/tribute';
import { useCalendarStore } from '@/stores/calendarStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useCityStore } from '@/stores/cityStore';
import { useLocationStore } from '@/stores/locationStore';
import { BuildingType, ResourceType, MapFind } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { heroMaxHp, heroMaxMana } from '@/systems/progression/statCalc';
import { mealDawnHeal, mealTier } from '@/systems/economy/expeditionMeals';

const weekHours = BALANCE.HOURS_PER_DAY * BALANCE.DAYS_PER_WEEK;
beforeEach(() => {
  useWorldMapStore.getState().reset(); usePartyStore.getState().reset();
  useInventoryStore.getState().reset(); useCityStore.getState().reset();
  useEmpireStore.getState().reset(); useLocationStore.getState().leave();
  usePartyStore.getState().addHero('warrior');
  const hero = usePartyStore.getState().heroes[0];
  usePartyStore.getState().setHp(hero.id,1); usePartyStore.getState().setMana(hero.id,0);
  useInventoryStore.getState().addResource(ResourceType.Gold,10000);
});

describe('a paid Tavern night follows normal dawn', () => {
  it('waits strictly to the next dawn, including a full night at dawn itself', () => {
    expect(hoursToNextDawn(0)).toBe(BALANCE.HOURS_PER_DAY);
    for(let h=0;h<weekHours;h++) {
      const duration=hoursToNextDawn(h);
      expect(duration).toBeGreaterThan(0);
      expect((h+duration)%BALANCE.HOURS_PER_DAY).toBe(0);
    }
  });
  it('spends the quoted price once, restores full effective HP/mana and keeps position', () => {
    useCalendarStore.getState().loadClock(7);
    const quote=quoteTavernRest(),position=useWorldMapStore.getState().partyPosition;
    const gold=useInventoryStore.getState().resources.gold;
    expect(restAtTavern().ok).toBe(true);
    expect(useInventoryStore.getState().resources.gold).toBe(gold-quote.price);
    expect(useCalendarStore.getState().totalHours).toBe(24);
    expect(useWorldMapStore.getState().partyPosition).toEqual(position);
    const hero=usePartyStore.getState().heroes[0];
    expect(hero.currentHp).toBe(heroMaxHp(hero));expect(hero.currentMana).toBe(heroMaxMana(hero));
    expect(restAtTavern()).toEqual({ok:false,reason:'whole'});
  });
  it('uses the active meal at an ordinary dawn without extending its week', () => {
    useCalendarStore.getState().loadClock(23);useCityStore.setState({meal:{tier:1,week:1}});
    const dawn=jest.spyOn(usePartyStore.getState(),'healAll');
    expect(restAtTavern().ok).toBe(true);
    expect(dawn).toHaveBeenCalledWith(mealDawnHeal(1));dawn.mockRestore();
    expect(useCityStore.getState().meal).toEqual({tier:1,week:1});
    expect(mealTier(useCityStore.getState().meal,useCalendarStore.getState().weekNumber)).toBe(1);
  });
  it('expires the meal, recharges wells, redeals finds and rerolls encounters on the final night', () => {
    const stale:MapFind={kind:'cache',coord:{q:1,r:0},band:0,payout:[{type:ResourceType.Wood,amount:3}]};
    useWorldMapStore.setState({tiles:new Map(),finds:new Map([['1,0',stale]]),usedMagicWells:new Set(['2,0']),activeEncounterTiles:new Set(['stale'])});
    useCalendarStore.getState().loadClock(weekHours-1);useCityStore.setState({meal:{tier:3,week:1}});
    const dawn=jest.spyOn(usePartyStore.getState(),'healAll');
    expect(restAtTavern().ok).toBe(true);
    expect(dawn).toHaveBeenCalledWith(mealDawnHeal(0));dawn.mockRestore();
    expect(useCalendarStore.getState().weekNumber).toBe(2);
    expect(mealTier(useCityStore.getState().meal,2)).toBe(0);
    expect(useWorldMapStore.getState().usedMagicWells.size).toBe(0);
    expect(useWorldMapStore.getState().finds.has('1,0')).toBe(false);
    expect(useWorldMapStore.getState().activeEncounterTiles.size).toBe(0);
  });
  it('refuses an unaffordable bed without spending time', () => {
    useInventoryStore.setState(s=>({resources:{...s.resources,gold:0}}));
    expect(restAtTavern()).toEqual({ok:false,reason:'gold'});
    expect(useCalendarStore.getState().totalHours).toBe(0);
  });
});
describe('sleeping into tribute day', () => {
  it('accounts for the bed before warning and changes nothing until accepted', () => {
    useCalendarStore.getState().loadClock(2*weekHours-1);
    const price=quoteTavernRest().price,demand=tributeDemand(3);
    useInventoryStore.setState(s=>({resources:{...s.resources,gold:demand+price-1}}));
    expect(quoteTavernRest().shortfall).toBe(1);
    expect(restAtTavern()).toEqual({ok:false,reason:'warning'});
    expect(useCalendarStore.getState().totalHours).toBe(2*weekHours-1);
    expect(useInventoryStore.getState().resources.gold).toBe(demand+price-1);
    const result=restAtTavern(true);
    expect(result.ok&&result.tribute?.settlement.outcome).toBe('siege');
    expect(useCalendarStore.getState().weekNumber).toBe(3);
    expect(useEmpireStore.getState().lastSettledWeek).toBe(0);
  });
  it('waits for the explicit payment before collecting an affordable bill once', () => {
    useCalendarStore.getState().loadClock(2*weekHours-1);
    const before=useInventoryStore.getState().resources.gold,quote=quoteTavernRest();
    expect(restAtTavern().ok).toBe(true);
    expect(useInventoryStore.getState().resources.gold).toBe(before-quote.price);
    expect(useEmpireStore.getState().lastSettledWeek).toBe(0);
    expect(payCurrentTribute(3)).toBe(true);
    expect(payCurrentTribute(3)).toBe(false);
    expect(useInventoryStore.getState().resources.gold).toBe(before-quote.price-tributeDemand(3));
    expect(useEmpireStore.getState().lastSettledWeek).toBe(3);
    expect(collectCurrentTribute()).toBeNull();
  });
  /** PT-04 (playtest 2026-10-17): the week's decision waited for nobody and opened over the tavern. */
  it('holds the weekly decision while the party is still in the tavern, then asks on the way out', () => {
    useLocationStore.getState().setBuilding(BuildingType.Tavern);
    useCalendarStore.getState().loadClock(2*weekHours-1);
    const result=restAtTavern();
    expect(result.ok&&result.tribute?.week).toBe(3);
    expect(collectCurrentTribute()?.week).toBe(3);
    expect(weeklyDecisionDue()).toBeNull();
    useLocationStore.getState().setBuilding(null);
    expect(weeklyDecisionDue()?.week).toBe(3);
    expect(useEmpireStore.getState().lastSettledWeek).toBe(0);
  });
  it('drops the building when the party leaves the place it stands in', () => {
    useLocationStore.getState().setBuilding(BuildingType.Shop);
    useLocationStore.getState().leave();
    expect(useLocationStore.getState().building).toBeNull();
  });
  it('never warns or charges once the Emperor is defeated', () => {
    useCalendarStore.getState().loadClock(2*weekHours-1);useEmpireStore.getState().setEmperorDefeated(true);
    useInventoryStore.setState(s=>({resources:{...s.resources,gold:quoteTavernRest().price}}));
    expect(quoteTavernRest().shortfall).toBe(0);
    expect(restAtTavern().ok).toBe(true);
  });
});
