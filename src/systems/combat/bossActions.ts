import type { CombatSink } from '@/systems/combat/combatSink';
import type { CastRule, Landing } from '@/systems/combat/encounterScript';
import { difficultyMultipliers } from '@/systems/combat/runDifficulty';
import {
  AfflictionType,
  ArenaHazard,
  AuraType,
  CombatUnit,
  HeroSkill,
  HexCoord,
  PreparedAttack,
} from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { AETHELRED_PASSIVES, CLEAVE_WHIFF, collateralClaim, imperialStandards, overturn } from '@/data/templates/aethelred';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { useCombatStore } from '@/stores/combatStore';
import { placeObjective, placementBacklash } from '@/systems/combat/objectiveBoard';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import {
  addOrbHexes,
  aethelredTwist,
  BLACK_GLASS_KIND,
  chainPair,
  claimBrands,
  claimHexes,
  crownHexes,
  emptySealCharges,
  foreclosureSeals,
  foreclosureTargets,
  glassHexes,
  isScripted,
  legionOf,
  moveOfSkill,
  orbChargeCap,
  orbCharges,
  overturnDue,
  overturnThrows,
  realmCost,
  realmHexes,
  realmRadiusFor,
  settleChain,
  standardsOf,
  standardsStanding,
} from '@/systems/combat/bossScript';
import { calculateDamage } from '@/systems/combat/damageCalc';
import { unitById } from '@/systems/combat/unitLookup';
import { combatMaxHp } from '@/systems/combat/forms';
import { castPrepared } from '@/systems/combat/preparedCast';
import { launchIntent, strikeDelivery } from '@/systems/combat/soundIntents';
import { createSummonUnits, findSummonHexes } from '@/systems/combat/summoning';
import { resolveVfxColor, resolveVfxKind, resolveVfxScale } from '@/systems/combat/vfxResolve';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { solidKeys } from '@/systems/combat/arenaGeometry';
import { preparedBy } from '@/systems/combat/preparedAttacks';
import { bossPassiveName } from '@/data/templates/bossText';
import { unitName } from '@/data/templates/unitText';
import { formatNumber, t } from '@/i18n';
import { hasEffect } from '@/systems/combat/statusEffects';
import { heroesOf } from '@/systems/combat/targetLegality';
import { roll } from '@/systems/combat/dice';
import { playTickEvents } from '@/systems/combat/tickEvents';

/**
 * The store-writing half of Aethelred's script.
 *
 * `bossScript` decides and measures; this puts it on the board, and is shared by
 * every driver — the scene, the headless simulator, a harness — because both
 * `beginTurn` and the AI's executor call it. A warning an Emperor raises in the
 * app and one he raises in a measured fight are one rule.
 *
 * The channels are the same optional ones the AI's executor already carries (a
 * log, a picture, a sound): this file draws nothing itself, and a caller that
 * supplies none hears nothing, which is how the simulator discards them.
 */

export type BossFx = Pick<CombatSink, 'log'> & Partial<Pick<CombatSink, 'float' | 'vfx' | 'sound' | 'announce'>>;

const ORB_RED = '#ff2a3a';
const IMPERIAL_RED = '#c02028';

/** The level the boss was scaled to, recovered from its stats — summons are scaled to match. */
function scaleLevel(boss: CombatUnit): number {
  if (boss.enemyStatScale !== undefined) return Math.max(1, 1 + (boss.enemyStatScale - 1) / BALANCE.ENEMY_LEVEL_SCALE);
  const base = enemyTemplates.find((t) => t.id === boss.templateId)?.baseStats.maxHp ?? 0;
  if (base <= 0) return 1;
  return Math.max(1, 1 + (boss.stats.maxHp / (base * difficultyMultipliers(undefined, boss.sparedStrength).hp) - 1) / BALANCE.ENEMY_LEVEL_SCALE);
}

function spawnSoldiers(boss: CombatUnit, count: number, fx: BossFx): CombatUnit[] {
  const store = useCombatStore.getState();
  const hexes = findSummonHexes(boss.position, count, store.units);
  const soldiers = createSummonUnits(
    { templateId: 'legion_infantry', count },
    boss,
    hexes,
    scaleLevel(boss),
  );
  if (soldiers.length > 0) {
    store.addUnits(soldiers);
    for (const s of soldiers) {
      fx.log('  ' + t('bossLog.aethelred.soldierArrives', { name: unitName(s) }), '#aa88ff');
      fx.float?.(s.position, t('bossLog.float.arrives'), '#aa88ff');
    }
  }
  return soldiers;
}

/** The Legion soldiers he has standing — the ones a claim may take. */
export function legionSoldiers(boss: CombatUnit, units: CombatUnit[]): CombatUnit[] {
  return units.filter(
    (u) => u.currentHp > 0 && !u.objective && u.summonedBy === boss.id && u.templateId === 'legion_infantry',
  );
}

/**
 * Puts `count` charges on the orb, up to what it holds in this phase (`orbChargeCap`). Returns how
 * many it actually took, so a caller logs only what happened.
 */
