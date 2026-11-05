import { FACTIONS, atHome, factionCandidates, factionsForBand } from '@/data/templates/factions';
import { THREAT_BANDS, ThreatBand } from '@/systems/world/threat';
import { TileType } from '@/models/types';
import { WORLD_IDS, worldDef, type WorldId } from '@/data/worlds';
import {
  chestGuardCandidates,
  composeChestGuard,
  composeForBand,
  planForEncounter,
} from '@/systems/world/encounterGenerator';
import { useHuntStore } from '@/stores/huntStore';
import { useQuestStore } from '@/stores/questStore';
import { createRNG } from '@/utils/rng';

/**
 * The biome lock (the private project notes): a faction with an
 * identity never rolls off its own ground, and a roamer keeps its weight at home.
 * Everything here is exact — the candidate pools are counted, not sampled.
 */

const WALKABLE = Object.values(TileType).filter((t) => t !== TileType.Water);
/** Ground a tile can be under frost or not: only highlands and mountain are told apart by it */
const FROSTS = [false, true];

const locked = FACTIONS.filter((f) => f.homeLocked);
/** The worlds warbands roll in: the archipelago's factions are still to come (`WorldDef.content.encounters`). */
const FIGHTING_WORLDS = WORLD_IDS.filter((w) => worldDef(w).content.encounters);
const ids = (pool: { id: string }[]) => [...new Set(pool.map((f) => f.id))].sort();

describe('which factions are locked', () => {
  it('binds winter, the desert, the swamp, the forest, the rock and the steppe to their ground', () => {
    expect(locked.map((f) => f.id).sort()).toEqual([
      'beasts', 'delve', 'fallen_order', 'fenfolk', 'hoarfrost', 'rime_jarls', 'sandscourge', 'thunder_herd',
    ]);
  });

  it('leaves the roamers and the Legion free', () => {
    const free = FACTIONS.filter((f) => !f.homeLocked).map((f) => f.id).sort();
    expect(free).toEqual([
      'ashwood_coven', 'brigands', 'draconic_host', 'greenskins', 'obsidian_legion', 'restless_dead', 'yokai',
    ]);
  });

  it('keeps the Restless Dead at home only from band 4', () => {
    expect(FACTIONS.find((f) => f.id === 'restless_dead')?.homeOnlyFrom).toBe(4);
  });
});

