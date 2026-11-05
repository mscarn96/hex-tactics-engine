import type { HexCoord } from './hex';
import type { StatusEffectType } from './status';

/**
 * What a fight *sounds like*, stated as what happened rather than as a sound.
 *
 * The rules report every outcome through a sink the scene draws — a number, a
 * word, an effect — and sound joins them as one more channel beside `float` and
 * `vfx` (`CombatSink.sound`, `EventSink.sound`). What travels down it is an
 * intent: *a blade struck this unit and it was a critical*, *this unit walked
 * four hexes*, *a status bit it*. Which file answers is `src/audio/combatCues.ts`'s
 * decision, made in one table, so re-voicing a blow is an edit there and never a
 * hunt through two resolvers.
 *
 * **Nothing here is derived from what the player reads or sees.** The log's text
 * and the effect's `VfxKind` both say things about an event, and both are chosen
 * for the eye — a Basic Attack with a bow draws the same `shot` as a crossbow's,
 * and a slash is drawn for a sword, a hammer and a bare fist alike. An intent
 * carries the facts the rules had in hand when the event resolved.
 *
 * Plain data, so the headless simulator can drop the channel by never
 * supplying it, and the node suite can compare what the two execution paths
 * emitted for one outcome.
 */

/**
 * How a blow reaches its target: the physical families, and one word for
 * everything magical. The spell families refine `spell` when they arrive; every
 * physical family is heard as the material it is made of.
 *
 * Read through `strikeDelivery` (`systems/combat/soundIntents.ts`), which takes a
 * skill's own `HeroSkill.delivery` when it names one, a beast's paws for a form
 * skill, and otherwise what the caster is holding.
 */
export type StrikeDelivery =
  /** Edged steel swung: swords, axes, daggers, sickles. */
  | 'blade'
  /** A crushing weight: hammers, maces, cudgels, fists, a troll's smash, a shoulder charge. */
  | 'blunt'
  /** A thrust at a spear's length. */
  | 'reach'
  /** A weapon leaving the hand. */
  | 'thrown'
  /** An arrow. */
  | 'bow'
  /** A quarrel. */
  | 'crossbow'
  /** Teeth, claws, a beast's weight — anything with no weapon in it. */
  | 'natural'
  /** Magic of any school. */
  | 'spell';

export const STRIKE_DELIVERIES: readonly StrikeDelivery[] = [
  'blade', 'blunt', 'reach', 'thrown', 'bow', 'crossbow', 'natural', 'spell',
];

/**
 * The school a spell belongs to, for the ear. Skills share a school's voice —
 * every fire spell is the fire cast and the fire landing — so that "fire" is
 * something a player learns once; only a named boss's signature move is given a
 * sound of its own (`BossSignature`).
 *
 * Read through `spellFamily` (`systems/combat/soundIntents.ts`), which takes a
 * skill's own `HeroSkill.spell` when it names one and otherwise reads the school
 * off the effect's shape and colour — the two things the picture already says.
 */
export type SpellFamily =
  | 'fire' | 'frost' | 'storm' | 'earth' | 'nature' | 'arcane' | 'bolt'
  | 'sand' | 'shadow' | 'venom' | 'holy' | 'gale' | 'jade';

/**
 * `bolt` is no school but the plain magic missile — a staff's or wand's Basic
 * Attack and the casters' Arcane Bolt — and is only ever named on the skill
 * (`HeroSkill.spell`): a fast at-will heard as the arcane spells' slow drawn
 * tone and bell sounded wrong. No colour reads as it.
 *
 * `sand`, `shadow`, `venom` and `holy` are named on the skill too: no colour
 * reads as them either (tan was fire, the dark and holy spells arcane, blight
 * nature), and each is a school the player meets often enough to learn.
 *
 * `gale` and `jade` are Jadeveil's: the mountain wind the Daitengu and Kairen
 * throw, and the corrupted jade light of Kairen's orb. Named on the skill.
 */
