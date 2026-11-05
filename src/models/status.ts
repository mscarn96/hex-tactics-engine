import type { HexCoord } from './hex';

// ============ STATUS EFFECTS ============

export enum AuraType {
  HealOverTime      = 'heal_over_time',
  ManaRegenOverTime = 'mana_regen_over_time',
  AttackBuff        = 'attack_buff',
  DefenseBuff       = 'defense_buff',
  MagicBuff         = 'magic_buff',
  SpeedBuff         = 'speed_buff',
  Invulnerability   = 'invulnerability',
  DebuffImmunity    = 'debuff_immunity',

  /** Soaks incoming damage until spent. `magnitude` is the pool remaining. */
  Barrier           = 'barrier',
  /** Reflects `magnitude` (a fraction, 0.3 = 30%) of damage taken to the attacker. */
  Thorns            = 'thorns',
  /**
   * Ember Shroud's fire coat: Thorns by rule (`reflectedDamage` reads both), its own
   * type so it can wear the Pyromancer's name, mark, colour and flame shroud while
   * every other Thorns source keeps its green. `magnitude` is the reflected fraction.
   */
  FlameGuard        = 'flame_guard',
  /** Untargetable by single-target skills; broken the moment the unit attacks. */
  Stealth           = 'stealth',
  CritBuff          = 'crit_buff',
  /**
   * Extra critical *damage*, as percentage points on the multiplier.
   *
   * Separate from `CritBuff` rather than folded into it because the two are
   * different units — 15 means "15% more often" on one and "15% harder" on the
   * other — and a single magnitude driving both would make either number a
   * hostage to the other's tuning.
   */
  CritDamageBuff    = 'crit_damage_buff',
  /**
   * Flat extra damage on **single-target** strikes only, and it *stacks*.
   *
   * The one aura whose magnitude adds on re-application rather than taking the
   * larger of the two — see `STACKING_MAGNITUDE`. Restricted to single targets
   * because it is a blessing laid on a weapon: it rides one blow, so a spin
   * through six enemies must not collect it six times over.
   */
  BlessedWeapon     = 'blessed_weapon',
  SacredRhythm = 'sacred_rhythm',
  GroundedFocus = 'grounded_focus',
  /**
   * The Lifewarden's Cycle of Life: Growth charges banked by healing casts that
   * restored HP. `magnitude` is the count (1–3), held with no clock
   * (`duration: -1`); at three, the next damaging spell spends them all.
   */
  Growth = 'growth',
  /**
   * The Lifewarden's Second Spring: `magnitude` percent less damage taken from
   * any source but the unit itself, laid by a heal that found the ally badly hurt.
   */
  SecondSpring = 'second_spring',
  /**
   * The Templar's Martyr: nothing while it runs, an explosion around its
   * carrier the turn it expires.
   *
   * The mirror of `Doom` — same "pay later" shape, but the payload lands on
   * everything *around* the carrier rather than on the carrier itself, which is
   * why it needs its own path out of `tickEffectsOnUnit` (that function writes
   * exactly one unit, by design). Carried as an aura because it is applied to an
   * ally, alongside the immunity that makes surviving to the detonation certain.
   */
  MartyrSeal        = 'martyr_seal',
  /**
   * The Berserker's Carnage: the cheap swings land twice.
   *
   * Restricted to at-will single-target strikes by `CARNAGE_SKILLS`, so it
   * doubles the blows the Berserker throws for free rather than the expensive
   * ones it saves up for. Doubling Whirlwind would make the capstone "cast your
   * best skill twice", which is a different and much duller card.
   */
  Carnage           = 'carnage',
  /**
   * The Marksman's Rapid Fire: single-target shots arrive as a burst.
   *
   * Worth more than one shot in total, but each arrow is worth far less — so
   * it is a crit-fishing and overkill-avoiding window rather than a flat damage
   * buff. Five rolls instead of one, and five kill checks instead of one, which
   * is what lets a burst walk down a wounded line rather than dumping 200%
   * overkill into the first thing it touches.
   */
  RapidFire         = 'rapid_fire',
  /**
   * The Skirmisher's Bladestorm: free movement, and a ring of blades that bites
   * whatever is standing next to it.
   *
   * One aura rather than two, because the two halves are the same idea — the
   * blades are worth having only if you can get them onto people, and the
   * movement is worth having only because the blades are on you. `magnitude` is
   * the damage each adjacent enemy takes at the start of the carrier's turn.
   */
  BladeStorm        = 'blade_storm',
  /**
   * The Skirmisher's Flurry: every strike is chased by three light blades.
   *
   * Applies to *every* damaging skill, area included — the alternative would be
   * a capstone on an area path that only fires on single targets.
   */
  Flurry            = 'flurry',
  /**
   * The Shadowblade's Vanish: two turns spent standing still, bought back as
   * three actions in a row.
   *
   * One aura holding both halves of the trade. `magnitude` is how many actions
   * are owed; the wind-up is over when `duration` reaches its last turn, and
   * until then the carrier cannot act at all. Splitting it into a stun and a
   * separate charge counter would be two effects that must expire in lockstep
   * forever, and a save that caught them out of step would leave a Shadowblade
   * either permanently frozen or holding three free turns.
   */
  Ambush            = 'ambush',
  /**
   * The Shadowblade's Hemlock: coated blades. While it lasts, every strike the
   * carrier lands doses the target with poison.
   *
   * A window rather than a passive, and the difference is the whole card: the
   * turn spent coating the blades is the cost, and what it buys is that the
   * *next* three turns each apply a dose — including the fourth one, which is a
   * detonation. It is the path's answer to arriving at a tier-3 finisher gated
   * on `poisoned` with no reliable way to poison anything.
   */
  Envenomed         = 'envenomed',
  /** Fraction of damage dealt returned as healing, on every skill. */
  Lifesteal         = 'lifesteal',
  /**
   * A single stored retaliation. Spent the first time its carrier is damaged:
   * the attacker takes `magnitude` and is Shocked, and the charge is gone.
   *
   * Distinct from `Thorns`, which reflects a *fraction* of every hit forever and
   * applies nothing. This is one answer, held until it is needed — which is what
   * makes handing one to the whole party a plan rather than a stat buff.
   */
  StaticCharge      = 'static_charge',
  /**
   * Bookkeeping for the Undying passive's once-per-battle save.
   *
   * Carried as an effect rather than a field on the unit so it clears the same
   * way everything else per-fight does — by not surviving into the next combat.
   */
  UndyingSpent      = 'undying_spent',
  /**
   * The Berserker's Undying window (2026-10): its HP cannot fall below 1 until it
   * has played two regular turns on which it could act. `magnitude` is the number
   * of those turns still owed; `responding` marks a turn that counts as one, set
   * when such a turn begins and spent when the unit's turn ends. While it stands,
   * `undyingFury` adds the comeback Attack and lifesteal. Never ticks by duration.
   */
  UndyingWindow     = 'undying_window',
  /**
   * Magic Defense alone, as a number of points. `DefenseBuff` raises both
   * defences; this is the Templar's Oath, which is a ward against spells and
   * says nothing about blades.
   */
  MagicDefenseBuff  = 'magic_defense_buff',
  /**
   * The Bulwark's Reckoning: a Barrier of its own that remembers what it soaks.
   * `magnitude` is what it can still absorb; `stored` is what it has absorbed.
   * It soaks before an ordinary Barrier, and when it breaks or runs out the
   * stored damage goes off as a shockwave around its owner (`releaseReckoning`).
   */
  Reckoning         = 'reckoning',
  /**
   * Extra movement for one turn, in hexes: the Stoneshaper's Seismic Sense
   * laid at the start of a turn that begins on a hex a warned ground attack
   * covers. Read by `getCombatEffectiveStats` as `moveRange`.
   */
  SeismicStep       = 'seismic_step',
  /**
   * The Stormcaller's Overload, primed: the next single-target lightning bolt
   * deals `magnitude` (a fraction) more damage and spends this. Laid by the
   * `overload` passive after a cast struck several already-Shocked enemies.
   */
  Overloaded        = 'overloaded',
  /**
   * Aethelred's orb, charged. `magnitude` is how many charges it holds; the
   * next orb telegraph spends them all to mark extra hexes. Carried as an aura
   * on the boss so the party can read the charge off its status row instead of
   * trusting a counter nobody can see.
   */
  OrbCharge         = 'orb_charge',
  /**
   * A Hydromancer holding Absolute Zero's charge. Laid at `CHARGE_DURATION` and
   * ready once its first tick has passed, which happens only at the start of the
   * owner's next regular turn; a bonus turn cannot release it. Stun, Silence or
   * Taunt landing on the owner breaks it.
   */
  Charging          = 'charging',
  /**
   * A Marksman holding Aimed Shot's aim at one enemy (`ActiveEffect.aimAt`).
   * Laid at `CHARGE_DURATION` like `Charging` and ready on the owner's next
   * turn: the next regular one, or a bonus turn, which arms it (`armed`) since
   * the aim locks every other skill. The release may only be fired at that unit. Moving, the
   * target falling, or Stun, Silence or Taunt landing on the owner drops it.
   */
  Aiming            = 'aiming',
  /**
   * The Marksman's Settle In: a turn ended without moving makes the next ranged
   * damaging cast ignore `magnitude` points of Physical Defense penetration.
   * One charge, spent by that cast; laid at the start of a regular turn.
   */
  SettledAim        = 'settled_aim',
  /**
   * The Troll Chieftain's Fury, lit when he drops to half health and kept for
   * the rest of the fight. `magnitude` is the share of damage his blows gain
   * (0.5 = +50%). Carried as an aura so the party reads it off his status row
   * and the arena lights him red (`AURA_GLOW`).
   */
  Fury              = 'fury',
  /**
   * Torn open: the bearer takes `magnitude` more damage from every blow (0.25 =
   * +25%). Laid on a boss for a window the party earned — the Heart of Winter's
   * released restraints, a cleared field of spires. A multiplier on the strike
   * like Fury and Mark, so armour has already answered.
   */
  Exposed           = 'exposed',
  /**
   * The Cave Bear's Winter Sleep: a unit that took a blow it would have died of
   * and is sleeping it off. It takes no turns while it lasts and wakes at full
   * health when `duration` runs out — once per battle, because the lethal save
   * that lays it is the same one-use `UndyingSpent` bookkeeping every save uses.
   */
  Slumber           = 'slumber',
  /**
   * The Orc Berserker's Pain Feast: `magnitude` is the hits it has taken since
   * its last empowered swing. Every separate strike counts, each blow of a
   * multi-hit skill included; at `BALANCE.PAIN_FEAST_THRESHOLD` its next Slash
   * is the empowered one, and the stacks are spent when that swing is announced.
   */
  Rage              = 'rage',
  /**
   * The Brigand Captain's Captain's Authority, worn by every other ally of his
   * while he lives. `magnitude` is the share every combat stat gains (0.5 =
   * +50%). Laid and lifted only by `syncAuthority`, which is the one place that
   * decides who has it, so two Captains cannot stack it and a dead one cannot
   * leave it behind.
   */
  Authority         = 'authority',
  /**
   * The Revenant between its first death and its second life. Its body lies inert
   * and nothing can strike it while its soul fragments race home: `magnitude` is
   * how many have arrived so far and `stacks` how many are still loose. Written
   * only by `combatStore.breakSoul` and settled by `settleSoul`.
   */
  SoulSplit         = 'soul_split',
  /**
   * The Burrowmother between her burrowing and her eruption: nothing can aim at her
   * and nothing lands on her until she surfaces. Laid when Undermine is cast and
   * lifted when it lands (`factionEliteActions`).
   */
  Burrowed          = 'burrowed',
  /**
   * A hero sealed in the Glacier Colossus's Glacial Tomb. The block is a separate,
   * attackable objective standing on the hero's hex; the hero cannot act or be hurt,
   * is not told apart from the block by anything that finds a unit by its hex, and
   * keeps every damaging status exactly as it was until they are freed.
   */
  Encased           = 'encased',
  /**
   * A hero wrapped in the Jorogumo's web (the Yokai). Held out of the fight as Encased
   * is — no turn, no harm, statuses held — while the web, a 1-health objective on the
   * hero's hex, stands. Breaking it frees them; left standing, it is what her bite
   * finds on her next turn (`systems/combat/yokaiKits`).
   */
  Webbed            = 'webbed',
  /**
   * Jadeveil: Silk Hollow / Yokai — the Jorōgumo hanging over her arena on three threads
   * (`systems/combat/yokaiKits`). She still takes her turns, but nothing can aim at her,
   * harm her or afflict her: the threads are what can be struck, and cutting the last
   * drags her down (her second phase, which lifts this).
   */
  Suspended         = 'suspended',
  /**
   * Jadeveil: Kairen risen into the clouds while his Cloud Dive is warned. As
   * `Suspended`: nothing can aim at him, harm him or afflict him until he crashes
   * down at the far end of the line, where he lands Exposed.
   */
  Aloft             = 'aloft',
  /**
   * Either duelist of the Rime Jarl's Challenge while the rune circle is up
   * (`CombatUnit.duel` carries the geometry). On the Jarl `magnitude` is the share
   * of direct Attack-scaled damage the duel adds; on the hero it is 0.
   */
  Duel              = 'duel',
  /** The hero who has been challenged and has not yet answered. Cleared by the answer. */
  Challenged        = 'challenged',
  /**
   * The Jarl kneeling after a duel the hero survived: his next regular turn is lost,
   * and a speed-granted turn cannot bypass it. A duration of 1 is that one turn.
   */
  Kneeling          = 'kneeling',
  /**
   * Blood Howl (Wildshape remaster): `magnitude` Attack and `BLOOD_HOWL_CRIT` Critical
   * Chance, read only while the carrier is in Wolf form, and while it lasts each direct
   * critical hit the Wolf lands queues an extra turn (`combatStore.queueHowlTurn`).
   * Leaving Wolf form removes it.
   */
  BloodHowl         = 'blood_howl',
  /** Slip the Net: `magnitude` percentage points of Dodge Chance. */
  Evasive           = 'evasive',
  /**
   * The Apex shape's clock: the regular turns left in it, the cast turn counting as
   * the first. At the end of the regular turn on which it shows 1 the Druid reverts
   * (`combatStore.nextTurn`). Written by `setWildForm`, never by a skill.
   */
  Apex              = 'apex',
  /**
   * The Skirmisher's Smoke Bomb cloud, carried by the caster: while the caster
   * stands on one of `ActiveEffect.zone`'s hexes its Dodge is at least
   * `magnitude` percent (a floor, not an addition). The cloud stays where it was
   * dropped and lasts the aura's duration; the arena draws it from the zone.
   */
  SmokeCover        = 'smoke_cover',
  /**
   * The Shadowblade's Shadow Echo: the shadow Shadowstep leaves at the hex it
   * left. `zone[0]` is that hex; the carrier may return to it for mana without
   * spending its action (`shadowEcho.returnToEcho`). One per caster, replaced by
   * the next Shadowstep, gone once returned to or when its turns run out.
   */
  ShadowEcho        = 'shadow_echo',
  /**
   * The Monk's Meditate: a stance taken now and paid at the start of the
   * Monk's next turn. Nothing while it runs; on the tick that retires it, the
   * Monk heals a share of its maximum HP and gains Attack and Magic for that
   * turn (`BALANCE.MEDITATE`). The Martyr seal's and Doom's "pay when it
   * expires" shape, so nothing has to remember the promise.
   */
  Meditation        = 'meditation',
  /**
   * The Firefly's Lightbond, carried by the bonded ally: whenever the unit named by
   * `sourceUnitId` deals damage, the carrier heals `magnitude` percent of it, once
   * per blow (`combatEvents.applyLightbond`). One bond per Firefly — a new one
   * lifts the old (`applySkillStatus`).
   */
  Lightbond         = 'lightbond',
  /**
   * The Beetle's banked Carapace charges (Iron Carapace, Shell Breath).
   * `magnitude` is the count, up to `BALANCE.BEETLE.CARAPACE_MAX`, held with no
   * clock (`duration: -1`); each is `CARAPACE_DEFENSE` Physical Defense. At a
   * full set the next hostile blow that would damage the carrier is soaked whole
   * and spends them all (`damageFunnel.takeDamage`).
   */
  Carapace          = 'carapace',
  /**
   * Shoulder to Shoulder's badge: worn by its Beetle for the whole fight
   * (`duration: -1`, laid at fight start) so the player remembers to stand in the
   * ring. `magnitude` is the percentage an adjacent ally does not take. The rule
   * reads the passive (`beetle.shoulderReduction`); this is what the HUD shows.
   */
  ShoulderGuard     = 'shoulder_guard',
  /**
   * The Mantis's Marked Prey, held by the Mantis (`aimAt` names the prey). Laid at
   * `BALANCE.MANTIS.MARK_TURNS`, so it can be released on either of the Mantis's next
   * two regular turns (or on a bonus turn taken first, which arms it, `armed`) and
   * fades unreleased at the third. `stored` is the HP the prey
   * has lost since the mark, from any source (`damageFunnel`). It locks nothing:
   * moving, other skills and the Basic Attack all leave it standing.
   */
  MarkedPrey        = 'marked_prey',
  /**
   * The Lantern Beacon's light on an ally standing within its reach: `magnitude`
   * points of Critical Chance while it lasts. Laid and lifted only by
   * `combatStore.syncBeacons`, which reads positions, so stepping out of the light
   * takes it off (`duration: -1`, no clock).
   */
  BeaconLight       = 'beacon_light',
  /**
   * The Lantern Beacon's light on an enemy within its reach: the bearer takes
   * `magnitude` more from every blow (0.15 = +15%), like Exposed, and cannot be
   * Stealthed — a Stealth it wore is stripped and a new one refused. Laid and
   * lifted only by `combatStore.syncBeacons`.
   */
  BeaconLit         = 'beacon_lit',
}

