import { ActiveEffect, AfflictionType, AuraType, CombatUnit, StatusEffectType } from '@/models/types';
import { difficultyDamage } from '@/systems/combat/runDifficulty';
import { unitById } from '@/systems/combat/unitLookup';
import { combatMaxHp } from '@/systems/combat/forms';
import { healingReceived, isHeldFromHarm, poisonTickDamage } from '@/systems/combat/statusEffects';
import { t } from '@/i18n';
import { thawVfx } from '@/systems/combat/iceBreak';
import { skillVoice } from '@/data/display/skillSounds';
import { afflictionIntent, mendIntent } from '@/systems/combat/soundIntents';
import { STATUS_DISPLAY, resourceColor } from '@/data/display/statusDisplay';
import { resourceShort } from '@/data/classResource';
import { FLOAT_COLOR } from '@/data/display/floatColors';
import { dotDefenceFactor } from '@/systems/combat/damageCalc';
import {
  creditFightStats,
  DOT_ENEMY_STATS_ID,
  DOT_PLAYER_STATS_ID,
  eliteBeat,
  TickEvent,
} from '@/systems/combat/combatTypes';
import {
  DamageFollow,
  FunnelData,
  FunnelOps,
  settleDamage,
  takeDamage,
} from '@/systems/combat/damageFunnel';

/**
 * One unit's start-of-turn tick: its statuses count down, its damage over time
 * is paid and its healing over time lands.
 *
 * **It owes damage to the funnel, not to a second copy of the rules.** Every dose
 * — a Burn, a Bleed, a Poison pile, a Doom expiring — is `takeDamage` with
 * `fromTick`, so Last Stand, the Reckoning, the Barrier and the lethal save are
 * the funnel's and exist nowhere else; a poison tick through a Barrier gives the
 * numbers a strike through it does. What is left here is what only a tick does:
 * the sequence of statuses, the healing, the mana, the duration countdown, and
 * the one atomic write.
 *
 * The tick folds over a private copy of the state, so the unit it changes is
 * written once, however many doses it paid. Whatever its doses set in motion
 * reaches other units — a Martyr seal, a broken Reckoning, a phase, a death — and
 * runs afterwards, on the written state, through the same `settleDamage` a blow
 * uses.
 */

export interface TickOps extends FunnelOps {
  detonateMartyrSeal(unitId: string, seal: ActiveEffect): TickEvent[];
  sweepBladeStorm(unitId: string, storm: ActiveEffect): TickEvent[];
  /** Meditate's payout, when its aura expires (`systems/combat/meditate`). */
  payMeditation(unitId: string): TickEvent[];
}

export interface TickHost {
  get(): FunnelData & TickOps;
  set(patch: Partial<FunnelData>): void;
}

const DOT_COLORS: Partial<Record<StatusEffectType, string>> = {
  [AfflictionType.Poison]: FLOAT_COLOR.poison,
  [AfflictionType.Bleed]: FLOAT_COLOR.bleed,
  [AfflictionType.Burn]: '#ff8844',
};

