import { buildSimHero } from '@/systems/sim/simHarness';
import { createPlayerUnits } from '@/systems/combat/unitFactory';
import { requireUnit } from '@/systems/combat/unitLookup';
import { resolveSkillUse, CombatSink } from '@/systems/combat/skillResolution';
import { applyOnMove } from '@/systems/combat/combatEvents';
import { getEffectiveStats } from '@/systems/progression/statCalc';
import { variance } from '@/systems/combat/damageCalc';
import { passiveRank } from '@/systems/combat/passives';
import { MOMENTUM_CRIT } from '@/systems/combat/passiveFormulas';
import { setDice } from '@/systems/combat/dice';
import { useCombatStore } from '@/stores/combatStore';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { createRNG } from '@/utils/rng';
import { Item } from '@/models/types';
import { makeStats, makeUnit } from '../support/fixtures';

/**
 * The crit the hero sheet shows is the crit a fight rolls (playtest PT-11).
 *
 * A level-9 Marksman read about 15% Crit on the sheet and felt like half their
 * shots crit. This drives a real level-9 Marksman — built through the sim
 * harness's real tree and gear, fielded by `createPlayerUnits`, fired through
 * `resolveSkillUse` — and counts the `-N!` floats the arena draws as CRITICAL.
 * Seeded dice, so the count is the same every run.
 *
 * Measured 2026-10-10 (Steady Hand, Repositioning, Lethality, Quarry; iron bow
 * and quiver): sheet 14%, Basic Attack and Mark Target both ~14% over 4,000
 * shots, ~25% after a move — Repositioning's Momentum is +11 at rank 1, a
 * status for the turn, not a sheet stat.
 */

const at = (q: number, r: number) => ({ q, r });
const NODES = ['marks_steady', 'marks_repositioning', 'marks_lethality', 'marks_quarry'];
const SHOTS = 4000;
// Four standard errors of a 4,000-shot binomial at ~25%: wide enough never to flake
// on a seed change, tight enough to catch a double roll or a percent/fraction slip
const TOLERANCE = 3;

function marksman() {
  const items: Item[] = [];
  const hero = buildSimHero(
    { templateId: 'ranger', level: 9, masteryPath: 'marksman', masteryNodes: NODES,
      equipment: { mainHand: 'bow_iron', offHand: 'quiver_iron' } },
    (item) => { const id = `item_${items.length}`; items.push({ ...item, id }); return id; },
    'hero',
  );
  if (!hero) throw new Error('no ranger template');
  return { hero, items };
}

function fire(skillId: string, moved: boolean) {
  const { hero, items } = marksman();
  const sheet = variance(getEffectiveStats(hero, items)).critChance;
  const [unit] = createPlayerUnits([hero], [at(0, 0)], items);
  const foe = makeUnit({
    id: 'foe', isPlayer: false, position: at(0, 3),
    stats: makeStats({ maxHp: 1e9, defense: 0, critChance: 0, dodgeChance: 0 }),
  });
  useCombatStore.getState().initCombat([{ ...unit, id: 'hero' }], [foe]);
  let hits = 0;
  let crits = 0;
  const sink: CombatSink = {
    log: () => {},
    float: (_a, text) => {
      if (!/^-\d+!?$/.test(text)) return;
      hits++;
      if (text.endsWith('!')) crits++;
    },
    vfx: () => {},
    status: () => {},
  };
  for (let i = 0; i < SHOTS; i++) {
    // Every shot from a clean slate: no cooldown, mana to spare, no lingering status
    useCombatStore.setState((s) => ({
      units: s.units.map((u) => ({ ...u, activeEffects: [], ...(u.id === 'hero' && { cooldowns: {}, currentMana: 999 }) })),
    }));
    if (moved) applyOnMove(requireUnit(useCombatStore.getState().units, 'hero'));
    const caster = requireUnit(useCombatStore.getState().units, 'hero');
    const skill = caster.skills.find((s) => s.id === skillId);
    if (!skill) throw new Error(`no ${skillId}`);
    expect(resolveSkillUse(caster, skill, at(0, 3), sink).ok).toBe(true);
  }
  const live = requireUnit(useCombatStore.getState().units, 'hero');
  return { sheet, rate: (100 * crits) / hits, perShot: hits / SHOTS, live };
}

describe('a level-9 Marksman crits at the sheet figure', () => {
  beforeEach(() => {
    const rng = createRNG(911);
    setDice(() => rng.next());
  });
  afterEach(() => setDice(null));

  it.each([BASIC_ATTACK_ID, 'mark_target'])('%s: one roll a shot, at the sheet chance', (skillId) => {
    const { sheet, rate, perShot } = fire(skillId, false);
    expect(sheet).toBeGreaterThan(10);
    expect(sheet).toBeLessThan(20);
    expect(perShot).toBe(1);
    expect(Math.abs(rate - sheet)).toBeLessThan(TOLERANCE);
  });

  it('adds exactly Momentum after a move, and nothing more', () => {
    const { sheet, rate, live } = fire(BASIC_ATTACK_ID, true);
    const momentum = MOMENTUM_CRIT * passiveRank(live, 'momentum').scale;
    expect(momentum).toBeGreaterThan(0);
    expect(Math.abs(rate - (sheet + momentum))).toBeLessThan(TOLERANCE);
  });
});
