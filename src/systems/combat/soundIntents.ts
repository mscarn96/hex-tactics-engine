import {
  AfflictionType,
  AuraType,
  BodyMaterial,
  CastFamily,
  CombatUnit,
  HeroSkill,
  HexCoord,
  MoveMode,
  SelfMoveSpec,
  SkillBeat,
  SkillGesture,
  SkillVoice,
  SkillTargetType,
  SoundIntent,
  SpellFamily,
  StatusEffectType,
  StrikeContact,
  StrikeDelivery,
  StrikeOutcome,
  SupportFamily,
  VfxKind,
  WildFormId,
} from '@/models/types';
import { bossSignature } from '@/data/display/bossSounds';
import { skillVoice } from '@/data/display/skillSounds';
import { SUMMON_GESTURES, bodyMaterial, footKind } from '@/data/display/bodySounds';
import { BASIC_ATTACK_ID } from '@/systems/combat/basicAttack';
import { skillEffects } from '@/systems/combat/statusEffects';
import type { Flank } from '@/systems/combat/facing';

/**
 * What the rules tell the ear, built one way for both sides of the fight.
 *
 * A hero's cast and an enemy's cast both go through `resolveSkillUse`, but a
 * warned strike, a boss script and a move each report from elsewhere, and they
 * drifted before over exactly this kind of clause — a dodge was `MISS` on one
 * side and a `-0` on the other. So none builds an intent by hand: all call these, which is what makes "a player and an enemy landing the
 * same blow sound the same" a property of the code rather than a promise about
 * two call sites being kept in step. `soundIntents.test.ts` resolves the same
 * outcomes down both paths and compares what came out.
 *
 * Pure, and free of anything that plays: an intent is data, handed to a sink
 * the headless simulator never supplies.
 */

/** Whatever carries a unit's kit: its skills, and the upright list a Wildshape keeps. */
export type Wielder = Pick<CombatUnit, 'skills'> & Partial<Pick<CombatUnit, 'humanSkills' | 'blow' | 'activeEffects'>>;

/**
 * What the unit has in its hand, as far as the ear is concerned: the delivery
 * of its Basic Attack, which `basicAttackWith` reads off the weapon worn.
 *
 * Read from the upright kit when there is one, because a Druid in the bear's
 * skin has put the branch down but still owns it — and nothing a beast does is
 * delivered by a weapon anyway (`formSkill` answers first).
 */
export function wieldedDelivery(unit: Wielder): StrikeDelivery | undefined {
  const kit = unit.humanSkills ?? unit.skills;
  return kit.find((s) => s.id === BASIC_ATTACK_ID)?.delivery;
}

/**
 * How a skill's blows arrive, in the order the rules can answer it:
 *
 * 1. the skill's own `delivery`, for the shared skills whose owners cannot be
 *    read — a Bite is teeth whoever bites;
 * 2. a form skill is a beast's paws;
 * 3. a magic-scaled skill is a spell;
 * 4. a hybrid one is a spell carried by the weapon, so it is the weapon at arm's
 *    length and the light past it — Smite is a mace, Judgement is not;
 * 5. anything physical is the weapon in the caster's hand, so a Champion's Rend
 *    cuts with a sword and crushes with a hammer from one authored skill;
 * 6. an enemy's weapon blow — a blow beside it or a sweep, not a charge —
 *    is what its model holds (`EnemyTemplate.blow`), and its shot across the
 *    board an arrow if it holds a bow and a throw if it does not;
 * 7. a caster holding nothing it can be read from — a summon, an enemy with no
 *    `blow` — is read off the skill's shape: a charge is a body arriving at speed, a blow
 *    beside it a blade, a shot across the board an arrow, a slam round it a
 *    weight, a sweep a blade, a cross a throw. The shared skills that shape
 *    reads wrongly name their own (1).
 */
export function strikeDelivery(skill: HeroSkill, caster: Wielder): StrikeDelivery {
  if (skill.delivery) return skill.delivery;
  if (skill.formSkill) return 'natural';
  const scaling = skill.scaling ?? 'attack';
  if (scaling === 'magic') return 'spell';
  const held = wieldedDelivery(caster);
  const weapon = held && held !== 'spell' ? held : undefined;
  if (scaling === 'hybrid') return skill.range <= 1 && weapon ? weapon : 'spell';
  return weapon ?? (caster.blow && bodyDelivery(skill, caster.blow)) ?? shapeDelivery(skill);
}

