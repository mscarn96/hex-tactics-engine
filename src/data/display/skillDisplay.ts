import { skillName, skillDescription, statusName } from '@/data/gameText';
import { mantisStageDescription } from '@/data/skills/mastery/mantis';
import { bladeExtractPerBlade, bladesCap, deathMarkBonus, deathMarkTurns, deepColdMinRange, dualWieldStrikeScale, flurryScale, overloadMinShocked, reckoningBase, reckoningCap, reckoningRadius, sacredSealHeal, sharedBloomReach, sharedBloomShare, shatterpointBonus, shockChainFraction, smokeDodge, firefly as FF, beetle as beetleNumbers, mantis as mantisNumbers } from '@/systems/combat/displayNumbers';
import { ClassResource, resourceShort } from '@/data/classResource';
import { AfflictionType, AuraType, CombatUnit, EffectScaling, HeroSkill, SkillEffect, SkillTargetType, StatusEffectType } from '@/models/types';
import { STATUS_DISPLAY, statusDescription, statusDisplay } from '@/data/display/statusDisplay';
import { skillStageDescription } from '@/data/display/masteryText';
import { BALANCE } from '@/data/balanceConstants';
import { WILD_FORMS } from '@/data/templates/wildForms';
import { humanFormName, objectiveName, templateName, wildFormName } from '@/data/templates/unitText';
import { findSummonTemplate } from '@/data/templates/summonTemplates';
import { summonStatsFor } from '@/systems/combat/summoning';
import {
  calculateHealing, calculateLifesteal, healingRange, sheetLifesteal, resolveEffectMagnitude, skillDamagePreview, strikeShare,
} from '@/systems/combat/damageCalc';
import { difficultyDamage } from '@/systems/combat/runDifficulty';

import { UiMode, inkOn, paletteFor } from '@/data/display/voxelTheme';
import { damageTypeOf } from '@/systems/combat/damageType';
import { isLightningBolt } from '@/data/skills/lightningSkills';
import { formatDecimal, type MessageParams } from '@/i18n';
import { countWord, hexes, hexesGen, listText, passiveLabel, skillText as tx, statusLabel, turnsPlate, turnsText } from '@/data/display/skillWords';
import { skillLabel } from '@/data/display/simpleText';
import { reactionSummary } from '@/systems/combat/reactions';
import { hexDistance } from '@/utils/hexUtils';
import { hasPassive, passiveRank } from '@/systems/combat/passives';
import { aftershockMultiplier, carriedHeal, deepColdTurns, crumbleShred, hardenedShellDashDamage, killingFrostPen, meltwaterBarrier, overloadBonus, shadowEchoCost } from '@/systems/combat/passiveFormulas';
import { skillTargetKind } from '@/systems/combat/targetKind';
import { moteCount, moteSpec } from '@/systems/combat/fireflyRules';
import { skillModesFor } from '@/systems/combat/skillModes';
import {
  conductiveArcBonus,
  executeThresholdFraction,
  flurryFollowupsFor,
  isAffliction,
  isAreaSkill,
  isScaledMagnitude,
  requiresExecutable,
  skillEffects,
  strikeScales,
  triggersShock,
  weaponStrikes,
} from '@/systems/combat/statusEffects';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * How a skill explains itself.
 *
 * One formatter, read by the combat HUD's inspector and by the mastery tree, so
 * a skill reads the same wherever it is met. Before this the only thing on
 * screen was the skill's name on a button — a player could hold Bloodthirst for
 * twenty levels without ever learning what separated it from a basic attack.
 *
 * Kept in `data/` and free of React so it stays testable in the node
 * environment the rest of the suite runs in.
 */

/**
 * What to call a skill on the button that casts it.
 *
 * Only shift skills ever differ from `skill.name`, and they differ in the one
 * case that matters: cast while already wearing that shape, Bear Form turns you
 * back into a Druid. A button labelled "Bear Form" while you are the bear is
 * describing the shape you are in rather than the thing it will do — the same
 * word for both directions of a toggle.
 */
export function skillDisplayName(skill: HeroSkill, caster?: CombatUnit): string {
  if (!skill.shiftsTo || !caster) return skillName(skill);
  return caster.wildForm === skill.shiftsTo ? humanFormName() : skillName(skill);
}

/** The `skillText` key naming a target shape on the range chip. */
const SHAPE: Partial<Record<SkillTargetType, string>> = {
  [SkillTargetType.Self]: 'chip.shape.self',
  [SkillTargetType.Arc]: 'chip.shape.arc',
  [SkillTargetType.Ring]: 'chip.shape.area',
};

/**
 * A multiplier, as a player should read it.
 *
 * Multipliers are authored to two decimals but very few of them reach a screen
 * unaltered: a node level scales one by `LEVEL_SCALE`, a legendary set roll
 * scales it again, and `0.7 × 1.5` in binary floating point is
 * `1.0499999999999998`. The Stoneshaper's Living Stone printed exactly that,
 * three times in one panel.
 *
 * `mastery.scaleSkill` rounds at the source as well, and this is deliberately
 * the second lock rather than a redundant one: this file is the only place a
 * multiplier is ever turned into text, so anything that ever multiplies one —
 * a future modifier, a difficulty scalar, a buff — cannot leak noise onto a
 * tooltip without also having to get past here.
 *
 * Trailing zeroes are dropped, because `1.50×` reads as a precision the number
 * does not have while `2.00×` reads as a bug.
 */
export function mult(n: number): string {
  return formatDecimal(Math.round(n * 100) / 100, 2);
}

/** The short label for what a skill's damage multiplies. */
export function scalingLabel(scaling: HeroSkill['scaling']): string {
  if (scaling === 'magic') return tx('scaling.short.magic');
  if (scaling === 'hybrid') return tx('scaling.short.hybrid');
  return tx('scaling.short.attack');
}

/**
 * What kind of fact a stat chip states — which the armed skill's card draws a
 * mark for. One per clause of the stat line, so the line and the chips cannot
 * disagree about what a skill does.
 */
export type SkillStatKind = 'power' | 'heal' | 'reach' | 'self' | 'area' | 'cost' | 'free' | 'cooldown';

export interface SkillStatChip {
  kind: SkillStatKind;
  text: string;
}

/**
 * The mechanical facts about a skill, one per chip: what it multiplies, what it
 * reaches, what it costs and how long it waits.
 *
 * `skillStatLine` is these joined, rather than the chips being the line split,
 * because a split would have to guess where one fact ends — "self, 2 hexes" is
 * one fact with a comma in it.
 */
