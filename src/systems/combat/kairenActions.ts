import { AfflictionType, AuraType, CombatUnit, HeroSkill, HexCoord, KairenMemory, PreparedAttack, SkillGesture, SkillTargetType } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import {
  broodOfTheOrb, cloudDive, galeDowndraft, KAIREN_JADE, KAIREN_STORM, orbNova, thunderhead, verdantJudgement,
} from '@/data/templates/kairen';
import { useCombatStore } from '@/stores/combatStore';
import { unitById } from '@/systems/combat/unitLookup';
import { createPreparedAttack, isPreparedDue, preparedBy, resolvedSkill } from '@/systems/combat/preparedAttacks';
import { createObjective } from '@/systems/combat/objectives';
import { createSummonUnits } from '@/systems/combat/summoning';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';
import type { Landing } from '@/systems/combat/encounterScript';
import { skillLogIcon } from '@/systems/combat/combatSink';
import { playTickEvents } from '@/systems/combat/tickEvents';
import { launchIntent, strikeDelivery, supportIntent } from '@/systems/combat/soundIntents';
import { difficultyMultipliers } from '@/systems/combat/runDifficulty';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import {
  BROOD_TEMPLATE_ID, broodCount, broodSpots, diveLanding, divePlan,
  downdraftHexes, galeDistance, isAloft, isKairen, KairenMove, kairenMemory, novaRing, orbBoltCount, orbBoltTargets, SHARD_KIND,
  shardSpots, shardsOf, stormMarks, taintOf, tierOf, verdantMultiplier, weatherName, windFor, windMoves, windName,
} from '@/systems/combat/kairenRules';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { skillName } from '@/data/gameText';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { heroesOf } from '@/systems/combat/targetLegality';

/**
 * Jadeveil: Kairen — the store-writing half of his fight.
 *
 * `kairenRules` decides where everything falls; this puts it on the board, for every
 * driver (the scene, the headless simulator, the harness): raising his warnings, the
 * weather turning with his phase, the storm's marks, the brood, the shards, and landing each warning from
 * the footprint it showed. Each landing reads the same rule its warning was drawn from,
 * at the moment it lands, so the board and the blow cannot disagree.
 */

const K = BALANCE.KAIREN;
type Fx = CombatSink;

const live = (id: string): CombatUnit | undefined => unitById(useCombatStore.getState().units, id);

function patchMemory(boss: CombatUnit, patch: Partial<KairenMemory>): void {
  const now = live(boss.id) ?? boss;
  useCombatStore.getState().patchBossScript(boss.id, { kairen: { ...kairenMemory(now), ...patch } });
}

function markUsed(boss: CombatUnit, move: string, extra: Partial<KairenMemory> = {}): void {
  const mem = kairenMemory(live(boss.id) ?? boss);
  patchMemory(boss, { lastUsed: { ...mem.lastUsed, [move]: mem.turns }, ...extra });
}

const later = (sink: CombatSink, delayMs: number): CombatSink => ({
  ...sink,
  vfx: (spec) => sink.vfx({ ...spec, delayMs: (spec.delayMs ?? 0) + delayMs }),
});

/**
 * Raises one of his warnings. The shared `createPreparedAttack` fixes the footprint and
 * who owes a window — the same machinery every warning uses — but not `castPrepared`'s
 * one-at-a-time refusal: the storm's marks ride beside his warned moves, and his own
 * chooser keeps the warned moves one at a time (`MAJOR_WARNINGS`).
 */
export function castKairenWarning(
  boss: CombatUnit,
  skill: HeroSkill,
  aim: HexCoord,
  hexes: HexCoord[],
  extra: Partial<PreparedAttack>,
  fx: Fx,
  quiet = false,
): PreparedAttack {
  const store = useCombatStore.getState();
  const attack = { ...createPreparedAttack(boss, skill, aim, hexes, store.units), ...extra };
  store.addPreparedAttack(attack);
  if (!quiet) {
    fx.log(t('bossLog.prepares', { name: unitName(boss), skill: skillName(skill) }), '#ffaa44');
    if (hexKey(aim) !== hexKey(boss.position)) store.setFacing(boss.id, aim);
  }
  return attack;
}

