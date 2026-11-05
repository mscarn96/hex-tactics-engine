import { difficultyMultipliers } from '@/systems/combat/runDifficulty';
import { AfflictionType, CombatUnit, HeroSkill, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { briarClaim, geasEruption as geasEruptionSkill, mirePull } from '@/data/skills/eliteSkills';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import type { CastRule, Landing } from '@/systems/combat/encounterScript';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { unitById } from '@/systems/combat/unitLookup';
import { findSummonHexes } from '@/systems/combat/summoning';
import {
  briarTarget,
  canPlantSeed,
  canCallBackup,
  GRUNT_TEMPLATE,
  fracturedHeroes,
  fractureFootprint,
  geasFootprint,
  isBasicAction,
  mireHexes,
  poisonedBy,
  previewPulls,
  SEED_KIND,
  seedHex,
  THRALL_TEMPLATE,
  thrallsOf,
} from '@/systems/combat/eliteKits';
import { createObjective } from '@/systems/combat/objectives';
import { canPrepare, castPrepared } from '@/systems/combat/preparedCast';
import { affectedBy } from '@/systems/combat/preparedAttacks';
import { hasEffect } from '@/systems/combat/statusEffects';
import { hexKey } from '@/utils/hexUtils';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';

/**
 * The warned half of the elites' signatures: a marsh that pulls, a ground that
 * cracks, a seed that grows, a curse that erupts.
 *
 * Every one of them rides the shared warning (`castPrepared` and the landing in
 * `preparedResolve`), so the footprint is fixed at the cast, the party is owed a
 * window, and the preview and the resolution are one rule. What is new is only
 * where each footprint comes from and what lands. Shared by every driver, like the
 * bosses' scripts, so a warning raised in the app and one raised in a measured
 * fight are the same.
 */

const MIRE_GREEN = '#7a9a4a';
const CRACK_TAN = '#d0b890';
const BRIAR_GREEN = '#6a9a3a';
const GEAS_PURPLE = '#9a5ac8';

const INTERRUPTED_BY = ['stun', 'silence', 'freeze'] as const;

/** The level the elite was scaled to, as the multiplier on its template's own sheet. */
export function scaleOf(owner: CombatUnit): number {
  if (owner.enemyStatScale !== undefined) return owner.enemyStatScale;
  const base = enemyTemplates.find((t) => t.id === owner.templateId)?.baseStats.maxHp ?? 0;
  return base > 0 ? owner.stats.maxHp / (base * difficultyMultipliers(undefined, owner.sparedStrength).hp) : 1;
}

// ── Bog Hulk: Mire Undertow ──────────────────────────────────────────────────

/**
 * The marsh the slam leaves. Announced through the shared warning over every hex
 * within `MIRE_RADIUS` of the Hulk: heroes standing in it owe a turn, and the
 * landing hexes the party is shown are where the pull will actually put them.
 */
export function castUndertow(hulk: CombatUnit, fx: BossFx): void {
  const store = useCombatStore.getState();
  if (!canPrepare(hulk.id)) return;
  const skill: HeroSkill = { ...mirePull, prepares: { windows: 1 } };
  const cast = castPrepared(hulk, skill, hulk.position, mireHexes(hulk.position), store.units, fx.log);
  if (!cast.ok) return;
  store.updatePreparedAttack(cast.attack.id, { scripted: 'undertow' });
  fx.log('  ' + t('bossLog.elite.mireBegins', { name: unitName(hulk) }), MIRE_GREEN);
}

function landUndertow(landing: Landing, hulk: CombatUnit, fx: BossFx): void {
  const { attack } = landing;
  const store = useCombatStore.getState();
  const units = store.units;
  const caught = affectedBy(attack, units).filter((u) => u.isPlayer !== hulk.isPlayer);
  // The marsh's catch is who the landing struck, dragged or held
  landing.hit(caught.map((u) => u.id));
  // Toward the Hulk where he stands now: the party was shown this very trace
  const moves = previewPulls(hulk.position, caught, BALANCE.MIRE_PULL, units, store.hazards);
  fx.vfx?.({
    kind: 'nova', delivery: 'spell',
    casterId: hulk.id,
    casterPos: hulk.position,
    targetCoord: hulk.position,
    hitUnitIds: caught.map((u) => u.id),
    hitCoords: attack.hexes,
    color: MIRE_GREEN,
  });
  if (caught.length === 0) {
    fx.log('  ' + t('bossLog.elite.mireEmpty'), MIRE_GREEN);
    return;
  }
  for (const move of moves) {
    const body = unitById(useCombatStore.getState().units, move.unitId);
    if (!body || !move.moved) {
      if (body) fx.log('  ' + t('bossLog.elite.mireHolds', { name: unitName(body) }), MIRE_GREEN);
      continue;
    }
    const ticks = useCombatStore.getState().moveUnit(move.unitId, move.to);
    fx.log('  ' + t('bossLog.elite.mireDragged', { name: unitName(body), count: move.path.length }), MIRE_GREEN);
    fx.float?.(move.to, t('bossLog.elite.float.dragged'), MIRE_GREEN);
    for (const t of ticks) fx.float?.(move.to, t.text, t.color);
  }
}

// ── Delve Overseer: Fracture ─────────────────────────────────────────────────

/**
 * The Overseer's Ground Slam against a Fractured party: announced, and drawn over
 * the ground round him and round every marked hero. Returns false when nobody is
 * Fractured — then the slam is the ordinary one and strikes at once.
 */
export function castFractureSlam(overseer: CombatUnit, skill: HeroSkill, fx: BossFx): { ok: boolean } {
  const store = useCombatStore.getState();
  const marked = fracturedHeroes(store.units);
  if (marked.length === 0 || !canPrepare(overseer.id)) return { ok: false };
  const hexes = fractureFootprint(overseer.position, marked.map((h) => h.position));
  const prepared: HeroSkill = { ...skill, prepares: { interruptedBy: [...INTERRUPTED_BY], windows: 1 } };
  const cast = castPrepared(overseer, prepared, overseer.position, hexes, store.units, fx.log);
  if (!cast.ok) return { ok: false };
  store.updatePreparedAttack(cast.attack.id, { scripted: 'fracture', bound: marked.map((h) => h.id) });
  fx.log('  ' + t('bossLog.elite.groundCracks', { names: marked.map((h) => unitName(h)).join(', ') }), CRACK_TAN);
  return { ok: true };
}

/**
 * A Fracture warning follows the heroes it marks. Each turn the rings round them
 * are redrawn where they stand now; a hero cleansed or fallen drops out, and one
 * the ring newly reaches owes a window of their own, so a detonation never
 * arrives without its answer. The ring round the Overseer is where he cast from.
 */
export function followFractures(fx: BossFx): void {
  const store = useCombatStore.getState();
  for (const attack of store.preparedAttacks.filter((p) => p.scripted === 'fracture')) {
    const units = useCombatStore.getState().units;
    const marked = (attack.bound ?? [])
      .map((id) => unitById(units, id))
      .filter((u): u is CombatUnit => !!u && u.currentHp > 0 && hasEffect(u, AfflictionType.Fracture));
    const hexes = fractureFootprint(attack.origin, marked.map((h) => h.position));
    const same =
      hexes.length === attack.hexes.length &&
      hexes.every((h) => attack.hexes.some((a) => hexKey(a) === hexKey(h)));
    if (same) continue;

    const before = new Set(attack.hexes.map(hexKey));
    const covered = new Set(hexes.map(hexKey));
    const newly = units.filter(
      (u) =>
        u.currentHp > 0 &&
        u.isPlayer &&
        !u.objective &&
        covered.has(hexKey(u.position)) &&
        !before.has(hexKey(u.position)) &&
        !attack.responders.includes(u.id),
    );
    store.updatePreparedAttack(attack.id, {
      hexes,
      responders: [...attack.responders, ...newly.map((u) => u.id)],
    });
    fx.log('  ' + t('bossLog.elite.crackShifts'), CRACK_TAN);
  }
}

/** The slam has gone off: the marks it detonated are spent. */
export function afterEliteLanding(attack: PreparedAttack, overseer: CombatUnit, fx: BossFx): void {
  if (attack.scripted !== 'fracture') return;
  const store = useCombatStore.getState();
  let spent = 0;
  for (const id of attack.bound ?? []) {
    const hero = unitById(useCombatStore.getState().units, id);
    if (!hero || !hasEffect(hero, AfflictionType.Fracture)) continue;
    store.removeEffect(id, AfflictionType.Fracture);
    spent++;
  }
  if (spent > 0) fx.log('  ' + t('bossLog.elite.fractureSpent', { name: unitName(overseer) }), CRACK_TAN);
}

// ── Coven Matriarch: Briar Claim ─────────────────────────────────────────────

/**
 * After her Blight: plant a briar seed beside one of the heroes it poisoned, as a
 * warning that waits one window for that hero. The seed is an attackable objective
 * bound to the warning, so cutting it down cancels the claim at once; the poison
 * is the other half, checked when the window is over.
 */
export function plantBriar(matriarch: CombatUnit, fx: BossFx): void {
  const store = useCombatStore.getState();
  const units = store.units;
  if (!canPrepare(matriarch.id) || !canPlantSeed(matriarch, units)) return;
  const hero = briarTarget(matriarch, units);
  if (!hero) return;
  const hex = seedHex(matriarch, hero, units, store.hazards);
  if (!hex) return;

  const claim: HeroSkill = { ...briarClaim, prepares: { windows: 1 } };
  const cast = castPrepared(matriarch, claim, hex, [hex], units, fx.log);
  if (!cast.ok) return;

  const made = createObjective({
    kind: SEED_KIND,
    owner: matriarch,
    position: hex,
    hp: Math.max(1, Math.round(matriarch.stats.maxHp * BALANCE.BRIAR_SEED_HP)),
    defense: 0,
    shattersOnPhase: false,
    // Destroying it cancels the warning; the warning landing is what spends it
    bindsPrepared: cast.attack.id,
    linkedUnitId: hero.id,
  });
  store.addUnits([made]);
  // The hero it feeds on owes the window, though nobody stood on the seed's hex
  store.updatePreparedAttack(cast.attack.id, {
    scripted: 'briar',
    responders: [hero.id],
    bound: [made.id, hero.id],
  });
  fx.log('  ' + t('bossLog.elite.seedRoots', { name: unitName(hero) }), BRIAR_GREEN);
}

function landBriar(attack: PreparedAttack, matriarch: CombatUnit, fx: BossFx): void {
  const store = useCombatStore.getState();
  const [seedId, heroId] = attack.bound ?? [];
  const units = useCombatStore.getState().units;
  const seed = seedId ? unitById(units, seedId) : undefined;
  const hero = heroId ? unitById(units, heroId) : undefined;
  const standing = !!seed && seed.currentHp > 0;
  if (seed && standing) store.removeObjective(seed.id);

  if (!standing || !seed) {
    fx.log('  ' + t('bossLog.elite.seedGone'), BRIAR_GREEN);
    return;
  }
  if (!hero || hero.currentHp <= 0 || !poisonedBy(hero, matriarch)) {
    fx.log('  ' + t('bossLog.elite.briarWithers'), BRIAR_GREEN);
    return;
  }
  if (thrallsOf(matriarch, units).length >= BALANCE.BRIAR_THRALL_CAP) {
    fx.log('  ' + t('bossLog.elite.briarEnough'), BRIAR_GREEN);
    return;
  }
  const [thrall] = createEnemyUnits([THRALL_TEMPLATE], [seed.position], 1, scaleOf(matriarch), matriarch.sparedStrength, matriarch.contentLevel);
  if (!thrall) return;
  store.addUnits([{ ...thrall, summonedBy: matriarch.id }]);
  fx.log('  ' + t('bossLog.elite.briarGrows', { name: unitName(thrall) }), BRIAR_GREEN);
  fx.float?.(seed.position, t('bossLog.elite.float.thrallGrows'), BRIAR_GREEN);
}

// ── Ashwood Crone: Witch's Geas ──────────────────────────────────────────────

/**
 * The Crone's answer to a paid cast (`CastRule`): a hero who holds the Geas has just used a
 * skill. A basic attack lifts the curse unspent; anything else still works, and the curse is
 * spent on it — the Crone raises a warned eruption round the hero, with a full window for
 * whoever stands in it. The resolver fires it for every paid cast, like the Writ, so it is one
 * rule whoever is pressing the button.
 */
export const geasCast: CastRule = {
  id: 'geas',
  paid: (caster, skill, _struck, fx) => triggerGeas(caster, skill, fx),
};

function triggerGeas(caster: CombatUnit, skill: HeroSkill, fx: BossFx): void {
  const store = useCombatStore.getState();
  const holder = unitById(store.units, caster.id);
  const geas = holder?.activeEffects.find((e) => e.type === AfflictionType.Geas);
  if (!holder || !geas) return;

  const crone = geas.sourceUnitId ? unitById(store.units, geas.sourceUnitId) : undefined;
  if (isBasicAction(skill)) {
    store.removeEffect(caster.id, AfflictionType.Geas);
    fx.log('  ' + t('bossLog.elite.geasTurned', { name: unitName(caster) }), GEAS_PURPLE);
    return;
  }
  store.removeEffect(caster.id, AfflictionType.Geas);
  if (!crone || crone.currentHp <= 0) return;
  if (!canPrepare(crone.id)) {
    fx.log('  ' + t('bossLog.elite.geasFizzles', { name: unitName(crone) }), GEAS_PURPLE);
    return;
  }
  const eruption: HeroSkill = {
    ...geasEruptionSkill,
    prepares: { interruptedBy: [...INTERRUPTED_BY], windows: 1, answers: [{ kind: 'step' }] },
  };
  const cast = castPrepared(crone, eruption, holder.position, geasFootprint(holder.position), store.units, fx.log);
  if (!cast.ok) return;
  fx.log('  ' + t('bossLog.elite.geasAnswers', { name: unitName(caster) }), GEAS_PURPLE);
  fx.float?.(holder.position, t('bossLog.elite.float.geas'), GEAS_PURPLE);
}

// ── landing ──────────────────────────────────────────────────────────────────

/** Returns true when the warning was landed here, false when the ordinary strike should run. */
export function landEliteWarning(landing: Landing, caster: CombatUnit, fx: BossFx): boolean {
  switch (landing.attack.scripted) {
    case 'undertow':
      landUndertow(landing, caster, fx);
      return true;
    case 'briar':
      landBriar(landing.attack, caster, fx);
      return true;
    default:
      return false;
  }
}

/**
 * What an elite's ordinary strike leaves behind once it has landed: the marsh the
 * Hulk's slam sucks with, the seed the Matriarch's Blight plants. Called by the
 * AI's executor after the strike, so the damage, the taunt and the poison are
 * already on the board when the warning is raised over them.
 */
export function afterEliteStrike(caster: CombatUnit, skill: HeroSkill, fx: BossFx): void {
  const live = unitById(useCombatStore.getState().units, caster.id) ?? caster;
  if (live.currentHp <= 0) return;
  if (skill.id === 'mire_undertow') castUndertow(live, fx);
  if (skill.id === 'briar_blight') plantBriar(live, fx);
  if (skill.id === 'warband_order') callBackup(live, fx);
}

// ── Orc Warchief: Warband Order ──────────────────────────────────────────────

/**
 * An order with nobody to carry it: when no other Orc is standing the Warchief
 * calls a Grunt from the dark beside him, so the order still has someone to act on
 * it. The Grunt is an Orc ally like any other, which is what caps the backup at one
 * living Grunt without a rule of its own — while it stands, the warband is not
 * empty. No free hex means no Grunt, and the order goes out to an empty warband.
 */
export function callBackup(warchief: CombatUnit, fx: BossFx): void {
  const store = useCombatStore.getState();
  const units = store.units;
  if (!canCallBackup(warchief, units)) return;
  const [hex] = findSummonHexes(warchief.position, 1, units);
  if (!hex) {
    fx.log('  ' + t('bossLog.elite.hornNoRoom', { name: unitName(warchief) }), '#ff7a3c');
    return;
  }
  const [grunt] = createEnemyUnits([GRUNT_TEMPLATE], [hex], 1, scaleOf(warchief) * BALANCE.WARBAND_BACKUP_POWER, warchief.sparedStrength, warchief.contentLevel);
  if (!grunt) return;
  store.addUnits([{ ...grunt, summonedBy: warchief.id, isPlayer: warchief.isPlayer, facingAngle: warchief.facingAngle }]);
  fx.log('  ' + t('bossLog.elite.hornAnswered', { name: unitName(warchief) }), '#ff7a3c');
  fx.float?.(hex, t('bossLog.elite.float.gruntAnswers'), '#ff7a3c');
}