export function skillStatChips(skill: HeroSkill, resource?: ClassResource): SkillStatChip[] {
  const chips: SkillStatChip[] = [];

  if (skill.damage) {
    // Two blows at half power reads as what it is. "1.1× ATK" on a dual-wield
    // attack would tell the player they swing once, which they do not.
    // The hit type rides on the power chip: it is the defence that answers
    // the number beside it, and it is not the stat the number scales with.
    const params = { scaling: scalingLabel(skill.scaling), type: tx(`damageType.${damageTypeOf(skill)}`) };
    chips.push({
      kind: 'power',
      text: skill.dualWield
        ? tx('chip.powerDual', { ...params, mult: mult(skill.damage * dualWieldStrikeScale()) })
        : tx('chip.power', { ...params, mult: mult(skill.damage) }),
    });
  }
  if (skill.healing && skill.healingBasis === 'missingHp') {
    chips.push({ kind: 'heal', text: tx('chip.healMissing', { share: Math.round(skill.healing * 100) }) });
  } else if (skill.healing) {
    // A wound-scaled heal states both ends: one number would be false at one of them
    chips.push({
      kind: 'heal',
      text: skill.healingByMissing
        ? tx('chip.healRange', { low: mult(skill.healing * skill.healingByMissing.floor), mult: mult(skill.healing) })
        : tx('chip.heal', { mult: mult(skill.healing) }),
    });
  }

  const shape = SHAPE[skill.targetType];
  if (skill.targetType === SkillTargetType.Self) {
    // A self skill with a range is a blink or a dash — the range is where it
    // takes you, which is worth showing; a plain buff's range of 0 is not
    chips.push({ kind: 'self', text: skill.range > 0 ? tx('chip.selfRange', { count: skill.range }) : tx('chip.self') });
  } else {
    chips.push({
      kind: 'reach',
      text: shape ? tx('chip.rangeShape', { range: skill.range, shape: tx(shape) }) : tx('chip.range', { range: skill.range }),
    });
  }
  // An arc's `aoeRadius` is how far the wedge reaches out of the caster, not a
  // radius around anything, so it is named for what it is. Same field, same
  // number — a player reading "radius 3" on a shape with a flat back would be
  // told something untrue about where it lands.
  if (isAreaSkill(skill) && skill.aoeRadius) {
    chips.push({
      kind: 'area',
      text: tx(skill.targetType === SkillTargetType.Arc ? 'chip.depth' : 'chip.radius', { n: skill.aoeRadius }),
    });
  }

  chips.push(skill.manaCost > 0
    ? { kind: 'cost', text: tx('chip.cost', { cost: skill.manaCost, resource: resourceShort(resource) }) }
    : { kind: 'free', text: tx('chip.free') });
  if (skill.cooldown) chips.push({ kind: 'cooldown', text: tx('chip.cooldown', { n: skill.cooldown }) });

  return chips;
}

/** The mechanical line: what it costs and what it reaches. */
export function skillStatLine(skill: HeroSkill, resource?: ClassResource): string {
  return skillStatChips(skill, resource).map((c) => c.text).join(' · ');
}

/** What a fractional magnitude is a fraction of, as the tooltip names it. */
function powerNoun(scaling: EffectScaling | undefined): string {
  if (scaling === 'magic') return tx('power.magic');
  if (scaling === 'defense') return tx('power.defense');
  if (scaling === 'hybrid') return tx('power.hybrid');
  return tx('power.attack');
}

/** Statuses whose number is a per-turn amount, so a stated rule can say so. */
const TICKS_EACH_TURN: ReadonlySet<StatusEffectType> = new Set<StatusEffectType>([
  AfflictionType.Poison,
  AfflictionType.Bleed,
  AfflictionType.Burn,
]);

/**
 * The number beside a status on a skill tooltip.
 *
 * A fraction authored against the caster's power (Ignite's Burn 0.3) is
 * resolved at cast time by `resolveEffectMagnitude`, so the tooltip resolves it
 * the same way when it knows the caster — and the same function, so the number
 * is the first tick the fight will show. Formatting the authored 0.3 directly
 * rounded it to "0/turn". With no caster (the mastery tree) it states the rule.
 */
function effectMagnitudeText(
  applied: SkillEffect,
  skill: HeroSkill,
  caster?: CombatUnit,
): string | undefined {
  const display = statusDisplay(applied.type);
  // Canopy Guard's bark is a share of whoever receives it, never of the caster
  if (applied.ofRecipientMaxHp) return tx('effect.ofRecipientHp', { share: Math.round(applied.magnitude * 100) });
  // Two statuses carry a number the generic formatter has no word for, and both
  // scale with the node's rank, so a tooltip that stayed silent hid what a point buys.
  if (applied.type === AfflictionType.Taunt) {
    // Threat: when two taunts compete, the larger one wins
    return tx('effect.threat', { n: Math.round(applied.magnitude) });
  }
  if (applied.type === AuraType.Envenomed) {
    // A coating's dose is poison authored as a fraction of attack, resolved per strike
    return caster
      ? tx('effect.envenomed', { n: resolveEffectMagnitude(AfflictionType.Poison, applied.magnitude, caster, 'attack') })
      : tx('effect.envenomedShare', { share: Math.round(applied.magnitude * 100) });
  }
  // With a caster, every magnitude goes through the function the cast uses, not
  // only the fractional ones. A *flat* Barrier (Reposition's 18) is not scaled
  // by attack, but it is still amplified by the caster's `shieldPower` and the
  // Bulwark's Anchored — and a tooltip that printed the authored 18 beside a
  // shield that landed as 20 is the preview and the combat disagreeing.
  if (caster) {
    const resolved = resolveEffectMagnitude(applied.type, applied.magnitude, caster, applied.scaling ?? skill.scaling);
    // A tick is damage, and an enemy's is taken at the campaign difficulty — the
    // same number the sentence above states and the fight floats each turn
    const landed = TICKS_EACH_TURN.has(applied.type) || applied.type === AfflictionType.Doom
      ? difficultyDamage(resolved, caster)
      : resolved;
    return display.format?.(landed);
  }
  if (!isScaledMagnitude(applied.type, applied.magnitude)) {
    return display.format?.(applied.magnitude);
  }
  const params = { share: Math.round(applied.magnitude * 100), power: powerNoun(applied.scaling ?? skill.scaling) };
  return tx(TICKS_EACH_TURN.has(applied.type) ? 'effect.sharePerTurn' : 'effect.share', params);
}

/**
 * What the Hydromancer's control-to-damage nodes change about *this* skill, from the
 * same functions the cast reads, so the preview names the tradeoff the fight will
 * actually make. Empty for a caster who owns none of them and for a skill they do
 * not touch.
 */
function hydromancerLines(skill: HeroSkill, caster: CombatUnit): string[] {
  const lines: string[] = [];

  const applied = skillEffects(skill);
  const chills = applied.find((e) => e.type === AfflictionType.Chill);
  const freezes = (!!chills && !chills.exact) || applied.some((e) => e.type === AfflictionType.Freeze);

  if (chills && hasPassive(caster, 'deepCold')) {
    const extra = deepColdTurns(passiveRank(caster, 'deepCold'));
    lines.push(tx('line.deepCold', {
      name: passiveLabel('deepCold'), turns: turnsText(chills.duration + extra), hexes: hexesGen(deepColdMinRange()),
    }));
  }
  if (freezes && hasPassive(caster, 'meltwater')) {
    const barrier = resolveEffectMagnitude(
      AuraType.Barrier, meltwaterBarrier(passiveRank(caster, 'meltwater')), caster, 'magic',
    );
    lines.push(tx('line.meltwater', { name: passiveLabel('meltwater'), barrier }));
  }
  if (skill.damage && hasPassive(caster, 'shatterpoint')) {
    const share = Math.round(shatterpointBonus() * passiveRank(caster, 'shatterpoint').scale * 100);
    lines.push(tx('line.shatterpoint', { name: passiveLabel('shatterpoint'), share }));
  }
  if (skill.damage && damageTypeOf(skill) === 'magic' && hasPassive(caster, 'killingFrost')) {
    lines.push(tx('line.killingFrost', {
      name: passiveLabel('killingFrost'), pen: killingFrostPen(passiveRank(caster, 'killingFrost')),
    }));
  }
  return lines;
}

/**
 * The Stormcaller's Overload, on the bolts it charges. A bolt says what the charge is
 * worth, and says so again, with the live number, while the caster is holding one; a
 * caster without the node sees nothing.
 */
