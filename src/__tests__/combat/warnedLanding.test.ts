import { AuraType, CombatUnit, HeroSkill, SkillTargetType } from '@/models/types';
import { AETHELRED_PHASES, chainsOfTribute } from '@/data/templates/aethelred';
import { CINDER_RIFT_LABEL, skyfire } from '@/data/templates/emeraldDragon';
import { useCombatStore } from '@/stores/combatStore';
import { castScriptedMove, resolveBossResponses } from '@/systems/combat/bossActions';
import { castDragonMove } from '@/systems/combat/dragonActions';
import type { EncounterScript, Landing } from '@/systems/combat/encounterScript';
import { castHeartMove } from '@/systems/combat/heartActions';
import { anchorsOf, blastArea, spiresOf } from '@/systems/combat/heartScript';
import { isPreparedDue, preparedBy } from '@/systems/combat/preparedAttacks';
import { resolveDuePrepared } from '@/systems/combat/preparedResolve';
import { SCRIPTS } from '@/systems/combat/scriptRegistry';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { beginTurn } from '@/systems/combat/turnStart';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { hexKey } from '@/utils/hexUtils';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';
import {
  dragonArena, dragonFx, dragonHero, dragonPrepared, dragonUnit, heroRound, landDragon, pinDragonDice, restoreDragonDice,
} from '../support/dragonBoard';

/**
 * One landing owns every blow of a warning (`warnedLanding`): the answer tally and the whiff are
 * decided from who its blows actually reached, not from the footprint as it was warned. Each case
 * is a real landing; the boss ones are blows the old footprint count could not see — a chain's
 * settlement, Skyfire's landing blow, a spire broken before the Convergence went off.
 */

const store = () => useCombatStore.getState();
const unitOf = (id: string) => requireUnit(store().units, id);
const hp = (id: string) => unitOf(id).currentHp;

// ── the rule, with a script that lands its warning its own way ─────────────────

describe('a landing counts the blows it made, not the footprint it warned', () => {
  const smash = makeSkill({
    id: 'landing_smash' as HeroSkill['id'], name: 'Landing Smash', targetType: SkillTargetType.Ring,
    range: 0, aoeRadius: 1, damage: 2, cooldown: 3, prepares: { onWhiff: 'landing_whiff' },
  });
  const hero = (id: string, position: ReturnType<typeof at>) =>
    makeUnit({ id, name: id, heroId: id, position, stats: makeStats({ maxHp: 300, defense: 0, speed: 10, critChance: 0, dodgeChance: 0 }) });

  const script = SCRIPTS[0] as EncounterScript;
  const ownLand = script.land;
  let whiff: jest.Mock;
  /** The test's own way of landing it: whatever `blows` does with the landing it is handed. */
  const landsBy = (blows: (landing: Landing, caster: CombatUnit) => void) => {
    script.land = (landing, caster) => {
      if (landing.attack.skill.id !== smash.id) return ownLand?.(landing, caster, SILENT_SINK) ?? false;
      blows(landing, caster);
      return true;
    };
  };
  beforeEach(() => {
    whiff = jest.fn();
    script.whiff = whiff;
  });
  afterEach(() => {
    script.land = ownLand;
    delete script.whiff;
  });

  /** `a` stands in the footprint, `b` well outside it. */
  function landSmash() {
    store().reset();
    store().initCombat([hero('a', at(1, 0)), hero('b', at(3, 0))], [
      makeFoe({ id: 'boss', name: 'Boss', position: at(0, 0), stats: makeStats({ maxHp: 400, attack: 30, speed: 20, critChance: 0, dodgeChance: 0 }), skills: [smash] }),
    ]);
    useCombatStore.setState({ currentUnitId: 'boss' });
    resolveSkillUse(unitOf('boss'), smash, at(0, 0), SILENT_SINK);
    for (let i = 0; i < 30 && store().preparedAttacks.some((p) => !isPreparedDue(p, store().units)); i++) store().nextTurn();
    beginTurn('boss', SILENT_SINK);
  }
  const tally = () => store().answerTally.landing_smash;

  it('a blow outside the footprint is a strike: no whiff, and the hero it warned is unharmed', () => {
    landsBy((landing, caster) => landing.blow(caster, smash, at(3, 0), SILENT_SINK, [at(3, 0)]));
    landSmash();
    expect(hp('b')).toBeLessThan(300);
    expect(hp('a')).toBe(300);
    expect(tally()).toMatchObject({ unharmed: 1, took: 0 });
    expect(whiff).not.toHaveBeenCalled();
  });

  it('a landing that strikes nobody whiffs, though a hero stood in its footprint', () => {
    landsBy(() => {});
    landSmash();
    expect(tally()).toMatchObject({ unharmed: 1, took: 0 });
    expect(whiff).toHaveBeenCalledTimes(1);
  });

  it('counts a hero struck by two blows once', () => {
    landsBy((landing, caster) => {
      landing.strike(caster, SILENT_SINK);
      landing.blow(caster, smash, at(1, 0), SILENT_SINK, [at(1, 0)]);
    });
    landSmash();
    expect(tally()).toMatchObject({ took: 1, unharmed: 0, stepped: 0 });
    expect(whiff).not.toHaveBeenCalled();
  });
});