function chargeOrb(bossId: string, count: number): number {
  const store = useCombatStore.getState();
  const boss = unitById(store.units, bossId);
  if (!boss || boss.currentHp <= 0 || count <= 0) return 0;
  const held = orbCharges(boss);
  const next = Math.min(orbChargeCap(boss.bossPhase ?? 0), held + count);
  if (next <= held) return 0;
  store.removeEffect(bossId, AuraType.OrbCharge);
  store.applyEffect(bossId, { type: AuraType.OrbCharge, magnitude: next, duration: -1, sourceUnitId: bossId });
  return next - held;
}

// ── casting the moves that are not an ordinary footprint ─────────────────────

/**
 * Raises one of his warnings.
 *
 * Each of these moves fixes what it covers *here*, at the cast, and then goes
 * through the shared `castPrepared` like any other preparation — so the HUD
 * line, the red hexes, the response window and the landing are the machinery
 * every delayed attack already uses. What is new is only where the footprint
 * comes from: the places two heroes stand, an outer ring, a disc he pays for.
 */
export function castScriptedMove(
  boss: CombatUnit,
  skill: HeroSkill,
  fx: BossFx,
): { ok: boolean } {
  const store = useCombatStore.getState();
  const units = store.units;
  const hazards = store.hazards;
  const move = moveOfSkill(skill);
  const charges = orbCharges(boss);

  let hexes: HexCoord[] = [];
  let bonus: HexCoord[] = [];
  let scripted: PreparedAttack['scripted'];
  let bound: string[] | undefined;
  let centres: HexCoord[] | undefined;
  let spendsCharges = true;
  let aim: HexCoord = boss.position;
  let paidForRealm = 0;

  switch (move) {
    case 'foreclosure': {
      const base = foreclosureSeals(boss, units, hazards);
      if (base.length === 0) return { ok: false };
      ({ hexes, bonus } = addOrbHexes(base, charges, boss, units, hazards));
      aim = base[0];
      // The seals are the heroes': the warning remembers whose is whose, so a seal can be paid or left empty
      const sealed = foreclosureTargets(boss, units, Infinity);
      bound = sealed.map((h) => h.id);
      centres = sealed.map((h) => ({ ...h.position }));
      break;
    }
    case 'chains': {
      const pair = chainPair(units);
      if (!pair) return { ok: false };
      hexes = pair.map((h) => ({ ...h.position }));
      scripted = 'chains';
      bound = pair.map((h) => h.id);
      aim = hexes[0];
      spendsCharges = false;
      break;
    }
    case 'claim': {
      const have = legionSoldiers(boss, units);
      const need = BALANCE.AETHELRED_CLAIM_SOLDIERS - have.length;
      const fresh = need > 0 ? spawnSoldiers(boss, need, fx) : [];
      const all = [...have, ...fresh];
      const party = heroesOf(store.units);
      // The soldiers nearest the party: the ones the party can actually reach
      const branded = claimBrands(all, party, BALANCE.AETHELRED_CLAIM_SOLDIERS);
      if (branded.length === 0) return { ok: false };
      for (const soldier of branded) {
        store.applyEffect(soldier.id, {
          type: AfflictionType.Branded,
          magnitude: 1,
          duration: 6,
          sourceUnitId: boss.id,
        });
      }
      centres = branded.map((s) => ({ ...s.position }));
      ({ hexes, bonus } = addOrbHexes(claimHexes(centres, hazards), charges, boss, useCombatStore.getState().units, hazards));
      scripted = 'claim';
      bound = branded.map((s) => s.id);
      aim = centres[0];
      break;
    }
    case 'crownfall': {
      ({ hexes, bonus } = addOrbHexes(crownHexes(boss, hazards), charges, boss, units, hazards));
      break;
    }
    case 'realm': {
      // An owed black sun (tier 5) can catch him with less than its price: `payHealth` leaves him standing
      paidForRealm = store.payHealth(boss.id, realmCost(boss));
      store.patchBossScript(boss.id, { pyreDamage: 0, ...(legionOf(boss)?.realmOwed && { realmOwed: false }) });
      hexes = realmHexes(boss.position, BALANCE.AETHELRED_REALM_RADIUS, hazards);
      ({ hexes, bonus } = addOrbHexes(hexes, charges, boss, useCombatStore.getState().units, hazards));
      scripted = 'realm';
      fx.log('  ' + t('bossLog.aethelred.realmCost', { name: unitName(boss), amount: formatNumber(paidForRealm) }), '#cc2244');
      break;
    }
    default:
      return { ok: false };
  }

  const fresh = useCombatStore.getState().units;
  const cast = castPrepared(unitById(fresh, boss.id) ?? boss, skill, aim, hexes, fresh, fx.log);
  if (!cast.ok) return { ok: false };

  store.updatePreparedAttack(cast.attack.id, {
    ...(scripted && { scripted }),
    ...(bound && { bound }),
    ...(centres && { centres }),
    ...(bonus.length > 0 && { bonusHexes: bonus }),
  });

  // The charges ride on this warning and are spent with it
  if (spendsCharges && charges > 0) {
    store.removeEffect(boss.id, AuraType.OrbCharge);
    fx.log('  ' + t('bossLog.aethelred.orbMarks', { count: bonus.length }), ORB_RED);
  }

  if (move === 'chains' && bound) {
    for (const id of bound) {
      store.applyEffect(id, {
        type: AfflictionType.Chained,
        magnitude: 1,
        duration: 3,
        sourceUnitId: boss.id,
      });
    }
    const [a, b] = bound.map((id) => unitById(useCombatStore.getState().units, id));
    if (a && b) fx.log('  ' + t('bossLog.aethelred.chainLinks', { first: unitName(a), second: unitName(b) }), ORB_RED);
  }

  fx.vfx?.({
    kind: resolveVfxKind(skill), delivery: strikeDelivery(skill, boss),
    casterId: boss.id,
    casterPos: boss.position,
    targetCoord: aim,
    hitUnitIds: [],
    hitCoords: hexes,
    color: resolveVfxColor(skill),
    durationScale: resolveVfxScale(skill),
  });
  fx.sound?.(launchIntent(boss, skill, strikeDelivery(skill, boss)));
  return { ok: true };
}