function stormcallerLines(skill: HeroSkill, caster: CombatUnit): string[] {
  const lines: string[] = [];
  const conductive = conductiveArcBonus(caster, skill);
  if (conductive > 0) {
    const share = Math.round(shockChainFraction() * (1 + conductive) * 100);
    lines.push(tx('line.conductiveArc', { name: passiveLabel('conductiveArc'), skill: skillLabel('arc'), share }));
  }
  if (!isLightningBolt(skill)) return lines;
  const held = caster.activeEffects.find((e) => e.type === AuraType.Overloaded);
  if (held) return [...lines, tx('line.overloaded', { name: statusLabel(AuraType.Overloaded), share: Math.round(held.magnitude * 100) })];
  if (!hasPassive(caster, 'overload')) return lines;
  const bonus = Math.round(overloadBonus(passiveRank(caster, 'overload')) * 100);
  return [
    ...lines,
    tx('line.overload', { name: passiveLabel('overload'), share: bonus, n: overloadMinShocked() }),
  ];
}

/**
 * Aimed Shot's Detailed lines: the two uses, the distance curve at this rank, the
 * resolved damage at the aimed enemy's current distance when there is one, and
 * the cancellation and cooldown rules.
 */
function aimedShotLines(skill: HeroSkill, caster?: CombatUnit, units?: readonly CombatUnit[]): string[] {
  const release = skill.releasing ? skill : { ...skill, ...skill.charge!.release };
  const base = release.damage ?? 0;
  const ref = release.distanceScale ?? BALANCE.AIMED_SHOT_REFERENCE_DISTANCE;
  const at = (d: number) => mult(round2(base * d / ref));
  const lines = [
    skill.releasing
      ? tx('aimed.release')
      : tx('aimed.aim', { hexes: hexesGen(skill.range) }),
    tx('aimed.damage', {
      base: mult(base), ref: hexesGen(ref), at2: at(2), at6: at(6), at9: at(9), marked: mult(release.bonusVs?.multiplier ?? 1),
    }),
  ];
  const aim = caster?.activeEffects.find((e) => e.type === AuraType.Aiming);
  const prey = aim && (units ?? []).find((u) => u.id === aim.aimAt && u.currentHp > 0);
  if (caster && prey) {
    const d = hexDistance(caster.position, prey.position);
    lines.push(tx('aimed.now', { name: prey.name, hexes: hexes(d), mult: at(d) }));
  }
  lines.push(tx('aimed.wait'), tx('aimed.cooldown', { turns: turnsText(skill.cooldown ?? 0) }));
  return lines;
}

/**
 * The Skirmisher remaster's Detailed lines: blades left, Blade Recall's throw
 * and pull, Knife Dance's route and Smoke Bomb's cloud.
 */
function skirmisherLines(skill: HeroSkill, caster?: CombatUnit): string[] {
  const lines: string[] = [];
  const cap = bladesCap(caster);
  if (skill.extractsBlades) {
    const fan = caster && hasPassive(caster, 'fanOfBlades') ? passiveRank(caster, 'fanOfBlades').scale : undefined;
    const fanName = passiveLabel('fanOfBlades');
    lines.push(tx('blades.pull', { mult: mult(bladeExtractPerBlade()) }));
    lines.push(fan !== undefined
      ? tx('blades.fan', { name: fanName, mult: mult(round2((skill.damage ?? 0) * fan)) })
      : tx('blades.fanRule', { name: fanName }));
    lines.push(tx('blades.flurry', {
      name: skillLabel('flurry'), count: flurryFollowupsFor(skill), knives: flurryFollowupsFor(skill), share: Math.round(flurryScale() * 100),
    }));
    lines.push(tx('blades.cap', { cap }));
  } else if (skill.embedsBlades) {
    lines.push(tx('blades.embeds', {
      count: skill.embedsBlades, n: countWord(skill.embedsBlades), cap, flurry: skillLabel('flurry'), recall: skillLabel('blade_recall'),
    }));
  }
  if (skill.knifeDance) {
    lines.push(tx('knifeDance.route', { hexes: hexesGen(skill.range), dash: hexesGen(skill.chainRange ?? 2) }),
      tx('knifeDance.end'));
  }
  const smoke = skillEffects(skill).find((e) => e.type === AuraType.SmokeCover);
  if (smoke) {
    lines.push(tx('smoke.cloud', { hexes: hexesGen(skill.aoeRadius ?? 1), count: smoke.duration, dodge: smokeDodge() }));
  }
  return lines;
}

/**
 * The Shadowblade remaster's Detailed lines: Shadowstep's two halves and its
 * Shadow Echo, and Assassinate's Death Mark with the caster's real threshold.
 */
function shadowbladeLines(skill: HeroSkill, caster?: CombatUnit): string[] {
  const lines: string[] = [];
  if (skill.id === 'shadowstep') {
    lines.push(tx('shadowstep.halves', { range: skill.range }));
    if (caster && hasPassive(caster, 'shadowEcho')) {
      lines.push(tx('shadowstep.echo', {
        name: passiveLabel('shadowEcho'), skill: skillName(skill), mana: shadowEchoCost(),
      }));
    }
  }
  if (skill.deathMark) {
    lines.push(tx('deathMark.mark', { share: Math.round(deathMarkBonus() * 100) }),
      caster
        ? tx('deathMark.check', { count: deathMarkTurns(), share: Math.round(executeThresholdFraction(caster) * 100) })
        : tx('deathMark.checkRule', { count: deathMarkTurns() }),
      tx('deathMark.execution'));
  }
  return lines;
}

/**
 * The Firefly's Detailed lines (the private project notes, "### Firefly"): the
 * rules the derived sentence has no words for — who the mote and the bond reach,
 * what a mote on the ground waits for, the Beacon's turn and its light.
 */
function fireflyLines(skill: HeroSkill, caster?: CombatUnit): string[] {
  const F = FF();
  const lines: string[] = [];
  if (skill.mote) {
    const spec = (caster && moteSpec(caster, skill)) || skill.mote;
    const twin = !!caster && moteCount(caster) > 1;
    const params = { share: Math.round(spec.share * 100), reach: spec.reach };
    lines.push(twin
      ? tx('firefly.moteMany', { ...params, n: moteCount(caster!) })
      : tx('firefly.mote', params));
  }
  if (skillEffects(skill).some((e) => e.type === AuraType.Lightbond)) {
    lines.push(tx('firefly.bond'));
  }
  if (skill.id === 'purifying_light') {
    lines.push(tx('firefly.purifying'));
  }
  if (skill.sparesCaster) {
    lines.push(tx('firefly.sparesCaster'));
  }
  if (skill.freeAction) {
    lines.push(tx('firefly.freeAction'));
  }
  if (skill.motes) {
    lines.push(tx('firefly.motes', { heal: mult(skill.motes.heal), attack: F.MOTE_ATTACK, crit: F.MOTE_CRIT }));
  }
  if (skill.id === 'firefly_swarm') {
    lines.push(tx('firefly.swarmBoss'));
  }
  if (skill.summons?.templateId === 'lantern_beacon') {
    lines.push(tx('firefly.beacon', {
      hp: Math.round(F.BEACON_HP_SHARE * 100), radius: F.BEACON_RADIUS, heal: mult(F.BEACON_HEAL),
    }), tx('firefly.beaconLight', {
      a: skillLabel('glowmote'), b: skillLabel('lantern_sweep'), c: skillLabel('purifying_light'), d: skillLabel('lantern_glide'),
      radius: F.BEACON_RADIUS, crit: F.BEACON_CRIT, exposed: Math.round(F.BEACON_EXPOSED * 100),
    }));
  }
  return lines;
}

/**
 * The Beetle's and the Mantis's signatures in the Detailed view: the charge, the
 * soak, the Bleed reap and what a held node adds to them. The Simple line said all
 * of it and the derived sentence none, so Detailed read shorter than Simple
 * (playtest 2026-10-30); every Simple branch has its line here.
 */