// ── a chain settles on the pair it links ───────────────────────────────────────

describe('Chains of Tribute', () => {
  const hero = (id: string, position: ReturnType<typeof at>, over: Partial<CombatUnit> = {}) =>
    makeUnit({ id, name: id, heroId: id, position, stats: makeStats({ maxHp: 300, attack: 20, speed: 8 }), ...over });

  function castChain(heroes: CombatUnit[]) {
    store().reset();
    store().initCombat(heroes, [makeUnit({
      id: 'boss', name: 'Aethelred', isPlayer: false, templateId: 'aethelred', position: at(0, -1), bossPhase: 1,
      stats: makeStats({ maxHp: 1000, attack: 30, magic: 30, defense: 10, speed: 5, maxMana: 0 }),
      skills: AETHELRED_PHASES[1].skills,
    })]);
    store().patchBossScript('boss', { phaseTurns: 1 });
    castScriptedMove(unitOf('boss'), chainsOfTribute, { log: () => {} });
  }
  const row = () => store().answerTally[chainsOfTribute.textId ?? chainsOfTribute.id];
  function landChain(heroes: CombatUnit[]) {
    castChain(heroes);
    const [attack] = preparedBy('boss', store().preparedAttacks);
    store().updatePreparedAttack(attack.id, { responded: [...attack.responders] });
    resolveDuePrepared('boss', SILENT_SINK);
    return row();
  }

  it('apart: the weaker pays it all and took it, the other is unharmed', () => {
    const row = landChain([hero('a', at(0, 4)), hero('b', at(3, -2), { currentHp: 100 })]);
    expect(hp('a')).toBe(300);
    expect(hp('b')).toBeLessThan(100);
    expect(row).toMatchObject({ took: 1, unharmed: 1, broken: 0 });
  });

  it('close: both pay a share and both took it', () => {
    const row = landChain([hero('a', at(0, 2)), hero('b', at(1, 2))]);
    expect(hp('a')).toBeLessThan(300);
    expect(hp('b')).toBeLessThan(300);
    expect(row).toMatchObject({ took: 2, unharmed: 0 });
  });

  it('severed by a cleanse before it lands: broken for both, and nothing lands', () => {
    castChain([hero('a', at(0, 2)), hero('b', at(1, 2))]);
    store().removeAllAfflictions('a');
    resolveBossResponses({ log: () => {} });
    expect(preparedBy('boss', store().preparedAttacks)).toEqual([]);
    expect(row()).toMatchObject({ broken: 2, took: 0 });
  });
});

// ── Skyfire: the trench spares a hero the flame, not the landing blow ──────────

