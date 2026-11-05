import { STARTER_KIT, itemTemplates } from '@/data/items/itemTemplates';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { useCombatStore } from '@/stores/combatStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { decideEnemyAction, executeAIActions } from '@/systems/combat/enemyAI';
import { CombatSink } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { fightOutcome } from '@/systems/combat/waveResolve';
import {
  createEnemyUnits, createPlayerUnits, generateEnemyPositions, generatePlayerPositions,
} from '@/systems/combat/unitFactory';
import { buildSimHero, defaultHeroConfig } from '@/systems/sim/simHarness';
import { generateForBand } from '@/systems/world/encounterGenerator';
import { threatPowerScale } from '@/systems/world/threat';
import { EquipSlot, HeroTemplateId, TileType } from '@/models/types';
import { spyDice } from '../support/dice';

/**
 * A level-1 Monk finishes the opening encounters of the base world: the home
 * ring's band-0 fights, on every terrain, fought headlessly with its starter
 * kit (the hand wraps and plain vestment) and the hero AI at the controls.
 *
 * The other four starters are fought through the same loop beside it, so the
 * Monk is held to what the existing classes already manage rather than to a
 * number. Seeded, so a run is reproducible: the encounter rolls and the combat
 * dice both come off one generator.
 */

const TERRAINS = [TileType.Plains, TileType.Forest, TileType.Desert, TileType.Swamp];
const SEEDS = [1, 2, 3];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The class's starter kit as a sim loadout, slot by slot. */
function starterLoadout(templateId: HeroTemplateId): Partial<Record<EquipSlot, string>> {
  const cls = heroTemplates.find((t) => t.id === templateId)!.heroClass;
  const out: Partial<Record<EquipSlot, string>> = {};
  for (const id of STARTER_KIT[cls]) {
    const slot = itemTemplates.find((t) => t.id === id)!.slot;
    out[slot === 'ring' ? 'ring1' : (slot as EquipSlot)] = id;
  }
  return out;
}

const sink: CombatSink = { log: () => {}, float: () => {}, vfx: () => {}, status: () => {} };

/** One band-0 fight for a lone level-1 hero; the outcome. */
function openingFight(templateId: HeroTemplateId, terrain: TileType, seed: number): string {
  const rng = mulberry32(seed * 101 + TERRAINS.indexOf(terrain));
  const dice = spyDice().mockImplementation(rng);
  try {
    useInventoryStore.getState().reset();
    const config = { ...defaultHeroConfig(templateId, 1), equipment: starterLoadout(templateId) };
    const hero = buildSimHero(config, (item) => useInventoryStore.getState().addItem(item), `open_${templateId}`)!;
    const roster = generateForBand(0, terrain, Infinity, [], rng);
    const players = createPlayerUnits([hero], generatePlayerPositions(1));
    const enemies = createEnemyUnits(roster, generateEnemyPositions(roster.length), 1, threatPowerScale(0));
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat(players, enemies);

    for (let turn = 0; turn < 300; turn++) {
      const verdict = fightOutcome();
      // A fight that ends before the hero has swung twice measured nothing
      if (verdict !== 'ongoing') return turn > 2 && roster.length > 0 ? verdict : `${verdict} in ${turn} turns`;
      const current = useCombatStore.getState().getCurrentUnit();
      if (!current) break;
      const started = beginTurn(current.id, sink);
      if (started.kind === 'act') {
        const units = useCombatStore.getState().units;
        const fresh = units.find((u) => u.id === current.id) ?? current;
        executeAIActions(fresh, decideEnemyAction(fresh, units), sink);
      } else if (started.kind === 'inert' && started.deadlocked) {
        break;
      }
      useCombatStore.getState().nextTurn();
    }
    return 'draw';
  } finally {
    dice.mockRestore();
  }
}

describe('the opening encounters', () => {
  const fights = TERRAINS.flatMap((terrain) => SEEDS.map((seed) => [terrain, seed] as const));

  it('are finished by a level-1 Monk in its starter kit', () => {
    const lost = fights
      .map(([terrain, seed]) => [terrain, seed, openingFight('monk', terrain, seed)] as const)
      .filter(([, , outcome]) => outcome !== 'victory');
    expect(lost).toEqual([]);
  });

  it('are fought by the same loop the other starters win', () => {
    const lost: string[] = [];
    for (const id of ['warrior', 'mage', 'healer', 'ranger'] as HeroTemplateId[]) {
      for (const [terrain, seed] of fights) {
        const outcome = openingFight(id, terrain, seed);
        if (outcome !== 'victory') lost.push(`${id} ${terrain} ${seed}: ${outcome}`);
      }
    }
    expect(lost).toEqual([]);
  });
});