function monkSignatureLines(skill: HeroSkill, caster?: CombatUnit): string[] {
  const lines: string[] = [];
  if (skill.id === 'iron_carapace') {
    lines.push(tx('beetle.carapace', { max: beetleNumbers().CARAPACE_MAX, defense: beetleNumbers().CARAPACE_DEFENSE }));
    if (caster && hasPassive(caster, 'hardenedShell')) {
      lines.push(tx('beetle.hardenedShell', {
        name: passiveLabel('hardenedShell'),
        share: Math.round(hardenedShellDashDamage(passiveRank(caster, 'hardenedShell')) * 100),
      }));
    }
  }
  if (skill.id === 'twin_reap') {
    lines.push(tx('mantis.reap'));
    if (caster && hasPassive(caster, 'bleedHarvest')) lines.push(tx('mantis.harvest', { name: passiveLabel('bleedHarvest') }));
    if (caster && hasPassive(caster, 'reapingMomentum')) {
      const step = mantisNumbers().MOMENTUM_STEP * passiveRank(caster, 'reapingMomentum').scale;
      lines.push(tx('mantis.momentum', {
        name: passiveLabel('reapingMomentum'), bonus: Math.round(step * 100), count: mantisNumbers().MOMENTUM_MAX_STACKS,
      }));
    }
  }
  return lines;
}

/**
 * The extras a description sentence tends to leave out.
 *
 * Deliberately short and mechanical — the flavour is already in
 * `skill.description`, and repeating it here would double the height of every
 * tooltip in the game.
 */
