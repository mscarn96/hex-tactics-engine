import { bagFrom } from '@/data/items/bag';
import {
  buildSimHero,
  defaultHeroConfig,
  EQUIP_SLOTS,
  isBossTemplate,
  simAutoSpend,
  simBossTemplates,
  simBossContext,
  simFoeList,
  simModeOfFoes,
  simSkirmishTemplates,
  simMasteryHero,
  simPointBudget,
  simPointsSpent,
} from '@/systems/sim/simHarness';
import { canUnlockNode, pointsEarnedByLevel } from '@/systems/progression/mastery';
import { useSimStore } from '@/stores/simStore';
import { usePartyStore } from '@/stores/partyStore';
import { useInventoryStore, selectGear } from '@/stores/inventoryStore';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { itemTemplates } from '@/data/items/itemTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { highestLevelCap } from '@/data/levelCap';
import { Item, Rarity } from '@/models/types';

/** Records what was minted without touching the real bag. */
function fakeMint() {
  const minted: Item[] = [];
  return { minted, mint: (item: Item) => { minted.push(item); return `item_${minted.length}`; } };
}

describe('buildSimHero', () => {
  it('states a hero at a level instead of levelling one up', () => {
    const { mint } = fakeMint();
    const l1 = buildSimHero(defaultHeroConfig('warrior', 1), mint)!;
    const l20 = buildSimHero(defaultHeroConfig('warrior', 20), mint)!;

    expect(l1.level).toBe(1);
    expect(l20.level).toBe(20);
    expect(l20.baseStats.maxHp).toBeGreaterThan(l1.baseStats.maxHp);
    expect(l20.currentHp).toBe(l20.baseStats.maxHp);
  });

  it('clamps a level past the cap', () => {
    const { mint } = fakeMint();
    const hero = buildSimHero({ ...defaultHeroConfig('mage', 99) }, mint)!;
    // The highest cap, so the harness can field the level-21–25 advanced nodes
    expect(hero.level).toBe(highestLevelCap());
  });

  // A path below the unlock level is not a build the game can express
  it('refuses a mastery path below the unlock level', () => {
    const { mint } = fakeMint();
    const path = MASTERY_PATHS.find((p) => p.heroClass === 'warrior')!;
    const hero = buildSimHero(
      { ...defaultHeroConfig('warrior', 2), masteryPath: path.id, masteryNodes: [path.nodes[0].id] },
      mint
    )!;

    expect(hero.masteryPath).toBeNull();
    expect(hero.masteryNodes).toEqual({});
  });

  it('grants the signature skill and the nodes it was handed', () => {
    const { mint } = fakeMint();
    const path = MASTERY_PATHS.find((p) => p.heroClass === 'warrior')!;
    const skillNode = path.nodes.find((n) => n.grantsSkill)!;
    const hero = buildSimHero(
      { ...defaultHeroConfig('warrior', 20), masteryPath: path.id, masteryNodes: [skillNode.id] },
      mint
    )!;

    const ids = hero.skills.map((s) => s.id);
    // Warrior paths all have one; the assertion is about the harness deriving
    // skills the same way the game does, not about signatures being universal
    expect(ids).toContain(path.signatureSkill!);
    expect(ids).toContain(skillNode.grantsSkill);
  });

  // Deliberate: the harness asks "how does this build feel", not "is it legal"
  it('allows a node set no played hero could afford', () => {
    const { mint } = fakeMint();
    const path = MASTERY_PATHS.find((p) => p.heroClass === 'mage')!;
    const hero = buildSimHero(
      {
        ...defaultHeroConfig('mage', 20),
        masteryPath: path.id,
        masteryNodes: path.nodes.map((n) => n.id),
      },
      mint
    )!;
    // The config is a spend *list*; the hero carries it folded into levels,
    // so 'every node once' arrives as one key each at level 1.
    expect(Object.keys(hero.masteryNodes)).toHaveLength(path.nodes.length);
  });

  it('mints one item per filled slot and equips it', () => {
    const { minted, mint } = fakeMint();
    const chest = itemTemplates.find((t) => t.slot === 'chest' && t.rarity === Rarity.Legendary)!;
    const hero = buildSimHero(
      { ...defaultHeroConfig('warrior', 10), equipment: { chest: chest.id }, upgrades: { chest: 2 } },
      mint
    )!;

    expect(minted).toHaveLength(1);
    expect(minted[0].templateId).toBe(chest.id);
    // A legendary's "+2" is two item levels past the cap it drops at.
    expect(minted[0].itemLevel).toBe(BALANCE.MAX_LEVEL + 2);
    expect(hero.equipment.chest).toBe('item_1');
  });

  it('skips slots left empty rather than minting nothing-items', () => {
    const { minted, mint } = fakeMint();
    const hero = buildSimHero(defaultHeroConfig('ranger', 5), mint)!;
    expect(minted).toHaveLength(0);
    expect(Object.keys(hero.equipment)).toHaveLength(0);
    expect(EQUIP_SLOTS).toContain('mainHand');
  });
});

