import { AuraType, CombatUnit, HeroSkill, HexCoord } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { splinteringFracture, whiteoutBlast } from '@/data/templates/heartOfWinter';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import { unitById } from '@/systems/combat/unitLookup';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';
import type { Landing } from '@/systems/combat/encounterScript';
import {
  ANCHOR_KIND,
  blastArea,
  fractureHex,
  HEART_ICE_ID,
  heartTwist,
  isFrozen,
  reprisalGrade,
  spiresOf,
} from '@/systems/combat/heartScript';
import { inArena } from '@/systems/combat/arenaGeometry';
import { hexDistance } from '@/utils/hexUtils';
import { formatPercent, t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { heroesOf } from '@/systems/combat/targetLegality';

/**
 * Landing the Heart of Winter's blows.
 *
 * The landing (`warnedLanding`) offers `landHeartWarning` every warning that comes due;
 * it handles the three the Heart has, each blow struck through the `Landing` so the
 * answer tally counts who they reached, and returns false for any other so the ordinary
 * strike runs. The Pulse is instant and run straight from its turn (`strikePulse`): no
 * warning, so no landing and nothing to count.
 *
 * - **Splintering Pulse**: the splinter, and the fracture on the hex behind its target.
 *   Ice under the target shatters for extra damage and the ground is clear again.
 * - **Creeping Winter**: each marked hex erupts and freezes over, hero or no hero.
 * - **Icebound Reprisal**: the chain snaps taut over its line and the Heart gains a
 *   Barrier. It only lands if its anchor still stands: breaking the anchor cancelled it.
 * - **Whiteout Convergence**: every spire still standing detonates, each over its own
 *   disc (overlaps hit twice), and the spires leave the board.
 */

/** How long after the first blow the next is drawn, so they read as separate. */
const SECOND_TICK_DELAY_MS = 450;
const BLAST_STAGGER_MS = 300;

const later =
  (sink: CombatSink, delayMs: number): CombatSink => ({
    ...sink,
    vfx: (spec) => sink.vfx({ ...spec, delayMs: (spec.delayMs ?? 0) + delayMs }),
  });

/** Returns true when the warning was landed here, false when the ordinary strike should run. */
export function landHeartWarning(
  landing: Landing,
  caster: CombatUnit,
  sink: CombatSink,
  fx: BossFx,
): boolean {
  switch (landing.attack.skill.id) {
    case 'creeping_winter':
      landWinter(landing, caster, sink, fx);
      return true;
    case 'icebound_reprisal':
      landReprisal(landing, caster, sink, fx);
      return true;
    case 'whiteout_convergence':
      landConvergence(landing, caster, sink, fx);
      return true;
    default:
      return false;
  }
}

// ── Splintering Pulse ────────────────────────────────────────────────────────

/** Takes hexes out of the Heart's ice. */
function thaw(ownerId: string, hexes: readonly HexCoord[]): void {
  const store = useCombatStore.getState();
  const old = store.hazards.find((h) => h.id === HEART_ICE_ID && h.ownerId === ownerId);
  if (!old) return;
  const gone = new Set(hexes.map((h) => `${h.q},${h.r}`));
  const left = old.hexes.filter((h) => !gone.has(`${h.q},${h.r}`));
  store.removeHazard(old.id);
  if (left.length > 0) store.addHazard({ ...old, hexes: left });
}

/** Freezes hexes, joining the ice already there. */
function freeze(owner: CombatUnit, hexes: readonly HexCoord[]): void {
  const store = useCombatStore.getState();
  const old = store.hazards.find((h) => h.id === HEART_ICE_ID && h.ownerId === owner.id);
  const have = new Set((old?.hexes ?? []).map((h) => `${h.q},${h.r}`));
  const merged = [...(old?.hexes ?? [])];
  for (const h of hexes) {
    if (have.has(`${h.q},${h.r}`)) continue;
    merged.push({ q: h.q, r: h.r });
  }
  if (old) store.removeHazard(old.id);
  store.addHazard({
    id: HEART_ICE_ID,
    hexes: merged,
    solid: false,
    label: 'bossLog.hazard.frozenGround',
    ownerId: owner.id,
    moveCost: BALANCE.HEART_ICE_COST,
  });
}

/** What is left of a Pulse's damage at `distance` hexes from the Heart: a tenth less per hex. */
export const pulseFalloff = (distance: number): number => Math.max(0, 1 - BALANCE.HEART_PULSE_FALLOFF * distance);

/**
 * The Pulse, made now: the splinter at the hero it aimed at, and the fracture on
 * the hex behind. Instant — nothing was announced — so it is run straight from its turn.
 * Standing on ice makes the splinter hit harder and shatters the ice under it.
 */
export function strikePulse(caster: CombatUnit, skill: HeroSkill, aim: HexCoord, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const frozen = isFrozen(aim, store.hazards);
  const behind = fractureHex(caster.position, aim);

  store.setFacing(caster.id, aim);
  const shatter = frozen ? BALANCE.HEART_PULSE_SHATTER : 0;
  const primary = { ...skill, damage: ((skill.damage ?? 0) + shatter) * pulseFalloff(hexDistance(caster.position, aim)) };
  resolveSkillUse(caster, primary, aim, sink);
  if (frozen) {
    thaw(caster.id, [aim]);
    sink.log('  ' + t('bossLog.heart.iceShatters'), '#bfeaff');
  }

  // The fracture on the hex behind; from tier 2 it runs on, hex behind hex, down the line of
  // heroes to the first hex with no hero on it or the board's edge
  const chain = heartTwist(caster, 'fractureChain');
  const struck = new Set([`${aim.q},${aim.r}`]);
  let from: HexCoord = aim;
  let at = behind;
  for (let n = 0; at; n++) {
    const striker = unitById(useCombatStore.getState().units, caster.id) ?? caster;
    if (striker.currentHp <= 0) return;
    const hex: HexCoord = at;
    if (struck.has(`${hex.q},${hex.r}`)) return;
    const hit = heroesOf(useCombatStore.getState().units).some((h) => h.position.q === hex.q && h.position.r === hex.r);
    if (!hit) return;
    struck.add(`${hex.q},${hex.r}`);
    // Each link of the chain shatters the ice under it as the splinter does; the first fracture is the lair's
    const iced = n > 0 && isFrozen(hex, useCombatStore.getState().hazards);
    sink.log('  ' + t(n === 0 ? 'bossLog.heart.splinterFractures' : 'bossLog.heart.fractureRuns'), '#8fdcff');
    const fracture = {
      ...splinteringFracture,
      damage: ((splinteringFracture.damage ?? 0) + (iced ? BALANCE.HEART_PULSE_SHATTER : 0)) * pulseFalloff(hexDistance(caster.position, hex)),
    };
    resolveSkillUse(striker, fracture, hex, later(sink, SECOND_TICK_DELAY_MS * (n + 1)));
    if (iced) thaw(caster.id, [hex]);
    if (!chain) return;
    const next = fractureHex(from, hex);
    from = hex;
    at = next;
  }
}

// ── The warned moves ─────────────────────────────────────────────────────────

function landWinter(landing: Landing, caster: CombatUnit, sink: CombatSink, fx: BossFx): void {
  const { attack } = landing;
  landing.strike(caster, sink);
  const live = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  if (live.currentHp <= 0) return;
  freeze(live, attack.hexes);
  fx.log('  ' + t('bossLog.heart.groundFreezes'), '#bfeaff');
}

function landReprisal(landing: Landing, caster: CombatUnit, sink: CombatSink, fx: BossFx): void {
  const { attack } = landing;
  const store = useCombatStore.getState();
  // Two anchors bound (tier 3 up): each line still standing snaps on its own, graded by its own anchor
  const lines = store.units.filter((u) =>
    u.currentHp > 0 && u.objective?.kind === ANCHOR_KIND && u.objective.bindsPrepared === attack.id && u.objective.boundHexes);
  if (lines.length > 0) {
    landTwinReprisal(landing, caster, lines, sink, fx);
    return;
  }
  const anchor = store.units.find((u) => u.currentHp > 0 && u.objective?.bindsPrepared === attack.id);
  // Graded: the chain snaps as hard as the anchor it strains against is whole, read as it lands
  const grade = reprisalGrade(attack.id, store.units);
  landing.strike(caster, sink, {
    skill: { ...attack.skill, damage: (attack.skill.damage ?? 0) * grade },
  });
  const live = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  if (live.currentHp <= 0) return;
  const barrier = Math.max(1, Math.round(live.stats.maxHp * BALANCE.HEART_REPRISAL_BARRIER * grade));
  useCombatStore.getState().applyEffect(live.id, {
    type: AuraType.Barrier,
    magnitude: barrier,
    duration: BALANCE.HEART_REPRISAL_BARRIER_TURNS,
    sourceUnitId: live.id,
  });
  fx.log('  ' + t('bossLog.heart.chainTaut', { name: unitName(live) }), '#ff6a7a');
  if (grade < 1) fx.log('  ' + t('bossLog.heart.chainWeak', { share: formatPercent(grade) }), '#ff6a7a');
  // The anchor answered nothing now: breaking it later is an ordinary kill, not a backlash
  if (anchor) {
    useCombatStore.getState().patchObjective(anchor.id, { bindsPrepared: undefined, backlash: undefined });
  }
}

function landTwinReprisal(landing: Landing, caster: CombatUnit, anchors: CombatUnit[], sink: CombatSink, fx: BossFx): void {
  const { attack } = landing;
  let share = 0;
  anchors.forEach((anchor, i) => {
    const striker = unitById(useCombatStore.getState().units, caster.id) ?? caster;
    if (striker.currentHp <= 0) return;
    const grade = Math.min(1, Math.max(0, anchor.currentHp / Math.max(1, anchor.stats.maxHp)));
    share += grade;
    landing.strike(striker, later(sink, i * BLAST_STAGGER_MS), {
      skill: { ...attack.skill, damage: (attack.skill.damage ?? 0) * grade },
      aim: anchor.position,
      hexes: anchor.objective?.boundHexes ?? [],
    });
  });
  const live = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  if (live.currentHp <= 0) return;
  // Each line lends its own Barrier, graded by its anchor
  const barrier = Math.max(1, Math.round(live.stats.maxHp * BALANCE.HEART_REPRISAL_BARRIER * share));
  useCombatStore.getState().applyEffect(live.id, {
    type: AuraType.Barrier, magnitude: barrier, duration: BALANCE.HEART_REPRISAL_BARRIER_TURNS, sourceUnitId: live.id,
  });
  fx.log('  ' + t('bossLog.heart.chainTaut', { name: unitName(live) }), '#ff6a7a');
  for (const anchor of anchors) {
    useCombatStore.getState().patchObjective(anchor.id, { bindsPrepared: undefined, backlash: undefined, boundHexes: undefined });
  }
}

function landConvergence(landing: Landing, caster: CombatUnit, sink: CombatSink, fx: BossFx): void {
  const { attack } = landing;
  const store = useCombatStore.getState();
  const spires = spiresOf(caster, store.units).filter((s) => s.objective?.bindsPrepared === attack.id);
  fx.log('  ' + t('bossLog.heart.spiresDetonate'), '#8fdcff');
  // Each blast is a blow of the one landing over its own disc: a hero only a spire broken in
  // time would have reached is spared, and counted so
  spires.forEach((spire, i) => {
    const striker = unitById(useCombatStore.getState().units, caster.id) ?? caster;
    if (striker.currentHp <= 0) return;
    landing.strike(striker, later(sink, i * BLAST_STAGGER_MS), {
      skill: whiteoutBlast, aim: spire.position, hexes: blastArea(spire.position), pushOrigin: null,
    });
  });
  // They are objectives, not combatants: they leave when they have gone off, and leave no ice —
  // but from tier 4 each spire left standing freezes the ground its blast covered
  for (const spire of spires) useCombatStore.getState().removeObjective(spire.id);
  const live = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  if (spires.length > 0 && live.currentHp > 0 && heartTwist(live, 'spireFrost')) {
    const solid = new Set(useCombatStore.getState().hazards.filter((h) => h.solid).flatMap((h) => h.hexes).map((h) => `${h.q},${h.r}`));
    freeze(live, spires.flatMap((s) => blastArea(s.position)).filter((h) => inArena(h) && !solid.has(`${h.q},${h.r}`)));
    fx.log('  ' + t('bossLog.heart.spiresFreeze'), '#bfeaff');
  }
}
