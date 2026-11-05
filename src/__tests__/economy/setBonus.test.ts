import { bagFrom } from '@/data/items/bag';
import { Hero, HeroClass, Item, ItemTemplate, MasteryId, Rarity, SkillId } from '@/models/types';
import {
  canRerollSetBonus,
  rerollSetBonus,
  rollSetBonus,
  setBonusPath,
  setBonusPool,
} from '@/data/items/setBonus';
import { canRerollHere, MASTERY_SET_FORGE_LEVEL, setBonusRerollCost } from '@/systems/economy/forge';
import { itemTemplates } from '@/data/items/itemTemplates';
import { mintItem } from '@/systems/economy/itemFactory';
import { applyMasteryModifiers, gearSkillBonusSources, masteryModifiers } from '@/systems/progression/mastery';
import { skillBonusSourceLines } from '@/systems/progression/setBonusText';
import { itemDisplayName } from '@/systems/progression/upgrades';
import { MASTERY_PATHS, findMasteryPath } from '@/data/skills/masteryData';
import { useInventoryStore } from '@/stores/inventoryStore';
import { makeSkill } from '@/__tests__/support/fixtures';
import { BALANCE } from '@/data/balanceConstants';

/**
 * What a legendary mastery set piece says about *your* build.
 *
 * The twelve sets were the one part of the item system with nothing left to
 * discover: craftable at a level-3 forge, fixed tilt, and the seventh piece the
 * same decision as the first. A rolled skill bonus is what turns collecting one
 * into a question, and three properties are what stop it being a lottery —
 * **it names a skill of the piece's own path**, **a miss is build-relative
 * rather than path-relative**, and **it can be re-aimed for resources**.
 */

const setPieces = itemTemplates.filter(
  (t) => t.rarity === Rarity.Legendary && !!t.masteryLock,
);

const bySet = (mastery: MasteryId): ItemTemplate =>
  setPieces.find((t) => t.masteryLock?.includes(mastery))!;

describe('which items roll one', () => {
  it('rolls for a mastery set piece', () => {
    const bonus = rollSetBonus(bySet('shadowblade'), () => 0);
    expect(bonus).toBeDefined();
    expect(bonus!.percent).toBe(BALANCE.SET_BONUS_PERCENT);
  });

  /**
   * A set piece is identified by a `masteryLock` at Legendary — the pair
   * `itemGen` writes and `canEquip` enforces — rather than by a flag of its own,
   * so the hand-written uniques are correctly excluded. Excalibur is a sword,
   * not a set.
   */
  it('rolls for nothing else, uniques included', () => {
    const excalibur = itemTemplates.find((t) => t.id === 'excalibur')!;
    expect(excalibur.rarity).toBe(Rarity.Legendary);
    expect(setBonusPath(excalibur)).toBeUndefined();
    expect(rollSetBonus(excalibur, () => 0)).toBeUndefined();

    const epic = itemTemplates.find((t) => t.rarity === Rarity.Epic)!;
    expect(rollSetBonus(epic, () => 0)).toBeUndefined();
  });

  /** The key is absent rather than present-and-undefined, so a save carries nothing. */
  it('leaves the field off every item that is not one', () => {
    const common = itemTemplates.find((t) => t.rarity === Rarity.Common)!;
    expect('setBonus' in mintItem(common, () => 0)).toBe(false);
  });

  it('arrives through the acquisition path, not the catalogue one', () => {
    expect(mintItem(bySet('bulwark'), () => 0).setBonus).toBeDefined();
  });
});