// ── turn start ───────────────────────────────────────────────────────────────

/**
 * What his own turn beginning does, before he chooses anything.
 *
 * The deferred phase change comes first — a blow that crossed two thresholds
 * took him into the next phase only, and the one after waits for him to have
 * lived a turn here (`pendingPhase`). Then Blood in the Ledger counts the
 * Bleeding, and the window the Legion Responds measures starts over.
 */
export function beginBossTurn(unitId: string, fx: BossFx): void {
  const store = useCombatStore.getState();
  const boss = unitById(store.units, unitId);
  if (!boss || boss.currentHp <= 0 || !isScripted(boss)) return;

  const entered = store.enterPendingPhase(unitId);
  if (entered) {
    fx.log(t('bossLog.aethelred.enters', { phase: entered }), '#ff6644');
    fx.announce?.(entered);
  }

  // Overturn: the phase has turned (or his health has fallen to the last threshold), and he flips the table
  heave(unitId, fx);

  const now = unitById(useCombatStore.getState().units, unitId);
  if (!now) return;

  // Blood in the Ledger — phase 2 only, once per turn, however many bleed
  if ((now.bossPhase ?? 0) === 1) {
    const bleeding = heroesOf(useCombatStore.getState().units).some((h) =>
      hasEffect(h, AfflictionType.Bleed),
    );
    if (bleeding && chargeOrb(unitId, 1) > 0) fx.log('  ' + t('bossLog.aethelred.ledger'), ORB_RED);
  }

  store.patchBossScript(unitId, { damageWindow: 0, titheSpent: false });
}

/** Overturn's banner, in his voice, for each throw in turn. */
const OVERTURN_LINES = ['bossLog.aethelred.overturnLine.0', 'bossLog.aethelred.overturnLine.1', 'bossLog.aethelred.overturnLine.2'] as const;

/**
 * Overturn, if one of its throws is due (`overturnDue`): he heaves the ground and every hero is thrown
 * (`overturnThrows`, on the fight's own dice), then each takes the heave's light blow. A hero the throw lands in
 * one of his open warnings is owed a turn before it lands, as a widened black sun owes one (`widenRealm`). The
 * throw is remembered on his script, so each threshold throws once. Returns whether he heaved.
 */
export function heave(unitId: string, fx: BossFx): boolean {
  const store = useCombatStore.getState();
  const boss = unitById(store.units, unitId);
  if (!boss || boss.currentHp <= 0) return false;
  const index = overturnDue(boss);
  if (index === null) return false;
  store.patchBossScript(unitId, { overturns: index + 1 });

  const moves = overturnThrows(index, store.units, store.hazards, roll);
  fx.log(t('bossLog.aethelred.overturn', { name: unitName(boss) }), IMPERIAL_RED);
  fx.announce?.(t(OVERTURN_LINES[Math.min(index, OVERTURN_LINES.length - 1)]));
  fx.vfx?.({
    kind: 'quake', delivery: 'blunt',
    casterId: boss.id,
    casterPos: boss.position,
    targetCoord: boss.position,
    hitUnitIds: moves.map((m) => m.unitId),
    hitCoords: moves.map((m) => m.to),
    color: IMPERIAL_RED,
    aftermath: 'dust',
  });
  fx.sound?.(launchIntent(boss, overturn, strikeDelivery(overturn, boss)));
  const shown = { log: fx.log, float: fx.float ?? (() => {}), vfx: fx.vfx ?? (() => {}) };
  for (const move of moves) {
    if (move.moved) playTickEvents(useCombatStore.getState().moveUnit(move.unitId, move.to, 'jump', false), shown);
  }

  // The heave's blow, on every hero it threw or tried to
  for (const move of moves) {
    const live = useCombatStore.getState();
    const hero = unitById(live.units, move.unitId);
    const striker = unitById(live.units, boss.id);
    if (!hero || hero.currentHp <= 0 || !striker) continue;
    const damage = Math.max(BALANCE.MIN_DAMAGE, Math.round(calculateDamage(striker, hero, overturn, 'front', live.units)));
    live.damageUnit(hero.id, damage, boss.id, { difficultyApplied: true });
    fx.float?.(hero.position, `-${damage}`, IMPERIAL_RED);
    fx.log(`  ${unitName(hero)} -${damage}`, '#ff4444');
  }
  oweThrownTurns(boss.id, moves.filter((m) => m.moved).map((m) => m.unitId));

  // Tier 3: the ground they were thrown from sets behind them
  if (aethelredTwist(boss, 'throwGlass')) layGlass(boss, moves.filter((m) => m.moved).map((m) => m.from), fx);
  // Tier 5: his last throw calls the black sun
  if (aethelredTwist(boss, 'lastThrowRealm') && index === BALANCE.AETHELRED_OVERTURN_DISTANCES.length - 1) {
    store.patchBossScript(unitId, { realmOwed: true });
  }
  return true;
}

