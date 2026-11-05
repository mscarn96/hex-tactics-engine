import { GamePhase, POIType, Rarity, ResourceType, TileType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { levelCap, setLevelCapInputs } from '@/data/levelCap';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { getLocation, locationContext } from '@/locations';
import { triggerKey } from '@/locations/types';
import { useEmpireStore } from '@/stores/empireStore';
import { useGameStore } from '@/stores/gameStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useLocationStore } from '@/stores/locationStore';
import { usePartyStore } from '@/stores/partyStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { buildEncounter, encounterPowerScale, encounterTerms } from '@/systems/combat/encounterSetup';
import { CombatReward, rewardScaleFor, victoryRewards } from '@/systems/combat/combatRewards';
import { applyDefeat, applyVictory } from '@/systems/combat/encounterResolution';
import { buildSimHero, defaultHeroConfig } from '@/systems/sim/simHarness';
import { curatedBand, planForEncounter } from '@/systems/world/encounterGenerator';
import {
  HEART_LAIR_BOSS_ENCOUNTER, HEART_LAIR_ID, HEART_TIERS, canEnterHeart, heartChestLevel, heartSealEncounterId,
  heartSpendsSeal, heartTierFromId, heartTierScale, heartTwistsAt, openHeartTiers, winterSealRewardFor,
} from '@/systems/world/heartRefight';
import { isLairCleared, lairGate } from '@/systems/world/lairs';
import { isRepeatableEncounter } from '@/systems/world/repeatableFights';
import { makeFoe, makeUnit } from '../support/fixtures';

/**
 * The Heart of Winter's Seal refight (the private project notes, *The Heart of
 * Winter's refight*): its chamber fought again from the cleared Barrow's door, on its own
 * Winter Seal ladder — tier 1 free with no chest, tiers 2–5 a Seal spent on the way in, a
 * chest at `levelCap() − 5 + tier` and the Seal one rung up.
 */

const none = () => [0, 0, 0, 0, 0];
const oneSeal = (t: number) => none().map((_, i) => (i === t - 1 ? 1 : 0));

beforeEach(() => {
  useEmpireStore.getState().reset();
  setLevelCapInputs({ emperorDefeated: false });
});

describe('the ladder', () => {
  it('names its tiers by encounter id, and nothing else', () => {
    for (const tier of HEART_TIERS) expect(heartTierFromId(heartSealEncounterId(tier))).toBe(tier);
    for (const id of [null, '', HEART_LAIR_BOSS_ENCOUNTER, 'heart_seal_0', 'heart_seal_6', 'summit_kairen_2']) {
      expect(heartTierFromId(id)).toBeNull();
    }
    expect(HEART_TIERS).toEqual([1, 2, 3, 4, 5]);
    for (const tier of HEART_TIERS) expect(isRepeatableEncounter(heartSealEncounterId(tier))).toBe(true);
  });

  it('opens tier 1 free at the cleared Barrow, and every other tier only to its Seal', () => {
    expect(openHeartTiers(none(), true)).toEqual([1]);
    expect(openHeartTiers(none(), false)).toEqual([]);
    expect(openHeartTiers(oneSeal(3), true)).toEqual([1, 3]);
    expect(canEnterHeart(3, oneSeal(3), false)).toBe(false);
    expect(HEART_TIERS.map(heartSpendsSeal)).toEqual([false, true, true, true, true]);
  });

  it('pays the Seal one rung up, and another top-tier Seal at the top', () => {
    expect(HEART_TIERS.map(winterSealRewardFor)).toEqual([2, 3, 4, 5, 5]);
  });

  it('pays no chest at tier 1, and from tier 2 a chest at the cap − 5 + tier that follows the cap', () => {
    expect(heartChestLevel(1)).toBeNull();
    for (const tier of HEART_TIERS.slice(1)) expect(heartChestLevel(tier)).toBe(levelCap() - 5 + tier);
    expect(heartChestLevel(5)).toBe(levelCap());
    setLevelCapInputs({ emperorDefeated: true });
    expect(heartChestLevel(5)).toBe(levelCap());
  });

  it('prices each tier one fifth above the last', () => {
    expect(HEART_TIERS.map((t) => Number(heartTierScale(t).toFixed(2)))).toEqual([1, 1.2, 1.4, 1.6, 1.8]);
  });

  it('names a twist for each tier from the second, keeping the ones below', () => {
    expect(heartTwistsAt(1)).toEqual([]);
    for (const tier of HEART_TIERS) expect(heartTwistsAt(tier)).toHaveLength(tier - 1);
  });
});

describe('the Winter Seals in the empire', () => {
  it('spends a tier’s Seal on the way in, and nothing at tier 1', () => {
    const empire = useEmpireStore.getState();
    expect(empire.enterHeart(2, true)).toBe(false);
    expect(empire.enterHeart(1, true)).toBe(true);
    expect(useEmpireStore.getState().winterSeals).toEqual(none());
    useEmpireStore.setState({ winterSeals: oneSeal(2) });
    expect(useEmpireStore.getState().enterHeart(2, false)).toBe(false);
    expect(useEmpireStore.getState().enterHeart(2, true)).toBe(true);
    expect(useEmpireStore.getState().winterSeals).toEqual(none());
  });

  it('pays a tier-2 Seal for the lair’s kill, and the next rung for each clear', () => {
    const { clearHeart } = useEmpireStore.getState();
    expect(clearHeart(1).sealTier).toBe(2);
    expect(useEmpireStore.getState()).toMatchObject({ winterSeals: [0, 1, 0, 0, 0], heartTier: 1 });
    clearHeart(5);
    clearHeart(3);
    expect(useEmpireStore.getState()).toMatchObject({ winterSeals: [0, 1, 0, 1, 1], heartTier: 5 });
    // Obsidian Seals are the castle's alone
    expect(useEmpireStore.getState().seals).toEqual(none());
  });
});

describe('the refight is the lair’s boss fight, priced by its tier', () => {
  const heroes = ['warrior', 'mage', 'warrior', 'mage'].map((t, i) =>
    buildSimHero(defaultHeroConfig(t as 'warrior' | 'mage', 14), (item) => item.id, `h${i}`)!);
  // Fought from the Barrow's door: the ground under it says nothing, the lair's band does
  const ground = {
    tile: { type: TileType.Highlands, threat: 1 }, partyPosition: { q: 9, r: 9 }, cityCoord: { q: 0, r: 0 },
    castleCoord: null, onDangerGround: true,
  };
  const build = (encounterId: string) => buildEncounter({
    encounterId, terms: encounterTerms(encounterId, ground), heroes, castleRun: null,
    sim: { active: false, powerScale: 1 }, entry: null,
  });

  it('fights at the lair’s band, with the lair’s roster', () => {
    const lair = encounterTerms(HEART_LAIR_BOSS_ENCOUNTER, ground);
    for (const tier of HEART_TIERS) {
      const id = heartSealEncounterId(tier);
      expect(curatedBand(id)).toBe(curatedBand(HEART_LAIR_BOSS_ENCOUNTER));
      expect(encounterTerms(id, ground)).toEqual(lair);
      expect(planForEncounter(id, 4, TileType.Highlands, Infinity).enemies).toEqual(['heart_of_winter']);
    }
  });

  it('is the lair boss fight’s power × the tier, and carries its tier on the Heart', () => {
    const terms = encounterTerms(HEART_LAIR_BOSS_ENCOUNTER, ground);
    const lair = encounterPowerScale({ encounterId: HEART_LAIR_BOSS_ENCOUNTER, terms, castleRun: null, sim: { active: false, powerScale: 1 } });
    for (const tier of HEART_TIERS) {
      const id = heartSealEncounterId(tier);
      const price = encounterPowerScale({ encounterId: id, terms, castleRun: null, sim: { active: false, powerScale: 1 } });
      expect(price).toBeCloseTo(lair * heartTierScale(tier));
      const built = build(id);
      expect(built.powerScale).toBeCloseTo(price);
      expect(built.enemies.find((u) => u.templateId === 'heart_of_winter')?.challengeTier).toBe(tier);
    }
    expect(build(HEART_LAIR_BOSS_ENCOUNTER).enemies.find((u) => u.templateId === 'heart_of_winter')?.challengeTier).toBeUndefined();
  });

  it('pays the lair fight’s wage × the tier', () => {
    const lair = rewardScaleFor(null, HEART_LAIR_BOSS_ENCOUNTER, 4);
    for (const tier of HEART_TIERS) expect(rewardScaleFor(null, heartSealEncounterId(tier), 4)).toBeCloseTo(lair * heartTierScale(tier));
  });
});

describe('what a Heart kill pays', () => {
  const heart = enemyTemplates.find((t) => t.id === 'heart_of_winter')!;
  const pay = (encounterId: string) => victoryRewards({
    units: [makeUnit({ id: 'hero' }), makeFoe({ templateId: heart.id })],
    heroes: [{ id: 'h1', level: 18, masteryPath: null, equipment: {} } as never],
    encounterId, threatBand: 4, castleRun: null, isLastStage: false,
  });

  it('pays the lair’s first kill a tier-2 Seal and no ladder chest', () => {
    expect(pay(HEART_LAIR_BOSS_ENCOUNTER).winterSeal).toEqual({ tier: 1, sealTier: 2, itemLevel: null });
  });

  // The middle of every die: no spread on a drop's level (`dropItemLevel`), and the same rolls each fight
  const steady = () => jest.spyOn(Math, 'random').mockReturnValue(0.5);

  it('pays the free tier-1 refight the lair fight’s drops and a tier-2 Seal, but no chest', () => {
    const random = steady();
    try {
      const reward = pay(heartSealEncounterId(1));
      expect(reward.winterSeal).toEqual({ tier: 1, sealTier: 2, itemLevel: null });
      expect(reward.items.length).toBe(pay(HEART_LAIR_BOSS_ENCOUNTER).items.length);
      expect(pay(heartSealEncounterId(2)).items.length).toBeGreaterThanOrEqual(reward.items.length + BALANCE.CHEST_ITEMS.min);
    } finally { random.mockRestore(); }
  });

  it('pays a tier-n chest at the cap − 5 + n, the boss’s drop at the same level, and the next Seal', () => {
    const random = steady();
    try {
      for (const tier of HEART_TIERS.slice(1)) {
        const reward = pay(heartSealEncounterId(tier));
        expect(reward.winterSeal).toEqual({ tier, sealTier: winterSealRewardFor(tier), itemLevel: levelCap() - 5 + tier });
        // A legendary takes the cap whatever the source (`mintItem`); everything else mints at the chest's level
        for (const item of reward.items.filter((i) => i.rarity !== Rarity.Legendary)) expect(item.itemLevel).toBe(levelCap() - 5 + tier);
      }
    } finally { random.mockRestore(); }
  });

  it('pays nothing of the ladder for any other fight', () => {
    expect(pay('lair_barrow_1').winterSeal).toBeUndefined();
    expect(pay('random_danger').winterSeal).toBeUndefined();
  });
});

describe('a refight won at the Barrow’s door', () => {
  const bossTrigger = () => triggerKey(HEART_LAIR_ID, getLocation(HEART_LAIR_ID).lair!.bossAt);

  beforeEach(() => {
    usePartyStore.getState().reset();
    useInventoryStore.getState().reset();
    useLocationStore.setState({ spentTriggers: new Set([bossTrigger()]), current: null, pending: null });
    useGameStore.setState({ phase: GamePhase.Combat, currentEncounterId: heartSealEncounterId(2), encounterEntry: null });
  });

  it('banks the next Seal and the tier, and repeats none of the lair’s one-time payouts', () => {
    const door = { coord: { q: 4, r: 4 }, type: TileType.Highlands, poi: POIType.BossTile, encounterId: HEART_LAIR_ID, explored: true };
    const markDefeated = jest.fn();
    useWorldMapStore.setState({
      partyPosition: door.coord,
      getTile: () => door as never,
      markDefeated,
    } as never);
    const spent = new Set(useLocationStore.getState().spentTriggers);
    const reward: CombatReward = {
      kind: 'combat', xpPerHero: 0, gold: 0, items: [], gems: [], resources: [],
      winterSeal: { tier: 2, sealTier: 3, itemLevel: levelCap() - 3 },
    };
    applyVictory(reward, { units: [], encounterId: heartSealEncounterId(2), castleRun: null, guardsChest: false });
    expect(useEmpireStore.getState()).toMatchObject({ winterSeals: [0, 0, 1, 0, 0], heartTier: 2 });
    expect(markDefeated).not.toHaveBeenCalled();
    expect(useLocationStore.getState().spentTriggers).toEqual(spent);
  });

  it('a lost refight leaves the party at the door with the Seal spent, at a lost fight’s ordinary cost', () => {
    useWorldMapStore.setState({ partyPosition: { q: 4, r: 4 }, homeCoord: { q: 0, r: 0 } } as never);
    useEmpireStore.setState({ winterSeals: oneSeal(2) });
    useEmpireStore.getState().enterHeart(2, true);
    const gold = useInventoryStore.getState().resources[ResourceType.Gold];
    applyDefeat({ itemCount: 0, goldLost: 40 }, { castleRun: null, isSiege: false, atDoor: true });
    expect(useWorldMapStore.getState().partyPosition).toEqual({ q: 4, r: 4 });
    expect(useEmpireStore.getState().winterSeals).toEqual(none());
    expect(useInventoryStore.getState().resources[ResourceType.Gold]).toBe(gold - 40);
    // Any other lost fight still carries them home
    applyDefeat(null, { castleRun: null, isSiege: false });
    expect(useWorldMapStore.getState().partyPosition).toEqual({ q: 0, r: 0 });
  });

  it('opens on the picker rather than the lair: the Barrow is cleared, its gate refuses, and the door is the Heart’s', () => {
    const spentNow = useLocationStore.getState().spentTriggers;
    expect(isLairCleared(HEART_LAIR_ID, spentNow)).toBe(true);
    expect(lairGate(HEART_LAIR_ID, 999, spentNow)).toMatchObject({ open: false, cleared: true });
    useEmpireStore.setState({ winterSeals: oneSeal(2) });
    expect(useEmpireStore.getState().enterHeart(2, true)).toBe(true);
    useGameStore.getState().startEncounter(heartSealEncounterId(2), locationContext(HEART_LAIR_ID, getLocation(HEART_LAIR_ID).lair!.bossAt));
    expect(useGameStore.getState()).toMatchObject({ phase: GamePhase.Combat, currentEncounterId: heartSealEncounterId(2) });
    expect(useGameStore.getState().currentEncounterContext).toMatchObject({ kind: 'location', location: HEART_LAIR_ID });
    expect(useEmpireStore.getState().winterSeals).toEqual(none());
  });
});
