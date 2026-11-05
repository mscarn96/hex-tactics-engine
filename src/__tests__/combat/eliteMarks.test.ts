import { AfflictionType, AuraType, CombatUnit, VfxSpec } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { ELITE_SKILLS } from '@/data/skills/eliteSkills';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { ELITE_MARK_COLOUR, EliteMark, eliteMarks } from '@/data/display/eliteMarks';
import { AURA_GLOW } from '@/data/display/auraGlow';
import { useCombatStore } from '@/stores/combatStore';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { CombatSink } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { at, makeStats, makeUnit, resetFixtureIds } from '../support/fixtures';

/**
 * The tells an elite's signature puts on a body, read before the consequence:
 * a save still to come, the sleep and its count, the Rage gauge, a hero an elite
 * has named, an Orc answering the order — and the moments those states change,
 * which the store hands back as pictures on the events it already returns.
 */

const hero = (id = 'h1', over: Partial<CombatUnit> = {}) =>
  makeUnit({
    id, heroId: id, position: at(0, 3), stats: makeStats({ maxHp: 4000, attack: 80, defense: 4, speed: 5 }), ...over,
  });

function fight(templates: string[], heroes: CombatUnit[] = [hero()]) {
  const store = useCombatStore.getState();
  store.reset();
  const foes = createEnemyUnits(templates, templates.map((_, i) => at(i - 1, -3)), 1, 1);
  store.initCombat(heroes, foes);
}
const units = () => useCombatStore.getState().units;
const byTemplate = (t: string) => units().find((u) => u.templateId === t)!;
const marksOf = (u: CombatUnit): EliteMark[] => eliteMarks(u, units());
const kinds = (u: CombatUnit) => marksOf(u).map((m) => m.kind);

beforeEach(() => resetFixtureIds());

describe('a lethal save is marked until it is spent', () => {
  it('marks the Cave Bear and the Revenant before the killing blow, in their own colours', () => {
    fight(['cave_bear', 'revenant']);
    expect(marksOf(byTemplate('cave_bear'))).toContainEqual({ kind: 'save', colour: ELITE_MARK_COLOUR.winterSave });
    expect(marksOf(byTemplate('revenant'))).toContainEqual({ kind: 'save', colour: ELITE_MARK_COLOUR.soulSave });
  });

  it('takes the save mark away the moment the save is spent, and shows the sleep and its count instead', () => {
    fight(['cave_bear']);
    const bear = byTemplate('cave_bear');
    useCombatStore.getState().damageUnit(bear.id, bear.currentHp + 500, 'h1');
    const after = byTemplate('cave_bear');
    expect(kinds(after)).not.toContain('save');
    expect(marksOf(after)).toContainEqual({
      kind: 'sleep', turnsLeft: BALANCE.WINTER_SLEEP_TURNS, of: BALANCE.WINTER_SLEEP_TURNS,
    });
  });

  it('counts the sleep down with the Bear’s own turns', () => {
    fight(['cave_bear']);
    const id = byTemplate('cave_bear').id;
    useCombatStore.getState().damageUnit(id, byTemplate('cave_bear').currentHp + 500, 'h1');
    beginTurn(id, { log: () => {}, float: () => {}, vfx: () => {}, status: () => {} });
    const sleep = marksOf(byTemplate('cave_bear')).find((m) => m.kind === 'sleep');
    expect(sleep).toEqual({ kind: 'sleep', turnsLeft: BALANCE.WINTER_SLEEP_TURNS - 1, of: BALANCE.WINTER_SLEEP_TURNS });
  });

  it('marks nobody without a save', () => {
    fight(['orc_grunt']);
    expect(kinds(byTemplate('orc_grunt'))).toEqual([]);
    expect(kinds(units().find((u) => u.isPlayer)!)).toEqual([]);
  });
});

describe('the Berserker’s Rage is a gauge on the board', () => {
  it('reads the stacks it is carrying against the threshold, and fills with each separate blow', () => {
    fight(['orc_berserker']);
    const id = byTemplate('orc_berserker').id;
    expect(marksOf(byTemplate('orc_berserker'))).toContainEqual({ kind: 'rage', stacks: 0, of: BALANCE.PAIN_FEAST_THRESHOLD });
    for (let i = 0; i < 3; i++) useCombatStore.getState().damageUnit(id, 1, 'h1');
    expect(marksOf(byTemplate('orc_berserker'))).toContainEqual({ kind: 'rage', stacks: 3, of: BALANCE.PAIN_FEAST_THRESHOLD });
  });

  it('never draws more than the threshold', () => {
    fight(['orc_berserker']);
    const id = byTemplate('orc_berserker').id;
    for (let i = 0; i < BALANCE.PAIN_FEAST_THRESHOLD + 3; i++) useCombatStore.getState().damageUnit(id, 1, 'h1');
    const rage = marksOf(byTemplate('orc_berserker')).find((m) => m.kind === 'rage');
    expect(rage).toEqual({ kind: 'rage', stacks: BALANCE.PAIN_FEAST_THRESHOLD, of: BALANCE.PAIN_FEAST_THRESHOLD });
  });
});