/**
 * A hero thrown into one of his open warnings is owed a turn before it lands: added to its responders (and
 * to the heroes it threatens) when it was not, or given back a window when it had already answered.
 */
function oweThrownTurns(bossId: string, thrown: readonly string[]): void {
  const store = useCombatStore.getState();
  for (const attack of preparedBy(bossId, store.preparedAttacks)) {
    const covered = new Set(attack.hexes.map(hexKey));
    const inside = thrown
      .map((id) => unitById(store.units, id))
      .filter((u): u is CombatUnit => !!u && u.currentHp > 0 && covered.has(hexKey(u.position)))
      .map((u) => u.id);
    if (inside.length === 0) continue;
    const responders = [...attack.responders];
    const threatened = [...(attack.threatened ?? attack.responders)];
    const responded = [...attack.responded];
    for (const id of inside) {
      if (!responders.includes(id)) responders.push(id);
      if (!threatened.includes(id)) threatened.push(id);
      const answered = responded.filter((r) => r === id).length;
      if (answered >= (attack.windows ?? 1)) responded.splice(responded.lastIndexOf(id), 1);
    }
    store.updatePreparedAttack(attack.id, { responders, threatened, responded });
  }
}

// ── between turns ────────────────────────────────────────────────────────────

/**
 * What the party's last action earned or changed, put on the board before the
 * next unit acts — the same slot `resolveWaves` takes.
 *
 * Three things live here, all of them reactions to the board rather than choices
 * he makes: the Legion answering a burst, the black sun widening under blows,
 * and the chains and claims losing or following the units they are tied to.
 */
export function resolveBossResponses(fx: BossFx): void {
  const store = useCombatStore.getState();
  for (const boss of store.units.filter((u) => u.currentHp > 0 && isScripted(u))) {
    mendStandards(boss, fx);
    legionResponds(boss, fx);
    for (const attack of useCombatStore.getState().preparedAttacks.filter((p) => p.casterId === boss.id)) {
      if (attack.scripted === 'realm') widenRealm(boss, attack, fx);
      if (attack.scripted === 'chains') followChains(boss, attack, fx);
      if (attack.scripted === 'claim') weakenClaim(boss, attack, fx);
    }
  }
}

/**
 * Tier 2: a Standard has fallen (`damageFunnel.objectiveFell` marks it), so every other Standard standing is restored
 * to full. It settles here, once the blows of the turn that felled it have all landed, so a single area blow that fells
 * two fells them both and the mend does not depend on the order the blow's targets were struck in.
 */
function mendStandards(boss: CombatUnit, fx: BossFx): void {
  if (!legionOf(boss)?.standardFell) return;
  const store = useCombatStore.getState();
  store.patchBossScript(boss.id, { standardFell: false });
  let mended = false;
  for (const standard of standardsOf(boss, store.units)) {
    const restored = store.healUnit(standard.id, combatMaxHp(standard));
    if (restored <= 0) continue;
    mended = true;
    fx.float?.(standard.position, `+${restored}`, IMPERIAL_RED);
  }
  if (mended) fx.log('  ' + t('bossLog.aethelred.standardsMend'), IMPERIAL_RED);
}

/**
 * The Legion Responds. Dealing a fifth of his health between two of his turns
 * while phase 1 is active brings two infantry — once. The damage is never erased
 * or capped; the response is the board changing in answer to it.
 */
function legionResponds(boss: CombatUnit, fx: BossFx): void {
  const script = legionOf(boss);
  if (!script || (boss.bossPhase ?? 0) !== 0 || script.legionResponded) return;
  if (script.damageWindow < Math.max(1, combatMaxHp(boss) * BALANCE.AETHELRED_LEGION_THRESHOLD)) return;

  const store = useCombatStore.getState();
  const standing = legionSoldiers(boss, store.units).length;
  const count = Math.min(BALANCE.AETHELRED_LEGION_COUNT, BALANCE.AETHELRED_LEGION_CAP - standing);
  if (count <= 0) return;

  const passive = bossPassiveName(AETHELRED_PASSIVES[0]);
  fx.log(passive, IMPERIAL_RED);
  fx.announce?.(passive);
  const arrived = spawnSoldiers(boss, count, fx);
  if (arrived.length > 0) store.patchBossScript(boss.id, { legionResponded: true });
}