describe('Skyfire', () => {
  beforeEach(pinDragonDice);
  afterEach(restoreDragonDice);

  it('counts a hero the flame spared but his landing blow struck as having taken it', () => {
    dragonArena({ heroes: [dragonHero('mark', at(3, 0))] });
    castDragonMove(dragonUnit('boss'), skyfire, dragonFx);
    const [attack] = dragonPrepared();
    // Into the landing mark, on ground the Rift then burns: sheltered from the flame
    const spot = attack.landing!.find((h) => hexKey(h) !== hexKey(attack.aim)) ?? attack.landing![0];
    useCombatStore.setState((s) => ({ units: s.units.map((u) => (u.id === 'mark' ? { ...u, position: spot } : u)) }));
    store().addHazard({
      id: 'rift_t', hexes: [{ ...spot }], solid: false, label: CINDER_RIFT_LABEL,
      lasts: 'replaced', kind: 'cinder_rift', ownerId: 'boss', crossDamage: 5,
    });
    heroRound();
    landDragon();

    // Spared the flame, struck by him coming down
    expect(dragonUnit('mark').currentHp).toBeLessThan(600);
    // Before the landing owned the second blow, the footprint count called this hero unharmed
    expect(store().answerTally.skyfire).toMatchObject({ took: 1, unharmed: 0 });
  });
});

// ── Whiteout Convergence: a spire broken in time spares its disc ───────────────

describe('Whiteout Convergence', () => {
  const hero = (id: string, position: ReturnType<typeof at>) =>
    makeUnit({
      id, heroId: id, name: id, position,
      stats: makeStats({ maxHp: 5000, attack: 60, speed: 5, critChance: 0, dodgeChance: 0, moveRange: 3 }),
    });

  it('counts a hero only a broken spire would have reached as unharmed, and one a standing spire struck as having taken it', () => {
    store().reset();
    const [boss] = createEnemyUnits(['heart_of_winter'], [at(0, -4)], 1, 1);
    store().initCombat([hero('h1', at(0, 1)), hero('h2', at(2, 1))], [boss]);
    const heart = () => store().units.find((u) => u.templateId === 'heart_of_winter')!;
    store().patchBossScript(heart().id, { phaseTurns: 1 });
    for (const a of anchorsOf(heart(), store().units)) store().damageUnit(a.id, 9999, 'h1');
    store().removeEffect(heart().id, AuraType.Exposed);
    const convergence = heart().skills.find((s) => s.id === 'whiteout_convergence')!;
    expect(castHeartMove(heart(), convergence, { log: () => {}, float: () => {} }).ok).toBe(true);

    const spires = spiresOf(heart(), store().units);
    const footprint = preparedBy(heart().id, store().preparedAttacks)[0].hexes;
    const disc = (s: CombatUnit) => new Set(blastArea(s.position).map(hexKey));
    const free = (h: { q: number; r: number }) => !store().units.some((u) => u.currentHp > 0 && hexKey(u.position) === hexKey(h));
    // A spire to keep with a free hex in its disc for h1, and a free hex only the others cover for h2
    const pick = spires.map((kept) => ({
      kept,
      inKept: footprint.find((h) => disc(kept).has(hexKey(h)) && free(h)),
      onlyBroken: footprint.find((h) => !disc(kept).has(hexKey(h)) && free(h)),
    })).find((p) => p.inKept && p.onlyBroken)!;
    expect(pick).toBeDefined();
    const broken = spires.filter((s) => s.id !== pick.kept.id);
    expect(broken.length).toBeGreaterThan(0);
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => (u.id === 'h1' ? { ...u, position: pick.inKept! } : u.id === 'h2' ? { ...u, position: pick.onlyBroken! } : u)),
    }));
    // Both were in the footprint at the cast, so both are owed an answer
    const [attack] = preparedBy(heart().id, store().preparedAttacks);
    expect([...(attack.threatened ?? [])].sort()).toEqual(['h1', 'h2']);
    for (const s of broken) store().damageUnit(s.id, 9999, 'h1');
    expect(preparedBy(heart().id, store().preparedAttacks)).toHaveLength(1);

    const before = { h1: hp('h1'), h2: hp('h2') };
    store().updatePreparedAttack(attack.id, { responded: attack.responders });
    resolveDuePrepared(heart().id, SILENT_SINK);

    expect(hp('h1')).toBeLessThan(before.h1);
    expect(hp('h2')).toBe(before.h2);
    expect(store().answerTally.whiteout_convergence).toMatchObject({ took: 1, unharmed: 1, stepped: 0 });
  });
});
