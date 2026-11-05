import { useCombatStore } from '@/stores/combatStore';
import { pendingPhase, phasesFor, isPhasedBoss } from '@/systems/combat/bossPhases';
import { AETHELRED_PHASES, AETHELRED_SKILLS } from '@/data/templates/aethelred';
import { applyStatMultipliers } from '@/systems/combat/forms';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { summonTemplates } from '@/data/templates/summonTemplates';
import { skillEffects } from '@/systems/combat/statusEffects';
import {
  AfflictionType,
  AuraType,
  CombatUnit,
  HeroStats,
  HexCoord,
} from '@/models/types';
import { makeSkill, makeStats, makeUnit } from '../support/fixtures';
import { requireUnit } from '@/systems/combat/unitLookup';
import { phaseAnnounce, phaseName } from '@/data/templates/bossText';

const at = (q: number, r: number): HexCoord => ({ q, r });
const STATS: HeroStats = {
  maxHp: 400, attack: 24, defense: 16, magic: 24, speed: 9, moveRange: 3, maxMana: 0,
};

const boss = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'aethelred', name: 'Aethelred', isPlayer: false, templateId: 'aethelred',
    stats: { ...STATS }, position: at(0, -4), skills: AETHELRED_PHASES[0].skills,
    ...over,
  });

const hero = (over: Partial<CombatUnit> = {}): CombatUnit =>
  makeUnit({
    id: 'hero', name: 'Hero', heroId: 'h1', position: at(0, 4),
    stats: makeStats({ attack: 12, defense: 6, magic: 6, maxMana: 40 }),
    ...over,
  });

const unitOf = (id: string) => requireUnit(useCombatStore.getState().units, id);

function setup(...bossOver: Partial<CombatUnit>[]) {
  useCombatStore.getState().reset();
  useCombatStore.getState().initCombat([hero()], [boss(bossOver[0] ?? {})]);
  // A phase is lived in before it is left (`pendingPhase`): these suites are
  // about what a crossing does, so the boss has already begun a turn
  useCombatStore.getState().patchBossScript('aethelred', { phaseTurns: 1 });
}

// ─── The profiles ────────────────────────────────────────────────────────────