/**
 * The Pyre's Bargain: what the party deals while the black sun burns widens the
 * warned blast, a hex at a time, to a cap — and only ever to a radius everyone
 * can still leave. A hero the wider blast newly covers is owed a turn before it
 * lands, so the widening never arrives without a window to answer it.
 */
function widenRealm(boss: CombatUnit, attack: PreparedAttack, fx: BossFx): void {
  const store = useCombatStore.getState();
  const script = legionOf(boss);
  if (!script) return;

  const radius = realmRadiusFor(boss, store.units, script.pyreDamage, attack.origin, store.hazards);
  const bonus = attack.bonusHexes ?? [];
  const next = realmHexes(attack.origin, radius, store.hazards);
  const seen = new Set(next.map(hexKey));
  for (const b of bonus) if (!seen.has(hexKey(b))) next.push(b);
  if (next.length <= attack.hexes.length) return;

  const before = new Set(attack.hexes.map(hexKey));
  const newlyCovered = heroesOf(store.units).filter(
    (h) => !before.has(hexKey(h.position)) && seen.has(hexKey(h.position)),
  );
  store.updatePreparedAttack(attack.id, {
    hexes: next,
    responders: [
      ...attack.responders,
      ...newlyCovered.map((h) => h.id).filter((id) => !attack.responders.includes(id)),
    ],
  });
  fx.log('  ' + t('bossLog.aethelred.sunSwells'), ORB_RED);
  fx.announce?.(t('bossLog.aethelred.sunSwells'));
}

/**
 * A chain follows its two heroes: the warning tracks where they stand, and it is
 * severed — gone, with the status — if either is cleansed or falls.
 */
function followChains(boss: CombatUnit, attack: PreparedAttack, fx: BossFx): void {
  const store = useCombatStore.getState();
  const links = (attack.bound ?? [])
    .map((id) => unitById(store.units, id))
    .filter((u): u is CombatUnit => !!u && u.currentHp > 0 && hasEffect(u, AfflictionType.Chained));

  if (links.length < 2) {
    store.removePreparedAttack(attack.id, 'broken');
    for (const id of attack.bound ?? []) store.removeEffect(id, AfflictionType.Chained);
    fx.log('  ' + t('bossLog.aethelred.chainBreaks'), '#c8f0ff');
    return;
  }
  store.updatePreparedAttack(attack.id, { hexes: links.map((l) => ({ ...l.position })) });
}

/**
 * A claim loses ground as its soldiers fall: only a survivor's ring stays
 * marked, and the blast shrinks with them. With none left there is nothing to
 * collect and the warning is gone.
 */
function weakenClaim(boss: CombatUnit, attack: PreparedAttack, fx: BossFx): void {
  const store = useCombatStore.getState();
  const ids = attack.bound ?? [];
  const alive = ids.map((id, i) => ({ id, centre: attack.centres?.[i], unit: unitById(store.units, id) }))
    .filter((e) => e.unit && e.unit.currentHp > 0 && hasEffect(e.unit, AfflictionType.Branded) && e.centre);

  if (alive.length === ids.length) return;
  if (alive.length === 0) {
    store.removePreparedAttack(attack.id, 'broken');
    fx.log('  ' + t('bossLog.aethelred.claimFails'), '#c8f0ff');
    return;
  }
  const hexes = claimHexes(alive.map((e) => e.centre!), store.hazards);
  const seen = new Set(hexes.map(hexKey));
  for (const b of attack.bonusHexes ?? []) if (!seen.has(hexKey(b))) hexes.push(b);
  store.updatePreparedAttack(attack.id, {
    hexes,
    skill: { ...attack.skill, damage: (collateralClaim.damage ?? 1) * (alive.length / ids.length) },
  });
  fx.log('  ' + t('bossLog.aethelred.claimWeakens', { alive: alive.length, total: ids.length }), '#c8f0ff');
}

// ── landing ──────────────────────────────────────────────────────────────────

/**
 * The warnings that do not land as a plain footprint strike. Returns true when
 * it handled the landing itself, so the ordinary strike is skipped. A chain settles
 * on the people it links, wherever they stand: it strikes whoever pays, and one
 * that lost a link as it came due is broken.
 */