describe('the pool is the path’s own skills', () => {
  /**
   * Read off `MASTERY_PATHS` rather than authored, so a node that gains or loses
   * a skill moves the pool with it. A second list of a path's skills is a second
   * thing that can disagree with the tree.
   */
  it('is the signature plus every skill a node grants', () => {
    for (const path of MASTERY_PATHS) {
      const expected = new Set<SkillId>([
        ...(path.signatureSkill ? [path.signatureSkill] : []),
        ...path.nodes.map((n) => n.grantsSkill).filter((id): id is SkillId => !!id),
      ]);
      expect(new Set(setBonusPool(path.id))).toEqual(expected);
    }
  });

  /**
   * A pool of one cannot be rerolled into anything, and Wildshape is the path
   * most at risk — it has no signature skill at all. Every path needs at least
   * two, or the top forge level sells a button that does nothing.
   */
  it('leaves every path something to reroll within', () => {
    const thin = MASTERY_PATHS.filter((p) => setBonusPool(p.id).length < 2).map((p) => p.id);
    expect(thin).toEqual([]);
  });

  /**
   * The whole point of drawing from the piece's own path: a roll can never be a
   * bonus for a path that cannot wear it.
   */
  it('never names a skill from another path', () => {
    const strays: string[] = [];
    for (const template of setPieces) {
      const mastery = template.masteryLock![0];
      const legal = new Set(setBonusPool(mastery));
      for (const roll of [0, 0.3, 0.6, 0.99]) {
        const bonus = rollSetBonus(template, () => roll);
        if (!bonus || !legal.has(bonus.skillId)) {
          strays.push(`${template.id}: ${bonus?.skillId ?? 'nothing'}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });
});

describe('rerolling', () => {
  const piece = bySet('bulwark');

  it('is a level-3 forge job and nothing lower', () => {
    const item = { ...mintItem(piece, () => 0), id: 'i1' };
    expect(canRerollHere(item, MASTERY_SET_FORGE_LEVEL)).toBe(true);
    expect(canRerollHere(item, MASTERY_SET_FORGE_LEVEL - 1)).toBe(false);
  });

  it('refuses anything that is not a set piece', () => {
    const epic = { ...mintItem(itemTemplates.find((t) => t.rarity === Rarity.Epic)!, () => 0), id: 'i2' };
    expect(canRerollSetBonus(epic)).toBe(false);
    expect(canRerollHere(epic, MASTERY_SET_FORGE_LEVEL)).toBe(false);
  });

  /**
   * A reroll that can land on the skill you were trying to leave is a price with
   * no product — it reads as the bench being broken rather than as the dice
   * being unkind.
   */
  it('never returns the skill it started with', () => {
    const item = { ...mintItem(piece, () => 0), id: 'i3' } as Item;
    const repeats: string[] = [];
    for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      const next = rerollSetBonus(item, () => roll);
      if (next.setBonus!.skillId === item.setBonus!.skillId) repeats.push(String(roll));
    }
    expect(repeats).toEqual([]);
  });

  it('costs crystals as well as gold, so it is a legendary problem', () => {
    const cost = setBonusRerollCost();
    expect(cost.crystal).toBeGreaterThan(0);
    expect(cost.gold).toBeGreaterThan(0);
  });

  it('leaves anything else untouched, by identity', () => {
    const epic = { ...mintItem(itemTemplates.find((t) => t.rarity === Rarity.Epic)!, () => 0), id: 'i4' };
    expect(rerollSetBonus(epic)).toBe(epic);
  });
});

describe('what the bonus does in a fight', () => {
  const hero = (
    masteryPath: MasteryId,
    equipment: Partial<Record<string, string>>,
  ): Hero =>
    ({
      id: 'h', templateId: 'warrior', name: 'H', heroClass: HeroClass.Warrior,
      level: 20, xp: 0,
      baseStats: { maxHp: 10, attack: 1, defense: 1, magic: 1, speed: 1, moveRange: 3, maxMana: 0 },
      currentHp: 10, currentMana: 0, skills: [], equipment,
      masteryPath, masteryPoints: 0, masteryNodes: {},
    }) as Hero;

  const wear = (item: Item) => {
    useInventoryStore.setState({ bag: bagFrom({ gear: [item] }) });
  };

  beforeEach(() => useInventoryStore.setState({ bag: bagFrom({ gear: [] }) }));

  /**
   * `masteryModifiers` is the funnel `createPlayerUnits` already goes through,
   * so the HUD, the targeting highlights and the damage resolution all read one
   * number. A second pipe would be a second thing to keep in step.
   */
  it('reaches the modifier merge off a worn piece', () => {
    const skillId = setBonusPool('bulwark')[0];
    const item: Item = {
      ...mintItem(bySet('bulwark'), () => 0),
      id: 'w1',
      setBonus: { skillId, percent: 10 },
    };
    wear(item);
    const mods = masteryModifiers(hero('bulwark', { chest: 'w1' }));
    expect(mods.skillPowerBonus).toEqual({ [skillId]: 10 });
  });

  /** Two pieces naming the same skill add — a full set concentrated is earned. */
  it('sums two pieces naming the same skill', () => {
    const skillId = setBonusPool('bulwark')[0];
    const base = mintItem(bySet('bulwark'), () => 0);
    useInventoryStore.setState({
      bag: bagFrom({ gear: [
        { ...base, id: 'w1', setBonus: { skillId, percent: 10 } },
        { ...base, id: 'w2', setBonus: { skillId, percent: 10 } },
      ] }),
    });
    const mods = masteryModifiers(hero('bulwark', { chest: 'w1', head: 'w2' }));
    expect(mods.skillPowerBonus).toEqual({ [skillId]: 20 });
  });

  /**
   * The skill's own description names where its bonus comes from (PT-38): one
   * line per worn piece, with the piece's name, from the pieces the merge sums.
   */
  it('names each worn piece that raises a skill', () => {
    const [skillId, other] = setBonusPool('bulwark');
    const base = mintItem(bySet('bulwark'), () => 0);
    useInventoryStore.setState({
      bag: bagFrom({ gear: [
        { ...base, id: 'w1', setBonus: { skillId, percent: 10 } },
        { ...base, id: 'w2', setBonus: { skillId: other, percent: 7 } },
      ] }),
    });
    const h = hero('bulwark', { chest: 'w1', head: 'w2' });
    expect(gearSkillBonusSources(h, skillId).map((b) => [b.item.id, b.percent])).toEqual([['w1', 10]]);
    expect(gearSkillBonusSources(h)).toHaveLength(2);
    expect(skillBonusSourceLines(h, skillId)).toEqual([`+10% from ${itemDisplayName(base)}`]);
    expect(skillBonusSourceLines(h, 'nothing' as SkillId)).toEqual([]);
  });

  it('contributes nothing off a hero with no equipment in scope', () => {
    expect(masteryModifiers({ masteryPath: 'bulwark', masteryNodes: {} }).skillPowerBonus)
      .toBeUndefined();
  });

  /**
   * It scales the skill's **multiplier**, not the finished damage. A
   * post-mitigation bonus would be worth wildly more against armour than against
   * paper, which is armour penetration's job and not this one's.
   */
  it('scales the named skill’s damage and healing, and no other skill', () => {
    const mods = { skillPowerBonus: { slash: 50 } } as const;
    const boosted = applyMasteryModifiers(makeSkill({ id: 'slash', damage: 2, healing: 1 }), mods);
    expect(boosted.damage).toBeCloseTo(3);
    expect(boosted.healing).toBeCloseTo(1.5);

    const other = applyMasteryModifiers(makeSkill({ id: 'bloodthirst', damage: 2 }), mods);
    expect(other.damage).toBe(2);
  });

  /**
   * A miss is build-relative, and the point budget is what guarantees misses
   * exist: a hero holds at most `MASTERY_POINTS_AT_CAP` points against a tree of
   * twelve nodes, so a full build always leaves nodes — and therefore skills —
   * unbought. Without that, "reroll" would have nothing to reroll away from.
   */
  it('is rollable onto a skill a maxed build can still be missing', () => {
    const unreachable: string[] = [];
    for (const path of MASTERY_PATHS) {
      const tree = findMasteryPath(path.id)!;
      const cheapest = [...tree.nodes].sort((a, b) => a.cost - b.cost);
      let budget = BALANCE.MASTERY_POINTS_AT_CAP + (tree.bonusPoints ?? 0);
      let bought = 0;
      for (const node of cheapest) {
        if (budget < node.cost) break;
        budget -= node.cost;
        bought++;
      }
      // Even spending greedily on the cheapest nodes, some remain unbought
      if (bought >= tree.nodes.length) unreachable.push(path.id);
    }
    expect(unreachable).toEqual([]);
  });
});
