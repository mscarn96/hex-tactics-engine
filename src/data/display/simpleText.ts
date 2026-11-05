import { beetle as beetleNumbers, bladesCap, mantis, apexTurns, bladestormRadius, bracedStep, conductiveArcBonus, cycleOfLifeMagic, deathMarkBonus, deathMarkTurns, escapeRouteRetreat, flurryFollowupsArea, flurryFollowupsSingle, fuelTheFlameStack, groundedFocus, intimidatingShred, oathWardShare, overloadMinShocked, rapidFireStrikes, sacredRhythmMagic, savageEdgeTick, secondSpringThreshold, sharedBloomReach, sharedBloomShare, shatterpointBonus, shieldedChallengeDuration, smokeDodge, undyingSurge, venomTransferRange, zealMercyHeal, zealMercyStrike, zealWrathStrike } from '@/systems/combat/displayNumbers';
import { BALANCE } from '@/data/balanceConstants';
import { firefly as FF } from '@/systems/combat/displayNumbers';
import { AuraType, CombatUnit, HeroSkill, MasteryNode, PassiveRank, SkillId } from '@/models/types';
import { afterglowPoints, PASSIVE_DEFS } from '@/systems/combat/passives';
import { moteCount, moteSpec } from '@/systems/combat/fireflyRules';
import { aftershockMultiplier, bracedCeiling, crumbleShred, deepColdTurns, detonationRounds, evasiveWeaveDodge, firemindPerStack, freshKillChi, KINDLE_MAGIC_STEP, KINDLE_MAX_STACKS, killingFrostPen, LAST_STAND_AT, lastStandReduction, LIFEBLOOM_SHARE, markAndMoveRange, MOMENTUM_CRIT, RETALIATION_SHARE, rubbleRecoveryMultiplier, stonesAnswerMagic, secondSpringReduction, shellBreathChi, hardenedShellDashDamage, hardenedShellReach, steadyFlameChi, secondLightBarrier, shoulderShare, retributionStrike, heavyHandsDamage, plantedGuardDefense, seismicSenseMove, settleInPen, shadowEchoCost, shadowEchoPerks, sharpenedSteelPen, slipstreamStep, SHATTERSTEP_CHANCE, shieldedChallengeShare, sparkRange, unyieldingDefense, vengeanceChance, overloadBonus, THUNDERHEAD_CHANCE, BLOODSCENT_HEAL, bloodRushDash, CADENCE_ATTACK, killingEyeCrit, WRATH_THRESHOLD, SECOND_SKIN_HP, VERDANT_BLOOD_SHARE } from '@/systems/combat/passiveFormulas';
import {
  findSkill, levelScale, nodeModifierAt, nodeSkillAt, nodeStatBonusAt,
} from '@/systems/progression/mastery';
import { MODIFIER_LABEL, nodeStatLabel, signedStat } from '@/data/display/masteryDisplay';
import { findMasteryNode } from '@/data/skills/masteryData';
import { skillName } from '@/data/gameText';
import { formatDecimal, formatPercent, hasMessage } from '@/i18n';
import { countWord, hexes, hexesGen, listText, skillText, turnsText } from '@/data/display/skillWords';
// Level 26: Arcanist
import { flyingShardsMagic } from '@/systems/combat/passiveFormulas';
import { arcanistRowTwo } from '@/systems/combat/displayNumbers';
// Advanced (level 21–25): Champion
import { rallyDefense, redMistCrit } from '@/systems/combat/passiveFormulas';
import { advancedChampion } from '@/systems/combat/displayNumbers';
// Advanced (level 21–25): Hunter
import { eagleEyeCrit, intoTheDarkTurns, nextQuarryMinTurns, nextQuarryReach, openSeamsCrit, unseenBladeCrit } from '@/systems/combat/passiveFormulas';
// Advanced (level 21–25): Monk
import { reapingStrideStep, searingLightShred, shellWardBarrier } from '@/systems/combat/passiveFormulas';
import { reapersBreathChi, returnedBlowStrike, spilledLightShare } from '@/systems/combat/passiveFormulas';

/**
 * Simple descriptions: the default way a skill or a mastery node explains itself.
 *
 * One or two short, literal sentences saying what the action does, to whom, and
 * the status that matters, with every number resolved to the rank on show. The
 * full mechanics stay where they were (`skillDisplay`, the passive figures, the
 * node's grant lines) and are what **See detailed** reveals. The contract is in
 * the private project notes.
 *
 * Stat and modifier nodes need no copy: their sentence is built from the rank's
 * own numbers, so every path has it. Skills and passives carry authored copy in
 * the two tables below, filled one mastery at a time by the remaster; one that
 * has none returns `undefined`, and the screen shows the detailed view alone, as
 * before, rather than an empty Simple view.
 *
 * The words live in the `skillText` catalog under `simple.<id>` (with a suffix
 * for a conditional branch: `simple.ignite.fuel`); the functions below pick the
 * key and pass the numbers. Pure, so `simpleText.test.ts` can hold the words to
 * the rules in Node.
 */