export function landScripted(landing: Landing, boss: CombatUnit, fx: BossFx): boolean {
  const { attack } = landing;
  if (attack.scripted !== 'chains') return false;
  const store = useCombatStore.getState();
  const links = (attack.bound ?? [])
    .map((id) => unitById(store.units, id))
    .filter((u): u is CombatUnit => !!u && u.currentHp > 0 && hasEffect(u, AfflictionType.Chained));

  for (const id of attack.bound ?? []) store.removeEffect(id, AfflictionType.Chained);
  if (links.length < 2) {
    landing.broken();
    return true;
  }

  const claim = settleChain(links[0], links[1]);
  landing.hit(claim.shares.map((s) => s.unitId));
  fx.log(
    '  ' + t(claim.mode === 'split' ? 'bossLog.aethelred.chainShared' : 'bossLog.aethelred.chainWeakerPays'),
    ORB_RED,
  );
  for (const { unitId, share } of claim.shares) {
    const target = unitById(useCombatStore.getState().units, unitId);
    if (!target) continue;
    const damage = Math.max(
      BALANCE.MIN_DAMAGE,
      Math.round(calculateDamage(boss, target, attack.skill, 'front', useCombatStore.getState().units) * share),
    );
    useCombatStore.getState().damageUnit(target.id, damage, boss.id, { difficultyApplied: true });
    fx.float?.(target.position, `-${damage}`, ORB_RED);
    fx.log(`  ${unitName(target)} -${damage}`, '#ff4444');
  }
  fx.vfx?.({
    kind: 'nova', delivery: 'spell',
    casterId: boss.id,
    casterPos: boss.position,
    targetCoord: links[0].position,
    hitUnitIds: links.map((l) => l.id),
    hitCoords: links.map((l) => l.position),
    color: ORB_RED,
  });
  return true;
}

/**
 * What each of his warnings leaves behind once it has struck: a claim collects its soldiers, a
 * Foreclosure charges the orb for the seals left empty, and a Crownfall leaves black glass.
 */
export function afterAethelredLanded(attack: PreparedAttack, boss: CombatUnit, fx: BossFx): void {
  afterClaimLanded(attack, boss, fx);
  afterForeclosureLanded(attack, boss, fx);
  afterCrownfallLanded(attack, boss, fx);
}

/**
 * Foreclosure's ledger: **every seal left empty charges the orb**. A seal is a hero's own hex at the
 * cast; it is empty when the hero is not on it at the landing and has not paid it (`PreparedAttack.tolls`),
 * and a hero who has fallen is no choice. The charges ride on the next orb warning (`addOrbHexes`).
 */
function afterForeclosureLanded(attack: PreparedAttack, boss: CombatUnit, fx: BossFx): void {
  if (!attack.spec.sealed) return;
  const units = useCombatStore.getState().units;
  const centres = attack.centres ?? [];
  const empty = (attack.bound ?? []).filter((id, i) => {
    const hero = unitById(units, id);
    if (!hero || hero.currentHp <= 0 || !centres[i]) return false;
    if (attack.tolls?.some((toll) => toll.unitId === id)) return false;
    return hexKey(hero.position) !== hexKey(centres[i]);
  }).length;
  if (empty === 0) return;
  const taken = chargeOrb(boss.id, empty * emptySealCharges(boss));
  fx.log('  ' + t('bossLog.aethelred.sealsEmpty', { count: empty, charges: taken }), ORB_RED);
}

let glassSequence = 0;

/**
 * Black glass on `points`, under the one rule every laying keeps (`glassHexes`): a solid field that stays
 * until the phase turns, on hexes nobody occupies, each only while the floor stays one connected piece. It
 * blocks movement, shoves and shots like rubble.
 */
function layGlass(boss: CombatUnit, points: readonly HexCoord[], fx: BossFx): void {
  const store = useCombatStore.getState();
  // A hero who fell on a hex was struck there, so it stays open
  const fallen = store.units.filter((u) => !u.objective && u.currentHp <= 0).map((u) => u.position);
  const hexes = glassHexes(boss, points, store.units, store.hazards, fallen);
  if (hexes.length === 0) return;
  store.addHazard({
    id: `glass_${++glassSequence}`,
    hexes,
    solid: true,
    kind: BLACK_GLASS_KIND,
    lasts: 'phase',
    label: 'bossLog.hazard.blackGlass',
    ownerId: boss.id,
  });
  fx.log('  ' + t('bossLog.aethelred.glass', { count: hexes.length }), '#8a5ad0');
}

/** Crownfall's glass: where a crown point fell on a hex nobody occupied. The orb's added hexes are marks, not crown points, and leave nothing. */
function afterCrownfallLanded(attack: PreparedAttack, boss: CombatUnit, fx: BossFx): void {
  if (attack.skill.id !== 'crownfall') return;
  const added = new Set((attack.bonusHexes ?? []).map(hexKey));
  layGlass(boss, attack.hexes.filter((h) => !added.has(hexKey(h))), fx);
}

// ── the Cleave: the orb's charges and the whiff ──────────────────────────────

/**
 * An Imperial Cleave has just been raised: the orb's charges (a Cleave that struck nobody leaves one)
 * mark more of the floor beside the wedge, as they do for every orb warning, and are spent with it.
 * Whoever the added hexes newly cover owes a turn and is counted in the warning.
 */