describe('the phase profiles', () => {
  it('are three, in descending order', () => {
    const thresholds = AETHELRED_PHASES.map((p) => p.threshold);
    expect(thresholds.length).toBe(3);
    expect([...thresholds].sort((a, b) => b - a)).toEqual(thresholds);
  });

  it('open at full health', () => {
    expect(AETHELRED_PHASES[0].threshold).toBe(1.0);
  });

  /**
   * No `maxHp` multiplier, ever. Here it is load-bearing rather than merely
   * awkward: the phase *triggers* are HP thresholds, so rescaling max HP on
   * entry would re-trigger the thing that caused it.
   */
  it('never rescale max HP', () => {
    const offenders = AETHELRED_PHASES.filter((p) => p.stats?.maxHp !== undefined).map((p) => p.id);
    expect(offenders).toEqual([]);
  });

  /** `turnOrder` is sorted once at init and never re-sorted. */
  it('never change speed', () => {
    const offenders = AETHELRED_PHASES.filter((p) => p.stats?.speed !== undefined).map((p) => p.id);
    expect(offenders).toEqual([]);
  });

  it('give every phase a kit and something to say', () => {
    const bare = AETHELRED_PHASES.filter((p) => p.skills.length === 0 || !phaseAnnounce(p)).map((p) => p.id);
    expect(bare).toEqual([]);
  });

  it('uses ids that appear nowhere else in the game', () => {
    const shared = AETHELRED_SKILLS.filter((s) =>
      enemyTemplates.some((t) => t.id !== 'aethelred' && t.skills.some((k) => k.id === s.id)),
    ).map((s) => s.id);
    expect(shared).toEqual([]);
  });

  it('summons soldiers that actually exist', () => {
    const known = new Set(summonTemplates.map((t) => t.id));
    const missing = AETHELRED_SKILLS
      .filter((s) => s.summons && !known.has(s.summons.templateId))
      .map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('borrows its reinforcements from the Legion rather than copying them', () => {
    const infantry = enemyTemplates.find((t) => t.id === 'obsidian_infantry')!;
    const summoned = summonTemplates.find((t) => t.id === 'legion_infantry')!;
    expect(summoned.baseStats).toEqual(infantry.baseStats);
  });
});

// ─── Transitions ─────────────────────────────────────────────────────────────

describe('crossing a threshold', () => {
  it('recognises him as staged, and nobody else', () => {
    expect(isPhasedBoss(boss())).toBe(true);
    expect(isPhasedBoss(hero())).toBe(false);
    expect(phasesFor('goblin')).toBeUndefined();
  });

  it('starts in phase 1 and stays there at full health', () => {
    expect(pendingPhase(boss())).toBeNull();
  });

  it('changes phase when the damage lands', () => {
    setup();
    const entered = useCombatStore.getState().damageUnit('aethelred', 200).phaseEntered;
    expect(entered).toBe(phaseName(AETHELRED_PHASES[1]));
    expect(unitOf('aethelred').bossPhase).toBe(1);
  });

  it('swaps the kit with the phase', () => {
    setup();
    useCombatStore.getState().damageUnit('aethelred', 200);
    expect(unitOf('aethelred').skills.map((s) => s.id))
      .toEqual(AETHELRED_PHASES[1].skills.map((s) => s.id));
  });

  it('layers the phase multipliers into the numbers damage reads', () => {
    setup();
    useCombatStore.getState().damageUnit('aethelred', 200);
    const unit = unitOf('aethelred');
    expect(getCombatEffectiveStats(unit).magic)
      .toBe(applyStatMultipliers(STATS, AETHELRED_PHASES[1].stats).magic);
  });

  /**
   * One enormous blow crossing two thresholds takes him into the *next* phase
   * only, with the health the blow left him. No phase is skipped and no damage
   * is erased: the one after follows once he has lived a turn here.
   */
  it('enters only the next phase for a blow across two thresholds, and leaves the health alone', () => {
    setup();
    const entered = useCombatStore.getState().damageUnit('aethelred', 380).phaseEntered;
    expect(entered).toBe(phaseName(AETHELRED_PHASES[1]));
    expect(unitOf('aethelred').bossPhase).toBe(1);
    expect(unitOf('aethelred').currentHp).toBe(20);
  });

  it('waits for a turn in the new phase before the next one, even with the health already past it', () => {
    setup();
    useCombatStore.getState().damageUnit('aethelred', 380);
    expect(useCombatStore.getState().damageUnit('aethelred', 1).phaseEntered).toBeUndefined();
    useCombatStore.getState().patchBossScript('aethelred', { phaseTurns: 1 });
    expect(useCombatStore.getState().damageUnit('aethelred', 1).phaseEntered).toBe(phaseName(AETHELRED_PHASES[2]));
  });

  it('does not re-announce a phase it is already in', () => {
    setup();
    useCombatStore.getState().damageUnit('aethelred', 200);
    expect(useCombatStore.getState().damageUnit('aethelred', 10).phaseEntered).toBeUndefined();
  });

  it('clears cooldowns so a new phase arrives with its kit ready', () => {
    setup();
    const store = useCombatStore.getState();
    store.startCooldown('aethelred', AETHELRED_PHASES[0].skills[1]);
    store.damageUnit('aethelred', 200);
    expect(unitOf('aethelred').cooldowns).toEqual({});
  });

  it('does not change phase on the blow that kills him', () => {
    setup({ currentHp: 20, bossPhase: 2, hpCeiling: 132 });
    expect(useCombatStore.getState().damageUnit('aethelred', 999).phaseEntered).toBeUndefined();
  });

  it('leaves ordinary enemies entirely alone', () => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([hero()], [
      { ...boss(), id: 'goblin', templateId: 'goblin' },
    ]);
    expect(useCombatStore.getState().damageUnit('goblin', 300).phaseEntered).toBeUndefined();
  });
});

// ─── The ratchet ─────────────────────────────────────────────────────────────

describe('the health bar only runs one way', () => {
  /**
   * Without the ceiling a boss healing off four heroes could sit at 60% in his
   * most dangerous phase indefinitely, and every point of damage the party had
   * already dealt would be worth nothing.
   */
  it('caps him at the threshold he entered on', () => {
    setup();
    useCombatStore.getState().damageUnit('aethelred', 200);
    const ceiling = unitOf('aethelred').hpCeiling!;
    expect(ceiling).toBe(Math.round(STATS.maxHp * AETHELRED_PHASES[1].threshold));

    useCombatStore.getState().healUnit('aethelred', 9999);
    expect(unitOf('aethelred').currentHp).toBe(ceiling);
  });

  it('still lets him recover inside the band', () => {
    setup();
    useCombatStore.getState().damageUnit('aethelred', 200);
    const low = unitOf('aethelred').currentHp;
    useCombatStore.getState().healUnit('aethelred', 30);
    expect(unitOf('aethelred').currentHp).toBeGreaterThan(low);
  });

  it('never walks the phase backwards, however much he heals', () => {
    setup({ bossPhase: 2, hpCeiling: 132, currentHp: 100 });
    useCombatStore.getState().healUnit('aethelred', 9999);
    expect(unitOf('aethelred').bossPhase).toBe(2);
    expect(pendingPhase(unitOf('aethelred'))).toBeNull();
  });

  it('holds a regen tick to the ceiling too', () => {
    setup();
    useCombatStore.getState().damageUnit('aethelred', 200);
    const ceiling = unitOf('aethelred').hpCeiling!;
    useCombatStore.getState().applyEffect('aethelred', {
      type: AuraType.HealOverTime, magnitude: 500, duration: 3,
    });
    useCombatStore.getState().tickEffectsOnUnit('aethelred');
    expect(unitOf('aethelred').currentHp).toBeLessThanOrEqual(ceiling);
  });
});

// ─── Doom ────────────────────────────────────────────────────────────────────

describe('Doom', () => {
  const doomed = (magnitude: number, duration: number) => {
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([hero()], [boss()]);
    useCombatStore.getState().applyEffect('hero', {
      type: AfflictionType.Doom, magnitude, duration,
    });
  };

  it('does nothing at all while it runs', () => {
    doomed(60, 2);
    useCombatStore.getState().tickEffectsOnUnit('hero');
    expect(unitOf('hero').currentHp).toBe(100);
  });

  /**
   * Effects tick at the *start* of a unit's own turn, so a duration of 2 gives
   * the target exactly one turn to answer. A telegraph nobody can answer is
   * just damage with extra steps.
   */
  it('leaves exactly one turn to answer', () => {
    doomed(60, 2);
    useCombatStore.getState().tickEffectsOnUnit('hero');
    expect(unitOf('hero').currentHp).toBe(100);
    useCombatStore.getState().tickEffectsOnUnit('hero');
    expect(unitOf('hero').currentHp).toBe(40);
  });

  it('detonates once and then is gone', () => {
    doomed(30, 1);
    useCombatStore.getState().tickEffectsOnUnit('hero');
    const after = unitOf('hero').currentHp;
    useCombatStore.getState().tickEffectsOnUnit('hero');
    expect(unitOf('hero').currentHp).toBe(after);
    expect(unitOf('hero').activeEffects.some((e) => e.type === AfflictionType.Doom)).toBe(false);
  });

  // Cleansing is the intended out, and the Healer already has Purify
  it('can be cleansed before it ever lands', () => {
    doomed(60, 1);
    useCombatStore.getState().removeAllAfflictions('hero');
    useCombatStore.getState().tickEffectsOnUnit('hero');
    expect(unitOf('hero').currentHp).toBe(100);
  });

  it('goes through a barrier like anything else', () => {
    doomed(40, 1);
    useCombatStore.getState().applyEffect('hero', {
      type: AuraType.Barrier, magnitude: 25, duration: 5,
    });
    useCombatStore.getState().tickEffectsOnUnit('hero');
    expect(unitOf('hero').currentHp).toBe(85);
  });

  it('scales with the caster rather than being a flat authored number', () => {
    // Under 5 is what `resolveEffectMagnitude` reads as "a multiple of attack".
    // Aethelred no longer casts it, but the shared status keeps the rule: Doom is
    // authored as a multiple, so it holds at any level and Seal tier.
    const doom = skillEffects(makeSkill({ appliesEffect: { type: AfflictionType.Doom, magnitude: 2.5, duration: 2 } }))[0];
    expect(doom.magnitude).toBeLessThan(5);
    expect(doom.magnitude).toBeGreaterThan(0);
  });
});