const tx = skillText;
const pct = (fraction: number) => formatPercent(fraction);
/** A multiplier in a sentence: `1.25`, `1,25`. */
const times2 = (n: number) => formatDecimal(n, 2, { fixed: true });
/** Another skill's name, inside a sentence. */
export const skillLabel = (id: string) => skillName(findSkill(id as SkillId) ?? { id });
/** A skill's first applied effect, at the rank the skill was resolved to. */
const skillEffectsOf = (s: HeroSkill) => (Array.isArray(s.appliesEffect) ? s.appliesEffect : s.appliesEffect ? [s.appliesEffect] : []);
const firstEffect = (s: HeroSkill) => (Array.isArray(s.appliesEffect) ? s.appliesEffect[0] : s.appliesEffect);
const effectTurns = (s: HeroSkill, fallback: number) =>
  (typeof s.appliesEffect === 'object' && !Array.isArray(s.appliesEffect) ? s.appliesEffect.duration : fallback);
const holds = (caster: CombatUnit | undefined, passive: string) => !!caster?.passives?.includes(passive as never);

/** The authored Simple line for a skill, given the skill at its rank and who holds it. */
const SIMPLE_SKILL: Record<string, (skill: HeroSkill, caster?: CombatUnit) => string> = {
  // Every hero's, whatever it holds: the weapon decides the reach
  basic_attack: (s) => tx(s.range <= 1 ? 'simple.basic_attack.adjacent' : 'simple.basic_attack.ranged'),
  // ── Pyromancer ──
  ignite: (_s, caster) => tx(holds(caster, 'fuelTheFlame') ? 'simple.ignite.fuel' : 'simple.ignite'),
  cinder_burst: () => tx('simple.cinder_burst'),
  wildfire: () => tx('simple.wildfire'),
  meteor: () => tx('simple.meteor'),
  ember_shroud: () => tx('simple.ember_shroud'),
  immolation: () => tx('simple.immolation'),
  burning_out: () => tx('simple.burning_out'),
  summon_elemental: () => tx('simple.summon_elemental'),
  // ── Stormcaller ──
  arc: () => tx('simple.arc'),
  static_burst: (s) => tx('simple.static_burst', { hexes: hexesGen(s.aoeRadius ?? 1) }),
  thunderbolt: () => tx('simple.thunderbolt'),
  thunderstep: (s) => tx('simple.thunderstep', { hexes: hexesGen(s.selfMove?.range ?? s.range) }),
  skyfall: (s) => tx('simple.skyfall', {
    count: s.randomEnemies ?? 0, n: countWord(s.randomEnemies ?? 0),
    range: hexesGen(s.range), radius: hexesGen(s.aoeRadius ?? 0), damage: formatDecimal(s.damage ?? 0, 2),
  }),
  tempest: (s) => tx('simple.tempest', { hexes: hexesGen(s.aoeRadius ?? 1) }),
  chain_lightning: (s) => tx('simple.chain_lightning', { count: s.chainJumps ?? 1, n: countWord(s.chainJumps ?? 1) }),
  summon_thunder_elemental: (s) => tx('simple.summon_thunder_elemental', {
    count: s.summons?.duration ?? 0, n: countWord(s.summons?.duration ?? 0), share: pct(s.summons?.echoMagic ?? 0),
  }),
  // ── Hydromancer ──
  frostbite: (_s, caster) => tx(holds(caster, 'twinFangs') ? 'simple.frostbite.twin' : 'simple.frostbite'),
  frost_lance: () => tx('simple.frost_lance'),
  cold_snap: () => tx('simple.cold_snap'),
  ice_barrier: () => tx('simple.ice_barrier'),
  silencing_depths: () => tx('simple.silencing_depths'),
  blizzard: () => tx('simple.blizzard'),
  glacial_barrage: (s) => tx('simple.glacial_barrage', { count: s.barrage ?? 0 }),
  absolute_zero: (s) => (s.releasing
    ? tx('simple.absolute_zero.release', { count: s.repeats ?? 1, n: countWord(s.repeats ?? 1) })
    : tx('simple.absolute_zero')),

  // ── Bulwark ──
  provoking_strike: (_s, caster) =>
    tx(holds(caster, 'shieldedChallenge') ? 'simple.provoking_strike.shielded' : 'simple.provoking_strike'),
  challenge: (s) => tx('simple.challenge', { hexes: hexesGen(s.range) }),
  intercept: () => tx('simple.intercept'),
  bellow: () => tx('simple.bellow'),
  reposition: () => tx('simple.reposition'),
  unbreakable_vow: () => tx('simple.unbreakable_vow'),
  shield_avalanche: (s) => tx('simple.shield_avalanche', { hexes: hexesGen(s.selfMove?.range ?? 0) }),
  reckoning: () => tx('simple.reckoning'),
  // ── Lifewarden ──
  lifebloom_skill: (_s, caster) =>
    tx(holds(caster, 'sharedBloom') ? 'simple.lifebloom_skill.shared' : 'simple.lifebloom_skill'),
  warding_bloom: () => tx('simple.warding_bloom'),
  emergency_bloom: () => tx('simple.emergency_bloom'),
  rooted_vitality: () => tx('simple.rooted_vitality'),
  thornrow: () => tx('simple.thornrow'),
  wellspring: () => tx('simple.wellspring'),
  wild_sanctuary: () => tx('simple.wild_sanctuary'),
  summon_treant: () => tx('simple.summon_treant'),
  // The Treant's own three, for its inspector
  timber_crush: () => tx('simple.timber_crush'),
  rootlash_sweep: () => tx('simple.rootlash_sweep'),
  canopy_guard: () => tx('simple.canopy_guard'),
  // ── Stoneshaper ──
  tremor: (_s, caster) => tx(holds(caster, 'aftershock') ? 'simple.tremor.aftershock' : 'simple.tremor'),
  stoneskin: () => tx('simple.stoneskin'),
  grasping_earth: () => tx('simple.grasping_earth'),
  stone_ward: () => tx('simple.stone_ward'),
  upheaval: () => tx('simple.upheaval'),
  stone_heart: () => tx('simple.stone_heart'),
  living_stone: () => tx('simple.living_stone'),
  bedrock_stand: () => tx('simple.bedrock_stand'),
  // The Stone Elemental's own three, for its inspector
  stone_fist: () => tx('simple.stone_fist'),
  ground_slam: () => tx('simple.ground_slam'),
  boulder_leap: () => tx('simple.boulder_leap'),
  // ── Templar ──
  smite: (s, caster) => {
    const reach = s.range <= 1 ? 'adjacent' : 'ranged';
    const params = { hexes: hexesGen(s.range) };
    if (s.mode === 'mercy') return tx(`simple.smite.mercy.${reach}`, params);
    if (s.mode === 'wrath') return tx(`simple.smite.wrath.${reach}`, params);
    return holds(caster, 'zeal') ? tx(`simple.smite.zeal.${reach}`, params) : tx(`simple.smite.${reach}`, params);
  },
  sanction: () => tx('simple.sanction'),
  judgement: () => tx('simple.judgement'),
  lay_on_hands: (s) => tx('simple.lay_on_hands', { heal: formatDecimal(s.healing ?? 0, 1, { fixed: true }) }),
  divine_light: (s) => tx('simple.divine_light', { hexes: hexesGen(s.aoeRadius ?? 0) }),
  righteous_fury: () => tx('simple.righteous_fury', { smite: skillLabel('smite') }),
  martyr: () => tx('simple.martyr'),
  consecrate: () => tx('simple.consecrate'),
  // ── Marksman ──
  mark_target: (_s, caster) => tx(holds(caster, 'markAndMove') ? 'simple.mark_target.move' : 'simple.mark_target'),
  hamstring_shot: () => tx('simple.hamstring_shot'),
  ricochet_shot: (s) => tx('simple.ricochet_shot', { count: s.chainJumps ?? 0 }),
  concussive_shot: () => tx('simple.concussive_shot'),
  rain_of_arrows: () => tx('simple.rain_of_arrows'),
  aimed_shot: (s) => tx(s.releasing ? 'simple.aimed_shot.release' : 'simple.aimed_shot'),
  rapid_fire: (s) => tx('simple.rapid_fire', { turns: turnsText(effectTurns(s, 4)), arrows: rapidFireStrikes() }),
  // ── Berserker ──
  // Blood Rush is baked into the skill (`withBloodRush`), so the dash is read off it
  bloodthirst: (s) => (s.selfMove?.kind === 'dash'
    ? tx('simple.bloodthirst.dash', { hexes: hexesGen(s.selfMove.range) })
    : tx('simple.bloodthirst')),
  rend: () => tx('simple.rend'),
  executioner: (s) => tx('simple.executioner', { hexes: hexesGen(s.range) }),
  cleaving_throw: (s) => tx('simple.cleaving_throw', { hexes: hexesGen(s.range) }),
  blood_price: (s) => {
    const buff = firstEffect(s);
    return tx('simple.blood_price', {
      hp: s.selfDamage ?? 0, attack: Math.round(buff?.magnitude ?? 0), turns: turnsText(buff?.duration ?? 0),
    });
  },
  whirlwind: (s) => tx('simple.whirlwind', { hexes: hexesGen(s.aoeRadius ?? 1) }),
  carnage: (s) => tx('simple.carnage', { turns: turnsText(firstEffect(s)?.duration ?? 0), skill: skillLabel('bloodthirst') }),
  // ── Skirmisher ──
  blade_recall: (_s, caster) => tx(holds(caster, 'fanOfBlades') ? 'simple.blade_recall.fan' : 'simple.blade_recall'),
  barbed_blades: () => tx('simple.barbed_blades'),
  bolas: () => tx('simple.bolas'),
  hit_and_run: () => tx('simple.hit_and_run'),
  smoke_bomb: (s) => {
    const turns = s.appliesEffect && Array.isArray(s.appliesEffect)
      ? s.appliesEffect.find((e) => e.selfOnly)?.duration ?? 3 : 3;
    return tx('simple.smoke_bomb', { turns: turnsText(turns), dodge: smokeDodge() });
  },
  knife_dance: (s) => tx('simple.knife_dance', { count: (s.chainJumps ?? 2) + 1 }),
  bladestorm: (s) => tx('simple.bladestorm', { turns: turnsText(effectTurns(s, 3)), hexes: hexesGen(bladestormRadius()) }),
  flurry: (s) => tx('simple.flurry', { turns: turnsText(effectTurns(s, 4)), single: flurryFollowupsSingle(), area: flurryFollowupsArea() }),
  covering_fire: (s) => tx('simple.covering_fire', {
    turns: turnsText(s.reaction?.duration ?? 3), count: s.reaction?.shotsPerRound ?? 2,
  }),
  // ── Shadowblade ──
  shadowstep: (s, caster) =>
    tx(holds(caster, 'shadowEcho') ? 'simple.shadowstep.echo' : 'simple.shadowstep', { hexes: hexesGen(s.range) }),
  venomed_blades: () => tx('simple.venomed_blades'),
  garrote: () => tx('simple.garrote'),
  hemlock: () => tx('simple.hemlock'),
  cheap_shot: () => tx('simple.cheap_shot'),
  assassinate: () => tx('simple.assassinate', { turns: turnsText(deathMarkTurns()), bonus: pct(deathMarkBonus()) }),
  creeping_death: () => tx('simple.creeping_death'),
  // The rank's own actions (the Ambush magnitude, scaled) and the wind-up, never words fixed in the catalog
  vanish: (s) => tx('simple.vanish', {
    count: Math.round(skillEffectsOf(s).find((e) => e.type === AuraType.Ambush)?.magnitude ?? BALANCE.VANISH_CHARGES),
    turns: turnsText(BALANCE.VANISH_WINDUP),
  }),
  // ── Wildshape ──
  bear_form: () => tx('simple.bear_form'),
  wolf_form: () => tx('simple.wolf_form'),
  hawk_form: () => tx('simple.hawk_form'),
  apex_form: () => tx('simple.apex_form', { turns: turnsText(apexTurns()), cooldown: turnsText(BALANCE.APEX_COOLDOWN) }),
  maul: () => tx('simple.maul'),
  roar: () => tx('simple.roar'),
  bear_slam: () => tx('simple.bear_slam'),
  hibernate: () => tx('simple.hibernate'),
  crushing_leap: (s) => tx('simple.crushing_leap', { hexes: hexesGen(s.selfMove?.range ?? 2) }),
  bear_shrug: () => tx('simple.bear_shrug'),
  rip: () => tx('simple.rip'),
  pounce: () => tx('simple.pounce'),
  throat_tear: () => tx('simple.throat_tear'),
  blood_howl: () => tx('simple.blood_howl'),
  slip_the_net: (s) => tx('simple.slip_the_net', {
    hexes: hexesGen(s.selfMove?.range ?? 2), dodge: firstEffect(s)?.magnitude ?? 30,
  }),
  rending_circle: () => tx('simple.rending_circle'),
  talons: () => tx('simple.talons'),
  dive: () => tx('simple.dive'),
  screech: () => tx('simple.screech'),
  cyclone: () => tx('simple.cyclone'),
  hawk_shear: () => tx('simple.hawk_shear'),
  hunters_mark: (s) => tx('simple.hunters_mark', {
    count: s.marks?.charges ?? 2, n: countWord(s.marks?.charges ?? 2), bonus: pct(s.marks?.bonus ?? 0.4),
  }),
  crowned_prey: (s) => tx('simple.crowned_prey', { count: s.marks?.charges ?? 2, n: countWord(s.marks?.charges ?? 2) }),
  antler_charge: (s) => tx('simple.antler_charge', { hexes: hexesGen(s.aoeRadius ?? 2) }),
  primal_wrath: () => tx('simple.primal_wrath'),
  primal_surge: (s) => tx('simple.primal_surge', { turns: turnsText(s.refreshesFormSkills ?? 2) }),
  ancestral_hunt: () => tx('simple.ancestral_hunt'),
  // ── Mantis ──
  twin_reap: (_s, caster) => {
    // Bleed Harvest's holder is told what the reap pays, where it plans the reap
    const momentum = holds(caster, 'reapingMomentum') ? '.momentum' : '';
    const harvest = holds(caster, 'bleedHarvest') ? '.harvest' : '';
    return tx(`simple.twin_reap${momentum}${harvest}`);
  },
  scything_step: (s) => tx('simple.scything_step', { hexes: hexesGen(s.selfMove?.range ?? 1) }),
  flicker_cut: () => tx('simple.flicker_cut'),
  pinning_cut: (s) => tx('simple.pinning_cut', {
    turns: turnsText((firstEffect(s)?.duration ?? 3) - 1), bonus: pct(firstEffect(s)?.magnitude ?? 0.2),
  }),
  mantis_pounce: (s) => tx('simple.mantis_pounce', { hexes: hexesGen(s.selfMove?.range ?? s.range) }),
  marked_prey: (s) => (s.mantisStage === 'release'
    ? tx('simple.marked_prey.release')
    : tx('simple.marked_prey', { hexes: hexesGen(s.range) })),
  threefold_scythe: (s) => (s.mantisStage === 2
    ? tx('simple.threefold_scythe.two')
    : s.mantisStage === 3
      ? tx('simple.threefold_scythe.three')
      : tx('simple.threefold_scythe', { hexes: hexesGen(s.selfMove?.range ?? s.range) })),
  mantis_execution: (s) => tx('simple.mantis_execution', { hexes: hexesGen(s.range), count: s.repeats ?? 5, n: countWord(s.repeats ?? 5) }),
  // ── Beetle ──
  iron_carapace: (s, caster) => (holds(caster, 'hardenedShell') || s.selfMove?.kind === 'dash'
    ? tx('simple.iron_carapace.hardened', { hexes: hexesGen(s.range) })
    : tx('simple.iron_carapace')),
  horn_sweep: (s) => tx('simple.horn_sweep', { hexes: hexes(s.pushDistance ?? 1), attack: firstEffect(s)?.magnitude ?? 0 }),
  carapace_leap: (s) => tx('simple.carapace_leap', { hexes: hexesGen(s.range), turns: turnsText(s.reaction?.duration ?? 3) }),
  grip_and_throw: (s) => tx('simple.grip_and_throw', { hexes: hexes(s.pushDistance ?? 0) }),
  shell_wall: (s) => tx('simple.shell_wall', { hexes: hexesGen(s.aoeRadius ?? 2), turns: turnsText(firstEffect(s)?.duration ?? 3) }),
  vengeful_shell: (s) => tx('simple.vengeful_shell', {
    turns: turnsText(s.reaction?.duration ?? 3),
    hexes: hexesGen(s.reaction?.trigger.kind === 'interceptAlly' ? s.reaction.trigger.reach : 2),
    count: s.reaction?.shotsPerRound ?? 2,
  }),
  carapace_bastion: (s) => tx('simple.carapace_bastion', {
    hexes: hexesGen(s.aoeRadius ?? 1), turns: turnsText(s.bastion?.turns ?? 2), share: pct(s.bastion?.share ?? 0.5),
  }),
  shell_swap: (s) => tx('simple.shell_swap', { hexes: hexesGen(s.range), push: hexes(s.swapsPlaces?.push ?? 1) }),
  // ── Firefly ──
  glowmote: (s, caster) => {
    const mote = (caster && moteSpec(caster, s)) || s.mote || { share: 0, reach: 0 };
    const many = !!caster && moteCount(caster) > 1;
    return tx(many ? 'simple.glowmote.many' : 'simple.glowmote', {
      n: countWord(caster ? moteCount(caster) : 1), hexes: hexesGen(mote.reach), share: pct(mote.share),
    });
  },
  lantern_sweep: (s) => tx('simple.lantern_sweep', { hexes: hexesGen(s.aoeRadius ?? 2) }),
  lightbond: (s) => tx('simple.lightbond', { hexes: hexesGen(s.range), share: firstEffect(s)?.magnitude ?? 0 }),
  purifying_light: (s) => tx('simple.purifying_light', { hexes: hexesGen(s.range) }),
  lantern_glide: (s) => tx('simple.lantern_glide', { hexes: hexesGen(s.selfMove?.range ?? s.range) }),
  firefly_motes: (s) => tx('simple.firefly_motes', {
    count: s.motes?.count ?? 0, n: countWord(s.motes?.count ?? 0), hexes: hexesGen(FF().MOTES_RADIUS),
    attack: FF().MOTE_ATTACK, crit: FF().MOTE_CRIT,
  }),
  firefly_swarm: (s) => tx('simple.firefly_swarm', {
    hexes: hexesGen(s.aoeRadius ?? 1),
    attack: (Array.isArray(s.appliesEffect) ? s.appliesEffect[1] : undefined)?.magnitude ?? 0,
  }),
  lantern_beacon: (s) => tx('simple.lantern_beacon', {
    hexes: hexesGen(s.range), radius: hexesGen(FF().BEACON_RADIUS), crit: FF().BEACON_CRIT, exposed: pct(FF().BEACON_EXPOSED),
  }),
};