export const SPELL_FAMILIES: readonly SpellFamily[] = [
  'fire', 'frost', 'storm', 'earth', 'nature', 'arcane', 'bolt', 'sand', 'shadow', 'venom', 'holy', 'gale', 'jade',
];

/**
 * Support a skill gives that strikes nobody: a barrier or an immunity going up
 * (`ward`), a blessing (`boon`), a curse or binding laid on an enemy (`curse`),
 * something called into the fight (`summon`), afflictions lifted off an ally
 * (`cleanse`), a unit slipping out of sight (`stealth`), a smoke charge
 * (`smoke`) and a target picked out (`mark`). Heard as the skill is cast —
 * there is no travel, and the status's own colour is already the landing.
 */
export type SupportFamily = 'ward' | 'boon' | 'curse' | 'summon' | 'cleanse' | 'stealth' | 'smoke' | 'mark';

/**
 * A named move heard as itself, in place of the cast or swing it would otherwise
 * have: a horn, a beast's call, a Druid changing shape, stone raised out of the
 * ground. Authored on the skill (`HeroSkill.gesture`) where the move is one the
 * player learns by sound; a shift and a summon are read off what the skill does
 * (`skillGesture`, `systems/combat/soundIntents.ts`).
 */
export type SkillGesture =
  | 'warhorn' | 'bearRoar' | 'wolfHowl' | 'hawkScreech' | 'challenge' | 'command'
  | 'shiftBear' | 'shiftWolf' | 'shiftHawk' | 'shiftApex' | 'shiftReturn'
  | 'rampart' | 'standard' | 'burrow' | 'tomb' | 'wing' | 'spit' | 'crystalPulse' | 'mark' | 'bastion'
  | 'gale' | 'cloudRise' | 'lesson' | 'fist'
  | 'summonFire' | 'summonStorm' | 'summonStone' | 'summonTreant' | 'summonUndead';

/**
 * What a blow is made of where its delivery is the wrong guide: teeth and claws
 * where every beast was a body blow, a web, acid, a bead of glass, mud, a thrown
 * block of ice, bolas, a roof coming down, a dragon landing, a crystal splinter.
 * Authored on the skill (`HeroSkill.contact`) and heard in place of the
 * delivery's or the school's landing.
 */
export type StrikeContact =
  | 'bite' | 'claw' | 'web' | 'acid' | 'glass' | 'mire' | 'iceBlock' | 'bolas'
  | 'collapse' | 'dragonLanding' | 'crystal' | 'gale' | 'chain';

/**
 * What a body is made of, for the ear: struck, a treant is wood and a golem
 * stone; fallen, a skeleton clatters and an ice spire breaks. Absent is flesh
 * (or anything with no sound of its own), heard as the blow and the fall always
 * were. Read through `bodyMaterial` (`data/display/bodySounds.ts`), by template
 * and by objective kind.
 */
export type BodyMaterial = 'wood' | 'stone' | 'bone' | 'ice' | 'iron' | 'spirit' | 'glass' | 'jade' | 'silk';

/**
 * Who an enemy is, for the short call it makes as its turn begins: a creature
 * family, or a boss of its own (`creatureCall`, `data/display/creatureCalls.ts`).
 */
export type CreatureCall =
  | 'wolf' | 'bear' | 'spider' | 'goblin' | 'orc' | 'bandit' | 'undead' | 'ghost' | 'wisp' | 'caster' | 'thrall'
  | 'fenfolk' | 'miner' | 'sandscourge' | 'herd' | 'giant' | 'livingIce' | 'legion' | 'oni' | 'tengu' | 'wyrmling'
  | 'thunderBeast' | 'kitsune' | 'tanuki' | 'kappa' | 'kodama' | 'monk'
  | 'warlord' | 'dragon' | 'heartOfWinter' | 'jorogumo' | 'aethelred' | 'kairen' | 'lastLesson';

