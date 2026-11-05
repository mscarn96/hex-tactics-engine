import type { BuiltEncounter } from '@/systems/combat/encounterSetup';
import { buildEncounter, encounterTerms } from '@/systems/combat/encounterSetup';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { buildSimHero, SimHeroConfig } from '@/systems/sim/simHarness';

/**
 * A Jadeveil boss fight as the game opens it: `encounterTerms` and `buildEncounter`, which `CombatScene` calls, so
 * the boss's level, its power and whatever the encounter id says about its tier come from the rules the game
 * reads (`contentLevel`, `encounterPowerScale`), under the campaign in force (`balance/bandRoad`), and not from a
 * copy of them. What stays the lab's: the default placement rather than the lair's own starting hexes, no
 * vows, wrath or village buff, and no Barracks.
 */
export function fieldJadeveilBoss(encounterId: string, party: readonly SimHeroConfig[], idPrefix: string): BuiltEncounter {
  useInventoryStore.getState().reset();
  const mint = useInventoryStore.getState().addItem;
  const heroes = party.map((config, i) => {
    // The index, not a counter that outlives the run: ids that depend on how many fights came
    // before change tie-breaks, and a replay would not be the fight it replays
    const hero = buildSimHero(config, mint, `${idPrefix}_${i}`);
    if (!hero) throw new Error(`no hero template ${config.templateId}`);
    return hero;
  });
  const terms = encounterTerms(encounterId, {
    partyPosition: { q: 0, r: 0 }, cityCoord: null, castleCoord: null, onDangerGround: false, world: 'jadeveil',
  });
  const built = buildEncounter({ encounterId, terms, heroes, castleRun: null, sim: { active: false, powerScale: 1 }, entry: null });
  const store = useCombatStore.getState();
  store.reset();
  store.initCombat(built.players, built.enemies);
  if (built.waves.length > 0) {
    store.setWaves(built.waves, { partyLevel: built.partyLevel, powerScale: built.powerScale, spared: built.spared, contentLevel: built.contentLevel });
  }
  return built;
}
