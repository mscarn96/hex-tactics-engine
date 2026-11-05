import { skillDescription } from '@/data/gameText';
import { AfflictionType, CombatUnit, HeroSkill } from '@/models/types';
import { ALL_SKILLS } from '@/data/skills/skillData';
import { MASTERY_SKILLS } from '@/data/skills/masterySkills';
import { AETHELRED_SKILLS } from '@/data/templates/aethelred';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { skillEffects } from '@/systems/combat/statusEffects';
import { getMovementRange } from '@/systems/combat/movement';
import { beginTurn } from '@/systems/combat/turnStart';
import { useCombatStore } from '@/stores/combatStore';
import { resolveSkillUse, SILENT_SINK } from '@/systems/combat/skillResolution';
import { at, makeFoe, makeSkill, makeStats, makeUnit } from '../support/fixtures';

/**
 * A status read *live* on the victim's turn cannot be authored at duration 1.
 *
 * Effects tick at the start of the affected unit's turn: `tickEffectsOnUnit`
 * decrements every duration and drops whatever reaches zero, and only then does
 * the unit act. So a duration of 1 is gone before the rule it exists to impose
 * has ever been consulted — the status is applied, floats over the target, and
 * costs it nothing whatsoever.
 *
 * `AfflictionType.Stun` escapes this because `beginTurn` reads `wasStunned`
 * *before* the tick and hands back a `stunned` outcome from that snapshot.
 * Root and Silence have no such read — `isRooted` is queried live by
 * `getMovementRange` and `isSilenced` live by the AI — so for them the smallest
 * duration that costs the victim anything is **2**. It is the same arithmetic
 * `docs/combat.md` records for Doom, which fires on the outgoing duration for exactly
 * this reason.
 *
 * Thorn Lash shipped as a certain Root at duration 1 and was reported as "the
 * Rooted text appears and the enemy walks away", which is precisely what the
 * code says should happen.
 */

/** Statuses whose rule is read live on the victim's turn, after the tick. */
const LIVE_READ = [AfflictionType.Root, AfflictionType.Silence] as const;

/**
 * Every skill the game can actually field.
 *
 * Enemy and boss kits are included rather than assumed to overlap `ALL_SKILLS`:
 * `AETHELRED_SKILLS` is authored in its own file (the phase data carries
 * resolved skill objects, not ids) and would be invisible to a sweep of the two
 * shared rosters.
 */
function everySkill(): HeroSkill[] {
  const seen = new Map<string, HeroSkill>();
  const add = (s: HeroSkill) => seen.set(s.id, s);

  ALL_SKILLS.forEach(add);
  MASTERY_SKILLS.forEach(add);
  AETHELRED_SKILLS.forEach(add);
  for (const template of enemyTemplates) template.skills.forEach(add);

  return [...seen.values()];
}