/**
 * An Orb Bolt, cast from his script: at the hero his turn chose and, from tier 2 (the
 * tier's twist), at the next least tainted hero in reach a beat later, each struck as an
 * ordinary bolt. Both are chosen before the first lands, so the bolt's own Taint cannot
 * turn the second back onto the first. False when the first could not be cast.
 */
export function castOrbBolt(boss: CombatUnit, skill: HeroSkill, target: HexCoord, fx: Fx): boolean {
  const caster = live(boss.id) ?? boss;
  const units = useCombatStore.getState().units;
  const first = units.find((u) => u.currentHp > 0 && hexKey(u.position) === hexKey(target));
  const more = orbBoltTargets(caster, heroesOf(units).filter((u) => u.id !== first?.id), K.ORB_BOLT_RANGE, orbBoltCount(tierOf(caster)) - 1);
  if (!resolveSkillUse(caster, skill, target, fx).ok) return false;
  more.forEach((hero, i) => {
    const now = live(hero.id);
    const striker = live(boss.id);
    if (!now || now.currentHp <= 0 || !striker || striker.currentHp <= 0) return;
    resolveSkillUse(striker, skill, now.position, later(fx, (i + 1) * 350), { resolving: true });
  });
  return true;
}

/** His warned moves and his brood, made now. False when the board gave the move nothing to do. */
export function castKairenMove(boss: CombatUnit, move: KairenMove, fx: Fx): boolean {
  const store = useCombatStore.getState();
  const caster = live(boss.id) ?? boss;
  const tier = tierOf(caster);
  const mem = kairenMemory(caster);
  switch (move) {
    case 'gale': {
      const wind = windFor(mem.gales);
      castKairenWarning(caster, galeDowndraft, caster.position, [], {
        scripted: 'kairen_gale',
        wind,
        windDistance: galeDistance(tier),
        landing: downdraftHexes(wind, store.hazards),
      }, fx);
      fx.log('  ' + t('bossLog.kairen.windTurns', { direction: windName(wind) }), '#d8e6ee');
      markUsed(caster, 'gale', { gales: mem.gales + 1 });
      fx.vfx?.(stance(caster, '#d8e6ee'));
      return true;
    }
    case 'dive': {
      const plan = divePlan(caster, store.units, store.hazards);
      if (!plan) return false;
      castKairenWarning(caster, cloudDive, plan.end, plan.hexes, { scripted: 'kairen_dive' }, fx);
      store.applyEffect(caster.id, { type: AuraType.Aloft, magnitude: 1, duration: -1, sourceUnitId: caster.id });
      fx.log('  ' + t('bossLog.kairen.rises', { name: unitName(caster) }), KAIREN_STORM);
      fx.status?.(caster.position, t('bossLog.kairen.float.clouds'), KAIREN_STORM);
      markUsed(caster, 'dive');
      return true;
    }
    case 'verdant': {
      castKairenWarning(caster, verdantJudgement, caster.position, [], { scripted: 'kairen_verdant' }, fx);
      fx.log('  ' + t('bossLog.kairen.verdant'), KAIREN_JADE);
      markUsed(caster, 'verdant');
      fx.vfx?.(stance(caster, KAIREN_JADE));
      return true;
    }
    case 'nova': {
      castKairenWarning(caster, orbNova, caster.position, novaRing(caster, store.hazards), { scripted: 'kairen_nova' }, fx);
      fx.log('  ' + t('bossLog.kairen.nova'), KAIREN_JADE);
      markUsed(caster, 'nova');
      fx.vfx?.(stance(caster, KAIREN_JADE));
      return true;
    }
    case 'brood':
      return summonBrood(caster, fx) > 0;
    default:
      return false;
  }
}

