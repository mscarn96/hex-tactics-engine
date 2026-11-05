import { BALANCE } from '@/data/balanceConstants';
import { curatedBand } from '@/systems/world/encounterGenerator';
import { EncounterGround, encounterPowerScale, encounterTerms } from '@/systems/combat/encounterSetup';
import { TileType } from '@/models/types';
import { LAIR_SPECS } from '@/locations/lairs';
import { bandComposition } from '../support/threatCurve';
import { castleTierScale, castleGarrisonScale, castleStagePower } from '@/systems/world/castle';
import { siegePowerScale } from '@/systems/world/tribute';
import { CHEST_GUARD_POWER_MULT, chestGuardBand } from '@/systems/world/finds';
import {
  neutralDepth,
  threatPowerScale,
  threatRewardScale,
  ThreatBand,
  lateGroundPremium,
  threatEncounterSize,
} from '@/systems/world/threat';

/**
 * A curated fight ignores the ground it stands on — all of it, not just who
 * turns up.
 *
 * `generateEncounterEnemies` has always composed a lair chamber at its
 * `LairSpec.band` and a quest site at `QUEST_BAND`. What it could not do is
 * decide the *multiplier* those bodies are built with: that came from
 * `threatPowerScale` read off the party's world-map hex, which for a lair fight
 * is the lair's **door**. So the roster was curated and the stat block was a
 * lottery on where `mapGenerator` dropped that door — one number for a rule and
 * a different number for the same rule, which is the shape of every bug this
 * file exists to prevent.
 *
 * These pin the two halves together. The scene used to be the only caller and
 * could not be exercised here (R3F in a node environment); the band and depth a
 * fight resolves to are now `encounterTerms`, called below directly, along with
 * what those are worth against what the door lottery used to produce.
 */

/** A wandering fight on a stated tile, in a world with a city and no castle. */
const ground = (over: Partial<EncounterGround> = {}): EncounterGround => ({
  tile: { type: TileType.Forest, threat: 3 },
  partyPosition: { q: 10, r: 4 },
  cityCoord: { q: 0, r: 0 },
  castleCoord: null,
  onDangerGround: true,
  ...over,
});

const BANDS: ThreatBand[] = [0, 1, 2, 3, 4];

