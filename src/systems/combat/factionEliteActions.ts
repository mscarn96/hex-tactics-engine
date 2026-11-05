import { AuraType, CombatUnit, HeroSkill, HexCoord, PreparedAttack } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { tombCollapse, twinRaidBurst, undermineEruption } from '@/data/skills/factionEliteSkills';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import { createEnemyUnits } from '@/systems/combat/unitFactory';
import { unitById } from '@/systems/combat/unitLookup';
import { EliteValue, ELITE_SIGNATURE_VALUE } from '@/systems/combat/eliteActions';
import { occupiedKeys, solidKeys } from '@/systems/combat/eliteKits';
import { scaleOf } from '@/systems/combat/eliteWarnings';
import {
  canChallenge,
  canTomb,
  challengeFor,
  challengeStands,
  dashRoutes,
  decideChallenge,
  isBurrowed,
  planTwinRaid,
  SAND_MITE_TEMPLATE,
  surfaceHex,
  TOMB_KIND,
  tombOf,
  tombTarget,
  undermineShape,
  ventsThatSpawn,
} from '@/systems/combat/factionEliteKits';
import { createObjective } from '@/systems/combat/objectives';
import { canPrepare, castPrepared } from '@/systems/combat/preparedCast';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';
import { moveIntent, supportIntent } from '@/systems/combat/soundIntents';
import { isHiddenFrom, isRooted, meetsTargetRequirement } from '@/systems/combat/statusEffects';
import { hexDistance, hexKey } from '@/utils/hexUtils';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import { discAround } from '@/systems/combat/arenaGeometry';
import { heroesOf } from '@/systems/combat/targetLegality';

/**
 * The store-writing half of the new-faction elites' signatures.
 *
 * `factionEliteKits` decides and measures; this puts it on the board. Shared by every
 * driver (the scene, the headless simulator, a harness) because the AI's executor and the
 * turn start call it, so a signature raised in the app and one raised in a measured
 * fight are one rule. The Burrowmother's and the Colossus's rest on the shared warning
 * (`castPrepared`, landed from `preparedResolve`); the Khan's is an action; the Jarl's is
 * a question put to a hero.
 */

const DUST = '#d8b878';
const RAID_RED = '#e05040';
const ICE = '#bfe6f5';
const TOMB_CYAN = '#7fe8ff';

// ── what the AI makes of each signature ──────────────────────────────────────

/**
 * What a new-faction elite's signature is worth to its AI, or `undefined` when the skill
 * is an ordinary one. Each strikes nobody at the cast, so each is scored on what it buys,
 * above an at-will swing whenever it is legal at all: its cooldown is what limits it.
 */
export function factionEliteSkillValue(
  caster: CombatUnit,
  skill: HeroSkill,
  foes: CombatUnit[],
  allUnits: CombatUnit[],
): EliteValue | null | undefined {
  const { hazards } = useCombatStore.getState();
  switch (skill.id) {
    case 'undermine': {
      if (isBurrowed(caster) || !canPrepare(caster.id)) return null;
      const shape = undermineShape(caster, allUnits, hazards);
      if (!shape) return null;
      const inside = new Set(shape.hexes.map(hexKey));
      const covered = heroesOf(allUnits).filter((h) => inside.has(hexKey(h.position))).length;
      return { skill, targetPos: shape.centre, value: ELITE_SIGNATURE_VALUE + 12 * covered };
    }
    case 'twin_raid': {
      if (isRooted(caster)) return null;
      const legs = planTwinRaid(caster, allUnits, hazards);
      if (legs.length === 0) return null;
      const hits = legs.reduce((n, l) => n + l.caught.length, 0);
      return { skill, targetPos: caster.position, value: ELITE_SIGNATURE_VALUE + 12 * hits };
    }
    case 'jarls_challenge': {
      const target = foes
        .filter(
          (f) =>
            !isHiddenFrom(f, skill) &&
            meetsTargetRequirement(caster, f, skill) &&
            hexDistance(caster.position, f.position) <= skill.range &&
            canChallenge(caster, f, allUnits, hazards),
        )
        .sort(
          (a, b) =>
            Math.max(b.stats.attack, b.stats.magic) - Math.max(a.stats.attack, a.stats.magic) ||
            (a.id < b.id ? -1 : 1),
        )[0];
      return target ? { skill, targetPos: target.position, value: ELITE_SIGNATURE_VALUE + 5 } : null;
    }
    case 'glacial_tomb': {
      if (!canTomb(caster, allUnits) || !canPrepare(caster.id)) return null;
      const target = tombTarget(caster, skill, allUnits);
      return target
        ? { skill, targetPos: target.position, value: ELITE_SIGNATURE_VALUE + Math.max(target.stats.attack, target.stats.magic) / 2 }
        : null;
    }
    default:
      return undefined;
  }
}