export function spendOrbOnCleave(boss: CombatUnit, fx: BossFx): void {
  const store = useCombatStore.getState();
  const charges = orbCharges(unitById(store.units, boss.id) ?? boss);
  if (charges <= 0) return;
  const attack = preparedBy(boss.id, store.preparedAttacks).find((p) => p.skill.id === 'imperial_cleave');
  if (!attack) return;
  const { hexes, bonus } = addOrbHexes(attack.hexes, charges, boss, store.units, store.hazards);
  store.removeEffect(boss.id, AuraType.OrbCharge);
  fx.log('  ' + t('bossLog.aethelred.orbMarks', { count: bonus.length }), ORB_RED);
  if (bonus.length === 0) return;
  const caught = store.units
    .filter((u) => u.currentHp > 0 && u.isPlayer !== boss.isPlayer && !u.objective && !u.companion
      && bonus.some((h) => hexKey(h) === hexKey(u.position)))
    .map((u) => u.id);
  store.updatePreparedAttack(attack.id, {
    hexes,
    bonusHexes: bonus,
    responders: [...attack.responders, ...caught.filter((id) => !attack.responders.includes(id))],
    threatened: [...(attack.threatened ?? attack.responders), ...caught.filter((id) => !(attack.threatened ?? attack.responders).includes(id))],
  });
}

/**
 * A Cleave that struck nobody (`PreparedSpec.onWhiff`, hook `cleave`): the orb takes a charge, and in
 * phase 1, while fewer than three Standards stand, a Standard rises where the sword fell.
 */
export function cleaveWhiffed(attack: PreparedAttack, boss: CombatUnit, fx: BossFx): void {
  if (attack.spec.onWhiff !== CLEAVE_WHIFF) return;
  const taken = chargeOrb(boss.id, 1);
  if (taken > 0) fx.log('  ' + t('bossLog.aethelred.whiffCharge'), ORB_RED);
  const store = useCombatStore.getState();
  const live = unitById(store.units, boss.id) ?? boss;
  if ((live.bossPhase ?? 0) !== 0 || standardsStanding(live, store.units) >= BALANCE.AETHELRED_STANDARDS) return;
  const hex = whiffStandardHex(attack, store.units, store.hazards);
  if (!hex) return;
  const spec = imperialStandards.places!;
  placeObjective({
    kind: spec.kind,
    owner: live,
    position: hex,
    hp: Math.max(1, Math.round(live.stats.maxHp * spec.hpFraction)),
    defense: spec.defense,
    protection: spec.protection,
    areaResist: spec.areaResist,
    onDestroy: spec.onDestroy,
    onAllDestroyed: spec.onAllDestroyed,
    shattersOnPhase: spec.shattersOnPhase,
    breakerBarrier: spec.breakerBarrier,
    backlash: placementBacklash(spec, live),
  });
  fx.log('  ' + t('bossLog.aethelred.whiffStandard'), IMPERIAL_RED);
  fx.float?.(hex, t('bossLog.aethelred.float.standard'), IMPERIAL_RED);
}

/**
 * Where the sword fell: the free hex of the wedge nearest where it was aimed, a tie going to the
 * lower coordinate. Never under a body, on solid ground or on his own hex.
 */
export function whiffStandardHex(
  attack: PreparedAttack,
  units: CombatUnit[],
  hazards: ArenaHazard[],
): HexCoord | null {
  const occupied = new Set(units.filter((u) => u.currentHp > 0).map((u) => hexKey(u.position)));
  const solid = solidKeys(hazards);
  const free = attack.hexes
    .filter((h) => !occupied.has(hexKey(h)) && !solid.has(hexKey(h)))
    .sort((a, b) => hexDistance(a, attack.aim) - hexDistance(b, attack.aim) || a.q - b.q || a.r - b.r);
  return free[0] ? { q: free[0].q, r: free[0].r } : null;
}

/**
 * After a claim's blast: each surviving branded soldier is sacrificed to feed
 * it, and every one restores a share of his protection as a Barrier.
 */
export function afterClaimLanded(attack: PreparedAttack, boss: CombatUnit, fx: BossFx): void {
  if (attack.scripted !== 'claim') return;
  const store = useCombatStore.getState();
  let sacrificed = 0;
  for (const id of attack.bound ?? []) {
    const soldier = unitById(useCombatStore.getState().units, id);
    if (!soldier || soldier.currentHp <= 0) continue;
    store.removeEffect(id, AfflictionType.Branded);
    store.damageUnit(id, soldier.currentHp);
    fx.log('  ' + t('bossLog.aethelred.sacrificed', { name: unitName(soldier) }), ORB_RED);
    fx.float?.(soldier.position, t('bossLog.aethelred.float.sacrificed'), ORB_RED);
    sacrificed++;
  }
  if (sacrificed > 0) {
    const barrier = Math.round(combatMaxHp(boss) * BALANCE.AETHELRED_CLAIM_BARRIER * sacrificed);
    store.applyEffect(boss.id, {
      type: AuraType.Barrier,
      magnitude: barrier,
      duration: 3,
      sourceUnitId: boss.id,
    });
    fx.log('  ' + t('bossLog.aethelred.wrapped', { name: unitName(boss), amount: formatNumber(barrier) }), ORB_RED);
  }
}