/** An enemy's blow for a damaging skill its `blow` speaks for; undefined for a charge, a slam or a shout. */
function bodyDelivery(skill: HeroSkill, blow: StrikeDelivery): StrikeDelivery | undefined {
  // A charge is the body arriving; a shout or a ward is no blow at all
  if (skill.selfMove?.kind === 'dash' || !((skill.damage ?? 0) > 0)) return undefined;
  const t = skill.targetType;
  // A sweep is a swing at any reach — a dragon's wing, an emperor's cleave
  if (t === SkillTargetType.Arc || (t === SkillTargetType.Single && skill.range <= 2)) return blow;
  if ((t === SkillTargetType.Single || t === SkillTargetType.Line) && skill.range > 2) {
    return blow === 'bow' || blow === 'crossbow' ? blow : 'thrown';
  }
  return undefined;
}

function shapeDelivery(skill: HeroSkill): StrikeDelivery {
  // A dash's range is how far it travels, not how far it strikes: the blow
  // lands from the next hex, and what lands is the weight of whatever charged.
  if (skill.selfMove?.kind === 'dash') return 'blunt';
  switch (skill.targetType) {
    case SkillTargetType.Ring:
    case SkillTargetType.Self:
      return 'blunt';
    case SkillTargetType.Arc:
      return 'blade';
    case SkillTargetType.Cross:
      return 'thrown';
    default:
      // A curse or a command cast across the board is no bowshot: only a blow that hurts is an arrow
      return skill.range <= 1 ? 'blade' : (skill.damage ?? 0) > 0 ? 'bow' : 'spell';
  }
}

/**
 * What a strike did, from the two facts that decide it: the roll, and the health
 * the target actually lost.
 *
 * **HP lost, read back, and never damage minus absorbed** — the rule
 * `applyOnHitStatuses` already keeps, and for the same reason: an Invulnerable
 * target absorbs nothing and loses nothing, and it has blocked the blow just as
 * surely as a full Barrier has. A blocked crit is `blocked`: the shield taking
 * it is the thing that happened.
 */
export function strikeOutcome(result: { dodged: boolean; crit: boolean }, hpLost: number): StrikeOutcome {
  if (result.dodged) return 'dodged';
  if (hpLost <= 0) return 'blocked';
  return result.crit ? 'crit' : 'hit';
}

// ─── Spells ──────────────────────────────────────────────────────────────────

/** The schools an effect's *shape* names outright: lightning is storm whatever colour it is drawn in. */
const SHAPE_SCHOOL: Partial<Record<VfxKind, SpellFamily>> = {
  lightning: 'storm',
  snow: 'frost',
  cyclones: 'frost',
  ignite: 'fire',
  quake: 'earth',
};

/** Hue (degrees), saturation and lightness of `#rrggbb`, or null for anything else. */
function hsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** The school a colour reads as: red and orange burn, yellow strikes, green grows, blue freezes, tan is stone. */
function schoolOfColour(hex: string | undefined): SpellFamily {
  const c = hex ? hsl(hex) : null;
  if (!c || c.s < 0.08) return 'arcane';
  // Pale gold and white are light rather than flame: a holy bolt is not a fire spell.
  if (c.l > 0.78 && c.s > 0.6 && c.h <= 70) return 'arcane';
  if (c.h >= 20 && c.h <= 50 && c.s < 0.5) return 'earth';
  if (c.h <= 50 || c.h >= 340) return 'fire';
  if (c.h <= 70) return 'storm';
  if (c.h <= 170) return 'nature';
  if (c.h <= 250) return 'frost';
  return 'arcane';
}

/**
 * The school a spell sounds as, in the order the rules can answer it:
 *
 * 1. the skill's own `spell`, where the picture is the wrong guide;
 * 2. an effect whose shape names a school — lightning, snow, a quake, a wildfire;
 * 3. the hue the effect is drawn in.
 *
 * Read off what the player already *sees*, which is the point: a fire spell
 * that sounds like frost is a lie told by two senses at once, and the colour
 * is the one thing every skill already carries. A shared skill is the same
 * school for whoever casts it, so an enemy's bolt and a hero's are one sound.
 */
