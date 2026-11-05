import { BALANCE } from '@/data/balanceConstants';
import { AfflictionType, AuraType, CombatUnit, HeroSkill, HexCoord, SkillTargetType, SoundIntent, VfxSpec } from '@/models/types';
import { TickEvent, useCombatStore } from '@/stores/combatStore';
import { inArena } from '@/systems/combat/arenaGeometry';
import { unitById } from '@/systems/combat/unitLookup';
import { inDuelCircle } from '@/systems/combat/duelRules';
import { moveIntent, strikeDetail, strikeIntent } from '@/systems/combat/soundIntents';
import { executeThresholdHp, isRooted } from '@/systems/combat/statusEffects';
import { getNeighbors, hexDistance } from '@/utils/hexUtils';
import { t } from '@/i18n';
import { skillName } from '@/data/gameText';
import { unitName } from '@/data/templates/unitText';

/**
 * Assassinate's Death Mark (Shadowblade remaster, 2026-10): a delayed, automatic
 * execution.
 *
 * The cast marks one enemy anywhere on the field and deals nothing. While marked
 * it takes `DEATH_MARK_BONUS` more direct damage from every attacker
 * (`damageCalc.deathMarkMultiplier`). At the start of each of the caster's **regular** turns,
 * once the caster can act (a Stun, Freeze or sleep skips the check; the mark still
 * counts down), the mark is read once: a victim at or below the caster's execution
 * threshold (`executeThresholdHp`, the shared window at full width) is blinked to and
 * finished before the caster's normal action, which is kept. Otherwise the mark
 * counts one turn down and fades after `DEATH_MARK_TURNS` checks.
 *
 * The finishing blow is an execution, not a roll: it takes the victim's remaining
 * health and Barrier, cannot be dodged and does not crit. What protects a unit from
 * dying still does — Invulnerability, a once-per-battle save, a boss's phase line —
 * because those are the rules of that unit, not of the strike. The mark is spent the
 * moment the execution begins, so nothing retries it. A kill hides the Shadowblade
 * (Stealth, as the old Assassinate's kill did). No life steal, no on-kill passives.
 *
 * With no free hex beside the victim (or Rooted away from it) the execution waits
 * for a later turn rather than landing anywhere else; an untargetable victim waits
 * too. One mark per caster: a recast moves it. The caster falling removes its marks
 * (`combatStore.retireOwned`), and the victim falling takes its mark with it.
 */

/** The mark's purple: the ring, the sigil and the strike. */
export const DEATH_MARK_COLOR = '#b04dff';

/** The finishing blow, as the picture and the impact clock know it. Never on a bar. */
export const assassinateStrike: HeroSkill = {
  id: 'assassinate_strike', textId: 'assassinate',
  targetType: SkillTargetType.Single, range: 1, damage: 0,
  unlockLevel: 5, manaCost: 0, vfxColor: DEATH_MARK_COLOR, vfxKind: 'slash', vfxPrelude: 'aim',
};

/** The channels the execution reports through: the `CombatSink` subset it uses. */
export interface DeathMarkSink {
  log: (text: string, color: string) => void;
  float: (at: HexCoord, text: string, color: string) => void;
  vfx: (spec: VfxSpec) => void;
  sound?: (intent: SoundIntent) => void;
  lands?: (skill: HeroSkill, from: HexCoord, to: HexCoord) => void;
}

/** The Death Mark `ownerId` laid on this unit, if any. */
export function deathMarkFrom(unit: CombatUnit, ownerId?: string) {
  return unit.activeEffects.find((e) => e.type === AfflictionType.DeathMark && (!ownerId || e.sourceUnitId === ownerId));
}

/** The health at or below which `owner` executes `victim`: the shared window at full width. */
export function deathMarkThreshold(owner: CombatUnit, victim: CombatUnit): number {
  return executeThresholdHp(owner, victim);
}

/** Whether `owner` would execute `victim` if its turn began now (health alone). */
export function deathMarkEligible(owner: CombatUnit, victim: CombatUnit): boolean {
  return victim.currentHp > 0 && victim.currentHp <= deathMarkThreshold(owner, victim);
}

/**
 * Where the blink lands: the caster's own hex when it already stands beside the
 * victim, else the free hex beside the victim nearest the caster (ties by
 * coordinate). Undefined when there is none, or when Root holds a caster that
 * is not already beside it.
 */
export function deathMarkLanding(owner: CombatUnit, victim: CombatUnit, units: CombatUnit[]): HexCoord | undefined {
  if (hexDistance(owner.position, victim.position) === 1) return owner.position;
  if (isRooted(owner)) return undefined;
  const hazards = useCombatStore.getState().hazards;
  const free = (h: HexCoord) => inArena(h) && inDuelCircle(owner, h)
    && !units.some((u) => u.id !== owner.id && u.currentHp > 0 && u.position.q === h.q && u.position.r === h.r)
    && !hazards.some((z) => z.solid && z.hexes.some((x) => x.q === h.q && x.r === h.r));
  return getNeighbors(victim.position)
    .filter(free)
    .sort((a, b) => hexDistance(owner.position, a) - hexDistance(owner.position, b) || a.q - b.q || a.r - b.r)[0];
}

/**
 * Puts `owner`'s Death Mark on `victimId`, moving it off any unit it marked before.
 * Returns whether the mark landed (a debuff-immune or dead unit takes none).
 */
