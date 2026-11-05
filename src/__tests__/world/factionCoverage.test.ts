import { FACTIONS, factionCandidates, roams } from '@/data/templates/factions';
import { generateMap } from '@/systems/world/mapGenerator';
import { MapTile, POIType, TileType } from '@/models/types';
import { hexDistance } from '@/utils/hexUtils';
import { ThreatBand } from '@/systems/world/threat';

/**
 * The frozen north epic is done when every terrain at bands 2–4 has a native
 * faction (the private project notes). Its release check
 * measured the map against that and found band-4 forest, desert and mountain
 * fielding only outsiders — frost giants in the desert, the Coven among the
 * trees — about 5% of every encounter. The Restless Dead, the Sandscourge and
 * the Delve reach band 4 now, on their own ground only (`homeOnlyFrom`).
 *
 * Measured on the ten seeds the frozen-north suites use, over the ground a
 * wandering fight is rolled on: haunted, walkable, no destination on it.
 */

const SEEDS = [1, 7, 42, 99, 1234, 4242, 90210, 777, 31337, 1471934286];
const LATE: ThreatBand[] = [2, 3, 4];
const GROUND = Object.values(TileType).filter((t) => t !== TileType.Water);

const native = (terrain: TileType) => (f: { terrain: TileType[] }) =>
  f.terrain.length === 0 || f.terrain.includes(terrain);

describe('a native faction on every ground, bands 2 to 4', () => {
  /**
   * The rule as data, and without the Legion: its home is anywhere within
   * `castleRadius` of the castle, which is a leash rather than a terrain, so it
   * cannot be what makes the far side of the map anybody's home.
   */
  it('gives every terrain a native roaming faction at every late band', () => {
    const empty = GROUND.flatMap((terrain) => LATE
      .filter((band) => !FACTIONS.some((f) =>
        roams(f) && f.castleRadius === undefined && f.terrain.includes(terrain)
        && band >= f.threatRange[0] && band <= f.threatRange[1]))
      .map((band) => `${terrain} at band ${band}`));
    expect(empty).toEqual([]);
  });

  it('offers one on every tile a late fight can happen on, on every seed', () => {
    const bare: string[] = [];
    for (const seed of SEEDS) {
      const tiles = generateMap(seed);
      const castle = tiles.find((t) => t.poi === POIType.EmpireCastle)!.coord;
      const missing = new Map<string, number>();
      for (const t of tiles as MapTile[]) {
        const band = (t.threat ?? 0) as ThreatBand;
        if (t.zone !== 'haunted' || t.poi || t.type === TileType.Water || band < 2) continue;
        const pool = factionCandidates(band, t.type, hexDistance(t.coord, castle));
        if (!pool.some(native(t.type))) {
          const key = `${t.type}@${band}`;
          missing.set(key, (missing.get(key) ?? 0) + 1);
        }
      }
      for (const [key, n] of missing) bare.push(`${seed}: ${key} ×${n}`);
    }
    expect(bare).toEqual([]);
  });

  /**
   * At home only: the three are band 4's on their own ground and nobody's
   * outsiders there, so band 4 everywhere else keeps the rosters it had —
   * which is what holds `homeRing.test.ts`'s 3→4 step over its floor.
   */
  it('lets the band-4 natives in at home and nowhere else', () => {
    const at = (terrain: TileType) => new Set(factionCandidates(4, terrain).map((f) => f.id));
    expect(at(TileType.Desert).has('sandscourge')).toBe(true);
    expect(at(TileType.Forest).has('restless_dead')).toBe(true);
    expect(at(TileType.Mountain).has('delve')).toBe(true);
    for (const id of ['sandscourge', 'restless_dead', 'delve']) {
      expect(at(TileType.Plains).has(id as never)).toBe(false);
      expect(at(TileType.Tundra).has(id as never)).toBe(false);
    }
    // And band 3 is locked too: the Sandscourge is the desert's alone
    expect(factionCandidates(3, TileType.Plains).filter((f) => f.id === 'sandscourge')).toHaveLength(0);
    expect(factionCandidates(3, TileType.Desert).filter((f) => f.id === 'sandscourge')).toHaveLength(3);
  });
});
