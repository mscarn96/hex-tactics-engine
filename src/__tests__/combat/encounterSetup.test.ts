import { TileType } from '@/models/types';
import type { EncounterEntry } from '@/models/encounterEntry';
import { buildEncounter, BuildContext, encounterTerms } from '@/systems/combat/encounterSetup';
import { createEnemyUnits, enemyPowerLevel, templateStrength } from '@/systems/combat/unitFactory';
import { CASTLE_STAGE_COUNT, castleEncounterId } from '@/systems/world/castle';
import { BALANCE } from '@/data/balanceConstants';
import { inArena } from '@/systems/combat/arenaGeometry';
import { LAIR_SPECS } from '@/locations/lairs';
import { buildSimHero, defaultHeroConfig } from '@/systems/sim/simHarness';

/**
 * Opening a fight, with no scene.
 *
 * `buildEncounter` is what `CombatScene`'s init effect did to the roster: plan,
 * positions, bodies, the one power multiplier, the banner. The scene writes the
 * result into the stores; a harness does the same, which is the point.
 */

const heroes = ['warrior', 'mage'].map((t, i) =>
  buildSimHero(defaultHeroConfig(t as 'warrior' | 'mage', 4 + i * 2), (item) => item.id, `h${i}`)!);

const terms = encounterTerms('random_danger', {
  tile: { type: TileType.Forest, threat: 1 },
  partyPosition: { q: 3, r: 2 },
  cityCoord: { q: 0, r: 0 },
  castleCoord: null,
  onDangerGround: false,
});

const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({
  encounterId: 'random_danger',
  terms,
  heroes,
  castleRun: null,
  sim: { active: false, powerScale: 1 },
  entry: null,
  ...over,
});

describe('buildEncounter', () => {
  it('fields a roster the plan named, on the board, against the whole party', () => {
    const built = buildEncounter(ctx());

    expect(built.enemies).toHaveLength(built.plan.enemies.length);
    expect(built.enemies.every((u) => !u.isPlayer && inArena(u.position))).toBe(true);
    expect(built.players).toHaveLength(heroes.length);
    expect(built.players.every((u) => u.isPlayer && inArena(u.position))).toBe(true);
    expect(built.enemyPositions).toHaveLength(built.enemies.length);
    expect(built.restored).toBe(false);
  });

  it('scales enemies off the average party level and the encounter\'s one multiplier', () => {
    const built = buildEncounter(ctx());
    expect(built.partyLevel).toBe(5);
    expect(built.powerScale).toBeGreaterThan(0);
    // The snapshot a saved game restarts from is exactly this fight
    expect(built.snapshot).toMatchObject({
      id: 'random_danger', partyLevel: 5, powerScale: built.powerScale, resolved: false,
    });
    expect(built.snapshot.enemies).toBe(built.enemies);
  });

  it('names who turned up, and how many waves are coming', () => {
    const built = buildEncounter(ctx());
    expect(built.intro.headline.length).toBeGreaterThan(0);
    expect(built.intro.waves).toBe(built.waves.length);
  });

  it('gives a wandering fight its faction\'s picture slot, and a lair chamber none', () => {
    const wandering = buildEncounter(ctx());
    expect(wandering.plan.factionId).not.toBeNull();
    expect(wandering.intro.artFaction).toBe(wandering.plan.factionId);

    const chamber = buildEncounter(ctx({ encounterId: `${LAIR_SPECS[0].id}_1` }));
    expect(chamber.plan.factionId).not.toBeNull();
    expect(chamber.intro.artFaction).toBeUndefined();
  });

  it('opens the fight the harness states, at the harness\'s multiplier', () => {
    const built = buildEncounter(ctx({ encounterId: 'sim', sim: { active: true, powerScale: 3 } }));
    expect(built.powerScale).toBe(3);
  });

  // Playtest 2026-10-17: the castle's health came down by 30%, its hitting power did not
  it.each([0, CASTLE_STAGE_COUNT - 1])('gives castle stage %i its bodies at CASTLE_HP_SCALE health and full attack', (stage) => {
    const castleRun = { tier: 2, stage };
    const encounterId = castleEncounterId(castleRun.tier, stage);
    const built = buildEncounter(ctx({ encounterId, castleRun }));
    const full = createEnemyUnits(built.plan.enemies, built.enemyPositions, built.partyLevel, built.powerScale);
    expect(built.enemies.length).toBeGreaterThan(0);
    built.enemies.forEach((u, i) => {
      expect(u.stats.maxHp).toBe(Math.round(full[i].stats.maxHp * BALANCE.CASTLE_HP_SCALE));
      expect(u.currentHp).toBe(u.stats.maxHp);
      expect(u.stats.attack).toBe(full[i].stats.attack);
    });
  });

  describe('a fight resumed from its snapshot', () => {
    const snapshot = (): EncounterEntry => {
      const first = buildEncounter(ctx());
      return {
        ...first.snapshot, partyLevel: 9, powerScale: 2,
        enemies: first.enemies.map(enemy => ({ ...enemy, level: enemyPowerLevel(9, 2, templateStrength(enemy.templateId)) })),
      };
    };

    it('comes back whole, with the numbers it was built with', () => {
      const entry = snapshot();
      const built = buildEncounter(ctx({ entry, heroes: [] }));

      expect(built.restored).toBe(true);
      expect(built.enemies).toEqual(entry.enemies);
      expect(built.players).toEqual(entry.players);
      expect(built.partyLevel).toBe(9);
      expect(built.powerScale).toBe(2);
      // A copy: the committed snapshot is never edited by the fight
      expect(built.enemies).not.toBe(entry.enemies);
    });

    it('rederives display levels from committed power without changing the restored fight', () => {
      const entry = snapshot();
      entry.partyLevel = 1;
      entry.powerScale = 2.05;
      for (const enemy of entry.enemies) enemy.level = 8;
      const built = buildEncounter(ctx({ entry }));
      expect(built.enemies).toEqual(entry.enemies.map(enemy => ({ ...enemy, level: enemyPowerLevel(1, 2.05, templateStrength(enemy.templateId)) })));
      expect(built.snapshot.enemies).toEqual(built.enemies);
      expect(entry.enemies.every(enemy => enemy.level === 8)).toBe(true);
    });

    it('is ignored once it has been resolved, or when it belongs to another fight', () => {
      expect(buildEncounter(ctx({ entry: { ...snapshot(), resolved: true } })).restored).toBe(false);
      expect(buildEncounter(ctx({ entry: { ...snapshot(), id: 'another' } })).restored).toBe(false);
    });
  });
});