// ── Burrowmother: Undermine ──────────────────────────────────────────────────

/**
 * She goes under. The footprint, its centre and its vents are announced through the shared
 * warning: every hero standing in it owes a window, and she cannot be touched until she
 * surfaces on her next turn once they have had theirs.
 */
export function castUndermine(mother: CombatUnit, fx: BossFx): { ok: boolean } {
  const store = useCombatStore.getState();
  if (isBurrowed(mother) || !canPrepare(mother.id)) return { ok: false };
  const shape = undermineShape(mother, store.units, store.hazards);
  if (!shape) return { ok: false };

  // The warning carries the cooldown the kit's skill owns, so the id and the cost are hers
  const warned: HeroSkill = {
    ...undermineEruption,
    id: 'undermine',
    cooldown: BALANCE.UNDERMINE_COOLDOWN,
    prepares: { windows: 1 },
  };
  const cast = castPrepared(mother, warned, shape.centre, shape.hexes, store.units, fx.log);
  if (!cast.ok) return { ok: false };
  store.updatePreparedAttack(cast.attack.id, {
    scripted: 'undermine',
    vents: shape.vents,
    centres: [shape.centre],
  });
  store.applyEffect(mother.id, {
    type: AuraType.Burrowed,
    magnitude: 0,
    duration: -1,
    sourceUnitId: mother.id,
  });
  fx.vfx?.({
    kind: 'nova', delivery: 'spell',
    casterId: mother.id,
    casterPos: mother.position,
    targetCoord: mother.position,
    hitUnitIds: [],
    hitCoords: [mother.position],
    color: DUST,
  });
  fx.log('  ' + t('bossLog.faction.burrows', { name: unitName(mother) }), DUST);
  fx.float?.(mother.position, t('bossLog.faction.float.burrows'), DUST);
  return { ok: true };
}

/**
 * The eruption is about to land: she comes up in the footprint (its centre, or the free
 * hex nearest it) and the sand lets go of her. Returns her where she now stands, which is
 * where the strike is made from.
 */
export function beforeUndermineLanding(attack: PreparedAttack, mother: CombatUnit, fx: BossFx): CombatUnit {
  if (attack.scripted !== 'undermine') return mother;
  const store = useCombatStore.getState();
  const hex = surfaceHex(mother, attack, store.units, store.hazards);
  // A swift slide under the sand to where she breaks out, never a stroll across the arena
  if (hexKey(hex) !== hexKey(mother.position)) store.moveUnit(mother.id, hex, 'dash');
  store.removeEffect(mother.id, AuraType.Burrowed);
  fx.log('  ' + t('bossLog.faction.erupts', { name: unitName(mother) }), DUST);
  return unitById(useCombatStore.getState().units, mother.id) ?? mother;
}

/**
 * After the eruption: every vent no hero held opens a Sand Mite, and she is Exposed for
 * exactly one round of the party's turns (her own next turn is when it ends).
 */
export function afterUndermineLanding(attack: PreparedAttack, mother: CombatUnit, fx: BossFx): void {
  if (attack.scripted !== 'undermine') return;
  const store = useCombatStore.getState();
  const live = unitById(store.units, mother.id);
  if (!live || live.currentHp <= 0) return;

  const vents = attack.vents ?? [];
  const opening = ventsThatSpawn(live, vents, store.units);
  const plugged = vents.filter((v) => heroesOf(store.units).some((h) => hexKey(h.position) === hexKey(v))).length;
  for (const hex of opening) {
    const [mite] = createEnemyUnits([SAND_MITE_TEMPLATE], [hex], 1, scaleOf(live) * BALANCE.UNDERMINE_MITE_POWER, live.sparedStrength, live.contentLevel);
    if (!mite) continue;
    store.addUnits([{ ...mite, summonedBy: live.id, isPlayer: live.isPlayer, facingAngle: live.facingAngle }]);
    fx.float?.(hex, unitName(mite), DUST);
  }
  if (opening.length > 0) fx.log('  ' + t('bossLog.faction.ventsOpen', { count: opening.length }), DUST);
  if (plugged > 0) fx.log('  ' + t('bossLog.faction.ventsPlugged', { count: plugged }), DUST);

  store.applyEffect(live.id, {
    type: AuraType.Exposed,
    magnitude: BALANCE.UNDERMINE_EXPOSED,
    duration: BALANCE.UNDERMINE_EXPOSED_TURNS,
    sourceUnitId: live.id,
  });
  fx.log('  ' + t('bossLog.faction.exposedUntil', { name: unitName(live) }), '#ffdd66');
}