export function tickEffects(host: TickHost, unitId: string): TickEvent[] {
  const events: TickEvent[] = [];
  const unit = unitById(host.get().units, unitId);
  if (!unit) return events;

  const start = host.get();
  let work: FunnelData = {
    units: start.units,
    fightStats: start.fightStats,
    reactions: start.reactions,
    reactionEvents: start.reactionEvents,
    answeringReaction: start.answeringReaction,
  };
  const current = (): CombatUnit => unitById(work.units, unitId) ?? unit;
  const patchUnit = (fields: Partial<CombatUnit>) => {
    work = { ...work, units: work.units.map((u) => (u.id === unitId ? { ...u, ...fields } : u)) };
  };

  const isInvulnerable = isHeldFromHarm(unit.activeEffects);
  const follows: DamageFollow[] = [];
  let mana = unit.currentMana;
  const dotRow = unit.isPlayer ? DOT_ENEMY_STATS_ID : DOT_PLAYER_STATS_ID;

  /**
   * Whose report row a tick is credited to: the unit that laid it, when it is
   * still in the fight (or already has a row, having died), else the side's pooled
   * damage-over-time row. A status the unit laid on itself is nobody's damage dealt.
   */
  const creditFor = (sourceId: string | undefined): string =>
    sourceId && sourceId !== unitId && (unitById(work.units, sourceId) || work.fightStats[sourceId])
      ? sourceId
      : dotRow;

  /**
   * One dose of damage-over-time through the funnel; what it cost and what a shield
   * ate. `tick` names the row a tick is credited to; Doom (no `tick`) is credited
   * to nobody, as before.
   */
  const dose = (raw: number, tick?: { creditTo: string }) => {
    const { patch, report } = takeDamage(work, unitId, raw, undefined, {
      difficultyApplied: true,
      fromTick: true,
      ...(tick && { creditTo: tick.creditTo }),
    });
    work = { ...work, ...patch };
    // The tick's share of that row's damage, for the harnesses that weigh afflictions
    if (tick) {
      work = { ...work, fightStats: creditFightStats(work.fightStats, [[tick.creditTo, 'dotDealt', report.hpLost + report.absorbed]]) };
    }
    follows.push(report.follow);
    // A save opens its window at once, so a second dose in this same tick meets
    // the floor it set: the rest of the save is paid after the write, by the settle
    // (applying a status twice merges, so the window is not doubled).
    if (report.follow.saved) {
      for (const outcome of report.follow.saveOutcomes) {
        if (outcome.kind === 'effect' && outcome.unitId === unitId) {
          patchUnit({ activeEffects: [...current().activeEffects, outcome.effect] });
        }
      }
    }
    return report;
  };

  // Collected here and spent *after* the write below. The payload lands on
  // other units, and this function's whole contract is that it computes one
  // unit's changes from one snapshot and writes them once.
  let sealToDetonate: ActiveEffect | null = null;
  let stormToSweep: ActiveEffect | null = null;
  let meditationDue = false;

  for (const effect of unit.activeEffects) {
    const dotColor = DOT_COLORS[effect.type];

    // Read on the *incoming* duration, unlike the seal below: the blades are
    // a thing that is happening, not a thing that goes off when it ends, so
    // they bite on every tick they are still up for.
    if (effect.type === AuraType.BladeStorm) stormToSweep = effect;

    // Read on the *outgoing* duration, the same way Doom is, so it fires on
    // the tick that removes the seal and never twice.
    if (effect.type === AuraType.MartyrSeal && effect.duration === 1) sealToDetonate = effect;

    // Meditate pays on the tick that retires its aura, the same reading: the
    // heal and the turn's Attack and Magic land once, at the start of the turn
    // after the stance was taken.
    if (effect.type === AuraType.Meditation && effect.duration === 1) meditationDue = true;

    // A unit a dose already killed has nothing further to pay and nothing further
    // to gain: a heal listed after the dose must not raise the corpse
    const alive = current().currentHp > 0;

    // The last turn of a Winter Sleep: it wakes, at full health. Read on the outgoing
    // duration like the seal above, so the wake happens on the tick that retires the
    // sleep and the Defense laid with it, and never twice.
    if (effect.type === AuraType.Slumber && effect.duration === 1 && alive) {
      patchUnit({ currentHp: Math.max(current().currentHp, combatMaxHp(unit)) });
      // Waking is drawn as rising to full strength: the column a capstone window is
      // drawn with, in frost, so the full bar that follows has a cause on screen
      events.push({
        text: t('combatLog.float.wakesHealed'), log: t('combatLog.tick.wakesFull'), color: '#9ec8ff', unitId,
        vfx: eliteBeat('surge', unitId, unit.position, [unit.position], '#cfe9ff', 'rime'),
      });
    }

    // A Freeze running out on its own, rather than broken by a blow: the ice
    // cracks and melts off, so the unit moving again has a cause on screen
    if (effect.type === AfflictionType.Freeze && effect.duration === 1) {
      events.push({ text: t('combatLog.tick.thaws'), color: STATUS_DISPLAY[AfflictionType.Freeze].color, unitId, vfx: thawVfx(unitId, unit.position) });
    }

    // Doom is the inverse of a DoT: nothing at all while it runs, and all of
    // it the moment it expires. The check is on the *outgoing* duration, so it
    // fires on the tick that would have removed the effect and never twice.
    if (effect.type === AfflictionType.Doom) {
      if (effect.duration === 1 && !isInvulnerable && alive) {
        const report = dose(
          difficultyDamage(Math.round(effect.magnitude), unitById(work.units, effect.sourceUnitId)),
        );
        if (report.net > 0) {
          // A Bell-Keeper's Doom is its Toll of Passing, heard as the toll's last stroke
          const tolled = unitById(work.units, effect.sourceUnitId)?.templateId === 'bell_keeper';
          events.push({
            text: `-${report.net}`, color: '#ff2a3a', unitId,
            sound: afflictionIntent(unit, AfflictionType.Doom, tolled ? skillVoice('toll_of_passing') : undefined),
          });
        }
        if (report.absorbed > 0) events.push({ text: t('combatLog.float.absorbed', { amount: report.absorbed }), log: t('combatLog.tick.absorbed', { amount: report.absorbed }), color: FLOAT_COLOR.barrier, unitId });
      }
    } else if (effect.type === AuraType.HealOverTime && alive) {
      // The Furnace Heart's Seared cuts it as it cuts every heal (`healingReceived`)
      const amount = healingReceived(current(), Math.round(effect.magnitude));
      const hp = current().currentHp;
      // Respects a boss's phase ceiling for the same reason `healUnit` does
      const restored = Math.max(0, Math.min(unit.hpCeiling ?? combatMaxHp(unit), hp + amount) - hp);
      patchUnit({ currentHp: hp + restored });
      work = { ...work, fightStats: creditFightStats(work.fightStats, [[effect.sourceUnitId ?? unitId, 'healingDone', restored]]) };
      if (restored > 0) events.push({ text: `+${restored}`, color: FLOAT_COLOR.heal, unitId, sound: mendIntent(unit) });
      // Last Bloom: on the outgoing duration like the seal above, so it fires on the
      // tick that retires the Regen and a re-cast, which refreshes the clock, never
      // does. Through the same two limits, and like every tick it raises no `onHeal`.
      const bloomShare = effect.duration === 1
        ? unitById(work.units, effect.sourceUnitId)?.masteryModifiers?.hotBloomShare ?? 0
        : 0;
      if (bloomShare > 0) {
        const bloomed = healingReceived(current(), Math.round(effect.magnitude * bloomShare));
        const before = current().currentHp;
        const bloom = Math.max(0, Math.min(unit.hpCeiling ?? combatMaxHp(unit), before + bloomed) - before);
        patchUnit({ currentHp: before + bloom });
        work = { ...work, fightStats: creditFightStats(work.fightStats, [[effect.sourceUnitId ?? unitId, 'healingDone', bloom]]) };
        if (bloom > 0) {
          events.push({
            text: t('combatLog.float.lastBloom', { amount: bloom }), log: t('combatLog.tick.lastBloom', { amount: bloom }),
            color: FLOAT_COLOR.heal, unitId, sound: mendIntent(unit),
          });
        }
      }
    } else if (effect.type === AuraType.ManaRegenOverTime) {
      const amount = Math.round(effect.magnitude);
      mana = Math.min(unit.stats.maxMana, mana + amount);
      events.push({ text: `+${amount} ${resourceShort(unit.resource)}`, color: resourceColor(unit.resource), unitId });
    } else if (dotColor && !isInvulnerable && alive) {
      // Poison pays out on a curve rather than flat — see `poisonTickDamage`. Then
      // the target's defence takes its tick share (`dotDefenceFactor`), then the
      // campaign difficulty an enemy's tick is taken at.
      const source = unitById(work.units, effect.sourceUnitId);
      const authored = effect.type === AfflictionType.Poison ? poisonTickDamage(effect) : effect.magnitude;
      const report = dose(
        difficultyDamage(
          authored > 0 ? Math.max(1, Math.round(authored * dotDefenceFactor(current(), source, effect.type))) : 0,
          source,
        ),
        { creditTo: creditFor(effect.sourceUnitId) },
      );
      if (report.net > 0) {
        events.push({ text: `-${report.net}`, color: dotColor, unitId, sound: afflictionIntent(unit, effect.type) });
      }
      if (report.absorbed > 0) events.push({ text: t('combatLog.float.absorbed', { amount: report.absorbed }), log: t('combatLog.tick.absorbed', { amount: report.absorbed }), color: FLOAT_COLOR.barrier, unitId });
    }
  }

  // Gear regenerates mana at the start of every turn, for as long as it is
  // worn. Here rather than in `beginTurn` because this is the function whose
  // contract is "one unit's changes from one snapshot, written once" — mana
  // already moves in it, and a second writer would be a second chance to drop
  // one of the two updates.
  //
  // After the effect loop, so a `ManaRegenOverTime` aura and a piece of gear
  // both land and neither caps the other out first. Flat, not a percentage:
  // a mage's pool is small and a percentage of it would be worth nothing at
  // the level the stat first appears.
  const regen = Math.round(unit.stats.manaRegen ?? 0);
  if (regen > 0 && mana < unit.stats.maxMana) {
    const gained = Math.min(regen, unit.stats.maxMana - mana);
    mana += gained;
    events.push({ text: `+${gained} ${resourceShort(unit.resource)}`, color: resourceColor(unit.resource), unitId });
  }

  // Count the statuses down. The Barrier and the Reckoning are already what the
  // doses left of them (the funnel drained, or removed, them); a status the
  // doses opened — the spent mark of a lethal save — has not aged yet.
  const hadSpentMark = unit.activeEffects.some((e) => e.type === AuraType.UndyingSpent);
  const aged: ActiveEffect[] = [];
  // A Reckoning that runs out on this very tick is released like one a blow broke
  const released: ActiveEffect[] = [];
  for (const effect of current().activeEffects) {
    if (effect.type === AuraType.UndyingSpent && !hadSpentMark) {
      aged.push(effect);
    } else if (effect.type === AfflictionType.DeathMark) {
      // A Death Mark's clock is its source's turns — see `assassination`
      aged.push(effect);
    } else if (effect.duration !== -1 && effect.duration !== 99) {
      const duration = effect.duration - 1;
      if (duration > 0) aged.push({ ...effect, duration });
      else if (effect.type === AuraType.Reckoning) released.push(effect);
      // duration reaches 0 → drop the effect
    } else {
      aged.push(effect);
    }
  }
  patchUnit({ currentMana: mana, activeEffects: aged });

  // Single atomic write — no intermediate set() calls
  host.set({
    units: host.get().units.map((u) => (u.id === unitId ? current() : u)),
    fightStats: work.fightStats,
  });

  // The Martyr goes off, on its own store write. Same shape as the phase
  // check below: something that has to touch state this function deliberately
  // does not, run once the atomic write has landed.
  if (sealToDetonate) events.push(...host.get().detonateMartyrSeal(unitId, sealToDetonate));
  for (const spent of released) events.push(...host.get().releaseReckoning(unitId, spent));
  if (stormToSweep) events.push(...host.get().sweepBladeStorm(unitId, stormToSweep));
  // After the countdown, so the buffs it lays are this turn's and not aged by it
  if (meditationDue && current().currentHp > 0) events.push(...host.get().payMeditation(unitId));

  // What the doses set in motion, on the written state: a save that fired pays
  // out as one a blow caught does, a boss burned or Doomed past a threshold
  // changes phase like anything else, and a unit a tick killed dies the way every
  // other unit dies. The piles it carried are passed along because the final tick
  // may have dropped them from the corpse.
  const settled = settleDamage(host, unitId, undefined, follows, {
    knownBurn: unit.activeEffects.find((e) => e.type === AfflictionType.Burn),
    knownPoison: unit.activeEffects.find((e) => e.type === AfflictionType.Poison),
    knownMark: unit.activeEffects.find((e) => e.type === AfflictionType.Mark),
  });
  if (settled.phaseEntered) events.push({ text: settled.phaseEntered, color: '#ff2a3a', unitId });
  events.push(...settled.events);
  return events;
}