export function spellFamily(skill: HeroSkill): SpellFamily {
  if (skill.spell) return skill.spell;
  const shaped = skill.vfxKind ? SHAPE_SCHOOL[skill.vfxKind] : undefined;
  return shaped ?? schoolOfColour(skill.vfxColor);
}

/** Auras that raise a defence, as against ones that lift a stat. */
const WARDS: ReadonlySet<StatusEffectType> = new Set<StatusEffectType>([
  AuraType.Barrier, AuraType.Invulnerability, AuraType.DefenseBuff, AuraType.Thorns, AuraType.FlameGuard, AuraType.DebuffImmunity,
  AuraType.MartyrSeal, AuraType.MagicDefenseBuff, AuraType.Reckoning,
]);

const AFFLICTIONS: ReadonlySet<StatusEffectType> = new Set<StatusEffectType>(Object.values(AfflictionType));

/**
 * What a skill that strikes nobody sounds as when cast: something called
 * (`summon`), a defence going up (`ward`), a curse or binding on an enemy
 * (`curse`), or a blessing (`boon`). A heal is not one — it is heard as the
 * mend its number is — and neither is a skill that does nothing the board shows.
 */
export function supportFamily(skill: HeroSkill): SupportFamily | undefined {
  if (skill.summons) return 'summon';
  // A heal is heard as its mend; one that also lifts afflictions is heard lifting them as it is cast
  if (skill.healing) return skill.cleanse ? 'cleanse' : undefined;
  const effects = skillEffects(skill);
  if (effects.length === 0) return skill.cleanse ? 'cleanse' : undefined;
  if (effects.some((e) => e.type === AuraType.SmokeCover)) return 'smoke';
  if (effects.some((e) => e.type === AuraType.Stealth)) return 'stealth';
  if (effects.some((e) => MARKS.has(e.type))) return 'mark';
  if (effects.some((e) => AFFLICTIONS.has(e.type))) return 'curse';
  return effects.some((e) => WARDS.has(e.type)) ? 'ward' : 'boon';
}

/** Afflictions that pick a target out for later blows rather than hurting it. */
const MARKS: ReadonlySet<StatusEffectType> = new Set<StatusEffectType>([
  AfflictionType.Mark, AfflictionType.HuntersMark,
]);

/** A Druid taking each shape, heard as the change. */
const SHIFT_GESTURES: Readonly<Record<WildFormId, SkillGesture>> = {
  bear: 'shiftBear', wolf: 'shiftWolf', hawk: 'shiftHawk', apex: 'shiftApex',
};

/** The shift into `form`, or back to the Druid's own shape for `null`. */
export const shiftGesture = (form: WildFormId | null): SkillGesture => (form ? SHIFT_GESTURES[form] : 'shiftReturn');

/**
 * The named move a skill is heard as: the skill's own `gesture`, then the creature
 * a summon calls (`SUMMON_GESTURES`). A shift is named by `announceShift`, which
 * knows the direction.
 */
export function skillGesture(skill: HeroSkill): SkillGesture | undefined {
  if (skill.gesture) return skill.gesture;
  const called = skill.summons?.templateId;
  return called ? SUMMON_GESTURES[called] : undefined;
}

/** What a cast sounds as: the school of a spell that does damage, the kind of support otherwise. */
export function castFamily(skill: HeroSkill, delivery: StrikeDelivery): CastFamily | undefined {
  if ((skill.damage ?? 0) > 0) return delivery === 'spell' ? spellFamily(skill) : undefined;
  // A skill that strikes nobody but names its kind of support or its school (the
  // Firefly's motes are holy light) is heard as that, before its effects are read
  return skill.support ?? supportFamily(skill) ?? skill.spell;
}

/** The school a strike lands as, for a skill delivered as `delivery`; undefined for a physical blow. */
export const spellOf = (skill: HeroSkill, delivery: StrikeDelivery): SpellFamily | undefined =>
  delivery === 'spell' ? spellFamily(skill) : undefined;

type Placed = Pick<CombatUnit, 'id' | 'position'>;
/** A unit struck or fallen: where it is, and what it is made of if it says (`bodyMaterial`). */
type Body = Placed & Partial<Pick<CombatUnit, 'templateId' | 'objective'>>;

/**
 * What a strike carries beyond its outcome: what the skill's blow is made of
 * (`HeroSkill.contact`) and what took it (`DamageResult.shieldedBy`, `shieldBroke`).
 */