/**
 * The harness now drives the *real* mastery tree, so the build it hands to a
 * fight has to be one a hero of that level could hold — otherwise the fight is
 * measuring a hero that cannot exist.
 */
describe('harness mastery builds', () => {
  const warriorPath = MASTERY_PATHS.find((p) => p.heroClass === 'warrior')!;
  const druidPath = MASTERY_PATHS.find((p) => p.id === 'wildshape')!;

  it('gives exactly the points the level grants', () => {
    for (const level of [1, 5, 10, 20]) {
      expect(simPointBudget({ level, masteryPath: warriorPath.id })).toBe(
        pointsEarnedByLevel(level, warriorPath.id),
      );
    }
    // Wildshape's bonus point stands in for the signature skill it does not have
    expect(simPointBudget({ level: 20, masteryPath: druidPath.id })).toBeGreaterThan(
      simPointBudget({ level: 20, masteryPath: warriorPath.id }),
    );
  });

  it('reports the remaining budget as the tree screen reads it', () => {
    const node = warriorPath.nodes.find((n) => n.tier === 1)!;
    const config = {
      ...defaultHeroConfig('warrior', 10),
      masteryPath: warriorPath.id,
      masteryNodes: [node.id],
    };
    const hero = simMasteryHero(config)!;
    expect(hero.masteryPoints).toBe(simPointBudget(config) - node.cost);
    expect(simPointsSpent(config)).toBe(node.cost);
  });

  it('never overspends or breaks prerequisites when auto-spending', () => {
    const offenders: string[] = [];
    for (const path of MASTERY_PATHS) {
      const template = heroTemplates.find((t) => t.heroClass === path.heroClass)!;
      for (const level of [5, 10, 20]) {
        const base = {
          ...defaultHeroConfig(template.id, level),
          masteryPath: path.id,
          masteryNodes: [],
        };
        const nodes = simAutoSpend(base);
        const config = { ...base, masteryNodes: nodes };
        if (simPointsSpent(config) > simPointBudget(config)) {
          offenders.push(`${path.id}@${level} overspent`);
        }
        // Replaying the build one node at a time must stay legal at every step —
        // the same check the screen makes on each tap
        let acc: string[] = [];
        for (const id of nodes) {
          const probe = simMasteryHero({ ...base, masteryNodes: acc })!;
          if (!canUnlockNode(probe, id).ok) offenders.push(`${path.id}@${level} illegal ${id}`);
          acc = [...acc, id];
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('spends something once a path is open, and nothing before', () => {
    const open = simAutoSpend({
      ...defaultHeroConfig('warrior', 10),
      masteryPath: warriorPath.id,
      masteryNodes: [],
    });
    expect(open.length).toBeGreaterThan(0);
    // Below the unlock level the path itself is refused, so there is nothing to buy
    expect(
      simAutoSpend({
        ...defaultHeroConfig('warrior', 3),
        masteryPath: warriorPath.id,
        masteryNodes: [],
      }),
    ).toEqual([]);
  });
});

describe('sim save protection', () => {
  beforeEach(() => {
    useSimStore.setState({ active: false, snapshot: null, enemies: [], powerScale: 1 });
  });

  it('puts the real party and bag back on the way out', () => {
    const realHeroes = usePartyStore.getState().heroes;
    usePartyStore.setState({ heroes: [{ id: 'real' } as never] });
    useInventoryStore.setState({ bag: bagFrom({ gear: [{ id: 'real_item' } as never] }) });
    const before = usePartyStore.getState().heroes;

    useSimStore.getState().enter();
    // The harness stomps on both stores, exactly as a real fight would
    usePartyStore.setState({ heroes: [{ id: 'sim' } as never, { id: 'sim2' } as never] });
    useInventoryStore.setState({ bag: bagFrom({ gear: [] }) });
    expect(usePartyStore.getState().heroes).toHaveLength(2);

    useSimStore.getState().exit();

    expect(usePartyStore.getState().heroes).toBe(before);
    expect(selectGear(useInventoryStore.getState())[0].id).toBe('real_item');
    expect(useSimStore.getState().active).toBe(false);

    usePartyStore.setState({ heroes: realHeroes });
  });

  // Re-entering would overwrite the real snapshot with a simulated one, which
  // is the single way this could still eat a save
  it('ignores a second enter while already active', () => {
    usePartyStore.setState({ heroes: [{ id: 'real' } as never] });
    useSimStore.getState().enter();
    usePartyStore.setState({ heroes: [{ id: 'sim' } as never] });

    useSimStore.getState().enter();
    useSimStore.getState().exit();

    expect(usePartyStore.getState().heroes[0].id).toBe('real');
  });

  it('leaves no harness state behind after exit', () => {
    useSimStore.getState().enter();
    useSimStore.getState().setEnemies(['orc_grunt']);
    useSimStore.getState().setPowerScale(3);
    useSimStore.getState().exit();

    const s = useSimStore.getState();
    expect(s.enemies).toEqual([]);
    expect(s.powerScale).toBe(1);
    expect(s.snapshot).toBeNull();
  });
});

describe('the boss test mode', () => {
  it('keeps bosses out of the skirmish list and offers only bosses to the boss test', () => {
    expect(simSkirmishTemplates().some((t) => t.tier === 'boss')).toBe(false);
    expect(simBossTemplates().length).toBeGreaterThan(0);
    expect(simBossTemplates().every((t) => isBossTemplate(t.id))).toBe(true);
  });

  it('fields exactly one chosen boss, and nothing until one is chosen', () => {
    const boss = simBossTemplates()[0].id;
    expect(simFoeList('boss', { wolf: 3 }, boss)).toEqual([boss]);
    expect(simFoeList('boss', { wolf: 3 }, null)).toEqual([]);
  });

  it('never lets a skirmish field a boss, even from a stale setup', () => {
    const boss = simBossTemplates()[0].id;
    expect(simFoeList('skirmish', { [boss]: 1, wolf: 2 }, null)).toEqual(['wolf', 'wolf']);
  });

  it('reads a saved boss fight back as a boss test', () => {
    const boss = simBossTemplates()[0].id;
    expect(simModeOfFoes({ [boss]: 1 })).toEqual({ mode: 'boss', boss, foes: {} });
    expect(simModeOfFoes({ wolf: 2 })).toEqual({ mode: 'skirmish', boss: null, foes: { wolf: 2 } });
  });

  it('fights every boss in the arena of its real fight', () => {
    const homes = new Map(
      simBossTemplates().map((t) => [t.id, simBossContext(t.id)] as const),
    );
    expect(homes.get('aethelred')).toMatchObject({ kind: 'location', location: 'castle' });
    expect(homes.get('troll_chieftain')).toMatchObject({ kind: 'location', location: 'lair_warren' });
    expect(homes.get('dragon')).toMatchObject({ kind: 'location', location: 'lair_wyrm' });
    expect(homes.get('heart_of_winter')).toMatchObject({ kind: 'location', location: 'lair_barrow' });
    expect(simBossContext(null)).toBeUndefined();
  });
});