function stance(boss: CombatUnit, color: string) {
  return {
    kind: 'nova' as const, delivery: 'spell' as const,
    casterId: boss.id, casterPos: boss.position, targetCoord: boss.position,
    hitUnitIds: [], hitCoords: [], color, durationScale: 0.6,
  };
}

/** The level the boss was scaled to, recovered from its stats — the brood is scaled to match. */
function scaleLevel(boss: CombatUnit): number {
  if (boss.enemyStatScale !== undefined) return Math.max(1, 1 + (boss.enemyStatScale - 1) / BALANCE.ENEMY_LEVEL_SCALE);
  const base = enemyTemplates.find((t) => t.id === boss.templateId)?.baseStats.maxHp ?? 0;
  if (base <= 0) return 1;
  return Math.max(1, 1 + (boss.stats.maxHp / (base * difficultyMultipliers(undefined, boss.sparedStrength).hp) - 1) / BALANCE.ENEMY_LEVEL_SCALE);
}

/** Brood of the Orb: wyrmlings out of the clouds, spread round the arena. Returns how many came. */
export function summonBrood(boss: CombatUnit, fx: Fx): number {
  const store = useCombatStore.getState();
  const tier = tierOf(boss);
  const spots = broodSpots(boss, store.units, store.hazards, broodCount(tier));
  const brood = createSummonUnits({ templateId: BROOD_TEMPLATE_ID, count: spots.length }, boss, spots, scaleLevel(boss));
  if (brood.length === 0) return 0;
  store.addUnits(brood);
  const mem = kairenMemory(live(boss.id) ?? boss);
  patchMemory(boss, {
    brood: brood.map((u) => u.id),
    broodTurn: mem.turns,
    lastUsed: { ...mem.lastUsed, brood: mem.turns },
  });
  fx.log(t('bossLog.kairen.brood', { name: unitName(boss), skill: skillName(broodOfTheOrb) }), KAIREN_JADE, skillLogIcon(broodOfTheOrb));
  // Called by his phase as well as from his bar: heard as the summoning either way (one moment, one cue)
  fx.sound?.(supportIntent(boss, { family: 'summon' }));
  fx.announce?.(skillName(broodOfTheOrb));
  for (const w of brood) fx.float?.(w.position, t('bossLog.float.arrives'), KAIREN_JADE);
  return brood.length;
}

// ── Turn start and between turns ─────────────────────────────────────────────

/**
 * What the board owes his phase, put right between turns: the weather said once as it
 * turns, the brood he calls on entering the Thunderhead, and each change in a hero's
 * Taint said once over them (`+TAINT`, `CLEANSED`).
 */
export function syncKairenBoard(fx: Fx): void {
  for (const boss of useCombatStore.getState().units.filter((u) => u.currentHp > 0 && isKairen(u))) {
    const phase = boss.bossPhase ?? 0;
    const mem = kairenMemory(boss);
    if (mem.boardPhase !== phase) {
      if (mem.boardPhase >= 0) {
        fx.log('  ' + t('bossLog.kairen.weatherTurns', { weather: weatherName(phase) ?? '' }), phase === 2 ? KAIREN_JADE : KAIREN_STORM);
      }
      patchMemory(boss, { boardPhase: phase });
      // On entering the Thunderhead he calls his brood at once
      if (phase === 1 && mem.boardPhase < 1) summonBrood(live(boss.id) ?? boss, fx);
    }
    // Nothing keeps him in the clouds but his own dive
    const fresh = live(boss.id) ?? boss;
    if (isAloft(fresh) && !preparedBy(boss.id, useCombatStore.getState().preparedAttacks).some((p) => p.scripted === 'kairen_dive')) {
      useCombatStore.getState().removeEffect(boss.id, AuraType.Aloft);
    }
    sayTaint(boss, fx);
  }
}