export interface StrikeDetail {
  contact?: StrikeContact;
  damage?: ShieldReport;
  /** The skill's own landing (`skillVoice`), for a signature or capstone skill. */
  voice?: SkillVoice;
  /** A blocked blow turned aside by a staff rather than taken on steel (The Last Lesson). */
  parry?: true;
}

/** What a damage write says took the blow — `DamageResult`'s two fields, restated so the funnel can build intents. */
export interface ShieldReport {
  shieldedBy?: 'magic' | 'shell';
  shieldBroke?: true;
}

/**
 * A skill being used. `harmful` is whether it carries damage: a war cry is a
 * skill used, and nothing is swung.
 */
export function launchIntent(
  caster: Placed & Pick<CombatUnit, 'templateId'>,
  skill: HeroSkill,
  delivery: StrikeDelivery,
  delayMs?: number,
  gestureOverride?: SkillGesture,
): SoundIntent {
  const signature = bossSignature(caster.templateId, skill.id);
  const family = castFamily(skill, delivery);
  const gesture = gestureOverride ?? skillGesture(skill);
  const beat = beatOf(skill);
  const voice = skillVoice(skill.id, beat ? { beat } : {});
  return {
    kind: 'launch',
    unitId: caster.id,
    at: caster.position,
    delivery,
    harmful: (skill.damage ?? 0) > 0,
    ...(delayMs ? { delayMs } : {}),
    ...(family ? { family } : {}),
    ...(signature ? { signature } : {}),
    ...(gesture ? { gesture } : {}),
    ...(voice ? { voice } : {}),
  };
}

/**
 * A move with no resolved skill cast behind it, heard as a cast of `family` or as
 * a named `gesture`: a Reaction set, a Marked Prey mark laid, a Jarl's challenge
 * accepted. Never harmful: nothing is swung.
 */
export const supportIntent = (
  caster: Placed,
  sound: { family: CastFamily } | { gesture: SkillGesture },
  voice?: SkillVoice,
): SoundIntent => ({
  kind: 'launch', unitId: caster.id, at: caster.position, delivery: 'spell', harmful: false, ...sound,
  ...(voice ? { voice } : {}),
});

/**
 * `family` is the school of a spell's landing (`spellOf`); a physical blow has none.
 * `flank` is the approach it came from (`flankOf`), carried only by a blow that
 * landed from the side or the back — a dodge or a block took no bonus.
 */
export const strikeIntent = (
  target: Body,
  delivery: StrikeDelivery,
  outcome: StrikeOutcome,
  family?: SpellFamily,
  flank?: Flank,
  detail: StrikeDetail = {},
): SoundIntent => {
  const landed = outcome === 'hit' || outcome === 'crit';
  const material: BodyMaterial | undefined = landed ? bodyMaterial(target) : undefined;
  const { contact, damage, parry, voice } = detail;
  return {
    kind: 'strike', unitId: target.id, at: target.position, delivery, outcome,
    ...(delivery === 'spell' && family ? { family } : {}),
    ...(flank && flank !== 'front' && landed ? { flank } : {}),
    ...(contact && outcome !== 'dodged' ? { contact } : {}),
    ...(material ? { material } : {}),
    ...(outcome === 'blocked' && damage?.shieldedBy === 'magic' ? { block: 'magic' as const } : {}),
    ...(outcome === 'blocked' && parry ? { block: 'parry' as const } : {}),
    ...(damage?.shieldBroke && outcome !== 'dodged' ? { shieldBroke: true as const } : {}),
    ...(voice && landed ? { voice } : {}),
  };
};

/**
 * The detail a skill's strike carries: its contact, what the damage write said
 * took it, and — for a skill with a sound of its own — which of its blows this
 * is (`at`; `at.skillId` names the skill when the blow struck is not it, as
 * Marked Prey's cuts are its Basic Attack's).
 */
export const strikeDetail = (
  skill: Pick<HeroSkill, 'contact' | 'id'> | undefined,
  damage?: ShieldReport,
  at?: Omit<SkillVoice, 'skillId'> & { skillId?: string },
): StrikeDetail => {
  const { skillId, ...where } = at ?? {};
  const voice = at ? skillVoice(skillId ?? skill?.id, where) : undefined;
  return {
    ...(skill?.contact ? { contact: skill.contact } : {}),
    ...(damage ? { damage } : {}),
    ...(voice ? { voice } : {}),
  };
};