export function markForDeath(owner: CombatUnit, victimId: string): boolean {
  const store = useCombatStore.getState();
  useCombatStore.setState((s) => ({
    units: s.units.map((u) => u.id !== victimId && deathMarkFrom(u, owner.id)
      ? { ...u, activeEffects: u.activeEffects.filter((e) => !(e.type === AfflictionType.DeathMark && e.sourceUnitId === owner.id)) }
      : u),
  }));
  store.applyEffect(victimId, {
    type: AfflictionType.DeathMark, magnitude: BALANCE.DEATH_MARK_BONUS,
    duration: BALANCE.DEATH_MARK_TURNS, sourceUnitId: owner.id,
  });
  const victim = unitById(useCombatStore.getState().units, victimId);
  return !!victim && !!deathMarkFrom(victim, owner.id);
}

function dropMark(victimId: string, ownerId: string): void {
  useCombatStore.setState((s) => ({
    units: s.units.map((u) => u.id === victimId
      ? { ...u, activeEffects: u.activeEffects.filter((e) => !(e.type === AfflictionType.DeathMark && e.sourceUnitId === ownerId)) }
      : u),
  }));
}

/**
 * The start-of-turn check for `ownerId`'s marks, once the owner is able to act.
 * Executes an eligible victim (blink, finishing blow, Stealth on a kill) or counts
 * the mark down. Returns the death events the blow produced, for the driver to play.
 */
export function resolveDeathMarks(ownerId: string, sink: DeathMarkSink): TickEvent[] {
  const events: TickEvent[] = [];
  const store = useCombatStore.getState();
  const owner = unitById(store.units, ownerId);
  if (!owner || owner.currentHp <= 0 || owner.seized) return events;
  for (const victim of store.units.filter((u) => deathMarkFrom(u, ownerId))) {
    const mark = deathMarkFrom(victim, ownerId)!;
    if (victim.currentHp <= 0) { dropMark(victim.id, ownerId); continue; }
    const live = unitById(useCombatStore.getState().units, ownerId) ?? owner;
    const landing = !victim.untargetable && deathMarkEligible(live, victim)
      ? deathMarkLanding(live, victim, useCombatStore.getState().units) : undefined;
    if (landing) {
      events.push(...execute(live, victim, landing, sink));
      continue;
    }
    if (deathMarkEligible(live, victim)) sink.log('  ' + t('bossLog.assassinate.cannotReach', { name: unitName(live), target: unitName(victim) }), DEATH_MARK_COLOR);
    const left = mark.duration - 1;
    if (left <= 0) {
      dropMark(victim.id, ownerId);
      sink.log('  ' + t('bossLog.assassinate.fades', { name: unitName(victim) }), DEATH_MARK_COLOR);
    } else {
      useCombatStore.setState((s) => ({
        units: s.units.map((u) => u.id === victim.id
          ? { ...u, activeEffects: u.activeEffects.map((e) => e === mark || (e.type === AfflictionType.DeathMark && e.sourceUnitId === ownerId) ? { ...e, duration: left } : e) }
          : u),
      }));
    }
  }
  return events;
}

function execute(owner: CombatUnit, victim: CombatUnit, landing: HexCoord, sink: DeathMarkSink): TickEvent[] {
  const store = useCombatStore.getState();
  // Spent first: nothing below can retry it
  dropMark(victim.id, owner.id);
  const from = owner.position;
  if (landing.q !== from.q || landing.r !== from.r) {
    store.moveUnit(owner.id, landing, 'walk');
    sink.sound?.(moveIntent(owner.id, from, landing, 'blink'));
  }
  store.setFacing(owner.id, victim.position);
  sink.lands?.(assassinateStrike, landing, victim.position);
  sink.log(`${unitName(owner)}: ${skillName(assassinateStrike)}`, '#ffffff');
  sink.vfx({
    kind: 'slash', delivery: 'blade', prelude: 'aim', casterId: owner.id, casterPos: landing, targetCoord: victim.position,
    hitUnitIds: [victim.id], hitCoords: [victim.position], color: DEATH_MARK_COLOR, durationScale: 1.2,
  });
  const barrier = victim.activeEffects.filter((e) => e.type === AuraType.Barrier).reduce((t, e) => t + e.magnitude, 0);
  const result = store.damageUnit(victim.id, victim.currentHp + barrier, owner.id, { difficultyApplied: true });
  sink.sound?.(strikeIntent(victim, 'blade', result.hpLost > 0 ? 'crit' : 'blocked', undefined, undefined, strikeDetail(undefined, result, { skillId: 'assassinate' })));
  sink.float(victim.position, result.hpLost > 0 ? `-${result.hpLost}` : t('bossLog.assassinate.float.protected'), DEATH_MARK_COLOR);
  const after = unitById(useCombatStore.getState().units, victim.id);
  if (after && after.currentHp <= 0) {
    sink.log('  ' + t('bossLog.assassinate.executes', { name: unitName(owner), target: unitName(victim) }), DEATH_MARK_COLOR);
    store.applyEffect(owner.id, { type: AuraType.Stealth, magnitude: 1, duration: BALANCE.STEALTH_DURATION, sourceUnitId: owner.id });
  } else {
    sink.log('  ' + t('bossLog.assassinate.survives', { name: unitName(victim) }), DEATH_MARK_COLOR);
  }
  return result.deathEvents ?? [];
}