/** Floats each hero's change in Taint once: a gain as `+TAINT`, a cure as `CLEANSED`. */
export function sayTaint(boss: CombatUnit, fx: Fx): void {
  const mem = kairenMemory(live(boss.id) ?? boss);
  const seen = { ...mem.taintSeen };
  let changed = false;
  for (const hero of heroesOf(useCombatStore.getState().units)) {
    const now = taintOf(hero);
    const was = seen[hero.id] ?? 0;
    if (now === was) continue;
    changed = true;
    seen[hero.id] = now;
    if (now > was) {
      fx.status?.(hero.position, t('bossLog.kairen.float.taint', { count: now, cap: K.TAINT_CAP }), KAIREN_JADE);
      fx.log('  ' + t('bossLog.kairen.tainted', { name: unitName(hero), count: now, cap: K.TAINT_CAP }), KAIREN_JADE);
    } else if (now === 0) {
      fx.sound?.(supportIntent(hero, { family: 'cleanse' }));
      fx.status?.(hero.position, t('bossLog.kairen.float.cleansed'), '#c8f0ff');
      fx.log('  ' + t('bossLog.kairen.cleansed', { name: unitName(hero) }), '#c8f0ff');
    }
  }
  if (changed) patchMemory(boss, { taintSeen: seen });
}

/** Clears a hero's Taint and says so. */
function cleanse(hero: CombatUnit, boss: CombatUnit, fx: Fx): void {
  if (taintOf(hero) === 0) return;
  useCombatStore.getState().removeEffect(hero.id, AfflictionType.JadeTaint);
  sayTaint(boss, fx);
}

/**
 * His own regular turn beginning, before he chooses: the deferred phase change (a blow
 * that crossed two thresholds took him one phase on, and the next waits for a turn in
 * this one), the board put right for it, his own turn tally kept, and — in the Thunderhead —
 * the storm's marks struck and the next round's marked. The storm is his weather, not
 * his action: it never spends his turn. The phase's turn count is kept after, as every
 * boss's is (`bossRegistry.turnBegun`).
 */
export function beginKairenTurn(unitId: string, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const boss = live(unitId);
  if (!boss || boss.currentHp <= 0 || !isKairen(boss)) return;
  const entered = store.enterPendingPhase(unitId);
  if (entered) {
    sink.log(t('bossLog.kairen.enters', { phase: entered }), KAIREN_STORM);
    sink.announce?.(entered);
  }
  syncKairenBoard(sink);
  const now = live(unitId) ?? boss;
  const mem = kairenMemory(now);
  store.patchBossScript(unitId, { kairen: { ...mem, turns: mem.turns + 1 } });

  if ((now.bossPhase ?? 0) !== 1) return;
  for (const attack of preparedBy(unitId, useCombatStore.getState().preparedAttacks)) {
    if (attack.scripted !== 'kairen_storm' || !isPreparedDue(attack, useCombatStore.getState().units)) continue;
    landStorm(attack, live(unitId) ?? now, sink);
  }
  castStorm(live(unitId) ?? now, sink);
}

/** The next round's lightning: one set of marks, two from tier 4. */
export function castStorm(boss: CombatUnit, fx: Fx): void {
  const sets = tierOf(boss) >= 4 ? 2 : 1;
  const marked: HexCoord[] = [];
  for (let i = 0; i < sets; i++) {
    const store = useCombatStore.getState();
    const marks = stormMarks(boss, store.units, store.hazards, K.THUNDER_MARKS, marked);
    if (marks.length === 0) break;
    marked.push(...marks);
    const skill = i === 0 ? thunderhead : { ...thunderhead };
    castKairenWarning(boss, skill, boss.position, marks, { scripted: 'kairen_storm' }, fx, true);
  }
  if (marked.length > 0) fx.log('  ' + t('bossLog.kairen.stormMarks'), KAIREN_STORM);
}

// ── Landing ──────────────────────────────────────────────────────────────────

/** How one of his blows is struck: through the landing it belongs to (`Landing.blow`), or plainly. */
type Blow = Landing['blow'];