export function skillEffectLines(
  skill: HeroSkill,
  /**
   * The unit that would cast it, when one exists.
   *
   * Only needed by lines whose value depends on who is holding the skill —
   * today that is the execution window, which scales with attack. The mastery
   * tree has no unit to offer (the hero is not in a fight), so those lines fall
   * back to naming the rule instead of the number.
   */
  caster?: CombatUnit,
  /** The board, when there is one: Aimed Shot states the aimed enemy's distance. */
  units?: readonly CombatUnit[],
): string[] {
  const lines: string[] = [];
  if (skill.id === 'righteous_fury') {
    const amount = skillEffects(skill).find(e => e.type === AuraType.BlessedWeapon)?.magnitude ?? BALANCE.FURY_PER_STACK;
    const carried = caster?.activeEffects.find(e => e.type === AuraType.BlessedWeapon);
    lines.push(tx('fury.blessed', { smite: skillLabel('smite'), amount }),
      tx('fury.stacks', { max: amount * 3, current: carried?.stacks ?? 0 }));
  }
  if (skill.id === 'sanction') {
    const effect = skillEffects(skill).find(e => e.type === AfflictionType.SacredSeal);
    const damage = caster && effect ? resolveEffectMagnitude(effect.type, effect.magnitude, caster, 'hybrid') : tx('seal.damageRule');
    const heal = caster ? calculateHealing(caster, { ...skill, healing: sacredSealHeal() }) : tx('seal.healRule');
    lines.push(tx('seal.hit', { name: statusLabel(AfflictionType.SacredSeal), damage, heal }), tx('seal.rules'));
  }
  if (skillEffects(skill).some((e) => e.type === AuraType.Reckoning)) {
    lines.push(tx('reckoning.wave', { base: mult(reckoningBase()), cap: mult(reckoningCap()), hexes: hexesGen(reckoningRadius()) }),
      tx('reckoning.soak'));
  }
  if (skill.selfMove?.kind === 'dash' && skill.targetType === SkillTargetType.Arc) {
    lines.push(tx('arcDash.landing'), tx('arcDash.unstunnable'));
  }
  if (skill.barrage) {
    lines.push(tx('barrage.shards', { count: skill.barrage }), tx('barrage.freeze'));
  }
  if (skill.charge?.aimed) {
    lines.push(...aimedShotLines(skill, caster, units));
  } else if (skill.charge) {
    const release = skill.charge.release;
    const params = { count: release.repeats ?? 1, mult: mult(release.damage ?? 0), cooldown: release.cooldown ?? 0 };
    lines.push(tx('charge.hold'),
      tx(release.beam ? 'charge.releaseBeam' : 'charge.releaseStrike', params),
      tx('charge.break'));
  }
  if (skill.releasing && !skill.charge?.aimed) {
    lines.push(tx('charge.fires'));
  }
  lines.push(...skirmisherLines(skill, caster));
  lines.push(...shadowbladeLines(skill, caster));
  lines.push(...fireflyLines(skill, caster));
  lines.push(...monkSignatureLines(skill, caster));
  if (skill.chainFalloff) {
    const second = Math.round(skill.chainFalloff * 100);
    const third = Math.round(skill.chainFalloff ** 2 * 100);
    lines.push(tx('chain.bounces', { count: skill.chainJumps ?? 0, hexes: hexesGen(skill.chainRange ?? 2) }),
      tx('chain.falloff', { second, third }));
  }
  if (skill.sanctuary) {
    const { turns, rootTurns } = skill.sanctuary;
    lines.push(tx('sanctuary.pulses', { count: turns, heal: mult(skill.healing ?? 0), damage: mult(skill.damage ?? 0) }),
      tx('sanctuary.root', { turns: turnsText(rootTurns) }));
  }
  // ── Stoneshaper remaster (2026-10) ──
  if (skill.id === 'tremor' && caster && hasPassive(caster, 'aftershock')) {
    lines.push(tx('line.aftershock', {
      name: passiveLabel('aftershock'), mult: mult(aftershockMultiplier(passiveRank(caster, 'aftershock'))),
    }));
  }
  if (caster && hasPassive(caster, 'crumble')
    && skillEffects(skill).some((e) => e.type === AfflictionType.Stun || e.type === AfflictionType.Root)) {
    lines.push(tx('line.crumble', { name: passiveLabel('crumble'), shred: crumbleShred(passiveRank(caster, 'crumble')) }));
  }
  if (skill.summons?.stages && skill.summons.stages.length > 1) {
    lines.push(tx('stages.casts', { count: skill.summons.stages.length }), tx('stages.standing'));
  }
  if (skill.arenaWide && skillTargetKind(skill) === 'mixed') {
    lines.push(tx('arenaWide.mixed'));
  }
  if (skill.id === 'lifebloom_skill' && caster && hasPassive(caster, 'sharedBloom')) {
    const share = Math.round(sharedBloomShare() * passiveRank(caster, 'sharedBloom').scale * 100);
    lines.push(tx('line.sharedBloom', {
      name: passiveLabel('sharedBloom'), hexes: hexesGen(sharedBloomReach()), share, skill: skillName(skill),
    }));
  }
  if (skill.places?.kind === 'rampart') {
    lines.push(tx('rampart.rocks', {
      hp: Math.round(skill.places.hpFraction * 100), defense: skill.places.defense ?? 0, count: skill.places.turnsLeft ?? 0,
    }), tx('rampart.blocks'));
  }

  if (requiresExecutable(skill)) {
    lines.push(
      caster
        ? tx('require.executable', { share: Math.round(executeThresholdFraction(caster, undefined, skill) * 100) })
        : tx('require.executableRule'),
    );
  }

  // One line per requirement, and never folded together: a skill the player
  // cannot press needs to say *which* condition is missing, not that some
  // unnamed one is.
  if (skill.requiresTarget?.includes('poisoned')) {
    lines.push(tx('require.poisoned'));
  }

  if (skill.amplifiedBy?.status === AfflictionType.Blades) {
    lines.push(tx('amplified.blades', {
      per: Math.round(skill.amplifiedBy.per * 100), max: Math.round(skill.amplifiedBy.max * 100),
    }));
  } else if (skill.amplifiedBy) {
    lines.push(tx('amplified.status', {
      max: Math.round(skill.amplifiedBy.max * 100), status: statusLabel(skill.amplifiedBy.status),
    }));
  }

  // Zeal's choice, said from the same specs the resolver derives from. On the
  // plain skill it names both options; on a derived copy it names the one chosen.
  if (skill.modeChoice && caster) {
    const modes = skillModesFor(caster, skill);
    if (skill.mode) {
      const chosen = modes.find((m) => m.id === skill.mode);
      if (chosen) lines.push(tx('modes.chosen', { label: chosen.label, summary: chosen.summary, skill: skillName(skill) }));
    } else if (modes.length > 0) {
      lines.push(tx('modes.choose', {
        list: modes.map((m) => tx('modes.option', { label: m.label, summary: m.summary })).join(' · '),
      }));
    }
  }

  if (skill.dualWield) {
    lines.push(tx('dualWield'));
  }

  if (skill.occupiedVariant) {
    lines.push(tx('occupiedVariant'));
  }

  if (skill.grantsOnKill) {
    lines.push(tx('onKill', { status: statusLabel(skill.grantsOnKill.type) }));
  }

  // One line per status. A skill that lands two of them is describing two
  // things it does, and folding them into one sentence would hide the second.
  for (const applied of skillEffects(skill)) {
    const magnitude = effectMagnitudeText(applied, skill, caster);
    const duration =
      applied.duration < 0 || applied.duration >= 99
        ? tx('effect.permanent')
        : turnsPlate(applied.duration);
    // A chance is the first thing to say about an entry that carries one — a
    // stun the player reads as certain is a plan they will make once
    const params: MessageParams = { status: statusLabel(applied.type), duration };
    if (magnitude) params.magnitude = magnitude;
    if (applied.chance !== undefined) params.chance = Math.round(applied.chance * 100);
    // A status whose clock is internal (the Vanish wind-up's Ambush) states its magnitude alone
    const key = magnitude && STATUS_DISPLAY[applied.type]?.hideDuration
      ? 'effect.appliesMagnitudeOnly'
      : applied.chance !== undefined
        ? (magnitude ? 'effect.appliesChanceMagnitude' : 'effect.appliesChance')
        : (magnitude ? 'effect.appliesMagnitude' : 'effect.applies');
    lines.push(tx(key, params), statusDescription(applied.type));
  }
  /**
   * Gear turns lifesteal from a property of *this spell* into a property of
   * *this hero*, so the line has to be able to appear on a skill carrying none
   * of its own — otherwise the stat is invisible on exactly the at-will swing it
   * is most often drained through. With no caster in scope (the mastery tree)
   * nothing is added, and the line reads as it always did.
   */
  const gearDrain = caster && skill.damage ? sheetLifesteal(caster.stats) : 0;
  const drain = (skill.lifesteal ?? 0) + gearDrain;
  if (drain > 0) lines.push(tx('lifesteal', { share: Math.round(drain * 100) }));

  /**
   * What the caster's gear is adding, said on the skill it is added to.
   *
   * Each of these three amplifies exactly one kind of payload, so the skill is
   * the only place the number is legible — a stat that appears on the hero sheet
   * alone is a stat the player has to do arithmetic to believe in, and "heal
   * power" next to a heal that has not visibly changed reads as broken.
   */
  if (caster) {
    const applied = skillEffects(skill).map((e) => e.type);
    const fromGear: [number, boolean, string][] = [
      [caster.stats.healPower ?? 0, !!skill.healing, 'gear.healing'],
      [caster.stats.shieldPower ?? 0, applied.includes(AuraType.Barrier), 'gear.shielding'],
      [caster.stats.poisonPower ?? 0, applied.includes(AfflictionType.Poison), 'gear.poison'],
    ];
    for (const [value, relevant, key] of fromGear) {
      if (value > 0 && relevant) lines.push(tx(key, { share: Math.round(value) }));
    }
  }
  if (caster) lines.push(...hydromancerLines(skill, caster), ...stormcallerLines(skill, caster));
  if (skill.bonusVs) {
    lines.push(tx(`bonusVs.${skill.bonusVs.condition}`, { mult: mult(skill.bonusVs.multiplier) }));
  }
  if (skill.detonates) {
    const status = statusLabel(skill.detonates.status);
    lines.push(tx(skill.detonates.consume ? 'detonates.consume' : 'detonates.against', { status }));
  }
  if (skill.selfMove) lines.push(tx(`selfMove.${skill.selfMove.kind}`, { hexes: hexesGen(skill.selfMove.range) }));
  if (skill.pushDistance) lines.push(tx('push', { hexes: hexes(skill.pushDistance) }));
  if (skill.collisionEffect) {
    lines.push(tx('collision', {
      status: statusLabel(skill.collisionEffect.type), turns: turnsText(skill.collisionEffect.duration),
    }));
  }
  if (skill.prepares) {
    lines.push(tx('prepares.announced'));
    const cancels = [...(skill.prepares.interruptedBy ?? [])].map((k) => tx(`prepares.by.${k}`));
    if (skill.prepares.tauntCancels) cancels.push(tx('prepares.by.taunt'));
    lines.push(cancels.length > 0 ? tx('prepares.interrupted', { list: cancels.join(', ') }) : tx('prepares.uninterruptible'));
  }
  if (skill.reaction?.shotsPerRound) {
    const spec = skill.reaction;
    lines.push(tx('watch.shoot', {
      count: spec.duration, hexes: hexesGen(spec.response.range), mult: mult(spec.response.damage ?? 0),
    }),
    tx('watch.shots', { count: spec.shotsPerRound ?? 0 }),
    tx('watch.own', { settle: passiveLabel('settleIn') }));
  } else if (skill.reaction) {
    const spec = skill.reaction;
    lines.push(tx('reaction.spends'));
    lines.push(tx('reaction.answer', { summary: reactionSummary(skill), skill: skillName(spec.response) }));
    lines.push(tx('reaction.expires'));
  }
  if (skill.places) {
    const spec = skill.places;
    lines.push(tx('places.raises', { count: spec.count, name: objectiveName(spec.kind, spec.name) }));
  }
  if (skill.healingByMissing && skill.healing) {
    const range = caster ? healingRange(caster, skill) : undefined;
    lines.push(range ? tx('heal.byMissing', { min: range.min, max: range.max }) : tx('heal.byMissingRule'));
  }
  if (skill.cleanse) lines.push(tx('cleanse'));
  // The revised Shock rule, on every skill that can set the jump off
  if (skill.damage && triggersShock(skill)) {
    lines.push(tx('shockJump', { share: Math.round(shockChainFraction() * 100) }));
  }
  if (skill.summons) {
    const params = {
      count: skill.summons.count, name: templateName(skill.summons.templateId),
      turns: turnsText(skill.summons.duration ?? 0), strength: Math.round((skill.summons.statScale ?? 1) * 100),
    };
    // A ranked summon says how strong this rung makes it, so the tree can compare
    const strength = skill.summons.statScale !== undefined ? '.strength' : '';
    lines.push(tx(`summon.calls${skill.summons.duration ? '.timed' : ''}${strength}`, params));
    // A summon that burns down and goes off says both: they are its whole clock and payoff
    const template = findSummonTemplate(skill.summons.templateId);
    if (skill.summons.arrivalEffect?.kind === 'damage') {
      lines.push(tx('summon.arrival', { hexes: hexesGen(skill.summons.arrivalEffect.radius) }));
    }
    if (template?.decayFraction) {
      lines.push(tx('summon.decay', { share: Math.round(template.decayFraction * 100) }));
    }
    if (template?.companion) {
      const share = Math.round((skill.summons.echoMagic ?? 0) * 100);
      const hp = summonStatsFor(template, 1, skill.summons.statScale).maxHp;
      lines.push(
        tx('companion.magic', { share, hp }),
        tx('companion.follows'),
        tx('companion.lasts', { count: skill.summons.duration ?? 0 }),
        tx('companion.echoes'),
      );
    }
    if (template?.deathBurst) {
      const burst = template.deathBurst;
      const params = { mult: mult(burst.amount), hexes: hexesGen(burst.radius) };
      lines.push(burst.effect
        ? tx('summon.burstRider', {
          ...params, status: statusLabel(burst.effect.type), turns: turnsText(burst.effect.duration),
        })
        : tx('summon.burst', params));
    }
  }
  // Form skills sit on the hero sheet alongside everything else the tree grants,
  // so without this a Druid reads Ground Slam as a button they simply never
  // have — the requirement is the whole reason it is not on the bar.
  if (skill.formSkill) {
    lines.push(tx('form.only', { form: wildFormName(skill.formSkill) }));
  }

  if (skill.shiftsTo) {
    lines.push(tx(caster?.wildForm === skill.shiftsTo ? 'form.wearing' : 'form.return'));
  }

  return lines;
}