describe('the statuses that are read live', () => {
  /**
   * The rule, swept over the roster.
   *
   * A duration-1 Root is not a weak Root, it is a Root that does not exist —
   * and it fails silently, because the application succeeds and the float
   * appears. Nothing at runtime can observe the difference, which is the whole
   * argument for measuring it here.
   */
  it('never authors a Root or a Silence the victim gets to ignore', () => {
    const offenders: string[] = [];

    for (const skill of everySkill()) {
      const entries = [...skillEffects(skill)];
      if (skill.grantsOnKill) entries.push(skill.grantsOnKill);
      // A variant is a second skill wearing the same button, and it carries its
      // own payload — Shadowstep's strike half is authored entirely in one.
      if (skill.occupiedVariant?.appliesEffect) {
        entries.push(...skillEffects(skill.occupiedVariant as HeroSkill));
      }

      for (const entry of entries) {
        if (!LIVE_READ.includes(entry.type as (typeof LIVE_READ)[number])) continue;
        // Permanent durations are spelled -1 and 99 and are exempt by
        // construction — the tick never decrements them at all.
        if (entry.duration === -1 || entry.duration >= 99) continue;
        if (entry.duration < 2) {
          offenders.push(`${skill.id}: ${entry.type} for ${entry.duration}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * The rule itself, driven through the real store.
 *
 * The sweep above is a convention about authored data and the durations in it
 * will get retuned; *this* is the thing that must not come back. It goes
 * through `beginTurn` rather than calling `tickEffectsOnUnit` directly, because
 * the ordering between the tick and the live read is the entire bug and only
 * the real turn-start sequence has it.
 */
describe('a Root across the victim\'s own turn', () => {
  const rooted = (duration: number): void => {
    const victim = makeUnit({
      id: 'victim',
      position: at(0, 0),
      stats: makeStats({ moveRange: 3 }),
      activeEffects: [{ type: AfflictionType.Root, magnitude: 1, duration }],
    });
    // A foe on the board so the store has two sides and nothing resolves the
    // fight before the turn is taken.
    const foe = makeFoe({ id: 'foe', position: at(5, 0) });
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([victim], [foe]);
  };

  const stillRooted = (): CombatUnit =>
    useCombatStore.getState().units.find((u) => u.id === 'victim')!;

  const canMoveAfterItsTurn = (duration: number): boolean => {
    rooted(duration);
    beginTurn('victim', SILENT_SINK);
    return getMovementRange(stillRooted(), useCombatStore.getState().units).length > 0;
  };

  it('is already gone at duration 1, which is why the enemy walks away', () => {
    expect(canMoveAfterItsTurn(1)).toBe(true);
  });

  it('still pins the victim at duration 2', () => {
    expect(canMoveAfterItsTurn(2)).toBe(false);
  });

  // And it is a *hold*, not a permanent one: the turn after is free again.
  it('lets go on the following turn', () => {
    rooted(2);
    beginTurn('victim', SILENT_SINK);
    beginTurn('victim', SILENT_SINK);
    expect(
      getMovementRange(stillRooted(), useCombatStore.getState().units).length,
    ).toBeGreaterThan(0);
  });
});

/**
 * The two skills the bug was reported through.
 *
 * Pinned by name as well as by the sweep, because these are the ones a player
 * met: the Druid's level-1 at-will and the Hawk's ring.
 */
describe('the skills that carried a Root nobody ever felt', () => {
  const find = (id: string) => everySkill().find((s) => s.id === id)!;

  /**
   * Thorn Lash pays for its real duration with a chance rather than a cooldown.
   *
   * It is the Druid's at-will: no mana, no cooldown, pressable every turn
   * forever. A *certain* two-turn Root on that button is a permanent
   * single-target lock available from level 1, which is stronger than anything
   * on the class's actual control path. Its own description has always said
   * "sometimes"; this is the mechanic finally matching the prose.
   */
  it('makes Thorn Lash a chance at a real hold rather than a certain nothing', () => {
    const lash = find('thorn_lash');
    const [root] = skillEffects(lash);
    expect(root.type).toBe(AfflictionType.Root);
    expect(root.duration).toBe(2);
    expect(root.chance).toBe(0.3);
    // The thing that makes the chance load-bearing rather than decorative
    expect(lash.cooldown).toBeUndefined();
    expect(lash.manaCost).toBe(0);
  });

  /**
   * Cyclone is certain, and that is the difference a cooldown buys.
   *
   * Scattering a group and pinning them where they land is the entire reason to
   * spend the Hawk's action and a four-turn cooldown on it; a hold that might
   * simply not occur turns the cooldown into a gamble.
   */
  // The Wildshape remaster (2026-10) took Cyclone's Root away at the designer's request:
  // damage and push only, on a shorter cooldown. Nothing may claim it still Roots.
  it('leaves Cyclone without a Root since the remaster', () => {
    const spin = find('cyclone');
    expect(skillEffects(spin).some((e) => e.type === AfflictionType.Root)).toBe(false);
    expect(skillDescription(spin)).not.toMatch(/root/i);
    expect(spin.pushDistance).toBe(1);
  });
});

/**
 * The plumbing, pinned independently of the dice.
 *
 * `effectLands` is unit-tested against an injected rng in `effectChance.test.ts`;
 * what this adds is that the *store* ends up in the right state at the two
 * extremes, so a `chance` that were dropped somewhere between the authored
 * `SkillEffect` and `applyEffect` would fail here even though the predicate
 * itself is fine. Certainty at both ends means no roll is involved and the test
 * cannot flicker.
 */
describe('a chance carried end to end', () => {
  const cast = (chance: number): boolean => {
    const caster = makeUnit({ id: 'caster', position: at(0, 0), stats: makeStats({ magic: 10 }) });
    const foe = makeFoe({ id: 'foe', position: at(1, 0), stats: makeStats({ maxHp: 500 }) });
    useCombatStore.getState().reset();
    useCombatStore.getState().initCombat([caster], [foe]);

    const skill = makeSkill({
      range: 1,
      damage: 0.5,
      appliesEffect: { type: AfflictionType.Root, magnitude: 1, duration: 2, chance },
    });

    resolveSkillUse(
      useCombatStore.getState().units.find((u) => u.id === 'caster')!,
      skill,
      at(1, 0),
      SILENT_SINK,
    );

    return useCombatStore
      .getState()
      .units.find((u) => u.id === 'foe')!
      .activeEffects.some((e) => e.type === AfflictionType.Root);
  };

  it('never lands at chance 0', () => {
    expect(cast(0)).toBe(false);
  });

  it('always lands at chance 1', () => {
    expect(cast(1)).toBe(true);
  });
});