/** A blow with no landing to count it: a storm struck between turns. */
const unwarned: Blow = (striker, skill, aim, sink, hexes) => {
  resolveSkillUse(striker, skill, aim, sink, { resolving: true, fixedHexes: hexes });
};

/**
 * Lands one of his warnings whole, every blow through `landing`, so the answer tally counts
 * who each reached. False for anything that is not his.
 */
export function landKairenWarning(landing: Landing, caster: CombatUnit, sink: CombatSink): boolean {
  if (!isKairen(caster)) return false;
  const { attack } = landing;
  switch (attack.scripted) {
    case 'kairen_dive': landDive(attack, caster, sink, landing.blow); return true;
    case 'kairen_gale': landGale(attack, caster, sink, landing.blow); return true;
    case 'kairen_nova': landNova(attack, caster, sink, landing.blow); return true;
    case 'kairen_verdant': landVerdant(attack, caster, sink, landing.blow); return true;
    case 'kairen_storm': strikeStorm(attack, caster, sink, landing.blow); return true;
    default: return false;
  }
}

/**
 * A storm warning struck between turns: taken off the board first, then struck. Not a landing
 * of his turn, so nothing is counted for it.
 */
export function landStorm(attack: PreparedAttack, boss: CombatUnit, sink: CombatSink): void {
  useCombatStore.getState().removePreparedAttack(attack.id);
  strikeStorm(attack, boss, sink, unwarned);
}

/**
 * Lightning on every marked hex: a hero standing on one takes a bolt and loses all
 * Taint, and a hero drawing a bolt beside him leaves him Exposed for a round.
 */
function strikeStorm(attack: PreparedAttack, boss: CombatUnit, sink: CombatSink, blow: Blow): void {
  const keys = new Set(attack.hexes.map(hexKey));
  const struck = heroesOf(useCombatStore.getState().units).filter((u) => keys.has(hexKey(u.position)));
  sink.lands?.(attack.skill, boss.position, attack.aim);
  blow(boss, resolvedSkill(thunderhead), attack.aim, sink, attack.hexes);
  const rod = struck.some((u) => hexDistance(u.position, boss.position) === 1);
  for (const hero of struck) {
    const after = live(hero.id);
    if (after && after.currentHp > 0) cleanse(after, boss, sink);
  }
  const now = live(boss.id);
  if (rod && now && now.currentHp > 0) {
    useCombatStore.getState().applyEffect(now.id, {
      type: AuraType.Exposed, magnitude: K.EXPOSED, duration: K.EXPOSED_TURNS, sourceUnitId: now.id,
    });
    sink.log('  ' + t('bossLog.kairen.rod', { name: unitName(now) }), '#ffdd66');
    sink.status(now.position, t('bossLog.kairen.float.exposed'), '#ffdd66');
  }
}

function landDive(attack: PreparedAttack, boss: CombatUnit, sink: CombatSink, blow: Blow): void {
  const store = useCombatStore.getState();
  store.removeEffect(boss.id, AuraType.Aloft);
  const landing = diveLanding(attack, live(boss.id) ?? boss, store.units);
  if (hexKey(landing) !== hexKey(boss.position)) playTickEvents(store.moveUnit(boss.id, landing, 'jump', false), sink);
  const striker = live(boss.id) ?? boss;
  sink.lands?.(attack.skill, striker.position, attack.aim);
  blow(striker, attack.skill, attack.aim, sink, attack.hexes);
  const after = live(boss.id);
  if (!after || after.currentHp <= 0) return;
  store.applyEffect(after.id, { type: AuraType.Exposed, magnitude: K.EXPOSED, duration: K.EXPOSED_TURNS, sourceUnitId: after.id });
  sink.log('  ' + t('bossLog.kairen.diveLands', { name: unitName(after) }), '#ffdd66');
  sink.status(after.position, t('bossLog.kairen.float.exposed'), '#ffdd66');
}