// ── Herd-Khan: Twin Raid ─────────────────────────────────────────────────────

/**
 * The raid, from where the Khan stands now (the AI has already made the first dash as an
 * ordinary move): a burst at this arrival, then, when `second` is a legal dash from here,
 * the second dash and its burst. Each burst is the shared resolver run against the ground
 * round the landing, so a hero's defences, crit and dodge answer it as any blow, and a hero
 * caught by both takes both. The second burst waits a beat on screen.
 */
export function performTwinRaid(khan: CombatUnit, second: HexCoord, sink: CombatSink): void {
  const burst = (at: CombatUnit, delayMs: number) => {
    const staged: CombatSink = delayMs > 0 ? { ...sink, vfx: (spec) => sink.vfx({ ...spec, delayMs }) } : sink;
    sink.log('  ' + t('bossLog.faction.lands', { name: unitName(at) }), RAID_RED);
    resolveSkillUse(at, twinRaidBurst, at.position, staged, {
      resolving: true,
      fixedHexes: discAround(at.position, BALANCE.TWIN_RAID_RADIUS),
    });
  };

  burst(khan, 0);

  const store = useCombatStore.getState();
  const here = unitById(store.units, khan.id);
  if (!here || here.currentHp <= 0 || hexKey(second) === hexKey(here.position)) return;
  const blocked = new Set([...occupiedKeys(store.units, here.id), ...solidKeys(store.hazards)]);
  const route = dashRoutes(here.position, BALANCE.TWIN_RAID_DASH, blocked).get(hexKey(second));
  if (!route || isRooted(here)) return;

  const ticks = store.moveUnit(here.id, second, 'dash', undefined, undefined, [here.position, ...route]);
  sink.sound?.(moveIntent(here.id, here.position, second, 'dash'));
  sink.log('  ' + t('bossLog.faction.dashAgain', { name: unitName(here) }), RAID_RED);
  for (const t of ticks) sink.float(second, t.text, t.color);
  const landed = unitById(useCombatStore.getState().units, here.id);
  if (landed && landed.currentHp > 0) burst(landed, 380);
}

// ── Rime Jarl: Jarl's Challenge ──────────────────────────────────────────────

/** He names a hero. The circle that will close is previewed round his hex until they answer. */
export function castChallenge(
  jarl: CombatUnit,
  skill: HeroSkill,
  targetPos: HexCoord,
  fx: BossFx,
): { ok: boolean } {
  const store = useCombatStore.getState();
  const hero = store.getUnitAt(targetPos);
  if (!hero || !canChallenge(jarl, hero, store.units, store.hazards)) return { ok: false };
  store.issueChallenge(jarl.id, hero.id);
  store.startCooldown(jarl.id, skill);
  fx.vfx?.({
    kind: 'bolt', delivery: 'spell',
    casterId: jarl.id,
    casterPos: jarl.position,
    targetCoord: hero.position,
    hitUnitIds: [hero.id],
    hitCoords: [hero.position],
    color: ICE,
  });
  const challenge = t('bossLog.faction.challenges', { name: unitName(jarl), target: unitName(hero) });
  fx.log(`  ${challenge}`, ICE);
  fx.float?.(hero.position, t('bossLog.faction.float.challenged'), ICE);
  fx.announce?.(challenge);
  return { ok: true };
}

/**
 * The hero's answer, however it was reached (the panel's button or the AI's policy), told
 * the way every other elite event is: a line in the log and a word over the unit.
 */
export function answerChallenge(heroId: string, accept: boolean, fx: BossFx): void {
  const store = useCombatStore.getState();
  const hero = unitById(store.units, heroId);
  const open = hero ? challengeFor(hero, store.units) : null;
  if (!hero || !open) return;
  const jarl = open.jarl;
  const events = store.answerChallenge(heroId, accept);
  for (const ev of events) {
    const at = unitById(useCombatStore.getState().units, ev.unitId);
    if (!at) continue;
    fx.log(`  ${unitName(at)} ${ev.log ?? ev.text}`, ev.color);
    fx.float?.(at.position, ev.text, ev.color);
  }
  if (accept) {
    // The challenge is heard once, as the duel it names begins: never at the naming, which may be refused
    fx.sound?.(supportIntent(jarl, { gesture: 'challenge' }));
    fx.announce?.(t('bossLog.faction.runeCircle', { first: unitName(hero), second: unitName(jarl) }));
    fx.vfx?.({
      kind: 'nova', delivery: 'spell',
      casterId: jarl.id,
      casterPos: jarl.position,
      targetCoord: jarl.position,
      hitUnitIds: [],
      hitCoords: discAround(jarl.position, BALANCE.CHALLENGE_RADIUS),
      color: ICE,
    });
  }
}

