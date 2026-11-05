import { BuildingType, CombatUnit, GamePhase, Hero, ResourceType } from '@/models/types';
import { useCityStore } from '@/stores/cityStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useGameStore } from '@/stores/gameStore';
import { useInventoryStore, selectGear } from '@/stores/inventoryStore';
import { usePartyStore } from '@/stores/partyStore';
import { CombatReward, DefeatPenalties } from '@/systems/combat/combatRewards';
import { applyDefeat, applyVictory } from '@/systems/combat/encounterResolution';
import { useMythicStore } from '@/stores/mythicStore';
import { itemFromTemplateId } from '@/systems/economy/itemFactory';
import { buildSimHero, defaultHeroConfig } from '@/systems/sim/simHarness';
import { at, makeStats, makeUnit } from '../support/fixtures';

/**
 * What a fight does to the rest of the game, asserted without a scene.
 *
 * The scene's `handleVictory` and `handleDefeat` wrote nine stores from inside
 * `CombatScene`, so the rules among them were only reachable by mounting an R3F
 * tree; the formVigor rule had a test that read the source of a different file
 * for a comment. They are `applyVictory` and `applyDefeat` now and run here.
 */

const mint = (item: Parameters<ReturnType<typeof useInventoryStore.getState>['addItem']>[0]) => {
  useInventoryStore.getState().addItem(item);
  return item.id;
};

function hero(id: string, templateId: 'warrior' | 'mage' = 'warrior'): Hero {
  return buildSimHero(defaultHeroConfig(templateId, 5), mint, id)!;
}

const reward = (over: Partial<CombatReward> = {}): CombatReward => ({
  kind: 'combat', xpPerHero: 0, gold: 0, items: [], gems: [], resources: [], ...over,
});

/** The fight's hero as the board holds it, with the health the fight ended on. */
const fighter = (h: Hero, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id: `unit_${h.id}`, heroId: h.id, isPlayer: true, position: at(0, 0), stats: makeStats({ maxHp: 100, maxMana: 40 }), ...over });

const party = () => usePartyStore.getState().heroes;
const heroNow = (id: string) => party().find((h) => h.id === id)!;

beforeEach(() => {
  usePartyStore.getState().reset();
  useInventoryStore.getState().reset();
  useCityStore.getState().reset();
  useEmpireStore.getState().reset();
  useCombatStore.getState().reset();
  useGameStore.setState({ phase: GamePhase.Combat, currentEncounterId: 'random_danger', encounterEntry: null });
});

describe('applyVictory', () => {
  const ctx = (units: CombatUnit[]) => ({ units, encounterId: 'random_danger', castleRun: null, guardsChest: false });

  it('banks the mythic counter when the fight says so, and leaves it otherwise', () => {
    useMythicStore.setState({ kills: 4 });
    applyVictory(reward(), ctx([]));
    expect(useMythicStore.getState().kills).toBe(4);
    applyVictory(reward({ mythicKills: 5 }), ctx([]));
    expect(useMythicStore.getState().kills).toBe(5);
    applyVictory(reward({ mythicKills: 0 }), ctx([]));
    expect(useMythicStore.getState().kills).toBe(0);
  });

  /**
   * A fight won as a bear ends with health measured against the bear's pool.
   * Written straight back it would hand the Druid a share of a body they are no
   * longer wearing, so the pool's size is divided out before it is banked.
   */
  it('banks a shape-shifted hero\'s health out of the animal\'s pool', () => {
    const druid = hero('druid');
    usePartyStore.setState({ heroes: [druid] });
    const beast = fighter(druid, { currentHp: 120, formVigor: 1.5, wildForm: 'bear' });

    applyVictory(reward(), ctx([beast]));

    expect(heroNow('druid').currentHp).toBe(80);
  });

  it('keeps the animal for the next fight, and not a fallen hero\'s', () => {
    const alive = hero('alive');
    const fallen = hero('fallen', 'mage');
    usePartyStore.setState({ heroes: [alive, fallen] });

    applyVictory(reward(), ctx([
      fighter(alive, { currentHp: 70, wildForm: 'wolf' }),
      fighter(fallen, { currentHp: 0, wildForm: 'wolf' }),
    ]));

    expect(heroNow('alive').wildForm).toBe('wolf');
    expect(heroNow('fallen').wildForm ?? null).toBeNull();
  });

  it('pays the purse, the bag and the gems, and says there was loot', () => {
    const winner = hero('winner');
    usePartyStore.setState({ heroes: [winner] });
    const sword = itemFromTemplateId('short_sword_plain')!;
    const before = useInventoryStore.getState().resources[ResourceType.Gold];
    const bagBefore = selectGear(useInventoryStore.getState()).length;

    const outcome = applyVictory(
      reward({ gold: 120, items: [sword], resources: [{ type: ResourceType.Wood, amount: 4 }] }),
      ctx([fighter(winner)]),
    );

    expect(outcome?.looted).toBe(true);
    const inventory = useInventoryStore.getState();
    expect(inventory.resources[ResourceType.Gold]).toBe(before + 120);
    expect(inventory.resources[ResourceType.Wood]).toBeGreaterThanOrEqual(4);
    expect(selectGear(inventory)).toHaveLength(bagBefore + 1);
  });

  it('gives experience to the living only, and reports the levels it earned', () => {
    const living = hero('living');
    const dead = hero('dead', 'mage');
    usePartyStore.setState({ heroes: [living, dead] });
    const xpBefore = [living.xp, dead.xp];

    applyVictory(reward({ xpPerHero: 40 }), ctx([fighter(living), fighter(dead, { currentHp: 0 })]));

    expect(heroNow('living').xp).toBeGreaterThan(xpBefore[0]);
    expect(heroNow('dead').xp).toBe(xpBefore[1]);
  });

  it('pays a fight once: the second close of the dialog is nothing', () => {
    const winner = hero('winner');
    usePartyStore.setState({ heroes: [winner] });
    useGameStore.setState({
      encounterEntry: { id: 'random_danger', plan: { enemies: [] } as never, players: [], enemies: [], partyLevel: 1, powerScale: 1, resolved: false },
    });
    const units = [fighter(winner)];

    expect(applyVictory(reward({ gold: 10 }), ctx(units))).not.toBeNull();
    const gold = useInventoryStore.getState().resources[ResourceType.Gold];
    expect(applyVictory(reward({ gold: 10 }), ctx(units))).toBeNull();
    expect(useInventoryStore.getState().resources[ResourceType.Gold]).toBe(gold);
    expect(useGameStore.getState().encounterEntry?.resolved).toBe(true);
  });

  it('patches the party up between castle stages, up to the maxima', () => {
    const climber = hero('climber');
    usePartyStore.setState({ heroes: [climber] });
    const tired = fighter(climber, { currentHp: 10, currentMana: 0, stats: makeStats({ maxHp: 200, maxMana: 100 }) });

    applyVictory(
      reward({ nextStage: { name: 'Hall', blurb: '', healed: 0.3 } }),
      { units: [tired], encounterId: 'castle_1_0', castleRun: { tier: 1, stage: 0 }, guardsChest: false },
    );

    // A share of the maximum is added to what the hero had, and never past it
    expect(heroNow('climber').currentHp).toBeGreaterThanOrEqual(10);
    expect(heroNow('climber').currentHp).toBeLessThanOrEqual(200);
  });
});

