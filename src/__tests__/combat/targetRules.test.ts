import { BALANCE } from '@/data/balanceConstants';
import { skillTargetRule, TARGET_RULE_IDS } from '@/data/templates/bossText';
import { imperialCleave } from '@/data/templates/aethelred';
import { dragonClaw, furnaceHeart, wingThrust } from '@/data/templates/emeraldDragon';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { boundarySmash } from '@/data/templates/trollChieftain';
import { canopyVenom } from '@/data/skills/yokaiSkills';
import { DEFAULT_LOCALE, LOCALES, setLocale, type Locale } from '@/i18n';
import { AfflictionType, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { arenaHexes, discAround } from '@/systems/combat/arenaGeometry';
import { phasesFor } from '@/systems/combat/bossPhases';
import {
  chainPair, claimBrands, crownHexes, foreclosureSeals, realmHexes,
} from '@/systems/combat/bossScript';
import { heartCarrier, riftLine, skyfireLandingCentre } from '@/systems/combat/dragonScript';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import {
  ANCHOR_KIND, convergencePlan, reprisalPlan, winterCount, winterHexes,
} from '@/systems/combat/heartScript';
import { getSkillTargets } from '@/systems/combat/targeting';
import { collapseCentre, preyTarget } from '@/systems/combat/trollScript';
import { THREAD_KIND, venomTarget } from '@/systems/combat/yokaiKits';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { at, makeFoe, makeStats, makeUnit } from '../support/fixtures';

/**
 * Target rules, stated and pinned.
 *
 * Every warned or scripted move of the four Empire bosses (and the Jorōgumo's Canopy Venom) states in one sentence, in both
 * languages, whom or where it picks (`bossSkills.<id>.target`), and each targeting function does
 * exactly what its sentence says on a fixed board, ties included. The sentences are the
 * contract; these boards are the proof.
 */

afterEach(() => setLocale(DEFAULT_LOCALE));

const hero = (id: string, position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({ id, name: id, heroId: id, position, stats: makeStats({ maxHp: 300, attack: 20, defense: 0, critChance: 0, dodgeChance: 0 }), ...over });
const boss = (position: HexCoord, over: Partial<CombatUnit> = {}): CombatUnit =>
  makeFoe({ id: 'boss', name: 'Boss', position, stats: makeStats({ maxHp: 1000, attack: 30, magic: 30, defense: 0, critChance: 0, dodgeChance: 0, moveRange: 0 }), ...over });
const onBoard = (...hexes: HexCoord[]) => {
  const keys = new Set(arenaHexes().map(hexKey));
  for (const h of hexes) expect(keys.has(hexKey(h))).toBe(true);
};
const keysOf = (hexes: readonly HexCoord[]) => new Set(hexes.map(hexKey));

// ─── Every warned move states its rule ───────────────────────────────────────

const STATED = TARGET_RULE_IDS;

describe('every warned move states its rule', () => {
  const fourBosses = ['troll_chieftain', 'aethelred', 'dragon', 'heart_of_winter'];
  const kit = (id: string): HeroSkill[] => [
    ...(enemyTemplates.find((t) => t.id === id)?.skills ?? []),
    ...(phasesFor(id) ?? []).flatMap((phase) => phase.skills),
  ];

  it.each(Object.keys(LOCALES) as Locale[])('has a sentence for each, in %s', (locale) => {
    setLocale(locale);
    for (const id of STATED) {
      const text = skillTargetRule({ id });
      expect(text).toBeDefined();
      expect(text!.trim().length).toBeGreaterThan(10);
      expect(text).not.toMatch(/^bossSkills\./);
    }
  });

  it('leaves no warning of the four bosses without one', () => {
    for (const id of fourBosses) {
      for (const skill of kit(id).filter((s) => s.prepares)) {
        expect(STATED).toContain(skill.textId ?? skill.id);
      }
    }
  });
});

// ─── The Troll Chieftain ─────────────────────────────────────────────────────

describe('Farthest Prey: the farthest hero, then the more wounded, then the lower id', () => {
  const troll = boss(at(0, -4));

  it('picks the farthest whatever the health', () => {
    const far = hero('far', at(0, 5), { currentHp: 300 });
    const near = hero('near', at(0, 0), { currentHp: 1 });
    expect(preyTarget(troll, [near, far])?.id).toBe('far');
  });

  it('breaks a tie of distance toward the more wounded, then the lower id', () => {
    const a = hero('a', at(1, 3), { currentHp: 300 });
    const b = hero('b', at(-1, 4), { currentHp: 200 });
    expect(hexDistance(troll.position, a.position)).toBe(hexDistance(troll.position, b.position));
    onBoard(a.position, b.position);
    expect(preyTarget(troll, [a, b])?.id).toBe('b');
    expect(preyTarget(troll, [b, a])?.id).toBe('b');

    const even = hero('b', at(-1, 4), { currentHp: 300 });
    expect(preyTarget(troll, [even, a])?.id).toBe('a');
  });
});

describe('Warren Collapse: the densest cluster, then the tighter', () => {
  it('falls on the cluster, not the loner', () => {
    const units = [hero('x', at(-2, 0)), hero('y', at(-1, 0)), hero('z', at(3, -3))];
    onBoard(...units.map((u) => u.position));
    const centre = collapseCentre(units)!;
    const caught = units.filter((u) => hexDistance(centre, u.position) <= BALANCE.TROLL_COLLAPSE_RADIUS).map((u) => u.id);
    expect(caught.sort()).toEqual(['x', 'y']);
  });

  it('prefers the tighter of two equally dense clusters, even against coordinate order', () => {
    // Tight pair at q 1-2, loose pair at q -2: coordinate order alone would pick the loose one
    const units = [hero('t1', at(1, 0)), hero('t2', at(2, 0)), hero('l1', at(-2, 1)), hero('l2', at(-2, -1))];
    onBoard(...units.map((u) => u.position));
    const centre = collapseCentre(units)!;
    const caught = units.filter((u) => hexDistance(centre, u.position) <= BALANCE.TROLL_COLLAPSE_RADIUS).map((u) => u.id);
    expect(caught.sort()).toEqual(['t1', 't2']);
  });
});

describe('Boundary Smash: everyone inside the ring around him, and no one outside', () => {
  it('strikes exactly the hexes within its ring', () => {
    const troll = boss(at(0, 0));
    const ring = getSkillTargets(boundarySmash, troll.position, troll.position, [troll]);
    const radius = boundarySmash.aoeRadius!;
    expect(keysOf(ring)).toEqual(keysOf(arenaHexes().filter((h) => hexDistance(h, troll.position) <= radius)));
  });
});

// ─── Aethelred ───────────────────────────────────────────────────────────────

describe('Imperial Cleave: the wedge points at the hero it would hurt most', () => {
  const emperor = (over: Partial<CombatUnit> = {}) =>
    boss(at(0, 0), {
      templateId: 'aethelred', skills: [imperialCleave], bossPhase: 0,
      // The rotation's third slot is the Cleave
      bossScript: { step: 2, phaseTurns: 1, unharmedRounds: 0 }, ...over,
    });
  const aimOf = (units: CombatUnit[]) => {
    useCombatStore.getState().reset();
    const enemy = units.find((u) => !u.isPlayer)!;
    const action = decideEnemyAction(enemy, units).find((a) => a.skill?.id === 'imperial_cleave');
    expect(action).toBeDefined();
    return keysOf(getSkillTargets(imperialCleave, enemy.position, action!.skillTarget!, units));
  };

  it('covers the cluster rather than the loner', () => {
    const units = [emperor(), hero('c1', at(0, 2)), hero('c2', at(-1, 2)), hero('lone', at(0, -2))];
    const wedge = aimOf(units);
    expect(wedge.has(hexKey(at(0, 2)))).toBe(true);
    expect(wedge.has(hexKey(at(-1, 2)))).toBe(true);
    expect(wedge.has(hexKey(at(0, -2)))).toBe(false);
  });

  it('takes the first hero in the party when two are worth the same', () => {
    const north = hero('north', at(0, -2));
    const south = hero('south', at(0, 2));
    expect(aimOf([emperor(), north, south]).has(hexKey(north.position))).toBe(true);
    expect(aimOf([emperor(), south, north]).has(hexKey(south.position))).toBe(true);
  });
});

describe('Foreclosure: a seal under every hero and on the hexes around each', () => {
  it('stamps the hero hexes and the ring around each, and nothing beyond', () => {
    const emperor = boss(at(0, -4), { templateId: 'aethelred' });
    const units = [emperor, hero('a', at(-2, 1)), hero('b', at(2, 1))];
    const seals = foreclosureSeals(emperor, units);
    const expected = arenaHexes().filter((h) =>
      hexKey(h) !== hexKey(emperor.position)
      && [units[1], units[2]].some((u) => hexDistance(u.position, h) <= BALANCE.AETHELRED_FORECLOSURE_RADIUS));
    expect(keysOf(seals)).toEqual(keysOf(expected));
    for (const u of [units[1], units[2]]) expect(keysOf(seals).has(hexKey(u.position))).toBe(true);
  });
});

describe('Chains of Tribute: the two heroes standing farthest apart', () => {
  it('links the farthest pair', () => {
    const units = [hero('a', at(-2, 2)), hero('b', at(2, -2)), hero('c', at(-1, 2))];
    const pair = chainPair(units)!.map((u) => u.id).sort();
    expect(pair).toEqual(['a', 'b']);
  });

  it('breaks a tie toward the lower ids, whatever the order they stand in the list', () => {
    // Three heroes all two hexes apart
    const units = [hero('c', at(1, 1)), hero('a', at(0, 0)), hero('b', at(2, -1))];
    expect(hexDistance(at(0, 0), at(2, -1))).toBe(2);
    expect(hexDistance(at(0, 0), at(1, 1))).toBe(2);
    expect(hexDistance(at(2, -1), at(1, 1))).toBe(2);
    expect(chainPair(units)!.map((u) => u.id)).toEqual(['a', 'b']);
  });
});

describe('Collateral Claim: the two soldiers nearest the party', () => {
  const soldier = (id: string, position: HexCoord) => makeFoe({ id, position });

  it('brands the nearest two, nearest first', () => {
    const party = [hero('h', at(0, 3))];
    const soldiers = [soldier('far', at(0, -4)), soldier('mid', at(0, 0)), soldier('near', at(0, 2))];
    expect(claimBrands(soldiers, party, 2).map((s) => s.id)).toEqual(['near', 'mid']);
  });

  it('measures from whichever hero is closest, and breaks a tie toward the lower id', () => {
    const party = [hero('h1', at(-3, 0)), hero('h2', at(3, 0))];
    // Both are two hexes from a hero; the third is farther
    const soldiers = [soldier('sB', at(-1, 0)), soldier('sA', at(1, 0)), soldier('sC', at(0, -4))];
    expect(claimBrands(soldiers, party, 2).map((s) => s.id)).toEqual(['sA', 'sB']);
  });
});

describe('Crownfall: every hex beyond the safe ring is marked, the ring is not', () => {
  it('marks exactly the hexes beyond the safe radius', () => {
    const emperor = boss(at(0, 0));
    const marked = crownHexes(emperor);
    for (const h of marked) expect(hexDistance(emperor.position, h)).toBeGreaterThan(BALANCE.AETHELRED_CROWN_SAFE_RADIUS);
    const safe = arenaHexes().filter((h) => hexDistance(emperor.position, h) <= BALANCE.AETHELRED_CROWN_SAFE_RADIUS);
    expect(marked.length + safe.length).toBe(arenaHexes().length);
  });
});

describe('The Realm That Burned: every hex around where he stands', () => {
  it('burns exactly the hexes within the radius of the origin', () => {
    const origin = at(1, -1);
    const burnt = realmHexes(origin, 2);
    expect(keysOf(burnt)).toEqual(keysOf(arenaHexes().filter((h) => hexDistance(h, origin) <= 2)));
  });
});

// ─── The Emerald Dragon ──────────────────────────────────────────────────────

describe('Furnace Heart: the hero with the most health, then the lower id', () => {
  it('is thrown onto the healthiest hero, wherever the party stands', () => {
    const units = [boss(at(0, -4), { templateId: 'dragon' }), hero('a', at(0, 0), { currentHp: 200 }), hero('b', at(3, -2))];
    expect(heartCarrier(units)?.id).toBe('b');
  });

  it('takes the lower id when two are as healthy, and leaves the boss and objectives out', () => {
    const units = [boss(at(0, -4), { templateId: 'dragon' }), hero('b', at(0, 0)), hero('a', at(2, 0))];
    expect(heartCarrier(units)?.id).toBe('a');
  });
});

describe('Cinder Rift: an X through the middle of the party along the directions that part it best', () => {
  it('parts two heroes from two on a board where one axis cannot', () => {
    const dragon = boss(at(0, -4), { templateId: 'dragon' });
    // All four on r = 0: that axis keeps them together, the other two part them evenly
    const units = [dragon, hero('a', at(-2, 0)), hero('b', at(-1, 0)), hero('c', at(1, 0)), hero('d', at(2, 0))];
    const plan = riftLine(dragon, units)!;
    expect(plan.split).toEqual([2, 2]);
    expect(plan.onLine).toBe(0);
    for (const h of plan.hexes) expect(h.q === 0 || h.q + h.r === 0).toBe(true);
    expect(plan.hexes.some((h) => h.q === 0)).toBe(true);
    expect(plan.hexes.some((h) => h.q + h.r === 0)).toBe(true);
    // and his own hex is left out
    expect(keysOf(plan.hexes).has(hexKey(dragon.position))).toBe(false);
  });
});

describe('Skyfire: the opposite half, where the landing area catches the most heroes', () => {
  it('lands in the half away from him, on the hex nearest the middle among those catching the most', () => {
    const dragon = boss(at(0, -4), { templateId: 'dragon' });
    const units = [dragon, hero('a', at(0, 2)), hero('b', at(1, 2))];
    const centre = skyfireLandingCentre(dragon, units)!;
    expect(centre).toEqual(at(0, 1));
    expect(centre.r).toBeGreaterThan(0);
    const caught = units.slice(1).filter((u) => hexDistance(centre, u.position) <= BALANCE.DRAGON_LANDING_RADIUS);
    expect(caught).toHaveLength(2);
  });
});

describe('Wing Thrust and Dragon Claw: the arc turned toward the hero it would hurt most', () => {
  const dragon = (skills: HeroSkill[], over: Partial<CombatUnit> = {}) =>
    boss(at(0, 0), {
      templateId: 'dragon', skills,
      bossScript: { step: 0, phaseTurns: 9, unharmedRounds: 0, lastUsed: {} }, ...over,
    });
  const aimOf = (skill: HeroSkill, units: CombatUnit[]) => {
    useCombatStore.getState().reset();
    const enemy = units.find((u) => !u.isPlayer)!;
    const action = decideEnemyAction(enemy, units).find((a) => a.skill?.id === skill.id);
    expect(action).toBeDefined();
    return keysOf(getSkillTargets(skill, enemy.position, action!.skillTarget!, units));
  };

  it.each([[dragonClaw], [wingThrust]])('%# covers the cluster rather than the loner', (skill) => {
    const units = [dragon([skill]), hero('c1', at(0, 1)), hero('c2', at(-1, 1)), hero('lone', at(0, -1))];
    const arc = aimOf(skill, units);
    expect(arc.has(hexKey(at(0, 1)))).toBe(true);
    expect(arc.has(hexKey(at(-1, 1)))).toBe(true);
    expect(arc.has(hexKey(at(0, -1)))).toBe(false);
  });

  it.each([[dragonClaw], [wingThrust]])('%# takes the first hero in the party when two are worth the same', (skill) => {
    const north = hero('north', at(0, -1));
    const south = hero('south', at(0, 1));
    expect(aimOf(skill, [dragon([skill]), north, south]).has(hexKey(north.position))).toBe(true);
    expect(aimOf(skill, [dragon([skill]), south, north]).has(hexKey(south.position))).toBe(true);
  });

  /** The Claw's wedge with a Furnace Heart carried by `carrierId` (a warning bound to them standing). */
  const huntOf = (units: CombatUnit[], carrierId: string) => {
    useCombatStore.getState().reset();
    const enemy = units.find((u) => !u.isPlayer)!;
    useCombatStore.setState({
      preparedAttacks: [{
        id: 'prep_heart', casterId: enemy.id, skill: { ...furnaceHeart, prepares: undefined }, spec: furnaceHeart.prepares!,
        aim: enemy.position, origin: enemy.position, hexes: [], responders: [], responded: [], scripted: 'heart', bound: [carrierId],
      }],
    });
    const action = decideEnemyAction(enemy, units).find((a) => a.skill?.id === dragonClaw.id);
    expect(action).toBeDefined();
    return keysOf(getSkillTargets(dragonClaw, enemy.position, action!.skillTarget!, units));
  };

  it('the Claw is turned to catch the Heart\'s carrier when a wedge of it reaches them, over a richer cluster', () => {
    const carrier = hero('carrier', at(0, -3));
    const units = [dragon([dragonClaw]), carrier, hero('c1', at(0, 1)), hero('c2', at(-1, 1))];
    const wedge = huntOf(units, 'carrier');
    expect(wedge.has(hexKey(carrier.position))).toBe(true);
    expect(wedge.has(hexKey(at(0, 1)))).toBe(false);
  });

  it('of the wedges that catch the carrier, takes the one that catches the most heroes besides', () => {
    // (1, -1) is in both the north and the north-east wedge; the friend at (1, -2) is only in one of them
    const units = [dragon([dragonClaw]), hero('carrier', at(1, -1)), hero('friend', at(2, -2))];
    const wedge = huntOf(units, 'carrier');
    expect(wedge.has(hexKey(at(1, -1)))).toBe(true);
    expect(wedge.has(hexKey(at(2, -2)))).toBe(true);
  });

  it('falls back to the ordinary aim when the carrier is beyond his wedges', () => {
    const units = [dragon([dragonClaw]), hero('carrier', at(4, -4)), hero('c1', at(0, 1)), hero('c2', at(-1, 1))];
    const wedge = huntOf(units, 'carrier');
    expect(wedge.has(hexKey(at(0, 1)))).toBe(true);
    expect(wedge.has(hexKey(at(4, -4)))).toBe(false);
  });

  it('a Taunt still turns the Claw on the taunter, carrier or not', () => {
    const taunter = hero('taunter', at(0, 1));
    const units = [
      dragon([dragonClaw], { activeEffects: [{ type: AfflictionType.Taunt, magnitude: 1, duration: 2, sourceUnitId: 'taunter' }] }),
      taunter, hero('carrier', at(0, -2)),
    ];
    const wedge = huntOf(units, 'carrier');
    expect(wedge.has(hexKey(taunter.position))).toBe(true);
    expect(wedge.has(hexKey(at(0, -2)))).toBe(false);
  });

  it('a Taunt turns the Claw on the taunter, whatever else is worth more', () => {
    const taunter = hero('taunter', at(0, -1));
    const units = [
      dragon([dragonClaw], { activeEffects: [{ type: AfflictionType.Taunt, magnitude: 1, duration: 2, sourceUnitId: 'taunter' }] }),
      taunter, hero('c1', at(0, 1)), hero('c2', at(-1, 1)),
    ];
    expect(aimOf(dragonClaw, units).has(hexKey(taunter.position))).toBe(true);
  });
});

// ─── The Heart of Winter ─────────────────────────────────────────────────────

describe('Creeping Winter: half the arena, the party first, a hero\'s own hex before any other', () => {
  it('marks half the arena, includes every hero hex, and nothing on another body', () => {
    const heart = boss(at(0, 0), { templateId: 'heart_of_winter' });
    const guard = makeFoe({ id: 'guard', position: at(2, 2) });
    const units = [heart, guard, hero('a', at(-2, 2)), hero('b', at(1, -3))];
    const marked = winterHexes(heart, units, []);
    expect(marked).toHaveLength(winterCount());
    expect(winterCount()).toBe(Math.round(arenaHexes().length / 2));
    const keys = keysOf(marked);
    expect(keys.has(hexKey(at(-2, 2)))).toBe(true);
    expect(keys.has(hexKey(at(1, -3)))).toBe(true);
    expect(keys.has(hexKey(guard.position))).toBe(false);
    // the party's side first: the nearest hexes to a hero are in before the far corners
    const nearest = (h: HexCoord) => Math.min(...[at(-2, 2), at(1, -3)].map((p) => hexDistance(h, p)));
    const out = arenaHexes().filter((h) => !keys.has(hexKey(h)) && hexKey(h) !== hexKey(guard.position));
    expect(Math.max(...marked.map(nearest))).toBeLessThanOrEqual(Math.max(...out.map(nearest)) + 2);
  });
});

describe('Icebound Reprisal: the anchor whose line crosses the most heroes, then the nearer', () => {
  const heart = boss(at(0, 0), { templateId: 'heart_of_winter' });
  const anchor = (id: string, position: HexCoord) =>
    makeFoe({ id, position, objective: { kind: ANCHOR_KIND, ownerId: 'boss' } });
  const north = anchor('north', at(0, -3));
  const south = anchor('south', at(0, 3));

  it('strains against the anchor with a hero on its chain', () => {
    expect(reprisalPlan(heart, [heart, north, south, hero('h', at(0, 1))])!.anchor.id).toBe('south');
    expect(reprisalPlan(heart, [heart, north, south, hero('h', at(0, -2))])!.anchor.id).toBe('north');
  });

  it('with nobody on either chain, takes the anchor nearer the party', () => {
    expect(reprisalPlan(heart, [heart, north, south, hero('h', at(1, 2))])!.anchor.id).toBe('south');
    expect(reprisalPlan(heart, [heart, north, south, hero('h', at(1, -4))])!.anchor.id).toBe('north');
  });
});

describe('Whiteout Convergence: spires near the party, never leaving a hero without a safe hex', () => {
  it('raises the first spire where its blast catches the most heroes, and every hero keeps a way out', () => {
    const heart = boss(at(0, 0), { templateId: 'heart_of_winter' });
    const heroes = [hero('a', at(0, 2)), hero('b', at(1, 2))];
    const plan = convergencePlan(heart, [heart, ...heroes], [])!;
    // The hexes both heroes' neighbours share, the lower coordinate first
    expect(plan.spires[0]).toEqual(at(0, 3));
    expect(plan.spires.length).toBeGreaterThan(0);
    const covered = keysOf(plan.footprint);
    const bodies = keysOf(plan.spires);
    for (const h of heroes) {
      const reach = [h.position, ...discAround(h.position, 1)];
      expect(reach.some((x) => !covered.has(hexKey(x)) && !bodies.has(hexKey(x)))).toBe(true);
    }
  });
});

// ─── The Jorōgumo ────────────────────────────────────────────────────────────

describe('Canopy Venom: the hero farthest from every standing thread, then the more wounded, then the lower id', () => {
  const spider = boss(at(2, -5), { templateId: 'jorogumo' });
  const thread = (id: string, position: HexCoord): CombatUnit =>
    makeFoe({ id, name: id, position, objective: { kind: THREAD_KIND, ownerId: spider.id }, stats: makeStats({ maxHp: 100 }) });
  const threads = [thread('t1', at(0, -2)), thread('t2', at(3, -3))];

  it('seeks the hero whose nearest thread is farthest, whatever the health and the distance to her', () => {
    const a = hero('a', at(0, 0), { currentHp: 1 });
    const b = hero('b', at(-3, 4));
    const c = hero('c', at(0, 3));
    onBoard(a.position, b.position, c.position);
    // b's nearest thread is 6 away, c's 5, a's 2
    expect(venomTarget(spider, [spider, ...threads, a, b, c], canopyVenom)?.id).toBe('b');
    // Measured from the nearest thread, not the first: one beside the second thread is near one
    const byT2 = hero('d', at(3, -1));
    expect(venomTarget(spider, [spider, ...threads, byT2, c], canopyVenom)?.id).toBe('c');
  });

  it('breaks a tie of distance toward the more wounded, then the lower id', () => {
    const one = [thread('t', at(0, 0))];
    const a = hero('a', at(2, 0), { currentHp: 300 });
    const b = hero('b', at(-2, 0), { currentHp: 200 });
    onBoard(a.position, b.position);
    expect(venomTarget(spider, [spider, ...one, a, b], canopyVenom)?.id).toBe('b');
    expect(venomTarget(spider, [spider, ...one, b, a], canopyVenom)?.id).toBe('b');
    const even = hero('b', at(-2, 0), { currentHp: 300 });
    expect(venomTarget(spider, [spider, ...one, even, a], canopyVenom)?.id).toBe('a');
  });

  it('only counts standing threads, and with none left she aims as any attack does', () => {
    const cut = { ...threads[0], currentHp: 0 };
    const a = hero('a', at(0, 0));
    const c = hero('c', at(0, 3));
    // With the first thread cut, a is 3 from the second and c 6: c still
    expect(venomTarget(spider, [spider, cut, threads[1], a, c], canopyVenom)?.id).toBe('c');
    expect(venomTarget(spider, [spider, { ...threads[1], currentHp: 0 }, cut, a, c], canopyVenom)).toBeNull();
  });
});
