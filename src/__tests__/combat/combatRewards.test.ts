import {
  CastleRun,
  RewardContext,
  defeatPenalties,
  rewardScaleFor,
  victoryRewards,
} from '@/systems/combat/combatRewards';
import { castleTierScale, CASTLE_STAGE_COUNT } from '@/systems/world/castle';
import { siegeEncounterId, siegePowerScale } from '@/systems/world/tribute';
import { threatRewardScale, ThreatBand } from '@/systems/world/threat';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { Hero, Item, Rarity, ResourceType } from '@/models/types';
import { CHEST_GUARD_ID } from '@/systems/world/finds';
import { makeFoe, makeUnit } from '../support/fixtures';

/**
 * What a fight pays and what a loss costs.
 *
 * Both rules lived inside `useEffect`s in `CombatScene`, which is why neither
 * had a test: they were pure functions of the board, the encounter and the
 * party that happened to end in a `setState`.
 */

const foeTemplate = enemyTemplates[0];

const hero = (over: Partial<Hero> = {}): Hero =>
  ({ id: 'h1', level: 5, masteryPath: null, equipment: {}, ...over }) as Hero;

const ctx = (over: Partial<RewardContext> = {}): RewardContext => ({
  units: [makeUnit({ id: 'hero' }), makeFoe({ id: 'foe', templateId: foeTemplate.id })],
  heroes: [hero()],
  encounterId: 'random_danger',
  threatBand: 0 as ThreatBand,
  castleRun: null,
  isLastStage: false,
  ...over,
});

it('pays the final castle boss’s drop alongside its run chest', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.99);
  try {
    const reward = victoryRewards(ctx({
      units: [makeUnit({ id: 'hero' }), makeFoe({ templateId: 'aethelred' })],
      castleRun: { tier: 1, stage: CASTLE_STAGE_COUNT - 1 }, isLastStage: true,
    }));
    expect(reward.items.filter((item) => item.rarity === Rarity.Legendary)).toHaveLength(1);
    // at the top of every die: no second Legendary, the most Epics and Rares, the fullest chest
    expect(reward.items).toHaveLength(1 + BALANCE.BOSS_LOOT.OTHER_ITEMS.max + BALANCE.CHEST_ITEMS.max);
  } finally { jest.restoreAllMocks(); }
});