/**
 * A hero's turn is beginning with a challenge on them. One that no longer stands (either
 * has fallen or left the circle that was previewed) is dropped. One that does is put to the
 * hero by the scene; an AI-driven hero (a harness, or one the Dark Mage is holding) answers by
 * policy, so a fight with nobody at the controls never waits on a question.
 */
export function beginChallengeTurn(hero: CombatUnit, interactive: boolean, fx: BossFx): void {
  const store = useCombatStore.getState();
  const open = challengeFor(hero, store.units);
  if (!open || !challengeStands(hero, store.units)) {
    if (hero.challenge) {
      store.dropChallenge(hero.id);
      fx.log('  ' + t('bossLog.faction.challengeLapses', { name: unitName(hero) }), ICE);
    }
    return;
  }
  if (interactive && !hero.seized) return;
  answerChallenge(hero.id, decideChallenge(hero, open.jarl, store.units), fx);
}

// ── Glacier Colossus: Glacial Tomb ───────────────────────────────────────────

/**
 * He seals a hero in ice. The block is an attackable objective standing on the hero's hex
 * with a share of his health, bound to the warning that waits for every *other* hero to
 * answer before it collapses; breaking the block cancels that warning at once
 * (`combatStore.breakTomb` frees the hero and bursts outward).
 */
export function castTomb(
  colossus: CombatUnit,
  skill: HeroSkill,
  targetPos: HexCoord,
  fx: BossFx,
): { ok: boolean } {
  const store = useCombatStore.getState();
  const hero = store.getUnitAt(targetPos);
  if (!hero || !canTomb(colossus, store.units) || !canPrepare(colossus.id) || tombOf(colossus, store.units)) {
    return { ok: false };
  }
  const warned: HeroSkill = {
    ...tombCollapse,
    id: skill.id,
    cooldown: skill.cooldown,
    prepares: { windows: 1 },
  };
  const cast = castPrepared(colossus, warned, hero.position, [hero.position], store.units, fx.log);
  if (!cast.ok) return { ok: false };

  const tomb = createObjective({
    kind: TOMB_KIND,
    owner: colossus,
    position: hero.position,
    hp: Math.max(1, Math.round(colossus.stats.maxHp * BALANCE.TOMB_HP)),
    defense: 0,
    shattersOnPhase: false,
    // Breaking it cancels the collapse; the collapse landing is what spends it
    bindsPrepared: cast.attack.id,
    linkedUnitId: hero.id,
  });
  // Zero defence of both kinds, stated rather than left to the fallback
  tomb.stats = { ...tomb.stats, magicDefense: 0 };
  store.sealInTomb(tomb, hero.id);
  // Every other living hero owes the window; the sealed one cannot answer
  store.updatePreparedAttack(cast.attack.id, {
    scripted: 'tomb',
    responders: heroesOf(useCombatStore.getState().units)
      .filter((h) => h.id !== hero.id)
      .map((h) => h.id),
    bound: [tomb.id, hero.id],
  });
  fx.vfx?.({
    kind: 'bolt', delivery: 'spell',
    casterId: colossus.id,
    casterPos: colossus.position,
    targetCoord: hero.position,
    hitUnitIds: [hero.id],
    hitCoords: [hero.position],
    color: TOMB_CYAN,
  });
  fx.log('  ' + t('bossLog.faction.sealed', { name: unitName(hero) }), TOMB_CYAN);
  fx.float?.(hero.position, t('bossLog.faction.float.encased'), TOMB_CYAN);
  return { ok: true };
}

/**
 * The collapse is about to land: if the block still stands it is taken away and the hero
 * freed, so the strike (`tomb_collapse`: heavy magic damage and an exact Chill) finds them.
 * Broken from outside, the warning was cancelled and this never runs.
 */
export function beforeTombLanding(attack: PreparedAttack, colossus: CombatUnit, fx: BossFx): CombatUnit {
  if (attack.scripted !== 'tomb') return colossus;
  const store = useCombatStore.getState();
  const [tombId] = attack.bound ?? [];
  const tomb = tombId ? unitById(store.units, tombId) : undefined;
  if (tomb && tomb.currentHp > 0) {
    store.releaseTomb(tomb.id);
    fx.log('  ' + t('bossLog.faction.tombCollapses'), TOMB_CYAN);
  }
  return colossus;
}