// ─── The derived description ──────────────────────────────────────────────────

/** What a skill's damage multiplies, said in words rather than in stat keys. */
function scalingNoun(scaling: HeroSkill['scaling']): string {
  if (scaling === 'magic') return tx('scaling.noun.magic');
  if (scaling === 'hybrid') return tx('scaling.noun.hybrid');
  return tx('scaling.noun.attack');
}

/** Where a hostile payload lands, as prose (the object of "strike", "lay … on"). */
function enemyReach(skill: HeroSkill): string {
  if (skill.randomEnemies) {
    return tx('reach.enemy.random', {
      count: skill.randomEnemies, radius: hexesGen(skill.aoeRadius ?? 0), range: hexesGen(skill.range),
    });
  }
  if (skill.arenaWide) return tx('reach.enemy.arena');
  switch (skill.targetType) {
    case SkillTargetType.Single:
      return skill.range <= 1 ? tx('reach.enemy.near') : tx('reach.enemy.single', { hexes: hexesGen(skill.range) });
    case SkillTargetType.Chain:
      return tx('reach.enemy.chain', { count: skill.chainJumps ?? 1 });
    case SkillTargetType.Arc:
      return tx('reach.enemy.arc', { depth: skill.aoeRadius ?? 1 });
    case SkillTargetType.Line:
      return tx('reach.enemy.line', { range: skill.range });
    case SkillTargetType.Cross:
      return tx('reach.enemy.cross', { hexes: hexesGen(skill.aoeRadius ?? 1) });
    case SkillTargetType.Ring:
      return skill.range === 0
        ? tx('reach.enemy.aroundYou', { hexes: hexesGen(skill.aoeRadius ?? 1) })
        : tx('reach.enemy.aroundHex', { hexes: hexesGen(skill.aoeRadius ?? 1) });
    case SkillTargetType.Self:
      return tx('reach.enemy.aroundYou', { hexes: hexesGen(skill.aoeRadius ?? 1) });
    default:
      return tx('reach.enemy.target');
  }
}

/** Whether a friendly payload lands on the caster alone. */
const onlySelf = (skill: HeroSkill) => !skill.arenaWide && skill.targetType === SkillTargetType.Self && !skill.aoeRadius;

/** `allyReach` as the object of a verb the caster does to themself: "mend yourself". */
const mendReach = (skill: HeroSkill) => (onlySelf(skill) ? tx('reach.ally.yourself') : allyReach(skill));

/** Where a friendly payload lands, as prose. */
function allyReach(skill: HeroSkill): string {
  if (skill.arenaWide) return tx('reach.ally.arena');
  if (onlySelf(skill)) return tx('reach.ally.you');
  if (skill.targetType === SkillTargetType.Self || skill.range === 0) {
    return tx('reach.ally.aroundYou', { hexes: hexesGen(skill.aoeRadius ?? 1) });
  }
  // Lay on Hands: the aimed ally and the caster, each healed in full
  if (skill.targetType === SkillTargetType.Single && skill.healsCaster) {
    return tx('reach.ally.andYourself', { hexes: hexesGen(skill.range) });
  }
  if (skill.targetType === SkillTargetType.Single) {
    return tx('reach.ally.single', { hexes: hexesGen(skill.range) });
  }
  return tx('reach.ally.area');
}

/**
 * What a number in a skill's sentence states, which decides its colour: a
 * blow by the defence that answers it, a mend, a shield, or a status that
 * ticks (drawn in that status's own colour — see `skillTextColor`).
 */
export type SkillTextKind = 'physical' | 'magic' | 'heal' | 'shield' | 'status';

/**
 * One run of a skill's sentence. Plain prose carries no `kind`; a computed
 * number carries the kind of payload it is, and a status number names its
 * status so the renderer can colour it.
 */
export interface SkillTextSegment {
  text: string;
  kind?: SkillTextKind;
  status?: StatusEffectType;
}

/** The colour a segment is drawn in, or `undefined` for the sentence's own ink. */
export function skillTextColor(segment: SkillTextSegment, mode: UiMode): string | undefined {
  // The payload colours of the mode, and a status colour made legible on that mode's panel
  const payload = paletteFor(mode).payload;
  switch (segment.kind) {
    case 'physical': return payload.physical;
    case 'magic': return payload.magic;
    case 'heal': return payload.heal;
    case 'shield': return payload.shield;
    case 'status':
      // A status colour is an identity colour, picked for the board rather
      // than for type — lifted until it reads on a panel, as every other one is
      if (!segment.status) return undefined;
      return inkOn(statusDisplay(segment.status).color, paletteFor(mode).surface.panel);
    default: return undefined;
  }
}

/** The segments as one plain string — for logs, tests and anywhere colour is not drawn. */
export function segmentsText(segments: readonly SkillTextSegment[]): string {
  return segments.map((s) => s.text).join('');
}

type Clause = SkillTextSegment[];
const say = (text: string): SkillTextSegment => ({ text });
const num = (value: number | string, kind: SkillTextKind, status?: StatusEffectType): SkillTextSegment =>
  (status ? { text: String(value), kind, status } : { text: String(value), kind });

/**
 * A `skillText` sentence as segments. `marks` are placeholders filled with
 * segments (a coloured number, or a whole clause) rather than plain text, so a
 * language can put each where its word order needs it.
 */
function phrase(key: string, params: MessageParams = {}, marks: Record<string, Clause | SkillTextSegment> = {}): Clause {
  const filled: MessageParams = { ...params };
  for (const name of Object.keys(marks)) filled[name] = `\u0000${name}\u0000`;
  const out: Clause = [];
  tx(key, filled).split('\u0000').forEach((part, i) => {
    if (i % 2 === 0) {
      if (part) out.push(say(part));
    } else {
      const mark = marks[part];
      out.push(...(Array.isArray(mark) ? mark : [mark]));
    }
  });
  return out;
}

/** Statuses whose number is damage dealt each turn, by the `skillText` verb that lays one. */
const DOT_VERB: Partial<Record<StatusEffectType, string>> = {
  [AfflictionType.Burn]: 'burn',
  [AfflictionType.Poison]: 'poison',
  [AfflictionType.Bleed]: 'bleed',
};