/** The authored Simple line for a passive, at a rank. */
const SIMPLE_PASSIVE: Record<string, (rank: PassiveRank) => string> = {
  // ── Mantis ──
  bleedingBlades: (r) => tx('simple.bleedingBlades', {
    bleed: times2(mantis().BLEED * r.scale), turns: turnsText(mantis().BLEED_TURNS),
  }),
  reapingMomentum: (r) => tx('simple.reapingMomentum', {
    skill: skillLabel('twin_reap'), bonus: pct(mantis().MOMENTUM_STEP * r.scale),
    count: mantis().MOMENTUM_MAX_STACKS, n: countWord(mantis().MOMENTUM_MAX_STACKS),
  }),
  predatorsBreath: (r) => tx('simple.predatorsBreath', {
    skill: skillLabel('meditate'), crit: Math.round(mantis().PREDATORS_BREATH_CRIT * r.scale),
  }),
  bleedHarvest: () => tx('simple.bleedHarvest', { skill: skillLabel('twin_reap') }),
  freshKill: (r) => tx('simple.freshKill', { chi: freshKillChi(r) }),
  evasiveWeave: (r) => tx('simple.evasiveWeave', { dodge: evasiveWeaveDodge(r) }),
  // ── Firefly ──
  lanternBreath: (r) => tx('simple.lanternBreath', {
    skill: skillLabel('meditate'), share: pct(FF().LANTERN_BREATH_SHARE * r.scale),
  }),
  brighterMotes: (r) => tx('simple.brighterMotes', {
    skill: skillLabel('glowmote'), share: pct(FF().BRIGHTER_MOTE_SHARE * r.scale), base: pct(FF().MOTE_SHARE),
    hexes: hexesGen(FF().BRIGHTER_MOTE_REACH),
  }),
  afterglow: (r) => tx('simple.afterglow', {
    attack: afterglowPoints(FF().AFTERGLOW_ATTACK, r), magic: afterglowPoints(FF().AFTERGLOW_MAGIC, r),
  }),
  farLight: () => tx('simple.farLight', {
    a: skillLabel('glowmote'), b: skillLabel('lightbond'), c: skillLabel('purifying_light'), hexes: hexes(FF().FAR_LIGHT_RANGE),
  }),
  twinMotes: () => tx('simple.twinMotes', { skill: skillLabel('glowmote'), n: countWord(FF().TWIN_MOTES) }),
  steadyFlame: (r) => tx('simple.steadyFlame', { chi: steadyFlameChi(r) }),
  secondLight: (r) => tx('simple.secondLight', {
    share: pct(secondLightBarrier(r)), turns: turnsText(FF().SECOND_LIGHT_DURATION),
  }),
  // ── Beetle ──
  shellBreath: (r) => tx('simple.shellBreath', { skill: skillLabel('meditate'), chi: shellBreathChi(r) }),
  hardenedShell: (r) => tx('simple.hardenedShell', {
    skill: skillLabel('iron_carapace'), hexes: hexes(hardenedShellReach(r)), share: pct(hardenedShellDashDamage(r)),
  }),
  shoulderToShoulder: (r) => tx('simple.shoulderToShoulder', { share: pct(shoulderShare(r)) }),
  secondWatch: () => tx('simple.secondWatch', { n: countWord(beetleNumbers().SECOND_WATCH_REACTIONS) }),
  retribution: (r) => tx('simple.retribution', {
    a: skillLabel('vengeful_shell'), b: skillLabel('carapace_bastion'), damage: times2(retributionStrike(r)),
  }),
  numbingStaff: () => tx('simple.numbingStaff', {
    attack: beetleNumbers().NUMBING_ATTACK_DOWN, magic: beetleNumbers().NUMBING_MAGIC_DOWN,
  }),
  heavyHands: (r) => tx('simple.heavyHands', {
    a: skillLabel('horn_sweep'), b: skillLabel('grip_and_throw'), bonus: pct(heavyHandsDamage(r) - 1),
  }),
  plantedGuard: (r) => tx('simple.plantedGuard', { defense: plantedGuardDefense(r) }),
  // ── Pyromancer ──
  fuelTheFlame: (r) => tx('simple.fuelTheFlame', { skill: skillLabel('ignite'), share: pct(fuelTheFlameStack() * r.scale) }),
  momentum: (r) => tx('simple.momentum', { crit: Math.round(MOMENTUM_CRIT * r.scale) }),
  kindle: (r) => tx('simple.kindle', { share: pct(KINDLE_MAGIC_STEP * r.scale), count: KINDLE_MAX_STACKS }),
  firemind: (r) => tx('simple.firemind', { skill: skillLabel('cinder_burst'), mana: firemindPerStack(r) }),
  spark: (r) => tx('simple.spark', { hexes: hexesGen(sparkRange(r)) }),
  detonation: (r) => tx('simple.detonation', {
    a: skillLabel('cinder_burst'), b: skillLabel('immolation'), count: detonationRounds(r),
  }),
  // ── Stormcaller ──
  conductiveArc: (r) => tx('simple.conductiveArc', { skill: skillLabel('arc'), bonus: pct(conductiveArcBonus() * r.scale) }),
  overload: (r) => tx('simple.overload', {
    n: countWord(overloadMinShocked()), a: skillLabel('arc'), b: skillLabel('thunderbolt'), bonus: pct(overloadBonus(r)),
  }),
  thunderhead: (r) => tx('simple.thunderhead', { chance: pct(THUNDERHEAD_CHANCE * r.scale) }),
  // ── Hydromancer ──
  twinFangs: () => tx('simple.twinFangs', { skill: skillLabel('frostbite') }),
  shatterpoint: (r) => tx('simple.shatterpoint', { bonus: pct(shatterpointBonus() * r.scale) }),
  meltwater: () => tx('simple.meltwater'),
  flyingShards: (r) => tx('simple.flyingShards', {
    magic: times2(flyingShardsMagic(r)), hexes: hexes(arcanistRowTwo().SHARD_REACH),
  }),
  cryostasis: () => tx('simple.cryostasis'),
  shatterstep: (r) => tx('simple.shatterstep', { chance: pct(SHATTERSTEP_CHANCE * r.scale) }),
  deepCold: (r) => tx('simple.deepCold', { count: deepColdTurns(r) }),
  killingFrost: (r) => tx('simple.killingFrost', { pen: killingFrostPen(r) }),

  // ── Bulwark ──
  shieldedChallenge: (r) => tx('simple.shieldedChallenge', {
    skill: skillLabel('provoking_strike'), share: pct(shieldedChallengeShare(r)), turns: turnsText(shieldedChallengeDuration()),
  }),
  intimidating: (r) => tx('simple.intimidating', { attack: Math.round(intimidatingShred() * r.scale) }),
  retaliation: (r) => tx('simple.retaliation', { share: pct(RETALIATION_SHARE * r.scale) }),
  braced: (r) => tx('simple.braced', { step: bracedStep(), cap: bracedCeiling(r) }),
  lastStand: (r) => tx('simple.lastStand', { at: pct(LAST_STAND_AT), share: pct(lastStandReduction(r)) }),
  vengeance: (r) => tx('simple.vengeance', { chance: pct(vengeanceChance(r)) }),
  // ── Lifewarden ──
  sharedBloom: (r) => tx('simple.sharedBloom', {
    skill: skillLabel('lifebloom_skill'), hexes: hexesGen(sharedBloomReach()), share: pct(sharedBloomShare() * r.scale),
  }),
  secondSpring: (r) => tx('simple.secondSpring', { at: pct(secondSpringThreshold()), share: secondSpringReduction(r) }),
  cycleOfLife: (r) => tx('simple.cycleOfLife', { share: pct(cycleOfLifeMagic() * r.scale) }),
  lifebloom: (r) => tx('simple.lifebloom', { share: pct(LIFEBLOOM_SHARE * r.scale) }),
  // ── Stoneshaper ──
  aftershock: (r) => tx('simple.aftershock', { skill: skillLabel('tremor'), share: pct(aftershockMultiplier(r)) }),
  rubbleRecovery: (r) => tx('simple.rubbleRecovery', { share: pct(rubbleRecoveryMultiplier(r)) }),
  stonesAnswer: (r) => tx('simple.stonesAnswer', { share: pct(stonesAnswerMagic(r)) }),
  crumble: (r) => tx('simple.crumble', { shred: crumbleShred(r) }),
  immovable: () => tx('simple.immovable'),
  unyielding: (r) => tx('simple.unyielding', { defense: unyieldingDefense(r) }),
  groundedFocus: (r) => tx('simple.groundedFocus', { share: pct(groundedFocus()[Math.min(2, r.level - 1)]) }),
  seismicSense: (r) => tx('simple.seismicSense', { hexes: hexes(seismicSenseMove(r)) }),
  // ── Templar ──
  zeal: (r) => {
    const rung = Math.min(3, Math.max(1, r.level)) - 1;
    return tx('simple.zeal', {
      skill: skillLabel('smite'), mercy: pct(zealMercyStrike()[rung]), heal: pct(zealMercyHeal()[rung]), wrath: pct(zealWrathStrike()[rung]),
    });
  },
  sacredRhythm: () => tx('simple.sacredRhythm', { skill: skillLabel('smite'), share: pct(sacredRhythmMagic()) }),
  oath: (r) => tx('simple.oath', { share: pct(oathWardShare() * r.scale) }),
  unstoppable: () => tx('simple.unstoppable'),
  // ── Marksman ──
  markAndMove: (r) => tx('simple.markAndMove', { skill: skillLabel('mark_target'), hexes: hexesGen(markAndMoveRange(r)) }),
  escapeRoute: () => tx('simple.escapeRoute', { hexes: hexes(escapeRouteRetreat()) }),
  settleIn: (r) => tx('simple.settleIn', { pen: settleInPen(r) }),
  // ── Berserker ──
  bloodRush: (r) => tx('simple.bloodRush', { skill: skillLabel('bloodthirst'), hexes: hexesGen(bloodRushDash(r)) }),
  undyingFury: (r) => tx('simple.undyingFury', { share: pct(undyingSurge() * r.scale) }),
  bloodscent: (r) => tx('simple.bloodscent', { share: pct(BLOODSCENT_HEAL * r.scale) }),
  wrath: (r) => tx('simple.wrath', { share: pct(WRATH_THRESHOLD[r.level - 1] ?? WRATH_THRESHOLD[1]) }),
  frenzy: () => tx('simple.frenzy'),
  cadence: (r) => tx('simple.cadence', { share: pct(CADENCE_ATTACK * r.scale) }),
  savageEdge: (r) => tx('simple.savageEdge', { share: pct(savageEdgeTick() * r.scale) }),
  killingEye: (r) => tx('simple.killingEye', { crit: killingEyeCrit(r) }),
  // ── Skirmisher ──
  fanOfBlades: (r) => tx('simple.fanOfBlades', { skill: skillLabel('blade_recall'), share: pct(r.scale) }),
  slipstream: (r) => tx('simple.slipstream', { hexes: hexes(slipstreamStep(r)) }),
  sharpenedSteel: (r) => tx('simple.sharpenedSteel', { pen: sharpenedSteelPen(r) }),
  // ── Shadowblade ──
  shadowEcho: (r) => {
    const perks = shadowEchoPerks(r);
    const key = perks.crit ? 'simple.shadowEcho.crit' : perks.stealth ? 'simple.shadowEcho.stealth' : 'simple.shadowEcho';
    return tx(key, { skill: skillLabel('shadowstep'), mana: shadowEchoCost() });
  },
  venomTransfer: () => tx('simple.venomTransfer', { hexes: hexesGen(venomTransferRange()) }),
  nightfall: () => tx('simple.nightfall'),
  // ── Wildshape ──
  secondSkin: () => tx('simple.secondSkin', { hp: pct(SECOND_SKIN_HP) }),
  verdantBlood: (r) => tx('simple.verdantBlood', { share: pct(VERDANT_BLOOD_SHARE * r.scale) }),
  // Advanced (level 21–25): Monk
  shellWard: (r) => tx('simple.shellWard', { share: pct(shellWardBarrier(r)) }),
  searingLight: (r) => tx('simple.searingLight', { skill: skillLabel('glowmote'), shred: searingLightShred(r) }),
  reapingStride: (r) => tx('simple.reapingStride', { skill: skillLabel('twin_reap'), hexes: hexesGen(reapingStrideStep(r)) }),
  // Advanced (level 26): Monk
  returnedBlow: (r) => tx('simple.returnedBlow', { damage: times2(returnedBlowStrike(r)) }),
  spilledLight: (r) => tx('simple.spilledLight', { skill: skillLabel('glowmote'), share: pct(spilledLightShare(r)) }),
  reapersBreath: (r) => tx('simple.reapersBreath', { skill: skillLabel('twin_reap'), chi: reapersBreathChi(r) }),
  // Advanced (level 21–25): Champion
  rallyingTaunt: (r) => tx('simple.rallyingTaunt', { hexes: hexesGen(advancedChampion().RALLY_REACH), defense: rallyDefense(r) }),
  redMist: (r) => tx('simple.redMist', { at: pct(advancedChampion().RED_MIST_AT), crit: redMistCrit(r) }),
  // Advanced (level 21–25): Hunter
  eagleEye: (r) => tx('simple.eagleEye', { crit: eagleEyeCrit(r) }),
  openSeams: (r) => tx('simple.openSeams', { crit: openSeamsCrit(r) }),
  unseenBlade: (r) => tx('simple.unseenBlade', { crit: unseenBladeCrit(r) }),
  nextQuarry: (r) => tx('simple.nextQuarry', { hexes: hexesGen(nextQuarryReach(r)), turns: turnsText(nextQuarryMinTurns()) }),
  intoTheDark: (r) => tx('simple.intoTheDark', { turns: turnsText(intoTheDarkTurns(r)) }),
};