export enum AfflictionType {
  Poison = 'poison',
  Stun   = 'stun',
  Freeze = 'freeze',
  Taunt  = 'taunt',
  Bleed  = 'bleed',

  /** Fire DoT. Re-applying adds to `magnitude` rather than refreshing it. */
  Burn       = 'burn',
  /** −speed. Chilling an already-chilled unit freezes it instead. */
  Chill      = 'chill',
  /**
   * A boss's answer to the freeze a hero's second Chill would have laid: the
   * Chill is spent and this mark stands instead. It disables nothing. The next
   * blow consumes it for a burst of `magnitude` damage (fixed at creation from
   * the creator's Magic, never rolled), and Shatterpoint and Shatterstep count
   * that blow as a shatter. One mark at most: a fresh one refreshes it.
   */
  Brittle    = 'brittle',
  /** Damage taken chains at reduced strength to one adjacent ally of the target. */
  Shock      = 'shock',
  /** Cannot move, **can** act. */
  Root       = 'root',
  /** Cannot use skills, **can** move and Basic Attack (`cooldowns.silenceBars`, PT-19). */
  Silence    = 'silence',
  AttackDown  = 'attack_down',
  /**
   * −Magic, as a number of points: Attack Down's other half, for a spell. The
   * Beetle's Numbing Staff lays both at once, so a numbed enemy hits and casts
   * weaker for its next turn.
   */
  MagicDown   = 'magic_down',
  DefenseDown = 'defense_down',
  /**
   * Physical Defense alone, as a number of points. `DefenseDown` strips both
   * defences; this is Stonecutter's crack in a Rooted enemy, which opens it to
   * blades and stone and leaves its resistance to spells where it was.
   */
  PhysicalDefenseDown = 'physical_defense_down',
  /** Takes `magnitude` extra damage as a fraction, but only from `sourceUnitId`. */
  Mark       = 'mark',
  SacredSeal = 'sacred_seal',