function landGale(attack: PreparedAttack, boss: CombatUnit, sink: CombatSink, blow: Blow): void {
  const wind = attack.wind ?? windFor(0);
  const store = useCombatStore.getState();
  const moves = windMoves(wind, attack.windDistance ?? K.GALE_PUSH, boss.id, store.units, store.hazards);
  sink.vfx({
    kind: 'snow', delivery: 'spell', casterId: boss.id, casterPos: boss.position, targetCoord: boss.position,
    hitUnitIds: moves.filter((m) => m.moved).map((m) => m.unitId), hitCoords: moves.map((m) => m.to), color: '#d8e6ee',
  });
  for (const move of moves) {
    if (!move.moved) continue;
    playTickEvents(useCombatStore.getState().moveUnit(move.unitId, move.to, 'walk', false), sink);
  }
  sink.log('  ' + t('bossLog.kairen.galeDrives', { direction: windName(wind) }), '#d8e6ee');
  const striker = live(boss.id) ?? boss;
  const downdraft = attack.landing ?? [];
  if (striker.currentHp <= 0 || downdraft.length === 0) return;
  sink.log('  ' + t('bossLog.kairen.downdraft'), '#d8e6ee');
  sink.lands?.(attack.skill, striker.position, attack.aim);
  blow(striker, attack.skill, attack.aim, later(sink, 350), downdraft);
}

function landNova(attack: PreparedAttack, boss: CombatUnit, sink: CombatSink, blow: Blow): void {
  sink.lands?.(attack.skill, boss.position, attack.aim);
  blow(boss, attack.skill, attack.aim, sink, attack.hexes);
  sayTaint(boss, sink);
  const after = live(boss.id);
  if (!after || after.currentHp <= 0) return;
  const store = useCombatStore.getState();
  const room = Math.max(0, K.SHARDS - shardsOf(after, store.units).length);
  const shards = shardSpots(attack, store.units, room).map((position) => {
    const shard = createObjective({ kind: SHARD_KIND, owner: after, position, hp: 1, defense: 0 });
    return { ...shard, stats: { ...shard.stats, magicDefense: 0 } };
  });
  if (shards.length > 0) {
    store.addUnits(shards);
    sink.log('  ' + t('bossLog.kairen.shards', { count: shards.length }), KAIREN_JADE);
    for (const s of shards) sink.float(s.position, t('bossLog.kairen.float.shard'), KAIREN_JADE);
  }
  // Verdant Judgement follows every Nova, warned a window later: a hero turn to reach a shard
  castKairenWarning(after, verdantJudgement, after.position, [], { scripted: 'kairen_verdant' }, sink);
  markUsed(after, 'verdant');
}

function landVerdant(attack: PreparedAttack, boss: CombatUnit, sink: CombatSink, strike: Blow): void {
  heroesOf(useCombatStore.getState().units).forEach((hero, i) => {
    const striker = live(boss.id);
    if (!striker || striker.currentHp <= 0) return;
    const stacks = taintOf(hero);
    sink.log('  ' + t('bossLog.kairen.verdantHit', { name: unitName(hero), count: stacks }), KAIREN_JADE);
    const blow: HeroSkill = { ...resolvedSkill(attack.skill), targetType: SkillTargetType.Single, damage: verdantMultiplier(stacks) };
    strike(striker, blow, hero.position, later(sink, i * 200), [hero.position]);
  });
}

/**
 * What the cast says, for the hit-and-sound timing a scripted cast keeps. The
 * gale's wind turning and the rise into the clouds are warnings, named here and
 * not on the skills, so the landing does not hear them again.
 */
const WARNING_GESTURES: Readonly<Record<string, SkillGesture>> = {
  [galeDowndraft.id]: 'gale',
  [cloudDive.id]: 'cloudRise',
};

export function kairenCastIntent(boss: CombatUnit, skill: HeroSkill) {
  return launchIntent(boss, skill, strikeDelivery(skill, boss), undefined, WARNING_GESTURES[skill.id]);
}
