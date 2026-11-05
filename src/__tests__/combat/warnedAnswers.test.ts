import * as aethelred from '@/data/templates/aethelred';
import * as emeraldDragon from '@/data/templates/emeraldDragon';
import * as heartOfWinter from '@/data/templates/heartOfWinter';
import * as jorogumoWeaver from '@/data/templates/jorogumoWeaver';
import * as kairen from '@/data/templates/kairen';
import * as lastLesson from '@/data/templates/lastLesson';
import * as trollChieftain from '@/data/templates/trollChieftain';
import * as draconicHostSkills from '@/data/skills/draconicHostSkills';
import * as eliteSkills from '@/data/skills/eliteSkills';
import * as factionEliteSkills from '@/data/skills/factionEliteSkills';
import * as fallenOrderSkills from '@/data/skills/fallenOrderSkills';
import * as yokaiSkills from '@/data/skills/yokaiSkills';
import * as skillData from '@/data/skills/skillData';
import { skillText as en } from '@/i18n/locales/en/skillText';
import { HeroSkill, PreparedAttack } from '@/models/types';
import { answerOf, answersOf, boundWholeness, cancellingObjectives } from '@/systems/combat/warnedAnswers';
import { at, makeUnit } from '../support/fixtures';

/**
 * The warned move owns its answer. Every warned move in a catalog names how the party answers it
 * (`PreparedSpec.answers`), so a new one that does not fails here before the plate or the simulator's
 * party has to guess from its id; and every move's own line on the plate (`warning.move.<id>`) belongs
 * to a move that exists. The per-boss tests (`dragonScript`, `heartFight`, `aethelredScript`,
 * `trollScript`, `kairenFight`) pin which answers each has and what the party is told.
 */

/** Every skill object a module defines, nested ones included. */
function skillsIn(mod: Record<string, unknown>): HeroSkill[] {
  const found = new Map<string, HeroSkill>();
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const v = value as Record<string, unknown>;
    if (typeof v.id === 'string' && 'targetType' in v) found.set(v.id, v as unknown as HeroSkill);
    Object.values(v).forEach(walk);
  };
  Object.values(mod).forEach(walk);
  return [...found.values()];
}

const CATALOG = [
  aethelred, emeraldDragon, heartOfWinter, jorogumoWeaver, kairen, lastLesson, trollChieftain,
  draconicHostSkills, eliteSkills, factionEliteSkills, fallenOrderSkills, yokaiSkills, skillData,
].flatMap((mod) => skillsIn(mod as Record<string, unknown>));
const WARNED = CATALOG.filter((s) => s.prepares);

describe('every warned move names its answers', () => {
  it('finds the warned moves of every boss and elite', () => {
    expect(WARNED.map((s) => s.id)).toEqual(expect.arrayContaining([
      'imperial_cleave', 'crownfall', 'skyfire', 'furnace_heart', 'creeping_winter', 'icebound_reprisal',
      'boundary_smash', 'warren_collapse', 'cloud_dive', 'verdant_judgement', 'mind_control', 'great_gale',
    ]));
  });

  it('publishes at least one answer for each', () => {
    const silent = WARNED.filter((s) => (s.prepares!.answers ?? []).length === 0).map((s) => s.id);
    expect(silent).toEqual([]);
  });

  it('gives each own line on the plate to a move that exists', () => {
    const ids = new Set<string>(CATALOG.map((s) => s.id));
    const lines = Object.keys(en)
      .filter((k) => k.startsWith('warning.move.'))
      .map((k) => k.slice('warning.move.'.length).split('.')[0]);
    expect(lines.filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe('answersOf', () => {
  it('reads the answers a spec\'s rules imply before the ones it names', () => {
    expect(answersOf({
      interruptedBy: ['stun'], blockedBy: { share: 0.5 }, split: true, sealed: true,
      shelter: { onHazard: 'rift' }, answers: [{ kind: 'step' }],
    })).toEqual([
      { kind: 'break' }, { kind: 'block' }, { kind: 'share' }, { kind: 'toll' },
      { kind: 'shelter', onHazard: 'rift' }, { kind: 'step' },
    ]);
    expect(answersOf({ tauntCancels: true })).toEqual([{ kind: 'break' }]);
    expect(answersOf({})).toEqual([]);
  });

  it('finds an answer of a kind, narrowed by what it says', () => {
    const attack = { spec: { shelter: { onHazard: 'rift' }, answers: [{ kind: 'shelter' as const, besideObjective: 'anchor' }] } };
    expect(answerOf(attack, 'shelter')?.onHazard).toBe('rift');
    expect(answerOf(attack, 'shelter', (a) => !!a.besideObjective)?.besideObjective).toBe('anchor');
    expect(answerOf(attack, 'hold')).toBeUndefined();
  });
});

describe('what a warning is tied to', () => {
  const objective = (id: string, kind: string, tie: { bindsPrepared?: string; linkedPreparedId?: string }, hp = 50) =>
    makeUnit({ id, isPlayer: false, position: at(0, 0), currentHp: hp, objective: { kind, ownerId: 'boss', ...tie } });
  const attack = { id: 'w1', spec: { answers: [{ kind: 'cancel', objective: 'anchor' }] } } as unknown as PreparedAttack;

  it('is the objective of the named kind bound to it or riding on it, standing', () => {
    const units = [
      objective('bound', 'anchor', { bindsPrepared: 'w1' }),
      objective('rides', 'anchor', { linkedPreparedId: 'w1' }),
      objective('other', 'anchor', { bindsPrepared: 'w2' }),
      objective('loose', 'anchor', {}),
      objective('wrongKind', 'spire', { bindsPrepared: 'w1' }),
      objective('fallen', 'anchor', { bindsPrepared: 'w1' }, 0),
    ];
    expect(cancellingObjectives(attack, units).map((u) => u.id)).toEqual(['bound', 'rides']);
  });

  it('is nothing for a warning destroying nothing cancels', () => {
    const plain = { ...attack, spec: { answers: [{ kind: 'step' }] } } as PreparedAttack;
    expect(cancellingObjectives(plain, [objective('bound', 'anchor', { bindsPrepared: 'w1' })])).toEqual([]);
  });

  it('grades by how whole the bound objective is, and is nothing once it is gone', () => {
    const half = objective('bound', 'anchor', { bindsPrepared: 'w1' }, 50);
    half.stats.maxHp = 100;
    expect(boundWholeness('w1', 'anchor', [half])).toBe(0.5);
    expect(boundWholeness('w1', 'anchor', [{ ...half, currentHp: 0 }])).toBe(0);
  });
});