// ── the party's side of the Writ and the seals ───────────────────────────────

/**
 * Aethelred's answer to a paid cast (`CastRule`): a Foreclosure seal under the caster is answered
 * first (`applySealToll`, given the ids the cast struck), then a Writ the caster holds
 * (`applyWritCost`). The resolver fires it for every paid cast, so it is one rule whoever is
 * pressing the button. A step voids the Writ too, which is his registry entry's `onStep`.
 */
export const aethelredCast: CastRule = {
  id: 'aethelred',
  paid(caster, skill, struck, fx) {
    applySealToll(caster, skill, fx, struck);
    applyWritCost(caster, skill, fx);
  },
};

/**
 * Using a skill while holding Aethelred's writ.
 *
 * A basic attack voids it, which is the quiet answer; a class skill pays — a
 * share of the bearer's own maximum HP, taken without a Barrier's help and never
 * enough to kill — and lends Aethelred a Barrier worth what the writ was worth.
 */
function applyWritCost(caster: CombatUnit, skill: HeroSkill, fx: BossFx): void {
  const store = useCombatStore.getState();
  const carrier = unitById(store.units, caster.id);
  const writ = carrier?.activeEffects.find((e) => e.type === AfflictionType.Writ);
  if (!carrier || !writ || !carrier.isPlayer) return;

  if (skill.id === BASIC_ATTACK_ID) {
    store.removeEffect(caster.id, AfflictionType.Writ);
    fx.log('  ' + t('bossLog.aethelred.writVoided', { name: unitName(caster) }), '#c8f0ff');
    return;
  }

  const paid = store.payHealth(caster.id, Math.round(combatMaxHp(carrier) * writ.magnitude));
  const boss = writ.sourceUnitId ? unitById(store.units, writ.sourceUnitId) : undefined;
  fx.log('  ' + t('bossLog.aethelred.writPaid', { name: unitName(caster), amount: formatNumber(paid) }), '#cc2244');
  fx.float?.(carrier.position, `-${paid}`, '#cc2244');
  if (boss && boss.currentHp > 0) {
    const barrier = Math.max(1, Math.round(combatMaxHp(boss) * BALANCE.AETHELRED_WRIT_BARRIER));
    store.applyEffect(boss.id, {
      type: AuraType.Barrier,
      magnitude: barrier,
      duration: 3,
      sourceUnitId: boss.id,
    });
    fx.log('  ' + t('bossLog.aethelred.writBarrier', { name: unitName(boss), amount: formatNumber(barrier) }), '#cc2244');
  }
}

// ── the party's side of Foreclosure ──────────────────────────────────────────

/**
 * A skill used from a Foreclosure seal. The seal is the hex the hero stood on when the orb stamped it
 * (`PreparedAttack.centres`), and each hero answers it once:
 *
 * - **A basic attack on him** (`hitIds` holds the caster of the warning) pays it: the seal and its ring
 *   do not erupt under that hero (`paidSealHexes`).
 * - **A class skill** pays in blood: a share of the hero's maximum health (`AETHELRED_TOLL_HP`, never
 *   kills, no Barrier lends it back) and the eruption still lands.
 *
 * A step off the seal does neither: the seal is left empty and the orb takes a charge at the landing.
 */
function applySealToll(caster: CombatUnit, skill: HeroSkill, fx: BossFx, hitIds: readonly string[]): void {
  const store = useCombatStore.getState();
  const hero = unitById(store.units, caster.id);
  if (!hero || !hero.isPlayer || hero.currentHp <= 0) return;
  for (const attack of store.preparedAttacks) {
    if (!attack.spec.sealed || !attack.bound || !attack.centres) continue;
    const index = attack.bound.indexOf(hero.id);
    if (index < 0 || attack.tolls?.some((toll) => toll.unitId === hero.id)) continue;
    if (hexKey(hero.position) !== hexKey(attack.centres[index])) continue;

    if (skill.id === BASIC_ATTACK_ID) {
      if (!hitIds.includes(attack.casterId)) continue;
      store.updatePreparedAttack(attack.id, { tolls: [...(attack.tolls ?? []), { unitId: hero.id, how: 'strike' }] });
      fx.log('  ' + t('bossLog.aethelred.sealPaid', { name: unitName(hero) }), '#c8f0ff');
      fx.float?.(hero.position, t('bossLog.aethelred.float.paid'), '#c8f0ff');
      continue;
    }
    const paid = store.payHealth(hero.id, Math.max(1, Math.round(combatMaxHp(hero) * BALANCE.AETHELRED_TOLL_HP)));
    store.updatePreparedAttack(attack.id, { tolls: [...(attack.tolls ?? []), { unitId: hero.id, how: 'blood' }] });
    fx.log('  ' + t('bossLog.aethelred.sealBlood', { name: unitName(hero), amount: formatNumber(paid) }), '#cc2244');
    fx.float?.(hero.position, `-${paid}`, '#cc2244');
  }
}
