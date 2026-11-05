import fs from 'fs';
import path from 'path';
import { HeroClass, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { STANDARD_RUN_IDS } from '@/systems/sim/balance/encounters';
import {
  checkRun,
  normalizeConfig,
  planChunks,
  PVP_CHUNK,
  playChunk,
  playFight,
  RawRunConfig,
  replayRecord,
  seedOf,
  totalFights,
} from '@/systems/sim/balance/runPlan';
import { DEFAULT_WEIGHTS } from '@/systems/sim/balance/scoring';

/**
 * A run as data: what a config file may say, how a run is cut into chunks and in
 * what order, and that a stored fight replays to the same facts. The pool, the
 * files and the command line are Node scripts that only run when started by hand.
 */

describe('reading a run config', () => {
  it('plays the standard encounters a thousand times when told nothing', () => {
    const config = normalizeConfig();
    expect(config.encounters.map((e) => e.spec.id)).toEqual([...STANDARD_RUN_IDS]);
    expect(config.encounters.every((e) => e.runs === 1000)).toBe(true);
    expect(config.responds).toBe(true);
    expect(config.weights).toEqual(DEFAULT_WEIGHTS);
    expect(config.baseSeed).toBe(1);
  });

  it('takes an encounter by id or with budget overrides, keeping the rest of the defaults', () => {
    const config = normalizeConfig({
      runs: 200,
      encounters: ['troll', { id: 'castle', runs: 50, tier: 3, levelSum: { max: 70 }, itemLevels: { [Rarity.Epic]: { avg: 10 } } }],
    });
    expect(config.encounters).toHaveLength(2);
    expect(config.encounters[0].runs).toBe(200);
    const castle = config.encounters[1];
    expect(castle.runs).toBe(50);
    expect(castle.spec.tier).toBe(3);
    expect(castle.spec.levelSum).toEqual({ min: 64, max: 70 });
    expect(castle.spec.itemLevels[Rarity.Epic]).toEqual({ avg: 10, spread: 1 });
    expect(castle.spec.heroes).toEqual({ min: 4, max: 4 });
  });

  it('refuses what cannot be played', () => {
    expect(() => normalizeConfig({ encounters: ['nowhere' as never] })).toThrow(/unknown encounter/);
    expect(() => normalizeConfig({ encounters: ['troll', 'troll'] })).toThrow(/twice/);
    expect(() => normalizeConfig({ runs: 0 })).toThrow(/runs/);
    expect(() => normalizeConfig({ encounters: [{ id: 'troll', levelSum: { min: 30, max: 20 } }] })).toThrow(/range/);
  });

  it('takes the party size a budget is written for, and refuses one that is not a whole number', () => {
    expect(normalizeConfig({ encounters: ['dragon'] }).encounters[0].spec.budgetHeroes).toBeUndefined();
    expect(normalizeConfig({ encounters: [{ id: 'dragon', budgetHeroes: 3 }] }).encounters[0].spec.budgetHeroes).toBe(3);
    expect(() => normalizeConfig({ encounters: [{ id: 'dragon', budgetHeroes: 0 }] })).toThrow(/budgetHeroes/);
    expect(() => normalizeConfig({ encounters: [{ id: 'dragon', budgetHeroes: 2.5 }] })).toThrow(/budgetHeroes/);
  });

  it('names who plays the party, and refuses an AI that does not exist', () => {
    expect(normalizeConfig({ encounters: ['troll'] }).encounters[0].spec.partyAi).toBeUndefined();
    expect(normalizeConfig({ encounters: [{ id: 'heart', partyAi: 'normal' }] }).encounters[0].spec.partyAi).toBe('normal');
    expect(() => normalizeConfig({ encounters: [{ id: 'heart', partyAi: 'genius' as never }] })).toThrow(/party AI/);
  });

  it('reports constraints no party can meet before the run starts', () => {
    const config = normalizeConfig({ encounters: ['troll'], constraints: { mustClass: HeroClass.Mage, excludeClasses: [HeroClass.Mage] } });
    expect(checkRun(config)).toEqual([{ encounter: 'troll', problems: [expect.objectContaining({ code: 'excluded' })] }]);
    expect(checkRun(normalizeConfig({ encounters: ['troll'] }))).toEqual([]);
  });
});

describe('cutting a run into chunks', () => {
  const config = normalizeConfig({ encounters: [{ id: 'troll', runs: 120 }, { id: 'dragon', runs: 60 }], chunk: 50 });
  const chunks = planChunks(config);

  it('covers every fight of every encounter exactly once', () => {
    for (const [enc, e] of config.encounters.entries()) {
      const covered = chunks.filter((c) => c.enc === enc).flatMap((c) => Array.from({ length: c.to - c.from }, (_, k) => c.from + k));
      expect(covered).toEqual(Array.from({ length: e.runs }, (_, k) => k));
    }
    expect(chunks.reduce((sum, c) => sum + (c.to - c.from), 0)).toBe(totalFights(config));
  });

  it('interleaves encounters, so progress moves on all of them, and numbers the chunks in order', () => {
    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, i) => i));
    expect(chunks.slice(0, 2).map((c) => c.enc)).toEqual([0, 1]);
    expect(chunks.map((c) => `${c.enc}:${c.from}`)).toEqual(['0:0', '1:0', '0:50', '1:50', '0:100']);
  });

  it('sends PvP out a few fights at a time, so a short run still reaches every worker', () => {
    const pvp = normalizeConfig({ encounters: [{ id: 'pvp', runs: 10 }], chunk: 50 });
    expect(planChunks(pvp).map((c) => c.to - c.from)).toEqual([PVP_CHUNK, PVP_CHUNK, 10 - 2 * PVP_CHUNK]);
  });

  it('gives every fight its own seed, the same on every plan', () => {
    const seeds = new Set([...Array(40).keys()].map((i) => seedOf(config, 0, i)).concat([...Array(40).keys()].map((i) => seedOf(config, 1, i))));
    expect(seeds.size).toBe(80);
    expect(seedOf(config, 0, 3)).toBe(seedOf(normalizeConfig({ encounters: ['troll'] }), 0, 3));
    expect(seedOf({ ...config, baseSeed: 2 }, 0, 3)).not.toBe(seedOf(config, 0, 3));
  });
});