const duration = (n: number) =>
  (n < 0 || n >= 99 ? tx('describe.forGood') : tx('describe.forTurns', { count: n }));

/**
 * A ticking status's per-turn number from this caster: the magnitude the cast
 * lands (`resolveEffectMagnitude`), then the campaign difficulty an enemy's
 * tick is taken at — the number that will float off the target each turn.
 */
function dotPerTurn(applied: SkillEffect, skill: HeroSkill, caster: CombatUnit): number {
  return difficultyDamage(
    resolveEffectMagnitude(applied.type, applied.magnitude, caster, applied.scaling ?? skill.scaling),
    caster,
  );
}

/** The chance a status carries, as a parameter, or nothing for a certain one. */
const oddsOf = (applied: SkillEffect): MessageParams =>
  (applied.chance !== undefined ? { chance: Math.round(applied.chance * 100) } : {});

/** "burn them for **4** per turn for 3 turns" — a DoT as an imperative, aimed at `who`. */
function dotClause(applied: SkillEffect, skill: HeroSkill, caster: CombatUnit, who: string): Clause {
  return phrase(
    applied.chance !== undefined ? `describe.dotChance.${DOT_VERB[applied.type]!}` : `describe.dot.${DOT_VERB[applied.type]!}`,
    { ...oddsOf(applied), who, duration: duration(applied.duration) },
    { n: num(dotPerTurn(applied, skill, caster), 'status', applied.type) },
  );
}

/** "shield them for **16** for 3 turns". */
function shieldClause(applied: SkillEffect, skill: HeroSkill, caster: CombatUnit, who: string): Clause {
  return phrase(
    applied.chance !== undefined ? 'describe.shieldChance' : 'describe.shield',
    { ...oddsOf(applied), who, duration: duration(applied.duration) },
    { n: num(resolveEffectMagnitude(applied.type, applied.magnitude, caster, applied.scaling ?? skill.scaling), 'shield') },
  );
}

/** The statuses that carry a number the sentence can state when it has a caster. */
const isDot = (e: SkillEffect) => DOT_VERB[e.type] !== undefined;
const isShield = (e: SkillEffect) => e.type === AuraType.Barrier;

/** "strike one enemy within reach" — with a comma closing an aside (a chain's, a cross's) before "for". */
function strikeWhom(skill: HeroSkill): string {
  const reach = enemyReach(skill);
  return tx(reach.includes(',') ? 'describe.strikeAside' : 'describe.strike', { reach });
}

/**
 * The damage clause with this caster's numbers: one full strike from
 * `skillDamagePreview`, cut into the passes (`strikeScales`) and hands
 * (`weaponStrikes`) the resolver will land, each rounded as it rounds one.
 */
function damageClause(skill: HeroSkill, caster: CombatUnit): Clause {
  const full = skillDamagePreview(caster, skill);
  const blows = strikeScales(caster, skill).flatMap((pass) =>
    weaponStrikes(skill, caster).map((hand) => strikeShare(full, pass * hand)),
  );
  const kind: SkillTextKind = damageTypeOf(skill) === 'magic' ? 'magic' : 'physical';
  const area = skill.targetType !== SkillTargetType.Single;
  const strike = strikeWhom(skill);
  let clause: Clause;
  if (blows.length === 1) {
    clause = phrase(area ? 'describe.damageArea' : 'describe.damage', { strike }, { n: num(blows[0], kind) });
  } else if (blows.every((b) => b === blows[0])) {
    const times = blows.length === 2 ? tx('describe.twice') : tx('describe.times', { count: blows.length });
    clause = phrase(area ? 'describe.damageEachArea' : 'describe.damageEach', { strike, times }, { n: num(blows[0], kind) });
  } else {
    const sum: Clause = [];
    blows.forEach((b, i) => {
      if (i > 0) sum.push(say(' + '));
      sum.push(num(b, kind));
    });
    clause = phrase(area ? 'describe.damageArea' : 'describe.damage', { strike }, { n: sum });
  }

  // The drain, from the blow it is drawn on: skill, aura and gear together
  const drain = calculateLifesteal(skill, blows[0], caster);
  if (drain > 0) {
    clause = phrase(blows.length > 1 || area ? 'describe.drainPerHit' : 'describe.drain', {}, { base: clause, n: num(drain, 'heal') });
  }
  return clause;
}

/**
 * What a skill does, said from its data and nothing else.
 *
 * The authored `description` used to be the only sentence on a skill, and it
 * drifted the way any hand-written second copy of the rules drifts: Thorn
 * Lash's said "sometimes takes root" against a rider that always landed, and
 * Aethelred's comment promised a one-turn silence that a duration of 1 made
 * zero turns. This is the sentence that cannot lie, because it is read off the
 * same fields the resolver executes. The authored text is optional flavour on
 * top — see the call sites — and the mechanical riders (statuses, durations,
 * odds, gear bonuses) stay in `skillEffectLines`, so this covers the *core*
 * payload rather than repeating that list in prose.
 *
 * **With a caster** the sentence states the caster's numbers rather than the
 * multipliers: "for **15** damage", "for **21** and shield them for **16**".
 * Each is the function the cast calls — `skillDamagePreview` (power before the
 * target's defence, no crit; buffs, form, mastery and difficulty included),
 * `calculateHealing`, `resolveEffectMagnitude` — so the number is what lands on
 * a target with no defence. A ticking status or a Barrier riding a hit or a
 * heal is folded into the sentence then, because it has a number worth saying.
 * Without one (the mastery tree, comparing ranks) it states the rule.
 *
 * A form skill only takes the caster's numbers while the caster wears that
 * form: the hero sheet lists a Druid's bear skills beside her own, and her
 * upright stats are not the bear's.
 *
 * Each clause is a whole `skillText` entry (`describe.*`); clauses are joined
 * as a list, and a rider that belongs to a clause wraps it in an entry of its
 * own (`describe.then`: "{base}, then {rider}").
 */
