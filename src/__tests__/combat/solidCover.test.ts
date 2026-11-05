import { CombatUnit, HeroSkill, SkillTargetType } from '@/models/types';
import { useCombatStore } from '@/stores/combatStore';
import { decideEnemyAction } from '@/systems/combat/enemyAI';
import { rampartBlocksShot } from '@/systems/combat/ramparts';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { getSkillTargets, getValidSkillTargetHexes } from '@/systems/combat/targeting';
import { requireUnit } from '@/systems/combat/unitLookup';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * Terrain that lasts and blocks shots (boss tactics, shared systems).
 *
 * Pins the rules: solid ground is cover for Single, Line and Chain shots of range above one,
 * for the player and the enemy alike and in the highlights as in the resolver; a melee swing
 * beside it is not a shot; and ground that lasts "until the phase turns" or "until replaced"
 * is gone exactly then.
 */

const state = () => useCombatStore.getState();
const stats = makeStats({ maxHp: 500, attack: 30, defense: 0, critChance: 0, dodgeChance: 0, moveRange: 0 });

const arrow = (over: Partial<HeroSkill> = {}): HeroSkill =>
  makeSkill({ id: 'arrow' as HeroSkill['id'], range: 6, damage: 1, targetType: SkillTargetType.Single, ...over });

const hero = (over: Partial<CombatUnit> = {}) =>
  makeUnit({ id: 'hero', heroId: 'hero', position: at(0, 0), stats, skills: [arrow()], ...over });
const archer = (over: Partial<CombatUnit> = {}) =>
  makeFoe({ id: 'archer', position: at(4, 0), stats, skills: [arrow()], ...over });

function board(units: { heroes?: CombatUnit[]; foes?: CombatUnit[] } = {}) {
  state().reset();
  state().initCombat(units.heroes ?? [hero()], units.foes ?? [archer()]);
  state().addHazard({ id: 'rubble', hexes: [at(2, 0)], solid: true, label: 'rubble', ownerId: 'archer' });
}

describe('solid ground is cover', () => {
  it('refuses a shot over it for heroes and enemies alike, and allows one beside it', () => {
    board();
    const { units, hazards } = state();
    expect(rampartBlocksShot(arrow(), at(0, 0), at(4, 0), units, hazards)).toBe(true);
    expect(rampartBlocksShot(arrow(), at(4, 0), at(0, 0), units, hazards)).toBe(true);
    // A line that misses the rubble, and a target short of it
    expect(rampartBlocksShot(arrow(), at(0, 0), at(4, -2), units, hazards)).toBe(false);
    expect(rampartBlocksShot(arrow(), at(0, 0), at(1, 0), units, hazards)).toBe(false);
    // Without the arena's hazards nothing is solid
    expect(rampartBlocksShot(arrow(), at(0, 0), at(4, 0), units)).toBe(false);
  });

  it('does not stop a melee swing, a ring or a shot of range one', () => {
    board();
    const { units, hazards } = state();
    expect(rampartBlocksShot(arrow({ range: 1 }), at(0, 0), at(4, 0), units, hazards)).toBe(false);
    expect(rampartBlocksShot(arrow({ targetType: SkillTargetType.Ring }), at(0, 0), at(4, 0), units, hazards)).toBe(false);
  });

  it('stops the resolver, the highlights and the enemy AI in agreement', () => {
    board();
    const caster = requireUnit(state().units, 'hero');
    // The resolver refuses
    expect(resolveSkillUse(caster, arrow(), at(4, 0), SILENT_SINK).ok).toBe(false);
    expect(requireUnit(state().units, 'archer').currentHp).toBe(500);
    // The highlights do not offer the hex behind the rubble
    const lit = getValidSkillTargetHexes(arrow(), caster, state().units, state().hazards);
    expect(lit).not.toContainEqual(at(4, 0));
    // The enemy does not aim over it, and does once the ground is gone
    const shooter = requireUnit(state().units, 'archer');
    const aimed = () => decideEnemyAction(shooter, state().units).some((a) => (a.skill?.id as string) === 'arrow');
    expect(aimed()).toBe(false);
    state().removeHazard('rubble');
    expect(aimed()).toBe(true);
    expect(resolveSkillUse(caster, arrow(), at(4, 0), SILENT_SINK).ok).toBe(true);
  });

  it('a chain does not jump over it', () => {
    const chain = arrow({ targetType: SkillTargetType.Chain, chainJumps: 2, chainRange: 4 });
    const first = makeFoe({ id: 'f1', position: at(1, 0), stats });
    const second = makeFoe({ id: 'f2', position: at(3, 0), stats });
    board({ foes: [first, second] });
    const { units, hazards } = state();
    const route = (h: typeof hazards) => getSkillTargets(chain, at(0, 0), at(1, 0), units, h);
    expect(route([])).toContainEqual(at(3, 0));
    expect(route(hazards)).not.toContainEqual(at(3, 0));
  });
});

describe('ground that lasts', () => {
  const owner = 'archer';
  const lay = (id: string, over: Partial<Parameters<ReturnType<typeof state>['addHazard']>[0]> = {}) =>
    state().addHazard({ id, hexes: [at(2, 1)], solid: true, label: 'glass', ownerId: owner, ...over });

  it('a phase-bound hazard is gone after the phase turns, and only then', () => {
    board({ foes: [archer({ templateId: 'aethelred', stats: makeStats({ ...stats, maxHp: 400 }) })] });
    state().patchBossScript(owner, { phaseTurns: 1 });
    lay('glass', { lasts: 'phase' });
    lay('rubble2', { label: 'rubble' });
    expect(state().hazards.map((h) => h.id)).toContain('glass');

    state().damageUnit(owner, 400 * 0.4);
    expect(state().hazards.map((h) => h.id)).not.toContain('glass');
    // Ground without the tag stays, as before
    expect(state().hazards.map((h) => h.id)).toContain('rubble2');
  });

  it('a replaced-kind hazard is gone when its owner lays the next of the kind', () => {
    board();
    lay('rift1', { solid: false, lasts: 'replaced', kind: 'rift' });
    lay('other', { solid: false, lasts: 'replaced', kind: 'rift', ownerId: 'someone-else' });
    expect(state().hazards.map((h) => h.id)).toEqual(expect.arrayContaining(['rift1', 'other']));

    lay('rift2', { solid: false, lasts: 'replaced', kind: 'rift' });
    const ids = state().hazards.map((h) => h.id);
    expect(ids).not.toContain('rift1');
    // Another owner's ground and unrelated kinds are left alone
    expect(ids).toEqual(expect.arrayContaining(['other', 'rift2', 'rubble']));
  });

  it('a hazard with neither tag keeps its own clock', () => {
    board();
    lay('timed', { turnsLeft: 2 });
    state().tickHazards(owner);
    expect(state().hazards.find((h) => h.id === 'timed')?.turnsLeft).toBe(1);
    state().tickHazards(owner);
    expect(state().hazards.map((h) => h.id)).not.toContain('timed');
  });
});