describe('a locked faction off its ground', () => {
  it('gets no entry at any band, on any terrain, frozen or not, in any world', () => {
    const strays: string[] = [];
    for (const world of FIGHTING_WORLDS) {
      for (const band of THREAT_BANDS) {
        for (const terrain of WALKABLE) {
          for (const frost of FROSTS) {
            for (const f of factionCandidates(band, terrain, 0, world, frost)) {
              if (f.homeLocked && !atHome(f, terrain, frost)) strays.push(`${world} ${f.id} band ${band} ${terrain} frost ${frost}`);
            }
          }
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it('is still offered on its own ground at every band it covers', () => {
    const missing: string[] = [];
    for (const f of locked) {
      const world: WorldId = f.worlds?.[0] ?? 'empire';
      for (const band of THREAT_BANDS) {
        if (band < f.threatRange[0] || band > f.threatRange[1]) continue;
        for (const terrain of f.terrain) {
          const frost = f.frostOnly === true;
          const pool = factionCandidates(band, terrain, Infinity, world, frost);
          // The Dead are the only thing the lock may not displace; nobody here is them
          if (!pool.includes(f)) missing.push(`${f.id} band ${band} ${terrain}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('frozen ground', () => {
  it('counts snowy highlands and the tundra, not bare highlands, as winter ground', () => {
    const jarls = FACTIONS.find((f) => f.id === 'rime_jarls')!;
    expect(atHome(jarls, TileType.Tundra, true)).toBe(true);
    expect(atHome(jarls, TileType.Tundra)).toBe(true);
    expect(atHome(jarls, TileType.Highlands, true)).toBe(true);
    expect(atHome(jarls, TileType.Highlands, false)).toBe(false);
    expect(atHome(jarls, TileType.Plains, true)).toBe(false);
    expect(atHome(jarls, TileType.Mountain, true)).toBe(false);
  });

  it('lets a Rime Jarl and the Hoarfrost roll on snowy highlands and never on bare ones', () => {
    for (const band of [3, 4] as ThreatBand[]) {
      expect(ids(factionCandidates(band, TileType.Highlands, Infinity, 'empire', true))).toEqual(
        expect.arrayContaining(['rime_jarls', 'hoarfrost']),
      );
      expect(ids(factionCandidates(band, TileType.Highlands, Infinity, 'empire', false))).not.toEqual(
        expect.arrayContaining(['rime_jarls']),
      );
    }
    const rolled = new Set<string>();
    const rng = createRNG(5).next;
    for (let i = 0; i < 400; i++) rolled.add(composeForBand(3, TileType.Highlands, Infinity, [], rng, 'empire', true).factionId);
    expect(rolled.has('rime_jarls')).toBe(true);
    for (let i = 0; i < 400; i++) {
      expect(composeForBand(3, TileType.Highlands, Infinity, [], rng, 'empire', false).factionId).not.toBe('rime_jarls');
    }
  });
});

describe('a roamer', () => {
  it('has three entries at home and one elsewhere', () => {
    const count = (id: string, band: ThreatBand, terrain: TileType) =>
      factionCandidates(band, terrain).filter((f) => f.id === id).length;
    expect(count('greenskins', 1, TileType.Plains)).toBe(3);
    expect(count('greenskins', 1, TileType.Swamp)).toBe(1);
    expect(count('brigands', 2, TileType.Desert)).toBe(3);
    expect(count('brigands', 2, TileType.Forest)).toBe(1);
    expect(count('ashwood_coven', 3, TileType.Swamp)).toBe(3);
    expect(count('ashwood_coven', 3, TileType.Tundra)).toBe(1);
    expect(count('restless_dead', 2, TileType.Swamp)).toBe(3);
    expect(count('restless_dead', 2, TileType.Plains)).toBe(1);
  });

  it('keeps the Restless Dead off foreign ground at band 4', () => {
    expect(ids(factionCandidates(4, TileType.Plains))).not.toContain('restless_dead');
    expect(ids(factionCandidates(4, TileType.Swamp))).toContain('restless_dead');
  });
});

describe('the pool is never empty', () => {
  it('has a faction on every walkable ground at every band of every world, so the fallback is unreachable', () => {
    const empty: string[] = [];
    for (const world of FIGHTING_WORLDS) {
      for (const band of THREAT_BANDS) {
        // The Legion's leash is its castle: far from it nobody may be missing
        if (factionsForBand(band, world).length === 0) continue;
        for (const terrain of WALKABLE) {
          for (const frost of FROSTS) {
            try {
              factionCandidates(band, terrain, Infinity, world, frost);
            } catch {
              empty.push(`${world} band ${band} ${terrain} frost ${frost}`);
            }
          }
        }
      }
    }
    expect(empty).toEqual([]);
  });
});

describe('hunts and chest guards', () => {
  const rng = createRNG(11).next;

  it('never field a locked faction off its ground, hunted or not', () => {
    const strays: string[] = [];
    for (const world of FIGHTING_WORLDS) {
      for (const band of THREAT_BANDS) {
        for (const terrain of WALKABLE) {
          for (const frost of FROSTS) {
            const wanted = FACTIONS.filter((f) => f.homeLocked).flatMap((f) => [...Object.values(f.roles).flat()]);
            for (const hunted of [[], wanted]) {
              for (let i = 0; i < 6; i++) {
                const wander = composeForBand(band, terrain, Infinity, hunted, rng, world, frost);
                const guard = composeChestGuard(band, terrain, Infinity, hunted, rng, world, frost);
                for (const fight of [wander, guard]) {
                  const f = FACTIONS.find((x) => x.id === fight.factionId)!;
                  if (f.homeLocked && !atHome(f, terrain, frost)) strays.push(`${world} ${f.id} band ${band} ${terrain} frost ${frost}`);
                }
              }
              for (const f of chestGuardCandidates(band, terrain, Infinity, world, frost)) {
                if (f.homeLocked && !atHome(f, terrain, frost)) strays.push(`pool ${world} ${f.id} band ${band} ${terrain}`);
              }
            }
          }
        }
      }
    }
    expect([...new Set(strays)]).toEqual([]);
  });

  it('give a hunted faction its 5x weight only at home', () => {
    const mine = (terrain: TileType) => {
      let hits = 0;
      for (let i = 0; i < 2000; i++) {
        if (composeForBand(2, terrain, Infinity, ['bandit'], rng).factionId === 'brigands') hits++;
      }
      return hits / 2000;
    };
    // Brigands roam: three of ten on their plains, boosted; one of nine on a swamp, not
    expect(mine(TileType.Plains)).toBeGreaterThan(0.55);
    expect(mine(TileType.Swamp)).toBeLessThan(0.2);
  });

  describe('the guaranteed hunt', () => {
    beforeEach(() => {
      useQuestStore.getState().reset();
      useHuntStore.getState().reset();
    });

    it('fires on forest and waits on ground the wolves cannot stand on', () => {
      useQuestStore.getState().accept('wolves_at_the_gate');
      const forest = planForEncounter('random_danger', 0, TileType.Forest, Infinity);
      expect(forest.hunt).toBeDefined();
      useHuntStore.setState({ streak: { key: forest.hunt!.key, misses: 2 } });

      // Plains and swamp can field no Beast: no hunt is attached and the streak is not spent
      for (const terrain of [TileType.Plains, TileType.Swamp, TileType.Desert]) {
        for (let i = 0; i < 20; i++) {
          const plan = planForEncounter('random_danger', 0, terrain, Infinity);
          expect(plan.hunt).toBeUndefined();
          expect(plan.factionId).not.toBe('beasts');
        }
      }
      expect(useHuntStore.getState().streak.misses).toBe(2);

      for (let i = 0; i < 20; i++) {
        expect(planForEncounter('random_danger', 0, TileType.Forest, Infinity).enemies).toEqual(['wolf_pup', 'wolf_pup']);
      }
    });
  });
});