describe('a guarded chest', () => {
  const treasure = [
    { type: ResourceType.Gold, amount: 200 },
    { type: ResourceType.Iron, amount: 6 },
    { type: ResourceType.Stone, amount: 9 },
  ];

  /** Nothing from the fight's own rolls, so only the chest can have put anything in. */
  const quiet = <T,>(run: () => T): T => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    try { return run(); } finally { jest.restoreAllMocks(); }
  };

  it('pays its contents on top of the fight, merged with what the fight itself paid', () => {
    quiet(() => {
      const fight = victoryRewards(ctx({ encounterId: CHEST_GUARD_ID }));
      const reward = victoryRewards(ctx({ encounterId: CHEST_GUARD_ID, treasure }));
      expect(reward.gold).toBe(fight.gold + 200);
      for (const t of treasure.slice(1)) {
        const had = fight.resources.find((r) => r.type === t.type)?.amount ?? 0;
        expect(reward.resources.find((r) => r.type === t.type)?.amount).toBe(had + t.amount);
      }
      expect(new Set(reward.resources.map((r) => r.type)).size).toBe(reward.resources.length);
    });
  });

  it('leaves one more drop than an ordinary fight on the same ground', () => {
    quiet(() => {
      expect(victoryRewards(ctx()).items).toHaveLength(0);
      expect(victoryRewards(ctx({ encounterId: CHEST_GUARD_ID })).items.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('reward scaling', () => {
  /**
   * The rewards follow the multiplier the *enemies* were built with. A
   * scaled-up fight paying a base-rate wage is the failure this prevents.
   */
  it('pays more the further out the ground is', () => {
    const bands = ([0, 1, 2, 3] as ThreatBand[]).map((b) => rewardScaleFor(null, 'x', b));
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]).toBeGreaterThanOrEqual(bands[i - 1]);
    }
    expect(bands[3]).toBeGreaterThan(bands[0]);
  });

  it('uses the castle tier inside the castle, whatever the ground says', () => {
    const run: CastleRun = { tier: 3, stage: 0 };
    expect(rewardScaleFor(run, 'castle_3_0', 0 as ThreatBand)).toBe(castleTierScale(3));
  });

  // Choosing to fight the siege is choosing not to pay the rent, so it has to
  // be worth surviving
  it('uses the siege scale for a siege', () => {
    const id = siegeEncounterId(6);
    expect(rewardScaleFor(null, id, 0 as ThreatBand)).toBe(siegePowerScale(6));
    expect(rewardScaleFor(null, id, 0 as ThreatBand)).toBeGreaterThan(
      threatRewardScale(0 as ThreatBand),
    );
  });

  it('prefers the castle over the siege when both could apply', () => {
    const run: CastleRun = { tier: 2, stage: 1 };
    expect(rewardScaleFor(run, siegeEncounterId(6), 3 as ThreatBand)).toBe(castleTierScale(2));
  });
});

describe('victory rewards', () => {
  it('splits xp between the heroes still standing', () => {
    const two = victoryRewards(
      ctx({ units: [makeUnit({ id: 'a' }), makeUnit({ id: 'b' }), makeFoe({ templateId: foeTemplate.id })] }),
    );
    const one = victoryRewards(ctx());
    expect(two.xpPerHero).toBeLessThan(one.xpPerHero);
  });

  // A corpse takes no share — otherwise dying is a way to bank xp elsewhere
  it('gives a downed hero no share', () => {
    const withCorpse = victoryRewards(
      ctx({
        units: [
          makeUnit({ id: 'a' }),
          makeUnit({ id: 'b', currentHp: 0 }),
          makeFoe({ templateId: foeTemplate.id }),
        ],
      }),
    );
    expect(withCorpse.xpPerHero).toBe(victoryRewards(ctx()).xpPerHero);
  });

  it('pays nothing for a fight with nobody left alive', () => {
    const wiped = victoryRewards(
      ctx({ units: [makeUnit({ id: 'a', currentHp: 0 }), makeFoe({ templateId: foeTemplate.id })] }),
    );
    expect(wiped.xpPerHero).toBe(0);
  });

  /** Resource nodes are a map activity, and the gauntlet has no map. */
  it('drops no bonus resources inside the castle', () => {
    const run: CastleRun = { tier: 1, stage: 0 };
    expect(victoryRewards(ctx({ castleRun: run })).resources).toEqual([]);
  });

  it('names the next stage until the last one, and the chest only on it', () => {
    const mid = victoryRewards(ctx({ castleRun: { tier: 1, stage: 0 }, isLastStage: false }));
    expect(mid.nextStage).toBeDefined();
    expect(mid.chest).toBeUndefined();

    const last = victoryRewards(
      ctx({ castleRun: { tier: 1, stage: CASTLE_STAGE_COUNT - 1 }, isLastStage: true }),
    );
    expect(last.nextStage).toBeUndefined();
    expect(last.chest).toEqual({ tier: 1, sealTier: expect.any(Number) });
  });

  /**
   * The gold knob, and it is measured against the template's own number rather
   * than against a remembered total — retuning `ENEMY_GOLD_SCALE` must not need
   * this suite retuned with it, or the constant stops being a knob.
   *
   * It exists because the *rate* of fights changed under the templates: a
   * journey checks every tile it crosses and haunted ground carries an encounter
   * six times in ten, so the party earns several fights' worth of gold a day
   * where the numbers were authored for one or two — and the Empire's weekly
   * tribute stopped being a bill.
   */
  it('pays the template gold through ENEMY_GOLD_SCALE, once', () => {
    const band = 0 as ThreatBand;
    const scale = rewardScaleFor(null, 'random_danger', band);
    const { gold } = victoryRewards(ctx({ threatBand: band }));
    expect(gold).toBe(Math.round(foeTemplate.goldReward * scale * BALANCE.ENEMY_GOLD_SCALE));
  });

  /**
   * XP is deliberately not scaled. The complaint the knob answers is about
   * purchasing power against a fixed rent; cutting XP as well would just be
   * playing the same game slower, and nothing in the level curve asked for it.
   */
  it('leaves xp on the template number', () => {
    const band = 0 as ThreatBand;
    const scale = rewardScaleFor(null, 'random_danger', band);
    const { xpPerHero } = victoryRewards(ctx({ threatBand: band }));
    expect(xpPerHero).toBe(Math.round(foeTemplate.xpReward * scale));
  });

  // Enemies whose template no longer exists must not be paid for, or a renamed
  // template becomes a silent free fight
  it('ignores a unit with no template behind it', () => {
    const bogus = victoryRewards(
      ctx({ units: [makeUnit({ id: 'a' }), makeFoe({ templateId: undefined })] }),
    );
    expect(bogus.xpPerHero).toBe(0);
    expect(bogus.gold).toBe(0);
  });
});

describe('defeat penalties', () => {
  const item = (id: string): Item => ({ id }) as Item;

  /** Worn gear survives a loss; the bag does not. */
  it('counts only what is not being worn', () => {
    const worn = hero({ equipment: { mainHand: 'sword' } as Hero['equipment'] });
    const { itemCount } = defeatPenalties([worn], [item('sword'), item('spare')], 1000);
    expect(itemCount).toBe(1);
  });

  it('scales the gold with the party it is taking it from', () => {
    const small = defeatPenalties([hero()], [], 100000).goldLost;
    const big = defeatPenalties([hero(), hero({ id: 'h2', level: 20 })], [], 100000).goldLost;
    expect(big).toBeGreaterThan(small);
  });

  // The screen must never promise to take more than exists
  it('never takes more gold than is held', () => {
    expect(defeatPenalties([hero({ level: 20 })], [], 3).goldLost).toBe(3);
    expect(defeatPenalties([hero({ level: 20 })], [], 0).goldLost).toBe(0);
  });

  it('uses the balance constant rather than a number of its own', () => {
    const one = hero({ level: 1 });
    expect(defeatPenalties([one], [], 100000).goldLost).toBe(BALANCE.DEFEAT_GOLD_PER_LEVEL);
  });
});

it('applies meal premiums only to loot, preserving XP and castle Seal context', () => {
  const dice = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  try {
    const run = { tier:1, stage:0 };
    const normal = victoryRewards(ctx({castleRun:run}));
    const meal = victoryRewards(ctx({castleRun:run, mealTier:3}));
    expect(meal.gold).toBe(Math.floor(normal.gold*1.1));
    expect(meal.xpPerHero).toBe(normal.xpPerHero);
    expect(meal.nextStage).toEqual(normal.nextStage);
    expect(meal.resources).toEqual(normal.resources);
    const normalChest = victoryRewards(ctx({castleRun:run,isLastStage:true}));
    const mealChest = victoryRewards(ctx({castleRun:run,isLastStage:true,mealTier:3}));
    expect(mealChest.chest).toEqual(normalChest.chest);
    expect(mealChest.gems).toEqual(normalChest.gems);
  } finally { dice.mockRestore(); }
});

// Playtest 2026-10-14: winning a siege paid only its soldiers' pockets, minted at
// the city's band-0 item level whatever the week.
describe('a won siege', () => {
  const siege = (week: number) => ctx({
    encounterId: siegeEncounterId(week),
    heroes: [hero({ level: 16 }), hero({ id: 'h2', level: 16 })],
    units: [makeUnit({ id: 'hero' }), makeFoe({ id: 'foe', templateId: 'obsidian_infantry' })],
  });

  it('leaves Rare-or-Epic spoils for the party, at the party\'s level', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const reward = victoryRewards(siege(8));
      const spoils = reward.items.filter((i) => i.rarity === Rarity.Rare || i.rarity === Rarity.Epic);
      expect(spoils.length).toBeGreaterThanOrEqual(BALANCE.SIEGE_SPOILS_ITEMS);
      for (const piece of spoils) expect(piece.itemLevel ?? 0).toBeGreaterThanOrEqual(14);
    } finally { jest.restoreAllMocks(); }
  });

  it('pays a share of the refused bill on top of the soldiers\' gold, and a second haul', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const won = victoryRewards(siege(8));
      const plain = victoryRewards({ ...siege(8), encounterId: 'random_danger' });
      expect(won.gold).toBeGreaterThan(plain.gold);
      expect(won.gold - plain.gold).toBeGreaterThanOrEqual(BALANCE.SIEGE_SPOILS_GOLD_MIN);
    } finally { jest.restoreAllMocks(); }
  });
});