/** Every id with an authored Simple line, for the catalog's own test. */
export const SIMPLE_SKILL_IDS = Object.keys(SIMPLE_SKILL);
export const SIMPLE_PASSIVE_IDS = Object.keys(SIMPLE_PASSIVE);

/** A skill's Simple line, for the combat inspector and a skill node; undefined when none is authored. */
export function skillSimpleText(skill: HeroSkill, caster?: CombatUnit): string | undefined {
  const text = SIMPLE_SKILL[skill.id]?.(skill, caster);
  if (text && (skill.embedsBlades || skill.extractsBlades || skill.id === 'bladestorm')) {
    return tx('simple.bladesCap', { text: text.replace(/\.$/, ''), cap: bladesCap(caster) });
  }
  return text;
}

/** A passive's Simple line at a rank; undefined when none is authored. */
export function passiveSimpleText(id: string, rank: PassiveRank): string | undefined {
  return PASSIVE_DEFS[id as keyof typeof PASSIVE_DEFS] ? SIMPLE_PASSIVE[id]?.(rank) : undefined;
}

/**
 * "Gives +3 MAG and +11 MP." plus one sentence per modifier, from the node's own
 * numbers at `level` — the same arithmetic the engine runs. Empty when the node
 * grants no stat or modifier.
 */