describe('curatedBand', () => {
  it('leaves a wandering fight to the ground it happens on', () => {
    expect(curatedBand('random_danger')).toBeNull();
    expect(curatedBand(null)).toBeNull();
    expect(curatedBand(undefined)).toBeNull();
  });

  /**
   * The castle and the siege state their own multipliers outright
   * (`castleTierScale`, `siegePowerScale`) and those already win in the scene.
   * Answering here as well would be a second opinion about one fight.
   */
  it('stays out of the way of the fights that price themselves', () => {
    expect(curatedBand('castle_2_1')).toBeNull();
    expect(curatedBand('empire_siege_6')).toBeNull();
  });

  it('gives every quest site the same band, wherever it sits', () => {
    expect(curatedBand('quest_1')).toBe(curatedBand('quest_9'));
    expect(curatedBand('quest_1')).not.toBeNull();
  });

  /**
   * The composer's own rule, restated: a lair's chambers are its `band`, and the
   * second one is a band harder. If these two ever drift, the fight the player
   * gets and the fight the numbers were tuned for are different fights.
   */
  it('matches each lair chamber to the band its roster composes at', () => {
    const offenders: string[] = [];
    for (const spec of LAIR_SPECS) {
      const deeper = Math.min(4, spec.band + 1);
      const cases: [string, number][] = [
        [`${spec.id}_1`, spec.band],
        [`${spec.id}_2`, deeper],
        [`${spec.id}_boss`, spec.band],
      ];
      for (const [id, want] of cases) {
        if (curatedBand(id) !== want) offenders.push(`${id}: ${curatedBand(id)} want ${want}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never returns a band outside the five that exist', () => {
    const ids = LAIR_SPECS.flatMap((s) => [`${s.id}_1`, `${s.id}_2`, `${s.id}_boss`]);
    for (const id of ids) expect(BANDS).toContain(curatedBand(id));
  });
});

describe('what the door lottery was worth', () => {
  /**
   * The size of the bug, measured rather than asserted.
   *
   * A boss tile is placed from a shuffled pool with nothing but "at least 8
   * hexes from the city" constraining it, and every door sits in haunted ground
   * by construction — so a lair's door could land anywhere from band 1 to deep
   * band 4. The Warren composes at band 2 and is gated at summed party level 8;
   * built at the deepest, blightest ground on the map its identical roster came
   * out far stronger, and nothing inside the lair showed the player why.
   */
  it('could swing a lair by more than half again, on identical opposition', () => {
    const warren = LAIR_SPECS[0];
    const curatedScale = threatPowerScale(warren.band, neutralDepth(warren.band), false);
    // The worst door the map could deal: deepest ground of the highest band,
    // haunted — which every door is.
    const worstDoor = threatPowerScale(4, 1, true);

    expect(curatedBand(`${warren.id}_boss`)).toBe(warren.band);
    expect(worstDoor / curatedScale).toBeGreaterThan(1.5);
  });

  /**
   * And the fix has to hold on both sides of the ledger.
   *
   * `threatRewardScale` rides the same band and depth as `threatPowerScale`, so
   * a curated fight that scaled by its own band while *paying* by the door's
   * would be the mirror-image bug — ground that costs one thing and pays
   * another. Both now read `curatedBand`, so this is the property that keeps
   * them in step.
   */
  it('pays a curated fight at the same band it is built at', () => {
    const offenders: string[] = [];
    for (const band of BANDS) {
      const depth = neutralDepth(band);
      // The two curves have different slopes on purpose — travelling costs
      // hours, so reward is steeper — but they take the same band and the same
      // depth, and both must respond to the haunted flag by the identical
      // factor. That commutation is what keeps ground that costs more paying
      // more, and it is the property a curated fight inherits by being handed
      // one band rather than two.
      const costRatio = threatPowerScale(band, depth, true) / threatPowerScale(band, depth, false);
      const payRatio = threatRewardScale(band, depth, true) / threatRewardScale(band, depth, false);
      if (Math.abs(costRatio - payRatio) > 1e-12) {
        offenders.push(`band ${band}: cost ×${costRatio}, pay ×${payRatio}`);
      }
      // ...and neither may fall as the ground gets worse. Composition-weighted:
      // a curated band fields that band's composition too, and the softened
      // band-2 multiplier sits a hair under band 1's on purpose — the third
      // body and the first elite are what pay for the difference.
      if (band > 0) {
        const previous = (band - 1) as ThreatBand;
        const difficulty = (b: ThreatBand) =>
          bandComposition(b) * threatPowerScale(b, neutralDepth(b), false);
        if (difficulty(band) < difficulty(previous)) {
          offenders.push(`band ${band} costs less than ${band - 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * `neutralDepth` is the whole reason a curated fight can be given a band at
   * all without inheriting a depth from somewhere: it is the depth at which a
   * band scales by exactly one, so the mechanism leaves curated numbers
   * untouched instead of quietly shifting them by wherever the ramp happens to
   * sit.
   */
  it('scales a curated band by exactly its flat rate', () => {
    for (const band of BANDS) {
      const flat = threatPowerScale(band, neutralDepth(band), false);
      const shallow = threatPowerScale(band, 0, false);
      const deep = threatPowerScale(band, 1, false);
      expect(flat).toBeGreaterThanOrEqual(Math.min(shallow, deep));
      expect(flat).toBeLessThanOrEqual(Math.max(shallow, deep));
    }
  });
});

describe('encounterTerms', () => {
  const warren = LAIR_SPECS[0];

  it('reads a wandering fight off the ground it stands on', () => {
    const terms = encounterTerms('random_danger', ground());
    expect(terms).toMatchObject({ curated: null, guardsChest: false, threatBand: 3, haunted: true, tileType: TileType.Forest });
    expect(terms.groundDepth).toBeGreaterThanOrEqual(0);
    expect(terms.groundDepth).toBeLessThanOrEqual(1);
  });

  it('is off the road only when the ground says so', () => {
    expect(encounterTerms('random_danger', ground({ onDangerGround: false })).haunted).toBe(false);
  });

  it('gives a curated fight its own band, never the haunted premium, and the depth that scales by one', () => {
    // Standing at the lair's door: haunted by construction, in whatever band the map dealt it
    const terms = encounterTerms(`${warren.id}_boss`, ground({ tile: { type: TileType.Mountain, threat: 4 } }));
    expect(terms.threatBand).toBe(warren.band);
    expect(terms.haunted).toBe(false);
    expect(terms.groundDepth).toBe(neutralDepth(warren.band));
  });

  it('builds and pays the guards of a chest one band above the ground, at the flat depth of that band', () => {
    const terms = encounterTerms('chest_guard', ground({ tile: { type: TileType.Plains, threat: 1 } }));
    expect(terms.guardsChest).toBe(true);
    expect(terms.threatBand).toBe(chestGuardBand(1));
    expect(terms.groundDepth).toBe(neutralDepth(terms.threatBand));
  });

  it('takes the flat depth when the map has no city to measure from', () => {
    const terms = encounterTerms('random_danger', ground({ cityCoord: null }));
    expect(terms.groundDepth).toBe(neutralDepth(terms.threatBand));
  });

  it('measures the distance to the castle, and says nothing of it when there is none', () => {
    expect(encounterTerms('random_danger', ground()).fromCastle).toBe(Infinity);
    expect(encounterTerms('random_danger', ground({ castleCoord: { q: 10, r: 0 } })).fromCastle).toBe(4);
  });
});

describe('encounterPowerScale', () => {
  const terms = encounterTerms('random_danger', ground());
  const none = { active: false, powerScale: 1 };

  const cases: [string, string, { tier: number; stage: number } | null, { active: boolean; powerScale: number }, number][] = [
    ['the harness states its own', 'random_danger', null, { active: true, powerScale: 2.5 }, 2.5],
    // The garrison stages are priced apart from the Emperor's (playtest 2026-10-14)
    ['a castle garrison stage is priced by the garrison', 'castle_2_1', { tier: 2, stage: 1 }, none, castleGarrisonScale(2)],
    ['the Emperor\'s stage is priced by its tier', 'castle_2_3', { tier: 2, stage: 3 }, none, castleTierScale(2)],
    ['a siege is priced by its week', 'empire_siege_6', null, none, siegePowerScale(6)],
    ['every other fight is priced by the ground, with the late premium', 'random_danger', null, none,
      threatPowerScale(terms.threatBand, terms.groundDepth, terms.haunted) * lateGroundPremium(terms.threatBand)],
  ];
  it.each(cases)('%s', (_name, id, castleRun, sim, want) => {
    expect(encounterPowerScale({ encounterId: id, terms, castleRun, sim })).toBeCloseTo(want, 10);
  });

  it('puts the guards of a chest a premium above the ground', () => {
    const guards = encounterTerms('chest_guard', ground());
    expect(encounterPowerScale({ encounterId: 'chest_guard', terms: guards, castleRun: null, sim: none })).toBeCloseTo(
      threatPowerScale(guards.threatBand, guards.groundDepth, guards.haunted) * CHEST_GUARD_POWER_MULT
        * lateGroundPremium(guards.threatBand), 10,
    );
  });

  it('spares a lair boss\'s own fight the late premium', () => {
    const boss = encounterTerms('lair_barrow_boss', ground());
    expect(encounterPowerScale({ encounterId: 'lair_barrow_boss', terms: boss, castleRun: null, sim: none })).toBeCloseTo(
      threatPowerScale(boss.threatBand, boss.groundDepth, boss.haunted), 10,
    );
    expect(lateGroundPremium(boss.threatBand)).toBeGreaterThan(1);
  });

  // Playtest 2026-10-23: Jadeveil's bands restart at its camp, so its ground carries its own premium
  it('prices Jadeveil ground above the same Empire ground, but not a lair boss\'s own fight', () => {
    const empire = encounterPowerScale({ encounterId: 'random_danger', terms, castleRun: null, sim: none });
    const jade = encounterPowerScale({ encounterId: 'random_danger', terms: { ...terms, world: 'jadeveil' }, castleRun: null, sim: none });
    // Wider fights give back the strength the extra bodies add, so only the ground premium shows
    const size = threatEncounterSize(terms.threatBand) / BALANCE.JADEVEIL_ENCOUNTER_SIZE[terms.threatBand];
    expect(jade).toBeCloseTo(empire * BALANCE.BAND_GROUND_POWER * size, 10);
    const boss = encounterTerms('lair_barrow_boss', ground());
    const plain = encounterPowerScale({ encounterId: 'lair_barrow_boss', terms: boss, castleRun: null, sim: none });
    expect(encounterPowerScale({ encounterId: 'lair_barrow_boss', terms: { ...boss, world: 'jadeveil' }, castleRun: null, sim: none }))
      .toBeCloseTo(plain, 10);
  });

  it('lets the harness win over the siege, but not over a castle stage (its castle chain, PT-04)', () => {
    const scale = encounterPowerScale({
      encounterId: 'empire_siege_6', terms, castleRun: null, sim: { active: true, powerScale: 1.7 },
    });
    expect(scale).toBe(1.7);
    const stage = encounterPowerScale({
      encounterId: 'castle_3_0', terms, castleRun: { tier: 3, stage: 0 }, sim: { active: true, powerScale: 1.7 },
    });
    expect(stage).toBe(castleStagePower(3, 0));
  });
});
