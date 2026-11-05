import { bandFloor } from '@/systems/world/worldBands';
import {
  CASTLE_LADDER, HEART_LADDER, SUMMIT_LADDER, canEnterTier, clampLadderTier, ladderItemLevel, ladderSealReward, ladderSpendsSeal,
  ladderTierScale, ladderTiers, openTiers, twistTiersAt, type LadderStanding, type SealLadder,
} from '@/systems/world/sealLadder';
import {
  CASTLE_STAGE_COUNT, SEAL_TIERS, availableTiers, canEnterCastle, castleEncounterId, castleSpendsSeal, castleTierScale,
  clampTier, sealRewardFor,
} from '@/systems/world/castle';
import {
  STORM_TIERS, canEnterSummit, clampStormTier, openSummitTiers, stormSealRewardFor, summitEncounterId, summitItemLevel,
  summitSpendsSeal, summitTierScale,
} from '@/systems/world/summit';
import { isRepeatableEncounter, repeatableFightOf } from '@/systems/world/repeatableFights';
import { HEART_TIERS, heartSealEncounterId } from '@/systems/world/heartRefight';
import { castleItemLevel } from '@/systems/economy/itemLevelSources';
import { siegeEncounterId } from '@/systems/world/tribute';
import { levelCap, setLevelCapInputs } from '@/data/levelCap';
import { BALANCE } from '@/data/balanceConstants';

/**
 * The shared Seal ladder (the private project notes, *The shared Seal ladder*):
 * one set of rules, described per ladder by data, that the castle's and the summit's
 * ladders read through their own names.
 */

const LADDERS: [string, SealLadder][] = [['castle', CASTLE_LADDER], ['summit', SUMMIT_LADDER], ['heart', HEART_LADDER]];

/** Every combination of Seals held (none, or one at a single tier), cleared and door. */
function standings(ladder: SealLadder): LadderStanding[] {
  const sealSets = [
    Array.from({ length: ladder.topTier }, () => 0),
    ...ladderTiers(ladder).map((t) => Array.from({ length: ladder.topTier }, (_, i) => (i === t - 1 ? 1 : 0))),
  ];
  return sealSets.flatMap((seals) => [false, true].flatMap((cleared) =>
    [false, true].map((doorOpen) => ({ seals, cleared, doorOpen }))));
}

describe('the ladders are described by their balance constants', () => {
  it('reads the castle’s and the summit’s tops and power steps', () => {
    expect(CASTLE_LADDER).toEqual({ topTier: BALANCE.MAX_SEAL_TIER, powerStep: BALANCE.CASTLE_TIER_POWER, bottom: 'freeOnce' });
    expect(SUMMIT_LADDER).toEqual({ topTier: BALANCE.KAIREN.MAX_TIER, powerStep: BALANCE.KAIREN.TIER_POWER, bottom: 'story' });
    expect(HEART_LADDER).toEqual({ topTier: BALANCE.HEART_SEAL.MAX_TIER, powerStep: BALANCE.HEART_SEAL.TIER_POWER, bottom: 'free' });
  });
});