  /**
   * A telegraphed heavy. Does nothing while it runs and deals `magnitude`
   * damage the moment it expires.
   *
   * The exact inverse of `detonates`, which spends an affliction *early* for a
   * burst. Doom hands the player a turn to answer — move out, cleanse it, or
   * take it — which is what turns a big number into a decision. Cleansing
   * removes it before it ever lands, and that is the intended out.
   */
  Doom       = 'doom',

  /**
   * Aethelred's Writ of Seizure. On the carrier's next turn a class skill costs
   * `magnitude` (a fraction of the carrier's maximum HP) and lends its source a
   * Barrier; a basic attack or a step voids it, and a cleanse lifts it.
   */
  Writ       = 'writ',
  /**
   * One end of Chains of Tribute. Two heroes carry it from the same source; the
   * claim lands on both if they end close together and on the weaker alone if
   * they do not. A cleanse severs the link.
   */
  Chained    = 'chained',
  /**
   * A Legion soldier Aethelred has claimed. At the collection it is sacrificed
   * to fuel the orb's blast; killing it first weakens the blast.
   */
  Branded    = 'branded',
  /**
   * The Troll Chieftain's Bonebreaker wound. One stack per hero hit, and it
   * **never expires**: only a cleanse removes it. `magnitude` is the Defense
   * (both defences) the stacks take together and `stacks` counts them; there is
   * no stack cap, but the shred floor in `getCombatEffectiveStats` still stops
   * a wounded hero's defence going below a fraction of what it started at.
   */
  Wound      = 'wound',
  /**
   * The Dark Mage's Mind Control. The carrier acts for the other side on each of
   * its next `duration` turns, with its own skills against its own party, and
   * then returns. A cleanse lifts it; the Mage falling lifts it too.
   */
  MindControl = 'mind_control',
  /**
   * The Orc Warchief's order: while the Warchief lives and can still shout, every
   * Orc allied to it makes for this hero on its next actions.
   */
  Warband     = 'warband',
  /**
   * The Delve Overseer's Fracture. Marks a hero for the Overseer's next Ground
   * Slam, which erupts around every Fractured hero and consumes the marks.
   */
  Fracture    = 'fracture',
  /**
   * The Ashwood Crone's Witch's Geas. The carrier's next spell that is not a
   * basic attack still works, and raises a warned eruption around them; a basic
   * attack or a cleanse lifts it unspent.
   */
  Geas        = 'geas',
  /**
   * Hunter's Mark: the next `stacks` damaging Hawk attacks by `sourceUnitId` against
   * this enemy deal `magnitude` percent more, one charge each. A dodge spends nothing.
   */
  HuntersMark = 'hunters_mark',
  /**
   * Crowned Prey: the next `stacks` damaging hits by the marker's side (`sourceSide`)
   * add `magnitude` magic damage, fixed when the mark was laid, one charge each.
   */
  CrownedPrey = 'crowned_prey',
  /**
   * The Skirmisher's Embedded Blades: blades left in an enemy by its attacks.
   * One entry per Skirmisher (`sourceUnitId`), so two of them never share or
   * steal a pile; `magnitude` (and `stacks`) is the count, capped at
   * `BLADES_CAP`. No clock (`duration: -1`) and no damage over time: the
   * Signature pulls them out for the damage. Written by `combatStore.embedBlades`
   * and `extractBlades`, never by `applyEffect`, which keeps one entry per type.
   * A cleanse removes them, like any affliction.
   */
  Blades      = 'blades',
  /**
   * Assassinate's Death Mark (Shadowblade remaster, 2026-10). The carrier takes
   * `magnitude` more direct damage from every attacker; at the start of each of
   * its source's regular turns, a carrier inside the source's execution window is
   * blinked to and finished (`assassination`). Its `duration` counts the
   * *source's* regular turns, not the carrier's, so the carrier's own tick leaves
   * it alone.
   */
  DeathMark   = 'death_mark',
  /**
   * Jadeveil: Kairen — the green orb's Jade Taint (`systems/combat/kairenRules`).
   * `magnitude` is the stack count, 1 to `BALANCE.KAIREN.TAINT_CAP` (3); a new dose
   * adds to it (`STACKING_MAGNITUDE`). It does nothing on its own: it multiplies
   * Verdant Judgement. No clock, and no cleanse reaches it — only Kairen's own
   * lightning (phase 2) and a broken Jade Shard (phase 3) clear it.
   */
  JadeTaint   = 'jade_taint',
  /**
   * The Mantis's Pinning Cut (playtest 2026-10-17, PT-22), shown as "Exposed":
   * the carrier takes `magnitude` more damage (a fraction) from `sourceUnitId`
   * alone — unlike `AuraType.Exposed`, a boss window every blow reads. A plain
   * debuff on the carrier's clock, so a boss carries it like anyone; nothing
   * spends it early. `damageCalc.cutOpenMultiplier` is the rule.
   */
  CutOpen     = 'cut_open',
  /**
   * The archipelago, drawn ahead of its rules (the private project notes): the
   * Duelist's Challenge on an enemy. It deals `magnitude` (a fraction) less damage to anyone but
   * `sourceUnitId`, the Duelist who laid it. Nothing is forced, so a boss carries it like anyone.
   * Not the Rime Jarl's `AuraType.Challenged`, which is a question put to a hero.
   */
  CalledOut   = 'called_out',
  /**
   * The archipelago: what Breaching Shot leaves behind once it has shattered a Barrier or a
   * shield — `magnitude` points of Physical Defense for two turns, for every attacker. The
   * Gunner's hole through the armour, where `PhysicalDefenseDown` is the Stoneshaper's crack.
   */
  Breached    = 'breached',
  /**
   * The archipelago: a hero held by the Siren Choir's song. The Choir Mother's third verse lays
   * it for a turn on the heroes beside her (the private project notes).
   */
  Charmed     = 'charmed',
  /**
   * The Emerald Dragon's Furnace Heart, on the hero who carries it: they receive `magnitude` (a fraction,
   * `DRAGON_HEART_HEAL_CUT`) less healing on every path through `healUnit` (a Barrier is not healing), and
   * `stacks` counts the turns they have kept it, which the Heart's burn grows with (`dragonHeartBurn`). It
   * goes wherever the Heart goes (`combatStore.carryObjective`), leaves when it does, and no cleanse lifts
   * it while the Heart is carried (`isCleansable`).
   */
  Seared      = 'seared',
}

