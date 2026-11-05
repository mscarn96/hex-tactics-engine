import { AfflictionType, CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import { getCombatEffectiveStats } from '@/systems/combat/effectiveStats';
import { unitById } from '@/systems/combat/unitLookup';
import { heatAfterQuench, heatAfterTurnBegun } from '@/systems/combat/dragonHeat';
import { castPrepared } from '@/systems/combat/preparedCast';
import { afflictionIntent, launchIntent, strikeDelivery } from '@/systems/combat/soundIntents';
import {
  carriedHeart,
  dragonMoveOfSkill,
  heartCarrier,
  isDragon,
  nextHeartBurn,
  passTargets,
  riftLine,
  skyfireLandingArea,
  skyfireLandingCentre,
  wholeArena,
} from '@/systems/combat/dragonScript';
import { resolveVfxColor } from '@/systems/combat/vfxResolve';
import { skillName } from '@/data/gameText';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { FURNACE_HEART_KIND, passHeart as passHeartSkill } from '@/data/templates/emeraldDragon';
import type { CombatSink } from '@/systems/combat/combatSink';
import { createObjective } from '@/systems/combat/objectives';
import { discAround } from '@/systems/combat/arenaGeometry';

/**
 * The store-writing half of the Emerald Dragon's script.
 *
 * `dragonScript` decides and measures; this puts it on the board. Shared by every
 * driver — the scene, the headless simulator, a harness — because the AI's
 * executor, `beginTurn` and the interrupt path all call it, so a warning raised
 * in the app and one raised in a measured fight are one rule.
 *
 * Nothing here imports the resolver (`skillResolution` is reached from
 * `dragonLanding`, which is the landing half): this file raises warnings and
 * counts his turns, and never strikes.
 */

const WARNING_ORANGE = '#ffaa44';

// ── raising the two warnings with a footprint of their own ───────────────────

/**
 * Raises Cinder Rift or Skyfire.
 *
 * Both fix what they cover *here*, at the cast, and then go through the shared
 * `castPrepared` like every other warning — so the HUD line, the marked hexes,
 * the response window and the landing are the machinery every delayed attack
 * uses. What is new is only where the footprint comes from: a line through the
 * party, or the whole arena with a landing area marked beside it.
 */
export function castDragonMove(boss: CombatUnit, skill: HeroSkill, fx: BossFx): { ok: boolean } {
  const store = useCombatStore.getState();
  const units = store.units;
  const move = dragonMoveOfSkill(skill);

  let hexes: HexCoord[];
  let aim: HexCoord;
  let landing: HexCoord[] | undefined;

  switch (move) {
    case 'rift': {
      const plan = riftLine(boss, units);
      if (!plan || plan.hexes.length === 0) return { ok: false };
      hexes = plan.hexes;
      aim = plan.hexes[Math.floor(plan.hexes.length / 2)];
      fx.log('  ' + t('bossLog.dragon.rift', { name: unitName(boss) }), WARNING_ORANGE);
      break;
    }
    case 'heart':
      return throwHeart(boss, skill, fx);
    case 'skyfire': {
      const centre = skyfireLandingCentre(boss, units, store.hazards);
      if (!centre) return { ok: false };
      aim = centre;
      hexes = wholeArena();
      landing = skyfireLandingArea(centre);
      fx.log('  ' + t('bossLog.dragon.skyfire', { name: unitName(boss), skill: skillName(skill) }), '#ff6644');
      break;
    }
    default:
      return { ok: false };
  }

  const cast = castPrepared(unitById(units, boss.id) ?? boss, skill, aim, hexes, units, fx.log);
  if (!cast.ok) return { ok: false };
  if (landing) store.updatePreparedAttack(cast.attack.id, { landing });

  // The change of stance: the caster's own motion, nothing struck. The marked
  // ground is drawn by the board from the warning itself.
  fx.vfx?.({
    kind: 'nova', delivery: 'spell',
    casterId: boss.id,
    casterPos: boss.position,
    targetCoord: boss.position,
    hitUnitIds: [],
    hitCoords: [],
    color: resolveVfxColor(skill),
    durationScale: 0.6,
  });
  fx.sound?.(launchIntent(boss, skill, strikeDelivery(skill, boss)));
  return { ok: true };
}

// ── the Furnace Heart ────────────────────────────────────────────────────────

/**
 * He throws the Heart onto the healthiest hero (`heartCarrier`): the warning is the burst round them,
 * owed five rounds by the whole party and carried (`PreparedSpec.carried`), so it follows them, and the
 * crystal rides on them, last in `units` so a lookup by their hex finds the hero. The carrier is Seared
 * (`DRAGON_HEART_HEAL_CUT` less healing) for as long as they hold it, with no turns kept yet.
 */
function throwHeart(boss: CombatUnit, skill: HeroSkill, fx: BossFx): { ok: boolean } {
  const store = useCombatStore.getState();
  const carrier = heartCarrier(store.units);
  if (!carrier) return { ok: false };
  const caster = unitById(store.units, boss.id) ?? boss;
  const hexes = discAround(carrier.position, skill.aoeRadius ?? BALANCE.DRAGON_HEART_RADIUS);
  const cast = castPrepared(caster, skill, carrier.position, hexes, store.units, fx.log);
  if (!cast.ok) return { ok: false };
  store.updatePreparedAttack(cast.attack.id, { scripted: 'heart', bound: [carrier.id] });

  const crystal = createObjective({
    kind: FURNACE_HEART_KIND,
    owner: caster,
    position: { ...carrier.position },
    hp: Math.max(1, Math.round(caster.stats.maxHp * BALANCE.DRAGON_HEART_HP)),
    shattersOnPhase: false,
    linkedPreparedId: cast.attack.id,
    backlash: BALANCE.DRAGON_HEART_BACKLASH,
    carrierId: carrier.id,
  });
  store.addUnits([crystal]);
  store.applyEffect(carrier.id, {
    type: AfflictionType.Seared,
    magnitude: BALANCE.DRAGON_HEART_HEAL_CUT,
    duration: -1,
    stacks: 0,
    sourceUnitId: crystal.id,
  });
  fx.log('  ' + t('bossLog.dragon.heartThrown', { name: unitName(caster), target: unitName(carrier) }), WARNING_ORANGE);
  fx.vfx?.({
    kind: 'bolt', delivery: 'spell',
    casterId: boss.id,
    casterPos: boss.position,
    targetCoord: carrier.position,
    hitUnitIds: [carrier.id],
    hitCoords: [carrier.position],
    color: resolveVfxColor(skill),
  });
  fx.sound?.(launchIntent(boss, skill, strikeDelivery(skill, boss)));
  return { ok: true };
}

/**
 * Pass the Heart: `giver` hands it to `other`, or takes it from them when `other` carries it. The crystal
 * and the burst move to the new carrier, and its Seared with them, its count of turns kept back to none, so
 * the burn starts again from its first step (`combatStore.carryObjective`); the countdown keeps running.
 * Refused (`ok: false`) when the pass is not legal now (`passTargets`).
 */
export function passHeart(giver: CombatUnit, other: CombatUnit, fx: BossFx): { ok: boolean } {
  const store = useCombatStore.getState();
  if (!passTargets(giver, store.units).some((u) => u.id === other.id)) return { ok: false };
  const from = carriedHeart(giver, store.units) ? giver : other;
  const to = from.id === giver.id ? other : giver;
  const crystal = carriedHeart(from, store.units);
  if (!crystal) return { ok: false };
  store.carryObjective(crystal.id, to.id);
  fx.log('  ' + t('bossLog.dragon.heartPassed', { from: unitName(from), to: unitName(to) }), WARNING_ORANGE);
  fx.float?.(to.position, t('bossLog.dragon.float.passed'), '#ff8a1e');
  // The throw, from the hand that let it go to the one that caught it
  fx.vfx?.({
    kind: 'bolt', delivery: 'thrown',
    casterId: from.id,
    casterPos: from.position,
    targetCoord: to.position,
    hitUnitIds: [],
    hitCoords: [to.position],
    color: resolveVfxColor(passHeartSkill),
  });
  fx.sound?.(launchIntent(from, passHeartSkill, 'thrown'));
  return { ok: true };
}

/**
 * The Heart's burn: its carrier takes fire as each of their regular turns begins, `DRAGON_HEART_BURN` of
 * his magic on the first and `DRAGON_HEART_BURN_STEP` more for each turn the same hero has kept it
 * (`Seared.stacks`, reset by a pass). A burn that fells the carrier sets the Heart off at once on their hex
 * (`resolveFallenCarriers`). Nothing while his Heart is not on them, or once he has fallen.
 */
export function burnHeartCarrier(unitId: string, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const carrier = unitById(store.units, unitId);
  if (!carrier || carrier.currentHp <= 0) return;
  const crystal = carriedHeart(carrier, store.units);
  const dragon = crystal?.objective ? unitById(store.units, crystal.objective.ownerId) : undefined;
  if (!crystal || !dragon || dragon.currentHp <= 0) return;
  const kept = carrier.activeEffects.find((e) => e.type === AfflictionType.Seared)?.stacks ?? 0;
  const amount = nextHeartBurn(dragon, carrier, store.units);
  const result = store.damageUnit(carrier.id, amount, dragon.id, { difficultyApplied: true });
  sink.sound?.(afflictionIntent(carrier, AfflictionType.Burn));
  sink.float(carrier.position, `-${result.hpLost}`, '#ff6a1e');
  sink.log('  ' + t('bossLog.dragon.heartBurns', { name: unitName(carrier) }) + ` -${result.hpLost}`, '#ff8a1e');
  for (const ev of result.deathEvents ?? []) {
    const who = unitById(useCombatStore.getState().units, ev.unitId);
    if (!who) continue;
    sink.log(`  ${unitName(who)} ${ev.log ?? ev.text}`, ev.color);
    sink.float(who.position, ev.text, ev.color);
  }
  // One more turn kept: the next burn is a step hotter
  useCombatStore.setState((s) => ({
    units: s.units.map((u) => (u.id === carrier.id
      ? { ...u, activeEffects: u.activeEffects.map((e) => (e.type === AfflictionType.Seared ? { ...e, stacks: kept + 1 } : e)) }
      : u)),
  }));
}


// ── turn start ───────────────────────────────────────────────────────────────

/**
 * What his own regular turn beginning does before he chooses anything: his heat
 * climbs a step. The turn itself is counted after (`bossRegistry.turnBegun`), which
 * is what keeps Skyfire from being the first thing he does.
 */
export function beginDragonTurn(unitId: string): void {
  const store = useCombatStore.getState();
  const boss = unitById(store.units, unitId);
  if (!boss || boss.currentHp <= 0 || !isDragon(boss)) return;
  store.patchBossScript(unitId, { heat: heatAfterTurnBegun(boss) });
}

// ── a broken launch, a sprawled landing ──────────────────────────────────────

/** Knocks his heat down (`heatAfterQuench`): the sprawl's half of a quench; a broken warning does it in the store. */
export function quenchDragon(bossId: string): void {
  const store = useCombatStore.getState();
  store.patchBossScript(bossId, { heat: heatAfterQuench(unitById(store.units, bossId)) });
}

/**
 * Leaves him exposed: his Defence falls by `DRAGON_EXPOSED_DEFENSE` of what it is now, counted in his
 * own turns, laid for two so it survives the start of his next turn and ends at the one after.
 */
export function exposeDragon(boss: CombatUnit, fx: Pick<BossFx, 'log'>): void {
  const defense = getCombatEffectiveStats(boss).defense;
  const magnitude = Math.max(1, Math.round(defense * BALANCE.DRAGON_EXPOSED_DEFENSE));
  useCombatStore.getState().applyEffect(boss.id, {
    type: AfflictionType.DefenseDown,
    magnitude,
    duration: 2,
    sourceUnitId: boss.id,
  });
  fx.log('  ' + t('bossLog.dragon.exposed', { name: unitName(boss) }), '#ffdd66');
}

/**
 * Skyfire was interrupted: he is left exposed, and his fire is quenched (the store set his heat
 * back when the warning broke).
 *
 * His Defence falls by `DRAGON_EXPOSED_DEFENSE` of what it is now, counted in his
 * own turns: the effect is laid for two, so it survives the start of his next
 * turn and ends at the one after — through the rest of this round of heroes, his
 * turn and the whole of the next round, which is one full hero window **even for
 * the hero who broke it and acts last**. A broken launch grants nothing else: no
 * crash, no extra stun beyond what the interrupt itself did.
 */
export function onDragonInterrupted(attack: PreparedAttack, boss: CombatUnit, fx: Pick<BossFx, 'log'>): void {
  if (attack.skill.id !== 'skyfire' || !isDragon(boss)) return;
  exposeDragon(boss, fx);
  fx.log('  ' + t('bossLog.dragon.quenched', { name: unitName(boss) }), '#ffdd66');
}