/** What a walking unit's feet are, when they are not boots. */
export type FootKind = 'paw' | 'hoof';

/** What a cast is heard as: a school, or a kind of support. */
export type CastFamily = SpellFamily | SupportFamily;

/**
 * The attacks a named boss is told apart by — one each for the Warren's and the
 * Hollow's bosses, none yet for the Heart of Winter (its kit is borrowed), and
 * two for the Obsidian Emperor (his phase changes are `phase` intents).
 * Authored in `data/display/bossSounds.ts` by who casts what, never by skill
 * alone: a boss's signature can be a skill its roster shares.
 */
export type BossSignature = 'warlord' | 'dragon' | 'verdict' | 'assessment' | 'whiteout';

/**
 * What a strike did when it arrived.
 *
 * `blocked` is a blow that reached the unit and took nothing from it — a Barrier
 * soaked all of it, or the unit could not be hurt. It is a hit that did not
 * bleed, and it is told apart from `dodged`, which never arrived at all: the one
 * is steel ringing, the other is air, and the two must never be mistaken for
 * each other or for a landed blow.
 */
export type StrikeOutcome = 'hit' | 'crit' | 'blocked' | 'dodged';

/**
 * How a unit changed hex.
 *
 * - `walk` — a move action, stepped hex by hex.
 * - `dash` / `blink` — a skill carrying the caster before its strike.
 * - `retreat` — a skill carrying the caster away after its strike.
 * - `shove` — a knockback: somebody else moved this unit.
 */
export type MoveMode = 'walk' | 'dash' | 'blink' | 'retreat' | 'shove';

/**
 * Which moment of a skill heard in several a launch is: a charged shot's or a
 * beam's release, an aim taken, a mark laid, the second or third turn of the
 * Threefold Scythe. Absent, it is the skill's cast.
 */
export type SkillBeat = 'release' | 'aim' | 'mark' | 'stage2' | 'stage3';

/**
 * A signature or capstone skill heard by a sound of its own (`skillVoice`,
 * `data/display/skillSounds.ts`; the cues are `SKILL_CUES` in
 * `audio/skillCues.ts`). Carried on the moments that skill is heard at.
 *
 * - `beat` — which moment of a launch this is;
 * - `index` / `count` — which of a run of passes a strike is (Mantis
 *   Execution's five cuts, Glacial Barrage's shards, the Ancestral Hunt's three
 *   spirits, Marked Prey's two cuts), and how many passes there are;
 * - `hop` — how far down a chain a strike is (Chain Lightning);
 * - `repeat` — how many times one strike is heard (Blade Recall, once per blade).
 */
export interface SkillVoice {
  skillId: string;
  beat?: SkillBeat;
  index?: number;
  count?: number;
  hop?: number;
  repeat?: number;
}