describe.each(LADDERS)('the %s ladder', (_, ladder) => {
  const top = ladder.topTier;

  it('runs from tier 1 to its top, and clamps into it', () => {
    expect(ladderTiers(ladder)).toEqual(Array.from({ length: top }, (__, i) => i + 1));
    expect(clampLadderTier(ladder, 0)).toBe(1);
    expect(clampLadderTier(ladder, 99)).toBe(top);
    expect(clampLadderTier(ladder, 2.4)).toBe(2);
  });

  it('prices tier 1 at ×1 and each tier above one step more', () => {
    expect(ladderTierScale(ladder, 1)).toBe(1);
    for (const t of ladderTiers(ladder).slice(1)) {
      expect(ladderTierScale(ladder, t) - ladderTierScale(ladder, t - 1)).toBeCloseTo(ladder.powerStep);
    }
  });

  it('pays the Seal one rung up, and another top-tier Seal at the top', () => {
    expect(ladderTiers(ladder).map((t) => ladderSealReward(ladder, t)))
      .toEqual([...ladderTiers(ladder).slice(1), top]);
  });

  it('mints the top tier’s chest at the cap and steps down one a tier, following the cap', () => {
    setLevelCapInputs({ owned: [], emperorDefeated: false });
    expect(ladderItemLevel(ladder, top)).toBe(levelCap());
    for (const t of ladderTiers(ladder).slice(1)) {
      expect(ladderItemLevel(ladder, t)).toBe(ladderItemLevel(ladder, t - 1) + 1);
    }
    setLevelCapInputs({ owned: ['jadeveil'], emperorDefeated: true });
    expect(ladderItemLevel(ladder, top)).toBe(BALANCE.MAX_LEVEL + BALANCE.EXPANSION_LEVELS);
    setLevelCapInputs({ owned: [], emperorDefeated: false });
  });

  it('keeps every twist below a tier, and has none at tier 1', () => {
    expect(twistTiersAt(ladder, 1)).toEqual([]);
    expect(twistTiersAt(ladder, 3)).toEqual([2, 3]);
    expect(twistTiersAt(ladder, top)).toEqual(ladderTiers(ladder).slice(1));
  });

  it('opens a tier above the first only to a Seal of that tier', () => {
    for (const standing of standings(ladder)) {
      for (const t of ladderTiers(ladder).slice(1)) {
        if ((standing.seals[t - 1] ?? 0) === 0) expect(canEnterTier(ladder, t, standing)).toBe(false);
      }
    }
  });

  it('lists exactly the tiers it would let in', () => {
    for (const standing of standings(ladder)) {
      expect(openTiers(ladder, standing)).toEqual(ladderTiers(ladder).filter((t) => canEnterTier(ladder, t, standing)));
    }
  });
});

describe('the bottom rung', () => {
  const none = [0, 0, 0, 0, 0];
  const oneSeal = (t: number) => none.map((_, i) => (i === t - 1 ? 1 : 0));

  it('free once: tier 1 is open until the first clear, then only to a tier-1 Seal', () => {
    expect(canEnterTier(CASTLE_LADDER, 1, { seals: none, cleared: false })).toBe(true);
    expect(canEnterTier(CASTLE_LADDER, 1, { seals: none, cleared: true })).toBe(false);
    expect(canEnterTier(CASTLE_LADDER, 1, { seals: oneSeal(1), cleared: true })).toBe(true);
    expect(ladderSpendsSeal(CASTLE_LADDER, 1, false)).toBe(false);
    expect(ladderSpendsSeal(CASTLE_LADDER, 1, true)).toBe(true);
    expect(ladderSpendsSeal(CASTLE_LADDER, 2, false)).toBe(true);
  });

  it('story: tier 1 is the door’s, and the Seal tiers wait for the story fight’s win', () => {
    expect(canEnterTier(SUMMIT_LADDER, 1, { seals: none, cleared: false, doorOpen: true })).toBe(true);
    expect(canEnterTier(SUMMIT_LADDER, 1, { seals: oneSeal(1), cleared: true, doorOpen: false })).toBe(false);
    expect(canEnterTier(SUMMIT_LADDER, 2, { seals: oneSeal(2), cleared: false, doorOpen: true })).toBe(false);
    expect(canEnterTier(SUMMIT_LADDER, 2, { seals: oneSeal(2), cleared: true, doorOpen: false })).toBe(true);
    expect([1, 2, 5].map((t) => ladderSpendsSeal(SUMMIT_LADDER, t, true))).toEqual([false, true, true]);
  });

  it('free: every tier is fought at the open door, tier 1 for nothing and never spending a Seal', () => {
    expect(canEnterTier(HEART_LADDER, 1, { seals: none, cleared: true, doorOpen: true })).toBe(true);
    expect(canEnterTier(HEART_LADDER, 1, { seals: oneSeal(1), cleared: true, doorOpen: false })).toBe(false);
    expect(canEnterTier(HEART_LADDER, 2, { seals: oneSeal(2), cleared: true, doorOpen: true })).toBe(true);
    expect(canEnterTier(HEART_LADDER, 2, { seals: oneSeal(2), cleared: true, doorOpen: false })).toBe(false);
    expect(canEnterTier(HEART_LADDER, 3, { seals: oneSeal(2), cleared: true, doorOpen: true })).toBe(false);
    expect([1, 2, 5].map((t) => ladderSpendsSeal(HEART_LADDER, t, true))).toEqual([false, true, true]);
    expect(ladderSpendsSeal(HEART_LADDER, 1, false)).toBe(false);
  });
});