export function describeSkillSegments(skill: HeroSkill, caster?: CombatUnit): SkillTextSegment[] {
  // Prepared attacks resolve on their warned footprint, which may be an arena
  // edge, a linked pair or placed seals rather than the template's target radius.
  // Their authored instructions name that footprint and how to answer it; the
  // shared stat/effect lines still give the power, timing and status numbers.
  if (skill.prepares) return [say(skillStageDescription(skill))];
  if (skill.shiftsTo) {
    return [say(tx('describe.shape', { form: wildFormName(skill.shiftsTo) }))];
  }
  const who = caster && (!skill.formSkill || caster.wildForm === skill.formSkill) ? caster : undefined;

  const clauses: Clause[] = [];
  const applied = skillEffects(skill);

  if (skill.selfMove?.kind === 'blink') {
    // The shadow is Shadowstep's; every other blink says what it does
    clauses.push(phrase(skill.id === 'shadowstep' ? 'describe.shadowBlink' : 'describe.blink', { hexes: hexesGen(skill.selfMove.range) }));
  } else if (skill.selfMove?.kind === 'dash') {
    clauses.push(phrase('describe.dash', { hexes: hexesGen(skill.selfMove.range) }));
  } else if (skill.selfMove?.kind === 'free') {
    clauses.push(phrase('describe.move', { hexes: hexesGen(skill.selfMove.range) }));
  }

  // Blade Recall throws only with Fan of Blades or Flurry; otherwise its whole
  // payload is the pull, said below
  const throws = !skill.extractsBlades || (!!who && strikeScales(who, skill).length > 0);
  if (skill.damage && throws) {
    if (who) {
      let clause = damageClause(skill, who);
      const them = tx(skill.targetType !== SkillTargetType.Single ? 'describe.who.them' : 'describe.who.it');
      // A rider with a number is the second half of the blow
      for (const dot of applied.filter(isDot)) {
        clause = phrase(dot.chance !== undefined ? 'describe.with' : 'describe.then', {}, {
          base: clause, rider: dotClause(dot, skill, who, them),
        });
      }
      for (const shield of applied.filter(isShield)) {
        clause = phrase('describe.andAlso', {}, { base: clause, rider: shieldClause(shield, skill, who, tx('reach.ally.yourself')) });
      }
      clauses.push(clause);
    } else {
      clauses.push(phrase('describe.damageRule', {
        strike: strikeWhom(skill), mult: mult(skill.damage), power: scalingNoun(skill.scaling),
      }));
    }
  }
  if (skill.extractsBlades) {
    clauses.push(who
      ? phrase('describe.pull', {}, { n: num(skillDamagePreview(who, { ...skill, damage: bladeExtractPerBlade() }), 'physical') })
      : phrase('describe.pullRule', { mult: mult(bladeExtractPerBlade()) }));
  }
  if (skill.healing && skill.healingBasis === 'missingHp') {
    // Disengage: the heal lands on the hex the caster moves to, which is the caster
    const self = !!skill.selfMove || onlySelf(skill);
    const params = { whom: mendReach(skill), share: Math.round(skill.healing * 100) };
    clauses.push(who
      ? phrase(self ? 'describe.mendMissingSelfNow' : 'describe.mendMissingNow', params, { n: num(calculateHealing(who, skill), 'heal') })
      : phrase(self ? 'describe.mendMissingSelf' : 'describe.mendMissing', params));
  } else if (skill.healing) {
    if (who) {
      let clause: Clause;
      if (skill.healingByMissing) {
        const range = healingRange(who, skill);
        clause = phrase('describe.mendRange', { whom: mendReach(skill) }, { n: num(`${range.min}–${range.max}`, 'heal') });
      } else {
        clause = phrase('describe.mend', { whom: mendReach(skill) }, { n: num(calculateHealing(who, skill), 'heal') });
      }
      // Only when the heal is the whole payload: on a hit the shield went with the blow
      if (!skill.damage) {
        const them = tx(onlySelf(skill) ? 'reach.ally.yourself' : 'describe.who.them');
        for (const shield of applied.filter(isShield)) {
          clause = phrase('describe.and', {}, { base: clause, rider: shieldClause(shield, skill, who, them) });
        }
      }
      clauses.push(clause);
    } else {
      clauses.push(skill.healingByMissing
        ? phrase('describe.mendRangeRule', {
          whom: mendReach(skill), low: mult(skill.healing * skill.healingByMissing.floor), high: mult(skill.healing),
        })
        : phrase('describe.mendRule', { whom: mendReach(skill), mult: mult(skill.healing) }));
    }
    if (skill.cleanse) clauses.push(phrase('describe.washing'));
  }
  if (skill.allyHeal) {
    // The recipient rule is `combatEvents.allyHealRecipient`; this is its sentence
    clauses.push(
      who
        ? phrase('describe.allyHeal', {}, { n: num(calculateHealing(who, { ...skill, healing: skill.allyHeal }), 'heal') })
        : phrase('describe.allyHealRule', { mult: mult(skill.allyHeal) }),
    );
    // Carrying Word: the second heal, as the fight would land it
    const carried = who?.masteryModifiers?.allyHealSpill;
    if (who && carried) {
      clauses.push(phrase('describe.allyHealCarried', {}, {
        n: num(carriedHeal(calculateHealing(who, { ...skill, healing: skill.allyHeal }), carried), 'heal'),
      }));
    }
  }
  if (skill.mote) {
    // Glowmote's mote: the half of the bolt the sentence would otherwise drop
    const spec = (who && moteSpec(who, skill)) || skill.mote;
    const params = { hexes: hexesGen(spec.reach), share: Math.round(spec.share * 100) };
    clauses.push(who && moteCount(who) > 1
      ? phrase('describe.moteMany', { ...params, n: moteCount(who) })
      : phrase('describe.mote', params));
  }
  if (skill.summons?.templateId === 'lantern_beacon') {
    clauses.push(phrase('describe.beacon', { hexes: hexesGen(skill.range) }));
  } else if (skill.summons) {
    clauses.push(phrase('describe.summon', { count: skill.summons.count, name: templateName(skill.summons.templateId) }));
  }

  // A skill whose payload is its statuses still has to say what it is *for* —
  // the rider list gives the numbers, this gives the sentence. Damage and
  // healing already carry their riders in `skillEffectLines`, so the statuses
  // are spelled out only when nothing else names the point of the press —
  // which includes a pure repositioning cast that also lays them (Intercept is
  // a dash *and* a taunt, and "dash up to 4 hexes" alone is half the button).
  // With a caster, a ticking curse and a Barrier say their number here too.
  const payloadNamed = !!(skill.damage || skill.healing || skill.summons);
  if (!payloadNamed) {
    const numbered = (e: SkillEffect) => !!who && (isDot(e) || isShield(e));
    const curses = applied.filter((e) => isAffliction(e.type));
    const boons = applied.filter((e) => !isAffliction(e.type));
    for (const dot of curses.filter(numbered)) {
      clauses.push(dotClause(dot, skill, who!, enemyReach(skill)));
    }
    const plainCurses = curses.filter((e) => !numbered(e));
    if (plainCurses.length > 0) {
      clauses.push(phrase('describe.lay', { list: listText(plainCurses.map((e) => statusLabel(e.type))), reach: enemyReach(skill) }));
    }
    for (const shield of boons.filter(numbered)) {
      const whom = shield.selfOnly || onlySelf(skill) ? tx('reach.ally.yourself') : allyReach(skill);
      clauses.push(shieldClause(shield, skill, who!, whom));
    }
    const plainBoons = boons.filter((e) => !numbered(e));
    if (plainBoons.length > 0) {
      clauses.push(phrase('describe.grant', { list: listText(plainBoons.map((e) => statusLabel(e.type))), reach: allyReach(skill) }));
    }
    if (skill.cleanse) clauses.push(phrase('describe.cleanse', { reach: allyReach(skill) }));
  }

  if (skill.selfMove?.kind === 'retreat' && skill.selfMove.landAt !== undefined) {
    clauses.push(phrase('describe.land', { hexes: hexes(skill.selfMove.landAt) }));
  } else if (skill.selfMove?.kind === 'retreat') {
    clauses.push(phrase('describe.fallBack', { hexes: hexesGen(skill.selfMove.range) }));
  }

  if (clauses.length === 0) return [say(skillStageDescription(skill))];

  const segments: SkillTextSegment[] = [];
  clauses.forEach((clause, i) => {
    if (i > 0) segments.push(say(tx('describe.join')));
    segments.push(...clause);
  });
  segments.push(say(tx('describe.end')));
  // Capitalised on the first run, which is always prose
  segments[0] = { ...segments[0], text: segments[0].text.charAt(0).toUpperCase() + segments[0].text.slice(1) };
  return mergePlain(segments);
}

/** Adjacent prose runs joined, so a renderer draws one run per colour. */
function mergePlain(segments: SkillTextSegment[]): SkillTextSegment[] {
  const out: SkillTextSegment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && !last.kind && !s.kind) out[out.length - 1] = { text: last.text + s.text };
    else out.push(s);
  }
  return out;
}

/** `describeSkillSegments` as one plain string — for logs, tests and anywhere colour is not drawn. */
export function describeSkill(skill: HeroSkill, caster?: CombatUnit): string {
  return segmentsText(describeSkillSegments(skill, caster));
}
