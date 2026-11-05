import { AfflictionType, HeroSkill, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { t } from '@/i18n';

/**
 * The Mantis's tree skills — the Monk's blade dancer in hide, with a handblade in
 * each hand (the private project notes, "### Mantis").
 *
 * The loop is the class's chi loop made literal: the Basic Attack lays a Bleed
 * (Bleeding Blades) and refills chi, Twin Reap spends both. Every cost is chi,
 * and the signature costs chi too — a free Twin Reap would always beat the swing
 * that refills the pool, and the loop would never turn.
 *
 * Separate from the other classes' mastery modules for the reason they are
 * separate from each other: a path is the unit of authorship. Cadences in the
 * plan are words ("every other turn"); `cooldown` is spelled one lower.
 */

const TREE = 5;
const M = BALANCE.MANTIS;

/** The path's green, the colour of its mark (`MASTERY_COLOR.mantis`). */
export const MANTIS_GREEN = '#5ec440';

/** The Bleed a Mantis blade lays, shared by every skill and node that lays one. */
const mantisBleed = () => ({ type: AfflictionType.Bleed, magnitude: M.BLEED, duration: M.BLEED_TURNS });

/**
 * Twin Reap, the signature: two cuts on an adjacent enemy, one per handblade,
 * each with its own dodge and critical roll. If the target is Bleeding when the
 * second cut lands, that cut is a guaranteed critical and consumes the Bleed
 * (`systems/combat/mantis`). Authored as a dual-wield strike so each blade is a
 * whole blow, so `damage` is the pair: two cuts of `TWIN_REAP_CUT` each.
 *
 * Reaping Momentum, the column-2 node, makes each reap on the same enemy as the
 * last cut harder.
 */
export const twinReap: HeroSkill = {
  id: 'twin_reap',
  targetType: SkillTargetType.Single, range: 1,
  damage: M.TWIN_REAP_CUT / BALANCE.DUAL_WIELD_STRIKE_SCALE,
  dualWield: true,
  // Borrows the Venomed Blades drawing — two blades — until its own is made
  icon: 'venomed_blades',
  unlockLevel: TREE, manaCost: BALANCE.CHI.SIGNATURE, vfxColor: MANTIS_GREEN, vfxAftermath: 'spatter',
};

/**
 * Scything Step: a one-hex gap-closer that cuts with each blade and leaves the
 * Mantis's Bleed — the Basic Attack's setup without spending the swing. Already
 * beside the target, it cuts from where it stands.
 */
export const scythingStep: HeroSkill = {
  id: 'scything_step',
  targetType: SkillTargetType.Single, range: 2,
  selfMove: { kind: 'dash', range: 1 },
  damage: M.SCYTHING_STEP_CUT / BALANCE.DUAL_WIELD_STRIKE_SCALE,
  dualWield: true,
  appliesEffect: mantisBleed(),
  // Borrows Hit and Run's drawing until its own is made
  icon: 'hit_and_run',
  unlockLevel: TREE, manaCost: 15, cooldown: 1, vfxColor: MANTIS_GREEN, vfxAftermath: 'spatter',
};

/**
 * Flicker Cut: the Mantis blinks behind its prey — the back hex when it is free,
 * else a rear-side hex, else it stays (`blinksBehind: 'first'`) — then cuts, so the
 * cut is a backstab (or a flank from a rear side) under the facing rule. Was the
 * cut first and the blink after until playtest 2026-10-21 (PT-17).
 */
export const flickerCut: HeroSkill = {
  id: 'flicker_cut',
  targetType: SkillTargetType.Single, range: 1, damage: 1.1,
  blinksBehind: 'first',
  // Borrows Shadowstep's drawing until its own is made
  icon: 'shadowstep',
  unlockLevel: TREE, manaCost: 15, cooldown: 1, vfxColor: MANTIS_GREEN,
};

/**
 * Pinning Cut: a cut that lays Exposed (playtest 2026-10-17, PT-22, replacing
 * the Root): for the Mantis's next `EXPOSE_TURNS` turns the prey takes `EXPOSE`
 * more damage from that Mantis alone (`AfflictionType.CutOpen`,
 * `damageCalc.cutOpenMultiplier`). It is on
 * the carrier's clock, so one tick more than the Mantis turns it covers. A boss
 * carries it like anyone: nothing about it is a disable to refuse.
 */
export const pinningCut: HeroSkill = {
  id: 'pinning_cut',
  targetType: SkillTargetType.Single, range: 1, damage: 0.9,
  appliesEffect: { type: AfflictionType.CutOpen, magnitude: M.EXPOSE, duration: M.EXPOSE_TURNS + 1 },
  // Borrows the Wolf's Hamstring drawing until its own is made
  icon: 'wolf_hamstring',
  unlockLevel: TREE, manaCost: 20, cooldown: 2, vfxColor: MANTIS_GREEN, vfxAftermath: 'dust',
};

/**
 * Pounce: the Mantis's long gap-closer. Dash up to four hexes to an enemy and cut.
 * No Bleed (playtest 2026-10-17, PT-21): with one it was a longer, stronger
 * Scything Step; the reach is what it is for. Its id is not `pounce`, which is the Wolf's.
 */
export const mantisPounce: HeroSkill = {
  id: 'mantis_pounce',
  targetType: SkillTargetType.Single, range: 4, damage: 1.2,
  selfMove: { kind: 'dash', range: 4 },
  // Borrows the Wolf's Pounce drawing until its own is made
  icon: 'pounce',
  unlockLevel: TREE, manaCost: 20, cooldown: 2, vfxColor: MANTIS_GREEN, vfxAftermath: 'spatter',
};

// ─── Capstones ───────────────────────────────────────────────────────────────
//
// Three exclusive tier-3 skills, each 40 chi at the middle rung: one capstone and
// one regular spell empty a full pool, so the chi loop holds at the top of the tree
// too (the private project notes, "The chi loop"). Rules in `systems/combat/mantis`.

/**
 * Marked Prey: mark an enemy within six hexes and deal nothing. The mark locks
 * nothing — the Mantis moves, swings and casts as it likes — and stands for its next
 * two regular turns, on either of which the same button is the release
 * (`MARKED_PREY_RELEASE`, its words `mantisStageDescription`): a blink behind the prey, a certain critical Basic
 * Attack, a second cut worth half of what the prey has lost since the mark (never
 * more than four times Attack), and a blink back to the hex it left. An unreleased
 * mark fades. The cooldown runs from the release; the chi is paid at the mark.
 */
export const markedPrey: HeroSkill = {
  id: 'marked_prey',
  targetType: SkillTargetType.Single, range: M.MARK_RANGE, targetSide: 'enemy',
  mantisCapstone: 'markedPrey',
  // Borrows Assassinate's drawing, the other mark that comes back for its prey
  icon: 'assassinate',
  unlockLevel: TREE, manaCost: BALANCE.CHI.CAPSTONE, cooldown: 4, vfxColor: MANTIS_GREEN, vfxKind: 'buff', vfxPrelude: 'aim',
};

/** What Marked Prey's button is while its mark stands (`mantisStage`); its words are `mantisStageDescription`. */
export const MARKED_PREY_RELEASE: Partial<HeroSkill> = {
  manaCost: 0, vfxKind: undefined, vfxPrelude: undefined, vfxAftermath: 'spatter',
};

/**
 * The words for a Mantis capstone's later half — Marked Prey's release, or a
 * Threefold Scythe stage — which keeps the skill's id, so `skillDescription`
 * alone would give the launch's line. `null` for any other skill.
 */
export function mantisStageDescription(skill: HeroSkill): string | null {
  if (skill.mantisStage === 'release') return t('masteryMonk.skill.marked_prey.releaseDescription');
  if (skill.mantisStage === 2) return t('masteryMonk.skill.threefold_scythe.stage2Description');
  if (skill.mantisStage === 3) return t('masteryMonk.skill.threefold_scythe.stage3Description');
  return null;
}

/**
 * Threefold Scythe: one turn, three actions. The launch is the skill as authored —
 * a dash of up to four hexes and a cut. It queues two bonus turns at once, each
 * allowing a move and only the next stage: a three-hex arc, then an eight-hex arc
 * that leaves every enemy it hits Bleeding. The chi is paid once, at the launch, and
 * the cooldown starts there.
 */
export const threefoldScythe: HeroSkill = {
  id: 'threefold_scythe',
  targetType: SkillTargetType.Single, range: M.SCYTHE_DASH, damage: M.SCYTHE_LAUNCH,
  selfMove: { kind: 'dash', range: M.SCYTHE_DASH },
  mantisCapstone: 'threefoldScythe',
  perRank: { nested: true },
  stages: [
    {
      targetType: SkillTargetType.Arc, range: 1, aoeRadius: 1, damage: M.SCYTHE_ARC,
      selfMove: undefined, manaCost: 0,
    },
    {
      targetType: SkillTargetType.Arc, range: 2, aoeRadius: 2, damage: M.SCYTHE_SWEEP,
      selfMove: undefined, manaCost: 0, appliesEffect: mantisBleed(),
    },
  ],
  // Borrows Whirlwind's drawing until its own is made
  icon: 'whirlwind',
  unlockLevel: TREE, manaCost: BALANCE.CHI.CAPSTONE, cooldown: 4, vfxColor: MANTIS_GREEN, vfxAftermath: 'spatter',
};

/**
 * Mantis Execution: blink behind an enemy within four hexes — its back hex when
 * free, else a rear side, else any hex beside it — and cut it five times, each cut
 * its own critical roll. If it dies, the Mantis takes a bonus turn at once and the
 * cooldown is not started. No cap on the chain: the chi is the bound, because a
 * bonus turn regenerates none.
 */
export const mantisExecution: HeroSkill = {
  id: 'mantis_execution',
  targetType: SkillTargetType.Single, range: M.EXECUTION_RANGE, damage: M.EXECUTION_CUT,
  repeats: M.EXECUTION_CUTS,
  mantisCapstone: 'execution',
  // Borrows Flurry's drawing until its own is made
  icon: 'flurry',
  unlockLevel: TREE, manaCost: BALANCE.CHI.CAPSTONE, cooldown: 3, vfxColor: MANTIS_GREEN, vfxAftermath: 'spatter',
};