describe('the castle and the summit read the shared rules', () => {
  it('the castle’s names are the castle ladder’s answers', () => {
    expect(SEAL_TIERS).toEqual(ladderTiers(CASTLE_LADDER));
    for (const t of [-1, ...SEAL_TIERS, 9]) {
      expect(clampTier(t)).toBe(clampLadderTier(CASTLE_LADDER, t));
      expect(castleTierScale(t)).toBe(ladderTierScale(CASTLE_LADDER, t));
      expect(sealRewardFor(t)).toBe(ladderSealReward(CASTLE_LADDER, t));
      expect(castleItemLevel(t)).toBe(ladderItemLevel(CASTLE_LADDER, t));
      for (const cleared of [false, true]) expect(castleSpendsSeal(t, cleared)).toBe(ladderSpendsSeal(CASTLE_LADDER, t, cleared));
    }
    for (const { seals, cleared } of standings(CASTLE_LADDER)) {
      expect(availableTiers([...seals], cleared)).toEqual(openTiers(CASTLE_LADDER, { seals, cleared }));
      for (const t of SEAL_TIERS) expect(canEnterCastle(t, [...seals], cleared)).toBe(canEnterTier(CASTLE_LADDER, t, { seals, cleared }));
    }
  });

  it('the summit’s names are the summit ladder’s answers', () => {
    expect(STORM_TIERS).toEqual(ladderTiers(SUMMIT_LADDER));
    for (const t of [-1, ...STORM_TIERS, 9]) {
      expect(clampStormTier(t)).toBe(clampLadderTier(SUMMIT_LADDER, t));
      expect(summitTierScale(t)).toBe(ladderTierScale(SUMMIT_LADDER, t));
      expect(stormSealRewardFor(t)).toBe(ladderSealReward(SUMMIT_LADDER, t));
      // The story tier's chest is the band floor's (`contentLevel.ts`); every Storm Seal tier's is the ladder's
      expect(summitItemLevel(t)).toBe(clampStormTier(t) === 1 ? bandFloor(1) : ladderItemLevel(SUMMIT_LADDER, t));
      expect(summitSpendsSeal(t)).toBe(ladderSpendsSeal(SUMMIT_LADDER, t, true));
    }
    for (const standing of standings(SUMMIT_LADDER)) {
      const { seals, cleared, doorOpen = false } = standing;
      expect(openSummitTiers(seals, cleared, doorOpen)).toEqual(openTiers(SUMMIT_LADDER, standing));
      for (const t of STORM_TIERS) expect(canEnterSummit(t, seals, cleared, doorOpen)).toBe(canEnterTier(SUMMIT_LADDER, t, standing));
    }
  });
});

describe('repeatable fights', () => {
  it('names every castle run, at its tier', () => {
    for (const tier of SEAL_TIERS) {
      for (let stage = 0; stage < CASTLE_STAGE_COUNT; stage++) {
        expect(repeatableFightOf(castleEncounterId(tier, stage))).toEqual({ ladder: 'castle', tier });
      }
    }
  });

  it('names the summit’s Storm Seal tiers, and not Kairen’s story fight', () => {
    expect(isRepeatableEncounter(summitEncounterId(1))).toBe(false);
    for (const tier of STORM_TIERS.slice(1)) {
      expect(repeatableFightOf(summitEncounterId(tier))).toEqual({ ladder: 'summit', tier });
    }
  });

  it('names every Heart refight tier, its free first included, and not the lair’s own boss fight', () => {
    for (const tier of HEART_TIERS) expect(repeatableFightOf(heartSealEncounterId(tier))).toEqual({ ladder: 'heart', tier });
    expect(isRepeatableEncounter('lair_barrow_boss')).toBe(false);
  });

  it('names nothing else', () => {
    for (const id of [null, undefined, '', 'lair_barrow_boss', 'lair_warren_1', siegeEncounterId(3), 'castle_1_9', 'summit_kairen_9', 'heart_seal_9', 'heart_seal_0']) {
      expect(isRepeatableEncounter(id)).toBe(false);
    }
  });
});