export type StatusEffectType = AuraType | AfflictionType;

export interface ActiveEffect {
  type: StatusEffectType;
  magnitude: number;
  /**
   * Turns remaining. `-1` is the whole fight.
   *
   * `99` used to mean "until some condition", and Freeze — "until struck" — was
   * its only producer. Freeze has a real duration now, so **nothing in `src/`
   * writes a 99 any more**. The readers stay (`tickEffectsOnUnit` skips the
   * decrement, `detonationTurns` counts it as one turn rather than ninety-nine,
   * `statusDisplay` draws it as `∞`) because a stray 99 arriving from an old
   * save or a future conditional effect must not read as ninety-nine banked
   * turns of a poison.
   */
  duration: number;
  sourceUnitId?: string;
  /**
   * Refuse the upgrade `applyEffect` would otherwise apply — see
   * `SkillEffect.exact`, which is where this is authored.
   *
   * Carried onto the live effect rather than consumed at the call site because
   * the decision belongs to the store: `applyEffect` is the one place every
   * route in (a skill, a passive, a bite, a coated blade) passes through, and
   * that is exactly why the Chill→Freeze escalation lives there. A flag checked
   * one layer up would have to be checked in all of them.
   */
  exact?: boolean;
  /**
   * This Burn is Brimming Over's spill, and never spills again. A note to
   * `applyEffect` that it consumes, so it never stands on a live effect.
   */
  spilled?: boolean;
  /**
   * Monotonic sequence number stamped by `applyEffect`, used to break ties by
   * recency. Array position cannot do this job: refreshing an existing effect
   * updates it in place, so a re-applied taunt would keep the ordering of the
   * one it replaced.
   */
  appliedAt?: number;
  /**
   * How many doses are in this effect, where the mechanic counts doses.
   *
   * Poison is the only one, and it needs a count separate from `magnitude`
   * because the two say different things: magnitude is how hard it bites, and
   * a dose is a unit of the resource the Shadowblade spends. They cannot be the
   * same number, because a stack is worth the applier's attack — so "three
   * doses" is 21 points from one hero and 45 from another, and a cap expressed
   * in points would mean a different number of doses per hero.
   */
  stacks?: number;
  /**
   * Crumble (Stoneshaper remaster, 2026-10): the Physical and Magic Defense this
   * Stun or Root strips while it stands. Stamped by `applyEffect` when the source
   * holds the node, so the shred lives and dies with the control itself — expiry,
   * a cleanse or any removal ends it, and a resisted control never carries one.
   * `getCombatEffectiveStats` counts the largest per source, so an overlapping Stun
   * and Root from one Stoneshaper strip it once.
   */
  crumble?: number;
  /**
   * On a Taunt: Dropped Guard's share, stamped by `applyEffect` when the source holds
   * the node, so it lives and dies with the Taunt. Added in `damageCalc.exposedMultiplier`.
   */
  tauntedExposure?: number;
  /** Damage a Reckoning barrier has absorbed so far, or the HP a Marked Prey's prey has lost since the mark. */
  stored?: number;
  healMagnitude?: number;
  sourceSide?: boolean;
  /** The unit an `Aiming` or `MarkedPrey` aura is aimed at. */
  aimAt?: string;
  /**
   * On `Aiming` or `MarkedPrey`: a bonus turn has begun since it was laid, so its
   * release may be fired now although its first tick has not passed (`beginBonusTurn`).
   */
  armed?: boolean;
  /** On `AuraType.UndyingWindow`: the turn now being played counts as a response turn. */
  responding?: boolean;
  /** The hexes a `SmokeCover` cloud covers, fixed where it was dropped. */
  zone?: HexCoord[];
}