describe('playing', () => {
  const config = normalizeConfig({ baseSeed: 5, encounters: [{ id: 'troll', runs: 6 }, { id: 'castle', runs: 3 }] });

  it('plays a chunk as the fights it names, each identical to playing it alone', () => {
    const [first] = planChunks(config);
    const { records, errors } = playChunk(config, first);
    expect(errors).toEqual([]);
    expect(records).toHaveLength(first.to - first.from);
    expect([records[2]]).toEqual(playFight(config, 0, 2));
    expect(records.every((r) => r.enc === 'troll')).toBe(true);
  });

  it('reports a fight that throws and carries on with the rest of the chunk', () => {
    // Every class excluded: nothing can be drawn, and the roll throws
    const broken = { ...config, constraints: { excludeClasses: Object.values(HeroClass) } };
    const { records, errors } = playChunk(broken, { id: 0, enc: 0, from: 0, to: 3 });
    expect(records).toEqual([]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatchObject({ enc: 'troll', index: 0 });
  });

  describe('PvP', () => {
    // The ordinary brain on both parties, for speed: the rules pinned are the same at every level
    const pvp = normalizeConfig({ baseSeed: 9, encounters: [{ id: 'pvp', runs: 4, pvpAi: 'brain' }] });

    it('records each fight twice, once from each party, as mirror images', () => {
      const { records, errors } = playChunk(pvp, { id: 0, enc: 0, from: 0, to: 4 });
      expect(errors).toEqual([]);
      expect(records).toHaveLength(8);
      for (let i = 0; i < records.length; i += 2) {
        const [first, second] = [records[i], records[i + 1]];
        expect(second.sd).toBe(1);
        expect(first.sd).toBeUndefined();
        expect(second.seed).toBe(first.seed);
        expect(second.party).toEqual(first.vs);
        expect(first.party).toEqual(second.vs);
        const flip = { victory: 'defeat', defeat: 'victory', draw: 'draw' } as const;
        expect(second.o).toBe(flip[first.o]);
      }
      // Every fight a win for one party and a loss for the other, or a draw for both
      const wins = records.filter((r) => r.o === 'victory').length;
      const losses = records.filter((r) => r.o === 'defeat').length;
      expect(wins).toBe(losses);
    });

    it('replays either party\'s record to the same facts', () => {
      const [first, second] = playFight(pvp, 0, 1);
      expect(replayRecord(pvp, first).record).toEqual(first);
      expect(replayRecord(pvp, second).record).toEqual(second);
    });
  });

  it.each([0, 1])('replays a stored fight to the same facts, with a transcript (encounter %i)', (enc) => {
    const [record] = playFight(config, enc, 1);
    const { record: replayed, transcript } = replayRecord(config, record);
    expect(replayed).toEqual(record);
    expect(transcript.length).toBeGreaterThan(10);
    expect(transcript.some((line) => line.startsWith('#'))).toBe(true);
  });
});
