import { FACTIONS, atHome, type FactionId } from '@/data/templates/factions';
import { generateMap } from '@/systems/world/mapGenerator';
import { composeChestGuard, composeForBand } from '@/systems/world/encounterGenerator';
import { chestGuardBand } from '@/systems/world/finds';
import { EMPIRE_WORLD, JADEVEIL_WORLD, worldSeed, type WorldDef } from '@/data/worlds';
import { MapTile, POIType, TileType } from '@/models/types';
import { ThreatBand } from '@/systems/world/threat';
import { hexDistance } from '@/utils/hexUtils';
import { createRNG } from '@/utils/rng';

/**
 * The biome lock on real ground (the private project notes, "Done
 * when"): every walkable tile of each world's generated maps is rolled for a
 * wandering fight, a hunt and a chest's guards, and no `homeLocked` faction is
 * ever fielded off the ground it is locked to. `factionLock.test.ts` pins the
 * rule on the candidate pools; this one pins it on the maps the player walks.
 */

const SEEDS = [1, 7, 42, 99, 1234, 4242, 90210, 777, 31337, 1471934286];
/** Rolls per tile and kind. The pools are tiny, so a stray would show within a few. */
const ROLLS = 3;

const WORLDS: { name: string; def: WorldDef; seed: (s: number) => number }[] = [
  { name: 'the Empire', def: EMPIRE_WORLD, seed: (s) => s },
  { name: 'Jadeveil', def: JADEVEIL_WORLD, seed: (s) => worldSeed(s, 'jadeveil') },
];

/** Every template a locked faction fields: the widest hunt the quest log could ask for. */
const LOCKED_TEMPLATES = FACTIONS.filter((f) => f.homeLocked).flatMap((f) => Object.values(f.roles).flat());

describe.each(WORLDS)('no locked faction off its ground in $name', ({ def, seed: seedOf }) => {
  it('on any walkable tile of any seed, wandering, hunted or guarding a chest', () => {
    const strays = new Set<string>();
    const fielded = new Map<FactionId, number>();
    let rolled = 0;
    for (const seed of SEEDS) {
      const tiles = generateMap(seedOf(seed), def) as MapTile[];
      const castle = tiles.find((t) => t.poi === POIType.EmpireCastle)?.coord;
      const rng = createRNG(seed).next;
      for (const tile of tiles) {
        if (tile.type === TileType.Water) continue;
        const band = (tile.threat ?? 0) as ThreatBand;
        const fromCastle = castle ? hexDistance(tile.coord, castle) : Infinity;
        const frost = tile.frost === true;
        for (let i = 0; i < ROLLS; i++) {
          const fights = [
            composeForBand(band, tile.type, fromCastle, [], rng, def.id, frost),
            composeForBand(band, tile.type, fromCastle, LOCKED_TEMPLATES, rng, def.id, frost),
            composeChestGuard(chestGuardBand(band), tile.type, fromCastle, [], rng, def.id, frost),
            composeChestGuard(chestGuardBand(band), tile.type, fromCastle, LOCKED_TEMPLATES, rng, def.id, frost),
          ];
          for (const fight of fights) {
            rolled++;
            const faction = FACTIONS.find((f) => f.id === fight.factionId)!;
            if (!faction.homeLocked) continue;
            if (!atHome(faction, tile.type, frost)) strays.add(`${seed}: ${faction.id} on ${tile.type}${frost ? ' (frost)' : ''}, band ${band}`);
            else fielded.set(faction.id, (fielded.get(faction.id) ?? 0) + 1);
          }
        }
      }
    }
    expect(rolled).toBeGreaterThan(0);
    expect([...strays]).toEqual([]);
    // And the lock did not simply empty the world of them: each locked faction
    // of this world is met at home somewhere
    const mine = FACTIONS.filter((f) => f.homeLocked && (f.worlds ?? ['empire']).includes(def.id)).map((f) => f.id).sort();
    expect([...fielded.keys()].sort()).toEqual(mine);
  });
});
