/**
 * How long a prepared Reaction stands by default, in its owner's turns, and the
 * floor every Reaction is held to (playtest 2026-10-17, PT-10): a setup that
 * waits for a trigger needs time for the trigger to come. Pinned by
 * `reactionDuration.test.ts`.
 */
const REACTION_TURNS = 3;

export const BALANCE = {
  QUEST_HUNT_WEIGHT: 5,
  QUEST_HUNT_MISSES: 2,
  /**
   * The chance a wandering fight on the quarry's own ground (the ground the
   * quest hint paints) is a hunt fight: one fielding an unfinished kill
   * objective's target (playtest PT-01: "on the right hexes it should be very
   * high, say 80–90%"). The miss guarantee stays as the backstop.
   */
  QUEST_HUNT_CHANCE: 0.85,
  CATCHUP_LEVEL_GAP: 2,
  CATCHUP_XP_PER_LEVEL: 0.25,
  ACHIEVEMENT_NOTICE_MS: 3200,
  /**
   * Every hostile unit's strength, on top of the campaign's difficulty: regular
   * enemies, elites, bosses, enemy summons, castle and siege fights alike. It
   * multiplies the difficulty's HP and finished-damage factors
   * (`runDifficulty.difficultyMultipliers`), so the difficulties keep their
   * spacing and their menu text, which quotes them against Medium.
   *
   * Raised from 1 by the playtest of 2026-10-30: villages, merchants and the new
   * quests gave the party new ways to grow stronger and the world read too easy.
   * A tuning starting point; this is the one number to turn.
   */
  ENEMY_STRENGTH: { hp: 1.1, damage: 1.1 },
  /** Medium is permanently the base balance; loot and hero stats never scale. */
  RUN_DIFFICULTY: {
    easy: { hp: 0.75, damage: 0.75 },
    medium: { hp: 1, damage: 1 },
    hard: { hp: 1.25, damage: 1.25 },
  },
  // Leveling
  /**
   * The **base** level cap: every campaign without an expansion, and an owner's
   * campaign until Aethelred falls. Nothing outside tuning tools should cap by
   * this directly — `levelCap()` in `data/levelCap.ts` is the effective cap.
   */
  MAX_LEVEL: 20,
  /** Hero levels each crossing opened adds, and the width of one world's level band. */
  EXPANSION_LEVELS: 5,
  /** The expansion worlds a campaign can ever cross to, and so the crossings that raise the cap. */
  MAX_WORLD_CROSSINGS: 4,
  /**
   * `xpToNext = XP_LINEAR × level + XP_QUADRATIC × level²`
   *
   * Quadratic because XP income grows with enemy tier; linear alone makes late
   * levels arrive faster in real terms. ~7,800 XP to cap.
   */
  XP_LINEAR: 15,
  XP_QUADRATIC: 2,

  /**
   * What a hero's per-level growth is multiplied by, per stat.
   *
   * Applied in `calculateStatsForLevel` and **nowhere else**, on the *growth*
   * term only — base stats are untouched, so level 1 is exactly the body it has
   * always been and `homeRing.test.ts`'s opening-hour measurements stand. The
   * boost compounds with level, which is where it was wanted.
   *
   * **Per stat rather than one number, because a flat scale cannot close the gap
   * it was raised to close.** Over levels 1→20 offence multiplies ×5.07–5.75
   * while health only manages ×3.17–3.38, so combat gets steadily swingier — and
   * a uniform factor preserves that ratio exactly (a Warrior's attack-to-health
   * ratio would go 1.50 → 1.53, very slightly worse). Weighting health and
   * defence above offence is what actually bends the curve: the same Warrior
   * lands at 519 HP / 77 attack, a ratio of 1.27.
   *
   * A knob here rather than re-authored tables because the class figures are
   * small integers — attack and defence run 1–4 — so +25% is not expressible as
   * a step at all, and re-scaling all 28 of them would move every balance
   * intuition in the game at once. `calculateStatsForLevel` rounds, so the
   * fractions never reach a stat.
   *
   * `moveRange` is deliberately 1: it is a hex count, every class grows it by
   * zero, and a multiplier on a movement allowance is a different design
   * question from a multiplier on a number.
   */
  HERO_GROWTH_SCALE: {
    maxHp: 1.4,
    defense: 1.4,
    attack: 1.1,
    magic: 1.1,
    speed: 1.25,
    maxMana: 1.25,
    moveRange: 1,
  } as const,

  // Combat
  /**
   * `damage = raw × (1 − defence / (defence + this × attacker's power))`, the
   * attacker's power being the stat the hit scales from (`defenceReduction`).
   * A percentage of the whole hit since the playtest of 2026-10-14: it was a
   * flat `0.4 × defence` off every hit, which floored small hits on a stacked
   * tank and barely touched big ones. At 3, defence equal to the attacker's
   * power takes 25% off and twice it 40%.
   *
   * It was 1.5 (100 against 100 → 40%) until the playtest of 2026-10-17: a
   * level-12 Monk at 90 defence lost 53% of every Warlord blow and was barely
   * scratched by the first boss. At 3 the same Monk loses 36% (Bonebreaker
   * Sweep 25 → 34, Warren Collapse 60 → 81 of about 285 HP). A tuning starting
   * point to verify in play.
   */
  DEFENSE_ATTACKER_K: 3,
  /**
   * The share of the ordinary percentage reduction (`defenceReduction`) a
   * damage-over-time tick takes (playtest 2026-10-21: Poison, Bleed and Burn
   * ignored armour entirely). Half, so a tick is still worth more against a wall
   * than a blow is, which is what a damage-over-time build is for. A Bleed meets
   * Physical Defense, a Burn and a Poison Magic Defense (`dotDefenceFactor`).
   * Doom is not a tick and keeps ignoring defence.
   */
  DOT_DEF_SHARE: 0.5,
  /**
   * A unit that states no Magic Defense has this share of its Physical Defense.
   * 1 keeps every unit authored before the two were separated mitigated exactly
   * as it was; content that wants a physical wall or a warded caster states
   * `magicDefense` rather than moving this.
   */
  MAGIC_DEFENSE_RATIO: 1,
  /** Boss-only playtest tuning, applied to authored defence before encounter scaling. */
  BOSS_PHYSICAL_DEFENSE_SCALE: 1.1,
  BOSS_MAGIC_DEFENSE_SCALE: 0.9,
  /**
   * Facing and flanks (`systems/combat/facing`): an adjacent attacker on the
   * target's back hex deals the backstab, on one of its two rear-side hexes the
   * smaller flank. The front three hexes deal plain damage.
   */
  BACKSTAB_MULTIPLIER: 1.5,
  FLANK_MULTIPLIER: 1.2,
  MIN_DAMAGE: 1,
  /**
   * Fraction of a strike's raw power that defence can never remove: the cap on
   * `defenceReduction` is `1 - this`. Unreachable on any real sheet under the
   * percentage formula (it needs four times the attacker's power in defence);
   * kept so no stack of buffs can make a unit immune.
   */
  MIN_DAMAGE_FRACTION: 0.2,

  /**
   * The most of a stat that shred may ever remove.
   *
   * `MIN_DAMAGE_FRACTION`'s counterpart, one direction over: that one stops
   * armour making a unit immune, this one stops debuffs making a unit useless.
   * Attack, defence and magic used to floor at zero, which is enough to keep the
   * arithmetic sane and not enough to keep the fight sane — Weakened is authored
   * in flat points (4 through 8) against attack values that start at 5, so one
   * application could take an early hero to zero attack and every blow they
   * landed for three turns dealt `MIN_DAMAGE`.
   *
   * 0.6 leaves 40% standing. High enough that stacking shred is still the
   * strongest thing several enemies do, low enough that a shredded hero is
   * fighting badly rather than not fighting. Applied in
   * `getCombatEffectiveStats`, symmetrically — the player's Weakened is capped
   * on an orc by the same line.
   */
  MAX_SHRED_FRACTION: 0.6,

  /**
   * Defaults for the optional variance stats on `HeroStats`.
   *
   * Dodge is zero on purpose: combat stays deterministic until a node or a
   * piece of gear grants some, so the first point a player buys is visibly
   * what introduced misses.
   */
  BASE_CRIT_CHANCE: 5,
  BASE_CRIT_DAMAGE: 200,
  BASE_DODGE: 0,
  /** Nothing can become unhittable, however much dodge it stacks. */
  MAX_DODGE: 60,

  /**
   * Damage that jumps to one adjacent ally. Under half: Shock is a reason to
   * spread out, not a reason for the caster to ignore positioning.
   */
  SHOCK_CHAIN_FRACTION: 0.35,
  /**
   * Burn adds rather than refreshes, so it needs a ceiling or holding one
   * target wins by arithmetic. See `STACKING_MAGNITUDE`.
   */
  MAX_BURN_MAGNITUDE: 20,

  /**
   * Ceiling on the Templar's stacked weapon blessing.
   *
   * The other stacking status. It never expires, so an unbounded one makes the
   * correct opening to every long fight "spend four turns not fighting". Four
   * casts of `righteous_fury` reach the cap.
   */
  MAX_BLESSED_WEAPON: 75,
  FURY_MAX_STACKS: 3,
  FURY_PER_STACK: 20,
  SACRED_RHYTHM_MAGIC: 0.4,
  SACRED_SEAL_DAMAGE: 0.35,
  SACRED_SEAL_HEAL: 0.25,
  GROUNDED_FOCUS: [0.1, 0.15, 0.2] as const,
  /** Stoneskin's Barrier, a share of Magic: doubled from 0.35 in the Stoneshaper remaster (2026-10). */
  STONESKIN_BARRIER: 0.7,
  RAMPART_HP_SHARE: 0.5,
  RAMPART_DEFENSE: 8,
  RAMPART_TURNS: 2,

  /**
   * How far the Templar's Martyr detonation reaches from its carrier.
   *
   * Small enough that placing the blessing is a decision — it wants whoever is
   * standing in the enemy line, and is a much worse spell on the caster. A
   * martyr is somebody else.
   */
  MARTYR_BLAST_RADIUS: 2,

  /** Fraction of max HP at or below which a target counts as `lowHp`. */
  LOW_HP_THRESHOLD: 0.35,

  /**
   * Fraction of max HP a target must be *above* for `highHpDamageBonus`.
   *
   * Half, and it has to stay clear of `EXECUTE_THRESHOLD_MAX` (0.25): the two
   * bonuses are mutually exclusive by arithmetic rather than by a guard, so a
   * floor pushed down to meet the window would silently let one target pay both
   * — an opener bonus and a finisher bonus on the same swing.
   */
  HIGH_HP_THRESHOLD: 0.5,

  /**
   * The execution window: `BASE + attack × PER_ATTACK`, capped at `MAX`.
   *
   * Narrow, because inside it Executioner is a guaranteed kill and Frenzy —
   * same tree — refunds the action, so a point of threshold is potentially a
   * whole turn. Opens at 17% at 20 attack; 55 attack reaches the ceiling.
   */
  EXECUTE_THRESHOLD_BASE: 0.12,
  EXECUTE_THRESHOLD_PER_ATTACK: 0.0024,
  EXECUTE_THRESHOLD_MAX: 0.25,

  /**
   * The window shrinks against tougher prey.
   *
   * A percentage of a boss's health bar is an enormous number. Divisors rather
   * than separate figures, so the relationship survives a retune of the base
   * window — and read off the template's tier, so a boss added later cannot
   * inherit the trash-mob one.
   */
  EXECUTE_TIER_DIVISOR: { normal: 1, elite: 2, boss: 5 } as const,

  /**
   * Rapid Fire: how many arrows, and what the burst is worth in total.
   *
   * The count is the point, not the total — five rolls is five chances to crit
   * (which joins this to the Marksman's crit nodes) and five kill checks, so a
   * burst across a wounded line stops at each corpse. The 1.5 is tuned against
   * the shot it replaces, not against the arrow count.
   */
  RAPID_FIRE_STRIKES: 5,
  RAPID_FIRE_TOTAL: 1.275,

  /**
   * A dual-wielder's Basic Attack: one strike per hand, each worth this much of
   * a full one.
   *
   * Half each, so the pair costs exactly what one swing of the same weapon
   * would before armour — the advantage is deliberately somewhere else. Each
   * hand rolls its own dodge and crit and fires every on-hit effect and its own
   * drain, and there is no once-per-action cap on those. Subtractive armour
   * takes its cut twice, which is the price: against heavy plate two half-blows
   * are worth less than one whole one, against a Bleed stack or a coated blade
   * they are worth more. Tune it with the Berserker and Shadowblade trees in
   * view, not by suppressing procs.
   */
  DUAL_WIELD_STRIKE_SCALE: 0.5,

  /**
   * Berserker remaster (2026-10). Blood Rush: Bloodthirst's dash in hexes at node
   * rank 1 / 2 / 3, authored per rung rather than scaled (a hex cannot be 0.75 of
   * one); the skill's reach is the dash plus the one hex it strikes across.
   * Undying: the regular turns on which the Berserker can act that its HP floor
   * lasts through, and the comeback surge (Attack as a share of base Attack, at
   * least `UNDYING_SURGE_MIN` points, and the same share as lifesteal) — the old
   * Last Breath figures, scaled by rung.
   */
  BLOOD_RUSH_DASH: [1, 2, 3],
  UNDYING_RESPONSE_TURNS: 2,
  UNDYING_SURGE: 0.25,
  UNDYING_SURGE_MIN: 3,

  /**
   * Flurry: light blades chase every strike — two behind a single-target strike,
   * one behind an area strike (`statusEffects.flurryFollowupsFor`). Three behind
   * every strike was too strong (playtest 2026-10-21, PT-40): an area skill
   * multiplies its follow-ups by every enemy it reaches.
   */
  FLURRY_FOLLOWUPS_SINGLE: 2,
  FLURRY_FOLLOWUPS_AREA: 1,
  FLURRY_SCALE: 0.25,

  /**
   * Bladestorm's movement, as a flat addition to `moveRange`.
   *
   * Large enough to cross the arena from any hex (`inArena` bounds it at
   * |q| ≤ 3, |r| ≤ 5). A bonus rather than an override, so occupancy still
   * decides where it can stand.
   */
  BLADESTORM_MOVE: 99,

  /** How far from the carrier the blades reach: everything within this many hexes is cut. */
  BLADESTORM_RADIUS: 2,

  /**
   * The Skirmisher's Embedded Blades (2026-10 remaster). `BLADES_CAP` is the most
   * one Skirmisher can have in one enemy (Buried Steel raises its owner's); `BLADE_EXTRACT_PER_BLADE` is what Blade
   * Recall pays per blade it pulls, as a multiple of Attack, in one undodgeable
   * hit per enemy (five blades: 2.25x Attack, a capstone's worth, after several
   * turns of setting up). Blades have no clock and deal nothing until pulled.
   */
  BLADES_CAP: 5,
  BLADE_EXTRACT_PER_BLADE: 0.45,
  /** Barbed Blades: extra damage per blade already in the target, and the ceiling. */
  BARBED_PER_BLADE: 0.15,
  BARBED_MAX: 0.75,
  /** Knife Dance: dash/throw beats per cast, and the later dashes' maximum reach. */
  KNIFE_DANCE_STRIKES: 3,
  KNIFE_DANCE_HOP: 2,
  /** Slipstream: the free step after a damaging cast, in hexes, per rung (a hex more each rung, like Mark and Move). */
  SLIPSTREAM_STEP: [1, 2, 3] as const,
  /** Sharpened Steel: armour-penetration points on the first hit at a full-health enemy (middle rung). */
  SHARPENED_STEEL_PEN: 20,
  /** Smoke Bomb: the caster's Dodge floor while standing in its own cloud, in percent. */
  SMOKE_DODGE: 50,

  /**
   * The Shadowblade remaster (2026-10). Shadow Echo: the mana a return to the
   * echo costs, and how long the echo stands, in the caster's own turns: `2`
   * covers the turn it was left and the next regular turn (it ticks at the
   * caster's turn start, like every aura).
   *
   * The price is flat since playtest 2026-10-21, when a cheaper return proved a
   * wasted point; the rungs add to the return instead: from
   * `SHADOW_ECHO_STEALTH_RANK` it grants Stealth, and from `SHADOW_ECHO_CRIT_RANK`
   * the first attack out of that Stealth is a certain critical hit.
   */
  SHADOW_ECHO_COST: 6,
  SHADOW_ECHO_TURNS: 2,
  SHADOW_ECHO_STEALTH_RANK: 2,
  SHADOW_ECHO_CRIT_RANK: 3,
  /** Venom Transfer: how far a dead enemy's dose can travel, in hexes. */
  VENOM_TRANSFER_RANGE: 3,
  /**
   * Assassinate's Death Mark: the extra direct damage the victim takes from every
   * attacker, and how many of the caster's regular turns the mark is checked on
   * before it fades. The execution window is the shared one at full width
   * (`executeThresholdHp`, scale 1), the Berserker's.
   */
  DEATH_MARK_BONUS: 0.1,
  DEATH_MARK_TURNS: 3,

  /**
   * Freeze: how long the ice holds, and what breaking it costs.
   *
   * `FREEZE_DURATION` is spelled `2` and read **pre-tick** in `turnStart`, the
   * same convention Stun follows — effects tick at the start of the victim's
   * turn and the tick decrements before it acts, so a `1` is retired on the way
   * in and the affliction never once costs a turn. That is the trap three
   * afflictions fell into before it was written down. "Two turns" is spelled 2.
   *
   * `SHATTER_BURST_HP` is a fraction of the **target's own** `combatMaxHp`, and
   * that form is the point: every source of damage shatters, including the ones
   * with no attacker to roll against — a Doom, Thorns, a summon's decay. An
   * attacker-derived burst would silently do nothing down half of them.
   */
  FREEZE_DURATION: 2,
  SHATTER_BURST_HP: 0.12,
  /**
   * Brittle, the boss's shatter: the burst its consuming blow adds, as a multiple of
   * the creating hero's effective Magic when the mark was made, and how many of the
   * boss's turns the mark stands. A share of the creator rather than of the boss's
   * pool, so a very large boss is not deleted by percentages.
   */
  BRITTLE_BURST_MAGIC: 0.8,
  BRITTLE_DURATION: 3,
  /**
   * How long a charge (Absolute Zero) is laid for. Ticking at the start of the owner's
   * regular turns, 2 means it is ready on the next one and gone at the one after.
   */
  CHARGE_DURATION: 2,

  /**
   * The Marksman remaster. Mark and Move's reposition after Mark Target, in hexes
   * by node rank. Escape Route: the farthest an enemy may stand and still set it
   * off, and how far the Marksman steps back (a one-rank side starter). Settle
   * In: points of armour penetration on the next ranged damaging cast after a
   * turn spent without moving (the level-2 value; rungs scale it). Aimed Shot's
   * release is scaled to this hex distance (`HeroSkill.distanceScale`).
   */
  MARK_AND_MOVE_RANGE: [1, 2, 3] as const,
  ESCAPE_ROUTE_REACH: 2,
  ESCAPE_ROUTE_RETREAT: 2,
  SETTLE_IN_PEN: 20,
  AIMED_SHOT_REFERENCE_DISTANCE: 4,

  /**
   * Poison, counted in **doses** rather than points — a dose is worth the
   * applier's attack, so a points ceiling would hand a strong hero fewer of
   * them. A dose landing on a full pile detonates (`POISON_BURST`) instead of
   * doing nothing, and spends the pile: the next dose starts from one. Symmetric: a spider doses a hero
   * by this same table. The rule lives in `combatStore.applyEffect`.
   */
  MAX_POISON_STACKS: 3,
  /** Ticks a dose is worth. Also the duration every application resets to. */
  POISON_TICKS: 3,
  /**
   * One dial on every poison dose in the game, applied in
   * `resolveEffectMagnitude`.
   *
   * Poison was cut ~10% on a playtest report that it was the strongest status on
   * both sides of the board. A factor rather than eight edits across `skillData`,
   * `mastery/hunter` and the enemy kits: those eight would have to be
   * re-derived by hand for the next retune with nothing to notice a missed one,
   * and — more importantly — a per-skill pass could not stay symmetric. This is
   * the one place a hero's dose and a spider's dose both come through, which is
   * the property `MAX_POISON_STACKS` is written against.
   *
   * Cut again to 80% of that (0.9 -> 0.72) on a playtest that put the Shadowblade's
   * poison far above every other single-target source against a boss. The dial is shared
   * on purpose, so a spider's dose is 80% of what it was too.
   *
   * `POISON_BURST` below takes the same cut separately, because it is a
   * *multiplier on attack* rolled through `damageCalc` rather than a magnitude
   * and never passes through here.
   */
  POISON_POWER: 0.72,
  /**
   * The overdose, as a multiple of the attacker's attack.
   *
   * Sized like a capstone strike rather than a rider: it costs three turns of
   * setup to reach, and the reason to keep striking a target that is already at
   * the cap has to beat simply walking to a fresh one.
   *
   * Cut from 2.4 by the same 10% as `POISON_POWER`, and by hand rather than by
   * that factor: this is a multiplier on the attacker's attack rolled through
   * `damageCalc`, not a status magnitude, so it never passes through
   * `resolveEffectMagnitude`. Kept in step deliberately — the two halves of
   * poison should be nerfed together or the burst quietly becomes the whole
   * mechanic.
   *
   * Cut to 1.4, and the pile now clears when it goes off, on a playtest where the
   * Shadowblade out-damaged the rest of the party four to one against a boss: with
   * the doses kept, Venomed Blades burst on both hits of every turn at the cap.
   */
  POISON_BURST: 1.4,

  /**
   * Turns the Shadowblade's Hemlock keeps its blades wet.
   *
   * Against a four-turn cooldown the window closes for a turn before it
   * reopens. Matching `MAX_POISON_STACKS` is deliberate, so "coat, strike,
   * strike, strike, burst" has a shape the player can see.
   */
  HEMLOCK_DURATION: 3,

  /**
   * Vanish: turns spent doing nothing, and actions bought with them.
   *
   * The payoff is three actions *at once*, not the spare one — it is the only
   * way to kill something that would otherwise act between your blows.
   */
  VANISH_WINDUP: 2,
  VANISH_CHARGES: 3,
  /**
   * How long the hiding lasts: the whole wind-up, gone as the Shadowblade acts again.
   *
   * It was `STEALTH_DURATION` (one turn), which hid the first round of a two-round
   * wind-up and left the second one open — so a single-target blow or a Stun from
   * anything that had seen it vanish landed on the one turn the skill cannot afford,
   * and the Vanish "sometimes worked". Area skills still catch it, which is the answer.
   */
  VANISH_STEALTH: 2,

  /**
   * Ceiling on armour penetration (the share of Physical Defense a physical hit
   * ignores), as a percentage.
   *
   * Short of 100 on purpose: at full penetration the defence stat stops
   * existing, and a tank path, half the item pool and several buffs are built
   * on it. The remaining fifth is what keeps armour meaningful at all.
   */
  MAX_ARMOUR_PEN: 80,
  /**
   * Ceiling on magic penetration (the share of Magic Defense a magic hit
   * ignores), as a percentage. Its own number so the two can be tuned apart;
   * equal to `MAX_ARMOUR_PEN` today for that constant's reason — a ward that
   * stops existing is a stat half the robes in the game are wasting.
   */
  MAX_MAGIC_PEN: 80,
  /**
   * Ceiling on the lifesteal a unit's sheet stat (gear, plus the passives that
   * write the stat, such as Undying's surge) returns, as a percentage of damage
   * dealt. A skill's own drain and a `Lifesteal` aura ride on top of it.
   *
   * Gear lifesteal is priced at one percent per budget point
   * (`itemGen.STAT_PER_POINT`), which makes a single legendary roll worth
   * 4–7% — and a loadout forged to Vampiric … of the Leech on every slot worth
   * about 70%. The cap is where that stacking stops: enough for a drain build to
   * be the build, not so much that a hero cannot be worn down.
   */
  MAX_LIFESTEAL: 40,

  /**
   * How long Stealth lasts, everywhere it is granted.
   *
   * One turn: hidden through the round after you vanish, gone by the time you
   * act again. Longer makes the Shadowblade's wind-up unanswerable.
   * Single-sourced because that path grants stealth from three skills.
   */
  STEALTH_DURATION: 1,
  /**
   * Ceiling on the turns a detonation may cash in: without one, an affliction
   * refreshed long enough turns the combo into "stall, then delete".
   */
  MAX_DETONATE_TURNS: 4,

  /**
   * Braced: defence gained per hit taken while taunting, and its ceiling.
   *
   * **The rank moves the ceiling, and the step is flat — which is the opposite
   * of what it used to do, because the step cannot carry a rank at all.**
   * `PassiveRank.scale` is 0.75 / 1 / 1.25 and defence is a whole number, so
   * `round(2 × 0.75)` is 2 and `round(2 × 1)` is 2: the first point a player
   * spent raising this node bought **literally nothing**, and the node said so
   * out loud the moment `figures` made it state a number.
   *
   * Ten has the resolution two lacks — 8 / 10 / 13 — so the ceiling is the only
   * figure in this passive a rung can move. That is also the honest reading of
   * what the node is worth: the steady state of a Bulwark who has been in a
   * fight for four rounds *is* the cap, so scaling it prices the rung at exactly
   * the 0.8 / 1.0 / 1.3 a rung is meant to cost, where changing how fast they
   * get there does not change where they end up.
   *
   * Only one of the two scales, deliberately. Moving both would compound — a
   * bigger step toward a higher cap is 1.56× the shipped node rather than the
   * 1.25× a rung is priced at, which is the trap the previous note was right
   * about even though it guarded the wrong number.
   *
   * `BRACED_MAX` stays the *authored level-2* value, so the neutral rung is
   * unchanged and the Obsidian Infantry — the one enemy that carries Braced —
   * fights exactly as it did.
   */
  BRACED_STEP: 2,
  BRACED_MAX: 10,
  /** Attack the Intimidating passive shreds off an enemy it taunts. */
  INTIMIDATING_SHRED: 3,
  /**
   * Shielded Challenge: the Barrier a landed Provoking Strike gives the Bulwark, as
   * a share of its Attack **per rung** (authored, not scaled: 20 / 30 / 40%), and
   * how many of the Bulwark's turns it lasts. A Barrier refreshes rather than
   * stacks, so repeated casts keep the larger shield and the longer clock.
   */
  SHIELDED_CHALLENGE_BARRIER: [0.2, 0.3, 0.4],
  SHIELDED_CHALLENGE_DURATION: 2,
  /**
   * Last Stand: the share of all incoming damage (hits, ticks, reflections) taken
   * off while the owner is at or below 30% health, **per rung**: 20 / 30 / 40%.
   * Enemies carrying the passive resolve at the middle rung.
   */
  LAST_STAND_REDUCTION: [0.2, 0.3, 0.4],
  /**
   * Vengeance: the chance, **per rung**, that a hit taken while taunting cuts one
   * turn off every cooldown. A whole turn cannot be fractioned, so the rung buys odds.
   */
  VENGEANCE_CHANCE: [0.25, 0.5, 0.75],
  /**
   * Reckoning's shockwave, released when its Barrier breaks or runs out: every enemy
   * within `RECKONING_RADIUS` of the Bulwark takes `RECKONING_BASE` × Attack plus
   * the damage the Barrier absorbed, the absorbed part capped at `RECKONING_CAP` ×
   * Attack. Fixed damage, read when it goes off: no crit, no defence, like the
   * Martyr's seal.
   */
  RECKONING_BASE: 1.0,
  RECKONING_CAP: 2.0,
  RECKONING_RADIUS: 2,

  /**
   * Oath: the Magic Defense a direct heal or cleanse leaves on the Templar and
   * the ally it reached, as a share of the **recipient's own** Magic Defense
   * (so it is worth the same fraction to a robed healer and a plated knight),
   * floored at `OATH_MIN_WARD` points so it is never a rounding error on a
   * low-defence ally. Level-2 values; the node rung scales the share.
   */
  OATH_WARD_SHARE: 0.3,
  OATH_MIN_WARD: 4,
  /**
   * How long it lasts, spelled as a duration. Two is "until the end of the
   * recipient's next turn": effects tick at the start of the wearer's turn, so
   * a one would be stripped before it was ever used.
   */
  OATH_WARD_DURATION: 2,

  /**
   * Zeal's Mercy and Wrath choice on Smite, per rung of the Zeal node
   * (index 0 is rung 1). Each is a multiplier on Smite's own authored numbers.
   *
   * Every rung improves **both** halves of Mercy (the strike is cut less and the
   * heal is bigger) and Wrath's strike, so a higher rung never makes a mode
   * worse; `skillModes.test.ts` pins that ordering. Wrath has no heal at all,
   * which is the whole price of its damage.
   */
  ZEAL_MERCY_STRIKE: [0.7, 0.75, 0.8],
  ZEAL_MERCY_HEAL: [1.8, 2.2, 2.6],
  ZEAL_WRATH_STRIKE: [1.2, 1.3, 1.4],

  /**
   * Second Wind's curve: the share of its top-end heal paid at full health
   * (`SECOND_WIND_FLOOR`) and the exponent that keeps it low until the target is
   * badly hurt (`SECOND_WIND_CURVE`). With the authored 2.8x top end this is
   * about 0.6x on an ally at 70% HP (under Lifebloom's 0.8x) and about 2.3x
   * on one at 10%.
   */
  SECOND_WIND_FLOOR: 0.15,
  SECOND_WIND_CURVE: 2,
  /**
   * Stone Ward's shell, a fraction of Magic (cut from 0.9 when it gained the
   * Stoneshaper's cleanse; the mana and cooldown rose with it).
   */
  STONE_WARD_BARRIER: 0.7,
  /** Warding Bloom's bark: the flat Barrier it raises, cut from 30 when it gained a cleanse. */
  WARDING_BLOOM_BARRIER: 15,

  /**
   * The Lifewarden remaster (2026-10), authored at the level-2 rung; a node's rung
   * scales each by 0.75 / 1 / 1.25.
   *
   * Shared Bloom: Lifebloom's direct heal sends this share of itself to the most
   * wounded ally within `SHARED_BLOOM_REACH` hexes of its recipient.
   */
  SHARED_BLOOM_SHARE: 0.5,
  SHARED_BLOOM_REACH: 2,
  /**
   * Second Spring: a direct heal on an ally below this share of their effective
   * maximum HP (read before the heal) cuts the damage they take by
   * `SECOND_SPRING_REDUCTION` percent, for `SECOND_SPRING_DURATION` of their
   * effect ticks (2 = through the next enemy interval and their own next turn).
   */
  SECOND_SPRING_THRESHOLD: 0.3,
  SECOND_SPRING_REDUCTION: 20,
  SECOND_SPRING_DURATION: 2,
  /**
   * Cycle of Life: Growth charges needed, and the extra magic damage the next
   * damaging spell deals to each enemy it strikes, as a multiple of Magic.
   */
  CYCLE_OF_LIFE_CHARGES: 3,
  CYCLE_OF_LIFE_MAGIC: 0.6,
  /**
   * Wild Sanctuary: how many of the caster's regular turns the area pulses at the
   * start of, after the pulse it lands with, and the Root its first exposure lays.
   */
  WILD_SANCTUARY_TURNS: 3,
  WILD_SANCTUARY_ROOT_TURNS: 2,
  /**
   * Canopy Guard: the Treant's Barrier on each ally in reach, as a share of that
   * ally's own effective maximum HP rather than of the Treant's Magic.
   */
  CANOPY_GUARD_MAX_HP: 0.15,

  /**
   * Stoneshaper remaster (2026-10). Authored per rung (levels 1 / 2 / 3) rather
   * than scaled, because the agreed figures are not 0.75 / 1 / 1.25 of the middle.
   *
   * Crumble: Physical and Magic Defense a Stun or Root the Stoneshaper lays strips
   * from the enemy for exactly as long as that control stands, once per owner.
   */
  CRUMBLE_SHRED: [5, 6, 7] as const,
  /** Aftershock: Tremor's footprint erupts again for this share of Magic as physical damage. */
  AFTERSHOCK_MAGIC: [0.2, 0.3, 0.4] as const,
  /** Rubble Recovery: the heal, as a share of the Stoneshaper's Magic, when an enemy breaks its Barrier. */
  RUBBLE_RECOVERY_MAGIC: [0.15, 0.25, 0.35] as const,
  /**
   * Savage Edge: the extra Bleed tick a critical hit on a Bleeding enemy lands, as a
   * share of that Bleed's own per-turn damage at the middle rung. Damage only: it
   * restores nothing and does not shorten the Bleed.
   */
  SAVAGE_EDGE_TICK: 1,
  /** Killing Eye: critical chance (percentage points) against a Bleeding enemy only. */
  KILLING_EYE_CRIT: 12,
  /**
   * Firemind: mana taken off Cinder Burst for every Burn stack it spends beyond the
   * first, and the share of the base cost the discount may never exceed. Cost
   * efficiency only: nothing here puts mana back.
   */
  FIREMIND_DISCOUNT_PER_STACK: 3,
  FIREMIND_MAX_DISCOUNT_SHARE: 0.5,
  /**
   * Spark: how far from the dying enemy a stack may land, by rung (index 0 is rung 1),
   * and the shortest the passed Burn lasts so a stack inherited on its last turn is
   * still worth having.
   */
  SPARK_RANGE: [1, 2, 3],
  SPARK_MIN_DURATION: 2,
  /**
   * Detonation: how many rounds the burning hex lasts, by rung. The ground ignites an
   * enemy beginning its turn on it with one Burn stack worth the stack that was
   * spent here, scaled by the rung.
   */
  DETONATION_GROUND_TURNS: [1, 2, 3],
  /** How long the Burn the ground lays lasts (turns of the afflicted unit). */
  DETONATION_BURN_DURATION: 3,
  /**
   * Hydromancer control-to-damage nodes, authored at the level-2 rung unless an
   * array says otherwise (indexed by rung, index 0 is rung 1).
   *
   * Shatterpoint: extra damage, as a share of the blow that breaks a Freeze, on top of
   * the ice's own `SHATTER_BURST_HP`. The price is the Freeze itself, which any hit
   * already ends: the node pays you to spend your control on your own hit.
   */
  SHATTERPOINT_BONUS: 0.6,
  /**
   * Twin Fangs: the second Frostbite fang, as a fraction of a full Frostbite strike, at
   * the level-2 rung (rungs scale it 0.75 / 1 / 1.25). The first fang is the whole
   * strike, so a rung-2 cast totals 1.5 strikes, and Chill still lands once.
   */
  TWIN_FANGS_SECOND_HIT: 0.5,
  /**
   * Fuel the Flame, the Pyromancer's Signature node: when Ignite hits an enemy that is
   * already burning, it lays one extra Burn stack worth this share of Ignite's own
   * Burn, at the level-2 rung (rungs scale it 0.75 / 1 / 1.25). It replaced Kindling's
   * +Magic / +mana, so it is tuned a little above half a stack to carry that weight.
   */
  FUEL_THE_FLAME_STACK: 0.6,
  /**
   * Meltwater: the flat Barrier laid on the most wounded ally when a Freeze lands, and
   * how long it stands. At most once a turn, so an area Freeze is one shield, not four.
   */
  MELTWATER_BARRIER: 14,
  MELTWATER_DURATION: 3,
  /**
   * Deep Cold: turns added to a Chill cast from further than `DEEP_COLD_MIN_RANGE`
   * hexes, by rung. Rung-indexed rather than scaled: a turn is a whole number, and
   * scaling 2 by 0.75 / 1 / 1.25 would round two rungs to the same figure.
   */
  DEEP_COLD_EXTRA_TURNS: [1, 2, 3],
  DEEP_COLD_MIN_RANGE: 1,
  /**
   * Killing Frost: the share of Magic Defense (percentage points of magic penetration)
   * a magic hit ignores against a Chilled enemy. A Frozen enemy no longer carries
   * Chill, so it is the choice against Shatterpoint rather than a stack on it.
   */
  KILLING_FROST_PEN: 35,
  /**
   * Overload: the extra damage (a fraction of the bolt) the next single-target lightning
   * bolt deals, at the level-2 rung (rungs scale it 0.75 / 1 / 1.25); how many of the
   * Stormcaller's own turns the charge is held; and how many already-Shocked enemies one
   * cast must strike to charge it.
   */
  OVERLOAD_BONUS: 0.5,
  OVERLOAD_DURATION: 4,
  OVERLOAD_MIN_SHOCKED: 2,
  /**
   * Conductive Arc, the Stormcaller's Signature node: the Shock jump an Arc sets off
   * carries this much more of the blow, at the level-2 rung (rungs scale it 0.75 / 1 /
   * 1.25) — 0.35 of the blow becomes 0.525. It replaced Quickened's +5 Speed, which was
   * not redistributed; the bonus is a little over a half to carry that weight.
   */
  CONDUCTIVE_ARC_BONUS: 0.5,
  /**
   * Skyfall's strikes: at most this many different living enemies, chosen at random
   * inside the aimed area. Fixed: rank does not move it.
   */
  SKYFALL_TARGETS: 3,
  /**
   * Skyfall's aim (playtest 2026-10-17, PT-18): a hex up to `SKYFALL_RANGE` away,
   * and the strikes pick among enemies within `SKYFALL_RADIUS` of it. A long reach,
   * not the whole arena; a radius-2 area is 19 hexes, about a crowd. Tuning
   * starting points; verify in playtest. Playtest 2026-10-23: 7 plus the radius
   * reached nearly every hex of the ±3 × ±5 board and read as unlimited, so 5 —
   * still the longest aim in the Arcanist kit.
   */
  SKYFALL_RANGE: 5,
  SKYFALL_RADIUS: 2,
  /**
   * The Thunder Elemental's Magic as a share of its owner's, at the ultimate's middle
   * rung, and what each rung moves it by: 0.3 / 0.5 / 0.7, stated exactly rather than
   * through the generic 0.75 / 1 / 1.25 rank scale.
   */
  THUNDER_ELEMENTAL_MAGIC: 0.45,
  THUNDER_ELEMENTAL_MAGIC_STEP: 0.18,
  /** How many of its owner's regular turns the Thunder Elemental stays for. */
  THUNDER_ELEMENTAL_TURNS: 3,
  /** Unyielding: Physical and Magic Defense each, while the Stoneshaper holds a Barrier. */
  UNYIELDING_DEFENSE: 5,
  /**
   * Seismic Sense: extra hexes of movement on a turn that starts under a warned
   * ground attack, per rung of the node (index 0 is rung 1). Whole hexes, so
   * the rungs are authored rather than scaled: 0.75 / 1 / 1.25 of two would
   * round to the same number twice.
   */
  SEISMIC_SENSE_MOVE: [1, 2, 3],

  /**
   * **Dead.** Kept only as a record of an approach that was replaced.
   *
   * Points-spent gates were how the tree used to enforce "at most one capstone",
   * and they were fragile in exactly the way a second source of truth always is:
   * a gate has to sit at or below the points that *exist* beneath it, and the
   * original 0/4/9/14 failed that twice over — tier 2 gated at 4 with 3 points
   * below it, and a capstone needing 17 of a 15-point budget. Nothing noticed
   * for a version, because a gate nobody can pass looks exactly like a gate.
   *
   * The **cost table** does the job now: tier 3 costs 5, one capstone chain is
   * 12 of 15, and the cheapest second is 20. That cannot drift out of step with
   * the tree because it *is* the tree, and `masteryData.test.ts` brute-forces
   * every legal build rather than trusting the arithmetic.
   *
   * No code reads this. Delete it the next time this file is touched for real.
   */
  MASTERY_TIER_GATES: [0, 3, 8, 12] as const,
  /** Total points a hero earns — one per level from 6 to the cap. */
  MASTERY_POINTS_AT_CAP: 15,
  /** The level at which a path is chosen, irreversibly. */
  MASTERY_UNLOCK_LEVEL: 5,
  /**
   * The hero level each advanced (tier-4) row opens at: row 1 at the first level
   * past the base cap, so only a hero an expansion has let climb can buy one, and
   * one row per level band after it. The hero's level opens a row, in any world.
   * The points of these levels still spend anywhere in the chosen tree.
   */
  MASTERY_ROW_LEVELS: [21, 26, 31, 36] as const,

  // Advanced (level 21–25): Druid
  /**
   * Turns the Barrier Overflowing Grace makes out of an overheal lasts. Effects
   * tick before their wearer acts, so 3 holds through two of the ally's turns.
   */
  OVERHEAL_BARRIER_TURNS: 3,
  // Advanced (level 26): Druid
  ADVANCED_DRUID: {
    /** Last Bloom: the last heal, as a share of the Regen's tick, at rank two (1.2 / 1.6 / 2). */
    LAST_BLOOM_SHARE: 1.6,
    /** Stone's Answer: physical damage as a share of Magic, at rank two (0.3 / 0.4 / 0.5). */
    STONES_ANSWER_MAGIC: 0.4,
    /** Stone's Answer: the Root's duration. "A turn" is spelled 2, as `graspingEarth` spells it. */
    STONES_ANSWER_ROOT_TURNS: 2,
    /** Second Nature: Attack and both defences a step adds, as a share of the worn shape's, at rank two (3 / 4 / 5%). */
    SECOND_NATURE_STEP: 0.04,
  },
  /** Second Nature: the most steps a shape can hold. Top-level as the text quotes it (`displayNumbers`). */
  SECOND_NATURE_MAX_STEPS: 3,

  /**
   * Enemy stats gain this fraction per party level above 1.
   *
   * Enemies carry no equipment, so they get none of the ~100 budget points a
   * level-20 hero is wearing. Without this the curve inverts and late fights
   * are easier than early ones. At the level cap it works out to roughly ×3.9.
   *
   * Raised from 0.12 after a playtest at level 10 still found ordinary fights
   * weak: equipment is only part of what a hero gains — fifteen mastery points,
   * a signature skill and a set bonus are the rest, and none of it was being
   * priced in. This is the term that keeps pace with all of it, which is why it
   * moved rather than the band gradient: the complaint was about the party
   * outgrowing the world, not about the world's shape.
   */
  ENEMY_LEVEL_SCALE: 0.15,
  /**
   * The Basic Attack an enemy falls back on when its kit offers nothing it may use
   * (`enemyBasicAttack.fallbackBasicAttack`, playtest 2026-10-23): this much of its
   * Attack or Magic, under every authored skill so it is never the first choice,
   * and this reach when every single-target blow in its kit reaches at least that
   * far. Tuning starting points; verify in playtest.
   */
  ENEMY_BASIC_ATTACK_DAMAGE: 0.6,
  ENEMY_BASIC_ATTACK_RANGED_REACH: 3,

  /** Rounded enemy readout range across the first campaign; combat stats keep their own curve. */
  ENEMY_DISPLAY_LEVEL_RANGE: [1, 25] as const,
  /**
   * How much of a creature's own strength (`templateStrength`) the readout
   * weighs in: the exponent on it. A square root since the playtest of
   * 2026-10-14 — a whole factor pinned every late elite at the cap.
   */
  ENEMY_LEVEL_TEMPLATE_WEIGHT: 0.5,

  /**
   * Fraction of an item's forge material cost returned when it is salvaged.
   *
   * Well under half on purpose: crafting a thing and breaking it down again has
   * to be a loss, or it becomes a material duplication loop.
   */
  SALVAGE_RATE: 0.25,

  // Loot rarity weights (%)
  RARITY_WEIGHTS: {
    common: 60,
    rare: 15,
    epic: 3,
    legendary: 0, // legendary items only from bosses or crafting
  },

  // Map
  /**
   * Hex radius around the party within which world-map props are rendered.
   *
   * Props are individual meshes and are the map's real cost — the hex grid is
   * instanced and does not care how large the world is. Generous enough that
   * nothing pops in on screen.
   */
  PROP_RENDER_RADIUS: 14,
  /** Peak-to-peak per-tile brightness variation on the terrain. Subtle by design. */
  TILE_COLOR_JITTER: 0.12,
  /**
   * How far, in world units, a two-finger drag may carry the camera off the
   * party. Looking around is worth having; losing the party off the edge of the
   * world with no obvious way back is not — and a manual pan is deliberately
   * kept through party movement, so nothing else would ever undo it.
   */
  CAMERA_MAX_PAN: 14,
  /**
   * Fraction of the hexes around the arena carrying scenery.
   *
   * Cosmetic only — every one of them is outside `inArena`, so nothing here can
   * be stood on or targeted. The ring runs seven hexes deep now rather than
   * three, and the near half of it is cut by `heightScale` before anything is
   * placed, so the extra reach buys density behind and beside the board — the
   * part of the frame that was reading as void — rather than clutter in front
   * of it.
   *
   * This is the *near* band's rate; `arenaScenery` thins it with depth, so the
   * rim is about a third of it. Raised from 0.6 with the terrain sets at eight
   * variants rather than four — density and variety have to move together, or
   * a fuller ring is simply the same tree more times, which reads as wallpaper
   * and is exactly what more of it makes worse.
   */
  ARENA_PROP_DENSITY: 0.85,
  MAP_WIDTH: 70,
  MAP_HEIGHT: 70,
  /**
   * The frozen north, as fractions of the map (`mapGenerator.inFrozenNorth`).
   *
   * A tile is frozen above a row threshold that starts at `FROST_WEST` across
   * the map and deepens eastward to `FROST_DEPTH` of its height at the east
   * edge, so the region is a wedge in the north-east: the far end of the map
   * from the city that is not the castle's corner. `FROST_WOBBLE` moves the
   * edge column by column by up to that share of the map's height where the
   * wedge is deepest, seeded per map, so it is a shore rather than a ruled line.
   * The city stands at mid-width on the middle row, which the threshold there
   * stays well short of; the measured shares are in `docs/world.md`.
   */
  FROST_WEST: 0.32,
  FROST_DEPTH: 0.4,
  FROST_WOBBLE: 0.05,
  /** The lowest threat band a frozen tile may sit in: the north is late ground. */
  FROST_MIN_BAND: 2,
  /**
   * POI counts scale with map area rather than being fixed.
   *
   * Absolute counts leave a larger world proportionally emptier, and resource
   * nodes have to stay findable — the tribute depends on them.
   */
  POI_PER_1000_TILES: {
    // 3.0 put ~15 nodes on a 70×70 map — with weekly regrowth and the tribute
    // charging every seventh day, a playtest simply could not find ore. ~25 now.
    resource: 5.0,
    /**
     * 0.9 put **four** wells on a 70×70 map, and four is the same as none.
     *
     * A well is the attrition release valve on a long expedition — the thing
     * that makes an expensive walk into deep country survivable without going
     * home — and the whole design of the weekly recharge rests on the party
     * *routing through* one. Four across 4,900 tiles is one per 1,225, so a
     * party effectively never found one and the valve was decorative: the only
     * recovery anybody actually used was walking back to the city, which is the
     * decision the wells exist to be an alternative to.
     *
     * 1.8 is nine, i.e. one per ~545 tiles. **Measured, not assumed**: the
     * placement loop only *skips* a candidate that is too close to a well
     * already placed, so it can silently under-deliver against the target and
     * nothing would say so. Nine of nine on twelve seeds at the shipped
     * `MAGIC_WELL_MIN_SPREAD` — see the note there for why that number did not
     * have to move.
     */
    magicWell: 1.8,
    boss: 1.2,
  },
  FOG_REVEAL_RADIUS: 3,

  // ── The road network, and the ground either side of it ──────────────────────
  /**
   * How far the artery wanders off the straight castle→city line, in hexes.
   *
   * A road drawn as a lerp is a ruler line across a noise field and reads as one
   * — the single most artificial thing on the map. The artery is walked as a
   * chain of jittered waypoints instead, so it bends around nothing in
   * particular the way a real track does.
   */
  ROAD_WANDER: 5,
  /** Hexes between waypoints on the artery. Shorter is twistier. */
  ROAD_SEGMENT: 7,
  /**
   * Branches forking off the artery. One generation, and twelve of them.
   *
   * The count is the difference between a structure the player navigates by and
   * a line they cross: at one artery and five branches the map came out **88%
   * haunted**, with the safe ground too sparse to be a route at all. Sized
   * against the zone shares rather than chosen — twelve puts roughly a third of
   * the map inside the network's reach, which leaves haunted ground the clear
   * majority while giving the corridor enough presence to be somewhere you
   * travel rather than a hairline.
   *
   * **`ROAD_SUBBRANCHES` is gone rather than zeroed**, and the reason belongs
   * here as much as at the loop it deleted. It existed because a single
   * generation of legs that dead-end is a spine with bristles: nothing forked,
   * so the only junction on the map was where a branch met its own parent. A
   * branch now terminates on the first road it meets, and the eleven others
   * rooted along the artery are roads it can meet — so a T-junction is what
   * *finishing* looks like and the second pass had nothing left to add.
   *
   * That change made each leg much longer, so the twelve had to be re-measured
   * rather than assumed: **12 + 8 second-generation legs under the new rule came
   * out 0.53–0.64 haunted**, under the 0.6 floor `zones.test.ts` holds the
   * generator to on two of fourteen seeds — each road tile drags two to three
   * hexes of corridor along either side, and that is what eats a map. Twelve
   * alone measures **0.63–0.79** over the same fourteen, against 0.72–0.80
   * before: the same country, reached by longer roads rather than by more of
   * them. Halving the count instead was tried and is worse in a way the zone
   * share does not show — six legs leave the ground around the city noticeably
   * less threaded, and the gap between band 0 and the far bands that
   * `threat.test.ts` measures collapsed from 0.25–0.72 to **0.08** on one seed.
   *
   * The even spread of the roots along the artery is what makes twelve behave —
   * see `carveRoadNetwork`. Clumped roots are the 16%-to-71% home-ring swing.
   */
  ROAD_BRANCHES: 12,
  /**
   * The shortest a branch may be, in hexes.
   *
   * A fork is cast on a bearing and terminates on the first road it meets — so
   * without a floor it would terminate on its own parent, one hex along, and the
   * network would grow lay-bys instead of branches. There is no matching maximum
   * any more: a leg that meets nothing runs to the map edge, because the one
   * thing it may not do is stop in open ground.
   */
  ROAD_BRANCH_MIN: 8,
  /**
   * Hours to walk one road tile, against 1 off-road.
   *
   * Safety alone is not a trade — a player who wants XP would ignore the road
   * entirely, and it would be scenery with a rule attached. Half time is what
   * makes it a decision: fast, safe and unprofitable against slow, dangerous and
   * where everything is. Fractional on purpose; the clock is a number and
   * `dayAt` is a `Math.floor` over it.
   */
  ROAD_HOURS: 0.5,
  /**
   * How far the quiet ground either side of a road reaches, in hexes.
   *
   * The window, not a constant: the boundary is noisy between these two so the
   * corridor pinches and widens instead of tracing a fixed offset. A fixed
   * radius reads as a buffer drawn around a line, which is what it would be.
   */
  CORRIDOR_MIN: 2,
  CORRIDOR_MAX: 3,
  /**
   * Fraction of a zone's tiles that carry an encounter at all.
   *
   * The whole structural point, as two numbers. The corridor is *quiet, not
   * silent* — meeting something every few journeys is what stops the safe route
   * being a loading screen. Haunted ground is somewhere an expedition is mounted
   * into rather than somewhere crossed on the way past.
   *
   * `DAILY_ENCOUNTER_CHANCE` then decides how many of those are live today, and
   * applies to both equally — one lever for "how dense is the content", another
   * for "how much of it is up right now".
   *
   * **Haunted came down from 0.60, and the report was that you simply cannot
   * move.** The arithmetic is unambiguous once the two levers are multiplied
   * out, which is the thing neither of them says on its own: 0.60 content ×
   * 0.55 live is **33% of deep haunted tiles carrying a fight on any given day**,
   * and `planTravel` stops the party on the *first* one of those a route crosses.
   * A thirty-tile march into the far country is therefore about **ten fights**,
   * each of which ends the journey — so a long expedition was not dangerous, it
   * was unfinishable, and the far half of the map was ground the player bounced
   * off rather than ground they lost parties in.
   *
   * 0.42 × 0.55 is 23% live, i.e. a fight roughly every four tiles rather than
   * every three, and it is deliberately a *small* cut for a large-sounding
   * complaint: the density was never the whole fault. What actually makes a
   * journey complete is `ENCOUNTER_QUIET_RADIUS` — see `travel.ts` — which
   * clears the ground around a fight the party has just won, so the interruptions
   * stop being consecutive. Thinning the world enough to fix this on its own
   * would have emptied it.
   *
   * The corridor went **up**, 0.10 → 0.12, and that is not a rounding artefact.
   * The gap between the zones is the reason to leave the road, and cutting
   * haunted alone narrows it; 0.12 holds the ratio near 1:3.5 while returning a
   * little of the supply the haunted cut takes out of the home ring, which is
   * mostly corridor by construction. `encounterSupply.test.ts` is what stops the
   * next turn of either knob starving the opening hours.
   */
  ZONE_ENCOUNTER_RATE: { road: 0, corridor: 0.12, haunted: 0.42 } as const,

  // Time — 1 tile walked = 1 in-game hour
  HOURS_PER_DAY: 24,
  DAYS_PER_WEEK: 7,
  /** Fraction of maxHp each hero recovers when a new day dawns. */
  DAWN_HEAL_FRACTION: 0.15,

  // Daily encounter pre-roll for danger tiles
  /**
   * Probability that a danger tile has an active encounter, re-rolled at the
   * start of each **day**.
   *
   * A *supply* number, and it compounds with everything else that has to go
   * right for a fight to happen: danger tile, roll lands, party crosses it, and
   * the faction that turns up is the one being hunted. Encounters are the only
   * source of XP and loot, so a thin day is a day the party does not grow while
   * the tribute clock runs.
   *
   * **This was cut to 0.30 when the roll went daily, and that was wrong.** The
   * reasoning was that every tile of a route is checked now rather than only the
   * one the party finishes on (see `systems/world/travel.ts`), so the rate had
   * to come down to compensate — sized against the map-wide danger density of
   * ~16%, which makes a ten-tile walk cross about two danger tiles.
   *
   * Both halves of that were wrong where it matters. The home ring is **6.5%**
   * danger, not 16%, so a ten-tile walk there crosses two thirds of one; and a
   * player does not cross danger tiles incidentally, they *aim* at them, because
   * scorched ground is visible from across the map. So interception adds very
   * little in the opening hours and the cut was nearly pure loss: the miss rate
   * on walking to a scorched tile went from 45% to **70%**, and a playtest spent
   * a long time failing to find five wolves.
   *
   * At 0.55 the home ring's fourteen danger tiles offer ~7.7 fights a day, which
   * is about what a day of walking (24 tiles) can actually consume — supply and
   * travel time roughly in balance, which is the property worth keeping. This is
   * still the dial; `__tests__/world/encounterSupply.test.ts` is what stops the
   * next turn of it starving the opening hours again.
   */
  DAILY_ENCOUNTER_CHANCE: 0.55,

  /**
   * How far the quiet spreads around a fight the party has just won, in hexes.
   *
   * A warband that has been wiped leaves a gap, and for the rest of the day
   * nothing else has moved into it. `quietAfterVictory` in `systems/world/travel.ts`
   * spends every live encounter inside this radius along with the one that was
   * actually fought.
   *
   * **This exists because the complaint was that a journey never completes, not
   * that the map is too dense.** Those want opposite fixes. Thinning the world
   * answers the second and makes the first only slightly less bad while
   * emptying the ground everywhere the player was *not* complaining about — the
   * failure `encounterSupply.test.ts` is named after. A quiet radius answers the
   * first exactly: it does nothing at all to how much content the map holds, and
   * everything to whether three of it can catch you inside five hexes. What it
   * costs is that clearing the road ahead is now a real reason to pick a fight,
   * which is a decision the overworld did not previously offer.
   *
   * Two, because one is the tile itself plus its neighbours and reads as no rule
   * at all — the party takes a step and is stopped again — while three is a
   * 37-hex hole, which on a corridor route is most of a day's walking cleared by
   * one win. Two clears 19 hexes: enough that the next interruption is a
   * decision to have carried on rather than the same ambush again.
   */
  ENCOUNTER_QUIET_RADIUS: 2,

  /**
   * What summed party level each threat band is *for*, indexed by `ThreatBand`.
   *
   * Not a gate and not a scaling term — the third factor in the daily encounter
   * roll reads it, and nothing else does. A party at or under the number its
   * ground expects sees the map exactly as it always was; a party well over it
   * meets less of it, because the things living out there have learned better.
   *
   * The numbers are the summed level a party is *plausibly* carrying when that
   * band is the frontier: one hero around 6 in Home Reach, a pair by Borderland,
   * three by Contested, and a full four heroes deep into Legion Ground. They are
   * therefore deliberately generous — the factor is meant to fire when a party
   * has genuinely outgrown ground, not when it is merely comfortable on it.
   */
  BAND_EXPECTED_LEVEL: [6, 14, 26, 40, 55] as const,
  /**
   * How far the daily encounter roll may taper for an overlevelled party.
   *
   * Never zero, and that is the whole rule. Home Reach with no encounters at all
   * is a region of the map that has silently stopped being a game — a player
   * walking back through it to reach the city would find the ground they learned
   * on inert, which reads as a bug rather than as a promotion. A quarter of the
   * usual supply is thin enough to stop being a tax on crossing old ground and
   * thick enough that the ground is still alive.
   */
  ENCOUNTER_TIMIDITY_FLOOR: 0.25,

  // ── Threat bands ────────────────────────────────────────────────────────────
  // Distance from the city is difficulty. The band is what decides how many
  // enemies a random encounter fields, how hard they hit and what it pays.
  /**
   * Upper bound (inclusive) of each band, measured from the city.
   *
   * Band 0 is the home ring: a fresh party can learn the game and reach a few
   * resource nodes without being eaten. **Absolute hex distances**, calibrated
   * against a 70×70 map — re-derive them if `MAP_WIDTH` changes.
   */
  THREAT_CITY_RADII: [11, 21, 30, 39] as const,
  /** A lair door must be an expedition; placement also bounds the route by its band. */
  LAIR_DOOR_MIN_DISTANCE: 8,
  /**
   * Distances from the Obsidian castle that force a *minimum* band, worst first.
   *
   * Measured on the shipped map these never bind: each `CITY[i] + CASTLE[3 - i]`
   * is short of the 47 hexes between city and castle, so no tile's band
   * changes and the far corner is band 4 by distance from the city alone. Kept
   * as they are on purpose (the private project notes); later
   * worlds use binding far radii.
   */
  THREAT_CASTLE_RADII: [6, 12, 19, 28] as const,
  /**
   * Jadeveil Range (see `data/worlds.ts`). Smaller than the Empire, and its two
   * poles **bind**: every `HOME[i] + FAR[3 - i]` exceeds the camp-to-summit
   * separation, so the bands tilt toward the summit rather than ringing the
   * camp. Measured, not guessed — `docs/world.md` has the shares.
   */
  // 39×35 since the playtest of 2026-10-23 put the camp in the south-west corner,
  // with no ground behind it: the five columns and rows it stood in from went,
  // so the camp-to-summit distance (47) and every band radius are unchanged
  JADEVEIL_MAP_WIDTH: 39,
  JADEVEIL_MAP_HEIGHT: 35,
  JADEVEIL_HOME_RADII: [18, 25, 32, 39] as const,
  JADEVEIL_FAR_RADII: [12, 19, 26, 33] as const,
  JADEVEIL_ROAD_BRANCHES: 6,
  /** The home ring's haunted floor, scaled to the smaller map. */
  JADEVEIL_HOME_HAUNTED_MIN: 16,
  /**
   * Band 1 of the ground power table (`systems/world/bandPower.ts`), every expansion-world
   * fight's multiplier on top of its ground (playtest 2026-10-23): a world's bands restart at 0
   * by its camp, so on the Empire's ramp a party of summed level 75-80 in epic and legendary
   * gear met level 7-9 readouts and a few hundred health. ×3 puts the first band's front line
   * above the castle garrison (a Kappa ~830 HP against an Obsidian Infantry's ~600 at level 20)
   * and its elites in the thousands. A lair boss's own fight and Kairen keep their own tuning,
   * and take only the step from band 1. A first estimate: verify in playtest.
   */
  BAND_GROUND_POWER: 3,
  /**
   * The share of a party's gear that is legendary when a band starts, for the derivation of the
   * later bands' ground power (`bandPower.ts`): the rest is epic at the band floor, and this is
   * legendary from the previous band's top. Tuned so the scripted party deals bosses the same share
   * of their health at each band (the private project notes). Verify in playtest.
   */
  BAND_GEAR_LEGENDARY_SHARE: 0.31,
  /**
   * What the simulator's tuning puts on each band's derived step, band 1 first: the tactical party
   * won Kairen's story fight more often at bands 3 and 4 than the share alone evens out, 21% against 8%
   * at band 4 (the private project notes). Verify in playtest.
   */
  BAND_POWER_TRIM: [1, 1, 1.06, 1.12] as const,
  /**
   * What each level band's fights and quests pay, band 1 first, so a band takes as many fights to
   * climb as band 1: the XP to climb its five levels over band 1's (7,035, 9,960, 13,385, 17,310).
   * On gold too. `contentLevel.test.ts` pins these to the XP curve.
   */
  BAND_REWARD_SCALE: [1, 1.42, 1.9, 2.46] as const,
  /**
   * How a template's strength nudges the level an expansion-world enemy reads: this many levels per
   * doubling over the ordinary enemy, at most `ENEMY_CONTENT_LEVEL_NUDGE_MAX` either way. Readout only.
   */
  ENEMY_CONTENT_LEVEL_NUDGE: 1,
  ENEMY_CONTENT_LEVEL_NUDGE_MAX: 2,
  /**
   * Bodies in a wandering Jadeveil fight, by band. The party arrives with four
   * heroes, so the Empire's 2-5 (`threatEncounterSize`) read as a handful of
   * targets. Extra bodies repeat the shape's last non-elite role. The fight's
   * stats are scaled by `threatEncounterSize / this`, so bodies times strength,
   * and with it the fight's power, stays what it was.
   */
  JADEVEIL_ENCOUNTER_SIZE: [4, 4, 5, 5, 6] as const,
  /** Shrines on the pilgrim road, one per band above the foothills. */
  JADEVEIL_SHRINES: 4,
  /**
   * A shrine's keepers (playtest 2026-10-28, which found the first three keepers far too easy):
   * how many stand, one of each kind their faction fields (`composeShrineKeepers`), and the
   * multiplier on their stats over the ground's own. A first estimate: verify in playtest.
   */
  SHRINE_KEEPERS: 6,
  SHRINE_KEEPER_POWER: 1.25,
  /** Hexes kept between two shrines, so the chain reads as a climb. */
  SHRINE_MIN_SPREAD: 6,
  /** How far to either side of the camp-to-summit line the shrines alternate, in hexes. */
  SHRINE_SWITCHBACK: 5,
  /**
   * The range's altitude (`rangeTerrain.ts`): the share of it that is slope
   * from camp to summit, the share that is ridged spurs, and fine detail. Then
   * the altitude cuts: tarn below, bamboo above, terraced shoulder, rock.
   */
  RANGE_SLOPE: 0.36,
  RANGE_RIDGE: 0.5,
  RANGE_DETAIL: 0.14,
  RANGE_RIDGE_SCALE: 7,
  RANGE_ALTITUDES: [0.34, 0.47, 0.6, 0.72] as const,
  /**
   * No tarn within this many hexes of the camp. In the map's corner since the
   * playtest of 2026-10-23 it stands at the range's lowest, wettest ground, and
   * tarns there walled it into a pocket of a dozen hexes on one seed in 25.
   */
  RANGE_CAMP_DRY_RADIUS: 6,
  /**
   * The archipelago (`data/worlds.ts`, `systems/world/isleTerrain.ts`): six
   * islands in a sea, from the camp's at the west edge to Varr's at the east.
   * Its bands follow the islands rather than radii, one band to an island and
   * the middle band twice: the Sunken Hull's (2) on the third and fourth, the
   * Flooded Grotto's (3) on the fifth. A first layout, to judge on the map.
   */
  ARCHIPELAGO_MAP_WIDTH: 56,
  ARCHIPELAGO_MAP_HEIGHT: 30,
  ISLE_BANDS: [0, 1, 2, 2, 3, 4] as const,
  /**
   * Each island's radius in hexes before its coast's noise: the camp's, the
   * middle four's range (the seed picks inside it) and Varr's.
   */
  ISLE_RADIUS: { home: 3.6, middle: [3.8, 4.7], far: 4.6 } as const,
  /**
   * Where the four middle islands stand along the line from the camp's island to
   * Varr's (a share of it), and how far to either side of it they alternate, in
   * hexes: a zigzag, so each channel runs across the chain rather than along it.
   */
  ISLE_STATIONS: [0.22, 0.41, 0.59, 0.78] as const,
  ISLE_ZIGZAG: 5.5,
  /** How far inside its island's coast (before the noise) each anchor stands, in hexes. */
  ISLE_ANCHOR_INSET: 0.8,
  /** How much of a radius the coast's noise pushes in or out, either way. */
  ISLE_COAST: 0.3,
  /** Land of two islands is never within this many hexes: a channel of sea between them. */
  ISLE_CHANNEL: 2,
  /** Interior ground (not on the coast) at or above this rock field is rock: a few hexes an island. */
  ISLE_ROCK: 0.7,
  /** Coast at or above this jungle field runs its trees down to the water instead of a beach. */
  ISLE_JUNGLE_SHORE: 0.78,
  /**
   * Hours the walk between worlds takes, each way. A journey, not a door: the
   * clock is shared, so the world left behind rotates its market and recharges
   * its wells while the party is away.
   */
  WORLD_CROSSING_HOURS: 12,
  /** The Empire's world gate keeps at least this far from the castle (`placeWorldGate`). */
  WORLD_GATE_MIN_CASTLE_DISTANCE: 12,
  /**
   * Villages (`placeVillages`, `data/villages.ts`). A village stands this many
   * hexes off the nearest road (a detour that costs time), at least this far
   * from another village, and at its theme's share of the way from home to the
   * castle: the two held by brigands near home, the two held by the Legion
   * further out. Placement starting points; verify in playtest.
   */
  VILLAGE_ROAD_OFFSET: { min: 1, max: 2 } as const,
  VILLAGE_ROUTE_SHARE: { near: [0.2, 0.32], far: [0.5, 0.66] } as const,
  VILLAGE_MIN_SPACING: 6,
  /** Hexes of lean toward the ideal spot that count as one step; the seed picks within a step. */
  VILLAGE_LEAN_STEP: 4,
  /**
   * The garrison that holds a village (`systems/world/villageGarrison.ts`).
   * Brigands fight at the village's own threat band held to 0-2, the Legion at
   * the village's own band held to 2-4, so it scales with distance from home.
   * The brigands' camps are `extraBodies` wider than a warband of their band;
   * the Legion's are not, because a band of bonus and a body more both measured
   * far too hard (see the playtest note in the villages plan). Starting points;
   * verify in playtest.
   */
  VILLAGE_GARRISON: {
    brigands: { minBand: 0, maxBand: 2, bandBonus: 0, extraBodies: 1 },
    obsidian_legion: { minBand: 2, maxBand: 4, bandBonus: 0, extraBodies: 0 },
  } as const,
  /** Gold paid on freeing a village, by its occupier. Verify in playtest. */
  VILLAGE_LIBERATION_GOLD: { brigands: 150, obsidian_legion: 400 } as const,
  /** Hours a village's current buff is granted free on liberation: one week. Verify in playtest. */
  VILLAGE_LIBERATION_BUFF_HOURS: 168,
  /**
   * Village buffs (`systems/economy/villageBuffs.ts`): a bought buff runs this
   * many hours from purchase (seven full days), one at a time. Verify in playtest.
   */
  VILLAGE_BUFF_HOURS: 168,
  /**
   * What each buff does. Armor and power are percentages of the hero's own stat;
   * the Barrier is a share of max HP at the start of every fight; crit is points
   * of crit chance; the discount and the gold bonus are shares. First guesses:
   * verify in playtest.
   */
  VILLAGE_BUFF_EFFECT: {
    armorPct: 15,
    powerPct: 12,
    barrierShare: 0.1,
    critPoints: 8,
    discount: 0.25,
    goldBonus: 0.25,
  } as const,
  /**
   * What each buff costs, in materials; the strongest cost crystal. Gold is for
   * shops and merchants. Verify in playtest.
   */
  VILLAGE_BUFF_PRICE: {
    smithy_armor: { iron: 8, stone: 6 },
    smithy_power: { iron: 10, crystal: 2 },
    shrine_barrier: { stone: 8, crystal: 1 },
    shrine_crit: { stone: 6, crystal: 2 },
    lookout_escape: { wood: 8, stone: 4 },
    lookout_sight: { wood: 6, iron: 4 },
    trading_discount: { iron: 6, wood: 6, crystal: 1 },
    trading_gold: { iron: 8, stone: 4, crystal: 1 },
  } as const,
  /**
   * Village shops (`systems/economy/villageShop.ts`): how many pieces a village's
   * rack holds a week, and what the Lookout's consumables and the Trading
   * post's material swaps cost. Verify in playtest.
   */
  VILLAGE_SHOP_SLOTS: { smithy: 4, shrine: 4, trading_post: 3 } as const,
  /**
   * The Lookout's two buffs. Escape: the chance to flee a warband is `base` times
   * the party's summed level over what the warband's band expects
   * (`BAND_EXPECTED_LEVEL`, the measure `encounterTimidity` uses), kept between
   * `min` and `max`. Danger sight: encounters glow red within `radius` hexes of
   * the party. Verify in playtest.
   */
  VILLAGE_ESCAPE: { base: 0.6, min: 0.2, max: 0.9 } as const,
  VILLAGE_DANGER_SIGHT_RADIUS: 4,
  /**
   * Travelling merchants (`systems/world/merchants.ts`, `systems/economy/merchantStock.ts`):
   * 1-2 are dealt at each new week and each walks a road one hex every `hoursPerStep`
   * hours, leaving after `stayHours`. At a fork a hex that brings the merchant nearer a
   * village or home weighs `1 + leanWeight` against 1. A merchant buys loot at `buyRate`
   * of its sell price (the city Shop pays all of it), racks `slots` pieces, and the
   * provisioner's ward costs `wardShare` of the city's and its ration bundle holds
   * `bundleRations` at `bundleShare` of the rations' price. First guesses: verify in playtest.
   */
  MERCHANT: {
    countMin: 1, countMax: 2, hoursPerStep: 6, stayHours: 96, leanWeight: 2,
    buyRate: 0.5, slots: 3, wardShare: 0.8, bundleRations: 3, bundleShare: 0.8,
  } as const,
  VILLAGE_MAP_SCROLL_GOLD: 60,
  VILLAGE_MAP_SCROLL_RADIUS: 8,
  /** A swap hands over `give` of one material for `get` of another. */
  VILLAGE_SWAP: { give: 3, get: 2, count: 2 } as const,
  /**
   * Jadeveil's wrath (`systems/world/wrath.ts`), on a 0–100 bar. What a
   * deliberate Jadeveil quest and a lair clear add; what an hour on the shared
   * clock takes away; the permanent floors it ratchets to; the extra enemy
   * strength at a full bar (a little under one threat band's step); and how
   * long the full bar holds the summit open before it begins to fall. Tuned on
   * real routes by `wrathRoutes.ts` — see `docs/world.md`.
   */
  WRATH_GAIN: { quest: 15, lair: 22 } as const,
  WRATH_DECAY_PER_HOUR: 0.15,
  WRATH_FLOORS: [25, 50, 75] as const,
  WRATH_POWER_AT_FULL: 0.25,
  WRATH_WINDOW_HOURS: 48,
  /**
   * Changing a monastery vow already taken: a day of prayer on the clock
   * (`monastery.ts`). Time, not gold, so it is the same price at every ring.
   */
  MONASTERY_REVOW_HOURS: 24,
  THREAT_COLORS: ['#6a9a6a', '#a8a86a', '#d09a4a', '#cc5a3a', '#cc3344'] as const,
  /**
   * Enemy stat multiplier added per band, on top of party-level scaling.
   *
   * The ceiling on `THREAT_EARLY_FLOOR`: band 1 is `1 + slope` against band 0's
   * `1 + floor`, so a floor at or above the slope inverts the gradient at its
   * first step. Hardening the home ring means lifting both.
   */
  THREAT_POWER_PER_BAND: 0.28,
  /**
   * Per-band multiplier on the *flat* term of `threatPowerScale`, indexed by
   * `ThreatBand`.
   *
   * A playtest with several party compositions found the same wall every time:
   * bands 0–1 fell smoothly and Contested one-shot the party — and quest fights
   * compose at `QUEST_BAND` (2), so the story hit the identical wall. The slope
   * cannot fix that without moving bands 0–1, and the templates cannot without
   * sixty edits that would also reach band 1 through the factions that span the
   * seam. So the base number is tuned per band, ~20% down from band 2 out, and
   * **everything else is deliberately untouched**: depth ramps, the haunted
   * premium and party-level scaling all multiply over this, so every ratio the
   * seam suite pins survives except the 1→2 seam itself — which shrinking is
   * the entire point.
   */
  THREAT_BAND_BASE_SCALE: [1, 1, 0.8, 0.8, 0.8] as const,
  /**
   * Flat multiplier added in bands 0 and 1, where the per-band slope is ~nothing.
   *
   * The opening fights are the ones a new player forms an opinion from, and at
   * plain template strength two chaff enemies lost to a level-1 hero without
   * ever threatening it.
   *
   * **Band 0 only, which is what makes it raisable.** Band 0 is the one band
   * with no slope term, so a floor is the whole answer there; band 1 steps up
   * through its composition (`['front', 'chaff']`) instead. Applied at band 1
   * as well it would stack with the slope and outgun band 2 — `threat.test.ts`
   * catches that. `threatRewardScale` applies the same floor, so the ground
   * still pays for what it costs.
   */
  THREAT_EARLY_FLOOR: 0.24,
  /**
   * How much a band's flat value is lifted by the far edge of a band that
   * fields **no elite**.
   *
   * Bands 0 and 1 are too weak everywhere, so today's number is their *floor*
   * and depth only adds: `×1.00` where the band starts, `×1.40` where it ends.
   * The shallow end stays exactly as gentle as it has always been — which is
   * what a level-1 party walking out of the gate meets — and the deep end
   * reaches toward the band beyond it instead of handing the whole step over to
   * the boundary.
   */
  THREAT_DEPTH_LIFT: 0.4,
  /**
   * How far either side of the flat value a band that **does** field an elite
   * swings across its own width.
   *
   * Bands 2–4 take today's number as their *midpoint*: `×0.75` at the inner
   * edge, `×1.25` at the outer. The discount is the point — the elite and the
   * extra body arrive as an integer step that no multiplier can smooth, so the
   * first Contested tiles a party touches have to be discounted to pay for it.
   * The premium at the far edge is what keeps the band's average where it was.
   *
   * Which bands get which shape is **derived** — `threatEliteCount(band) === 0`
   * — not written down twice. If the first elite ever moves, the discount moves
   * with it, because the discount exists to pay for the elite.
   */
  THREAT_DEPTH_SWING: 0.25,
  /**
   * What haunted ground multiplies power **and** pay by, inside whatever band it
   * sits in.
   *
   * The third and smallest of the three levers the map has, and the order is the
   * design: **band (×1.53–2.64) > depth (×1.40–1.67) > zone (×1.25)**. Each is a
   * real decision and none swamps the one above it — a player who wants a harder
   * fight can walk a band, walk deeper into the one they are in, or step off the
   * road, in descending order of what it is worth. Raise this past a band's own
   * depth ramp and the five bands stop being the progression the recruitment
   * gates, the tribute and the level curve are all hung off; drop it toward 1 and
   * the zone is decoration and the restructure buys nothing.
   *
   * The ceiling is measured rather than asserted, in `threatDepth.test.ts`, and
   * it comes out at exactly the smallest band ramp: **×1.40**. Two constraints
   * that looked independent — "walking a band's width beats stepping off the
   * road" and "a hex that crosses a seam *and* changes zone must stay under the
   * cliff the depth work removed" — turn out to be the same constraint written
   * two ways, because the composition and the flat multiplier cancel out of the
   * second. 1.25 sits at 89% of the ceiling. Retuning this means re-running that
   * suite, not eyeballing this comment.
   *
   * It multiplies and nothing else. `threatEncounterSize` and `threatEliteCount`
   * are integers and an integer cannot ramp — see the long note on both in
   * `threat.ts`.
   */
  THREAT_HAUNTED_PREMIUM: 1.25,
  /** Reward multiplier per band. Steeper than power — distance costs hours. */
  THREAT_REWARD_PER_BAND: 0.35,
  THREAT_BASE_ENEMIES: 2,
  /**
   * The late campaign (playtest 2026-10-14: winter ground, Legion ground and the
   * Glacier "should be much harder"; the party there has four strong heroes).
   * From this band, every fight fields one more body, and a fight that is not a
   * boss's own is multiplied by the band's premium on top of its ground — the
   * bosses keep their own tuning.
   */
  THREAT_LATE_FROM_BAND: 3,
  THREAT_LATE_EXTRA_ENEMIES: 1,
  THREAT_LATE_POWER: [1, 1, 1, 1.1, 1.2] as const,
  /**
   * Guaranteed haunted ground in the ring around the city, and how far out that
   * ring reaches.
   *
   * A floor rather than a roll, because this is the *first thing a new player
   * does* and the city is a road hub — its surroundings are corridor by
   * construction, and corridor is quiet. Without this the opening hour is a
   * walk down a safe road looking for the game.
   *
   * What it teaches is the shape of the whole map, in the first ten minutes:
   * **the road is safe, the trees are not.** That lesson has to be available
   * immediately or the structure reads as scenery.
   *
   * 22, not 16, and the arithmetic is the reason: a haunted tile holds an
   * encounter `ZONE_ENCOUNTER_RATE.haunted` of the time and
   * `DAILY_ENCOUNTER_CHANCE` lights 55% of those, so at the 0.60 this was sized
   * against a haunted tile was worth **0.33** live fights on a given day.
   * Sixteen of them is 5.3, and a day is 24 tiles of walking — the back half of
   * the first day would be spent looking. Twenty-two is 7.3, about what a day of
   * walking round the home ring can consume.
   *
   * **The haunted rate has since come to 0.42, which takes those figures to 0.23
   * and 5.1, and this number did not move.** That is measurement rather than
   * neglect, and it was measured twice. The floor is a floor: the ring clears it
   * comfortably on its own, 31 to 107 haunted tiles across fourteen seeds. And
   * the ring is mostly *corridor* by construction — the city is the network's
   * hub — so its supply is dominated by the count of quiet tiles rather than by
   * the haunted floor, which is why raising the floor barely moves it: at 34 the
   * worst seed gained **0.6** live fights. The corridor rate going 0.10 → 0.12
   * is what actually paid for the haunted cut here.
   *
   * The whole ring, both zones counted, measures **16.3 to 30.5** live fights a
   * day against 17.8 to 40.1 on the same maps at the old rates, and 18.4 to 37.2
   * on the maps the old road rule produced. `encounterSupply.test.ts` asks for
   * six.
   */
  HOME_HAUNTED_MIN: 22,
  HOME_HAUNTED_RADIUS: 8,
  /**
   * Every tile off the road within this many hexes of the Obsidian castle is
   * haunted, whatever the corridor around its road says (playtest 2026-10-23:
   * the Emperor's doorstep should never be quiet ground).
   */
  CASTLE_HAUNTED_RADIUS: 3,
  /** Kept corridor, so stepping out of the gate is never an ambush. */
  HOME_HAUNTED_INNER: 4,
  /** Per-side spawn capacity is 11 across two rows — see generateSpawnPositions. */
  THREAT_MAX_ENEMIES: 6,

  /**
   * What one ally gaining a buff is worth to the enemy AI.
   *
   * Scored against expected damage, which runs 10–30 a swing: worth more than
   * a hit on one target, less than a kill. A Sentinel with two neighbours opens
   * with its dome and then fights.
   */
  AI_SUPPORT_VALUE_PER_ALLY: 12,
  /**
   * How much a unit holding a ready formation buff (Rally) prefers a hex for each
   * other ally within the buff's radius of it, on `chooseMoveTarget`'s scale (one
   * point is one hex nearer its target). Enough to break ties toward the warband
   * and to stop beside it rather than past it; too little to hold it back from
   * the fight.
   */
  AI_FORMATION_PULL_PER_ALLY: 1,
  /**
   * A warband that fights as a formation (`EnemyTemplate.formation`, playtest PT-12).
   *
   * `AI_LINE_ENGAGED_REACH`: the line has engaged once any of its living members stands
   * this close to a foe; until then its `behind` members hold. `AI_BEHIND_LINE_GAP`: how
   * many hexes further from the nearest foe than the line's front a held unit must end a
   * move. `AI_LINE_CONTACT_REACH`: a `line` unit with no foe this close spends its turn
   * marching rather than on a formation buff that would run out before the fight arrives.
   */
  AI_LINE_ENGAGED_REACH: 2,
  AI_BEHIND_LINE_GAP: 1,
  AI_LINE_CONTACT_REACH: 4,
  /**
   * What a melee unit's move scoring adds to a hex beside any foe, on
   * `chooseMoveTarget`'s scale (one point is one hex nearer its target): enough to
   * take a foe it can strike over standing a hex short of a target its own side
   * has walled off, too little to pull it off a target it can reach.
   */
  AI_MELEE_CONTACT_BONUS: 1.5,
  /** What raising one objective is worth to the AI before crowding, on the same scale. */
  AI_OBJECTIVE_VALUE: 18,
  /** Added per full unit of protection (1 = soaks all damage) an objective declares. */
  AI_OBJECTIVE_PROTECTION_VALUE: 60,

  // ── The Obsidian tribute ────────────────────────────────────────────────────
  // Rent on the land the castle stands on, due every seventh day. Escalates on
  // the calendar rather than on party strength: the thing being punished is
  // slowness, so a player who dawdles falls behind and a player who pushes does
  // not get taxed for succeeding.
  /** First bill after grace. Playtest 2026-10-09: 100 → 90. */
  TRIBUTE_BASE: 90,
  /** Compounded per week. Opening growth, before the later phase. */
  TRIBUTE_GROWTH: 2,
  /**
   * Four opening bills double, then grow by this weekly. Playtest 2026-10-09:
   * 1.5 → 1.4, the snowball the later weeks felt most (week 10: 4,050 → 2,770).
   * Not lower: `economyProjection.test.ts`'s slow budget must still fall short
   * by week 10 (it does at week 10 by about 180 Gold; at 1.5 it was week 9).
   */
  TRIBUTE_EARLY_BILLS: 4,
  TRIBUTE_LATE_GROWTH: 1.4,
  /**
   * Weeks of grace before the first demand.
   *
   * The assessor has to reach you, and a level-1 party wiped out on day seven
   * has learned nothing except that the game is unfair.
   */
  TRIBUTE_GRACE_WEEKS: 2,
  /**
   * How much stronger the siege army gets per week.
   *
   * Applied on top of the usual party-level scaling, so missing rent in week 12
   * is a different proposition from missing it in week 3. Playtest 2026-10-09:
   * cut 12% with the base, from 0.06.
   */
  SIEGE_POWER_PER_WEEK: 0.053,
  /**
   * Flat strength every siege starts from. Playtest 2026-10-08: the first
   * sieges (week 3) were too easy to make refusing a real choice, so 1.00 went
   * to 1.25. Playtest 2026-10-09: that overshot; cut 12% to 1.10.
   */
  SIEGE_BASE_POWER: 1.1,
  /** Enemies in the siege army, and how many weeks it takes to add one. */
  SIEGE_BASE_ENEMIES: 4,
  SIEGE_WEEKS_PER_EXTRA_ENEMY: 5,
  /**
   * Per-side spawn capacity is 11 across two rows, so a late siege can be a
   * genuine army rather than the five the old single row allowed.
   */
  SIEGE_MAX_ENEMIES: 8,
  /**
   * Days a lost siege leaves the town looking sacked: its services charred,
   * holed and smouldering (`systems/economy/sacking.ts`). A look, not a
   * penalty — the levels the buildings lost are the penalty.
   */
  SACK_DAYS: 3,
  /**
   * A building the sack knocked down is rebuilt to the level it held for this
   * share of each step's price (rounded up); steps above that level cost in full
   * (`systems/economy/sacking.ts`, playtest 2026-10-21).
   */
  REBUILD_COST_FRACTION: 0.5,

  // ── The castle gauntlet ─────────────────────────────────────────────────────
  // Four fights back to back with no return to the map, then a repeatable ladder
  // on top of it. The castle stops being an ending and becomes the first dungeon.
  /**
   * Sum of hero levels below which entering raises a warning.
   *
   * A **sum**, not an average, so it reads correctly on a lopsided party: a
   * 10/5/1 trio totals 16 and is warned; four heroes at 14 walk straight in. A
   * warning that fires every time is a warning nobody reads.
   */
  CASTLE_RECOMMENDED_POWER: 55,
  /**
   * A won siege's own spoils, on top of its soldiers' drops (playtest
   * 2026-10-14): this many Rare-or-Epic pieces, each Epic at this chance; a
   * share of that week's refused bill in gold, never under the floor; and a
   * second roll of the ordinary resource haul.
   */
  SIEGE_SPOILS_ITEMS: 2,
  SIEGE_SPOILS_EPIC_CHANCE: 0.4,
  SIEGE_SPOILS_GOLD_SHARE: 0.25,
  SIEGE_SPOILS_GOLD_MIN: 60,
  /** Enemies per non-boss stage at tier 1 (5 since the playtest of 2026-10-14; it was 4). */
  CASTLE_BASE_ENEMIES: 5,
  /** Enemy stat multiplier added per Seal tier above the first (Aethelred's stage). */
  CASTLE_TIER_POWER: 0.2,
  /**
   * The garrison stages' own multiplier, tier 1, and what each tier above adds.
   * The playtest of 2026-10-14 found a level-20 party in epic and legendary gear
   * one-shotting the castle at ×1.0, below a week-3 siege (×1.21): the garrison is
   * now ×2.0 rising by 0.25 a tier, above any siege a campaign reaches before
   * week 18. Aethelred's own stage stays on `CASTLE_TIER_POWER`, his health and
   * attack having been raised in his template instead.
   */
  CASTLE_GARRISON_POWER: 1.5,
  CASTLE_GARRISON_TIER_POWER: 0.25,
  /**
   * Health of every castle enemy, garrison and Aethelred alike, against the sheet
   * its stage's multiplier made (playtest 2026-10-17: the 2026-10-14 buff left the
   * fights too long). HP only: attack, defence and the rest keep the full
   * multiplier, which the garrison and the Emperor share with their health.
   */
  CASTLE_HP_SCALE: 0.7,
  /**
   * Fraction of max HP and mana restored between stages.
   *
   * Partial on purpose, mana especially: the gauntlet is a resource problem,
   * and a full rest between fights makes it four unrelated battles.
   */
  CASTLE_STAGE_HEAL: 0.35,
  CASTLE_STAGE_MANA: 0.5,
  /**
   * Seal tiers, capped.
   *
   * Bounds the arena work: eight enemies is a layout problem, twenty a
   * rebuild. Deliberately the same number as `MAX_UPGRADE_LEVEL` — a +5
   * legendary is what clears tier 5, and the two ladders climb together. If
   * either moves, look at both.
   */
  MAX_SEAL_TIER: 5,
  /**
   * Cost of the bottom rung, craftable at the forge.
   *
   * Gold is in here for a reason: once the tribute stops, gold has nothing left
   * to do and becomes a number that only goes up. This gives it a permanent job
   * in the part of the game that has no other clock.
   */
  SEAL_COST: { gold: 800, iron: 30, crystal: 20 },

  // ── Market ──────────────────────────────────────────────────────────────────
  /**
   * How far a resource's price can swing from its base in a week, either way.
   * 0.35 means a crystal is worth between 26 and 54 gold depending on the week —
   * enough that holding one is a decision, not enough that it is the main way to
   * make money.
   */
  MARKET_SWING: 0.35,
  /**
   * Buy price as a multiple of sell price. Load-bearing: at or below 1.0 the
   * market becomes an infinite gold press, because you could buy and sell in the
   * same breath.
   */
  MARKET_SPREADS: [1.55, 1.40, 1.25, 1.15],

  // ── Mastery set pieces ──────────────────────────────────────────────────────
  /**
   * What a set piece's rolled skill bonus is worth, as a percentage added to
   * that skill's damage and healing multipliers.
   *
   * Flat rather than rolled within a range, deliberately: the *interesting*
   * variable is which skill it landed on, and a magnitude roll on top would turn
   * every piece into two dice and make the reroll a slot machine rather than a
   * decision. Sized so a full seven-piece set concentrated on one skill is a
   * meaningful build and a single piece is a nudge.
   */
  SET_BONUS_PERCENT: 12,
  /**
   * What a level-3 forge charges to reroll one.
   *
   * Crystals, because the Crystal loop is already the legendary economy and this
   * is a legendary problem — and because gold alone would make rerolling a
   * formality for anyone past the mid-game. Deliberately affordable enough to be
   * used more than once: the roll is build-relative, so a player who respecs
   * their spending has a whole set to re-aim.
   */
  SET_BONUS_REROLL_COST: { gold: 250, crystal: 3 },
  /**
   * How often a world collection piece's skill roll is aimed at one hero of the
   * party who can wear its weight (their path, or one of their class's), rather
   * than at any path of the weight — `PARTY_LOOT_BIAS`'s lean, a skill deep. The
   * rest land anywhere in the weight, which is what makes a Templar's Jade
   * Bastion helm with a Beetle skill on it a thing the forge exists to repair.
   */
  COLLECTION_BONUS_PARTY_BIAS: 0.7,
  /**
   * What one budget point of a crafted piece costs, the recipe `forgeCost`
   * prices every craft from. A point is `SLOT_BUDGET × RARITY_SCALE` at the
   * level the piece is made at, so a heavier sword costs more iron the way a
   * heavier sword is more sword. Named here rather than written into the
   * function because the level upgrade below prices from the same point.
   */
  FORGE_COST: { goldPerPoint: 8, materialPerPoint: 2, crystalPerPoint: 0.6, elementalCrystalPerPoint: 0.5 },
  /**
   * Raising an ordinary piece's item level at the forge.
   *
   * Priced as the budget the new level *adds*, at the craft's own rate times
   * `premium` — dearer per point than making the piece fresh, because what the
   * upgrade keeps (its affixes and its sockets) is exactly what a fresh craft
   * would have to roll for again. The floors stop a one-level step on a ring
   * rounding to a price nobody notices paying.
   */
  ITEM_LEVEL_UPGRADE: { premium: 2, minGold: 25, minMaterial: 2 },
  /**
   * Gold to reroll one affix on a piece anchored at its rarity's level; the
   * price follows the piece along the item-level curve like its sell price.
   * Gold only: an affix is the piece's name and its rider, and rerolling one is
   * a decision a player makes about a sword they already like.
   */
  AFFIX_REROLL_GOLD: { rare: 80, epic: 160 },

  // ── Item level ──────────────────────────────────────────────────────────────
  /**
   * The item level each rarity's catalogue numbers describe.
   *
   * A template's `modifiers` are the stats an instance of it has *at this
   * level*, so a level-anchored instance is byte-identical to the preview the
   * shop and the forge already show — and every acquisition that does not yet
   * name a level mints here, which is what keeps this feature from moving any
   * existing number until a source says what level its loot is. The anchors are
   * where each rarity is typically first met: commons are starter kit, epics are
   * sized against the back half of the campaign, legendaries against the cap.
   *
   * **Legendary is a literal 20 and not `MAX_LEVEL`**, on purpose. A legendary's
   * *level* follows the cap at mint; the level its numbers are *measured from*
   * must not, or raising the cap for a new map would quietly re-derive every
   * legendary already in a save as weaker than it was.
   */
  ITEM_LEVEL_ANCHOR: { common: 1, rare: 8, epic: 14, legendary: 20, mythic: 20 },
  /**
   * The curve's shape: an item at level `L` carries `(OFFSET + L) / (OFFSET +
   * anchor)` of its anchored stats. Linear in the level and never zero at level
   * 1, which a pure `L / anchor` would be for an epic found early. Eight puts a
   * common sword from level 1 to 20 at about three times its starter numbers,
   * against a hero whose own attack grows about five-fold over the same span,
   * so gear stays meaningful without becoming the sheet.
   */
  ITEM_LEVEL_OFFSET: 8,
  /**
   * A legendary's share gained per item level above its anchor — the steep
   * segment its Obsidian Crystal levels climb. The ordinary curve adds only
   * about 3.6% a level up there, which made five Crystals worth ×1.18; at 0.15
   * a +5 is ×1.75 of what dropped, exactly what the retired per-upgrade
   * multiplier paid, so a Crystal is still something worth breaking a
   * legendary for.
   */
  LEGENDARY_LEVEL_STEP: 0.15,
  /**
   * The item level loot is minted at where each threat band *begins*. A fight
   * deeper in the band ramps toward the next entry, and band 4 ramps toward the
   * castle's first tier — see `systems/economy/itemLevelSources`.
   *
   * Sized against a hero rather than a party: `BAND_EXPECTED_LEVEL` is a summed
   * level, and a full party of four at band 3's forty is four heroes at ten.
   * Loot sits a little *under* the heroes fighting for it on purpose, so a
   * piece found on the ground is an upgrade for the party that walked out to it
   * and not a reason to skip the shop.
   */
  BAND_ITEM_LEVEL: [2, 5, 8, 11, 14] as const,
  /**
   * Spirit Ink, Jadeveil's crafting material (`systems/economy/jadeveilRewards.ts`).
   * Paid only in the range and spent only on its gear at the forge, so it is the
   * one gate that keeps a level-3 forge from crafting the range's catalogue the day
   * the party arrives — with the learned patterns (`ascentStore.patterns`).
   *
   * A first pass, measured by the seeded audit (`jadeveilRewards.test.ts`): a
   * campaign through the range to Kairen's first kill — thirty fights, four
   * shrines, two lairs — earns some 80–100 Ink, against about 112 to forge all
   * four collections outright, so the forge finishes what the drops start and
   * cannot buy the whole catalogue; each Storm Seal tier above pays about one
   * more piece's worth (5 + tier).
   */
  SPIRIT_INK: {
    /** Each ordinary enemy's chance of a drop of Ink; an elite pays one, a boss two. */
    NORMAL_CHANCE: 0.2,
    ELITE: 1,
    BOSS: 2,
    /** A won shrine fight, on top of its enemies. */
    SHRINE: 3,
    /** Kairen at tier t: BASE + PER_TIER × t, on top of his own BOSS. */
    SUMMIT_BASE: 3,
    SUMMIT_PER_TIER: 1,
    /** A lair's two chests. */
    LAIR_CHEST: { legendary: 4, epics: 2 } as Record<'legendary' | 'epics', number>,
    /** Salvaging a piece of the range's own gear hands back Ink by its rarity. */
    SALVAGE: { rare: 1, epic: 2, legendary: 5 },
    /**
     * What a craft of the range's gear costs, per budget point by rarity (the
     * point `forgeCost` prices from): a collection chest about 9, a Spiritsealed
     * cuirass 3, a Votive one 1.
     */
    FORGE_PER_POINT: { rare: 0.12, epic: 0.2, legendary: 0.35 },
  },
  /**
   * How far either side of the ground's level one drop may roll. Two swords
   * from one fight at one level are one sword; one apart is two.
   */
  DROP_ITEM_LEVEL_SPREAD: 1,

  // ── Legendary upgrade levels ────────────────────────────────────────────────
  /**
   * How many item levels past `MAX_LEVEL` a legendary can be raised, one
   * Obsidian Crystal each. A legendary always drops at the cap; its "+5" is five
   * levels over it on the ordinary item-level curve, not a separate multiplier.
   */
  MAX_UPGRADE_LEVEL: 5,
  /** Items in a dungeon chest, and each one's independent Legendary roll. */
  CHEST_ITEMS: { min: 3, max: 5 },
  CHEST_LEGENDARY_CHANCE: 0.2,
  /**
   * How often a chest legendary is a set piece for a path the party actually
   * walks. The rest are deliberately off-path: those are the best salvage fodder
   * in the game, and the Crystal loop needs a supply.
   */
  CHEST_ON_PATH_BIAS: 0.7,
  /**
   * What worn set pieces are worth (`systems/progression/setBonuses.ts`): the
   * three-piece bonus a mastery set or a world collection gives, and the
   * five-piece number a mastery set adds on its path's signature. Fractions are
   * of the stat or the modifier; `HEAL` and `CRIT` are points of the stat, and
   * the two skill powers are percent of the skill. First estimates: verify in
   * playtest.
   */
  SET_BONUSES: {
    THREE: { hp: 0.10, damage: 0.08, spell: 0.08, heal: 10, crit: 8, armour: 0.10 },
    FIVE: {
      barrier: 0.20, smite: 20, bleed: 0.25, burn: 0.25, brittle: 0.25, chain: 1,
      lifebloom: 0.25, form: 0.15, marked: 0.25, bladeRecall: 25, poison: 25,
      carapace: 1, glowmote: 25, reap: 0.25,
    },
  },
  /**
   * What a boss kill pays, first kill or hundredth (`rollBossLoot`): one
   * guaranteed Legendary, `SECOND_LEGENDARY_CHANCE` of a second (never a third),
   * and `OTHER_ITEMS` Epics and Rares, each Epic with `EPIC_SHARE`. The boss's
   * own item (`EnemyTemplate.lootTable`) rides inside the Legendary count at
   * `ONLY_ITEM_CHANCE`: it replaces a random Legendary, so the cap holds.
   * Verify in playtest.
   */
  BOSS_LOOT: {
    SECOND_LEGENDARY_CHANCE: 0.35,
    OTHER_ITEMS: { min: 2, max: 4 },
    EPIC_SHARE: 0.4,
    ONLY_ITEM_CHANCE: 0.25,
  },
  /**
   * A boss mythic (`systems/economy/mythicDrops.ts`), tuned by the seeded audit in
   * `mythicDrops.test.ts`: the chance per kill is `BASE_CHANCE`, plus `PER_BAND` per band of the
   * loot above the first and `PER_TIER` per boss tier above the first. `COUNTER_CAP` is the
   * bad-luck counter: that many eligible kills without one forces it. The table and why each
   * number is what it is are in `quests-progression-items.md`, *Mythic items*.
   */
  MYTHIC: {
    BASE_CHANCE: 0.063,
    PER_BAND: 0.016,
    PER_TIER: 0.04725,
    COUNTER_CAP: 15,
  },
  /**
   * In a world with legendaries of its own (Jadeveil's collections and its two
   * weapons), the share of legendary rolls narrowed to them. The rest still draw
   * from the whole catalogue, so the Empire's sets keep dropping in the range;
   * without it the range's sixteen collection pieces would be a seventh of a
   * pool of a hundred and the world's own chase would barely show.
   */
  WORLD_LEGENDARY_SHARE: 0.5,
  /**
   * How often an ordinary random equipment roll is drawn from what somebody in
   * the party can wear. The rest are unrestricted on purpose — off-class gear is
   * what the shop buys and the forge breaks down, and a table that only ever
   * paid out wearable pieces would starve both. Applied inside the slot and
   * rarity already rolled, so it moves *which* piece and never how rare or where
   * it goes. See `rollRandomItem`.
   */
  PARTY_LOOT_BIAS: 0.7,
  /** Capacity probabilities for zero, one and two sockets at mint. */
  GEM_SOCKET_WEIGHTS: {
    common: [1, 0, 0], rare: [0.75, 0.25, 0],
    epic: [0.5, 0.35, 0.15], legendary: [0.3, 0.5, 0.2], mythic: [0.3, 0.5, 0.2],
  },
  /**
   * Fixed bonuses, applied after all item-level and Crystal scaling. Jade's is a
   * percentage of maximum HP (`maxHpPercent`) since the playtest of 2026-10-14:
   * a flat 8 or 20 was a rounding error on a level-20 sheet. 2% and 5%, the
   * same budget as Ruby's points (`STAT_PER_POINT.maxHpPercent` is 1): about the
   * old flat value at level 10 and nearly double it at level 20.
   */
  GEM_BONUS: {
    cut: { ruby: 2, sapphire: 2, jade: 2, amber: 1 },
    brilliant: { ruby: 5, sapphire: 5, jade: 5, amber: 3 },
    /**
     * Jadeveil's tier, by grade from 1: the grade is the level band Jadeveil took
     * (`gems.ts`). Grade 1 is one point over the two Brilliants it is merged from
     * (10 / 6), and each grade above is one point over two of the grade below, the
     * least that keeps a merge up from ever losing stats. Starting values — verify
     * in playtest.
     */
    spirit: [
      { ruby: 11, sapphire: 11, jade: 11, amber: 7 },
      { ruby: 23, sapphire: 23, jade: 23, amber: 15 },
      { ruby: 47, sapphire: 47, jade: 47, amber: 31 },
      { ruby: 95, sapphire: 95, jade: 95, amber: 63 },
    ],
  },
  GEM_REWARD_CHANCE: 0.18,
  GEM_CHEST_REWARD_CHANCE: 0.6,
  GEM_CHEST_BRILLIANT_CHANCE: 0.2,
  /**
   * An expansion's own tier dropping in its own world, and nowhere else
   * (`gemRewards.ts`): of the gems a fight there pays, `fight` are that tier;
   * of a boss chest's or a summit's, `chest` are, Brilliant keeps its
   * `GEM_CHEST_BRILLIANT_CHANCE` and Cut takes the rest. Jadeveil's is Spirit. Starting values (2026-10-22) —
   * verify in playtest.
   */
  GEM_WORLD_TIER_CHANCE: {
    jadeveil: { fight: 0.05, chest: 0.15 },
  },
  GEM_SHOP_PRICE: 90,
  /** Merging two cut gems into a brilliant. */
  GEM_CUT_GOLD: 120,
  /**
   * Merging into an expansion's tier, by grade from 1 (the band its world took),
   * offered once that world has a band. Grade 1 is twice the Cut merge, as its
   * inputs are worth about twice as much, and each grade doubles for the same
   * reason. Starting values — verify in playtest.
   */
  GEM_WORLD_TIER_GOLD: [240, 480, 960, 1920] as const,
  /** How many gems of one kind and tier the Forge merges into one of the next tier. */
  GEM_CUT_INPUT: 2,
  /**
   * Taking a set gem back out, at the Forge only. Setting one is free and done
   * from the bag anywhere (designer, 2026-10-18), so the gold is in undoing it.
   */
  GEM_RECOVER_GOLD: 55,
  /** Chance a salvaged legendary yields an Obsidian Crystal, plus its upgrade bonus. */
  CRYSTAL_SALVAGE_CHANCE: 0.15,
  CRYSTAL_CHANCE_PER_UPGRADE: 0.1,

  // Magic wells
  /**
   * The floor under `POI_PER_1000_TILES.magicWell`, for a map too small for the
   * density to produce anything. There is no matching ceiling: the one that used
   * to sit here was read by nothing at all, and a second answer to "how many
   * wells" that nothing consults is a number the next person retunes believing
   * it does something.
   */
  MAGIC_WELL_COUNT_MIN: 2,
  /** HP fraction applied when reviving a dead hero at a magic well. */
  MAGIC_WELL_REVIVE_FRACTION: 0.20,
  /** HP fraction added to a living hero's current HP at a magic well. */
  MAGIC_WELL_HEAL_FRACTION: 0.50,
  /**
   * Minimum hex distance between any two magic wells.
   *
   * What stops nine wells being one oasis. It is also a **silent cap on the
   * count**, because the placement loop skips a candidate that violates it
   * rather than searching harder — so doubling the density without measuring
   * could have delivered anything from four to nine and looked identical from
   * the outside. It delivers nine of nine on twelve seeds, so 10 stayed: the
   * haunted majority of a 70×70 map has room for nine points ten hexes apart
   * several times over. Raise the density again and this is the first thing to
   * re-measure, not the last.
   */
  MAGIC_WELL_MIN_SPREAD: 10,

  // City
  /**
   * Four, and the openings agree with it.
   *
   * This was 5 while `recruitCapacity` (1 + one per `unlocksHero` quest, of
   * which there are three) topped out at 4 — so the fifth slot could be earned
   * from a lair and never filled, and the Grand Quest's own summary promised
   * "five slots at your back" to a party that could not assemble one. Two
   * counters for "how many heroes may I have" is one too many; this is the one
   * that is allowed to be the smaller.
   */
  MAX_PARTY_SIZE: 4,
  /**
   * Heroes the party may hold before any lair is beaten.
   *
   * Two, not one: the game opens solo, and the first quest hands over a second
   * hero long before the first lair is reachable. The remaining three slots are
   * bought one per lair — see `systems/lairs.ts`.
   */
  PARTY_SLOTS_BASE: 2,
  /**
   * The level a hero joins at, indexed by how many the party already holds.
   *
   * The openings are paced so the fourth hero arrives late, onto ground scaled
   * to the party they are joining — at level 1 that is not a weak hero, it is a
   * body one-shot by everything on the map. Floors rather than matches, so
   * joining at 10 next to a party of 14 still means catching up. The last entry
   * repeats past the end, so raising `MAX_PARTY_SIZE` needs nothing here.
   */
  RECRUIT_LEVELS: [1, 3, 5, 10] as const,
  /**
   * Fraction added to every XP grant per Library level.
   *
   * Declared here for a long time and read by nothing — the Library's own
   * description promised "a passive XP bonus to all heroes" while the building
   * was actually a pay-per-click Study button. `partyStore.gainXp` is the one
   * place XP is granted, so it is the one place this is applied.
   */
  LIBRARY_XP_BONUS_PER_LEVEL: 0.1,

  /**
   * What a template's authored `goldReward` is actually worth on a win.
   *
   * One knob rather than sixty template edits, and it exists because the *rate*
   * of fights changed underneath the templates rather than the templates being
   * individually wrong. A journey checks every tile it crosses now, and haunted
   * ground carries an encounter six times in ten — so a playtest party fights
   * several times a day where the gold numbers were authored against a party
   * fighting once or twice. The Empire's weekly tribute stopped being a bill and
   * became a rounding error, which quietly deletes the pressure the whole
   * mid-game is hung on.
   *
   * Applied once, in `victoryRewards`, on the same line the fight's own
   * `rewardScaleFor` multiplier lands — so it composes with band, depth, zone,
   * siege and castle scaling instead of arguing with any of them.
   *
   * **XP is deliberately untouched.** The complaint is about purchasing power
   * against a fixed rent, not about the level curve, and cutting both would just
   * be playing the same game slower.
   */
  ENEMY_GOLD_SCALE: 0.6,

  // Defeat
  //
  // There is deliberately no `DEFEAT_HP_FRACTION` any more. A wipe used to heal
  // the party by half a bar, so a hero who fell at 0 woke at 50% and the first
  // thing a player did after losing their bag and their gold was pay the tavern.
  // Defeat is paid for in *what you were carrying*, which is a cost the player
  // can see and plan against; a half-empty party is a fourth penalty nothing
  // announced. `applyDefeat` (`encounterResolution`) calls `partyStore.restAll` now.
  /** Gold lost on defeat = partySize × summedPartyLevel × this factor. */
  DEFEAT_GOLD_PER_LEVEL: 2,

  /**
   * Exploration finds: the weekly windfalls that replaced fixed resource nodes.
   *
   * A node was a fixed place the player learned once and farmed every week. A
   * find is dealt fresh each week from the map seed and the week number, and
   * whatever was not collected by the next dawn is gone — so the map is worth
   * walking, and there is no route to memorise.
   *
   * Counts are stated against `POI_PER_1000_TILES.resource`, the old node
   * density, so "three times as many" stays true if that is ever retuned.
   */
  EXPLORATION_FINDS: {
    DENSITY_MULT: 0.75,
    /** Resource caches dealt per old node. */
    RESOURCE_CACHES_PER_NODE: 3,
    /** Gold purses dealt per old node, on top of the resource caches. */
    GOLD_PURSES_PER_NODE: 1,
    /** Guarded chests per 1,000 tiles — a few on a 70×70 map. */
    CHESTS_PER_1000_TILES: 0.8,
    /** Finds keep this far from the city, like every other destination. */
    MIN_CITY_DISTANCE: 4,
    /** Guarantee one haunted cache within an early expedition's reach when ground allows. */
    STARTER_FIND_RADIUS: 14,
    /**
     * Resource caches pay a fraction of what a node did — there are three times
     * as many, and they are lying on ground the party is crossing anyway.
     */
    RESOURCE_AMOUNTS: {
      wood: { min: 2, max: 4 },
      stone: { min: 2, max: 3 },
      iron: { min: 1, max: 3 },
      crystal: { min: 1, max: 2 },
    },
    /**
     * A purse before `threatRewardScale`. Measured against a fight's gold
     * (`findsTuning.test.ts`): about half of one at the home ring, where gold is
     * scarce, and pocket change deeper out, where fights field elites and the
     * chests are the find worth the walk.
     */
    GOLD_AMOUNT: { min: 3, max: 6 },
    /** A chest's gold before `threatRewardScale`: a fraction of its guards' fight at depth, several fights at home. */
    CHEST_GOLD_AMOUNT: { min: 30, max: 50 },
    /** A chest's two resource entries, as a multiple of a cache's amounts. */
    CHEST_RESOURCE_MULT: 3,
    /**
     * Guards fight one band above the ground the chest lies on (capped at the
     * highest band), at this multiple of that band's power. Both are on top of
     * what the party meets there: the guards are meant to be stronger than the
     * average party that reaches this ground expects to face.
     */
    CHEST_GUARD_BAND_BUMP: 1,
    /**
     * Playtest 2026-10-08: 1.2 felt a little too strong; cut by 10% to 1.08.
     * Playtest 2026-10-09: still a little too strong; cut another 10%. Under 1
     * now, so a guard can hit no harder than the ground's own fighters (band 1
     * ground scales ×1.60, its band-2 guards ×1.51); the band above's bigger
     * shapes and the two waves keep the whole fight over 1.2× a wandering one
     * on the same ground (`finds.test.ts`).
     */
    CHEST_GUARD_POWER_MULT: 0.97,
    /**
     * Entries a native faction gets in a chest's guard pool against one for an
     * outsider (`chestGuardCandidates`). A warband's is 3; a chest's is gentler
     * so no single native holds most chests on its ground. 1 since the biome
     * lock (the private project notes): a locked native is the only
     * kind of its ground and already crowds the pool, so the weight stayed 1
     * to keep the Thunder Herd from holding half of every band-4 plains chest.
     * Verify in playtest.
     */
    CHEST_GUARD_HOME_WEIGHT: 1,
    /**
     * The chest's own piece, rolled on its guards' band (index 0-4) rather than
     * on the flat drop weights: percent chances of each tier, the rest Common.
     * Stronger ground makes the better tiers likelier. **Legendary only from the
     * strongest chests** (band-4 guards), one in five — the playtest of 2026-10-14
     * found 1–7% everywhere made them a routine find; the share it took elsewhere
     * went to Epic. Meal luck still shifts the die, and never onto a zero.
     */
    CHEST_RARITY_ODDS: [
      { legendary: 0, epic: 6, rare: 30 },
      { legendary: 0, epic: 7, rare: 35 },
      { legendary: 0, epic: 14, rare: 40 },
      { legendary: 0, epic: 24, rare: 40 },
      { legendary: 20, epic: 28, rare: 40 },
    ],
    /** Extra waves behind the guards: the first brings chaff, the second an elite. */
    CHEST_GUARD_WAVES: 2,
  },
  MASTERY_MANA: {
    SHADOWBLADE_POOL_MULT: 1.25,
    BASE_REGEN: 1,
    SHADOWBLADE_REGEN: 1,
    CASTER_POOL_MULT: 0.85,
    CASTER_REGEN: 2,
    SPELL_COST_MULT: 1.15,
    ULTIMATE_COST_MULT: 1.5,
    RANK_COST_REDUCTION: 0.1,
  },
  /**
   * Chi, the Monk's resource (the private project notes, "The chi loop"). A fixed
   * pool that does not grow with level, refilled only inside a fight: a flat regen
   * each regular turn in place of the one-point `MASTERY_MANA.BASE_REGEN`, a larger
   * refill once per Basic Attack action, and Meditate. Full at every fight start.
   *
   * Tuned through `systems/sim/monkMeasure.ts` (the plan's "Tuning the chi loop"):
   * the shipped 60 / +5 / +20 with a 10-chi signature let the AI cast on 3.4–4.0 of
   * every four turns it acted, because the pool alone paid six signatures and the
   * regen half of the next. The signature now costs what one swing refills, so one
   * swing buys the next one; the pool holds a capstone and the cheapest regular spell,
   * about three signatures, so the opening burst ends inside a six-to-ten-turn fight;
   * and the regen is a trickle. Every Monk signature costs `SIGNATURE`, every
   * capstone `CAPSTONE` (both the rank-two price, before rank discounts).
   */
  CHI: {
    POOL: 45,
    REGEN: 1,
    BASIC_ATTACK_REFILL: 14,
    MEDITATE_REFILL: 10,
    SIGNATURE: 14,
    CAPSTONE: 30,
  },
  /**
   * Meditate, the Monk's level-3 identity skill (the private project notes,
   * "The base class"). Now: both defences raised until the Monk's next turn
   * begins, and `CHI.MEDITATE_REFILL`. At the start of that turn the Meditation
   * aura pays out: a share of maximum HP healed, and Attack and Magic for that
   * one turn. Flat points, not fractions.
   */
  MEDITATE: {
    PHYSICAL_DEFENSE: 6,
    MAGIC_DEFENSE: 6,
    HEAL_SHARE: 0.15,
    ATTACK: 3,
    MAGIC: 3,
  },
  /**
   * The Mantis tree's numbers (the private project notes, "### Mantis"). Rank-two
   * values, like every node's. The Basic Attack lays the Bleed (Bleeding Blades),
   * Twin Reap spends it, and Reaping Momentum stacks on one prey.
   */
  MANTIS: {
    /**
     * Each of Twin Reap's two cuts, as a multiple of Attack. 0.65 in the plan; the
     * harness (`monkMeasure`) had the Mantis's damage per turn 10-30% under every
     * Hunter build's at levels 10 and 20, and 0.9 brings it to the Hunters' floor.
     */
    TWIN_REAP_CUT: 0.9,
    /**
     * The Bleed every Mantis Bleed lays — Bleeding Blades' Basic Attack and
     * Scything Step — as a fraction of Attack a turn: about 4 when the path is
     * chosen, growing with the blow the way every authored Bleed does.
     */
    BLEED: 0.2,
    BLEED_TURNS: 3,
    /**
     * Pinning Cut's Exposed (playtest 2026-10-17, PT-22): the extra damage the
     * carrier takes from that Mantis, and the Mantis turns it lasts. A tuning
     * starting point; verify in playtest.
     */
    EXPOSE: 0.2,
    EXPOSE_TURNS: 2,
    /** Reaping Momentum: added to Twin Reap's cuts per stack on the same prey. */
    MOMENTUM_STEP: 0.1,
    MOMENTUM_MAX_STACKS: 3,
    /** Predator's Breath: critical chance, in points, for the turn Meditate pays out. */
    PREDATORS_BREATH_CRIT: 15,
    /** Each of Scything Step's two cuts, as a multiple of Attack. */
    SCYTHING_STEP_CUT: 0.6,
    /**
     * Marked Prey. The mark is laid at `MARK_TURNS` on the Mantis's own clock, so
     * it can be released on either of the next two regular turns and is gone at
     * the third. The release's second cut is `MARK_SHARE` of the HP the prey lost
     * since the mark, never more than `MARK_CAP` × the Mantis's Attack.
     */
    MARK_RANGE: 6,
    MARK_TURNS: 3,
    MARK_SHARE: 0.5,
    MARK_CAP: 4,
    /**
     * Threefold Scythe: the launch (a dash of `SCYTHE_DASH` and a cut), then a
     * three-hex arc and an eight-hex arc on the two bonus turns it queues — arc
     * depths 1 and 2.
     */
    SCYTHE_DASH: 4,
    SCYTHE_LAUNCH: 1.2,
    SCYTHE_ARC: 1.3,
    SCYTHE_SWEEP: 1.6,
    /** Mantis Execution: a blink within `EXECUTION_RANGE`, then `EXECUTION_CUTS` cuts of `EXECUTION_CUT` each. */
    EXECUTION_RANGE: 4,
    EXECUTION_CUTS: 5,
    EXECUTION_CUT: 0.45,
    /**
     * The side trees. Bleed Harvest (one rank) has no figure of its own: the Bleed
     * a reap removes pays what it had left. Fresh Kill's chi on a kill and Evasive
     * Weave's Dodge, in points, on a turn the Mantis moved. Deep Cuts (one rank)
     * adds whole turns to every Mantis Bleed; Haemorrhage makes them tick harder and
     * Scent of Blood adds damage against a Bleeding enemy, both fractions.
     */
    FRESH_KILL_CHI: 9,
    EVASIVE_WEAVE_DODGE: 8,
    DEEP_CUTS_TURNS: 1,
    HAEMORRHAGE: 0.35,
    SCENT_OF_BLOOD: 0.15,
    /**
     * Reaper's Breath (level 26): the chi a reap returns, per rung, so a 14-chi reap
     * costs 10 / 8 / 6. Not measured yet (the private project notes).
     */
    REAPERS_BREATH_CHI: [4, 6, 8] as const,
  },
  /**
   * The Firefly, the Monk's support path (the private project notes, "### Firefly").
   * Every figure is the middle rung's; a node's rung scales it by `LEVEL_SCALE`.
   * Rules in `systems/combat/fireflyRules.ts`. A share a rung scales is a multiple
   * of 20% so every rung reads a multiple of 5% (playtest 2026-10-23: 0.55 showed
   * as 41% and 69%); `fireflyRungs.test.ts` holds it. Verify the moves in playtest.
   */
  FIREFLY: {
    /** Glowmote's mote: this share of the bolt's damage, to the most hurt ally within `MOTE_REACH` of the Firefly. */
    MOTE_SHARE: 0.4,
    MOTE_REACH: 2,
    /** Spilled Light (level 26): the share of a mote's unused part that strikes the bolt's enemy, fixed (rank two). Not measured yet. */
    SPILLED_LIGHT_SHARE: 0.6,
    /** Brighter Motes: the mote's share and reach while the node is held. */
    BRIGHTER_MOTE_SHARE: 0.6,
    BRIGHTER_MOTE_REACH: 3,
    /** Lantern Breath: allies beside the Firefly take this share of Meditate's next-turn heal. */
    LANTERN_BREATH_SHARE: 0.6,
    /** Afterglow: Attack and Magic for any ally the Firefly heals. "A turn" is spelled 2 (see `healGrantsDefense`). */
    AFTERGLOW_ATTACK: 2,
    AFTERGLOW_MAGIC: 2,
    AFTERGLOW_DURATION: 2,
    /**
     * Lightbond: the percentage of each blow the Firefly lands that the bonded ally
     * heals, and the bond's length on the ally. Three ticks of the ally's clock is
     * the Firefly's next two turns, whichever of the two acts first.
     */
    LIGHTBOND_SHARE: 60,
    LIGHTBOND_DURATION: 3,
    /**
     * Firefly Motes: how many are laid (the rank-two count; a rung moves it by
     * one), how far from the Firefly they may land, and what an ally arriving
     * on one gains — `MOTE_HEAL` × the Firefly's Magic, fixed when laid, and
     * Attack and Critical Chance for "two turns" (2 on the bearer's clock).
     */
    MOTES_COUNT: 4,
    MOTES_RADIUS: 2,
    MOTE_HEAL: 1.0,
    MOTE_ATTACK: 6,
    MOTE_CRIT: 10,
    MOTE_BUFF_DURATION: 2,
    /**
     * Firefly Swarm: Silence for a turn (2, read the way every Silence is) and
     * Attack Down for two (3).
     */
    SWARM_SILENCE_DURATION: 2,
    SWARM_ATTACK_DOWN: 6,
    SWARM_ATTACK_DOWN_DURATION: 3,
    /**
     * Lantern Beacon: its maximum HP as a share of the Firefly's, the share of
     * that maximum it loses at the start of each Firefly turn (a third: three
     * turns unhealed), the reach of its light, the heal it pulses onto allies in
     * reach at the start of each Firefly turn (× the Firefly's Magic), the
     * Critical Chance it lends them and the extra damage enemies in reach take.
     */
    BEACON_HP_SHARE: 0.4,
    BEACON_DECAY: 1 / 3,
    BEACON_RADIUS: 2,
    BEACON_HEAL: 0.5,
    BEACON_CRIT: 10,
    BEACON_EXPOSED: 0.15,
    /**
     * The side trees. Far Light: the hexes it adds to Glowmote, Lightbond and
     * Purifying Light (`fireflyRules.FAR_LIGHT_SKILLS`). Twin Motes: how many
     * allies one mote heals, each for the whole mote. Steady Flame: the chi the
     * Firefly regains from each cast that heals an ally (the rank-two value; a
     * rung moves it by one). Second Light: a heal that lifts an ally
     * from below `SECOND_LIGHT_THRESHOLD` of its health to above it lays a
     * Barrier of `SECOND_LIGHT_BARRIER` × the Firefly's Magic for
     * `SECOND_LIGHT_DURATION` turns on the ally's clock (Meltwater's length).
     */
    FAR_LIGHT_RANGE: 1,
    TWIN_MOTES: 2,
    STEADY_FLAME_CHI: 2,
    SECOND_LIGHT_THRESHOLD: 0.5,
    SECOND_LIGHT_BARRIER: 0.4,
    SECOND_LIGHT_DURATION: 3,
  },
  /**
   * The Beetle's tree (the private project notes, "Beetle"). Every number is the
   * rank-two value, a starting point for the tuning harness. The Barrier factors
   * are shares of Physical + Magic Defense (`'defense'` scaling), read when the
   * Barrier is laid; chi costs live on the skills.
   */
  BEETLE: {
    /** Carapace charges Iron Carapace banks up to; a full set soaks the next blow whole. */
    CARAPACE_MAX: 3,
    /** Physical Defense each banked charge is worth. */
    CARAPACE_DEFENSE: 4,
    /**
     * Hardened Shell (playtest 2026-10-28, the first step of the Beetle's rework): Iron
     * Carapace's reach at the node's first rung, one hex more for each rung above. Struck
     * from beside the target it Taunts for one round (`HARDENED_SHELL_TAUNT_TURNS` ticks of
     * the victim's); struck from further off the Beetle dashes in and keeps its turn.
     */
    HARDENED_SHELL_REACH: 2,
    HARDENED_SHELL_TAUNT_TURNS: 2,
    /**
     * The share of Iron Carapace's damage the dash-strike deals, by the node's rung (playtest
     * 2026-10-29: the free dash made the Monk too strong). The reach still grows a hex a rung,
     * and a strike from beside the target keeps its whole damage.
     */
    HARDENED_SHELL_DASH_DAMAGE: [1 / 3, 2 / 3, 1] as readonly number[],
    /** Shell Breath: chi Meditate restores on top of its own, and the charge it banks. */
    SHELL_BREATH_CHI: 6,
    SHELL_BREATH_CHARGES: 1,
    /** Shoulder to Shoulder: the share of every blow an ally beside the Beetle does not take. */
    SHOULDER_REDUCTION: 0.15,
    /** Carapace Leap: who it may be cast on, and how far the leap carries when the ward is struck. */
    LEAP_CAST_RANGE: 4,
    LEAP_REACH: 6,
    LEAP_TURNS: REACTION_TURNS,
    /** Carapace Leap's Barrier, the Beetle's and the ward's alike, and its turns. */
    LEAP_BARRIER: 0.495,
    LEAP_BARRIER_TURNS: 2,
    /** Shell Wall: each ally's Barrier within its radius, the Beetle included. */
    SHELL_WALL_BARRIER: 0.418,
    SHELL_WALL_RADIUS: 2,
    SHELL_WALL_TURNS: 3,
    /** Grip and Throw: the throw's length, and the blow a target that cannot be thrown takes instead. */
    THROW_DISTANCE: 3,
    THROW_IMMOVABLE_DAMAGE: 1.65,
    /** Horn Sweep's Attack Down on every enemy it hits. */
    HORN_SWEEP_ATTACK_DOWN: 4,
    /**
     * Vengeful Shell: how far from the Beetle a covered ally may stand (at rank two), the
     * Beetle's turns it stays ready, the blows it takes a round, and the strike
     * that answers each one.
     */
    VENGEFUL_REACH: 3,
    /** Vengeful Shell's reach gained per rung (2 / 3 / 4, playtest 2026-10-28). */
    VENGEFUL_REACH_PER_RANK: 1,
    VENGEFUL_TURNS: REACTION_TURNS,
    VENGEFUL_ANSWERS: 2,
    VENGEFUL_STRIKE: 1.32,
    /**
     * How far the answer reaches: the whole arena. The Beetle has already leapt
     * to the ally, and the attacker it answers may be an archer across the field;
     * the plan's "strikes the attacker" has no range to it.
     */
    VENGEFUL_STRIKE_RANGE: 99,
    /** Carapace Bastion: the ground round the Beetle (at rank two), its turns, and the share of a covered ally's blow the Beetle takes. */
    BASTION_RADIUS: 2,
    /** Carapace Bastion's radius gained per rung (1 / 2 / 3, playtest 2026-10-28). */
    BASTION_RADIUS_PER_RANK: 1,
    BASTION_TURNS: 2,
    BASTION_SHARE: 0.5,
    /** Shell Swap: how far the dash reaches, the Barrier on both bodies, and the shove and Attack Down round the landing. */
    SWAP_RANGE: 4,
    SWAP_BARRIER: 0.462,
    SWAP_BARRIER_TURNS: 2,
    SWAP_PUSH: 1,
    SWAP_ATTACK_DOWN: 4,
    /** Second Watch: the prepared Reactions a Beetle holding it may stand at once (everyone else holds one). */
    SECOND_WATCH_REACTIONS: 2,
    /** Retribution: the strike, as a multiple of Attack, at an attacker whose blow the Beetle took or split (rank two). */
    RETRIBUTION_STRIKE: 0.495,
    /** Returned Blow (level 26): the strike, as a multiple of Attack, at the attacker of a blow a full Carapace soaked (rank two). Not measured yet. */
    RETURNED_BLOW_STRIKE: 1,
    /**
     * Numbing Staff: what the Basic Attack takes off the enemy's Attack and Magic,
     * and for how long (two ticks is the victim's next turn, as Horn Sweep's).
     */
    NUMBING_ATTACK_DOWN: 3,
    NUMBING_MAGIC_DOWN: 3,
    NUMBING_TURNS: 2,
    /** Heavy Hands: the share Horn Sweep and Grip and Throw hit harder by (rank two). */
    HEAVY_HANDS: 0.2,
    /** Planted Guard: Physical and Magic Defense each, while the Beetle holds its ground (rank two). */
    PLANTED_GUARD_DEFENSE: 6,
    /**
     * The Barrier skills' own rung curve (Carapace Leap, Shell Wall, Shell Swap),
     * in place of the global `LEVEL_SCALE` [0.75, 1, 1.25]: protection is the
     * Beetle's whole job, so a rung buys more of it (`HeroSkill.perRank.barrierScale`).
     * PT-04 (2026-10-22) raised every shield; verify in playtest.
     */
    BARRIER_RANK_SCALE: [0.7, 1, 1.4] as const,
  },

  // Bonus resources on combat victory
  COMBAT_BONUS_RESOURCE: {
    /** Base probability (0-1) that any bonus resources drop at all. */
    BASE_CHANCE: 0.25,
    /** Added on top of BASE_CHANCE at MAX_LEVEL, ramped linearly from level 1. */
    CHANCE_AT_MAX_LEVEL: 0.40,
    /** Small per-type amounts — intentionally lower than resource-node yields. */
    AMOUNTS: {
      wood:    { min: 1, max: 4 },
      stone:   { min: 1, max: 3 },
      iron:    { min: 1, max: 2 },
      crystal: { min: 1, max: 1 },
    },
  },

  // ── What a city building's levels buy ───────────────────────────────────────
  //
  // A playtest found three of the six buildings were dishonest about their own
  // levels: the Barracks charged for a toast and wrote nothing, the Library
  // advertised a passive bonus it did not have, and the Tavern's only effect was
  // to make recruits *dearer*. These are the numbers behind the fix. Every one
  // Rules and upgrade hints share the same pure service functions.

  /**
   * Gold per point of summed party level to rest the party at the tavern.
   *
   * Priced off summed level rather than a flat fee so it is a real decision in
   * the first week and pocket money by the castle — the same shape
   * `DEFEAT_GOLD_PER_LEVEL` uses, and for the same reason.
   *
   * One ordinary early fight covers a night; independent of Tavern upgrades.
   */
  TAVERN_REST_GOLD_PER_LEVEL: 1,
  /** Gold a recruit asks for at tavern level 0. */
  TAVERN_RECRUIT_BASE_GOLD: 50,

  /**
   * Fraction of a hero's health bar one ration restores.
   *
   * Sized between the two *free* heals rather than against its own price, which
   * is the only window it can sit in and still mean anything. The dawn heal is
   * `DAWN_HEAL_FRACTION` (0.15) and costs a night; the magic well is
   * `MAGIC_WELL_HEAL_FRACTION` (0.50) and costs a walk to a well that recharges
   * weekly. Below the dawn heal a ration is something the player can wait out
   * for nothing; at or above the well it deletes the well, whose entire cost is
   * that it is *somewhere* — a portable heal that matched it would make the
   * detour pointless forever. 0.35 is 2.3× the dawn heal and 0.7× the well.
   *
   * A fraction and not flat HP, for `healAll`'s reason: a flat number mends less
   * the better geared the hero is, and is a rounding error by the castle.
   */
  RATION_HEAL_FRACTION: 0.35,
  /** One ration costs 33% of the calculated full-party rest, rounded up. */
  RATION_REST_PRICE_FRACTION: 0.33,
  /**
   * The foothill camp's rest (`systems/economy/campRest.ts`): hours on the clock
   * and the share of a Tavern bed's price. Quicker and cheaper than the city's,
   * because the city is a crossing away; verify in playtest.
   */
  CAMP_REST_HOURS: 6,
  CAMP_REST_PRICE_FRACTION: 0.5,
  /** One consumable return to town; the pack always holds at most one. */
  TOWN_PORTAL_GOLD: 50,
  /**
   * Warding incense (playtest 2026-10-14: "a new item which lowers the chance
   * of encounter for a week"): its Tavern price, how many the pack holds, how
   * long one burns in campaign hours (seven days), and what it leaves of the
   * daily encounter roll on the world map. Lairs never roll, so it does nothing
   * inside one.
   */
  WARD_GOLD: 60,
  WARD_CARRY: 2,
  WARD_HOURS: 168,
  WARD_ENCOUNTER_MULT: 0.5,
  /**
   * Most rations the pack holds per hero in the party (3 for one hero, 12 for
   * four). Without a ceiling the tavern turned gold into unlimited healing and
   * no fight was ever worth worrying about.
   */
  RATIONS_PER_HERO: 3,
  /**
   * Rations in the pack when a campaign starts. One, so the first hurt hero
   * after the first fight can be fed from the map's Bag button and the
   * player learns food exists before they ever reach the tavern counter.
   */
  STARTING_RATIONS: 1,
  /**
   * The share of max HP at or below which a living hero counts as hurt for the
   * rations tip on the world map. Half rather than `LOW_HP_THRESHOLD` (0.35, a
   * combat rule): a hero at 40% after a fight is already one the player should
   * be told they can feed.
   */
  RATION_TIP_HP_FRACTION: 0.5,

  /**
   * Gold per mastery point to un-spend a hero's tree.
   *
   * Per point actually spent, not flat: undoing one tier-1 pick and undoing a
   * fifteen-point capstone chain are not the same decision, and a flat fee makes
   * one of them free and the other trivial. At 60 a full `MASTERY_POINTS_AT_CAP`
   * rebuild is 900 gold against a `TRIBUTE_BASE` of 100 — nine weeks of opening
   * rent, so it is a considered purchase rather than a thing to fiddle with
   * between fights.
   *
   * **The path is not refundable at any price.** What this buys back is the
   * fifteen decisions taken inside it, not the one taken before them.
   */
  BARRACKS_RETRAIN_GOLD_PER_POINT: 60,
  /**
   * Secondary retraining discounts remain independent of deployment privileges.
   */
  BARRACKS_RETRAIN_DISCOUNT_PER_LEVEL: 0.15,

  /** Meal tuning: +10 percentage points at dawn; 10% ordinary loot premium at tier 3. */
  EXPEDITION_MEAL_DAWN_HEAL: 0.25,
  EXPEDITION_MEAL_LOOT_BONUS: 0.10,
  EXPEDITION_MEAL_RARITY_LUCK: 0.10,
  EXPEDITION_MEAL_GOLD_PER_LEVEL: 3,
  DEPLOYMENT_REACH: 1,
  DEPLOYMENT_ENEMY_GAP: 2,
  /** Pieces of stock the shop racks at level 0; +2 per level. */
  SHOP_STOCK_BASE: 6,
  /** The shop's buy price as a multiple of an item's sell price. */
  SHOP_ITEM_MARKUP: 2.5,

  /**
   * Speed-granted bonus turns, from how much faster a unit is than the side it
   * faces (`systems/combat/turnTempo`).
   *
   * Measured as a *ratio* to the opposing side's mean speed, because enemy speed
   * scales with party level (`ENEMY_LEVEL_SCALE`) while hero speed comes from
   * gear and growth: a fixed difference would mean nothing at level 1 and
   * everything at level 15. Below `TEMPO_MIN_EDGE` faster there is no chance at
   * all, so an ordinary spread of speeds never produces a double turn; the
   * chance then rises linearly to `TEMPO_MAX_CHANCE` at `TEMPO_FULL_EDGE`
   * (twice as fast) and stays there. The cap is deliberately well under even
   * odds — a bonus turn is an occasional swing, not a second rhythm.
   */
  TEMPO_MIN_EDGE: 0.3,
  TEMPO_FULL_EDGE: 1.0,
  TEMPO_MAX_CHANCE: 0.35,

  /**
   * Most living enemies an announced wave may bring the board to. A wave that
   * would exceed it arrives in instalments as bodies fall, so a wave is never a
   * bigger fight than the arena can show.
   */
  WAVE_MAX_ACTIVE: 6,
  /** Waves one encounter may carry. They fire once each, so this bounds the fight. */
  WAVE_MAX_PER_ENCOUNTER: 3,
  /** Bodies one wave may carry. */
  WAVE_MAX_SIZE: 4,
  /** Reaction firings one trigger may cascade into before the rest are dropped. */
  REACTION_CASCADE_LIMIT: 12,
  /** A prepared Reaction's default turns, and the floor every Reaction is held to. */
  REACTION_TURNS,

  // ── Aethelred, the Obsidian Emperor ───────────────────────────────────────
  //
  // Every number the three-phase fight is tuned by. The kit's shape is in
  // `data/templates/aethelred.ts` and the rules in `systems/combat/bossScript`;
  // this block is only what a tuning pass is allowed to move. Damage figures
  // multiply the stat their skill scales with, the way every skill's do.

  /** The Emperor's Blade: frontal arc damage, and the Bleed it leaves. */
  AETHELRED_BLADE_DAMAGE: 1.1,
  AETHELRED_BLEED: 0.2,
  AETHELRED_BLEED_TURNS: 3,
  /** Imperial Cleave: the wedge's damage, which is the Blade at a larger scale. */
  AETHELRED_CLEAVE_DAMAGE: 1.9,
  /**
   * Boss tactics (`docs/combat.md`, Aethelred; designed in the private project notes, 4.4). A hero holding a Barrier, Last Stand or Immovable
   * in the wedge stops the Cleave: the blow falls on them alone at this share of its strength, with no push and
   * no Bleed, and he is Exposed (the damage he takes rises by `CLEAVE_EXPOSED`) for `CLEAVE_EXPOSED_TURNS` of
   * his own turns, which is the party's next round. Verify in playtest.
   */
  AETHELRED_CLEAVE_BLOCK_SHARE: 0.5,
  AETHELRED_CLEAVE_EXPOSED: 0.25,
  AETHELRED_CLEAVE_EXPOSED_TURNS: 2,
  /**
   * Writ of Seizure: the share of the writ-bearer's maximum HP a class skill
   * costs, and the share of Aethelred's maximum HP that cost lends him as a
   * Barrier. Both are shares so the trade holds at any level and Seal tier.
   */
  AETHELRED_WRIT_HP: 0.12,
  AETHELRED_WRIT_BARRIER: 0.02,
  /**
   * Imperial Standards: how many, each one's share of his maximum HP, the damage
   * each soaks, and the share of an area hit each shrugs off. Health 3.5% → 5%
   * and the area resistance are the playtest of 2026-10-14 (they fell too easily);
   * with his health +50% that is about twice the standard it was.
   */
  AETHELRED_STANDARDS: 3,
  AETHELRED_STANDARD_HP: 0.05,
  AETHELRED_STANDARD_PROTECTION: 0.2,
  AETHELRED_STANDARD_AREA_RESIST: 0.5,
  /**
   * Each standard destroyed gives the hero who broke it a Barrier worth this share of their own maximum
   * health, for `STANDARD_BARRIER_TURNS` of their turns (the protection it was turning aside, paid back to
   * the party). Verify in playtest.
   */
  AETHELRED_STANDARD_BARRIER: 0.12,
  AETHELRED_STANDARD_BARRIER_TURNS: 3,
  /**
   * The share of his maximum health he loses when a standard is destroyed (playtest 2026-10-28), less
   * `TIER_STEP` for each Seal tier above the first: 2% at tier 1, 1% at tier 5. It bypasses the
   * standards' own protection.
   */
  AETHELRED_STANDARD_BACKLASH: 0.02,
  AETHELRED_STANDARD_BACKLASH_TIER_STEP: 0.0025,
  /** Defence points stripped from him for two turns once the last standard falls. */
  AETHELRED_EXPOSED_DEFENSE: 30,
  /**
   * The Legion Responds: the share of his maximum HP the party must deal between
   * two of his turns, how many infantry answer, and the most reinforcements that
   * may stand at once.
   */
  AETHELRED_LEGION_THRESHOLD: 0.2,
  AETHELRED_LEGION_COUNT: 2,
  AETHELRED_LEGION_CAP: 4,
  /**
   * Foreclosure: the seal's damage, and the radius stamped round every hero. It
   * sealed only the hexes of the two or three hardest hitters until the playtest
   * of 2026-10-14 found it too small: now every hero and the six hexes around them.
   */
  AETHELRED_FORECLOSURE_DAMAGE: 1.6,
  AETHELRED_FORECLOSURE_RADIUS: 1,
  /**
   * Foreclosure's toll: a class skill cast from a seal costs the caster this share of their maximum health
   * (never kills; no Barrier lends it back), and the eruption still lands. A basic attack on him from the
   * seal pays it for nothing, a seal left empty charges the orb. Verify in playtest.
   */
  AETHELRED_TOLL_HP: 0.1,
  /** Chains of Tribute: the claim's damage, and how close the pair must end to split it. */
  AETHELRED_CHAINS_DAMAGE: 2.2,
  AETHELRED_CHAINS_SPLIT_RANGE: 2,
  /** Collateral Claim: soldiers branded, blast damage, ring radius and Barrier per soldier sacrificed. */
  AETHELRED_CLAIM_SOLDIERS: 2,
  AETHELRED_CLAIM_DAMAGE: 1.5,
  AETHELRED_CLAIM_RADIUS: 1,
  AETHELRED_CLAIM_BARRIER: 0.015,
  /**
   * The most charges the orb holds, by phase: whiffed Cleaves in phase 1, then Blood in the Ledger, empty
   * seals and Tithe on Mercy together in phases 2 and 3. Raised from 2 and 1 so a Foreclosure the whole party
   * steps off can be held (one per hero). Verify in playtest.
   */
  AETHELRED_WHIFF_CAP: 2,
  AETHELRED_LEDGER_CAP: 4,
  AETHELRED_TITHE_CAP: 4,
  /** Crownfall: the fall's damage and the radius around him that stays safe. */
  AETHELRED_CROWN_DAMAGE: 1.8,
  AETHELRED_CROWN_SAFE_RADIUS: 3,
  /**
   * The boss feel pass (the private project notes, Aethelred): a hero holding a Barrier, Last Stand while it
   * bites or Immovable on a crown point takes this share of the point, and every other point falls as before.
   * Verify in playtest.
   */
  AETHELRED_CROWN_BLOCK_SHARE: 0.5,
  /**
   * Overturn (the boss feel pass): the closer the party gets, the harder he flips the table. As the phase turns at
   * 66% and 33%, and once more at `OVERTURN_LAST` of his health inside phase 3, he heaves the ground: every hero is
   * thrown a random distance within that throw's range (`OVERTURN_DISTANCES`, the first, second and third throw)
   * in a random direction, stopped by walls, bodies and black glass, for `OVERTURN_DAMAGE` (light; it scales with
   * his attack as his blows do). Verify in playtest: the distances, the damage, and whether the third throw stings.
   */
  AETHELRED_OVERTURN_LAST: 0.1,
  AETHELRED_OVERTURN_DISTANCES: [[1, 2], [2, 3], [3, 4]],
  AETHELRED_OVERTURN_DAMAGE: 0.5,
  /**
   * The orb charges a Foreclosure seal left empty adds from castle tier 4 (one below it; `bossScript.emptySealCharges`,
   * the private project notes). Still up to the phase's cap. Verify in playtest.
   */
  AETHELRED_TIER_SEAL_CHARGES: 2,
  /**
   * The Realm That Burned: the HP he pays (a share of his maximum), the blast's
   * damage, its opening radius, how much damage taken widens it by one hex and
   * the widest it may ever be.
   */
  AETHELRED_REALM_COST: 0.04,
  AETHELRED_REALM_DAMAGE: 2.4,
  AETHELRED_REALM_RADIUS: 2,
  AETHELRED_REALM_WIDEN_PER: 0.05,
  AETHELRED_REALM_MAX_RADIUS: 3,

  // ── The Troll Chieftain ───────────────────────────────────────────────────
  // The kit's shape is in `data/templates/trollChieftain.ts` and the rules in
  // `systems/combat/trollScript`; this block is only what a tuning pass moves.

  /** Bonebreaker Sweep: the frontal club arc's damage, and the Defence each stack takes off a hero. */
  TROLL_SWEEP_DAMAGE: 1.0,
  TROLL_WOUND_DEFENSE: 1,
  /** Farthest Prey: the landing's damage, the Stun it leaves (in turns) and the radius of the marked area. */
  TROLL_PREY_DAMAGE: 1.8,
  TROLL_PREY_STUN: 1,
  TROLL_PREY_RADIUS: 1,
  /**
   * The damage he takes over again while Exposed after Farthest Prey comes down on his rubble (the heap
   * gives way under him), for the pair's next round. The other bosses' earned windows are +25%; this is
   * the same. Verify in playtest.
   */
  TROLL_PREY_EXPOSED: 0.25,
  /** Boundary Smash: the slam's damage, the heroes it reaches (radius) and how far it throws them. */
  TROLL_SMASH_DAMAGE: 1.4,
  TROLL_SMASH_RADIUS: 2,
  TROLL_SMASH_PUSH: 2,
  /**
   * Warren Collapse: the rocks' damage (shared among the heroes under them) and the marked area's
   * radius. Its rubble stands until his next Collapse lands, so it has no lifetime to tune.
   */
  TROLL_COLLAPSE_DAMAGE: 2.4,
  TROLL_COLLAPSE_RADIUS: 1,
  /**
   * The share of his maximum health he recovers at the start of a regular turn when no hero has
   * damaged him since his last one: about one hero's turn of damage at the Warren's band (a pair at
   * a summed level of 8, around 5% of his encounter health), trimmed from 5% to 4% on 2026-10-24.
   * Verify in playtest.
   */
  TROLL_REGEN_SHARE: 0.04,
  /** Fury: the share of his health at or below which it lights, and the damage it adds. */
  TROLL_FURY_THRESHOLD: 0.5,
  TROLL_FURY_DAMAGE: 0.5,

  // ── The Emerald Dragon ────────────────────────────────────────────────────
  // The kit's shape is in `data/templates/emeraldDragon.ts` and the rules in
  // `systems/combat/dragonScript`; this block is only what a tuning pass moves.

  /** Dragon Claw: the wide frontal arc's damage. */
  DRAGON_CLAW_DAMAGE: 1.3,
  /** Wing Thrust: the wing impact's damage, how far it throws, and the flame wave that follows. */
  DRAGON_WING_DAMAGE: 0.44,
  DRAGON_WING_PUSH: 2,
  DRAGON_WAVE_DAMAGE: 0.4,
  /**
   * Rising Fire, the scale of his heat gauge (`BossScriptState.heat`, `systems/combat/dragonHeat`): the
   * first reading is `DRAGON_RISE_START` of his attack and magic, each step adds `DRAGON_RISE_STEP` of
   * them (one point of a base 20), full strength is at reading `DRAGON_RISE_FULL_TURN`, and it keeps
   * climbing after it. A step is each regular turn of his, plus one for a warning of his that strikes
   * nobody. A quench (a broken Furnace Heart, an interrupted Skyfire, a sprawled landing) takes
   * `DRAGON_QUENCH_STEPS` off it, never below a floor of the first reading plus `DRAGON_QUENCH_FLOOR` of a
   * step for each regular turn he has taken (verify both in playtest).
   */
  DRAGON_RISE_START: 0.75,
  DRAGON_RISE_STEP: 0.05,
  DRAGON_RISE_FULL_TURN: 6,
  DRAGON_QUENCH_STEPS: 3,
  DRAGON_QUENCH_FLOOR: 0.5,
  /**
   * Cinder Rift: the eruption's damage and the fire a crossing costs (x his attack), and how many of his regular
   * turns it burns after the one it erupts on (boss feel pass, 2026-11-03: it no longer waits for Skyfire; verify
   * in playtest).
   */
  DRAGON_RIFT_DAMAGE: 1.2,
  DRAGON_RIFT_CROSS: 0.5,
  DRAGON_RIFT_TURNS: 3,
  /**
   * Furnace Heart, carried by a hero (boss feel pass, 2026-11-03; verify every number in playtest): the burst's
   * damage (x his magic) on whoever holds it and the heroes beside them, the burst's radius round the carrier,
   * the crystal's health as a share of his maximum (about 15%, far more than the planted crystal's 8%), the
   * rounds of the heroes' turns it burns before it bursts, and the share of his maximum health he loses when
   * it is broken (its backlash).
   */
  DRAGON_HEART_BURST: 2.2,
  DRAGON_HEART_RADIUS: 1,
  DRAGON_HEART_HP: 0.15,
  DRAGON_HEART_WINDOWS: 5,
  DRAGON_HEART_BACKLASH: 0.04,
  /**
   * The Heart's burn on its carrier, at the start of each of their turns (x his magic, through their magic
   * defence): `DRAGON_HEART_BURN` on the first turn a hero holds it, `DRAGON_HEART_BURN_STEP` more for each
   * further turn the same hero keeps it, back to the first step when it is passed. Tuned so a hero at the
   * Hollow's band who never passes is not burned down before the burst (`dragonFight.test.ts`; verify in
   * playtest). `DRAGON_HEART_HEAL_CUT` is the share of healing its Seared takes off the carrier.
   */
  DRAGON_HEART_BURN: 0.25,
  DRAGON_HEART_BURN_STEP: 0.1,
  DRAGON_HEART_HEAL_CUT: 0.5,
  /** Pass the Heart: how far the carrier can hand it on, or an ally take it from them (hexes). */
  DRAGON_HEART_PASS_RANGE: 2,
  /** Skyfire: the all-arena flame, the landing's damage and radius, and the share of Defence a broken launch or a sprawled landing costs him. */
  DRAGON_SKYFIRE_DAMAGE: 2.6,
  DRAGON_LANDING_DAMAGE: 1.6,
  DRAGON_LANDING_RADIUS: 2,
  DRAGON_EXPOSED_DEFENSE: 0.5,
  /** His turns each signature rests after use. */
  DRAGON_WING_COOLDOWN: 3,
  DRAGON_RIFT_COOLDOWN: 4,
  DRAGON_HEART_COOLDOWN: 5,
  DRAGON_SKYFIRE_COOLDOWN: 6,

  /**
   * The Frost Mote's shatter (playtest 2026-10-21: it was meant to explode and did
   * not): when it dies, `AMOUNT` × its Magic as magic damage to every enemy within
   * `RADIUS`, and a Chill of `CHILL` speed for `CHILL_TURNS` ticks — which freezes a
   * hero already chilled, as every source of Chill does. Stated on its passive
   * (`frostBurst`) from these same numbers. `AMOUNT` went from 0.8 to 3 (playtest
   * 2026-10-23b): its death should be the dangerous part of it; verify in playtest.
   */
  FROST_MOTE_BURST: { RADIUS: 1, AMOUNT: 3, CHILL: 3, CHILL_TURNS: 2 },

  // ── The Heart of Winter ────────────────────────────────────────────────────
  /**
   * Where it starts, and how far from it the three Blood-Iron anchors stand (the
   * ring the anchors are picked from; `heartScript.anchorSpots`).
   */
  HEART_START_Q: 0,
  HEART_START_R: -2,
  HEART_ANCHOR_RING: 3,
  /**
   * An anchor's health as a share of the Heart's maximum — about 500 in the fight
   * against its 8,900–12,300 encounter health, raised from 0.02 (two ordinary blows,
   * ~200) on a playtest that found the fight too soft — and the share of the Heart's
   * incoming damage each one soaks.
   * Three of them are the agreed 99 / 66 / 33 % — a total by count, not three
   * separate buffs stacked.
   */
  HEART_ANCHOR_HP: 0.05,
  HEART_ANCHOR_PROTECTION: 0.33,
  /**
   * Phase-1 time pressure (playtest 2026-10-21): at the start of each of its turns
   * while chained, every anchor still standing feeds it this share of its own Attack
   * and Magic, stacking for as long as it stays chained (`heartActions.beginHeartTurn`).
   * Three anchors for four turns is +48%. The feed is shed on its first unbound turn.
   */
  HEART_ANCHOR_EMPOWER: 0.04,
  /** Fraction of its health at which it tears free of the restraints that are left. */
  HEART_RELEASE_THRESHOLD: 0.5,
  /** Damage taken by the Heart for a window the party earned, and how long (in its own turns) it lasts. */
  HEART_EXPOSED: 0.25,
  HEART_EXPOSED_TURNS: 2,
  /** Released: its direct attack and magic grow by this much. */
  HEART_UNBOUND_POWER: 1.2,
  /** Splintering Pulse: the splinter, the fracture behind the target and the shatter of ice under it (x Magic). */
  HEART_PULSE_DAMAGE: 1.0,
  HEART_PULSE_FRACTURE: 0.6,
  HEART_PULSE_SHATTER: 0.3,
  HEART_PULSE_RANGE: 5,
  /** The Pulse (splinter and fracture) loses this share of its damage per hex between the Heart and its target. */
  HEART_PULSE_FALLOFF: 0.1,
  /**
   * Creeping Winter: the eruption (x Magic), the share of the arena's hexes it marks
   * (from 3 hexes to half the board on the same playtest) and its rest in the Heart's turns.
   */
  HEART_WINTER_DAMAGE: 0.8,
  HEART_WINTER_SHARE: 0.5,
  HEART_WINTER_COOLDOWN: 3,
  /** Frozen ground: extra movement points to enter. */
  HEART_ICE_COST: 1,
  /** Icebound Reprisal: the taut chain (x Magic), the Barrier it earns and the backlash of breaking it (shares of maximum health). */
  HEART_REPRISAL_DAMAGE: 1.3,
  HEART_REPRISAL_BARRIER: 0.1,
  HEART_REPRISAL_BACKLASH: 0.05,
  HEART_REPRISAL_BARRIER_TURNS: 4,
  HEART_REPRISAL_COOLDOWN: 3,
  /** Whiteout Convergence: each spire's blast (x Magic) and radius, the spires, their health and the pulse each one sends when broken. */
  HEART_CONVERGENCE_DAMAGE: 1,
  HEART_CONVERGENCE_RADIUS: 1,
  HEART_SPIRES: 8,
  HEART_SPIRE_HP: 0.012,
  HEART_SPIRE_PULSE: 0.03,
  /** The share of an area hit a spire shrugs off (playtest 2026-10-14: one area spell cleared the field). */
  HEART_SPIRE_AREA_RESIST: 0.5,
  HEART_CONVERGENCE_COOLDOWN: 4,
  /**
   * The Heart's Seal refight from the cleared Barrow (`world/heartRefight.ts`,
   * the private project notes): Winter Seal tiers 1–5, each × (1 + step × (tier − 1))
   * on the lair boss fight's power and pay, as Kairen's and the castle's Aethelred are.
   */
  HEART_SEAL: {
    MAX_TIER: 5,
    TIER_POWER: 0.2,
    /**
     * Tier 5: the unbound Heart's health share at which two anchors rise and chain it again,
     * once a fight, and how many. Starting numbers: verify in playtest.
     */
    RECHAIN_AT: 0.25,
    RECHAIN_ANCHORS: 2,
  },

  // ── The elites' signatures (systems/combat/eliteKits) ────────────────────────
  /**
   * Cave Bear, Winter Sleep: the blow it would have died of puts it to sleep for
   * this many of its own turns, heals this share of its maximum health at once,
   * and takes this much less damage from every strike while it sleeps (after
   * mitigation, the floor, crits and armour penetration, so none of them gets
   * round it). It wakes at full health.
   *
   * A reduction rather than a Defense coat: Defense can never take more than
   * `1 - MIN_DAMAGE_FRACTION` off a hit, so stacking it read as "DEF 100" on the
   * sheet while barely denting what a big swing did.
   */
  WINTER_SLEEP_TURNS: 3,
  WINTER_SLEEP_HEAL: 0.08,
  WINTER_SLEEP_DAMAGE_REDUCTION: 0.92,
  /**
   * Dark Mage, Mind Control: the hero it marks acts for it this many of the hero's
   * own turns. It rests for longer than that (the skill's cooldown), so the Mage
   * cannot hold a hero for ever.
   */
  MIND_CONTROL_TURNS: 2,
  MIND_CONTROL_COOLDOWN: 6,
  MIND_CONTROL_RANGE: 4,
  /**
   * Bog Hulk, Mire Undertow: the marsh the slam leaves reaches this far from the
   * Hulk, and drags whoever still stands in it this many hexes toward him.
   */
  MIRE_RADIUS: 3,
  MIRE_PULL: 2,
  MIRE_COOLDOWN: 4,
  /**
   * The beasts' Maul (the Bog Hulk's and the Cave Bear's): a heavy swipe that shoves
   * its target a hex. At will, it shoved a lone melee hero out of reach on every
   * one of the elite's turns, and since a turn is move *or* act the hero spent every
   * turn walking back and never swung once (PT-14, 0 swings in 20 harness fights).
   * Two puts it with the other shoving heavy hits (the Oni's Crush, Dread Charge):
   * a Maul, then two turns of the owner's plain blow, so a melee hero gets its
   * swings in. Measured on one 900-HP melee hero against the Hulk: 0 wins in 20
   * at will, 5 in 20 at one, 20 in 20 at two. Verify in playtest.
   */
  MAUL_COOLDOWN: 2,
  /**
   * Orc Berserker, Pain Feast: hits taken before its next Slash is the feast, the
   * feast's damage (x Attack) and the Bleed it leaves.
   */
  PAIN_FEAST_THRESHOLD: 6,
  PAIN_FEAST_DAMAGE: 1.8,
  PAIN_FEAST_BLEED: 0.25,
  PAIN_FEAST_BLEED_TURNS: 3,
  /**
   * Orc Warchief, Warband Order: how many of the marked hero's turns the order
   * stands, how long the Warchief rests, how far it can mark, and how many Grunts
   * he will call over a whole fight (one standing at a time, and these are all he has).
   */
  WARBAND_TURNS: 2,
  WARBAND_COOLDOWN: 8,
  WARBAND_RANGE: 6,
  WARBAND_BACKUP_TOTAL: 2,
  /** A called Grunt is a conscript: this share of the strength the Warchief's own warband fights at. */
  WARBAND_BACKUP_POWER: 0.7,
  /**
   * Revenant, Soul Fracture: fragments, each one's health as a share of the
   * Revenant's maximum, the hexes one crosses per Revenant turn, the turns after
   * which every fragment still alive arrives anyway, and the share of maximum
   * health each arrival gives the reformed body.
   */
  SOUL_FRAGMENTS: 3,
  SOUL_FRAGMENT_HP: 0.12,
  SOUL_FRAGMENT_STEP: 2,
  SOUL_FRAGMENT_MAX_TURNS: 5,
  SOUL_REFORM_PER_FRAGMENT: 0.2,
  /**
   * Coven Matriarch, Briar Claim: the seed's health (a share of her maximum) and
   * how many Thralls she may have standing.
   */
  BRIAR_SEED_HP: 0.14,
  BRIAR_THRALL_CAP: 2,
  /**
   * Ashwood Crone, Witch's Geas: how many of the marked hero's turns the curse
   * waits for a spell, what the eruption it raises deals (x Magic), its radius,
   * the Crone's rest and how far she can mark.
   */
  GEAS_TURNS: 3,
  GEAS_DAMAGE: 1.4,
  GEAS_RADIUS: 1,
  GEAS_COOLDOWN: 5,
  GEAS_RANGE: 4,
  /**
   * Delve Overseer, Fracture: how long a Fracture mark lasts (the marked hero's
   * turns) and the radius of the eruption it earns around a marked hero.
   */
  FRACTURE_TURNS: 3,
  FRACTURE_RADIUS: 1,
  /** Brigand Captain, Captain's Authority: the share every other ally gains on every combat stat. */
  AUTHORITY_BONUS: 0.5,
  // ── The new-faction elites' signatures (systems/combat/factionEliteKits) ─────
  /**
   * Burrowmother, Undermine: she is gone for a round, and the ground that will
   * erupt is a disc of this radius round the party's centre. Two vents are marked
   * on its edge, three against a party of three or more heroes. The eruption deals
   * this much (x Attack) and throws every hero in it into the air (a picture, not a
   * disable: the plan leaves the knock-up's meaning open). Every vent no hero holds spawns
   * a Sand Mite, never past `UNDERMINE_MITE_CAP` standing, and she is Exposed
   * (`UNDERMINE_EXPOSED` more damage taken) for exactly one round of the party's
   * turns afterwards: her own next turn is the end of it.
   */
  UNDERMINE_COOLDOWN: 8,
  UNDERMINE_RADIUS: 1,
  UNDERMINE_VENTS: 2,
  UNDERMINE_VENTS_LARGE_PARTY: 3,
  UNDERMINE_DAMAGE: 1.4,
  UNDERMINE_MITE_CAP: 4,
  /** A vent's mite is a conscript: this share of the strength the Burrowmother's own brood fights at. */
  UNDERMINE_MITE_POWER: 0.5,
  UNDERMINE_EXPOSED: 0.4,
  UNDERMINE_EXPOSED_TURNS: 1,
  /**
   * Herd-Khan, Twin Raid: two dashes of up to `TWIN_RAID_DASH` hexes in one action,
   * each arrival bursting over `TWIN_RAID_RADIUS` hexes for this much (x Attack) and
   * leaving a Bleed. The plan's 3-turn cadence is spelled one lower.
   */
  TWIN_RAID_COOLDOWN: 2,
  TWIN_RAID_DASH: 3,
  TWIN_RAID_RADIUS: 1,
  TWIN_RAID_DAMAGE: 0.8,
  TWIN_RAID_BLEED: 0.25,
  TWIN_RAID_BLEED_TURNS: 3,
  /**
   * Rime Jarl, Jarl's Challenge: how far he can name a hero, how long he rests
   * (the plan's 5, spelled one lower), the rune circle's radius round his hex, the
   * share of direct Attack-scaled damage an accepted duel adds for him, and how
   * many regular turns each duelist must end before the circle dissolves. A refusal
   * wraps only the Jarl in a Barrier of this share of his maximum health for
   * `REFUSE_BARRIER_TURNS` of his turns (one higher on the status, which ticks first).
   */
  CHALLENGE_RANGE: 2,
  CHALLENGE_COOLDOWN: 4,
  CHALLENGE_RADIUS: 2,
  DUEL_DAMAGE_BONUS: 0.25,
  DUEL_TURNS: 2,
  REFUSE_BARRIER: 1,
  REFUSE_BARRIER_TURNS: 2,
  /**
   * Glacier Colossus, Glacial Tomb: reach, rest (the plan's 4, spelled one lower),
   * the block's health as a share of his maximum, what either release deals
   * (x his Magic), and how long the Chill of an unbroken tomb's collapse lasts.
   */
  TOMB_RANGE: 3,
  TOMB_COOLDOWN: 3,
  TOMB_HP: 0.15,
  TOMB_DAMAGE: 1.5,
  TOMB_CHILL_TURNS: 2,

  // ── The Draconic Host (Jadeveil, bands 3–4; data/skills/draconicHostSkills.ts) ──
  DRACONIC_HOST: {
    /** Oni Warlord: the Two-Handed Sweep rests a turn between swings. */
    SWEEP_COOLDOWN: 2,
    /**
     * Warlord's Doom: reach, the branded circle's radius, the Doom it lays (x his Attack,
     * scaled like every Doom) and its duration (2: one turn to answer), and his rest.
     */
    DOOM_RANGE: 4,
    DOOM_RADIUS: 1,
    DOOM_DAMAGE: 2.0,
    DOOM_TURNS: 2,
    DOOM_COOLDOWN: 4,
    /** Daitengu: Hush of the Peaks' rest, and Great Gale's wedge depth, damage (x Magic), push and rest. */
    HUSH_COOLDOWN: 3,
    GALE_DEPTH: 3,
    GALE_DAMAGE: 0.85,
    GALE_PUSH: 2,
    GALE_COOLDOWN: 3,
  },
  // ── The Yokai (Jadeveil) ───────────────────────────────────────────────────
  /** Kappa's River Grapple: the chance it Roots (2 turns). */
  KAPPA_ROOT_CHANCE: 0.4,
  /**
   * Jorōgumo's Silk Shroud: how far she spits a web, and how many volleys escalate
   * (one web, then two, three, four) before every volley webs every hero she can
   * while still leaving one free to answer.
   */
  JOROGUMO_WEB_RANGE: 5,
  JOROGUMO_ESCALATING_VOLLEYS: 4,
  /**
   * Widow's Kiss, the bite on a hero still webbed at her next turn (x her Attack,
   * physical), and its Poison dose. Sized to take most non-tanks from full health.
   * 7 while she was a 16-attack elite; 3 since she became the Silk Hollow's boss on a
   * boss's Attack (2026-10-16). Verify in playtest.
   */
  JOROGUMO_BITE_DAMAGE: 3,
  JOROGUMO_BITE_POISON: 0.5,
  // ── Jadeveil: Silk Hollow / Yokai ──────────────────────────────────────────
  /**
   * The Nue, the Yokai's roaming elite (data/skills/yokaiSkills.ts). Thundercloud's
   * Shock on every hero beside it at its turn start (turns); Black Thunder's ring
   * (x Magic) and its rest; Serpent Tail's strike on the hero behind it (x Attack)
   * and its Poison dose. First estimates: verify in playtest.
   */
  /**
   * The Jorōgumo as the Silk Hollow's boss (data/templates/jorogumoWeaver.ts). Where she
   * hangs (her perch, the back row), the ring her three threads stand on and each
   * thread's health (x her max health); Canopy Venom's reach, damage (x Attack) and
   * Poison dose; the Attack multiplier once she is dragged down. First estimates:
   * verify in playtest.
   */
  JOROGUMO_WEAVER: {
    PERCH_Q: 2,
    PERCH_R: -5,
    THREAD_RING: 3,
    THREAD_HP: 0.06,
    /**
     * The share of her maximum health a Silk Thread costs her when it is cut (its backlash),
     * even while she hangs: each thread is a step toward her, not only toward the last
     * (boss feel pass, 2026-11-03). Verify in playtest.
     */
    THREAD_BACKLASH: 0.05,
    VENOM_RANGE: 12,
    VENOM_DAMAGE: 1.1,
    VENOM_POISON: 0.3,
    GROUND_POWER: 1.15,
  },
  /**
   * Jadeveil: Kairen, the Cloud-Crowned Dragon — the summit's boss
   * (the private project notes, `systems/combat/kairenRules.ts`). Damage is × his
   * Attack (lash, dive, downdraft) or Magic (the orb and the storm). Turn gaps count his
   * regular turns; first turns count the turns of the phase. Starting points aimed at a
   * fight about 25–30% stronger than Aethelred at tier 1: verify in playtest.
   */
  KAIREN: {
    /** His story fight's level over the band floor (`contentLevel.ts`). */
    STORY_LEVEL_OFFSET: 4,
    START_Q: 0,
    START_R: -2,
    /** Jade Taint's ceiling, in stacks. */
    TAINT_CAP: 3,
    /** Exposed after a Cloud Dive lands and from a drawn lightning bolt: +25%, for one hero window. */
    EXPOSED: 0.25,
    EXPOSED_TURNS: 2,
    LASH_DAMAGE: 0.9,
    LASH_PUSH: 1,
    DIVE_DAMAGE: 1.4,
    DIVE_GAP: 4,
    DIVE_GAP_TEMPEST: 3,
    DIVE_FIRST: 3,
    GALE_GAP: 3,
    GALE_FIRST: 2,
    GALE_PUSH: 1,
    /** Tier 3's twist: the Gale pushes two hexes. */
    GALE_PUSH_TIER3: 2,
    DOWNDRAFT_DAMAGE: 1.3,
    /** How deep the downwind edge the Downdraft strikes is, in hexes. */
    DOWNDRAFT_ROWS: 2,
    ORB_BOLT_DAMAGE: 0.8,
    ORB_BOLT_RANGE: 7,
    /** Tier 2's twist: the Orb Bolt strikes this many heroes, the least tainted. */
    ORB_BOLT_TARGETS_TIER2: 2,
    /** Thunderhead: marks a round, and a bolt's damage (also a Jade Shard's burst). */
    THUNDER_MARKS: 4,
    THUNDER_DAMAGE: 0.6,
    /** Verdant Judgement: × Magic of `BASE + PER_STACK × Taint` on every hero. */
    VERDANT_BASE: 0.25,
    VERDANT_PER_STACK: 0.42,
    VERDANT_GAP: 4,
    VERDANT_FIRST: 2,
    NOVA_DAMAGE: 1.0,
    NOVA_INNER: 2,
    NOVA_OUTER: 3,
    NOVA_GAP: 4,
    NOVA_FIRST: 2,
    SHARDS: 2,
    /** Brood of the Orb: wyrmlings at tier 1, and a field Wyrmling's health and attack they keep. */
    BROOD_COUNT: 6,
    BROOD_HP: 0.3,
    BROOD_ATTACK: 0.6,
    /** His turns after a Brood before he may call another, once the last is dead. */
    BROOD_GAP: 3,
    /** Storm Seal tiers: HP and damage × (1 + TIER_POWER × (tier − 1)), as the castle's Aethelred. */
    TIER_POWER: 0.2,
    MAX_TIER: 5,
  },
  NUE: {
    SHOCK_TURNS: 2,
    THUNDER_DAMAGE: 1.3,
    THUNDER_COOLDOWN: 3,
    TAIL_DAMAGE: 0.9,
    TAIL_POISON: 0.3,
  },

  // ── Wildshape remaster (2026-10) ───────────────────────────────────────────
  /**
   * Blood Howl: the Critical Chance it adds while the Druid is a Wolf (the Attack is
   * the aura's own magnitude), and how many extra turns its critical hits can grant
   * between two regular Wolf turns — taken and still queued counted together, never
   * refilled by a granted turn. One since the playtest of 2026-10-14: three chained
   * crit turns was the strongest thing a Wolf could do and read as a free round.
   */
  BLOOD_HOWL_CRIT: 25,
  BLOOD_HOWL_TURN_CAP: 1,
  /**
   * The Apex shape: regular turns it lasts (the entry turn is the first) and the
   * regular turns `apex_form` then cools for, counted from the reversion.
   */
  APEX_TURNS: 3,
  APEX_COOLDOWN: 8,
  /** Below this share of its effective maximum HP a target counts as `wounded`. */
  WOUNDED_THRESHOLD: 0.5,

  // ── The Fallen Order (Jadeveil) ────────────────────────────────────────────
  /**
   * The monks who taught the Monk's stances (`data/skills/fallenOrderSkills.ts`,
   * rules in `systems/combat/fallenOrderKits.ts`). Cadences are spelled as
   * `cooldown`, one lower than "every Nth turn".
   */
  FALLEN_ORDER: {
    /** Beetle Warden's Bastion: the Beetle's ground, the Warden's own numbers. */
    BASTION_RADIUS: 1,
    BASTION_TURNS: 2,
    BASTION_SHARE: 0.5,
    BASTION_COOLDOWN: 3,
    /** The Bleed a Mantis blade of the Order lays, a fraction of Attack a turn. */
    BLEED: 0.25,
    BLEED_TURNS: 3,
    /** The Chain-Sickle's at-will Root chance, and Chain Snare's rest. */
    SICKLE_ROOT_CHANCE: 0.25,
    SNARE_COOLDOWN: 3,
    /** Firefly Chanter: the mote of its bolt, and Lantern Hymn's ring. */
    MOTE_SHARE: 0.5,
    MOTE_REACH: 3,
    HYMN_RADIUS: 2,
    HYMN_HEAL: 0.7,
    HYMN_BARRIER: 0.8,
    HYMN_TURNS: 2,
    HYMN_COOLDOWN: 2,
    /** Fallen Abbot's Vow of the Shell: the Vengeful Shell, for his monks. */
    VOW_REACH: 2,
    VOW_TURNS: REACTION_TURNS,
    VOW_ANSWERS: 2,
    VOW_STRIKE: 1.0,
    VOW_COOLDOWN: 4,
    /** Fallen Abbot's Glowmote mote: share of the damage and reach. */
    ABBOT_MOTE_SHARE: 0.6,
    /**
     * Bell-Keeper's Toll of Passing: reach, the Doom it lays (x the Keeper's Magic,
     * landing when the turns run out: three is two turns to answer), and its rest.
     * The Doom is the Keeper's own: it is lifted the moment the Keeper falls.
     */
    TOLL_RANGE: 4,
    TOLL_DOOM: 2.2,
    TOLL_TURNS: 3,
    TOLL_COOLDOWN: 3,
    /** Bell-Keeper's Great Ring: the announced ring round it, and what it lands. */
    RING_RADIUS: 2,
    RING_DAMAGE: 0.8,
    RING_COOLDOWN: 3,
  },

  // ── Jadeveil: Silent Hall / Fallen Order ───────────────────────────────────
  /**
   * The Last Lesson, the Silent Hall's boss (`data/templates/lastLesson.ts`, rules in
   * `systems/combat/lastLessonRules.ts`). First estimates: verify in playtest.
   */
  LAST_LESSON: {
    /** Walking Staff, his at-will blow, x Attack. */
    STAFF_DAMAGE: 1.0,
    /** Pilgrim's Step: a blow, and he stands behind its target. Its rest. */
    STEP_DAMAGE: 1.2,
    STEP_COOLDOWN: 2,
    /** The riposte a parried repeat earns, x Attack. The parried blow itself deals nothing. */
    RIPOSTE_DAMAGE: 1.5,
    /** The rebuke a broken lesson earns, x Attack. */
    REBUKE_DAMAGE: 1.3,
    /** Stillness: more than this many hexes from where a turn began breaks it. */
    STILLNESS_HEXES: 2,
    /** Below this share of health he names two lessons a round. */
    FINAL_THRESHOLD: 0.5,
    /** Attack in the final phase. */
    FINAL_POWER: 1.15,
  },

  // Advanced (level 21–25): Monk
  /**
   * The Monk's level-21–25 advanced nodes (`docs/quests-progression-items.md`,
   * "Advanced nodes"). Rank-two figures unless a list says per rung.
   */
  MONK_ADVANCED: {
    /** Shell Ward (Beetle): the Barrier each ally beside the Beetle gains at its turn start, x (Physical + Magic Defense). */
    SHELL_WARD_BARRIER: 0.3,
    /** Its life: ticked on the ally's own turns, so 2 is until the end of the ally's next turn. */
    SHELL_WARD_TURNS: 2,
    /** Searing Light (Firefly): Defense Down, both defences, that Glowmote's bolt lays, in points. */
    SEARING_LIGHT_DEFENSE_DOWN: 5,
    /** Its life on the enemy: 2 is through the enemy's next turn. */
    SEARING_LIGHT_TURNS: 2,
    /**
     * Reaping Stride (Mantis): the free step after a Twin Reap that struck, per rung.
     * Once a turn, whatever grants the Mantis another action in it; the last entry
     * is the hard ceiling on the step.
     */
    REAPING_STRIDE_STEP: [1, 2, 3] as const,
  },
  // Advanced (level 21–25): Champion
  ADVANCED_CHAMPION: {
    /** Rallying Taunt: hexes from the Bulwark an ally may stand and still be steadied. */
    RALLY_REACH: 2,
    /** Rallying Taunt: Defense each steadied ally gains, at rank two (3 / 4 / 5). */
    RALLY_DEFENSE: 4,
    /** Rallying Taunt: the buff's duration. "A turn" is spelled 2 (see `healGrantsDefense`). */
    RALLY_TURNS: 2,
    /** Red Mist: the share of max health at or below which it holds. */
    RED_MIST_AT: 0.5,
    /** Red Mist: critical chance (percentage points) while it holds, at rank two (9 / 12 / 15). */
    RED_MIST_CRIT: 12,
    /** Dropped Guard (level 26): extra share of every direct hit an enemy under the Taunt takes, at rank two (6 / 8 / 10%). */
    DROPPED_GUARD_EXPOSURE: 0.08,
    /** Carrying Word (level 26): the next most wounded ally's share of Smite's spilled heal, at rank two (45 / 60 / 75%). */
    CARRYING_WORD_SHARE: 0.6,
    /** Bottomless Thirst (level 26): Bloodthirst's bonus as health nears zero, at rank two (30 / 40 / 50%). */
    BOTTOMLESS_THIRST_BONUS: 0.4,
  },
  // Level 26: Arcanist
  ARCANIST_ROW_TWO: {
    /** Brimming Over: the share of Burn past the ceiling that spills, at rank two (45 / 60 / 75%). */
    BURN_OVERFLOW_SHARE: 0.6,
    /** Brimming Over: hexes from the target a spilled Burn may land. */
    BURN_OVERFLOW_REACH: 2,
    /** Flying Shards: each shard, in Magic, at rank two (0.3 / 0.4 / 0.5). */
    SHARD_MAGIC: 0.4,
    /** Flying Shards: hexes from the broken ice a shard flies. */
    SHARD_REACH: 1,
    /** Flying Shards: the Chill a shard lays, its speed and its ticks. */
    SHARD_CHILL: 3,
    SHARD_CHILL_TURNS: 2,
    /** Forked Current: the second hop, as a share of the first jump, at rank two (45 / 60 / 75%). */
    SECOND_HOP_SHARE: 0.6,
  },
  // Advanced (level 21–25): Hunter
  ADVANCED_HUNTER: {
    /** Eagle Eye: critical chance (points) against an enemy the Marksman has Marked, at rank two (11 / 15 / 19). */
    EAGLE_EYE_CRIT: 15,
    /** Open Seams: critical chance (points) against an enemy carrying the Skirmisher's blades, at rank two (9 / 12 / 15). */
    OPEN_SEAMS_CRIT: 12,
    /** Unseen Blade: critical chance (points) while Stealthed, at rank two (19 / 25 / 31). */
    UNSEEN_BLADE_CRIT: 25,
    /** Next Quarry: how far from the corpse a Mark can pass, in hexes, per rung. */
    NEXT_QUARRY_REACH: [2, 3, 4] as const,
    /** Next Quarry: the fewest turns a passed Mark stands for, whatever it had left. */
    NEXT_QUARRY_MIN_TURNS: 2,
    /** Buried Steel: blades past `BLADES_CAP` in one enemy, at rank two (6 / 7 / 8 in all). */
    BURIED_STEEL_CAP_BONUS: 2,
    /** Into the Dark: turns a kill brings Shadowstep's cooldown forward, per rung. */
    INTO_THE_DARK_TURNS: [1, 2, 3] as const,
  },
  /**
   * The tactical AI (`systems/combat/tacticalAI.ts`), which plays the PvP rival. Every weight is in
   * shares of a side's maximum health, the unit its health change is counted in.
   */
  TACTICAL_AI: {
    /** A foe killed, and an ally lost, on top of the health. */
    KILL: 0.15,
    DEATH: 0.25,
    /** Control landed on a foe, times its hardest blow as a share of the side's health (at most 1). */
    CONTROL: 0.6,
    /** The danger an ally stands in (what foes could land on its hex next turn), by role. */
    DANGER: { tank: 0.25, melee: 0.6, ranged: 0.8, healer: 0.8 },
    /** What the decider could strike next turn from where it ends, as a share of the foes' health. */
    OPPORTUNITY: 0.5,
    /** Per hex between the decider and the nearest foe while nothing is in its reach. */
    APPROACH: 0.004,
    /** Damage to a foe's objective (an anchor, a crystal), times the share of its own health taken; its fall adds KILL. */
    OBJECTIVE: 0.1,
    /** Per ally a foe's open warning names, so a step out of it (or a break of it) is weighed before the lookahead. */
    WARNED: 0.5,
    /**
     * A carried burst (the Emerald Dragon's Furnace Heart) on an ally the next burn and his Claw could fell
     * together: its burst at once on their hex comes on top of their death, so a pass is weighed before the
     * lookahead.
     */
    CARRIER_FALLS: 0.4,
    TANK_FRONT: 0.04,
    MELEE_EXPOSED: 0.04,
    /** Per hex a ranged hero stands inside three of the nearest foe. */
    RANGED_CLOSE: 0.02,
    HEALER_REACH: 0.03,
    HEALER_FRONT: 0.03,
    /** A decision stops weighing turns after this long and takes the best found so far. */
    MAX_MS: 2500,
    /**
     * Each level: how many of its own turns ahead the best `shortlist` turns are played (0: none),
     * over how many `scenarios`; the chance of taking the second or third best (`slip`); the chance
     * of ignoring danger for a turn; how much a wounded foe's health counts extra (`focus`).
     */
    LEVELS: {
      easy: { ownTurns: 0, shortlist: 0, scenarios: 0, slip: 0.35, ignoreDanger: 0.5, focus: 0 },
      normal: { ownTurns: 1, shortlist: 6, scenarios: 2, slip: 0.1, ignoreDanger: 0, focus: 0.5 },
      hard: { ownTurns: 2, shortlist: 10, scenarios: 3, slip: 0, ignoreDanger: 0, focus: 1 },
    },
  },
} as const;
