import { FACTIONS, factionCandidates, walksIn, type FactionId } from '@/data/templates/factions';
import { composeForBand } from '@/systems/world/encounterGenerator';
import { TileType } from '@/models/types';
import type { ThreatBand } from '@/systems/world/threat';
import type { WorldId } from '@/data/worlds';

/**
 * Each world fields its own: a faction walks the open map only of the worlds it
 * names (`Faction.worlds`, the Empire when absent), so no Empire warband crosses
 * the gate and no Jadeveil one turns up at home.
 */
const BANDS: ThreatBand[] = [0, 1, 2, 3, 4];
const TERRAINS = [TileType.Plains, TileType.Forest, TileType.Highlands, TileType.Mountain, TileType.Water];

function rolled(world: WorldId): Set<FactionId> {
  const seen = new Set<FactionId>();
  for (const band of BANDS) for (const terrain of TERRAINS) {
    for (const f of factionCandidates(band, terrain, Infinity, world)) seen.add(f.id);
    for (let i = 0; i < 20; i++) seen.add(composeForBand(band, terrain, Infinity, [], Math.random, world).factionId);
  }
  return seen;
}

describe('world factions', () => {
  it('never draws a faction of another world on the Empire map', () => {
    for (const id of rolled('empire')) expect(walksIn(FACTIONS.find((f) => f.id === id)!, 'empire')).toBe(true);
  });

  it('draws only Jadeveil factions in Jadeveil once it has any', () => {
    const local = FACTIONS.filter((f) => walksIn(f, 'jadeveil'));
    if (local.length === 0) return;
    for (const id of rolled('jadeveil')) expect(walksIn(FACTIONS.find((f) => f.id === id)!, 'jadeveil')).toBe(true);
  });

  it('fields a Jadeveil faction at home on every band of the range', () => {
    // Bamboo and terraces below (the Yokai), shrine ground between (the Fallen
    // Order), the summit approach above (the Draconic Host)
    for (const band of BANDS) {
      const home = FACTIONS.filter((f) => walksIn(f, 'jadeveil')
        && band >= f.threatRange[0] && band <= f.threatRange[1]);
      expect(home.length).toBeGreaterThan(0);
    }
    const native = (band: ThreatBand, terrain: TileType) =>
      factionCandidates(band, terrain, Infinity, 'jadeveil').some((f) => f.terrain.includes(terrain));
    expect(native(0, TileType.Forest) && native(0, TileType.Plains)).toBe(true);
    expect(native(2, TileType.Highlands) && native(2, TileType.Forest)).toBe(true);
    expect(native(4, TileType.Mountain) && native(4, TileType.Highlands)).toBe(true);
  });
});