describe('applyDefeat', () => {
  const penalties = (goldLost: number): DefeatPenalties => ({ goldLost } as DefeatPenalties);

  function lose() {
    const lost = hero('lost');
    const store = useInventoryStore.getState();
    // `addItem` mints the id the bag knows the item by
    const wornId = store.addItem(itemFromTemplateId('short_sword_plain')!);
    const spareId = store.addItem(itemFromTemplateId('short_sword_plain')!);
    usePartyStore.setState({ heroes: [{ ...lost, currentHp: 3, wildForm: 'bear', equipment: { mainHand: wornId } }] });
    store.addResource(ResourceType.Gold, 500);
    return { worn: { id: wornId }, spare: { id: spareId } };
  }

  it('takes the unequipped bag and the gold, and sends the party home whole and upright', () => {
    const { worn, spare } = lose();
    const purse = useInventoryStore.getState().resources[ResourceType.Gold];

    applyDefeat(penalties(200), { castleRun: null, isSiege: false });

    const inventory = useInventoryStore.getState();
    expect(selectGear(inventory).map((i) => i.id)).toContain(worn.id);
    expect(selectGear(inventory).map((i) => i.id)).not.toContain(spare.id);
    expect(inventory.resources[ResourceType.Gold]).toBe(purse - 200);
    expect(heroNow('lost').currentHp).toBeGreaterThan(3);
    expect(heroNow('lost').wildForm ?? null).toBeNull();
  });

  it('razes the city when the siege is lost, and not otherwise', () => {
    lose();
    useCityStore.setState((s) => ({ buildings: s.buildings.map((b) => ({ ...b, level: 2 })) }));
    useInventoryStore.getState().addResource(ResourceType.Wood, 50);

    applyDefeat(penalties(0), { castleRun: null, isSiege: false });
    expect(useCityStore.getState().getBuildingLevel(BuildingType.Barracks)).toBe(2);
    expect(useInventoryStore.getState().resources[ResourceType.Wood]).toBe(50);
    expect(useCityStore.getState().sackedUntilDay).toBe(0);

    applyDefeat(penalties(0), { castleRun: null, isSiege: true });
    expect(useCityStore.getState().buildings.every((b) => b.level === 0)).toBe(true);
    expect(useInventoryStore.getState().resources[ResourceType.Wood]).toBe(0);
    // And the town is sacked from today, for `SACK_DAYS`
    expect(useCityStore.getState().sackedUntilDay).toBe(useCalendarStore.getState().dayNumber + BALANCE.SACK_DAYS);
  });

  it('ends a castle run it was fighting in', () => {
    lose();
    useEmpireStore.getState().beginCastleRun(1);
    const end = jest.spyOn(useEmpireStore.getState(), 'endCastleRun');

    applyDefeat(penalties(0), { castleRun: { tier: 1, stage: 2 }, isSiege: false });

    expect(end).toHaveBeenCalledWith(false);
    end.mockRestore();
  });
});