export function statSimpleText(node: MasteryNode, level: number): string {
  // A Monk node's pool is chi, and says so
  const heroClass = findMasteryNode(node.id)?.path.heroClass;
  const stats = Object.entries(nodeStatBonusAt(node, level))
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .map(([k, v]) => signedStat(v as number, nodeStatLabel(k, heroClass)).replace(' %', '%'));
  const parts: string[] = [];
  if (stats.length > 0) parts.push(tx('simple.gives', { list: listText(stats) }));
  for (const [key, value] of Object.entries(nodeModifierAt(node, level))) {
    const render = MODIFIER_LABEL[key];
    if (render && typeof value === 'number') parts.push(tx('simple.sentence', { text: render(value) }));
  }
  return parts.join(' ');
}

/**
 * A node's Simple description at a rank (an unowned node reads at rank 1).
 * Undefined when the node grants something whose copy is not written yet.
 */
export function nodeSimpleText(node: MasteryNode, level: number): string | undefined {
  const held = Math.max(1, level);
  const stats = statSimpleText(node, held);
  let grant: string | undefined = '';
  if (node.grantsSkill) {
    const skill = nodeSkillAt(node, held);
    grant = skill ? skillSimpleText(skill) : undefined;
  } else if (node.grantsPassive) {
    grant = passiveSimpleText(node.grantsPassive, { level: held, scale: levelScale(node, held) });
  }
  if (grant === undefined) return undefined;
  const text = [grant, stats].filter(Boolean).join(' ');
  return text || undefined;
}

/** Whether a Simple key exists — for the catalog test. */
export const hasSimpleText = (key: string) => hasMessage(`skillText.${key}`);