export type SoundIntent =
  /**
   * A skill was used: a swing, a loosed arrow, a cast. `unitId` is the caster.
   * `harmful` is whether it carries damage — a war cry is a skill used with
   * nothing swung. `delayMs` holds it for a blow drawn later than the first —
   * the second hand of a dual-wield Basic Attack, exactly as its `VfxSpec` is
   * held.
   */
  | {
      kind: 'launch';
      unitId: string;
      at: HexCoord;
      delivery: StrikeDelivery;
      harmful: boolean;
      delayMs?: number;
      /**
       * What the cast is heard as, for a spell or a support skill; absent for a
       * physical blow, which is heard through its `delivery`.
       */
      family?: CastFamily;
      /** Set when a named boss is using the attack it is known by; it is heard instead of `family`. */
      signature?: BossSignature;
      /** A named move (`skillGesture`), heard instead of `family` or the swing; a signature outranks it. */
      gesture?: SkillGesture;
      /** A skill with a sound of its own, heard over its gesture, its family and its swing; a signature outranks it. */
      voice?: SkillVoice;
    }
  /**
   * A strike arrived at a unit. `unitId` is the unit struck.
   *
   * **Emitted immediately before the strike's own number**, on both paths, so a
   * scene can play it at the moment the number appears — the float queue decides
   * that moment, and this is the one place both can agree on it.
   */
  | {
      kind: 'strike';
      unitId: string;
      at: HexCoord;
      delivery: StrikeDelivery;
      outcome: StrikeOutcome;
      /** The school of a `spell` strike; absent for a spell with no school to name (a reflection, a blast). */
      family?: SpellFamily;
      /**
       * A landed blow from the target's side or its back (`systems/combat/facing`),
       * heard with the flank's own layer over the impact. Absent from the front.
       */
      flank?: 'side' | 'back';
      /** What the blow is made of, where the skill names it (`HeroSkill.contact`); heard over delivery and school. */
      contact?: StrikeContact;
      /** What the unit struck is made of (`bodyMaterial`), heard under a physical blow that names no contact. */
      material?: BodyMaterial;
      /**
       * Why a `blocked` blow took nothing: `magic` for a Barrier, a Reckoning or a
       * unit held from harm, heard as a shield taking it rather than steel ringing.
       * `parry` for a blow turned aside by a staff (The Last Lesson answering a
       * repeated move), heard as wood clacking. Absent for any other physical
       * block (a Beetle's carapace), heard as steel.
       */
      block?: 'magic' | 'parry';
      /** This blow emptied a Barrier that was standing: the shield is heard giving way. */
      shieldBroke?: true;
      /** The skill's own landing, heard in place of the contact's, the school's or the blow's. */
      voice?: SkillVoice;
    }
  /** A unit was healed. Emitted immediately before the number, like a strike; `voice` is a heal heard as its skill. */
  | { kind: 'mend'; unitId: string; at: HexCoord; voice?: SkillVoice }
  /**
   * A status did its work on a unit this turn — a poison bit, a burn burned, a
   * Doom came due. No swing is behind it, so it carries the status rather than a
   * delivery. Emitted immediately before its number. `voice` is the skill that laid
   * it, for a status heard as that skill's own (the Bell-Keeper's toll coming due).
   */
  | { kind: 'affliction'; unitId: string; at: HexCoord; status: StatusEffectType; voice?: SkillVoice }
  /** A unit changed hex. */
  /** `steps` is a walk's route length when it went around something; absent, the straight distance. */
  /** `feet` is a walker's paws or hooves (`footKind`); absent, boots on the arena's ground. */
  | { kind: 'move'; unitId: string; from: HexCoord; to: HexCoord; mode: MoveMode; steps?: number; feet?: FootKind }
  /**
   * A unit's health reached zero. Read off the store rather than emitted by a
   * resolver — see `fallenBetween` for why. `material` is what fell (`bodyMaterial`):
   * an ice spire breaks and a skeleton clatters where a body falls.
   */
  | { kind: 'fall'; unitId: string; at: HexCoord; material?: BodyMaterial }
  /**
   * A phased boss entered a new phase. Read off the store like `fall`, for the
   * same reason — the one place every route that wounds a boss agrees is its
   * health write — and which is also what makes one transition one intent: the
   * phase index only ever increases, so a reading that finds it higher has
   * found one transition however many blows crossed it. `phase` is the index
   * entered, `templateId` the boss's.
   */
  | { kind: 'phase'; unitId: string; at: HexCoord; templateId: string; phase: number }
  /**
   * A lethal save fired and the unit stood up at 1 HP instead of falling. `save`
   * names which one: only the Berserker's Undying is heard today.
   */
  | { kind: 'save'; unitId: string; at: HexCoord; save: 'undying' }
  /** The fight is over. */
  | { kind: 'result'; outcome: 'victory' | 'defeat' };

export type SoundIntentKind = SoundIntent['kind'];