describe('a hero an elite has named carries the mark of it', () => {
  // Two heroes: the Mage never takes a party's last one
  const named = (type: AfflictionType) => {
    fight(['orc_grunt'], [hero('h1'), hero('h2', { position: at(1, 3) })]);
    const h = units().find((u) => u.isPlayer)!;
    useCombatStore.getState().applyEffect(h.id, { type, magnitude: 1, duration: 2, appliedAt: 0 });
    return marksOf(units().find((u) => u.isPlayer)!);
  };

  it('points down at the hero the Warchief named', () => {
    expect(named(AfflictionType.Warband)).toContainEqual({ kind: 'named', colour: ELITE_MARK_COLOUR.warband, shape: 'chevron' });
  });
  it('turns a sigil over a hero the Mage holds or the Crone has cursed, each in its own colour', () => {
    expect(named(AfflictionType.MindControl)).toContainEqual({ kind: 'named', colour: ELITE_MARK_COLOUR.mind, shape: 'sigil' });
    expect(named(AfflictionType.Geas)).toContainEqual({ kind: 'named', colour: ELITE_MARK_COLOUR.geas, shape: 'sigil' });
    expect(ELITE_MARK_COLOUR.mind).not.toBe(ELITE_MARK_COLOUR.geas);
  });
  it('cracks the ground under a Fractured hero', () => {
    expect(named(AfflictionType.Fracture)).toContainEqual({ kind: 'named', colour: ELITE_MARK_COLOUR.fracture, shape: 'crack' });
  });
});

describe('the Orcs answering the Warchief are marked, and only while the order stands', () => {
  function ordered() {
    fight(['orc_warchief', 'orc_grunt', 'goblin']);
    const chief = byTemplate('orc_warchief');
    const h = units().find((u) => u.isPlayer)!;
    useCombatStore.getState().applyEffect(h.id, {
      type: AfflictionType.Warband, magnitude: 1, duration: 2, appliedAt: 0, sourceUnitId: chief.id,
    });
  }

  it('rings each Orc of his warband, and not the goblin or the Warchief himself', () => {
    ordered();
    expect(kinds(byTemplate('orc_grunt'))).toContain('answering');
    expect(kinds(byTemplate('goblin'))).not.toContain('answering');
    expect(kinds(byTemplate('orc_warchief'))).not.toContain('answering');
  });

  it('drops the ring when a Stun on the Warchief breaks the order', () => {
    ordered();
    const chief = byTemplate('orc_warchief');
    useCombatStore.getState().applyEffect(chief.id, { type: AfflictionType.Stun, magnitude: 1, duration: 1, appliedAt: 0 });
    expect(kinds(byTemplate('orc_grunt'))).not.toContain('answering');
  });
});

describe('the Captain’s word glows on whoever wears it', () => {
  it('lights an empowered ally in the gold of his link', () => {
    expect(AURA_GLOW[AuraType.Authority]).toBe('#e8b84a');
  });
});

describe('the moments are handed back as pictures', () => {
  const sink = () => {
    const specs: VfxSpec[] = [];
    const s: CombatSink = { log: () => {}, float: () => {}, vfx: (v) => specs.push(v), status: () => {} };
    return { s, specs };
  };

  it('draws the Bear falling into its sleep on the blow that would have killed it', () => {
    fight(['cave_bear']);
    const bear = byTemplate('cave_bear');
    const result = useCombatStore.getState().damageUnit(bear.id, bear.currentHp + 500, 'h1');
    const fell = (result.deathEvents ?? []).find((e) => e.text.includes('Winter Sleep'));
    expect(fell?.vfx?.kind).toBe('snow');
    expect(fell?.vfx?.hitCoords).toEqual([bear.position]);
  });

  it('draws the wake as rising to full strength, on the tick that wakes it', () => {
    fight(['cave_bear']);
    const id = byTemplate('cave_bear').id;
    useCombatStore.getState().damageUnit(id, byTemplate('cave_bear').currentHp + 500, 'h1');
    const { s, specs } = sink();
    for (let turn = 1; turn <= BALANCE.WINTER_SLEEP_TURNS; turn++) beginTurn(id, s);
    expect(specs.some((v) => v.kind === 'surge' && v.casterId === id)).toBe(true);
  });

  it('draws the Captain’s word lifting off every ally that wore it as he falls', () => {
    fight(['brigand_captain', 'bandit', 'bandit']);
    const captain = byTemplate('brigand_captain');
    const wore = units().filter((u) => !u.isPlayer && u.activeEffects.some((e) => e.type === AuraType.Authority));
    expect(wore.length).toBeGreaterThan(0);
    const result = useCombatStore.getState().damageUnit(captain.id, captain.currentHp + 999, 'h1');
    const word = (result.deathEvents ?? []).find((e) => e.unitId === captain.id && e.vfx);
    expect(word?.vfx?.kind).toBe('buff');
    expect(new Set(word?.vfx?.hitCoords.map((c) => `${c.q},${c.r}`)))
      .toEqual(new Set(wore.map((u) => `${u.position.q},${u.position.r}`)));
  });
});

/**
 * A warned attack's tell is its warning: the footprint, the banner and the
 * window. A prelude on top would hold the picture back at a moment the scene
 * has already promised the party — and it lands at a turn's start, where the
 * numbers are timed by `lands`, not by the press. So no prepared skill opens
 * with one, and no summon does (the body is on the board at once).
 */
describe('a warned attack is told by its warning, not by a prelude', () => {
  it('puts no prelude on any skill that prepares', () => {
    const all = [...ALL_SKILLS, ...MASTERY_SKILLS, ...ELITE_SKILLS];
    expect(all.filter((s) => s.prepares && s.vfxPrelude).map((s) => s.id)).toEqual([]);
  });
});