export const mendIntent = (target: Placed, voice?: SkillVoice): SoundIntent => ({
  kind: 'mend', unitId: target.id, at: target.position, ...(voice ? { voice } : {}),
});

/** A launch heard at another moment of a skill with a sound of its own: `voice` added when there is one. */
export const voiced = (intent: SoundIntent, voice: SkillVoice | undefined): SoundIntent =>
  voice && intent.kind === 'launch' ? { ...intent, voice } : intent;

/** Which moment of its skill a launch is, read off the skill as it is used. */
function beatOf(skill: HeroSkill): SkillBeat | undefined {
  if (skill.mantisStage === 2) return 'stage2';
  if (skill.mantisStage === 3) return 'stage3';
  return skill.releasing ? 'release' : undefined;
}

export const afflictionIntent = (target: Placed, status: StatusEffectType, voice?: SkillVoice): SoundIntent => ({
  kind: 'affliction', unitId: target.id, at: target.position, status, ...(voice ? { voice } : {}),
});

/** A lethal save fired on `unit`: heard as it stands up at 1 HP (`SAVE_CUES`). */
export const saveIntent = (unit: Placed, save: 'undying'): SoundIntent => ({
  kind: 'save', unitId: unit.id, at: unit.position, save,
});

export const moveIntent = (unitId: string, from: HexCoord, to: HexCoord, mode: MoveMode, steps?: number): SoundIntent => ({
  kind: 'move', unitId, from, to, mode, ...(steps !== undefined && { steps }),
});

/** A walk, heard on the walker's own feet (`footKind`): a wolf's paws, a centaur's hooves. */
export const walkIntent = (
  unit: Pick<CombatUnit, 'id'> & Partial<Pick<CombatUnit, 'templateId' | 'wildForm'>>,
  from: HexCoord,
  to: HexCoord,
  steps?: number,
): SoundIntent => {
  const feet = footKind(unit);
  return { kind: 'move', unitId: unit.id, from, to, mode: 'walk', ...(steps !== undefined && { steps }), ...(feet && { feet }) };
};

/**
 * How a skill's own movement reads. `free` is a leap to a chosen hex — the same
 * rush as a dash, pointed at ground instead of at somebody.
 */
export function selfMoveMode(spec: SelfMoveSpec): MoveMode {
  return spec.kind === 'free' ? 'dash' : spec.kind;
}

/**
 * Units whose health reached zero between two readings of the board.
 *
 * **Read off the store rather than emitted by a resolver, and that is forced.**
 * A unit dies down at least five routes — a skill's blow, a status tick, a
 * Thorns reflection, a Martyr's blast, a summon burning out — and only two of
 * them run through a resolver with a sink in reach. The one place every route
 * agrees is the health write, which is also what `UnitMesh` starts the collapse
 * from, so the sound of a body falling and the picture of it are started by the
 * same fact.
 *
 * By id, so a castle stage replacing the whole roster is not a massacre: the
 * new units were never alive in the old reading.
 */
export function fallenBetween(before: readonly CombatUnit[], after: readonly CombatUnit[]): SoundIntent[] {
  const wasAlive = new Set(before.filter((u) => u.currentHp > 0).map((u) => u.id));
  return after
    .filter((u) => u.currentHp <= 0 && wasAlive.has(u.id))
    .map((u): SoundIntent => {
      const material = bodyMaterial(u);
      return { kind: 'fall', unitId: u.id, at: u.position, ...(material ? { material } : {}) };
    });
}

/**
 * Bosses that entered a new phase between two readings of the board — the same
 * reading `fallenBetween` makes, for the same reason. By id, and only for a unit
 * that was already on the board: a castle stage that brings a fresh Emperor to
 * a new arena has not *entered* a phase, and the phase index only ever rises,
 * so one transition is one intent however many blows crossed its threshold.
 */
export function phasesEnteredBetween(before: readonly CombatUnit[], after: readonly CombatUnit[]): SoundIntent[] {
  const was = new Map(before.map((u) => [u.id, u.bossPhase ?? 0]));
  return after.flatMap((u): SoundIntent[] => {
    const prev = was.get(u.id);
    const phase = u.bossPhase ?? 0;
    if (prev === undefined || phase <= prev || u.currentHp <= 0 || !u.templateId) return [];
    return [{ kind: 'phase', unitId: u.id, at: u.position, templateId: u.templateId, phase }];
  });
}
