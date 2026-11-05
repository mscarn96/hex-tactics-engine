# Combat rules and presentation

Current implementation notes and decision rationale for work in this area. Start with the relevant procedure in the reference index when one exists.

## Campaign difficulty

`RunDifficulty` is distinct from the encounter generator's `DifficultyTier`. Medium is always
the base balance and the default campaign choice. `BALANCE.RUN_DIFFICULTY` applies Easy ×0.75,
Medium ×1, Hard ×1.25 to enemy max HP and damage dealt. Hero stats, loot, XP, defence, movement,
enemy attack and magic stay at the base balance.

`BALANCE.ENEMY_STRENGTH` (HP ×1.1, damage ×1.1 since the playtest of 2026-10-30: villages,
merchants and the new quests had made the party stronger and the world easy) multiplies every
difficulty's factors in `runDifficulty.difficultyMultipliers`, the one funnel every hostile unit's
HP and finished damage passes — regular enemies, elites, bosses, enemy summons, the castle and the
siege. It is the single knob for the whole world's strength. **The home ring is spared**
(`runDifficulty.sparesStrength`: band 0, never the castle or the siege): `buildEncounter` builds such a
fight's bodies with `CombatUnit.sparedStrength`, which its waves, summons and called reinforcements
inherit, so the first fights stay the tutorial `homeRing.test.ts` holds them to (the starting Arcanist
lasted 5.6 rounds against two Footpads at ×1.1, under its 6). The difficulty menu still quotes each
difficulty against Medium (`runDifficultyDisplay`), and the code that recovers a unit's
pre-difficulty scale from its HP divides both out. A test's hand-built foe (`fixtures.makeUnit`) is
spared by default, so rule suites measure the base balance; `runDifficulty.test.ts` measures the dial.
Measured on adoption: a full legendary level-20 party took the four-stage castle at tier 1 in 3 of
seeds 1–7 at ×1 and 1 of 7 at ×1.1 (`runBalanceFight`, dodging AI).

HP is rounded after level/encounter scaling in `scaleEnemyStats`; enemy summons and transformed
summon stages receive the same HP modifier. Player summons stay unchanged. Boss/elite paths that
inherit the exact pre-difficulty level/encounter scale from `CombatUnit.enemyStatScale`, avoiding
rounded-HP drift in summon attack, defence or a second HP bonus. Hand-built harness units without
that field fall back to recovering strength from HP with the difficulty modifier divided out.

Damage scales after defence, with a minimum of one for a positive hit. `calculateDamage` supplies
the modified strike to both resolution and AI estimates; those callers mark it already scaled at
`damageUnit`. Enemy fixed damage, passive damage, reflected damage, damaging ground, death bursts,
Freeze shattering, damage-over-time and Doom are covered. DoT/Doom use their recorded source, even
after it dies. Healing, authorless environmental damage and self-costs are unchanged. Shock jumps
derive from an already modified blow and do not receive the modifier a second time.

**Prepared attacks keep their authored warning and counterplay description** in combat inspection
and the Bestiary. Their resolver uses a warned footprint, which cannot always be inferred from
the skill's generic target type, range or radius (Crownfall marks the arena edge; Foreclosure
uses placed seals). Shared stat/effect lines still state power, timing and statuses.

**A skill's description states the attacker's half of `calculateDamage`.** `skillDamagePreview(attacker,
skill)` is effective power (buffs, form, passives) × the skill's multiplier × the mastery shape bonus, plus
a blessing, then Overload, Fury and the Duel edge, rounded and floored and put through `difficultyDamage` —
the same calls in the same order, with every term that reads the target (defence, Mark, `bonusVs`,
detonation, Exposed, the mastery's target-state bonuses) left out. It therefore equals the cast against a
target with no defence and nothing on it, which `skillPreview.test.ts` checks for every plain damage skill
at every difficulty; crits are never in it. `strikeShare` is the one rounding of a dual-wield hand, a Rapid
Fire arrow or a Flurry blade, shared with `resolveAttack`.

Hardcore is available only on Hard. When every participating hero is down, the save is permanently
erased before the final run-over summary appears, anywhere the fight occurs. A surviving summon
does not prevent loss; an individual fallen hero remains revivable. The save ordering and terminal
marker are described in architecture.

`node scripts/difficulty-audit.mjs` measures seeded AI-vs-AI win rates at every difficulty using
the real combat pipeline. The feature record
holds the measurements and landscape-phone browser verification.

## Combat

Barracks levels 1–3 add pre-turn deployment planning to all encounter routes. combatStore’s
optional deployment plan freezes turn-start processing and AI until confirmed, preserving initiative
and action flags. Legal placements, swaps and level privileges live in systems/combat/deployment.ts.
While the plan is open the camera frames its placement area (`followAttack(deployment.area)`) rather
than the first unit to act, which left the party off screen when an enemy opened (playtest
2026-10-24); confirming hands the camera to the active unit. See [city service rules](quests-progression-items.md#city-buildings-distinct-roles).

`combatStore` holds `units`, a speed-sorted `turnOrder`, and `phase` (`CombatPhase`:
PlayerSelect/PlayerMove/PlayerTarget/EnemyTurn/Victory/Defeat). Rules live in
the engine modules (`targeting.ts` targeting shapes, `facing.ts` facing and flanks, `arenaGeometry.ts` arena bounds via `inArena`, `movement.ts` movement range,
`forcedMovement.ts` shoves and self-move, `unitLookup.ts`, `unitFactory.ts`, `effectiveStats.ts`; `combatEngine.ts` was split into these) and `systems/combat/damageCalc.ts`; `systems/combat/enemyAI.ts` scores skills and drives enemy turns.

- **One resolver casts for every unit.** `resolveSkillUse` (`skillResolution.ts`) resolves a hero's cast, an
  enemy's cast and the tuning sim's casts alike. `executeAIActions(enemy, actions, sink?, { rng? })` is a loop of
  move-or-cast: a `skill` action goes first to `enemyScripts.castScriptedSkill`, which owns the boss and elite
  signature moves (the Emperor's, Troll's, Dragon's and Heart's scripts, Ground Slam, Undermine, Twin Raid, the
  Jarl's Challenge, Glacial Tomb) and answers `false` for any ordinary skill, and otherwise to `resolveSkillUse`,
  then marks the unit acted, advances its script step and runs `afterEliteCast` / `afterEliteStrike`. Everything
  the old enemy strike loop skipped therefore reaches an enemy: Overload and other on-cast passives, the crit that
  crit-reading passives need, the flank and backstab, strike scale and armour penetration, healing, a leaping dash, and the
  dodge word. Do not add a rule to one side; add it to the resolver.
- **One sink, one dice source.** `CombatSink` (`combatSink.ts`, a leaf module) is the only feedback type: the
  resolver, the executor, `beginTurn`, a warned strike landing and every boss script report through it, and
  `SILENT_SINK` is the headless adapter. `EventSink` (`combatEvents`) and `BossFx` (`bossActions`) are narrowed
  views of it, so a sink is passed straight in. `float` takes a hex and a word, so a blow is `-N`, or `-N!` for a
  crit; there is no separate damage callback. Every roll (dodge, crit, status chance, passive proc,
  poison and death-burst crits, random strikes) draws from `systems/combat/dice`: `Math.random` unless
  `ResolveOptions.rng` or `executeAIActions`'s `rng` pins it for the call, or `setDice` pins it outright. Suites
  pin it with `spyDice()` (`__tests__/support/dice.ts`) rather than spying on `Math.random`; `singleResolver.test.ts`
  pins that a fixed rng gives the same fight whichever side casts. The tuning harnesses seed by replacing
  `Math.random`, which still works because the dice look it up on every roll.
- **Combat text has a length limit** (`data/display/combatText.ts`, `COMBAT_TEXT`; playtest 2026-10-17, PT-08,
  after Iron Carapace floated "soaks it in its carapace"). A floating word (`float`, `status`, a `TickEvent`'s
  `text`) and a status name (`statusName`, in every language) are at most **16 characters**, about three hexes of the arena's
  pixel font, so it reads over one body at 844x390; a log line is at most **64** (one line of the full log). A
  `${…}` counts 3 characters in a float (a number) and 10 in a log line (a name). A `TickEvent` whose float
  would say too little carries its sentence in `log` ("Carapace soak" floats, "soaks the blow in its carapace"
  is logged); every log site reads `ev.log ?? ev.text`. `combatTextLength.test.ts` walks every literal in
  `combatStore` and `systems/combat` and every status label; words built from data at run time (a skill
  name, a joined list) are not walked. Text read as `t('combatLog.…')` is measured as its catalog entry in
  every language, and the `combatLog` catalog is held whole by key prefix (`float.*` to the float limit,
  `log.*` and `tick.*`, a `TickEvent` predicate, to the log limit). The words are looked up as the event
  happens, in the current language; a line already in the log keeps its language.
- **One damage funnel, one list of what dying means** (`systems/combat/damageFunnel.ts`, tier A: imported by
  the store, so it never imports it). `takeDamage(state, unitId, amount, attackerId, options)` is pure — state in,
  a patch and a `DamageReport` out — and holds every rule that decides how much a unit loses, in this order:
  difficulty, the objectives' share, Second Spring, the ice's shatter, Last Stand (`reduceIncoming`), the
  Reckoning, the Barrier, the lethal save, the HP write (with the Undying floor), the Freeze strip, Pain Feast
  and the boss damage counters. Last Stand, the Reckoning, the Barrier and the lethal save are read nowhere
  else (`damageFunnel.test.ts` scans for it). `damageUnit(host, …)` is `takeDamage` plus `settleDamage`, which
  runs what a blow sets in motion in a fixed order: Second Skin strips the shape **before** the save's heal (the
  shape's drop shrinks `combatMaxHp`), the save's outcomes, the Revenant's break, the phase check, then the
  death list, Winter Sleep's frost, Rubble Recovery and Stone's Answer, Pain Feast's announcement and a broken Reckoning's
  shockwave. The host is the store passed in (`FunnelHost`), narrowed to the operations the funnel calls;
  `combatStore.damageUnit` is a one-line wrapper over it. The store's `host` is the only place the
  store and the funnel meet, which also removed the inline copy of `applyPassiveOutcomes` the lethal save
  used to need (the funnel applies the two kinds a save can produce, a status and a heal).
- **`resolveDeath` is the one list of what dying means**: the summon's parting blast, a Captain's word lifting
  from his warband, the dead unit's open warnings and seeds (`retireOwned`), a duel dissolving, Spark and
  Venom Transfer, and an objective's fall reaching its owner (effects, the cancelled warning, a backlash, the
  Heart's release, a soul fragment settling, a tomb breaking). It runs for a blow, a tick, ground crossed, a
  self-cost and a summon's clock running out alike (`combatStore.resolveDeath` is for the last, whose HP is
  written directly by `tickSummonLifetime`); every consequence latches or finds nothing the second time, so
  calling it on a unit that may already have died is safe. `deathTable.test.ts` is the proof that no path
  skips a consequence.
- **A tick dose is a funnel call with `fromTick`.** It takes the funnel's Last Stand, Reckoning, Barrier and
  lethal-save arithmetic, so a Burn tick through a Barrier gives the numbers a strike of that size does
  (`damageFunnel.test.ts`), and none of the rest of a blow: no shatter, no Freeze strip, no objectives' share,
  no Second Spring. A save in a tick now pays out like one a blow caught (the Revenant breaks, Second Skin
  strips the shape) — only Undying's used to.
- **A unit a tick killed stays dead.** Each effect in the tick reads whether the unit is still alive before it
  acts, so a Regen (and its Last Bloom) or a Winter Sleep's wake listed after the killing dose does nothing:
  no HP, no float, no healing credited. The list is still walked in order, so a heal listed *before* a dose
  lands first and can carry the unit through a dose that would otherwise have killed it. Pinned by
  `statusEffects.test.ts`.
- **A Poison, Bleed or Burn tick meets half a defence** (playtest 2026-10-21; they used to ignore it).
  `damageCalc.dotDefenceFactor` takes `BALANCE.DOT_DEF_SHARE` (0.5) of the ordinary `defenceReduction`: a
  Bleed against Physical Defense, a Burn or a Poison against Magic Defense, measured against the larger of the
  source's Attack and Magic (less its matching penetration), or as an even match (power = the defence) when
  the source has left the board. The tick is rounded with a floor of 1, then the campaign difficulty applies.
  Doom is not a tick and still ignores defence. Tooltip numbers stay "what lands on a target with no defence",
  as a blow's do. `dotDefence.test.ts` pins it.
- **A tick is credited to whoever laid it** in the battle report (`effect.sourceUnitId`), when that unit is
  still on the board or already has a report row; otherwise it falls back to the side's pooled DoT row
  (`DOT_PLAYER_STATS_ID` / `DOT_ENEMY_STATS_ID`). Each tick also adds to the author's `dotDealt`, a subset of
  `damageDealt` the report does not show and `monkMeasure.partyDot` reads. Doom is still credited to nobody.
  A sourceless re-application of a status keeps the author it replaces (`mergeEffect`).
- **A fight is opened and closed by `systems/combat`, not by the scene.** `encounterTerms(id, ground)`
  (`encounterSetup.ts`) is the band, the depth, the haunted flag and the chest-guard rule, from the tile, the party's
  hex and the city and castle coordinates the scene reads off the world. `encounterPowerScale` is the one
  multiplier layered on the level scaling, in a fixed order that never overlaps: a castle stage (its tier's, even in the harness, whose castle chain is a
  real run), the harness's own, a siege week, then the ground (times the chest premium for a chest's guards). Enemy display levels compress the
  combined party/encounter power into rounded 1–25 labels (readout calibration); this never feeds
  back into stat or summon scaling. Beyond the Empire an enemy reads the fight's content level instead (21–40), nudged by its
  template's strength (`enemyContentLevel`, a level per doubling, at most two either way), and what it calls up reads the same. `buildEncounter(ctx)` is the init
  effect's rules — the plan (or the committed snapshot, copied), the positions, the bodies, the waves and the banner;
  the scene's effect only writes the result into the stores. `applyVictory(reward, ctx)` banks a win (XP, health out
  of the animal's pool, the carried shape, the castle stage's patch-up, the Seal, the loot, the hunt and quest
  reports, the map marks) and returns `null` when the fight was already paid; `applyDefeat(penalties, ctx)` takes
  the bag, the gold and a castle run, razes the city on a lost siege, and carries the party home whole. The scene
  keeps its setters and the transition (`encounterTerms` and `encounterPowerScale` are tested in `curatedBand.test.ts`;
  `encounterSetup.test.ts` and `encounterResolution.test.ts` open and close a fight without rendering).
- **One picture clock** (`components/combat/stage.ts`, pure TypeScript, no React and no store). `createCombatStage(clock, outputs)`
  owns time: the horizon (when everything being shown will have landed), the base every channel of its sink adds to its
  delay, the float queue, the sound schedule, the health timeline and every wait. `stage.action(impactMs, run, { refused })`
  is the composition that was written out three times — set the base, begin the timeline, raise the horizon, run the rules
  through `stage.sink`, always put the base back, and restore the horizon for a refused cast — and the hero's cast, the
  enemy's turn and the warned strike at a turn's start (`sink.lands` with `endTurnScope`) all use it. Waits are
  `stage.after`, hand-overs `stage.handOver` (turn flow arrives as `outputs.turn`), a tap is `stage.hurry` (never shorter than
  the impact still landing), a boss's phase beat `holdForBeat`/`beatAfterPicture`/`releaseTap`, and `reset` clears every timer on unmount and
  on a castle stage's re-init. The arena binds the two things only it can do (project a hex, spawn a picture, cast on
  press) through `stage.bindArena`; `CombatArena` takes one `stage` prop. `useStageHealth` is the store subscription that
  feeds `stage.health`. `stage.test.ts` drives it with a fake clock: a status after its number on one hex, an enemy
  waiting for the last impact, a hurry never ending a wait early, a refused cast restoring the horizon. `vfx/impact.specBeats`
  is the one beat schedule of a spec (prelude, swing, main, recoil, aftermath) that `VfxLayer` and the stage's scene read.
- **A new boss is one file** (`systems/combat/scripts/`). `EncounterScript` (`encounterScript.ts`) names the shape every
  boss and elite shared by convention: optional hooks `decide`, `cast`, `betweenTurns`, `beginTurn`, `turnTick`, `land`,
  `beforeLanding`, `afterLanding` and `afterCast`, each answering for itself whether the unit, skill or warning is its own
  (`turnTick` runs for every unit as its regular turn begins, after its statuses tick and before it is known whether
  it may act: the Furnace Heart's burn).
  The six adapters (`aethelred`, `troll`, `dragon`, `heart`, `elites`, `factionElites`) are listed once in
  `scriptRegistry.ts`, in the order the old ladders ran, and the registry walks them once per hook point: `decide` and
  `cast` and `land` stop at the first script that takes it, `beforeLanding` chains (the Troll's leap, then the Burrowmother's
  burrow, then the Colossus's tomb), `afterLanding` and `beginTurn` run for all; `afterLanding` is handed the preview the
  landing was struck by (`held`), so a script can read who was braced and against what. A warned attack goes **land, else
  before-hooks and the ordinary resolver, then after-hooks** (`encounterScript.test.ts` pins it). `enemyAI`, `turnStart`,
  `preparedResolve`, `combatStore`, the resolver and the scene name no boss.
- **A paid cast is answered by cast rules** (`castRules.ts`, `CastRule` in `encounterScript.ts`): the resolver calls
  `castPaid(caster, skill, struck, sink)` once wherever a cast is paid for — the end of an ordinary cast, a Spirit Hunt,
  Marked Prey's release, and a warning's announcement — and every rule in `CAST_RULES` answers what it laid on the caster:
  Aethelred's (`bossActions.aethelredCast`: a Foreclosure seal under the caster, then a Writ) and then the Crone's
  (`eliteWarnings.geasCast`: the Geas). It is not an `EncounterScript` hook because the scripts land their warnings
  through the resolver, so the resolver cannot import their registry; a cast rule lives in the encounter's
  store-writing module, which never casts through the resolver. A Reaction set, a shift and the other early exits of
  `resolveCast` are not paid casts, as before.
- **Every boss is one entry in the boss registry** (`bossRegistry.ts`, `BOSSES`): the pure half the store may import (it
  cannot import the scripts, which import it). A `Boss` entry carries its template id, the id of the `EncounterScript` that
  plays it (`script`; the Jorogumo's is the shared `yokai` script), who it is (`is`), its starting script state, its
  opening arrangement (the Heart's anchors, the weaver's perch and threads, Kairen's summit start), what it writes when a
  hero is healed or shielded (Tithe on Mercy, as data: `ScriptWrite`), what a unit's step voids (`onStep`: the Writ),
  what it writes when a warning is broken (`onBroken`: the Dragon's quench), what a new phase keeps and sheds (`onPhase`:
  the Emperor's `legionResponded` and orb charges, the weaver's `Suspended`, Kairen's memory and `Aloft`; everyone
  else's counters are cleared), whether it owes itself an extra action (the Troll's Fury), its briefing's point counts
  and its **readout**. The store asks `scriptStateFor`, `arrangeOpening`, `grantsExtraAction`, `mercyWrites`,
  `stepVoids` (`markMoved`), `brokenWrites` (`removePreparedAttack(id, 'broken')`) and `intoNewPhase`
  (`enterPendingPhase`), and applies a boss's `ScriptWrite`s in one place; the scene asks `bossReadout` (the panel and the banner) and `bossChains` (the
  board) once each and never branches on a boss. **The readout is values, not words**: summary facts (the Troll's Fury
  and next move, the Heart's restraints, Kairen's tier, weather and opening), gauge facts (orb, seals, cooling moves,
  heat, regeneration, facing) and the Last Lesson's standing lessons, worded by the HUD from the catalog
  (`components/combat/hud/bossReadoutText.ts`) at render. **The registry counts each boss's regular turn** once, after its
  script's own `beginTurn` has read the counters as they stood (`turnBegun`, run by `scriptRegistry.beginTurn`):
  `phaseTurns` and `unharmedRounds` go up by one for every boss. `bossRegistry.test.ts` holds every boss template to an
  entry with a registered script, a clean starting state, a readout made of values and one count per turn.
  `BossScriptState` is the common `step`, `phaseTurns`, `unharmedRounds` and `lastUsed`; the Emperor's counters are
  `LegionScriptState`, read through `bossScript.legionOf` (save version 51). Aethelred's and the Troll's scripted casts
  settle the same way (`scripts/rotationCast.settleRotationCast`: acted, and the rotation step written).
- **Aiming is a pure step** (`aimSteps.aimStep`). `aimStep(state, event, board) → { state, effects }` takes an `AimEvent`
  (`press` a skill, `tap` a hex, `cancel`), the aim in progress (`AimState`: an area's aimed hex and the rampart's
  rocks) and the world it reads fresh (`AimBoard`), and answers the next state plus an ordered list of effects (`toast`,
  `log`, `select`, `highlight`, `phase`, `modePrompt`, `rangeFlash`, `removeTaunt`, `cast`). It covers the rampart's three
  taps, an area's two (the first shows the footprint, another hex moves the aim, the same hex casts), the press that
  casts at once (`castsOnPress`) and the Taunt's refusals, whose wording is one function (`tauntRefusal`). Whether a
  Taunt bars a skill is one rule too (`tauntBars`, PT-02): an area skill is barred, any other skill unless the living
  taunter's hex is among its valid targets (so a self-buff is barred), and a dead taunter bars nothing. The press
  refuses with it, the skill bar dims what it bars, and the skill inspector's reason line gives the same refusal
  ("Taunted by X — this skill can't reach them"); Move and End Turn stay free. It is not in the `cooldowns` guards,
  which the AI and the simulator call without a board. The scene's
  `dispatchAim` builds the board from the stores and interprets the effects; `handleSkillSelect`, `handleCancelAim` and
  the arena's target-phase tap are one-line callers, and a cast goes through `stage.castNow`. `aimSteps.test.ts`
  drives the sequences with no React.
- **Win rates across the unification (2026-10-10).** `scripts/difficulty-audit.mjs`, seeded, 100 runs per
  matchup and difficulty, before and after: every matchup keeps its win rate (starter vs bandits 100%, the
  unequipped level-8 party vs the patrol and the legion 0%) and its length stays within a turn (e.g. starter vs
  bandits, 12.5 / 15.3 / 19.9 turns on easy / medium / hard on both sides). A wider set of four mid-range matchups
  at 150 runs (party vs arcanist 1.00 / 0.97 / 0.01, duo vs footpads 1.00 on all three) moved by under 0.2 turns
  and not at all in win rate. Heroes in the sim now cast through the real resolver, so flanking and charged
  casts count for them too; the effect is below what these matchups can resolve.

- **How many taps a skill takes** is decided by `systems/combat/aimSteps.ts` (PT-10, pinned by
  `aimSteps.test.ts`):
  - **None** — a skill that can only be aimed at its caster (`Self`, a range-0 `Ring` such as
    Whirlwind, or `arenaWide`) is cast by its button, after any Mercy/Wrath choice, when
    `getValidSkillTargetHexes` offers exactly the caster's hex (`castsOnPress`). Taunt and the "nothing to
    hit" refusals answer the press as before; a refused cast leaves the action bar as it was. A range-0
    ring that harms nobody (`targeting.selfRingIsDefensive`: a Barrier or heal ring such as Shell Wall, or a
    Bastion) is offered with no enemy in reach; a striking ring still needs one (PT-06, 2026-10-22).
  - **Two** — an area aimed at a hex (`aimFootprint`: anything but `Single` or caster-only
    whose footprint at the aim — for `randomEnemies` the whole `aoeRadius` area round the aim — read from the occupied variant and from a self-move's
    landing as the resolver reads it, is more than one hex). The first tap on a valid hex aims it and
    draws the footprint; the aim bar says "Tap again to cast", and so does an info toast, because on
    a short phone the skill card covers the aim bar's hint. The same hex again casts; another
    valid hex moves the aim; Cancel, a new phase, skill or acting unit drops it. The aimed hex is
    `aimCentre` in `CombatScene`, handed to the arena.
  - **One** — everything else, single targets, Lay on Hands and dashes onto one body included.
    Rampart pairs keep their own anchor-then-neighbour flow.
  - The footprint's colours come from `footprintSides`, on the split `skillTargetKind` reads and the
    resolver applies: enemies a harmful skill covers in attack red, allies a helpful one covers in
    support green, and everything else it covers (ground, an attack's allies, a blessing's enemies) in
    the skill's colour at the `area` look. The aimed hex carries a reticle (`AimCentreRing`): a thick
    pulsing band, a bright pip and a ping swelling out to the tile's rim, because a thin inner ring
    was lost among the footprint's outlines at phone size (PT-03). While an aim is held the footprint
    is the only thing lit: the skill's dim reach and the other aimable hexes are not drawn (PT-02 —
    they read as a fainter second footprint). They stay tappable, since the tap handler reads the
    store's `highlightedHexes`, so another valid hex still moves the aim.
  - The visual-baseline harness's `cast` taps an area's hex twice.
- **A tap on a body is a tap on its hex** (PT-06, 2026-10-22). The board's floor tiles were the only tap
  targets, and at the landscape camera's pitch a unit's body covers the tile behind it, so a finger on an
  ally's chest landed on an unlit tile ("invalid target"). `arena/UnitTapTargets` stands an invisible
  (`visible={false}`; three's raycaster ignores visibility) upright cylinder of radius 0.42 and the model's
  crown height on every living unit; its `onClick` stops propagation and calls the same `handleHexTap`
  with the unit's hex. Not yet checked on a phone.
- **A Reaction pressed with every slot standing is refused at the press** (PT-06): the `reaction` guard in
  `cooldowns.GUARDS` (previewed, not `refusesCast`) reads the board's `PreparedReaction`s against
  `beetle.reactionLimit`, so the button dims and the inspector says "Already holding a Reaction", and
  `aimStep`'s press answers the same toast (the board carries `AimBoard.reactions`). A cast the resolver
  still refuses as `unusable` now toasts its reason rather than failing silently.
- One action per turn: both the move handler and `executeSkill` in `CombatScene` end in
  `handOverTurn`, which calls `nextTurn()` once the action's picture has finished — see *A fight
  is paced by its picture* below.
- **A move walks a route; it does not pass through bodies** (playtest 2026-10-09). `getMovementRange`
  offers a hex only when a hex-to-hex route to it fits the move budget (`walkSearch`): every other
  living body, ally or enemy, and every solid hazard (rubble) is impassable, as are the arena edge
  and a duelist's rune circle, and frozen ground still costs its extra point to enter. A free hex
  behind a wall of bodies is out of reach for heroes and enemies alike, since the AI picks its walk
  from the same list. `findMovePath(unit, to, units, hazards)` returns the route (both ends), cheapest
  first, then the one over less hostile burning ground, then the one nearest the straight line; the
  player's move and `executeAIActions` hand it to `combatStore.moveUnit` (`movement.path`), so the
  walk is drawn along it, timed and heard by its length, and burned by what it crosses. A reposition
  cap (`repositionCap`) caps the budget. Dashes, blinks, leaps and shoves do not path: they keep their
  own rules below. Tests: `pathfoundMovement.test.ts`.
- `currentUnitId` tracks the active unit **by id, not by index** — summons splice into `turnOrder`
  mid-fight and an index would silently hand the turn to someone else.
- `turnOrder` is sorted once at init and **never re-sorted**, so a mid-fight `speed` change does
  nothing. Speed still matters through bonus turns (*Turn tempo* below), which sit on top of the
  fixed order rather than reordering it.
- `getCombatEffectiveStats(unit)` layers Wildshape form multipliers, `ActiveEffect` buffs and
  passive stat mods over `unit.stats`, then floors at zero. Always use it in damage/heal math —
  and in anything else that reads a stat, including movement range.
- **`hero.baseStats.maxHp` is the body; `heroMaxHp(hero)` is the bar.** Combat runs on
  `getEffectiveStats`, so a hero in +HP gear has a ceiling `baseStats` has never heard of — and
  every ceiling in `partyStore` used to read the smaller one. The dawn heal, the magic well, the
  post-fight write-back and the level-up top-up all capped below full, by exactly the gear's worth,
  and the party HP bar drew the same wrong denominator. Anything clamping or filling health or mana
  goes through `heroMaxHp` / `heroMaxMana`. (Inside combat the equivalent is `combatMaxHp`, which
  additionally knows about Wildshape vigor.) Pinned by `heroHp.test.ts`.
- Status effects are `AuraType | AfflictionType` with a `duration` (`-1`/`99` = permanent).
  `tickEffectsOnUnit` (`systems/combat/effectTick.ts`) folds HP/mana/effect changes over a private copy
  of the state and writes the unit once — keep it that way, intermediate `set()` calls cause dropped
  updates. Its damage doses are `takeDamage` calls (see the damage funnel below); what it adds is the
  status sequence, healing, mana, the duration countdown and the one write.
- **An affliction authored at `duration: 1` does nothing at all, and this has bitten three times.**
  Effects tick at the *start* of the victim's turn and the tick decrements before it acts, so a 1 is
  removed on the way in — the badge appears, the log says it landed, and the target moves freely.
  Stun escapes it only because `beginTurn` reads `wasStunned` **pre**-tick; nothing else can, because
  `isRooted` and its siblings are queried live from `getMovementRange` and the HUD. It is the same
  trap the Doom note below records. The three: `thorn_lash` (the Druid's level-1 at-will then, so
  every Druid in the game saw it), `cyclone`, and Aethelred's `total_assessment` — the final boss's
  signature control, silencing for zero turns for its entire existence while its own comment read
  "Silence for exactly one turn". **"Exactly one turn" is spelled `2`.**
  `__tests__/combat/rootDuration.test.ts` sweeps every skill the game fields and fails any Root or
  Silence at 1; the rule is the deliverable, the durations get retuned.
- **Silence spares the Basic Attack** (playtest 2026-10-21, PT-19). A silenced unit can move and Basic Attack
  but uses no other skill (`cooldowns.silenceBars`, the one guard the HUD, the resolver and the AI share). The
  AI driving a silenced unit that carries a Basic Attack chooses among that alone; an enemy, which carries
  none, strikes with its fallback Basic Attack (below) if a foe is in reach and otherwise repositions.
- **An enemy never passes a turn it could strike in** (playtest 2026-10-23: taunted elites of area skills
  skipped their turns). `enemyBasicAttack.fallbackBasicAttack` builds a Basic Attack off the unit's kit —
  never stored on it — when it carries none: a magic bolt if most of its damaging skills scale on Magic,
  `ENEMY_BASIC_ATTACK_RANGED_REACH` (3) when every single-target blow in its kit reaches that far, one hex
  otherwise, at `ENEMY_BASIC_ATTACK_DAMAGE` (0.6×), under any authored blow. `decideEnemyAction` presses it
  only where the turn would otherwise do nothing: taunted with no non-area skill that reaches the taunter,
  silenced, or with no usable skill in reach (all cooling) and a foe in its reach — before walking. Scripted
  bosses keep their own decisions; faction elites fall through to these rules.
- **A lost turn is never acted on.** The scene starts a turn (`beginTurn`) and asks the AI for an action
  from two separate effects; the AI's timer goes through `turnStart.mayTakeAction`, which only allows a
  unit whose recorded verdict for this `turnSerial` is `act` (with `isActionLocked` — Stun, Freeze,
  Slumber, Kneeling, a Vanish wind-up — as the backstop when no verdict was recorded). Before it, a
  sleeping Cave Bear, and anything on the last turn of a stun (already ticked off), swung while its turn
  was being handed on. Pinned by `turnGate.test.ts`.
- **An impaired turn says so as it begins** (playtest 2026-10-22, PT-02b). A turn that reaches `act`, regular or
  bonus, ends its start with `turnStart.remindImpairments`: Taunt (only while `activeTaunt` finds a living
  taunter), Root and Silence each float their status name over the unit in the status colour and add a log
  line ("X is taunted by Y", `combatLog.log.impaired` for the rest). It runs for enemies too. Writ and Geas
  are charges on the next cast, not limits on the turn, and are not reminded. A lost turn (Stun, Freeze,
  Slumber, Kneeling) keeps its toast and also floats the status that took it. Pinned by
  `impairmentReminder.test.ts`.
- **The AI does not spend a control cooldown on bodies already held** (`enemyAI.controlWasted`, playtest
  2026-10-14). A cooldown skill applying Stun, Freeze, Root or Silence is not considered against a footprint
  whose every foe is already action-locked or already carries each control it applies, unless the cast kills
  somebody; it falls back to its other skills or a move. Each unit decides from the live board, so the
  second of a pair of Delve Breakers sees the first one's Stun and keeps its Cave-In. Pinned by
  `controlAwareAI.test.ts`.
- **A cast the resolver refuses is never the AI's whole turn** (playtest 2026-10-22, PT-14). When
  `resolveSkillUse` refuses an AI cast and the unit has neither moved nor acted, `executeAIActions` walks it
  where `chooseMoveTarget` wants it instead (`walkInsteadOfRefusedCast`). The scoring is meant to agree with
  the resolver, and this is the backstop for when it does not: the Bog Hulk's Mire Undertow was scored on the
  heroes its marsh would drag while nobody stood beside him, the slam struck nobody, the resolver refused it,
  and he stood still every turn the party waited two or three hexes off. Pinned by `eliteWarned.test.ts`.
- **The AI keeps its distance only for skills that reach from where it stands** (PvP playtest 2026-10-25).
  `chooseMoveTarget` classes a unit ranged, and sets its ideal distance, from its ready skills that deal damage
  or heal and either do not move the caster or are a `retreat` shot. A `dash`, `blink` or `free` move's range is
  how far the caster travels, and a mark strikes nobody: read off the whole kit, the AI-driven Shadowblade's
  Disengage, Shadowstep and Assassinate (range 20) held it nineteen hexes off the fight. The targeted branch of
  `evaluateSkill` scores a skill aimed at a foe through `skillVariantFor`, so Shadowstep is scored as its dash and
  poisoned strike rather than as a blink that reaches nobody.
  Pinned by `enemyPositioning.test.ts`.
- **`SkillEffect.chance` is how a rider stays a rider.** Thorn Lash is a no-cooldown at-will, so an
  always-applied Root at a working duration is a permanent single-target lock — the skill's own
  description ("sometimes takes root") was written against a chance that had never been built. The
  roll lives in `effectLands` in `statusEffects.ts`, called from both execution paths, rather than
  inside `combatEvents.applySkillStatus`: a miss must not mark the skill as having hit anything, or a
  legitimate `no-targets` refusal becomes a spent turn and a support target flashes for nothing.
- Damage order: `power × multiplier − defence × DEFENSE_MULTIPLIER` (the defence that matches the hit's
  type — see *Physical and magic damage*), then the flank or backstab / Mark /
  `bonusVs` / detonation multipliers, then crit, floored at `MIN_DAMAGE`.
- **Facing and flanks** (`systems/combat/facing.ts`, design in
  the Monk plan). Every unit with a front carries
  `CombatUnit.facing`, one of the six hex directions in `getNeighbors` order. It faces the centre of the
  living enemy side when the fight starts (`initCombat`), again when deployment is confirmed, and on
  arrival for a wave or summon that brings none (`addUnits`). A unit's own move (`moveUnit` with
  `voluntary`) turns it to the last step of its route; `setFacing` — called by an attack, a targeted skill
  and a Reaction answer — turns it to the nearest direction toward the hex, ties to the lower index.
  Forced movement (a shove, a drag, Escape Route: `voluntary` false) changes neither `facing` nor the
  drawn `facingAngle`. An objective has no facing and is never flanked. The resolver passes
  `flankOf(attacker, target)` to `resolveAttack`: an adjacent attacker on one of the target's three front
  hexes deals plain damage, on one of the two rear-side hexes `FLANK_MULTIPLIER`, on the back hex
  `BACKSTAB_MULTIPLIER`; a non-adjacent attacker never flanks, so ranged attacks are untouched. Heroes,
  enemies and bosses alike, through `resolveSkillUse` and the Druid's spirit hunt. The AI scores with
  `'front'` and does not seek flanks. This replaced the ally-opposite backstab (`isBackstab`, an ally on
  the hex directly opposite the attacker), which nothing on screen showed. The rule reads only `facing`;
  the drawn `facingAngle` is written with it as `directionAngle(facing)`, so the model looks along the
  rule's hex direction, never the exact aim between two (an objective, with no facing, still turns to the
  exact aim). A placed hero re-faces the enemy while deployment is laid out. `landingBehind` is the back-hex-else-
  rear-side landing for the blinks that go behind a target (the Mantis's Flicker Cut, Marked Prey and
  Mantis Execution). Pinned by `facing.test.ts`, which sweeps all six approach hexes after deployment, a
  move, an attack, a Reaction answer and a push.
- **Facing and flanks on screen** (`data/display/flankDisplay.ts`). Every unit with a front wears a
  chevron at its feet (`arena/FacingChevron.tsx`, its side's colour lifted toward white, on the rim of its
  hex, never raycast), mounted in the unit's turning group so it turns with the model. The rear of the
  units selected — the hero choosing its action, and a unit tapped to read — and of every lit enemy a
  damaging aim could flank (one beside the caster, or any the skill dashes or blinks to) is tinted by
  `FlankHexes`: the two side hexes lightly, the back hex strongly, in `highlight.flank`
  (`flankShownIds`/`flankTint` in `boardOverlays`; a hex that is one unit's back and another's side is a
  back). A landed blow from the side or back (`showFlank` in `skillResolution`, both struck-blow sites)
  floats `SIDE ×1.2` / `BACK ×1.5` on the status channel after its number, logs it, draws the `flank`
  effect on the struck unit and carries `flank` on its strike intent, which adds the `hit.flank` layer.
  **No skill's copy repeats the flank rule** (playtest 2026-10-17, PT-20): it fits almost every damage
  skill, so the clause melee Simple copy used to end with was noise; the tint, the float and the log show
  it. Pinned by `facingOnScreen.test.ts`.
  **The marks can be switched off** (PT-12, playtest 2026-10-17): Settings → Combat holds a
  Direction marks switch (`EffectsSettings.directionMarks`, a device preference, on by default) under
  one line saying what they mean — the arrows show where units face, the yellow hexes a unit's sides
  and back, where hits deal more. Off, `UnitMesh` drops the chevron and `CombatScene` the
  `FlankHexes` tint; the rule, the SIDE / BACK float, its effect and sound stay. The fuller
  explanation is the Handbook's Combat basics page, which the setting links (plan).
- Encounters are keyed by string id (`boss_N`, `quest_N`, `empire_siege_N`, `castle_T_S`,
  `random_danger`, else easy) decoded in `systems/world/encounterGenerator.ts`.
- **A threat band is not a location.** Band 3 is reached by distance from the *city* as well as by
  proximity to the castle, so on a 70×70 map it covers most of the far half. A faction that should
  only appear near the castle needs `Faction.castleRadius`, and callers must pass `fromCastle`.
- **Twelve factions.** The **Fenfolk** (swamp, bands 0–2) fill ground that had nobody below band 2,
  and were the first faction with all five roles native. **The Delve** (mountain and highlands,
  bands 1–4, band 4 at home only) are exiled miners, and exist because high ground became walkable. The **Ashwood Coven**
  gained a shooter and a second elite for a measured reason: with three members it produced *two*
  possible fights at band 4 however many ways the shape table asked for them. **Shapes multiply a
  roster; they cannot conjure one** — bands 3–4 need templates, and that is the one thing the shape
  work could not fix.
- **The frozen-north four fill all five roles, so each is arranged into every shape its bands
  offer** (the private project notes; `frozenNorthFactions.test.ts`). **The
  Sandscourge** (desert, bands 1–4, band 4 at home only) are the desert's first native faction at
  any band; **the
  Thunder Herd** (plains and highlands, bands 2–4) are fast and thin, five hexes to a move, and take
  the band-3 plains nobody held; **the Rime Jarls** (Tundra, bands 2–4) are few slow giants that hold
  ground. **The Hoarfrost** are the Heart of Winter's own ice and hold the ice lair's chambers, which
  replaced the Barrow in the lair reorder. They were `lairOnly` until the playtest of 2026-10-14 found
  their Motes, Sentinels, Shardcasters and Wraiths "barely used" (Motes and Shardcasters were never
  fielded at all: band 4 had no chaff or ranged slot). They now roam bands 3–4 on frozen ground only
  (`homeLocked`, `frostOnly`), beside the Rime Jarls, and the late shapes call their whole roster. The
  `lairOnly` flag remains for a faction that should never wander; none uses it now. Playtest
  2026-10-23b found them hitting too softly: each of the five took about a quarter more of its damage
  stat (Mote Magic 11→14, Sentinel Attack 13→16, Shardcaster Attack 13→16, Wraith Magic 17→21,
  Colossus Attack 18→22); verify in playtest. Since the
  reorder the Sandscourge also hold the Wyrm's Hollow's chambers, at band 3, in place of the Coven.
- **The late campaign is harder** (playtest 2026-10-14: winter ground, Legion ground and the Glacier
  "should be much harder"). From band 3 (`THREAT_LATE_FROM_BAND`) every fight fields one more body —
  sizes 2, 2, 3, **4, 5** — and the band-3/4 shapes now include `raid` (two elites, a caster, chaff)
  and `storm` (two elites, a caster, a shooter, chaff) beside the old warband and phalanx. A fight
  that is not a lair boss's own is multiplied by `THREAT_LATE_POWER` (×1.1 at band 3, ×1.2 at band 4)
  in `encounterPowerScale`; the bosses keep their own tuning. The extra body is difficulty, not
  wages: `victoryRewards` pays such a fight the gold of the roster it had before, which keeps the
  weekly tribute's budget (`economyProjection.test.ts`) where it was tuned. Recorded curves are in
  `homeRing.test.ts` and `threatDepth.test.ts`.
- **An expansion world is priced by its level band** (playtest 2026-10-23 for band 1; the band
  table is the private project notes). A world's threat bands restart at 0 by its camp, so
  on the Empire's ramp alone a party of summed level 75-80 in epic and legendary gear met level 7-9
  readouts with a few hundred health. Every fight in such a world that is not a lair boss's own or
  Kairen's is multiplied by the band's entry in the ground power table (`bandPower.bandGroundPower`), in
  `encounterPowerScale`, on top of its ground, the late premium and wrath. Band 1 is `BAND_GROUND_POWER`
  (×3): at level 20 a band-0 Kappa has about 830 health (the castle garrison's Obsidian Infantry about
  600) and a Nue about 2,300. A first estimate. **The later steps are derived, not typed**: gear
  grows faster than the enemies' level term above level 20, so `bandPowerStep` takes what the gear a
  party holds at the band's start has gained on band 1's (epics at the band floor, with
  `BAND_GEAR_LEGENDARY_SHARE`, 0.31, of legendaries from the previous band's top on their steep
  segment) over what the level term has gained by itself, times `BAND_POWER_TRIM` (×1.06 at band 3, ×1.12 at band 4). It is 1,
  1.111, 1.263, 1.403 by band, so the table is ×3, ×3.33, ×3.79, ×4.21: tuned in the simulator
  (balance simulator), verify in playtest. A lair boss's own fight and Kairen take the step alone, with their own tuning on top.
  `bandSheets.test.ts` pins band 2's sheets as band 1's moved along that curve.
- **Beyond the Empire, enemies stand at the content's level, not the party's**
  (`systems/world/contentLevel.ts`). The fixed level replaces only the party's mean in the level term
  `1 + ENEMY_LEVEL_SCALE × (L − 1)`; `threatPowerScale` (the per-band step, depth, haunted ground), the
  late premium, shrine power and wrath all stay, so a party at an area's level meets exactly the fight it
  met before bands (`bandSheets.test.ts` pins every wandering fight, chest guard, lair chamber, shrine and
  Kairen tier). Story content is at band floor + its offset: Foothills to Cloud Crown +0 to +4
  (`WorldDef.levelOffsets`), chest guards at the level of the ground under them though they are built a
  band up, the Silk Hollow +1 and the Silent Hall +3 (`LairSpec.levelOffset`), shrine keepers their
  shrine's threat band, Kairen's story fight +4 (`KAIREN.STORY_LEVEL_OFFSET`). His Storm Seal tiers are
  repeatable: at the current cap, with the step of the cap's band and his tier scale on top. A resumed
  fight keeps the level it was built at (the snapshot's `partyLevel`, which is now the level enemies
  were scaled to). Summons and boss scripts read `enemyStatScale`, which carries it; no Jadeveil enemy
  summons through the skill route, whose scale reads a caster's level, and a test keeps that true. The
  harness, the castle and a PvP side keep their own rules, as does a siege.
- **Off-pace parties, measured** (2026-11-04, `scaleEnemyStats` at each area's own wandering
  multiplier, Jadeveil at band 1, a representative ordinary enemy per area; the input for any retune).
  Health / attack. Before bands the sheet followed the party, so each row read left to right as the
  party's level moved; now every party meets the middle column.

  | Area (level, enemy) | party −2 | party −1 | **at the area's level** | party +1 | party +2 |
  | --- | --- | --- | --- | --- | --- |
  | Foothills (21, Kodama) | 152/34 | 157/36 | **164/37** | 169/39 | 176/40 |
  | Bamboo Terraces (22, Tanuki) | 407/81 | 422/84 | **438/88** | 454/91 | 470/94 |
  | High Passes (23, Kappa) | 573/99 | 595/103 | **616/106** | 638/110 | 659/114 |
  | Storm Ridges (24, Karasu Tengu) | 958/242 | 992/251 | **1,027/259** | 1,062/268 | 1,097/277 |
  | Cloud Crown (25, Oni Brute) | 1,973/263 | 2,043/272 | **2,111/281** | 2,180/290 | 2,248/299 |

  Against today's, a party two levels under an area now meets enemies 7.0% to 8.1% stronger than it would
  have (the gap is widest in the Foothills), and one level under 3.4% to 3.9%; one level over meets them
  3.2% to 3.6% weaker, and two over 6.1% to 7.0%. The level term moves only that far, so any wall an off-pace
  party hits is its own gear and levels, not the enemy sheet. The phone check of whether it is a wall
  belongs to the simulator feature.
- **Jadeveil's wandering fights are wider** because the party walks the range with four heroes.
  `widenForJadeveil` (`encounterGenerator`) pads the plan to `JADEVEIL_ENCOUNTER_SIZE` (4, 4, 5, 5, 6
  by band) with the shape's last non-elite role, so the elite count is the band's own.
  `encounterPowerScale` multiplies by `threatEncounterSize / JADEVEIL_ENCOUNTER_SIZE`, so bodies
  times strength, and the fight's total power, stays what it was. Lairs, shrines, quest sites and
  chest guards keep their own sizes.
- **Every terrain has a native faction at bands 2–4** — the frozen north epic's definition of done,
  measured by its release check and pinned by `factionCoverage.test.ts`. The check found band-4
  forest, desert and mountain fielding only outsiders, about 5% of all encounters, so the factions
  native there one band down — the Restless Dead, the Sandscourge and the Delve — reach band 4 on
  their own ground: the Restless Dead under `Faction.homeOnlyFrom` (they still roam below band 4),
  the Sandscourge and the Delve because the biome lock (`Faction.homeLocked`) keeps them there at
  every band. **At band 4 they are met on their own ground and nowhere else.** Let in as
  outsiders too, their lighter rosters thinned every band-4 fight on the plains and
  `homeRing.test.ts`'s 3→4 step fell from ×1.27 to ×1.21 under its ×1.25 floor; at home only, band 4
  everywhere else keeps the rosters it had and the curve is unchanged. A band-4 forest fight is now
  half the Restless Dead's (a band-4 swamp fight shares them with the Coven), which is a lighter
  roster than the outsiders it displaced — the band's power scale, not its roster, carries band 4's
  weight there. The measured shares are under *The biome lock* in [world](world.md).
  - **Their kits are the shared vocabulary**, in `skillData.ts` under "The four frozen-north
    factions". The plan's draft cadences are spelled one lower as `cooldown` (its CD 3 is
    `cooldown: 2`), a status that must last two turns is `duration: 3`, and every single-target skill
    that waits on a cooldown out-damages its owner's at-will so the AI presses it — the plan drafted
    Cold Grasp and Parting Shot the other way round, and the at-wills came down a step. The
    Wraith's planned Whiteout is **Snowblind**, because a Hydromancer node already carries that
    name and `masteryData.test.ts` fails a node named after a skill it does not grant.
  - **What the shared vocabulary cannot say waits for the battle epic, and is left out rather than
    faked:** the Brute's Pincer Grab (no pull); Running Lance's lane (a dash lands before its strike, so
    it is a five-hex dash and one strike); the Hurler's held block (spelled as a one-turn cooldown
    between throws, the same rhythm); the Drummer's Quickening Rhythm (speed decides nothing once
    `turnOrder` is sorted); the Sentinel's Frozen Footsteps (no ground that remembers). The Skald's
    Shelter of the Hold also shields a Hold Thrall standing in it, which the plan excludes. The Mote's
    Shattering Core **is built** (PT-22, below).
  - **Two arcs are at-wills**: the Herd-Khan's Glaive Sweep and the Glacier Colossus's Glacier
    Hammer, because the plan gives each elite no single-target swing to prefer. `arcFootprint.test.ts`
    names both and holds them to depth 1, a plain swing's multiplier and elites only. **The four
    elites' unique abilities are built** (below, *The new-faction elites*).
  - **Their skills borrow pictures** through `HeroSkill.icon` until their own are drawn; all thirty
    are listed as awaiting art in `icons.test.ts`, which also fails one that borrows nothing.
- The party starts as **one hero at level 1**, so band 0 draws from the `chaff` role — deliberately
  feeble templates that exist only to teach movement and turn order. The first elite waits until
  band 2. `__tests__/world/homeRing.test.ts` measures this through the real damage pipeline, per
  hero, on the Basic Attack each class's starting weapon makes (a Druid's is a branch's missile at
  14 magic, not a swing at 5 attack — measuring the wrong one fails a fight that is fine).
- **A hero's free attack is the weapon in their hand, not their class.** Heroes used to own a
  class-fixed at-will (`slash`, `arcane_bolt`, `thorn_lash`, `throw_knife`) granted by the
  template, so a Hunter holding a bow threw knives and a Druid with a cudgel went on casting. There
  is one `Basic Attack` now (`systems/combat/basicAttack.ts`), built by `createPlayerUnits` from the
  gear worn *when the fight starts* and led onto the bar before the kit — never stored on
  `Hero.skills`, so nothing goes stale when a weapon changes. `SAVE_VERSION` 23 retired the saved
  at-wills. The retired four stay in `skillData.ts` as shared vocabulary (enemies still press
  `slash` and `arcane_bolt`).
  - **`FormSpec.attack` names a profile in `data/items/weaponAttacks.ts`**, keyed by how a weapon
    fights rather than what it is — `blade`, `blunt`, `reach`, `thrown`, `bow`, `crossbow`,
    `arcane`, `wild`, `unarmed`. A profile is reach, stat, multiplier, VFX and the icon it borrows
    (`HeroSkill.icon`, read through `constants/icons.skillIconFor`). The multipliers are the old
    at-wills' moved rather than re-tuned, so a starter weapon hits exactly as hard as before; the
    Druid's starter weapon is a branch so its first attack is magical. `basicAttack.test.ts` pins
    one profile per weapon form and that a profile's style agrees with the held model's
    `WeaponType`, because the rig animates from the model and the profile draws the effect.
  - **A dual-wielder swings once per hand** (`HeroSkill.dualWield`, set only on a Basic Attack by
    a dual-wield mastery holding a second *weapon*). `weaponStrikes` is kept apart from
    `strikeScales` because they compose: a pass is how many times the action repeats (Carnage), a
    hand is what one pass is made of. The one exception is Carnage itself: a dual-wield Basic Attack
    under it is one pass of two *full* hands (`carnageDualWield`), two 1.0× hits, never four halves. Each
    hand rolls its own dodge and crit, fires every on-hit effect and **settles its own drain** —
    the one place a multi-strike does not pool lifesteal — and nothing caps procs to once per
    action. `BALANCE.DUAL_WIELD_STRIKE_SCALE` (0.5) is the lever. **Armour is paid once, not
    twice**: `resolveAttack` scales the finished, mitigated hit, so two half-strikes are one full
    hit plus what the second weapon adds to the sheet — +10 to +24% over the same weapon alone,
    and pinned never to lose to it in `itemProgression.test.ts`.
  - **Carnage doubles `basic_attack`, not `slash`.** `CARNAGE_SKILLS` named the Champion's
    at-will; an enemy holding a Slash is not a Berserker's free swing.
  - **Every skill's number waits for its picture.** `components/combat/vfx/impact.ts` is the
    clock every effect draws with — a projectile's flight, a meteor's fall, a volley's last arrow,
    and the whole clock of a shape that does not travel (a heal's bloom, a nova, a blizzard) — and
    `executeSkill` offsets that action's floats by it, as `runEnemyTurn` does the enemy's. The
    effects import their durations from there, so the picture and the timing cannot come apart.
    An enemy does not start its reply, and the AI does not pass the turn, until those numbers
    have landed. The second hand's effect carries `VfxSpec.delayMs` = `FLOAT_STAGGER_MS`, the gap
    the float queue already puts between its two numbers.

## The skill vocabulary past damage-and-a-status

Each of these is a general field on `HeroSkill` resolved in `statusEffects.ts` and read by
`skillResolution`, the AI, the targeting highlights and `skillDisplay` alike. Adding one is a rule
four systems have to learn, which is why the list stays short — a path wanting genuinely new
behaviour should reach for a passive first.

- **`requiresTarget: TargetRequirement[]`** — `'executable'` (below the attacker's execution
  window) and `'poisoned'`. **All entries must hold**; a list rather than two booleans so "and" vs
  "or" is not something every call site guesses at. `executeThresholdScale` shrinks the window per
  skill (no skill sets it since Execute was retired), and `executeTierDivisor` shrinks it again for elites and bosses.
- **`occupiedVariant: Partial<HeroSkill>`** — merged over the base when the aimed hex holds an
  enemy, resolved **once at the top of `resolveSkillUse`** so targeting, damage, statuses and the
  tooltip all see one skill. Shadowstep is the case: empty ground blinks and hides, a body gets
  dashed at and stabbed. The strike half uses `dash`, not `blink` — a blink names its exact hex and
  would refuse an occupied one. **The highlight pass has to let the variant be aimed at**: it
  filtered every occupied hex out of any skill carrying a `blink`, which made the strike half
  unreachable by construction for a whole version — so the poison path's signature was an escape
  and nothing else, and its tier-3 finisher sat behind a `poisoned` gate it could not open. A
  gap-closer with no free hex beside the target now **refuses** (`no-landing`) rather than landing
  its melee damage from four hexes away, and the board stops offering the hex.
- **`amplifiedBy: StatusAmplifierSpec`** — extra damage per "hit's worth" of a status the target
  carries, measured **against the attacker's own attack** rather than in raw points, so a flat
  bonus does not compound with the square of stat inflation. Unlike `detonates`, it does not
  consume: Creeping Death wants the stack to keep growing.
- **`grantsOnKill: SkillEffect`** — placed on the caster, on the skill rather than as a passive, so
  a hero without that node does not get it.
- **`strikeScales(attacker, skill)`** returns a list of per-strike multipliers — `[1, 1]` for
  Carnage (`[1]` for a dual-wield Basic Attack, whose two hands `weaponStrikes` then lifts to 1.0 each), five twentieths for Rapid Fire, `[1, .25, .25]` for Flurry behind a single-target strike and `[1, .25]` behind an area one (`flurryFollowupsFor`, PT-40). A *list* because only a
  list holds an uneven pattern, and first match wins because no hero can hold two (they are
  capstones on three different paths). **The scale is applied to the finished damage**, not to the
  multiplier: splitting pre-mitigation would run each arrow through subtractive armour at a
  fraction of its power and floor the whole capstone against exactly the targets it exists for.
- **`AuraType.Ambush`** carries both halves of Vanish in one effect — `duration > 1` is the
  wind-up (read on the *outgoing* duration, the way Doom and the Martyr seal are) and `magnitude`
  is the banked actions. Splitting them would be two effects that must expire in lockstep forever. The
  hiding that comes with it lasts the whole wind-up (`VANISH_STEALTH`, 2), not one turn: with one, the second
  round of the wind-up was open to a single-target blow or a Stun and the Vanish only sometimes paid out.
  Area skills still catch a hidden unit, which is the counterplay. (Until 2026-10-22, PT-03, the commit that
  introduced `VANISH_STEALTH` set it on Shadowstep and left Vanish at `STEALTH_DURATION`; Vanish now carries it.
  Shadowstep keeps it too, by choice: two turns hidden after its dash.) The Ambush duration is that internal clock, so
  its status display sets `hideDuration`: badges, the unit sheet and the skill line ("Applies Vanished 3 actions",
  `effect.appliesMagnitudeOnly`) show the actions and no turn count. The simple text reads the rank's own
  actions (rank 1 two, rank 3 four) and `VANISH_WINDUP` rather than fixed words.
- **`targetSide`** names the side the aimed hex must hold a living unit of, for skills whose
  payload is neither damage nor healing — the only thing the highlight pass can otherwise go on.
  Without it the Bulwark's Intercept lit up every hex in range and could be aimed at bare ground
  or at the enemy it exists to body-block. The caster's own hex never satisfies it.
- **`SkillTargetType.Arc`** is a wedge out of the caster along one of the six hex axes: every hex
  within `aoeRadius` steps that also lies within 60° of the aim. Depth 1 is 3 hexes, 2 is 8, 3 is 15.
  It replaced `Cone`, which walked the shape out on the lattice — `a` forward, `b` sideways — and at
  range 2 produced a **four-hex rhombus lying along a diagonal**: a shape that neither widens nor
  points, which is why cone skills read as arbitrary and went unpressed. Two things follow:
  - **`range` means range again.** A cone sized itself off `range` and ignored `aoeRadius` entirely,
    so authoring one tuned nothing (two skill files carried explicit warning comments about it) and
    `applyMasteryModifiers` had to *refuse* `skillRangeBonus` on cones. Both exceptions are gone.
  - **Direction still snaps, and `hexDot` is why it now snaps correctly.** `arcDirectionIndex` picked
    its axis with `dq*Dq + dr*Dr`, which is not a dot product — axial coordinates are a skewed basis,
    so that form drops the cross term and reports `(0,1)·(0,1)` and `(0,1)·(-1,1)` as an equal 1.
    Aiming *directly* at the neighbour along `(0,-1)` fired along `(1,-1)`: **60° wrong, on two of the
    six axes, everywhere on the board, for the whole life of the shape.** An arc is symmetric about
    its own axis and eight hexes wide, so a 30° snap barely moves what it covers; the old four-hex
    sliver slid clean off its target, which is most of what "cones do not work" actually was.
  - **`resolvePush` had the identical fault and it is fixed too.** Same naive form, one system over,
    surviving the same way — two thirds of shoves were right. The naive product over-weights the
    diagonals, so a target at 169° off the caster was shoved along 120°: **49° wrong against a 60°
    wedge**, a knockback travelling almost sideways rather than away. 24 of the 120 vectors within
    five hexes resolved to the wrong direction. `push.test.ts` was fully green throughout, because
    every case in it put the target on an exact axis where the arithmetic was already right and its
    one sweep asserted only that the push increased the distance — which a wrong direction also does.
    It now measures the *bearing*: the six directions are 60° apart, so the chosen one is always
    within 30° of the true angle, which is the property a table of pinned landings cannot state.
    `PUSH_DIRS` keeps its own order regardless — a target at exactly 30°, 90° or 150° is genuinely
    equidistant from two directions, and something still has to pick.
  - **The drawn wedge and the burnt hexes come from one number.** `Arc.tsx`'s `SPREAD` was 1.15 rad
    under a comment calling it the 60° fan — it is `ringGeometry`'s *full* sector width, so the
    picture covered half the footprint — and its outer radius was a literal `3.2` despite a comment
    claiming it derived from the hit list. It is 120° and `depth × √3 + √3/2` now, measured off
    `hitCoords` so an arc clipped by the board edge is drawn clipped.
  - **Every arc waits.** `arcFootprint.test.ts` widens the tree's "large area skills are limited by
    mana or a cooldown" rule to the shared and boss skills, because `enemyAI` scores in expected
    damage and an unlimited AoE beats its owner's single-target skill on literally every turn — a
    boss holding a free depth-3 arc has one move, not two. It caught `throwing_blades` and
    `dragon_breath` the moment the footprint became legible to it.
- **`SkillTargetType.Chain`** (`chainJumps`, `chainRange`) is a route through bodies: the aimed
  unit, then the nearest enemy it has not touched, resolved in `chainHexes` and therefore shared by
  the highlights, the resolver and the AI. **Whose side it leaps along is decided by the aimed
  unit, not the caster**, so an enemy Stormcaller's bolt walks the party. Ties break by distance
  then by coordinate — three call sites disagreeing about a bolt's route would be three skills.

**Four more arrived with the v3 trees**, because the trees asked for shapes the game could not make:

- **`SkillTargetType.Cross`** is Cleaving Throw's X — two 120° axes, four arms and **two gaps**. It
  is deliberately not a smaller `Ring`: the gaps are the whole reason aiming it at the middle of a
  formation is a decision rather than a default.
- **`randomEnemies`** picks its targets instead of naming them (Skyfall, since the 2026-10 remaster;
  it replaced `scatterStrikes`, which rolled arena hexes). `targeting.pickRandomStrikes` draws up to
  that many **different** living, targetable, non-objective opponents **within `aoeRadius` of the aimed
  hex** (playtest 2026-10-17, PT-18: it used to draw from the whole arena), without replacement, once per
  cast in the resolver; `getSkillTargets` returns every candidate in that area (what the valid-hex pass
  and the AI score read, the AI scaling the value by the expected share), the range overlay is the
  skill's own `range`, and the aim preview draws the whole area.
- **`allyShare`** lets a `free` self-move be aimed at an ally as well as open ground (Reposition: any
  free hex within `REPOSITION_RANGE`, the whole arena). Aimed at ground the caster goes there and keeps
  the whole Barrier; aimed at an ally the caster lands on the nearest free hex beside them
  (`resolveSelfMove`) and the Barrier is split — each of the two gets `allyShare` (50%) of it.
- **`freeAction`** bypasses the one-action-per-turn rule the whole combat model rests on. Exactly
  three skills have it (Reposition; the Wildshape remaster's Primal Surge, whose extra action it is; and the
  Hunter's Disengage since the 2026-10-08 playtest) and a test pins that list — a fourth user is a design
  decision, not a field somebody set.
- **`healingBasis: 'missingHp'`** makes `healing` a fraction of the target's missing health (combat
  maximum, read as the heal lands) instead of a multiple of the caster's Magic; gear `healPower` still
  amplifies it (`calculateHealing`). Disengage is the designer: 30% of the Hunter's missing health, healed on
  the hex it lands on, then the Hunter acts (`freeAction`). 8 MP, cooldown 3. A range node (Longshot) grows a
  `free` or `blink` move's `selfMove.range` with its `range` (`applyMasteryModifiers`), and the target filter
  checks the move's own reach and a duel circle, so every lit hex is one the move accepts: before the
  2026-10-13 playtest Longshot lit a fourth ring that the move refused. It no longer makes the
  Hunter untargetable: with the turn left unspent that let the Hunter break away, shoot and be out of
  reach for the reply.
- **The dead take no healing.** `healUnit` restores nothing to a unit at 0 HP; nothing in combat revives,
  and a lethal save holds its unit at 1 before its heal. A caster killed mid-cast by Retaliation or Thorns
  strikes nothing further (`skillResolution.casterFell`, for every caster), and
  its lifesteal, Sacred Seal or ally heal no longer mends it back onto the board (playtest 2026-10-08).

**Three more arrived with the Beetle** (Monk), each general, and three with its capstones (below):

- **`immovableVariant: Partial<HeroSkill>`** — merged over the skill, once at the top of
  `resolveSkillUse` after `occupiedVariant`, when the enemy aimed at can be neither moved nor stunned
  (`beetle.immovableTarget`: a boss, or a unit both Immovable and immune to Stun). Grip and Throw's
  heavier blow with no throw and no Stun. A node's rung scales its `damage` as it does the skill's.
- **`SkillEffect.scaling`** — the stat a fractional magnitude is a share of, for this entry, overriding
  the skill's. `'defense'` is Physical + Magic Defense, an effect basis only (`EffectScaling`).
- **A `selfOnly` entry lands on its caster wherever the footprint is.** It used to land only when the
  caster stood in its own footprint, which every user did; a skill aimed at somebody else (Carapace
  Leap's answer, at its ward) now gives its caster its share too.
- **A Reaction can act before a blow lands** (`interceptAlly`, Vengeful Shell): the resolver asks
  `beetleMoves.interceptBlow` for every struck body, and the body it returns is the one struck. Every
  other Reaction still fires after the action, from `flushReactions`.
- **`damageUnit` can split one blow between two bodies** (Carapace Bastion's ground), so a caller that
  floats a blow's number subtracts `DamageResult.shared`; `FunnelData.hazards` is optional for that read.
- **A swap is a move of two bodies at once** (`HeroSkill.swapsPlaces`), done before the footprint is read.
- **A unit may stand more than one prepared Reaction** when `beetle.reactionLimit` says so (Second Watch);
  everyone else still stands one.
- **A body a blow shoved still takes what the blow carries.** Statuses are laid per footprint hex after
  the strikes, and a pushed target had left its hex, so a push skill's status missed exactly the bodies it
  moved. The resolver remembers who it shoved off which hex (`shovedFrom`) and lays the status on them —
  Horn Sweep's Attack Down, Grip and Throw's Stun, and the Bleed on Aethelred's Imperial Cleave, which had
  never reached a hero it pushed.

## Physical and magic damage

A hit has a **type** — `physical` or `magic` (`DamageType`) — and is answered by the matching defence
only: Physical Defense (`defense`, shown **P.DEF**) or Magic Defense (`magicDefense`, **M.DEF**).
`systems/combat/damageType.ts` is the one reader; `calculateDamage` spends it.

- **The type is a decision, never inferred from `scaling`.** `scaling` names the stat a hit is built
  from; the type names the armour that answers it. `data/skills/damageTypes.ts` is the deliberate per-skill
  table (the Templar's `smite` scales off both stats and is physical; the Stoneshaper's earth is built from
  magic and is physical stone; its holy `judgement`, `consecrate` and `sanction` are magic). A Basic Attack
  takes its type from the weapon profile (`WeaponAttack.damageType`: arcane and wild missiles are magic).
  `damageTypes.test.ts` fails a damaging skill with no entry, so a new one cannot ship untyped.
- **Hero defence bonuses are independent.** `getEffectiveStats` starts Magic Defence from the
  stated class value, or the class's unmodified Physical Defence at `MAGIC_DEFENSE_RATIO` (1).
  Equipment and mastery `defense` bonuses then affect Physical Defence only; `magicDefense`
  affects Magic Defence only. Armour favours physical, robes and wards magic, and mixed vestments
  can grant both. Enemies and summons without a stated value retain the ratio fallback.
- **Physical Defence buffs affect physical hits only.** `DefenseBuff` increases Physical Defence;
  `MagicDefenseBuff` is the separate ward. `DefenseDown` still affects both. Every text that grants
  `DefenseBuff` names Physical Defence (Braced, Rallying Taunt, Stoneskin, Hibernate, the heal's
  guard; playtest 2026-10-23 asked which of the two defences Braced's "+2 defence" meant). (Last Stand no longer adds
  defence; it reduces all damage taken, see *Bulwark*.)
- **Defence takes a share of the whole hit, not a flat amount** (`damageCalc.defenceReduction`, playtest
  2026-10-14): `reduction = DEF / (DEF + DEFENSE_ATTACKER_K × power)`, `DEFENSE_ATTACKER_K` 3 (1.5 until the playtest of 2026-10-17), where `power`
  is the attacker's own stat behind the hit (`scalingPower`: Attack, Magic, their average, a Beetle's shell)
  and `DEF` is after penetration. 100 defence against 100 power takes 25% off, twice the power 40%; each point is worth less than
  the last. A big and a small hit from the same attacker lose the same share. It was `max(20% of raw, raw −
  0.4 × DEF)`: a level-20 Bulwark's 140 P.Def took 56 off every hit, floored everything under 70 raw at a
  fifth and barely touched a boss's swing. Now the same Bulwark takes about 55% of a weak Delve Breaker's
  Slash (20% under the flat rule, 38% at K 1.5) and about 81% of Aethelred's Blade (69% at K 1.5). K 1.5 left a
  level-12 Monk at 90 DEF taking 47% of the first boss's blows (Bonebreaker Sweep 25, Warren Collapse 60 of
  285 HP); at 3 it takes 64% (34 and 81). A tuning starting point to verify in play. Measuring against the attacker keeps armour's
  worth steady as every stat grows about fourfold over a campaign; a constant would make early armour
  worthless and late armour near-immunity again.
- **The cap is the existing `MIN_DAMAGE_FRACTION`**: defence never takes more than 80% off, so no stack of
  buffs makes a fight indefinitely long. On real sheets it is out of reach (it needs four times the
  attacker's power in defence).
- **Penetration is two stats, one per defence** (`damageCalc.penetration`). **Armour Pen** (`armourPen`)
  ignores that percentage of Physical Defense on a physical hit; **Magic Pen** (`magicPen`) ignores that
  percentage of Magic Defense on a magic hit. Neither ever reaches the other's defence, so a Sundering axe
  does nothing for a spell and a Piercing orb nothing for a sword. Each has its own cap (`MAX_ARMOUR_PEN`,
  `MAX_MAGIC_PEN`, both 80). Conditional passive pen (`passives.penetrationAgainst`) and a blow's
  `extraPen` are summed with the stat that matches the hit, and each source only offers points for the
  hit type it pierces: **Killing Frost is magic**, **Settle In and Sharpened Steel are physical**. The
  holy rider (`holyHitBonus`) is a separate magic component answered by Magic Defense in full (the same
  share rule, against the same attacker's power); no penetration, Magic Pen included, reaches it. Save
  version 50 split the stat.
- **Lifesteal ignores the hit's type.** `calculateLifesteal` drains a fraction of the damage actually
  dealt — the skill's own `lifesteal`, a `Lifesteal` aura, and the sheet's `lifesteal` (gear and the
  passives that write the stat, such as Undying's surge) — and never asks whether that damage was
  physical or magic, so **gear lifesteal heals from spell damage** exactly as from a weapon. The sheet
  part is capped at `MAX_LIFESTEAL` (40%) by `damageCalc.sheetLifesteal`, which the skill preview's
  "Heals for N% of damage dealt" line reads too; the skill's own drain and an aura ride on top.
- The power chip on a skill card says the type ("1.1× MAG magic"); the unit card and the hero sheet show
  both defences. Save version 34 refreshes persisted item rolls for the separate bonuses.

## Prepared attacks

A skill with `HeroSkill.prepares` (`PreparedSpec`) **announces now and lands later**. Casting it writes a
`PreparedAttack` into `combatStore.preparedAttacks` instead of dealing damage; mana and cooldown are paid at
the cast. The pure rules are `systems/combat/preparedAttacks.ts`; the shared cast is `preparedCast.ts` (called
by `resolveSkillUse`, which an enemy's cast goes through too); `preparedResolve.ts`, called from `beginTurn`,
finds the warnings that are due, and `warnedLanding.ts` lands each one, every blow of it (below).

- **The footprint is fixed at the cast** — the hexes, the aim and the caster's origin (the origin of any
  push). A caster that moves or turns cannot retarget what it warned.
- **The response window is counted in the responders' turns, never the caster's.** `responders` are the
  opposing units standing in the footprint at the cast, less any with no turn of its own — an objective or a
  companion such as the Thunder Elemental is struck but owes nothing, or the warning would wait on it for ever
  (playtest 2026-10-23: the Burrowmother's Undermine never landed); `combatStore.nextTurn` marks the outgoing unit as
  having responded (the one funnel every turn passes through, a stunned or skipped one included). It lands
  from the caster's `beginTurn` only when nothing is owed — a dead responder owes nothing, an empty
  footprint is due at once (the caster commits and misses). Bonus turns, extra actions and a faster caster
  therefore cannot shorten it: a caster whose attack is not due simply acts normally. Landing **is** that
  turn (`TurnStart` kind `'resolved'`), and it runs the ordinary resolver with `ResolveOptions`
  (`resolving`, `fixedHexes`, `pushOrigin`), so damage types, statuses, pushes and on-hit passives are one
  rule rather than a second implementation that could drift from the preview.
- **A window may be longer, and may be the whole party's.** `PreparedSpec.windows` (default one) makes a
  countdown of several full rounds, counted per responder in regular turns only — a hero's speed-granted
  turn is a second action inside the same window, never a second window (`combatStore.nextTurn` marks
  `responded` once per window and ignores a bonus turn for any warning of more than one). `PreparedSpec.everyone`
  makes every living hero a responder whatever stood in the footprint at the cast: a Furnace Heart, which rides
  on one of them for five rounds, a Cinder Rift, whose line the party can walk into or out of, and Skyfire, which
  covers the arena.
  `PreparedAttack.landing` is a second footprint fixed at the cast, drawn apart from the first (where Skyfire
  lands).
- **One at a time per caster.** A second preparation is refused and the AI does not score it
  (`canPrepare`), so a boss cannot stack warnings into a pattern with no safe answer. A warning carried by a hero
  (`PreparedSpec.carried`: the Dragon's Furnace Heart) is kept apart: one carried and one other may stand together,
  never two of either.
- **The preview is the resolution.** `previewPrepared` names the units now in the footprint (`affectedBy`),
  who still owes a turn, and — for a push — the landing of each body from the same `previewForcedMoves`
  trace the resolution runs, in the same order. It assumes survivors: a body the damage half kills frees its
  hex, which only loosens a landing the preview called blocked. The board draws the footprint in the
  `warning` highlight (violet, kept 60° of hue or more from the other three) and each push as a flat arrow
  in the warning's tone from the body to its landing (`warnedPushes`, `PushArrows`). The landing was a
  zone-strength hex in that tone until PT-06: one ring outside a Boundary Smash it read as a stray hex of
  the footprint. A banner (`data/display/preparedDisplay.ts`) says what is coming and what it is waiting on,
  then what the warning adds, in a fixed order: the pushes and the braced, the move's own words
  (`warning.move.<id>`, with `.sheltered` when a `shelter` answer's ground was fixed at the cast and `.grade`
  for a `graded` cancel, read off the bound objective), the orb, the rules' notes (the split, the blocker, the
  shelter, the stated target rule, the whiff unless the move is `outlast`ed and its own words say the price),
  the chains, claim and realm, the seals (`toll`), the glass (`hold`), and an elite script's or Kairen's tail.
  With a boss on screen it is the boss panel's "Incoming" toggle; otherwise `WarningBanner` (an elite's
  Glacial Tomb, a Furnace Heart), which folds to "Incoming: N" with the boss panel's fold control and
  remembers that for the app session (playtest 2026-10-14).
- **A landing has one plan** (`preparedAttacks.landingPlan`, boss tactics epic, shared systems). Four
  optional `PreparedSpec` fields change what a warning does, and a boss opts in per move, so no fight
  changes on its own (Aethelred's Cleave, Foreclosure and Standards use them now; the other bosses wait on
  their own features). The plan is read by the landing, the preview, the board and the banner, so what is
  shown is what lands, and it is fixed once per landing (`warnedLanding.landWarning`) before anything is
  retired or struck:
  - `split` — the damage is divided among the opposing units the landing strikes (`1 / N` each, a hero
    alone takes all of it). `ResolveOptions.shares` carries each struck hex's share into the resolver's
    `strikeScale`. "Opposing" is a body with a turn of its own: an objective or a companion neither takes
    a share nor dilutes one.
  - `blockedBy: { share, casterStatus? }` — a hero in the footprint who holds a Barrier, Last Stand (while
    it bites) or Immovable (`isShieldingBody`) stops the attack: the blow falls on that hero alone at
    `share` of its strength, the rest of the footprint is spared, the push, the afflictions and a slam's
    effect are dropped (`warnedLanding.withoutRiders`), and the caster takes `casterStatus` (a blocked Cleave
    leaves him Exposed). The blocker is the shielded hero nearest where the caster stood at the cast, ties
    by lower id (`landingBlocker`), the same choice in the preview and the landing.
  - `shelter: { besideObjective?, onHazard? }` — footprint hexes beside a living objective of that kind,
    or lying on a hazard with that `label`, are not struck. The board draws them apart from the footprint
    (`boardOverlays.shelterGroupHexes`, the support colour) and the banner counts them.
  - `sealed` — Foreclosure's seals (below): the warning remembers whose seal is whose (`bound`, `centres`)
    and how each has been answered (`PreparedAttack.tolls`). A seal paid by a strike is sheltered like a
    footprint hex beside a banner: `preparedAttacks.paidSealHexes` joins `shelteredHexes`, so the plan, the
    board and the banner all show it spared.
  - `onWhiff` — the id of a hook a boss script fills (`EncounterScript.whiff`, called by the landing after
    `afterLanding`) when no blow of the landing struck anyone: fired once, never when someone is struck. A
    chain that lost a link strikes nobody, so it whiffs. The banner says it from the `skillText` entry
    `whiff.<id>`.
- **A warned move names its answers** (`PreparedSpec.answers`, the `WarnedAnswer` union of `models/skills.ts`,
  read by `systems/combat/warnedAnswers.ts`). `answersOf(spec)` is one list: first the answers the rules above
  imply — `break` (an interrupt, `interruptedBy` or `tauntCancels`), `block` (`blockedBy`), `share` (`split`),
  `toll` (`sealed`), `shelter` (`shelter`) — then the ones the move names: `step` (leave the footprint),
  `cancel` (destroy the objective of a kind bound to it or riding on it, `bindsPrepared` or `linkedPreparedId`;
  with no kind, the units it binds: a claim's soldiers; `graded` when it lands as hard as that objective is
  whole, `standIn` when a melee hero stands in the blast to strike it), `cleanse` (shed what it feeds on: a
  chain, Taint), `shelter` with `besideObjective` (ground a script fixes at the cast: Creeping Winter's ring),
  `brace` (rubble or the wall at the back: the Smash), `sprawl` (stand where he comes down: Skyfire), `hold`
  (take it to keep the ground: Crownfall) and `outlast` (let it land on nobody and pay its whiff: the Furnace
  Heart). Every warned move in a catalog names at least one (`warnedAnswers.test.ts`); the warnings an elite's
  script builds from a payoff skill (the marsh, the fracture, the seed, the tomb, the web, Undermine) name none
  yet and are described by their script's tail. The readers ask the move, never its id: the banner (below) and
  the simulator's party (`partyPolicy`, `trollAnswers`, see the balance simulator). The
  tactical AI does not read them yet: its board score sees a warning only as a footprint over an ally and an
  objective's health.
- **One landing owns every blow of a warning** (`warnedLanding.landWarning`, the `Landing` of
  `encounterScript.ts`). In order: it holds the plan (and the braced bodies of the same trace) and reads who is
  owed an answer, before anything moves; takes the warning off the board and retires what rode on it; strikes —
  a script's `land` hook lands it whole, or the ordinary strike runs from wherever `beforeLanding` puts the
  striker; counts the answers; runs `afterLanding`; and fires the whiff. A script that lands its warning its own
  way is handed the `Landing` and makes every blow through it, never past it:
  - `strike` — the footprint by the plan (the split, the blocker, the shelter), or another blow of the same
    warning (a different skill or aim: Reprisal's graded chain), or another area it lands, which gets its own
    plan (each of the Convergence's spire blasts). The ordinary strike, the Rift, Skyfire's flame, Creeping
    Winter, Reprisal and the spires use it.
  - `blow` — a further blow over hexes of its own, outside the plan: Skyfire's landing blow (the trench
    shelters a hero from the flame, not from him coming down), the Jorōgumo's bite, Kairen's dive, downdraft,
    Nova, storm and Verdant Judgement.
  - `hit` — bodies reached without a blow over ground: the pair a chain settles on, the heroes the Bog Hulk's
    marsh catches.
  - `broken` — a chain that lost a link as it came due: counted `broken`.
  Each adds who it reached (the other side's bodies with a turn of their own, `preparedAttacks.opposedBy`) to
  one set, **who the landing actually struck**, and the answer tally and the whiff are decided from that set
  rather than from the warned footprint. The plan travels inside the `Landing`, so nothing outlives a landing,
  however it ends. Instant moves are not landings and count nothing: the Wing Thrust's flame wave and the
  Pulse's fracture. A storm Kairen strikes between turns (`landStorm`) is not a landing of his turn either, and
  is not counted. `threatensUnit` (Seismic Sense) still reads the plain footprint.
- **Each warning counts how it was answered** (`systems/combat/answerTally.ts`, `combatStore.answerTally`).
  `PreparedAttack.threatened` is the opposing bodies standing in the footprint at the cast (for a warning
  the whole party answers it differs from `responders`). Where the landing resolves, each of them still
  standing as it began is counted once, from who its blows actually struck (ground the script spared at the cast,
  `PreparedAttack.sheltered`, counts as inside: a hero who walked onto Creeping Winter's ring is `unharmed`, not
  `stepped`): `stepped` (left the footprint), `took`
  (struck), `blocked` (held the line, or was braced against a push by rubble or the wall at their back and took
  the blow without losing the hex), `unharmed` (stood in it and no blow struck them: sheltered, spared behind
  a blocker, the other end of a chain that paid nothing, a webbed hero the bite passed over, a disc whose spire
  was broken in time), or `broken` (the warning never landed because the
  party broke it: an interrupt, the bound objective destroyed, a chain cleansed, a claim's soldiers killed
  — `removePreparedAttack(id, 'broken')`). A phase change clears a warning without counting it. The columns
  of a move sum to the heroes it threatened that were still alive. The battle report shows one compact table
  (`RewardDialog`), `FightRecord.an` stores it, a replay ends with a line per move, and the balance lab
  shows each column's share per move. "One column above about seventy per cent across playtests" marks a
  move that is still a one-choice move; the numbers are read in playtest, not tuned from the harness.
- **A phase change clears, never resolves.** `enterPendingPhase` drops the boss's pending warnings and
  shatters its objectives, so an old pattern cannot arrive in the new phase as an unexplained hit. Letting a
  due attack land first would be a second path through the response-window rule. Ground laid with
  `ArenaHazard.lasts: 'phase'` goes with them.
- **Ground can last, and is cover.** Besides `turnsLeft`, a hazard can last `'until the phase turns'`
  (`lasts: 'phase'`, cleared where `enterPendingPhase` shatters objectives) or `'until replaced'`
  (`lasts: 'replaced'` with a `kind`: `combatStore.addHazard` clears its owner's older ground of the same
  kind first). Solid ground is cover: `ramparts.rampartBlocksShot` takes the arena's hazards, so Single,
  Line and Chain shots of range above one cannot pass over rubble or black glass, for heroes and enemies
  alike. The resolver (a distinct "Cover blocks that shot" refusal), the highlights, the aim preview
  (`getSkillTargets`' chain route) and the enemy AI's aim all ask it; a melee swing beside the ground is
  not a shot. Movement and shoves already stopped at solid hazards. Aethelred's Crownfall lays black
  glass this way (`kind: 'black_glass'`, `lasts: 'phase'`). The Troll's rubble lays `'replaced'`; it
  blocks shots while it stands, and the briefing says so (a hero shoots round it, and keeps it at their back
  for the Smash). It is also the only ground the fight breaks: his Prey, a brace and every Sweep take heaps
  away (see "The Troll Chieftain").

### Authoring a warned attack: the rule and the fairness contract

A boss's or an elite's warning is authored to these rules, the boss tactics epic's (its design and
measurements are the private project notes, sections 2 and 8–10):

- **The rule.** Every warned attack has at least one answer performed by *standing somewhere and doing
  something* — sharing a roof, blocking, sheltering behind an anchor, bracing against rubble, breaking
  what it is bound to — and that answer beats the step exactly when the party has read the board right.
  The step is the fallback. A move whose only answer is a step is not finished. The answer tally above
  is how a move is found to be one-choice in play.
- **The fairness contract.**
  1. Every affected hero gets a response turn before a landing (the response window above).
  2. The party always has a complete answer it can perform this round with the heroes and the kit it
     has. The answer need not be a step for every hero.
  3. A hero with no safe hex in reach is allowed only when the banner names the answer that covers
     them: a block, a shelter, a shared stand. Never on the first cast of a move in a fight. Where a
     move promises the step instead, the old guards still hold it (`everyoneCanLeave`,
     `convergencePlan`'s safe-hex rule, `crownIsFair`).
  4. Every escalation is shown before the cast it changes: the next size is on the boss panel.
  5. A footprint fixed at the cast never retargets.

## Turn tempo, waves and Reactions

Three rules for a fight that changes over time, each a pure module plus a store-using resolver, and each
called from `beginTurn` so it happens *between* two turns and never inside an action. Pinned by
`turnTempo.test.ts`, `waves.test.ts` and `reactions.test.ts`.

### Speed bonus turns (`systems/combat/turnTempo.ts`)

- **The chance is from the speed ratio, not a difference**: a unit's speed against the *mean* speed of the
  living combatants it faces (`speedEdge`). Enemy speed scales with party level (`ENEMY_LEVEL_SCALE`) while
  hero speed comes from gear, so a fixed gap would mean nothing at level 1 and everything at level 15.
  `bonusTurnChance` is zero up to `TEMPO_MIN_EDGE` faster (0.3), rises linearly to `TEMPO_MAX_CHANCE`
  (0.35, deliberately under even odds) at `TEMPO_FULL_EDGE` (twice as fast) and stays flat beyond it.
- **Both sides, one rule.** Summons, objectives and units that cannot act are never granted one.
- **Rolled when a regular turn begins and held in `combatStore.bonusTurn.pending`**, so the queue draws a
  `+1` entry (`hud/turnQueue.ts`, `queueEntries`) before it happens. `nextTurn` then hands the *same unit*
  a second turn with `bonusTurn.active` set; a bonus turn is **never rolled for**.
- **Extra action, never extra time.** `beginTurn` takes a short road for a bonus turn: flags reset and
  nothing else. No cooldown, effect, summon-lifetime, objective or Reaction clock moves, and a warned
  attack is not landed on it. A prepared attack's window is counted in its responders' turns, so a bonus
  turn of the caster cannot shorten it. A turn lost to Stun or Freeze, or a death, loses the bonus too.
- **Stacks with scripted extra actions**: a bonus turn is an ordinary turn for whatever the kit does with
  one, so a boss with two actions per turn (the Troll Chieftain's Fury, below) takes up to four per
  pair (`actionCeiling`).
- **Announced for both sides, once per second turn**: `extraTurnCause` (pure, in `turnTempo`) names why the turn
  now beginning is a second one: `Fury` (the Troll Chieftain's extra action, which wins when both hold) or
  `Speed` (a bonus turn); `null` for any ordinary turn, so a first turn never announces. When it is non-null
  and the turn is not lost to a disable, the scene shows a gold `bonus` toast ("<name> acts again — Speed"),
  logs the same line and plays a short gold `buff` burst on the unit (`announceBonusTurn` in `CombatScene`).
  It runs in the per-turn effect keyed on `turnSerial`, so it cannot repeat per frame. Frenzy's refunded
  action is the same turn continuing, not a second turn, and is not announced.
- **`turnSerial` counts every hand-over**, including one that leaves `currentUnitId` unchanged. Anything
  that runs once per turn in the scene keys on it as well as on the id.
- **Every turn start frames the unit where it now stands, a bonus turn included** (PT-10). The turn
  camera's effect keys on `turnFocusKey` (`components/combat/turnCue.ts`: id, `turnSerial`, hex). A walk
  moves the unit while its turn is being handed on, when the camera does not follow (`handingOver`), and
  a bonus turn keeps both the id and that hex, so keyed on those alone the second turn began with the
  camera still on the hex the first one started from. `turnCue.test.ts` pins the key. Checked on web at
  844×390 (2026-10-10, `?visualBaseline=1`, Champion against three wolves, a forced bonus turn after a
  three-hex walk): without the serial the hero began the bonus turn at the top edge of the frame; with
  it the hero is re-centred, and mid-walk neither the white ring nor the HUD is drawn.
- Jest pins the dice (`jest.setup.ts` sets `setTempoRandom(() => 1)`) so no other suite gets a bonus turn
  it did not ask for.

### Waves (`systems/combat/waves.ts`, `waveResolve.ts`, `data/templates/encounterWaves.ts`)

- An encounter may carry announced **waves** (`EncounterWave`): a trigger (`enemiesFallen`, or
  `unitFallen` for one template), the templates that arrive, an optional `maxActive`. They are an
  encounter rule, never a spell on a boss. `planForEncounter` attaches them; the scene hands them to
  `combatStore.setWaves` with the fight's own party level and power scale.
- **The player is told up front and kept counting.** The battle intro card says "2 reinforcement waves
  incoming" (`waveAnnouncement`, also logged) — "incoming", not "may follow", because victory waits for
  every wave. Once the card is gone, `hud/WaveCounter` sits first in the board-controls row (top right,
  under the menu): a `BOARD_BTN`-square tile reading WAVE over "1/3", where the opening enemies are wave 1
  and a wave counts from the moment it starts arriving (`waveProgress`); it reads LAST on the final wave.
  One button wide, so the short HUD's row stays exactly `SHORT_RIGHT_W`; absent in a fight without waves.
- **The fight does not end between waves.** `fightOutcome()` is `combatOutcome(units, pendingWaves)`:
  an empty enemy side is a victory only when no wave is waiting, so victory and rewards happen once, after
  the last. Every driver asks `fightOutcome`, never the bare verdict. The party falling still loses.
- **A wave arrives from `beginTurn` (`resolveWaves`), announced once** through the log and the toast
  (`CombatSink.announce`), in the words of `factions.wave.<id>.announce` (`waveAnnounce`). Waves go strictly in order and each is `waiting → arriving → done` exactly
  once, so none repeats; `WAVE_MAX_PER_ENCOUNTER` and `WAVE_MAX_SIZE` bound the fight (`waveViolations`).
- **Spawn hexes are legal**: free of every living body (objectives included) and solid hazards, inside the
  arena, at the back of the enemy side and clear of the party where the board allows (`waveSpawnHexes`).
  A wave brings the living enemies up to its `maxActive` (default `WAVE_MAX_ACTIVE`) and the rest arrive in
  instalments as bodies fall. With no room at all and no opposition the wave is dropped rather than
  waited on, which would soft-lock.
- **Authored today** (wandering and quest fights only; lairs, the castle and the siege keep curated sizes):
  Brigands field a *revenge* wave of two Footpads when the Brigand Captain falls; a Beasts fight with two
  or more Giant Spiders sends a second brood, no larger than the first, once the first is beaten.
  **The Greywater crossing** (`quest_greywater`, The Ford at Greywater) is band 2 and opens on a Fen Spawn,
  a Mire Wader and a Reed Stalker at the dam, then carries two `enemiesFallen` waves — a Fen Spawn, a Mire
  Wader and a Reed Stalker, then **exactly** a Bog Hulk, a Silt Speaker and a Reed Stalker — so the ford is
  held in three pushes and ends on its keeper (playtests found the pair, then band 1, too easy; the last wave
  is the second deliberate exception to "no bigger than the fight it follows"). **The Supply Trail**
  (`quest_supply_trail`) is band 3, its seven bodies led by a Glacier Colossus (playtest 2026-10-21). **The Snare Thicket** (`quest_thicket`, The
  Thing in the Thicket) opens on two Giant Spiders, then sends a brood of three and a nest of four, each
  once the last is down. It is the one deliberate exception to "a wave is no bigger than the fight it
  follows": a playtest found the pair far too easy and asked for a growing 2 → 3 → 4 nest. Both waves
  stay within `WAVE_MAX_SIZE` (4), `WAVE_MAX_PER_ENCOUNTER` and `WAVE_MAX_ACTIVE`, so none arrives in
  instalments.

### Reactions (`systems/combat/reactions.ts`, `reactionCast.ts`, `reactionResolve.ts`)

- A **Reaction** is a skill with `HeroSkill.reaction` (`ReactionSpec`): a `trigger`, a `duration` in the
  owner's own regular turns, and a `response` skill. Casting it spends the owner's **whole turn** (move and
  action), pays mana and cooldown, and writes a `PreparedReaction`; nothing is dealt. One per owner at a
  time, and a second cast is refused. The skill panel and the HUD banner (`data/display/reactionDisplay.ts`)
  show the trigger and the turns left, from the same `reactionSummary`. The banner drops a Reaction whose
  owner has fallen, which the rules already ignore (`canReact`; playtest 2026-10-23b).
- **Triggers** are about a hostile unit, which is also what the response is aimed at: `struck` (optionally
  `melee`), `allyStruck`, `foeApproaches` (`reach`). The store records the events that can set one off
  (`damageUnit` with an author that landed HP or ate a barrier; `moveUnit`), and only while a reaction
  exists. Authorless damage (a poison tick) is nobody's hostile act.
- **When it fires: after the action that caused the event has finished resolving, before any other unit
  acts.** `flushReactions` drains the queue — from `beginTurn` before anything else, and from a scene effect
  so the answer is seen promptly. Several reactions on one event fire in the order they were prepared. Each
  fires **once** and is spent; answers set off further events, answered in the same flush, and
  `REACTION_CASCADE_LIMIT` is the backstop.
- **What stops it**: a stunned or frozen owner cannot answer (the preparation waits and may still expire),
  and a response out of its own range of the subject does not fire.
- **Expiry**: at the start of the owner's *regular* turn the count drops by one and it is gone at zero
  ("fades unused"); the turn it cost is not refunded. A bonus turn neither ticks nor extends it, and cannot
  prepare a second while one stands.
- **How long a Reaction stands**: `BALANCE.REACTION_TURNS` (3) of its owner's turns by default, and never
  fewer (playtest 2026-10-17, PT-10): a setup that waits for a trigger needs time for the trigger to come.
  Carapace Leap, Vengeful Shell, Covering Fire and the Abbot's Vow all stand three. `reactionDuration.test.ts`
  sweeps every fielded skill.
- **One resolver for both sides.** The response is `resolveSkillUse` with `resolving`, like a landing
  prepared attack, so it costs nothing and obeys every damage and status rule. The AI scores a Reaction
  (`evaluateSkill`, worth it only with an enemy within `REACTION_THREAT_REACH`) and casts it through the
  same `castReaction`.
- **A watch** (`ReactionSpec.shotsPerRound`, Covering Fire) fires up to that many times per owner round
  instead of once and stays until its duration runs out; see *Mastery Marksman remaster*.
- **A Reaction on one named ally** (`ReactionTrigger` `wardStruck`, Carapace Leap) is cast on a living
  ally in the skill's range (`castReaction`'s `ward`, refused otherwise) and records it as
  `PreparedReaction.wardId`. Only a hostile blow on that ally sets it off, and its subject is the **ally**,
  not the attacker: the answer is aimed at the ward and its reach is measured to the ward.
- **An answer may move its owner.** A Reaction's response resolves with `resolving` and `reacting`
  (`ResolveOptions.reacting`): it costs nothing, as a landing warned attack does, but its own `selfMove`
  happens. A response that moves its owner waits while the owner is Rooted (`canReact(owner, reaction)`),
  the way every Reaction waits out a Stun.
- **Riposte Stance, the first hero Reaction, left with the Bulwark remaster's Set Stance node (2026-10).**
  The Marksman's Covering Fire is the hero Reaction now; fixture skills in `reactions.test.ts` cover the
  one-shot kind, and the `riposte_stance` id remains only for its committed drawing.

## Mastery protection and healing kits

The encounter-answer pass (see the private project notes, "Mastery kits and encounter
answers") gave the Champion paths their counters. Tests: `bulwarkKit.test.ts`, `bulwarkRemaster.test.ts`,
`templarKit.test.ts`.

### Bulwark

The 2026-10 remaster (the private project notes) rebuilt the tree: Spite,
Bulwark's Due, **Shielded Challenge** (centre), Retaliation, Braced on tier 1; the four skills unchanged on
tier 2; Unbreakable Vow, **Shield Avalanche** and **Reckoning** as capstones; **Last Stand** (side tree A,
with Loud and Deep Plates under it) and **Vengeance** (side tree B, with Spite Grows and Anchored) as the
two starters, both with three ranks. Iron Frame, Set Stance (and Riposte Stance) and Bulwark's Immovable
are gone (`SAVE_VERSION` 40). Loud keeps one rank because a whole turn of Taunt cannot be fractioned, so
side tree A costs 7 points to finish like every other side tree; side tree B costs 9.

- **Provoking Strike**, the Bulwark's signature (1.0× Attack and a 2-turn Taunt), costs 4 MP since the
  2026-10-08 playtest; it was free and was the press every turn.
- **Shielded Challenge** (`shieldedChallenge`, `onHit`): a Provoking Strike that lands gives the Bulwark a
  Barrier of `SHIELDED_CHALLENGE_BARRIER` (20 / 30 / 40% of base Attack by rung, authored per rung) for
  `SHIELDED_CHALLENGE_DURATION` (2) turns, through `resolveEffectMagnitudeWith`, so Anchored and gear
  `shieldPower` amplify it and Bulwark's Due applies on arrival. It fires on the hit, so a Taunt the target
  shrugs off (a boss's immunity) still pays out; a dodge does not. A Barrier merges by keeping the larger
  magnitude and the longer duration, so repeated casts refresh rather than stack.
- **Last Stand** (`lastStand`): at or below `LAST_STAND_AT` (30%) health, all incoming damage is cut by
  `LAST_STAND_REDUCTION` (20 / 30 / 40% by rung) through `passives.reduceIncoming`, read in `damageUnit`
  (blows, the ice's burst, reflections, hazards, a fixed burst) and in `tickEffectsOnUnit` (damage over
  time and Doom), before any Barrier. A blow that lands is never reduced below 1. It adds no defence stat.
  Its existing Taunt-immunity pierce (`piercesImmunity` below the threshold) is retained. The enemies that
  carry it (the Cave Bear and the Emerald Dragon) resolve at the middle rung, 30%.
- **Vengeance** (`vengeance`): unchanged trigger; the chance is `VENGEANCE_CHANCE` 25 / 50 / 75% by rung,
  never certain. The refund stays one whole turn.
- **Shield Avalanche** (capstone): `Arc` radius 2 with a `dash` of 4 and a reach of 5. The dash lands on the
  free hex beside the aimed hex nearest the Bulwark, and the cone is drawn from the landing toward the
  aim (`getSkillTargets` reads the moved caster, and `getValidSkillTargetHexes` reads a dash skill's area from
  its landing too, so the far enemy can be aimed at). Aimed from beside it, there is no ground to cover and the
  slam lands from where the Bulwark stands; Rooted, it is refused like any charge. 1.5× Attack physical
  (1.13 / 1.5 / 1.88 by rung) and a one-turn Stun on every enemy in the cone; bosses and Stun-immune
  enemies take the damage only. 24 MP, cooldown 5. Its picture is `shieldwave` (see icons-vfx), which
  `resolveVfxKind` keeps rather than turning a damaging dash into a slash. The spec's `casterPos` and the
  Bulwark's facing are both taken from the landing (`struckFrom`), not the start: until the 2026-10-13
  playtest the wedge opened on the empty start hex and he landed facing back the way he came
  (`bulwarkRemaster.test.ts`).
- **Reckoning** (capstone, `AuraType.Reckoning`): a Barrier of its own, 2× Attack (1.5 / 2 / 2.5 by rung;
  `scaleSkill` now keeps a stat fraction between 1 and 5 fractional instead of rounding it) for two of the
  Bulwark's turns, amplified by shield bonuses like a Barrier. It soaks before an ordinary Barrier
  (`absorbWithReckoning`), in `damageUnit` and in the tick, and stores exactly what it soaks in
  `ActiveEffect.stored`, so each hit counts once and nothing another shield absorbs feeds it. When it is
  spent to nothing, or its last turn ticks away, `combatStore.releaseReckoning` sends a shockwave to every
  enemy within `RECKONING_RADIUS` (2): `RECKONING_BASE` (1.0) × the Bulwark's effective Attack plus the
  stored damage, the stored part capped at `RECKONING_CAP` (2.0) × Attack (`reckoningBurst`). Fixed damage
  through `damageUnit` (no crit, no defence; a Barrier on a victim soaks it), like the Martyr's seal. The
  aura is removed before the release, so the shockwave cannot recharge it. The release events ride on
  `damageUnit`'s `deathEvents` or the tick's events, so the one resolver draws the
  red-gold ring and float its numbers. 22 MP, cooldown 5. While it holds it is drawn as a shield:
  `hpBlocks.isShieldPool` counts a Reckoning's remaining magnitude with every Barrier in `barrierTotal`,
  so the Bulwark wears the `BarrierShell` bubble and the bars show the shield segment and amount, and
  `healthTimeline` holds it with the hit that spends it, as it holds a Barrier.
- **Spite Grows' `thornsMultiplier` is authored as a bonus.** `masteryModifiers` merges a multiplying key as
  the product of `1 + value`, so 0.25 makes the hero's Thorns ×1.25. It had been merged as a bare factor and
  cut Thorns to a quarter.

- **Taunt and Barrier are what the kit is for.** Intercept dashes beside an ally, taunts every enemy in the
  ring and shields the Bulwark and every ally in it (afflictions cross the line, auras do not — the Bulwark
  is always inside its own ring). Challenge taunts a distant enemy *and* keeps its Attack Down. The Barrier
  soaks damage; it does not redirect or cancel a warned area attack.
- **Anchored's `shieldPower` is an outgoing bonus.** It raises Barriers the Bulwark *grants* (Intercept,
  Reposition) through `resolveEffectMagnitude`; it does nothing for a shield someone else puts on the
  Bulwark (Bulwark's Due, `incomingSupportBonus`, is that). Its description says so.
- **A tooltip resolves every status magnitude through the cast's function when it knows the caster**
  (`effectMagnitudeText`), flat Barriers included, so the number on the tooltip is the number that lands.
  That function is `damageCalc.resolveEffectMagnitude`, which reads the caster's **combat-effective**
  stats (`getCombatEffectiveStats`) — the stats the skill's own damage and heal read — so a Barrier or a
  DoT cast under a Magic buff or in a form grows exactly as its heal or hit does. It used to read
  `unit.stats`, so Heal under a buff mended for the buffed number and shielded for the unbuffed one. The
  arithmetic is `statusEffects.resolveEffectMagnitudeWith(stats, …)`, which cannot reach effective stats
  (`effectiveStats` imports it); passives call it directly, and only with flat amounts (Meltwater). An
  enemy's DoT or Doom number on a tooltip is also put through `difficultyDamage`, as its tick is.
- Deep Plates stays a plain HP node, but a percentage one: `maxHpPercentBonus` 0.12 at its authored rank
  (9 / 12 / 15%), applied after gear like every percentage on the sheet.

### Templar healing

- **Smite's incidental heal (`allyHeal`) goes to the most wounded ally by health *fraction*, the caster
  included**, ties to the nearer and then to the id (`combatEvents.allyHealRecipient`, pure and shared by the
  resolver, the AI path and the tests). Wound severity outranks proximity: the old "nearest wounded ally" rule
  would have let the Templar win every time it could choose itself, standing at distance zero. The rule is
  stated on the skill's description (`describeSkill`), with the amount when the caster is known
  (`calculateHealing` with `allyHeal` as the multiplier). The heal event carries `exemptFromTithe: true`.
  Aethelred's Tithe on Mercy keeps the exemption by construction: it is counted only where a hero's
  own skill heals (`skillResolution`'s heal branch) and where a Barrier lands on a hero
  (`combatStore.applyEffect`), and Smite's rider goes through neither.
- **The ally cleanse lives on Divine Light** (`cleanse: true`, radius 3 around the Templar, the Templar
  included). It is paid for with a cut heal (1.3 to 1.1), more mana (18 to 22) and a three-turn cooldown;
  nothing in it restores mana or shortens a cooldown. `cleanse` strips every affliction from allies in
  reach. `skillResolution` counts the afflictions first and raises `applyOnCleanse` only when at least one
  was removed.

### Templar Oath and Zeal

- **Oath** (`oath` passive, trigger `onHeal`) puts a brief Magic Defense ward on the Templar *and* the ally
  after a **direct** heal that actually restored HP or a cleanse that removed an affliction. The ward is
  `AuraType.MagicDefenseBuff` (Magic Defense only; `DefenseBuff` is Physical Defence only): a share of the
  **recipient's own** Magic Defense (`OATH_WARD_SHARE`), floored at `OATH_MIN_WARD` before the node rung scales
  it, for `OATH_WARD_DURATION` (2 = until the end of the recipient's next turn). A repeat **refreshes**
  (the store merges by the stronger magnitude and the longer clock) and never stacks.
  - What triggers it: a skill's healing, Smite's incidental heal, a `cleanse` that removed at least one
    affliction. `applyOnHeal` takes the HP `healUnit` actually restored (`restored`), and a cleanse arrives
    as `applyOnCleanse`, an `onHeal` with `amount: 0` and `cleansed > 0` (so Lifebloom, which reads `amount`,
    stays quiet).
  - What does not: a heal on someone at full health, a cleanse of a clean ally, a heal-over-time or
    Regeneration tick (they write HP directly and never raise the event), and Wrath, which heals nobody.
  - **Area heals**: each ally whose own heal restored HP is warded; an ally at full health in the same ring
    is not; the Templar refreshes its one ward once per effective target.
- **Zeal** (`zeal` passive) replaces the flat Speed/Attack with a **Mercy / Wrath** choice on the one Smite
  (`HeroSkill.modeChoice: 'zeal'`). `systems/combat/skillModes.ts` is the one place the arithmetic lives:
  `skillModesFor` lists the modes at the Zeal rung (`ZEAL_MERCY_STRIKE`, `ZEAL_MERCY_HEAL`,
  `ZEAL_WRATH_STRIKE`; every rung improves every figure) and `applySkillMode` returns the **derived copy** of
  Smite for one cast (same id, range, cost and cooldown; `damage` and `allyHeal` multiplied, Wrath removes
  the heal). The choice panel, the inspector and the tooltip print that copy, and
  `resolveSkillUse(..., { mode })` casts it, so the preview is the resolution. A mode the caster is not
  offered is refused as `unusable` before anything is spent.
- **Flow**: pressing Smite for a Zeal owner (`modeQuestionFor`) opens `ModeChoicePanel` instead of selecting
  the skill. It is a question, not a phase: nothing is selected and no action is spent until a mode is
  chosen, which then selects Smite with `combatStore.selectedMode` and goes on to the normal enemy
  targeting; Cancel (or the back button) only closes the panel. `selectSkill` clears the mode, so a stance
  cannot leak into the next press. The panel is drawn in the combat view's tree like `Dialog`, not in a
  native `Modal`, because it opens over the arena's GL surface.

### Templar remaster (2026-10)

- **Layout**: Zealotry (+Attack/+Magic) at first-row column 0 and Faith (+Magic/+MP) at column 3, Zeal still
  central; Judgement at second-row column 1 and Lay on Hands at column 2. Node ids and effects are unchanged;
  the derived prerequisites follow the new positions (Righteous Fury is now fed by Hallowing Sweep and
  Judgement, Martyr by Judgement and Lay on Hands, Consecrate by Lay on Hands and Divine Light).
  `SAVE_VERSION` 43.
- **Lay on Hands** (`lay_on_hands`) is one cast with two recipients: `SkillTargetType.Single`, range 3,
  `healing` 0.8 (0.6 / 0.8 / 1.0x Magic by rung), `healsCaster: true`, the old 12 MP and cooldown 3. Aimed at
  an ally, the ally and the Templar each receive the whole heal (not a pool split between them); aimed at the
  Templar, the Templar is healed once. `getSkillTargets` adds the caster's hex to the footprint when the aim is
  someone else, so the preview, the resolver and the AI read one list; because the caster is always in it, the
  highlight pass (`getValidSkillTargetHexes`) and the resolver read only the aimed hex to require an ally or
  the caster there, and refuse empty ground or an enemy ("Aim at an ally or yourself").
- **Each heal is a heal for its own recipient**: `calculateHealing` and `healUnit` run per recipient (their
  `incomingSupportBonus`, a phase ceiling), each raises its own `onHeal` with what it restored, and each counts
  for Tithe on Mercy. Blessed Hands therefore puts its regeneration on both. Caster charges cannot double:
  Sacred Rhythm's charge is one `SacredRhythm` aura that a second heal only refreshes (it merges by the larger
  magnitude), Oath wards the ally once and refreshes the Templar's one ward, and Cycle of Life-style per-cast
  counters see one cast. Pinned by `templarRemaster.test.ts`.
- **Martyr** keeps its mechanics (Invulnerability, Debuff Immunity and the seal, 2 turns each; the seal
  detonates on the tick that lifts the protection) and its halo/surge opening. The protection is now drawn as
  a large gold bubble round the protected unit (`MartyrBubble` in `UnitMesh`, shown while
  `wearsMartyrBubble`: the Martyr seal *and* Invulnerability are on, so no other Invulnerability draws it). It
  swells in on the cast's own impact flash, pulses brighter and swells a little on every later flash on that
  unit (a hit the protection blocked), and unmounts with the protection, so the detonation's nova is drawn on
  its own. The fill is a back-side additive sphere and the outline a camera-facing ring, so the body and the
  ground warnings stay readable; it sits within the unit's hex.
- **Simple copy** (`simpleText.ts`): every Templar skill and passive, Smite per Zeal mode, Lay on Hands'
  coefficient resolved to the rank shown, Steadfast's `unstoppable` line shared by every path that grants it.

### Lifewarden emergency healing

Tests: `lifewardenKit.test.ts`.

- **Warding Bloom is a thinner shield with the early ally cleanse** (`cleanse: true`, single ally or the
  caster; the Barrier is `WARDING_BLOOM_BARRIER`, cut from 30 to 18). It is a tier-2 node and, since the
  Evergreen capstone went in the 2026-10 remaster, the path's only cleanse. The tooltip resolves the Barrier
  through the cast's own magnitude function and lists "Removes all afflictions".
- **Second Wind scales with the target's missing HP** through `HeroSkill.healingByMissing`. `healing` is the
  top end (2.8x Magic on a target with almost nothing left); the multiple is
  `healing * (floor + (1 - floor) * missing^curve)` (`SECOND_WIND_FLOOR` 0.15, `SECOND_WIND_CURVE` 2), with
  `missing` the target's missing share of its combat maximum (`damageCalc.missingHealthShare`). At 70% HP that is
  about 0.6x (under Lifebloom's 0.8x), at 10% HP about 2.3x. `calculateHealing(caster, skill, target)` is the
  one arithmetic: the resolver passes the target and the AI path does too; a caller with no target gets the top
  end. Because the floor is a *share* of `healing`, the node rung (which scales `healing`) keeps the curve.
  The chip, the description and a tooltip line state both ends (`healingRange`, computed by the same function).

### Lifewarden remaster (2026-10)

Tests: `lifewardenRemaster.test.ts`, `simpleText.test.ts`. Design and the defaults chosen:
the private project notes (*Lifewarden: implemented 2026-10-07*). Tier 1 is
Cycle of Life, Second Spring, **Shared Bloom** (centre), Lingering Growth, Barkskin; Green Hands, Wellspring
Heart, Verdant and Evergreen are gone (`SAVE_VERSION` 39) and their stats were not redistributed. The
capstones are Wellspring, **Wild Sanctuary** and Awaken Treant; both side starters open from any of them.

- **Shared Bloom** (`sharedBloom`, read by `skillResolution` through `passives.sharedBloomRecipient`):
  Lifebloom's direct heal also heals the caster's living, wounded ally within `SHARED_BLOOM_REACH` (2) hexes
  of the recipient with the lowest share of their effective maximum HP (ties: nearer to the recipient, then
  coordinate), for `SHARED_BLOOM_SHARE` (0.5, so 38 / 50 / 63% by rung) of the primary heal. It is a
  direct heal, so it raises its own `onHeal` (Barkskin, Second Spring and Lingering Growth's passive
  regeneration can follow), but never the signature's Heal Over Time and never a third ally. While
  Lifebloom is aimed, a green link over the heads joins each ally it could target to that ally's second
  recipient, from the same function.
- **Second Spring** (`secondSpring`, `onHeal`): a direct heal that restores HP to an ally (the caster
  included) who stood below `SECOND_SPRING_THRESHOLD` (30%) of their effective maximum **before** the heal
  lays `AuraType.SecondSpring` — `SECOND_SPRING_REDUCTION` (15 / 20 / 25%) less damage, for
  `SECOND_SPRING_DURATION` (2) ticks, through the next enemy interval and the ally's own next turn. Read in
  `damageUnit` before Set Stance and the Barrier, so it cuts every blow and fixed damage that funnel takes
  (effect ticks resolve elsewhere and are not cut). A fresh application refreshes; it never stacks.
- **Cycle of Life** (`cycleOfLife`): a cast whose direct healing restored any HP banks one Growth charge
  (`AuraType.Growth`, magnitude = count, no clock) up to `CYCLE_OF_LIFE_CHARGES` (3); a multi-target heal is
  one charge, regeneration, pulses and empty heals none. With three held, the next **damaging spell**
  (magic-scaled damage; a weapon swing is not one) deals `CYCLE_OF_LIFE_MAGIC` (0.45 / 0.6 / 0.75× effective
  Magic) extra to each enemy it strikes, once per enemy, fixed like a shatter burst (no roll, no defence),
  then the charges go. The bonus is read from the charges held before the cast and the cast's own charge is
  awarded after, so Thornrow can spend three and bank one, never earn and spend the same one.
- **Thornrow** is an aimed `Ring` of radius 1 within range 4 (it was a range-4 Line): 0.6× Magic damage and a
  two-turn Root on enemies in it, a 0.7× heal and a Heal Over Time on allies in it. Broad Bloom widens it to
  radius 2 like any area.
- **Wild Sanctuary** (`HeroSkill.sanctuary`, `systems/combat/sanctuary.ts`): an aimed radius-2 area within
  range 4 (cooldown 5). The cast is an ordinary split cast — 0.45× Magic healing on allies, 0.5× Magic
  damage on enemies — and then the footprint stays as an `ArenaHazard` with `sanctuary`, one per caster (a
  recast replaces it), laid even over empty ground. At the start of each of the caster's next
  `WILD_SANCTUARY_TURNS` (3) **regular** turns, before `tickHazards` counts it down, `pulseSanctuaries`
  heals allies and damages enemies standing in it from the caster's live Magic, with no critical hit, dodge
  or `onHeal`. The first pulse that catches an enemy (the cast's own included) Roots it for
  `WILD_SANCTUARY_ROOT_TURNS` (2); the hazard lists who has had it, so each enemy is Rooted once per cast
  however it steps in and out. A boss refuses the Root and still takes the damage. The ground is drawn by
  `SanctuaryField`: a green slab, vines and large glowing flowers that grow in over a second and breathe.
- **Awaken Treant**: the Treant carries Timber Crush (no cooldown now, still one action), Rootlash and
  **Canopy Guard** — a Self ring of radius 2 laying a Barrier of `CANOPY_GUARD_MAX_HP` (15%) of **each
  recipient's** effective maximum HP for three turns on every ally in it, the Treant included
  (`SkillEffect.ofRecipientMaxHp`, resolved by `damageCalc.resolveEntryMagnitude` on both execution paths).
  The summon AI scores it per ally still missing a Barrier (`supportValue`).
- **Rooted Vitality** lays no Root: it is a three-turn Heal Over Time on one ally or the caster, and its
  copy now says so.

### Stoneshaper remaster (2026-10)

Tests: `stoneshaperRemaster.test.ts`, `stoneHeart.test.ts`, `simpleText.test.ts`. Design and the defaults
chosen: the private project notes (*Stoneshaper: implemented 2026-10-07*). Tier 1
is Aegis, Deep Roots, **Aftershock** (centre), Rubble Recovery, Crumble; Patient Earth, Living Rock and
Stonecutter are gone (`SAVE_VERSION` 44) and their stats were not redistributed. Rung ladders are authored
per level, not scaled.

- **Aftershock** (`aftershock`, `systems/combat/aftershock.ts`): a Tremor that went off, cast by a holder,
  leaves its in-arena footprint as an `ArenaHazard` with `aftershock` (one per owner, a new Tremor replaces
  it). At the start of the owner's next **regular** turn, after Wild Sanctuary's pulse and before
  `tickHazards`, `eruptAftershocks` strikes every enemy still on it for `AFTERSHOCK_MAGIC` (0.2 / 0.3 / 0.4)
  of the owner's live Magic as Tremor's physical hit through the defence formula — no Stun, critical hit,
  dodge or on-hit passive — and removes the mark. A Stun on the owner does not stop it (it lands before the
  turn is lost); the owner dying clears it with its other ground. Drawn by `AftershockField` (cracked
  ground, amber seams throbbing) until it erupts as a `quake`.
- **Rubble Recovery** (`rubbleRecovery`, worked in `combatStore.damageUnit` / `recoverFromRubble`): when a
  blow whose source is hostile to the recipient empties a Barrier, the Barrier's `sourceUnitId`, if it holds
  the node and stands, heals the recipient for `RUBBLE_RECOVERY_MAGIC` (0.15 / 0.25 / 0.35) of its effective
  Magic. Expiry and dispels never pass through that funnel, so they never count; a Barrier that holds does
  not count. Each recipient once per Stoneshaper turn (`CombatUnit.rubbleRecovered`, cleared at the owner's
  regular turn start). The Stoneshaper's own self-Barrier counts.
- **Crumble** (`crumble`, replacing Stonecutter): a Stun or Root that a holder lands on an enemy is stamped
  in `applyEffect` with `ActiveEffect.crumble` = `CRUMBLE_SHRED` (5 / 6 / 7). `getCombatEffectiveStats`
  takes, per source, the largest crumble on that unit's Stuns and Roots and subtracts the sum from both
  Physical and Magic Defense (under the usual shred floor). The shred therefore lives exactly as long as the
  control: expiry, cleanse or removal ends it, a refused control (immunity, boss disable, Debuff Immunity)
  never carries one, an overlapping Stun and Root from one owner strip it once, and an ally's control
  carries none. A re-applied control keeps the larger crumble either side carried. No earth hit is needed;
  `earthSkills.ts` went with Stonecutter. The log names the shred as the control lands.
- **Stoneskin**'s Barrier is `STONESKIN_BARRIER` 0.7 of Magic (doubled from 0.35); its Defense buff
  (8, four turns) and the Barrier's three turns are unchanged.
- **Stone Heart** has no cooldown: each of its three stages is still a cast and a mana payment. While the
  caster's finished last stage (`finishedStageUnit`, the Stone Elemental) stands, the skill offers no hexes,
  the resolver refuses it, and `skillBlockedReason` (fed the board) says *Your Stone Elemental still
  stands*; it frees the moment the elemental dies or is removed. A stage stone broken mid-build resets the
  chain to a fresh stone. Each Stoneshaper's lock reads only its own elemental.
- **Bedrock Stand** is `arenaWide`: because it also helps its own side (`skillTargetKind` 'mixed'),
  `arenaWideHexes(..., withAllies)` gives every living enemy **and** every living ally in the arena, the
  caster included (allied objectives excluded). Enemies take 0.6× Magic and `DefenseDown`; allies get the
  Barrier. It needs an enemy on the board to be cast; preview, flash and camera use those bodies and the
  playable arena only; range and radius modifiers change nothing.
- **Living Stone** keeps 1.4× Magic physical damage, radius 2 and a two-hex push, drawn by the `upheaval`
  shape (see `icons-vfx.md`). Each body it pushes carries `movement.shoveDelayMs` (prelude plus
  `UPHEAVAL_IMPACT_MS`), so `UnitMesh` holds it in place until the slabs land and then throws it along its
  line (`SHOVE_MS`, a `knockUp`), instead of walking it there before the impact.
- **The cleanse is on Stone Ward** (`cleanse: true`, one ally or the Stoneshaper). The cleansing shell is the
  weakest in the kit: `STONE_WARD_BARRIER` (0.7) of Magic, 16 mana, cooldown 3; it restores nothing.
- **Unyielding** (`unyielding` passive, `statMod`): while the Stoneshaper has a Barrier with HP left, whether it
  cast it or someone else did, it gains `UNYIELDING_DEFENSE` Physical **and** Magic Defense, scaled by the rung
  (4 / 5 / 6). It reads `activeEffects`, so it is off the moment the Barrier is spent.
- **Seismic Sense** (`seismicSense` passive, `onTurnStart`): at the start of a regular turn on a hex that a
  warned attack from the **other side** names (`preparedAttacks.threatensUnit`, built on `affectedBy`, so it is
  exactly the HUD's "who it will hit"), the unit gets `AuraType.SeismicStep` (duration 2, so it covers this
  turn and is stripped by the next turn's tick), which `getCombatEffectiveStats` reads as extra `moveRange`:
  `SEISMIC_SENSE_MOVE` per rung, +1 / +2 / +3 hexes. A bonus turn does not re-roll it.
- **Grounded Focus** replaces Ballast: after a regular turn without voluntary movement, the next regular turn gains 10/15/20% Magic and outgoing Barrier strength. Forced pushes do not break focus; bonus turns neither grant nor expire it.

### Firefly: Glowmote, the feeders and the four actives (Monk)

Tests: `fireflyKit.test.ts`, `fireflyRungs.test.ts` (every share a rung scales is a multiple of 20%, so
each rung reads a multiple of 5%: playtest 2026-10-23 found 41% and 69%). Design: the Monk plan, "### Firefly". The Monk's
support path heals by hurting. Its tree is the signature, five feeders, four actives, the three capstones
([below](#firefly-the-three-capstones-monk)) and the two side trees
([below](#firefly-the-side-trees-and-the-copy-monk)), held to every whole-tree suite.
Numbers are `BALANCE.FIREFLY`; skills `data/skills/mastery/firefly.ts`; rules `systems/combat/fireflyRules.ts`.
Every cost is chi, and the signature costs chi too: a free one would always beat the Basic Attack and the
chi loop would never turn.

- **Glowmote** (signature, `CHI.SIGNATURE` = 14 chi): a range-3 bolt for 0.9× Magic, magic damage. `HeroSkill.mote` sends
  `MOTE_SHARE` (40%) of what the cast dealt to the living ally within `MOTE_REACH` (2) hexes **of the Firefly**
  with the lowest health fraction (ties: nearer, then id), the Firefly left out; only when nobody else in
  reach is hurt does it return to the Firefly (`moteRecipient`). Resolved after the cast in
  `combatEvents.applyMote`, off the summed damage like Smite's spill, so a dodge sends nothing. The heal
  raises `onHeal`. A small amber bolt is drawn from the struck hex to the recipient.
- **Brighter Motes** (centre, `brighterMotes`): the mote heals `BRIGHTER_MOTE_SHARE` (60%, 45 / 60 / 75% by
  rung) and reaches `BRIGHTER_MOTE_REACH` (3) hexes at every rung.
- **Glowing Wraps** (+3 Magic, +2 Magic Defense) and **Wingbeat** (+2 Speed, +8 chi, the path's chi-pool
  node) are stat nodes. The path's growth is +2 Magic per level (`MASTERY_GROWTH.firefly`), no flat HP.
- **Lantern Breath** (`lanternBreath`): when Meditate pays out, every living ally adjacent to the Monk at
  that moment heals `LANTERN_BREATH_SHARE` (60%, 45 / 60 / 75% by rung) of the Monk's own heal. The store's `payMeditation`
  applies it through `fireflyRules.lanternBreathShares`.
- **Afterglow** (`afterglow`, `onHeal`): an ally the Firefly heals — not the Firefly itself, and only by a
  heal that restored HP — gains `AttackBuff` and `MagicBuff` for `AFTERGLOW_DURATION` (2, "a turn"). Laddered
  a point a rung round the authored 2 (1 / 2 / 3): the scale cannot ladder a 2 without a dead rung. Lantern
  Breath lays the same pair (`passives.afterglowEffects`), since its heal raises no `onHeal`.
- **Lantern Sweep** (20 chi, cooldown 1): a self-centred `Ring` of radius 2, 0.7× Magic to enemies, 0.4× Magic
  healing to allies. `HeroSkill.sparesCaster` keeps the Firefly at its centre out of the heal. Like
  Whirlwind it is offered only with an enemy inside.
- **Lightbond** (20 chi, cooldown 2): `targetSide: 'ally'`, range 3, lays `AuraType.Lightbond` on the ally
  (magnitude `LIGHTBOND_SHARE`, the percentage, 45 / 60 / 75 by rung; `LIGHTBOND_DURATION` 3 ticks of the
  ally's clock, which is the Firefly's next two turns). `combatEvents.applyLightbond` heals the bonded ally
  that share of **each blow** the Firefly lands — once per damaging event, so a sweep through two enemies is
  two heals — called beside every `damageUnit` in `resolveSkillUse`. Never from damage the Firefly takes or
  somebody else deals. One bond per Firefly: `applySkillStatus` lifts its old bond as a new one lands.
- **Purifying Light** (15 chi, cooldown 1): range 3, `cleanse` plus 0.6× Magic healing, on an ally or the
  Firefly.
- **Lantern Glide** (15 chi, cooldown 1, `freeAction`): Thunderstep's shape — a `Ring` of radius 1 round a
  `blink` of up to 3 hexes to a free hex — with 0.4× Magic healing on the allies beside the landing and the
  Firefly spared. It does not end the turn.

### Firefly: the three capstones (Monk)

Tests: `fireflyCapstones.test.ts`. The three tier-3 nodes share `exclusiveGroup: 'capstone'`. Each costs
**`CHI.CAPSTONE` (30) chi**, so a capstone and one regular spell empty the 45 pool — what keeps the chi loop turning. Numbers are
`BALANCE.FIREFLY`; the board halves are `systems/combat/fireflyGround.ts`, the pure halves `fireflyRules.ts`.

- **Firefly Motes** (cooldown 4, "every fifth turn"): self-cast. `HeroSkill.motes` lays `MOTES_COUNT` motes
  (3 / 4 / 5 by rung, `perRank.motes`) on distinct free hexes within `MOTES_RADIUS` (2), drawn from the
  combat dice (`fireflyRules.moteHexes`; free means no living unit, no solid ground, no mote). Each is a
  one-hex `ArenaHazard` carrying `mote.heal`, fixed at the cast from the Firefly's Magic × `MOTE_HEAL` (1.0,
  scaled by rung) through `calculateHealing`. No free ground refuses the cast. A mote fires on **arrival by
  any route**, because every route ends in `combatStore.moveUnit` — a walk, a dash or blink landing, a shove:
  the landing hex only (a walk through one leaves it), and the first arrival spends it. An ally of the
  Firefly (the Firefly included) heals the fixed amount and gains `AttackBuff` `MOTE_ATTACK` (6) and
  `CritBuff` `MOTE_CRIT` (10) for `MOTE_BUFF_DURATION` (2, on the bearer's clock); an enemy only puts it
  out. The heal is the store's, so it raises no `onHeal` (Afterglow does not ride it). Motes last the fight
  while the Firefly lives — `tickHazards` clears ground whose owner is gone. The AI's moves never read
  them: an enemy puts one out only by passing that way (pinned: the same plan with and without motes).
  The arena draws them as `MoteField`, lit amber specks over a faint glow (`boardOverlays.moteHexes`).
- **Firefly Swarm** (cooldown 3, "every fourth turn"): an aimed `Ring` of radius 1 within 3, 1.2× Magic,
  magic damage, `Silence` for `SWARM_SILENCE_DURATION` (2, "a turn") and `AttackDown` `SWARM_ATTACK_DOWN`
  (6) for `SWARM_ATTACK_DOWN_DURATION` (3, "two"). A boss refuses the Silence through
  `BOSS_IGNORED_DISABLES` and keeps the damage and the Attack Down.
- **Lantern Beacon** (cooldown 5, "every sixth turn"): an `aimed` summon on a free hex within 2, template
  `lantern_beacon` — a **stationary companion**: no turn and no place in `turnOrder`, never follows its
  Firefly (`SummonTemplate.stationary`), one per Firefly (a recast replaces it), fades if the Firefly falls.
  Its maximum HP is `BEACON_HP_SHARE` (40%, scaled by rung) of the Firefly's (`SummonSpec.ofCasterMaxHp`).
  At the start of each Firefly regular turn `turnStart.tickCompanions` calls `fireflyGround.tendBeacon`:
  first it heals every living ally within `BEACON_RADIUS` (2) of it — never itself — `BEACON_HEAL` (0.5) ×
  the Firefly's Magic, then it loses `BEACON_DECAY` (a third, rounded up) of its maximum through
  `damageUnit`, so unhealed it burns out on the third Firefly turn after the cast, pulsing on all three.
  Any heal reaches it — Glowmote's mote picks it like any hurt ally, Lantern Sweep, Purifying Light and
  Lantern Glide take it — and enemies can strike it to death. Its light is two auras with no clock, laid
  and lifted by `combatStore.syncBeacons` (`fireflyRules.syncBeaconLight`) after every move, arrival and
  Beacon death: allies within 2 wear `BeaconLight` (+`BEACON_CRIT` (10) Critical Chance, read by
  `getCombatEffectiveStats` like `CritBuff`); enemies within 2 wear `BeaconLit` (`BEACON_EXPOSED`, +15%
  damage taken, added in `exposedMultiplier`), lose any Stealth and are refused a new one (`applyEffect`).
  The model is `buildLanternBeacon` in `voxel/models/summons.ts`: a lit amber lantern on a post in a stone
  foot.

### Firefly: the side trees and the copy (Monk)

Tests: `fireflySideTrees.test.ts`; the economy (six points to each capstone, fifteen for each capstone
raised with either side tree) is measured in `treeEconomy.test.ts`. With these the Firefly is a whole
tree. Numbers are `BALANCE.FIREFLY` at rank two. Both
starters are one rank and open with any capstone point, like every path's.

- **Far Light** (`farLight`): Glowmote, Lightbond and Purifying Light (`fireflyRules.FAR_LIGHT_SKILLS`)
  gain `FAR_LIGHT_RANGE` (1) range. A passive rather than `skillRangeBonus`, because the plan names three
  skills: Lantern Glide's blink, the Swarm's aim and the Beacon's plant keep their reach. Baked into the
  kit by `fireflyRules.withFarLight` in `unitFactory.playerUnitFor`, beside Blood Rush, so the highlight,
  the range check and the inspector read one range. The mote's reach is not a range and does not grow.
  - **Kindled Light**: `healPower` 20 (15 / 20 / 25 by rung), so every heal the Firefly casts — the
    mote's share is of damage dealt and is not one — is stronger through `calculateHealing`.
  - **Steady Flame** (`steadyFlame`, `onSkillResolved`): a cast that leaves an ally — the Firefly aside —
    with more health than it began with (`healedAlly`, compared in `resolveSkillUse`) returns
    `STEADY_FLAME_CHI` (1 / 2 / 3 by rung) through the passive `mana` outcome. **Once a cast**, however
    many it mended, so Lantern Sweep cannot pay for itself; the mote, the bond and a Basic Attack's bond
    heal all count. It lands after the cast is paid for, so a Firefly casting from a full pool keeps it.
- **Twin Motes** (`twinMotes`): Glowmote's mote heals `TWIN_MOTES` (2) allies, each for the whole mote —
  the two most hurt others in reach by the same order as one (`fireflyRules.moteRecipients`); the
  Firefly fills a place only when fewer than two others are hurt. `combatEvents.applyMote` returns one
  outcome per ally mended.
  - **Bright Bolt**: `singleTargetDamageBonus` 0.2. The Firefly's only single-target damage is Glowmote
    and the Basic Attack bolt, which is exactly what the plan names; the sweep and the Swarm are areas.
  - **Second Light** (`secondLight`, `onHeal`): a heal that takes an ally (never the Firefly) from below
    `SECOND_LIGHT_THRESHOLD` (half) of its health to above it lays a Barrier of `SECOND_LIGHT_BARRIER`
    (0.4, 0.3 / 0.4 / 0.5 by rung) × the Firefly's Magic for `SECOND_LIGHT_DURATION` (3) turns. It reads the
    pre-heal snapshot `applyOnHeal` is handed, so it fires for the skill heals, the mote and the bond;
    the Beacon's pulse, a mote on the ground and Lantern Breath raise no `onHeal` and do not.
- **Copy.** Every Firefly skill and passive has a Simple line in `data/display/simpleText.ts`. The
  Detailed view's derived sentence now names Glowmote's mote (`describeSkillSegments`, with the
  caster's share, reach and Twin Motes), says "blink" for every blink but Shadowstep's step through
  shadow, and plants the Beacon rather than calling it to your side; `skillDisplay.fireflyLines` adds the
  rules the sentence has no words for — who the mote and the bond reach, that the sweep and the glide
  spare the Firefly, that the glide leaves the action, what a mote waits for, the Swarm's boss rule and
  the Beacon's turn and light. The six side nodes borrow drawn orphan pictures through
  `NODE_PICTURE_LOANS` until their own are approved.

### Beetle (Monk): the signature, the feeders and the four actives

The Monk's plate path, the bodyguard that protects by standing between (design and numbers:
the Monk plan). Skills in
`data/skills/mastery/beetle.ts`, its rules in `systems/combat/beetle.ts`, every number in `BALANCE.BEETLE`
at rank two. The capstones and the two side trees are below. Tests: `beetleTree.test.ts`.

- **Every cost is chi, the signature's too.** Iron Carapace 14 (`CHI.SIGNATURE`); Horn Sweep 20 (every other turn,
  `cooldown: 1`); Carapace Leap 20 and Grip and Throw and Shell Wall 25 (every third turn, `cooldown: 2`).
  A free signature would always beat a Basic Attack and the chi loop would never turn.
- **Every Barrier the Beetle grants is a factor of Physical + Magic Defense**, read from its
  combat-effective stats as the Barrier is laid: `SkillEffect.scaling: 'defense'` on the entry
  (`statusEffects.scalingPower`, summed, not averaged), honoured by `resolveEntryMagnitude` and the
  tooltips. Shell Wall's 0.38, Carapace Leap's 0.45 for each of the
  two, Shell Swap's 0.42; shield bonuses amplify them like any Barrier.
- **The Barrier skills climb a steeper rung curve** (`HeroSkill.perRank.barrierScale` =
  `BEETLE.BARRIER_RANK_SCALE` [0.7, 1, 1.4], read by `mastery.scaledEffects` for Barrier entries only, the
  Leap's nested response included) in place of the global `LEVEL_SCALE` [0.75, 1, 1.25]. By rung:
  Carapace Leap 0.315 / 0.45 / 0.63, Shell Wall 0.266 / 0.38 / 0.532, Shell Swap 0.294 / 0.42 / 0.588.
  Passive Barriers (Shell Ward) keep the global curve.
- **The PT-04 buff (playtest 2026-10-22), verify in playtest**: the protector read too soft. Damage +10%
  (Iron Carapace 1.1, Horn Sweep 1.1, Grip and Throw 1.0), path growth +2 / +2 Physical and Magic Defense
  (was +1 / +1), Carapace charge 4 Defense (was 3), Planted Guard +6 (was 4), Shoulder to Shoulder 15%
  (was 12%), and every Barrier above raised: Hardened Shell 0.20 → 0.30, Shell Ward 0.20 → 0.30, Leap
  0.30 → 0.45, Shell Wall 0.25 → 0.38, Shell Swap 0.30 → 0.42.
- **Iron Carapace** (signature): 1.1× Attack on an adjacent enemy, and the cast banks a Carapace charge
  (`AuraType.Carapace`, a count held with no clock), dodged or not, up to `CARAPACE_MAX` (3). Each charge is
  `CARAPACE_DEFENSE` (4) Physical Defense (`getCombatEffectiveStats`). **At a full set the next hostile blow
  is soaked whole** (`damageFunnel.takeDamage`: the ice's burst with it, ahead of Last Stand, a Reckoning
  and any Barrier, so a Barrier under the shell is kept) and the charges are spent. It counts as `absorbed`, so a Reaction still sees a blow land and the ice still breaks; a
  damage-over-time dose, a hazard with no author and the Beetle's own price are not blows and pass through.
  **The charges are drawn on him** (PT-06, playtest 2026-10-22): `CarapacePlates` (`arena/statusVisuals.tsx`)
  hangs one tan-rimmed olive shell plate per charge in a slow ring round his chest (`carapacePlateRing`, pure,
  up to `CARAPACE_PLATES_MAX`), glowing and lifted when the set is full, so the soak is read off the body; the
  status row's Carapace icon carries the count as dots, read from the aura's magnitude as Jade Taint's is.
- **Thick Plates** +3 Physical / +2 Magic Defense; **Steady Breath** +2 Attack and +8 chi (the path's one
  pool node — the tree screen and the Simple copy say "+8 Chi", `masteryDisplay.nodeStatLabel`).
- **Shell Breath** (`shellBreath`): Meditate refills `SHELL_BREATH_CHI` (6 at rank two) more chi with its
  own (`chi.chiRefill`'s `extra`) and banks one Carapace charge.
- **Hardened Shell** (`hardenedShell`, the centre; reworked in the playtest of 2026-10-28, the first step of
  the Beetle's rework, verify in playtest): **Iron Carapace's reach**, `HARDENED_SHELL_REACH` (2) at rung one
  and a hex more each rung (2 / 3 / 4, `passiveFormulas.hardenedShellReach`). `passives.withHardenedShell`
  bakes it into the unit's Iron Carapace when the unit is built, beside Blood Rush, as `range` and a `dash`
  of one hex less. What the strike does depends on where it is struck from (`beetle.ironCarapaceAt`, read
  in the resolver after the target is known): **from beside the target** it adds a Taunt for one round
  (`HARDENED_SHELL_TAUNT_TURNS`, two ticks) and ends the turn as usual; **from further off** the Beetle
  dashes to the free hex beside the target, strikes, and the cast is a `freeAction`, so the turn does not
  end (chi is still paid). The dash-strike lands at a share of the skill's damage by rung,
  `HARDENED_SHELL_DASH_DAMAGE` ⅓ / ⅔ / all (`passiveFormulas.hardenedShellDashDamage`; playtest
  2026-10-29, the free dash made the Monk too strong); a strike from beside the target keeps its whole
  damage. The skill's tooltip number is the whole blow. It no longer raises the strike (1.2×) or shields
  the Beetle's neighbours when a full carapace soaks.
- **Shoulder to Shoulder** (`shoulderToShoulder`): a unit beside a Beetle of its side that owns it takes
  `SHOULDER_REDUCTION` (15%) less from every blow — in the funnel after Second Spring, the same blows it
  trims, never a tick; two Beetles do not stack, the best one counts; the Beetle's own blows are its own.
  **Always visible**: `beetle.fightStartAuras` lays `AuraType.ShoulderGuard` (a badge, duration −1) on the
  Beetle when it is fielded, so it shows on the unit and the HUD all fight, and `ShoulderRing`
  (`boardOverlays.shoulderHexes`) draws a faint amber outline on its six neighbours wherever it stands.
- **Horn Sweep**: a depth-1 `Arc` (three hexes) for 1.1× Attack; each enemy hit is pushed a hex and takes
  an Attack Down of 4 for its next turn (two ticks).
- **Carapace Leap**: a Reaction **on one named ally** (`ReactionTrigger` `wardStruck`,
  `PreparedReaction.wardId`), cast on an ally within four hexes and spending the whole turn. For three (`REACTION_TURNS`) of the
  Beetle's turns, the first hostile blow on that ally fires its answer: a dash to the free hex beside the
  ally nearest the Beetle (reach `LEAP_REACH`, 6) and a 0.45 Barrier on each — the ward's from the aura
  entry, the Beetle's from a `selfOnly` entry. Once, then spent. **The shield lands before the blow**
  (playtest 2026-10-17, PT-09): the resolver calls `beetleMoves.shieldWard` (rule `beetle.wardCover`) for
  each damaging blow on a ward, after Vengeful Shell's interception and before the damage is read, so the
  ward's new Barrier soaks that blow; area blows count too. Damage that does not pass through the
  resolver (a tick, a hazard) still sets it off afterwards through the ordinary `wardStruck` event. **Rooted, it waits** (`canReact` with the
  reaction: a response that moves its owner does not fire while the owner is Rooted), as a Stun makes it
  wait. Blows on other allies do not set it off. The answer turns the Beetle toward the attacker once it lands.
  **Aiming it** (PT-06): it lights living allies in range other than the Beetle, never an objective
  (`castReaction` refuses one as a ward), in support green — `skillTargetKind` reads a Reaction with no
  payload of its own by its response. With a Reaction already standing the button is dimmed (the
  `reaction` guard above).
- **Grip and Throw**: 1.0× Attack on an adjacent enemy, a three-hex shove straight away that stops before
  the first unit, objective, solid ground or edge (`traceForcedMove`), and a one-turn Stun. **A target that
  can be neither thrown nor stunned takes 1.5× Attack instead and nothing else** (`immovableVariant`,
  `beetle.immovableTarget`): a boss always, since it is too heavy to lift and keeps no Stun; anything else
  only when it is both Immovable and immune to Stun.
- **Shell Wall**: a self-centred `Ring` of radius 2 — the Beetle and every ally in it gain a 0.38 Barrier
  for three turns. Cast by its button with or without an enemy near (PT-06), as is Carapace Bastion.
- Pictures are borrowed until the Monk's are drawn (Provoking Strike's, the antlers' charge, Intercept,
  the bear's grapple, the shield wall); the five feeder nodes draw their initial and are listed in
  `icons.test.ts`'s `NODES_AWAITING_ART`.

### Beetle (Monk): the capstones

Three exclusive tier-3 nodes (`exclusiveGroup: 'capstone'`), each `CHI.CAPSTONE` (30) chi so a capstone and one
regular spell empty the 45 pool. The store-side half is `systems/combat/beetleMoves.ts`; the pure rules are in
`beetle.ts`. Tests: `beetleTree.test.ts`.

- **Vengeful Shell** (30 chi, every fifth turn, `cooldown: 4`): a Reaction from the Beetle's own hex,
  spending the turn, ready for three of its turns (`VENGEFUL_TURNS` = `REACTION_TURNS`) and **judged before the blow lands**
  (`ReactionTrigger` `interceptAlly`, reach `VENGEFUL_REACH`: 2 / 3 / 4 by rung, `perRank.reach`, since the
  playtest of 2026-10-28). In the resolver's target loop, before
  anything about a blow is read, `beetleMoves.interceptBlow` asks `beetle.vengefulCover`: a hostile
  single-target blow (`beetle.takeableBlow` — `Single`, no radius, ricochet, random strikes, knife dance or
  arena-wide reach) on a living ally within reach of a Beetle holding one, with an answer left this
  round. The Beetle leaps to the free hex beside the ally nearest it (or stays, already beside them), and
  the blow strikes the Beetle instead — its dodge, its defences, its carapace and Barrier; the blow's
  statuses follow it (`shovedFrom`). The intercept spends one of `VENGEFUL_ANSWERS` (2) a round, refilled at
  the Beetle's regular turn start, and queues a `ReactionEvent` `intercepted`; `flushReactions` then fires
  the answer, 1.2× Attack (`VENGEFUL_STRIKE`) at the attacker wherever it stands (`VENGEFUL_STRIKE_RANGE`,
  the whole arena — the plan's "strikes the attacker" names no range; whether it wants one is to verify in
  playtest, the Monk plan). Each intercept is one answer; the
  usual watch dedupe and per-flush count do not apply. A Root holds a Beetle that would have to leap; one
  already beside the ally still takes the blow. Stunned or frozen, it takes nothing. An area blow, a blow
  at the Beetle and a blow at an ally out of reach land where they were aimed.
- **Carapace Bastion** (30 chi, every fifth turn): a self-centred `Ring` of radius 1 / 2 / 3 by rung
  (`BASTION_RADIUS` at rank two with `perRank.radius`, since the playtest of 2026-10-28) whose cast lays
  static ground (`HeroSkill.bastion` → an `ArenaHazard` with `bastion: { share }`, one per Beetle, counted
  down at its regular turn starts for `BASTION_TURNS` 2). **`damageFunnel.damageUnit` splits a blow**: an
  ally of the owner standing on it, struck by a hostile blow (an author on the other side; not a
  damage-over-time dose, not a backlash, not a price), hands the owner `floor(blow × BASTION_SHARE)` — the
  run difficulty settled once on the whole blow first — which goes down the Beetle's own funnel (carapace,
  Barrier, death) before the ally takes the rest down its own. The Beetle's own blows are never split.
  `DamageResult.shared` reports the share; the resolver floats the ally's remainder and the Beetle's number
  rides in `deathEvents`. `BastionField` (`boardOverlays.bastionHexes`) draws the seven amber plates where
  the staff fell.
- **Shell Swap** (30 chi, every fourth turn, `cooldown: 3`): aimed at an ally within `SWAP_RANGE` (4)
  hexes (`HeroSkill.swapsPlaces`). `beetleMoves.swapPlaces` moves both bodies at once — the Beetle onto the
  ally's hex, the ally onto the one it left — before the footprint is read, so the skill's 0.42 Barrier
  lands on the Beetle through the footprint and on the ally from the swap; every enemy beside the Beetle's
  new hex is shoved `SWAP_PUSH` (1) directly away and takes an Attack Down of 4 for its next turn. Root on
  the Beetle refuses it; an enemy or an ally out of reach is refused.
- Pictures are borrowed (Riposte's stance, the Stoneshaper's ward, Reposition) and listed in
  `icons.test.ts`'s `AWAITING_ART`.

### Beetle (Monk): the side trees

Both starters are one rank and open with any capstone; each child holds three ranks, its number authored
at rank two (the private project notes, "Beetle", Side A and B). Numbers in `BALANCE.BEETLE`. Tests:
`beetleSideTrees.test.ts`.

- **Second Watch** (`secondWatch`, side A's starter): the Beetle may stand **two** prepared Reactions
  (`SECOND_WATCH_REACTIONS`) where every other unit stands one — Carapace Leap beside a Vengeful Shell.
  `beetle.reactionLimit` is read by `reactionCast`; `reactions.canPrepareReaction(owner, reactions, limit)`
  refuses a cast at the limit (`already-prepared`), and `combatStore.addReaction(reaction, limit)` keeps
  the owner's newest `limit − 1`. Each Reaction keeps its own clock, answers and trigger.
- **Lasting Shell**: a node `modifier` (`shieldPowerBonus` 0.3), no passive — the shared shield bonus is
  applied to the resolved magnitude, so every defence-scaled Barrier the Beetle grants is 30% larger.
- **Retribution** (`retribution`): an attacker whose blow a Vengeful Shell took, or a Carapace Bastion split
  (`DamageResult.sharedBy`), is struck back at once by `beetleMoves.retribute` — 0.45 × Attack
  (`RETRIBUTION_STRIKE`), a certain blow (no dodge, no critical) answered by Physical Defense, wherever the
  attacker stands. It lands as the blow does, ahead of the Vengeful answer, and is read only at the
  resolver's main strike (a warned boss attack or a tick that the Bastion splits is not answered).
- **Numbing Staff** (`numbingStaff`, side B's starter): a Basic Attack that lands lays Attack Down
  (`NUMBING_ATTACK_DOWN`, 3) and **Magic Down** (`AfflictionType.MagicDown`, "Dulled", 3) for two ticks —
  the enemy's next turn — so it hits and casts weaker. Read off the blow's skill like Bleeding Blades; a
  killing swing numbs nobody. Magic Down subtracts from Magic in `getCombatEffectiveStats` under the shred
  floor, and its mark is the Magic boon's star with a crack through it.
- **Heavy Hands** (`heavyHands`): Horn Sweep and Grip and Throw at ×1.2 on their multipliers
  (`beetle.beetleStrikeMultiplier`), Grip and Throw's boss blow included.
- **Planted Guard** (`plantedGuard`): +6 Physical and Magic Defense (`PLANTED_GUARD_DEFENSE`) while
  `passives.planted` — the Beetle's last turn ended without a step of its own (`previousTurnStationary`)
  and it has not stepped since (`voluntaryMoved`). A shove, a throw or a Reaction's leap does not break it;
  nothing on the first turn of a fight.
- Copy: every Beetle node and skill has Simple text (`simpleText.ts`) and detailed copy (its node line,
  the skill's description, the passive's description and figures). Detailed is never shorter than
  Simple (playtest 2026-10-30): Iron Carapace's and Twin Reap's Detailed lines
  (`skillDisplay.monkSignatureLines`) state the charge and soak, the Bleed reap, and what a held Hardened
  Shell, Bleed Harvest or Reaping Momentum adds, which the derived sentence cannot.
- While Vengeful Shell is prepared, the hexes it covers are outlined round the Beetle in the shell's
  olive (`boardOverlays.interceptHexes`, `InterceptRing`, playtest 2026-10-30), as Shoulder to
  Shoulder's ring is in amber: an ally must stand inside it to be covered. The six side nodes are on
  `icons.test.ts`'s `NODES_AWAITING_ART`.
- Captures: the visual-baseline harness's `enemyTurn(name)` hands the turn to a named enemy so the
  scene's own AI plays it, which is how an interception, a Bastion split and Retribution are seen in
  the app (the captures).

## Mastery Bleed and Burn payoffs

The same pass turned five flat-stat side nodes into decisions. Tests: `berserkerBleedKit.test.ts`,
`pyromancerBurnKit.test.ts`. None of them restores mana or HP.

### Berserker: Savage Edge and Killing Eye

- **Savage Edge** (`savageEdge` passive, `onHit`): a **critical** hit on an enemy that was already **Bleeding**
  (read from the pre-strike snapshot, so the Bleed a skill lays in the same cast does not count, and a Rend on a
  clean enemy does nothing) deals one immediate Bleed tick: that Bleed's own magnitude times
  `SAVAGE_EDGE_TICK` times the rung scale (75 / 100 / 125%), at least 1. It is plain damage through `damageUnit`
  (a Barrier eats it), leaves the Bleed's duration and magnitude alone, and gives the Berserker nothing back.
  **At most once per enemy per turn**: the passive returns a `spend` outcome (`savageEdge:<self>:<target>`),
  stored in `combatStore.spentThisTurn` against `turnSerial` and handed back to passives as
  `PassiveContext.turnSpent`. A Carnage double swing or a Whirlwind pass that crits several times on one enemy ticks
  it once; the next turn (a bonus turn included) starts empty. A dead target is not ticked.
- **Killing Eye** (`killingEye` passive): `KILLING_EYE_CRIT` points of critical chance (9 / 12 / 15) against a
  **Bleeding** target only. It is a `PassiveDef.critAgainst`, not a stat: `damageCalc.critChanceAgainst` adds
  `passives.critBonusAgainst` to the attacker's stat chance for that target, and every roll
  (`resolveAttack`, poison burst, death burst) and the AI's `expectedDamage` use it, so the number rolled is the
  number scored. The hero sheet's Crit therefore shows the unconditional figure; the node text and passive figures
  say "against Bleeding enemies only".
- Reckless and Offhand Fury are unchanged stat anchors.

### Pyromancer: Firemind, Spark and Detonation

- **Burn stacks** are now counted: `mergeEffect` increments `ActiveEffect.stacks` for each Burn application
  (`statusEffects.burnStacks`, one when absent); the magnitude still adds and still caps at `MAX_BURN_MAGNITUDE`.
- **Firemind** (`firemind` passive): Cinder Burst's mana cost falls by `FIREMIND_DISCOUNT_PER_STACK` (2 / 3 / 4)
  for each Burn stack beyond the first on its target, capped at `FIREMIND_MAX_DISCOUNT_SHARE` (half) of the price,
  so it is cheaper, never free and never a refund. `manaCost.manaCostFor(caster, skill, target)` is the one
  function: `resolveSkillUse` reads it before the strike (the strike spends the Burn) and pays that, and the skill
  inspector's `manaCostNotes` prints each burning enemy's price from the same call. The hotbar still lists and
  gates on the base price, so a cast needs the listed mana to begin and pays the discounted amount.
- **Spark** (`spark` passive, `onBurningDeath`): when a Burning enemy dies, from a blow or from its own fire,
  `combatStore.spreadSpark` spends its Burn and fires the passive on the unit that applied it. One stack's share
  of the pile (scaled by the rung) lands on the nearest living enemy of the same side within `SPARK_RANGE`
  (1 / 2 / 3 hexes) that is not already burning, ties by lowest HP then id. Objectives, the Pyromancer's own side
  and units immune to Burn are never recipients, and a fallen Pyromancer passes nothing. A kill by Cinder Burst
  itself still spreads (the fire leaps as the body falls). The passed stack keeps the Pyromancer as its source,
  so it can chain.
- **Detonation** (`detonation` passive, `onDetonate`): where a detonating skill spends a Burn on an enemy
  (Cinder Burst, Immolation), `applyOnDetonate` lays an `ArenaHazard` on that hex: `ignites`, non-solid, named by
  its `passiveId` (`detonation`), owned by the Pyromancer, for `DETONATION_GROUND_TURNS` (1 / 2 / 3) rounds, one per hex and
  owner (detonating again refreshes it). `combatStore.tickHazards`, run in `beginTurn` after the effect tick,
  gives an enemy of the owner that begins its turn on the hex one Burn stack (one stack's share of what was
  spent, scaled by the rung; `DETONATION_BURN_DURATION` turns) and counts the ground down on the owner's turns.
  Ground goes out with its owner. Objectives never catch fire from it. This is the first authored use of
  `combatStore.hazards`; the board draws it as an ember-coloured `HexHighlights kind="ground"`, distinct from the
  purple warning footprint.
- Inner Flame and Deep Furnace are unchanged stat anchors. No attackable objective gains Burn from any of these.

### Pyromancer remaster (2026-10)

The remaster (the private project notes) kept the kit and changed five things.
Tests: `pyromancerRemaster.test.ts`, `deathBurst.test.ts`, `simpleText.test.ts`. `SAVE_VERSION` 38 (Kindling's
node id is gone).

- **Fuel the Flame** (`fuelTheFlame`, the centre of tier 1, where Kindling's +4 Magic / +15 mana was): when
  Ignite hits an enemy that was already burning before the cast, the resolver's status pass lays one extra Burn
  stack of `FUEL_THE_FLAME_STACK` (0.6, so 0.45 / 0.6 / 0.75 by rung) × Ignite's own resolved Burn
  (`statusEffects.fuelTheFlameBurn`; Hot Blood reaches it once, through Ignite's Burn). It merges like any Burn:
  +1 stack, magnitude capped at `MAX_BURN_MAGNITUDE`. No other skill or Burn source is affected.
- **Burning Out** is `HeroSkill.arenaWide`: its footprint is the hex of every living opponent of the caster in
  the arena (`arenaGeometry.arenaWideHexes`), from any position, not the radius-9 ring it used to be. Range and
  area nodes have nothing to widen (no `aoeRadius`, range 0). The range overlay is the playable arena; the cast
  hex is the caster's own while any enemy stands. The VFX spec's `hitCoords`, and so the flash, aftermath and
  attack camera, are those enemies only, never empty or off-board hexes. Still no impact damage; Burn adds.
- **An enemy can burst on death too** (PT-22, playtest 2026-10-21). `DeathBurst` (`models/units.ts`) is on
  `SummonTemplate` and `EnemyTemplate` alike, read by `summonTemplates.deathBurstOf` (the summon's first), with
  a `scaling` stat (Attack by default), a `damageType` (physical by default), the explosion's `color` and
  `aftermath` (fire and embers by default) and an optional status sized by the dying unit's stats. The
  **Frost Mote** shatters: `BALANCE.FROST_MOTE_BURST`, 3 × its Magic as magic damage within 1 hex (0.8 until
  playtest 2026-10-23b; verify in playtest), in frost
  and rime, and a Chill (3 speed, 2 ticks) — which freezes a hero already chilled, as any Chill does. Its
  `frostBurst` passive (Shatter) states it on the unit card from the same numbers; `frostMoteBurst.test.ts`
  fails an enemy that bursts without saying so.
- **The Fire Elemental's death explosion**: `detonateDeathBurst` now always leads with an `explodes` event
  carrying an `explosion` VFX, once per death (the latch is unchanged), including a death that catches nobody
  and deaths by decay, ticks or expiry. Its `hitCoords` are the arena hexes within the burst radius (2), so the
  picture covers exactly the ground the damage could reach; the victims' numbers follow. Lethal side-blows
  (Thorns/Flame Guard reflection, a stored charge, passive damage, a summon's arrival) now play their death
  events through `combatEvents.playDeathEventsAt` instead of dropping them. Detailed skill text states the
  decay, arrival and explosion (`skillEffectLines`).
- **Ember Shroud** lays `AuraType.FlameGuard`, not Thorns. By rule it is Thorns (`reflectedDamage` reads both
  and takes the stronger): an enemy whose hit damages the ally takes 35% of the damage taken back. It applies
  no Burn and absorbs nothing. It has its own label, orange colour, `status_flame_guard` mark, a flame shroud on
  the wearer (`UnitMesh.FlameShroud`) and a fire `bolt` at the attacker carrying the reflected number
  (`FLAME_GUARD_COLOR`). Every other Thorns source keeps its green presentation.
- Node text is literal, and the summon's node and skill both say it explodes on death.

## Mastery Hydromancer control payoffs

Four flat-stat nodes became decisions about what to do with control. Tests: `hydromancerKit.test.ts`,
`hydromancerRemaster.test.ts`. The 2026-10 remaster (the private project notes)
rebuilt the tree: Deep Well, Shatterpoint, **Twin Fangs** (centre), Thick Ice, Meltwater on tier 1; the
four spells unchanged on tier 2; Blizzard, **Glacial Barrage** and **Absolute Zero** as capstones;
**Cryostasis** as side-tree A's one-rank starter (it replaced Coldblooded; its lethal save stays binary at
the middle rung). Rime, Coldblooded and Rime Tornado are gone (`SAVE_VERSION` 37); Thick Ice took Rime's
+20 HP, which also keeps the path's quest-weapon pick apart from the other Arcanists.

- **Twin Fangs** (`twinFangs`, read by `statusEffects.strikeScales`): Frostbite is two passes, the second
  `TWIN_FANGS_SECOND_HIT` (0.5, so 0.375 / 0.5 / 0.625 by rung) of a strike. Each pass is a whole strike with
  its own dodge, crit and on-hit; the Chill the skill carries lands once after both, so one cast never
  chills and freezes an unprepared target. Only the first fang can spend a Freeze or Brittle mark.
- **Brittle** (`AfflictionType.Brittle`): a player-side Chill that would freeze a boss (`chillMakesBrittle`,
  decided in `combatStore.applyEffect`) spends the boss's Chill and lays one mark instead, for
  `BRITTLE_DURATION` (3) of the boss's turns. It disables nothing and is not a Freeze (no "IMMUNE" float; a
  Freeze-listed preparation is still interrupted as before, because the landing still counts as a Freeze
  for `interruptedBy`). The next blow consumes it in `damageUnit` for a noncritical burst fixed at creation:
  `BRITTLE_BURST_MAGIC` (0.8) × the creator's effective Magic, never a share of the boss's pool. A fresh mark
  refreshes, never stacks; the Chill underneath is gone, so the setup has to be rebuilt. `isShatterable`
  makes Shatterpoint and Shatterstep treat it as a shatter, and Meltwater fires on its first creation (not
  on a refresh). Normal enemies still freeze. The badge is a cracked ice star (`status_brittle`) and the
  model wears the light Chill frost, never the Freeze block, because the boss is still acting.
- **Glacial Barrage** (`HeroSkill.barrage`): 5 / 6 / 7 shards by rung (`perRank.barrage`; `scaleSkill`
  moves the count and leaves the 0.45× per-shard damage alone). Each shard is a strike pass aimed when it
  leaves: the current target while it lives, else the nearest living enemy within range of the caster
  (`barrageTarget`, ties by distance to the fallen target, then coordinate). With nothing left in range
  the rest dissolve; no shard is invented for a retarget. One enemy at a time, never splash.
- **Absolute Zero** (`HeroSkill.charge`, `systems/combat/chargedCast.ts`): the first use is the skill as
  authored, aimed at the caster, paying the mana and laying `AuraType.Charging` at `CHARGE_DURATION` (2).
  While it stands the button is its release (`chargeStage`, read at use rather than written into the
  skill list): no mana, a `beam` Line — three hexes wide from beside the caster to the arena edge along the
  line to the aimed hex (`beamAxis`, `beamHexes`: every hex whose centre is within 1.5 of that line, so an
  axis-aligned beam is the three rows it always was) — striking every enemy in it three times (`repeats`) at 0.6×
  Magic, then the 4-turn cooldown. The charge is ready only after its first tick, which happens at the
  start of the owner's next regular turn, so a bonus turn cannot fire it; it fades a turn later if
  unused. Stun, Silence or Taunt that actually stands on the holder breaks it (`CHARGE_BREAKERS`, in
  `applySkillStatus`); the mana is not refunded and no cooldown starts. Root, Chill and Freeze attempts
  do not break it. The beam stopped snapping to the six hex axes after the playtest of 2026-10-14: from a
  corner only the wall-hugging or 30°-off axes held an enemy, so the player "could only pick weird angles".
  Every aimed hex is now in its own beam, and a corner offers dozens of distinct beams.

- **Shatterpoint** (`shatterpoint`, `onHit`): the blow that breaks a Freeze deals `SHATTERPOINT_BONUS` (60% at
  the middle rung, 45 / 60 / 75%) of itself again, on top of the ice's own `SHATTER_BURST_HP`, which every hit
  already earns. Read from the pre-damage snapshot like Shatterstep, so "first hit" is literal: the Freeze is
  spent by whichever hit lands first, and a second strike of the same cast, or an ally who got there first,
  finds none. The blow is the HP lost minus the burst (the extra does not scale with the enemy's size). Plain
  damage through `damageUnit`; a Barrier eats it.
- **Meltwater** (`meltwater`, new `onFreeze` trigger): when a Freeze actually stands on an enemy that had none
  (a Chill upgrading, or a Freeze applied outright), a Barrier of `MELTWATER_BARRIER` (11 / 14 / 18, through
  `resolveEffectMagnitude`, so Thick Ice applies) for `MELTWATER_DURATION` turns lands on the most wounded living
  ally by health fraction, the Hydromancer included (`mostWoundedAlly`, ties by distance then id). **Once a
  turn** via a `meltwater:<id>` `spend` key, so a Blizzard that freezes four is one shield. A boss that refuses
  the ice is not frozen and fires nothing. `applySkillStatus` raises the event.
- **Deep Cold** (`deepCold`): a Chill laid on an enemy more than `DEEP_COLD_MIN_RANGE` (1) hexes from the caster
  lasts `DEEP_COLD_EXTRA_TURNS` (+1 / +2 / +3) longer. Applied in `applySkillStatus` before the effect is read,
  through `passives.deepColdExtraTurns`, which the skill preview uses too.
- **Killing Frost** (`killingFrost`, a `PassiveDef.penAgainst`): magic hits against a **Chilled** enemy ignore
  `KILLING_FROST_PEN` (26 / 35 / 44) percent of its Magic Defense. `damageCalc.calculateDamage` adds
  `passives.penetrationAgainst` to the caster's **Magic Pen** under `MAX_MAGIC_PEN`, so the AI's
  expectation matches the roll and the hero sheet's Magic Pen stays honest. A Frozen enemy has spent its
  Chill, so Killing Frost and Shatterpoint pull against each other: slow it to hurt it, or stop it to break it.
- **Preview:** `skillEffectLines(skill, caster)` adds a line per owned node on the skills it touches (the
  lengthened Chill, the Barrier a Freeze would raise, the Shatterpoint share, the Killing Frost penetration);
  the tree's figures come from each passive's `figures`. A caster who owns none sees none.
- **Freeze stays an interrupt.** A Chill that would freeze (`statusEffects.chillUpgrades`) is treated as the
  Freeze it becomes by `applySkillStatus` (interrupt, "IMMUNE" log) and by `applyEffect` (a boss does not keep
  the ice, and the Chill it already wears is left alone), so the Hydromancer's own route to the interrupt, a
  second Chill, cancels a preparation that lists `freeze`. Before, that substitution sailed past the boss
  refusal and past the interrupt.

## Stormcaller remaster (2026-10)

The remaster (the private project notes) changed five things. Tests:
`stormcallerRemaster.test.ts`, `shockSpark.test.ts`, `combatEvents.test.ts`, `simpleText.test.ts`.
`SAVE_VERSION` 42 (the Quickened and Afterimage node ids are gone).

Playtest 2026-10-23 trimmed every Stormcaller spell's `damage` about 10%: Arc and Static Burst 0.72 (were
0.8), Thunderstep 0.8 (0.9), Chain Lightning 1.35 (1.5), Tempest 1.0 (1.1), Thunderbolt 1.8 (2.0), Skyfall
0.63 (0.7). The elemental's echo share is unchanged. Verify in playtest.

- **Conductive Arc** (`conductiveArc`, the centre of tier 1; Overload moved to Quickened's column 1 and
  Quickened's +5 Speed was not redistributed): the Shock jump an Arc sets off carries
  `SHOCK_CHAIN_FRACTION × (1 + CONDUCTIVE_ARC_BONUS × rung)` of the blow — 0.35 × 1.375 / 1.5 / 1.625
  (`statusEffects.conductiveArcBonus`). Arc only; a companion's echo of Arc carries none. Live Wire went from
  +3 to +5 Speed so the path's one remaining Speed node still moves the bonus-turn chance.
- **Shock's jump** fires only off a blow from a spell that **itself applies Shock**
  (`statusEffects.triggersShock`, checked in `applyOnHitStatuses` on both execution paths), on a victim that
  was Shocked before the blow (the pre-blow snapshot, so a spell's first Shock never jumps on the same hit). A
  Basic Attack, a spell that lays no Shock, damage over time, reflected damage and the jump itself never set
  it off; it is still one hop, unless the caster or a companion's owner holds Forked Current
  ([level 26](quests-progression-items.md#arcanist)), which adds exactly one more. The rule is side-blind: an enemy spell that applies Shock (the Drummer's
  Thunderbeat and Rolling Thunder) keeps its interaction, and enemy basic attacks no longer spread Shock among
  the heroes. Static Charge's answer still lays Shock but is reflected damage, so it never jumps.
- **Skyfall** is an aimed `Ring` (`range: SKYFALL_RANGE` 5, `aoeRadius: SKYFALL_RADIUS` 2) with
  `randomEnemies: SKYFALL_TARGETS` (3): up to three different random enemies **within two hexes of the
  aimed hex**, one strike each, never repeated to fill the count, each 0.63× Magic at the middle rung
  (0.47 / 0.63 / 0.79) with its 0.3 Shock (playtest 2026-10-17, PT-18: it struck random enemies anywhere on
  the map; range 7 and radius 2 were tuning starting points, and on 2026-10-23 range 7 still reached
  nearly the whole ±3 × ±5 board, so it is 5). A radius or range node now widens the area
  or the reach like any aimed area; the count stays three. The flash and camera use the struck enemies'
  hexes.
- **Tempest**: base radius 3 (was 2), still self-centred magic damage with Shock; Squall makes it 4.
- **Summon Thunder Elemental** replaces Afterimage (and its place in both side-tree starters' prerequisites).
  The `thunder_elemental` template carries `companion: true`, so the unit:
  - has **no turn**: `addUnits` leaves it out of `turnOrder`; it has no skills or legs of its own;
  - **follows its owner**: `combatStore.moveUnit` sets it down beside the owner after any move of the owner's
    (walk, blink, Thunderstep, a shove), however far, on the nearest free hex (`summoning.companionFollowHex`);
    it stays put when it is already adjacent or no hex is free, and crosses no ground;
  - **lasts three of the owner's regular turns after the summon**: `turnStart.tickCompanions` counts
    `summonTurnsLeft` (3) down at the start of the owner's regular turns, never bonus turns, and it fades as the
    fourth begins (`tickCompanionLifetime`); its statuses tick there too, a status float says the turns left,
    and it fades if its owner falls. Killing it ends it early. A recast replaces the one standing; the
    ultimate's cooldown (5) normally prevents overlap;
  - is **fragile and targetable**: 32 HP before level scaling, times the rung's `statScale`;
  - **echoes**: after each Stormcaller spell (`lightningSkills.STORMCALLER_SPELL_IDS`: Arc, Static Burst,
    Thunderbolt, Thunderstep, Skyfall, Tempest, Chain Lightning) resolves, `resolveSkillUse` runs it again
    once per living companion with `ResolveOptions.echo` and the original's footprint (`fixedHexes`): the same
    target, Chain Lightning route, Thunderstep landing ring or Skyfall set. Its Magic is exactly
    `echoMagic` × the owner's current effective Magic, re-read at every echo (0.3 / 0.5 / 0.7 by rung via
    `perRank.echoMagic`, not the generic rank scale). An echo checks and spends nothing, moves nobody,
    summons nothing, never echoes, and skips Overload, on-cast passives, Frenzy/Thunderhead extra actions and
    banked actions (the companion owns no passives or modifiers); it rolls its own crits at the base chance; a
    target that died before the echo is missed, not replaced. Its Shock applications and the Shock jumps its
    hits set off follow the ordinary rule — Arc's echo usually finds its target already Shocked by the
    original. Basic Attacks and the summon are never copied. Echo pictures are drawn `ECHO_DELAY_MS` (380)
    after the original's from the companion's hex, and the log names the companion as caster.

## Berserker remaster (2026-10)

The remaster (the private project notes, *Berserker: implemented*) changed three
things. Tests: `berserkerRemaster.test.ts`, `basicAttack.test.ts`, `simpleText.test.ts`. `SAVE_VERSION` 43
(the Thick Hide node id is gone).

- **Blood Rush** (`bloodRush`, the centre of tier 1; Offhand Fury moved to Thick Hide's column 1, and Thick
  Hide's +8% max HP was not redistributed). `passives.withBloodRush`, applied where the unit is built
  (`unitFactory.playerUnitFor`, so the board, the inspector and the resolver agree), gives Bloodthirst
  `selfMove: { kind: 'dash', range }` with exactly `BLOOD_RUSH_DASH` 1 / 2 / 3 hexes by node rank (authored per
  rung, never rank-scaled again) and a reach of the dash plus one. It lands like every dash
  (`resolveSelfMove`): the nearest free hex beside the target within the dash, only the landing hex must be free
  and not rubble (a dash does not path, unlike a walk), Root refuses the movement, no landing refuses the cast, and aimed at an
  adjacent enemy it is the plain strike. Damage (0.9×) and 15% drain are unchanged; no Bleed, no extra cost.
  Carnage repeats the strikes after the one dash.
- **Carnage** still repeats only Basic Attack and Bloodthirst, at full strength, for 3 / 4 / 5 turns. A dual-wield
  Basic Attack under it is exactly two 1.0× hits, one per weapon, each with its own dodge, crit, on-hit
  effects, Savage Edge/Cadence checks and drain; a one-weapon Basic Attack and Bloodthirst are two passes of one
  full hit. The preview, the floats and the two drawn blows read the same list. It is drawn as rising red flames
  and red weapons, not the glow bubble (see icons-vfx).
- **Undying** (the capstone now grants `undyingFury`; the Bog Hulk keeps `lastBreath`). The once-per-battle
  lethal save (shared `UndyingSpent` marker) leaves 1 HP and lays `AuraType.UndyingWindow` (magnitude =
  response turns owed, `UNDYING_RESPONSE_TURNS` 2). While it stands, every HP subtraction is floored at 1
  (`passives.flooredHp`): blows, multi-hits, reflections and hazards in `damageUnit`, and damage over time and
  Doom in `tickEffectsOnUnit` (a lethal tick opens the window too, and a second tick in the same pass is
  floored). It is a floor, not immunity: hits still land, show numbers and strip Barriers, and healing counts. The
  clock: `turnStart` marks a regular turn that reaches `act` (past Stun, Freeze, sleep, kneeling and the tomb;
  not a Mind-Controlled turn) as a response; `combatStore.nextTurn` spends it when the order moves on, so the
  turn's own bonus turn belongs to the same response and a skipped turn spends nothing. The turn on which the
  save happened never counts. It closes after the second response turn ends, leaving the real HP. The surge is a
  `statMod` read while the window stands: +`UNDYING_SURGE` (25%) × rung of base Attack (at least 3) and the
  same share as lifesteal (sheet %), so no duration can tick it away early. A status float at each response turn
  says `UNDYING: 2 TURNS` / `UNDYING: LAST TURN`; the badge counts the turns left.

## Mastery Marksman remaster

Tests: `marksmanRemaster.test.ts`, `marksman.test.ts`, `simpleText.test.ts`. The 2026-10 remaster
(the private project notes, *Marksman: implemented*) rebuilt the tree: Steady Hand,
Lethality, **Mark and Move** (centre, replacing Evasion), Repositioning, Quarry on tier 1; Hamstring Shot,
**Ricochet Shot** (replacing Piercing Shot), **Concussive Shot** (replacing Execute, 2026-10-13), Rain of
Arrows on tier 2; **Aimed Shot** (redesigned),
Rapid Fire, **Covering Fire** (replacing Follow-Through) as capstones; side tree A is **Escape Route** (one-rank
starter, replacing Sure Footing) with **Settle In** (replacing Braced) and Fleet. Evasion, Piercing Shot,
Follow-Through (skill and its killing-crit free-turn passive), Sure Footing and Braced are gone
(`SAVE_VERSION` 41). Tunables are in `balanceConstants` (`MARK_AND_MOVE_RANGE`, `ESCAPE_ROUTE_*`,
`SETTLE_IN_PEN`, `AIMED_SHOT_REFERENCE_DISTANCE`).

- **Concussive Shot** (node `marks_concussive`; playtest 2026-10-13 retired Execute, a ranged finisher on 60%
  of the shared window that killed only what a Basic Attack would): range 5, 1.2× Attack physical, knocks the
  target 2 hexes straight away (`pushDistance`), and a Stun for one turn when the shove is cut short by the
  arena's edge, solid rubble, an objective or another body (`collisionEffect`, read from `traceForcedMove`'s
  `blockedBy`, applied through `applySkillStatus` so Stun immunity holds). An Immovable boss is never shoved and
  so never stunned. 12 MP, cooldown 3; it borrows Execute's drawing. Under Rapid Fire (or a second hand) the
  shove waits for the cast's last blow, so every arrow lands on the hex it was aimed at — the same rule now
  holds for every knockback skill. A save holding the old `marks_execute` node ignores it (no `SAVE_VERSION`
  bump), and the point spent on it is not refunded.

- **Mark Target** (range 5, 0.7× Attack, owner-only Mark for four turns): the Mark raises only its owner's
  damage (`markMultiplier`, +40%). Skills read it and leave it standing; the owner's **Basic Attack** cashes it
  in (`basicAttackSpendsMark`): that blow takes the bonus and, if it lands, `resolveCast` removes the Mark. A
  dodge spends nothing, and nobody else's Basic Attack touches it (playtest PT-04, `marksmanRemaster.test.ts`).
  **The +40% is stored as authored** (`statusEffects.RATIO_MAGNITUDE` / `settleMagnitude`): until
  2026-10-17 the resolver rounded every effect magnitude to a whole point, so the Mark actually landed at
  1.0, +100%. Found while adding Pinning Cut's Exposed; the Marksman's damage against a Mark drops to
  the authored number — verify in playtest.
- **Next Quarry** (`nextQuarry`, `combatStore.spreadMark`, level 26): called beside `spreadSpark` on both death paths;
  a Mark on a dead enemy passes on unless a Basic Attack cashed it. See [advanced nodes](quests-progression-items.md#hunter).
- **Mark and Move** (`markAndMove`): after Mark Target resolves (a dodge included) `resolveSkillUse` calls
  `grantReposition` and returns `endsTurn: false`: the action is spent (`hasActed`) but the Marksman may
  still Move, at most 1 / 2 / 3 hexes by rung (`CombatUnit.repositionCap`, read by `getMovementRange`),
  or End Turn. Root grants nothing. The step is a voluntary move, so the turn is not stationary for Settle In.
- **Ricochet Shot** (a `Chain` with `chainFalloff`): 1.0× Attack at the aimed enemy, then up to two bounces,
  each to the nearest unhit enemy within two hexes of the last one hit, at 0.7 and 0.49 of the first hit
  (each its own strike and crit). Range 5, 12 mana, cooldown 2.
- **Aimed Shot** (`charge.aimed`, `chargedCast`): the first use is aimed at an enemy within 9 hexes (10 with
  Longshot), deals nothing, pays the 26 mana and lays `AuraType.Aiming` (`aimAt` = that unit) at
  `CHARGE_DURATION`. On the next turn the button is the release: free, and it may only be fired
  at that unit (`getValidSkillTargetHexes` offers only its hex while it is in reach), so pressing it fires
  at once (`aimSteps.releasesOnPress`, PT-14). A bonus turn taken before that regular turn counts as the
  next turn: `turnStart.beginBonusTurn` arms the aim (`ActiveEffect.armed`) and the release is open there
  (PT-15; the aim locks everything else, so before this the extra turn was wasted). Nothing ticks. The release deals
  1.2 / 1.6 / 2.0× Attack at four hexes by rung (`perRank.nested` scales it), multiplied by
  distance ÷ 4 at the moment it lands (`damageCalc.distanceFactor`, `HeroSkill.distanceScale`), so the
  preview and the roll agree; it can crit and takes 1.5× against the Marksman's own Mark target (was 1.8)
  on top of the Mark. While aiming every other skill and Basic Attack is locked (`aimLocks`, refused with
  "Aiming — shoot or move"). Moving (`markMoved`), Stun, Silence or Taunt standing on the Marksman, or the
  target being dead or untargetable at the turn start drops the aim; unfired it fades after the release
  turn. The cooldown (3 turns from the shot) is started at the aim one turn longer and the release ignores
  it (`cooldownLeft`), so a dropped aim costs it too; the mana is never refunded. An off-turn move (Escape
  Route, a shove) does not drop it: the distance at release is what counts.
- **Covering Fire** (a Reaction with `shotsPerRound`): casting it is the turn's action; for three (`REACTION_TURNS`) of the
  Marksman's turns, when an enemy damages an ally (not the Marksman) within 6 hexes, the Marksman shoots it
  for 0.6 / 0.8 / 1.0× Attack by rung, up to twice per round (`PreparedReaction.shotsLeft`, refilled by
  `tickReaction` at each regular turn start). One shot per attacking cast however many allies it struck
  (deduplicated per flush), and damage dealt while a response resolves is recorded `byReaction` and never
  answered by a watch. The Marksman's own turns are untouched. 22 mana, cooldown 5.
- **Escape Route** (`escapeRoute`, `onDamaged`, a `retreat` outcome): once per round, after an enemy within
  `ESCAPE_ROUTE_REACH` (2) damages the Marksman, it steps `ESCAPE_ROUTE_RETREAT` (2) hexes directly away
  (`resolvePush` from the attacker, so blockers stop it). Not while Rooted, Stunned, Frozen or asleep.
  `escapeRouteSpent` is cleared when a regular turn begins. The step is not voluntary: it neither spends
  Settle In nor drops an aim.
- **Settle In** (`settleIn`): at the start of a regular turn after one ended without a voluntary move
  (`previousTurnStationary`), lays one `AuraType.SettledAim` charge of `SETTLE_IN_PEN` (15 / 20 / 25)
  armour-penetration points; it is re-read every turn start, so it never stacks. `penetrationAgainst` adds
  it to ranged (range ≥ 2) **physical** damaging casts (a magic one spends the charge unsharpened), which
  spend it once per cast; a Reaction's response neither uses
  nor spends it. Because a turn is move or act, any turn spent shooting is a stationary one.

## Mastery Skirmisher remaster

Tests: `skirmisherRemaster.test.ts`, `skirmisher.test.ts`, `simpleText.test.ts`. The 2026-10 remaster
(the private project notes, *Skirmisher: implemented*) rebuilt the kit around
**Embedded Blades**: Slipstream (replacing Light Foot), Sharpened Steel (replacing Bandolier), **Fan of Blades**
(centre, replacing Evasion), Precision, Follow Up on tier 1; Smoke Bomb (reworked), Barbed Blades, Bolas, Hit and
Run on tier 2; **Knife Dance** (replacing Volley), Bladestorm, Flurry as capstones; the side trees are unchanged.
The Signature is **Blade Recall** (`blade_recall`), replacing Throwing Blades. Light Foot, Bandolier, Evasion and
Volley are gone (`SAVE_VERSION` 45). Tunables are in `balanceConstants` (`BLADES_CAP`,
`BLADE_EXTRACT_PER_BLADE`, `BARBED_*`, `KNIFE_DANCE_*`, `SLIPSTREAM_STEP`, `SHARPENED_STEEL_PEN`,
`SMOKE_DODGE`). Bleed is unchanged for every other kit; no Skirmisher skill applies it any more.

- **Blades** (`AfflictionType.Blades`, `systems/combat/blades.ts`): one entry per Skirmisher on each victim
  (`sourceUnitId`), count in `magnitude` and `stacks`, capped at 5 per Skirmisher (`bladesCapOf`: 6 / 7 / 8 with Buried Steel), no clock (`duration: -1`)
  and no damage of their own. Written by `combatStore.embedBlades` / `extractBlades`, never `applyEffect`
  (which keeps one effect per type and would let a second Skirmisher overwrite the first's pile). Nothing goes
  into a dead, Invulnerable, sealed or debuff-immune unit; a boss takes them (they disable nothing). A cleanse
  removes them like any affliction; a body that dies takes them with it.
- **Laying blades** (`HeroSkill.embedsBlades`): each pass of a skill that lands on an enemy (not dodged; a hit a
  Barrier soaks still lands) leaves one blade. A pass counts once however many hands struck in it, so a dual-wield
  Basic Attack is one blade and each Flurry knife one more. Blades go in after every pass, so Barbed Blades
  reads the blades in at the cast's start. Carriers: Basic Attack when a Skirmisher holds a throwing blade,
  throwing axe, spear or dagger (`basicAttackFor`, `leavesBlade`), Barbed Blades, Bolas, Hit and Run, Knife
  Dance, Blade Recall's Fan of Blades throw, and each Bladestorm bite (one per enemy per bite that reached it).
- **Blade Recall** (`extractsBlades`): an `Arc`, range 2, depth 2 (Wide Throw widens it), free, cooldown 2.
  After its passes it pulls the caster's own blades out of every enemy in the cone: one hit per enemy worth
  `BLADE_EXTRACT_PER_BLADE` (0.3) × Attack per blade removed, physical, through `resolveAttack` with
  `undodgeable` (defence applies, it can crit, on-hit passives fire), embedding nothing. An enemy with none of
  the caster's blades takes nothing. With nothing to pull and nothing to throw the cast is refused ("No blades to
  pull there") and costs nothing.
- **Fan of Blades** (`fanOfBlades`, the Signature node): Blade Recall first throws the same cone for 0.7× Attack
  at the node's rung (0.53 / 0.7 / 0.88), one blade per enemy hit, then pulls — one cast, one cooldown. A target
  with no blades can take a blade from the throw and have it pulled. `strikeScales` gives Blade Recall the throw
  pass only with the node; **Flurry** adds one knife (`FLURRY_FOLLOWUPS_AREA`; the cone is an area) at 25% of the throw per enemy
  hit, which embeds before the single pull. Without the node Flurry's knives are its only throw: nothing replays the cone and the pull
  never repeats.
- **Barbed Blades**: 1.1× Attack single target, range 3, +15% per own blade in the target (up to +75%, a
  `statusAmplifier` branch for `Blades` that counts only the attacker's), then one blade; none are pulled.
- **Bolas** and **Hit and Run** keep their Root and shove-and-retreat, plus a blade per enemy hit.
- **Knife Dance** (`knifeDance`, aimed at one enemy within 3 hexes): three ground dashes, each followed by
  a thrown blade for 1.3× Attack by rung, with its own dodge and crit and one embedded blade on a hit.
  The first landing is beside the aimed enemy; the next two dashes cover at most 2 hexes, favouring nearby
  other enemies before circling the previous victim. After each landing, the nearest living enemy is
  selected afresh (random ties); repeat victims are allowed, so a lone boss can take all three throws.
  No legal landing, no reachable living victim, or the caster falling ends the dance. Root refuses it.
  26 mana, cooldown 4, no extra turn per throw. The model and projectile share three dash/throw beats;
  Flurry adds its reduced follow-ups without repeating the movement.
- **Flurry's follow-ups by shape** (playtest 2026-10-21, PT-40; `statusEffects.flurryFollowupsFor`): two knives
  at 25% (`FLURRY_FOLLOWUPS_SINGLE`) behind a single-target strike, one (`FLURRY_FOLLOWUPS_AREA`) behind an area
  strike (`isAreaSkill`) at each enemy it hits. It was three behind every strike, too strong in playtest. Each
  knife that lands embeds a blade, so the embedded blades follow the same count. Verify in playtest.
- **Bladestorm**: unchanged movement and bite; the bite lays one blade per enemy per tick instead of Bleed.
- **Slipstream** (`slipstream`): after a cast that damaged an enemy (Blade Recall's pull included), once the
  whole cast is done, `resolveSkillUse` grants a reposition of 1 / 2 / 3 hexes by rung (`grantReposition`, the Mark and Move route)
  and returns `endsTurn: false`; Move or End Turn follows. The cast is the turn's action, so it is once per
  regular turn. Root, a dodged-only cast or no free hex grants nothing.
- **Sharpened Steel** (`sharpenedSteel`): 15 / 20 / 25 armour-penetration points (`calculateDamage`'s
  `extraPen`, physical hits only) on the first landed direct hit of a cast on each enemy that was at full health when the cast
  began (`sharpenedSteelFor`); never on a second Flurry knife of that cast or on the pull.
- **Smoke Bomb**: a Self radius-1 cloud (Wide Throw widens it) that stays where it was dropped, carried as the
  caster's `AuraType.SmokeCover` with the hexes in `ActiveEffect.zone`, for 2 / 3 / 4 of the caster's turns by
  rung. While the caster stands on the zone, `getCombatEffectiveStats` floors its Dodge at `SMOKE_DODGE` (50%),
  after every bonus, so it is a floor and never an addition. Enemies caught in the drop take Attack Down as
  before; the forced retreat is gone. 12 mana, cooldown 4.

## Mastery Shadowblade remaster

Tests: `shadowbladeRemaster.test.ts`, `hunterDescriptions.test.ts`, `simpleText.test.ts`. The 2026-10 remaster
(the private project notes, *Shadowblade: implemented*): Lethality (moved from the
centre), Evasion, **Shadow Echo** (centre), Opportunist, Leeching Blades on tier 1; tier 2 and the capstone row
keep their skills, with **Assassinate** rebuilt as a delayed execution; side tree B opens with **Venom Transfer**
(replacing Rot). Quick Hands and Rot are gone (`SAVE_VERSION` 48), and with Rot the `haltsPoisonDecay` flag and
`poisonDecayHalted`: every Poison now counts down. Tunables are in `balanceConstants` (`SHADOW_ECHO_COST`,
`SHADOW_ECHO_TURNS`, `VENOM_TRANSFER_RANGE`, `DEATH_MARK_BONUS`, `DEATH_MARK_TURNS`).

- **Shadow Echo** (`shadowEcho`, `systems/combat/shadowEcho.ts`): a Shadowstep that moved the caster (`moved` in
  `resolveSkillUse`, either variant) calls `leaveEcho`, which replaces the caster's `AuraType.ShadowEcho` with
  one holding the hex it left in `zone[0]`, duration `SHADOW_ECHO_TURNS` (2: the turn it was left and the next
  regular turn). `returnToEcho` pays a flat `SHADOW_ECHO_COST` (6, `shadowEchoCost`), moves the caster there and
  drops the aura; it touches no action flag or cooldown. The rungs add to the return (`shadowEchoPerks`, playtest
  2026-10-21, when 10 / 7 / 4 mana by rung made ranks 2 and 3 a wasted point): from rank 2 it grants Stealth
  (`STEALTH_DURATION`), and at rank 3 that Stealth carries `ECHO_STEALTH_MARK` (magnitude 2), which the passive's
  `critAgainst` reads as +100 crit chance, so the first attack out of it is a certain critical hit (attacking
  breaks the Stealth). A return before acting is the way to cash it; one after acting only hides the caster. `echoReturnBlock` is the one rule the button,
  the post-action window and the return all ask: no shadow, a turn-locking control (`isActionLocked`), Root, a
  body or solid hazard on the hex, the duel circle, or too little mana refuse it, and a refused return charges
  nothing. Silence and Taunt do not.
- **The post-action window**: at the end of a cast (`echoHoldAfter`, also on Assassinate's own branch), a holder
  of the node that could return right now gets `combatStore.holdForEcho` (`hasActed`, `CombatUnit.echoHold`)
  and `endsTurn: false`. The action bar then shows **Return** and **End Turn** and no Move (`echoHold` hides
  it); Return hands the turn on after the blink. Not after a `freeAction`, an extra action or a resolving
  (reaction/echo) cast. Before acting, Return sits beside Move and leaves the action available. `echoHold` is
  cleared whenever a turn begins.
- **Venom Transfer** (`venomTransfer`, `combatStore.spreadVenom`): called beside `spreadSpark` on both death
  paths (`damageUnit` and the tick). The corpse's Poison is spent first; its owner is the pile's
  `sourceUnitId` (the latest dose's applier), who must be alive, on the other side and hold the node, with
  `CombatUnit.venomTransferSpent` clear (reset when its regular turn begins in `nextTurn`). One dose, the pile's
  magnitude over its doses, goes to the nearest unpoisoned, non-objective, Poison-capable enemy of the corpse's
  side within `VENOM_TRANSFER_RANGE` (3), ties to lowest health then id, on the ordinary clock. A full pile is
  never a recipient, so it never makes an Overdose.
- **Into the Dark** (`intoTheDark`, level 26): each kill by this unit's blow brings Shadowstep alone forward 1 / 2 / 3
  turns (`refundCooldown` with `onlyIds`). See [advanced nodes](quests-progression-items.md#hunter).
- **Poison doses** (`statusEffects.poisonDoses`): 0–3, what the model's markers read; an Overdose leaves 0.
- **Assassinate** (`deathMark`, `systems/combat/assassination.ts`): Single, range 20, enemy only, no damage, 24
  mana, cooldown 4. Its branch in `resolveSkillUse` calls `markForDeath`, which removes the caster's mark from
  any other unit and applies `AfflictionType.DeathMark` (`magnitude` `DEATH_MARK_BONUS` 0.1, `duration`
  `DEATH_MARK_TURNS` 3, `sourceUnitId` the caster). The carrier's own tick skips it (`tickEffectsOnUnit`);
  `damageCalc.deathMarkMultiplier` raises every direct hit on it by the magnitude, whoever lands it.
- **The execution** (`resolveDeathMarks`, called by `beginRegularTurn` just before `act`, after every tick and
  every lost-turn verdict, never on a bonus turn): for each living unit carrying the owner's mark, if it is at
  or below `deathMarkThreshold` (`executeThresholdHp` at scale 1, with the elite and boss divisors) and not
  untargetable, and `deathMarkLanding` finds a hex (the owner's own when adjacent; else the free hex beside the
  victim nearest the owner; none when Rooted and not adjacent), the mark is dropped, the owner moves there, and
  `damageUnit` takes the victim's health plus Barrier (no roll; protections, death saves and phase ceilings
  apply). A kill gives the owner Stealth (`STEALTH_DURATION`). Otherwise the mark counts one down and is removed
  at zero. Death events are played by the turn start. `retireOwned` drops a fallen owner's marks.
- **The scene**: `beginTurn` reporting `act` with an impact still playing sets `turnStartBusy`, which holds the
  action bar back until the execution's picture (`sink.lands` timed by `assassinateStrike`) and a swing have
  played. The marked unit's health bar carries the threshold line (`deathLines`), and the execute skull shows
  once it is inside.

## Wildshape remaster (2026-10)

Tests: `wildshapeRemaster.test.ts`, `wildshape.test.ts`, `wildshapeTree.test.ts`, `simpleText.test.ts`. The
remaster (the private project notes, *Wildshape: implemented*) replaced six nodes:
Crushing Leap (`wild_bear_leap`, was Bear Hug), Slip the Net (`wild_wolf_slip`, was Hamstring), Rending Circle
(`wild_wolf_rending`, was Takedown), Hunter's Mark (`wild_hawk_mark`, was Skyward), Primal Surge
(`wild_primal_surge`, was Feral Heart) and Ancestral Hunt (`wild_ancestral_hunt`, was Primal Bond). Crowned Prey
replaced Antler Strike in the Apex's innate three. `SAVE_VERSION` 47. Tunables: `BLOOD_HOWL_*`, `APEX_*`,
`WOUNDED_THRESHOLD` in `balanceConstants`; the rest is on the skills in `data/skills/mastery/druid.ts`.

- **Hawk.** Hunter's Mark (range 4, 1.2×) lays `AfflictionType.HuntersMark` on a landed hit: `stacks` 2 charges,
  `magnitude` +40%, three turns, `sourceUnitId` the Hawk. `statusEffects.huntersMarkFor` lets only that Hawk's own
  `formSkill: 'hawk'` attacks (not Hunter's Mark itself) read it; the resolver multiplies the strike and spends one
  charge per landed blow (`combatStore.spendMarkCharge`), never on a dodge. Dive keeps range 4 and is drawn as a
  flight (`movement.mode 'swoop'`, see icons-vfx); since the playtest of 2026-10-14 it **lands two hexes from its
  victim** (`SelfMoveSpec.landAt`: the free hex at that distance nearest the Hawk, then farthest from other enemies;
  a Hawk already there stays) instead of withdrawing two further from where it struck, which left it up to six away.
  The Hawk's Attack multiplier is 1.55 (was 1.45), the most `wildForms.test.ts`'s shape band allows. Cyclone lost its Root (damage and push only,
  cooldown 4 → 3). Wind Shear is an `Arc` of depth 3 (15 hexes, 120°), 0.9×, push 1 away from the Hawk.
- **Bear.** Crushing Leap: a `dash` of 2 then 1.1× and a two-turn Stun, cooldown 5, drawn as a jump
  (`combatMotion.leapsSelfMove`). Root refuses the leap; aimed at an adjacent enemy it is the plain strike.
- **Wolf.** Blood Howl is a self-only `AuraType.BloodHowl` (+12 Attack as its magnitude, +`BLOOD_HOWL_CRIT` 25%
  Critical Chance) that `getCombatEffectiveStats` reads only while `wildForm === 'wolf'`; leaving Wolf form removes
  it (`setWildForm`). While it stands, every direct critical hit the Wolf lands in `resolveSkillUse` calls
  `combatStore.queueHowlTurn`: one queued turn per critical hit while `howlQueued + howlGranted <
  BLOOD_HOWL_TURN_CAP` (**1** since the playtest of 2026-10-14; it was 3, which chained into a free round).
  Several critical hits in one area cast still earn only the one turn. `nextTurn` grants a
  queued turn straight after the turn that earned it (after a pending speed bonus turn), as a bonus turn with
  `bonusTurn.howl` (nothing ticks; the toast reads "acts again — Blood Howl"); critical hits on a granted turn can
  queue more, but granted turns never refill the allowance, which resets only when the Wolf's next regular turn
  starts. A Wolf that is down, out of Wolf form or out of the Howl has its queue thrown away. Ancestral Hunt's spirit
  critical hits and companions' hits do not count. Slip the Net (`slipsBonds`): Root and Chill (the game's slow)
  come off before the move, so it is the one move a Rooted Wolf can make (`selfMoveIsThePoint` exempts it); then a
  `free` move of up to 2 and `AuraType.Evasive` +30% Dodge for two ticks (until the Wolf's next turn ends),
  cooldown 4. Rending Circle: radius-1 ring round the Wolf, 1.1×, ×1.5 against `wounded` (below 50% of effective
  max HP), no push, cooldown 3.
- **Form-usable capstones** (`HeroSkill.anyForm`, picked up by `skillsForForm` in every shape, upright included;
  still exclusive with Apex and each other; no mana). Primal Surge: cleanse, running cooldowns of every Bear, Wolf
  and Hawk skill (`shapeSkillIds`) come 2 turns forward (`refundCooldown(…, onlyIds)`; shift skills and capstones
  untouched), and `freeAction` — the cast does not spend the turn, the one bounded extra action. Cooldown 9 / 8 / 7
  by rank. Ancestral Hunt (`spiritHunt`, resolved by `resolveSpiritHunt`): range 3, three strikes on the aimed
  enemy, each its own dodge/crit, 0.8× at the stronger of the caster's current Attack and Magic, physical — Bear
  (+Attack Down 6 for 2 turns), Wolf (heals 50% of what it dealt), Hawk (also 0.4× on every other enemy within 1 of
  the victim). The later spirits' numbers float `SPIRIT_BEAT_MS` apart (`CombatSink.float`'s `delayMs`).
  Cooldown 6. Feral Heart's free shifting is gone with it; Primal Bond's form-bonded summon machinery
  (`bondsToForm`) is gone too.
- **Apex** (three-turn burst). Stats `attack ×1.8, defense ×1.6, magic ×0.5, moveRange ×2, vigor 1.4`, and the Druid's
  magic converts into Attack like the claws (`magicConverts: 'attack'`). Entering is free from any shape
  (`shiftEndsTurn`), costs 25 MP and starts no cooldown. `setWildForm` lays `AuraType.Apex` (duration
  `APEX_TURNS` 3, the entry turn counting) and clears `apexSpent`. Each Apex spell is used once per shape:
  `canUseSkill` refuses a spent one and `skillBlockedReason` names it; none has a cooldown. `nextTurn` reverts the
  Druid to Druid form at the end of the regular turn on which the clock shows 1 — disabled turns count — or at the
  end of whichever turn the third spell was used; `beginTurn` draws the reversion. Leaving Apex by any route
  (clock, spells, the button, Second Skin) starts `apex_form`'s cooldown, `APEX_COOLDOWN` 8 regular turns from
  then, and discards unused spells. Crowned Prey: range 2, 2.2×, lays `AfflictionType.CrownedPrey` (2 charges, three
  turns, `sourceSide`) whose `magnitude` is 0.5× the Apex's Attack fixed at the cast; every damaging hit by that
  side (any skill, the AI path and sanctuary pulses included) adds it as magic damage before Magic Defense
  (`holyHitBonus`) and spends a charge; a dodge spends nothing; the crown outlives the shape. Antler Charge: dash 4
  to the enemy, then 1.5× on every enemy within 2 of the landing (`landingBurst`, read from the landing by the
  preview, the resolver and the picture); no push. Primal Wrath keeps 1.3×, Root 1 and Attack Down 8 on a
  targeted area (range 3, radius 2) since the playtest of 2026-10-14; it was `arenaWide` (every living enemy).
- **Carried shape** (playtest PT-16, `SAVE_VERSION` 49). The animal a standing Druid ends a fight in is written to
  `Hero.wildForm` (`wildshape.formToCarry`, from `encounterResolution.applyVictory`, castle stages included) and taken again
  when the next fight begins (`wildshape.openingForm`, `openingForms.planOpeningForms` / `takeOpeningForms`). Only
  Bear, Wolf and Hawk are carried. **A fight ended in Apex begins the next one in Druid form**: Apex is a three-turn
  burst whose clock, spent spells and cooldown belong to the fight, and leaving it in a fight already reverts to Druid
  form rather than to the animal it was entered from. A fallen Druid, and every hero after a defeat, is carried in
  their own shape; a carried shape whose shift skill the hero no longer knows (a respec) is ignored. **The opening
  shape is free** — no mana, no cooldown on the shift, no action — since it was paid for in the fight it was taken in;
  health is scaled into the shape's pool by `setWildForm` as a cast scales it. The scene plans the shapes at
  `initCombat`, then once the intro is over and the party is placed takes them with the shift's own picture, line
  and sound (`skillResolution.announceShift`, shared with the cast), frames the Druid, and holds the first turn and
  the kit (`openingBusy`) until the longest picture has played (`handOverMs` of `skillImpactDelayMs`). Tests:
  `carriedWildForm.test.ts`.

## Mastery Stormcaller Overload and Hunter speed

Tests: `stormcallerKit.test.ts`, `speedCurve.test.ts`, `hunterDescriptions.test.ts`.

- **Overload** (`overload` passive, new `onCast` trigger): a damaging cast that strikes `OVERLOAD_MIN_SHOCKED`
  (2) or more enemies that were **already Shocked** (the pre-blow snapshot, so the Shock a cast lays does not
  charge itself) lays `AuraType.Overloaded` on the Stormcaller: `OVERLOAD_BONUS` (50%, so 38 / 50 / 63% by
  rung) more damage on the next single-target lightning bolt, held `OVERLOAD_DURATION` (4) of its own turns.
  `applyOnCast` fires the event once per cast from `resolveSkillUse`. "Single-target lightning bolt" is an
  explicit list in data, `data/skills/lightningSkills.ts`: **Arc and Thunderbolt** (and they must be
  `Single`). Chain Lightning, Tempest, Static Burst, Thunderstep and Skyfall are lightning but not bolts, so
  they charge it and cannot spend it. `calculateDamage` reads `overloadMultiplier`, so the AI's
  expectation and the roll agree; after the cast the resolver removes the aura if the skill was a bolt (a
  miss still spends it), then reads the cast for a new charge, so one cast cannot both spend and refill.
  Refreshes rather than stacks. Bolt tooltips say what a charge is worth, and the live number while one is held.
  No hard interrupt was added: nothing on the path stuns, silences, freezes or roots.
- **Speed against the extra-turn curve.** The chance (`bonusTurnChance`) is zero until 0.3 faster than the
  foes' mean speed and flat at 35% from twice as fast, so past the cap a flat Speed bonus is dead. Enemy speed
  scales `1 + 0.15 * (level - 1)` while a gearless hero's grows by class and path, so `speedCurve.test.ts`
  measures every Mage and Ranger path with all its Speed nodes at the top rung against the level-matched foes
  (levels 5 to 20): no Mage build reaches the cap, a Ranger's may overshoot the line by less than a node's
  worth, **every Speed node must still lower the chance when removed**, and no single node's top rung is more
  than half the curve alone (the 2026-10 remaster later removed Quickened; see *Stormcaller remaster*). Retunes that came out of it: Quickened 4 to 5 Speed (the Stormcaller's full build
  sat at 11% chance at most and 3% late, under an unspecialised Hunter's class baseline), Live Wire Magic 4 to
  5 (Speed 3 unchanged), Capacitor 30 to 40 mana (the extra turns need paying for); Skirmisher Long Legs and
  Shadowblade Ghostfoot 4 to 3 Speed; and `MASTERY_GROWTH.shadowblade` lost its speed tilt for attack
  (`{ attack: 2 }`), because class plus path growth alone put a gearless Shadowblade at the cap by level 20
  and left both its Speed nodes buying nothing. A flat node's rungs round to 2/2/3 below a value of 3, so the
  minimum Speed node is 3 (a rung that repeats the one before is not a benefit). Speed node text no longer
  promises turn order ("First to act, always"); it says a clear lead sometimes earns a second turn.
- **Hunter text.** No kit changed. Descriptions that could mislead an encounter plan were corrected: Cheap Shot,
  Garrote, Hamstring Shot and Bolas now say that a boss ignores the control (it still cancels a warned attack
  whose spec lists it); Garrote silences anyone and its isolation (no ally beside the target) only raises damage;
  Creeping Death adds a dose and hits harder per dose carried (it consumes nothing); Bladestorm cuts and bleeds
  every enemy within `BLADESTORM_RADIUS` (2) hexes at the start of the carrier's turns; Nightfall refunds cooldowns only while hidden; the Rapid
  Fire status text gives its real 30% per arrow. `hunterDescriptions.test.ts` cross-checks each Hunter
  description against what the skill applies (every status word applied, every control status named, boss and
  interrupt claims match an ignored disable, gates described as gates, number words resolve).

## Mantis: the reap and the flank (Monk)

Tests: `mantisTree.test.ts`, `mantisCapstones.test.ts`, `mantisSideTrees.test.ts`. Design in the Monk plan.
The Mantis's signature, five feeders, four actives, three capstones and two side trees. Tunables in
`BALANCE.MANTIS`; the skills in `data/skills/mastery/mantis.ts`, the rules in `systems/combat/mantis.ts`. Every
cost is chi, the signature's included.

- **Twin Reap** (`twin_reap`, signature, 14 chi, range 1) is a `dualWield` strike authored as the pair, so each
  handblade is a whole blow with its own dodge, crit and on-hit (`TWIN_REAP_CUT` each: 0.9 × Attack, raised
  from the plan's 0.65 by the harness and to verify in playtest, the Monk plan). When the second hand lands
  on an enemy that is Bleeding as it lands (`mantis.reapingCut`), `resolveAttack` is told `guaranteedCrit` — the
  dodge is still rolled — and the resolver removes the Bleed after the blow. A dodged second cut reaps nothing and
  the Bleed stays.
- **Reaping Momentum** (`reapingMomentum`, the column-2 node) is memory on the caster: `CombatUnit.reapPrey`
  holds the enemy the last Twin Reap was aimed at and the stacks that reap carried. Only Twin Reap writes it, so
  any skill between two reaps — a Pounce, a swing — keeps the count. A reap on the same prey carries one more
  stack, capped at `MOMENTUM_MAX_STACKS`; the first reap on a prey carries none; a reap on another enemy starts
  over. Each stack adds `MOMENTUM_STEP` × the node's rung to the reap's `strikeScale`.
- **Bleeding Blades** (`bleedingBlades`, `onHit`) lays the Mantis Bleed (`BLEED` × Attack a turn,
  `BLEED_TURNS`) when a Basic Attack draws blood, on a body still standing. It reads the unit's own stats rather
  than its combat-effective ones (a passive cannot reach those without a cycle). Scything Step lays the
  same Bleed through `appliesEffect`. Bleed refreshes, so a dual-wield swing lays one.
- **Predator's Breath** adds a `CritBuff` of `PREDATORS_BREATH_CRIT` to Meditate's payout
  (`meditate.meditationPayout`), for the turn it pays out.
- **Flicker Cut** (`flicker_cut`, 1.1×) carries `HeroSkill.blinksBehind: 'first'`: **before** the cut the caster
  blinks to `mantis.strikeLanding` of the enemy aimed at — its back hex when free, else the free rear-side hex
  nearest the caster, else it stays — so the cut itself is a backstab or a flank (playtest 2026-10-21, PT-17; it
  used to cut first and blink after, which set up only the next blow). A Rooted caster cuts from where it
  stands. It counts in `blinksInBehind`, so the aim tints the rear of every enemy it could reach, as Mantis
  Execution's does. (`'after'`, the old order, is now only the Last Lesson's Pilgrim's Step.)
- **Scything Step** is a one-hex `dash` before a two-blade strike (range 2); **Pinning Cut** a 0.9× cut that
  leaves the prey **Exposed** (`AfflictionType.CutOpen`, playtest 2026-10-17, PT-22, replacing the Root): for
  the Mantis's next `EXPOSE_TURNS` (2) turns it takes `EXPOSE` (+20%) more damage from that Mantis alone
  (`damageCalc.cutOpenMultiplier`, beside the Mark). It is on the carrier's clock, so it is authored one
  tick longer than the turns it covers, and a boss carries it like anyone (nothing to refuse). Shown as
  "Exposed" in the Mantis's green with its own mark `status_cut_open`; distinct from the boss window
  `AuraType.Exposed`, which every blow reads; **Pounce** (`mantis_pounce` — the Wolf owns `pounce`) a
  four-hex `dash` and a 1.2× cut, **no Bleed** (playtest 2026-10-17, PT-21: with it, Pounce was a longer,
  stronger Scything Step).
- **Chitin Grace** (+2 ATK, +2 Physical Defense) and **Light Frame** (+2 SPD, +8 chi) are plain stat nodes; Light
  Frame is the path's one node that raises the pool.

**The capstones** (`HeroSkill.mantisCapstone`, three exclusive tier-3 nodes) each cost `CHI.CAPSTONE` (30) at the
middle rung, so a capstone and one regular spell empty a full pool and the chi loop holds at the top of the tree.

- **Marked Prey** (`marked_prey`, every fifth turn from the release). The first use, on an enemy within
  `MARK_RANGE`, deals nothing: it lays `AuraType.MarkedPrey` on the Mantis (`aimAt` the prey) at `MARK_TURNS`,
  pays the chi and starts **no** cooldown. The mark locks nothing — moving, the Basic Attack and every other skill
  leave it standing (unlike Aimed Shot's `Aiming`) — and `damageFunnel.takeDamage` adds every HP the prey loses,
  from any source, to its `stored` (`mantis.tallyMarkedPrey`). While it stands the button is the release
  (`mantis.mantisStage`, read through `chargeStage` like a charged skill's), refused as `MARK_PENDING` on the turn
  the mark was laid; the mark ticks on the Mantis's regular turns, so the release is open on its next two and the
  mark fades unreleased at the third. A bonus turn arms the mark as it arms Aimed Shot's aim (`armed`, PT-15), so
  the release is open there too, and the press fires it at the prey without asking for a target (PT-14) (`turnStart` logs the fade, and drops a mark whose prey has fallen). The
  release (`skillResolution.resolveMarkedPreyRelease`) goes only to the marked prey, wherever it stands (no range; to verify in playtest,
  the Monk plan): a blink
  to `mantis.strikeLanding` (back hex, else a rear side, else the free hex beside it nearest the Mantis — its own
  hex when it is already there), the Mantis's Basic Attack with `guaranteedCrit` (its own dodge, flank and on-hit
  riders, Bleeding Blades' Bleed included, but no chi refill), then a fixed cut of `markedPreyCut` —
  `MARK_SHARE` of `stored`, the first cut included, never more than `MARK_CAP` × Attack, no roll and no defence —
  then a blink back to the hex it left when that is free. Rooted, it refuses unless it would not move. The
  release spends the mark and starts the cooldown. A green line joins the Mantis to its prey (`AimLines`).
- **Threefold Scythe** (`threefold_scythe`, every fifth turn). The launch is the skill as authored: a dash of
  `SCYTHE_DASH` and a `SCYTHE_LAUNCH` cut, paying the chi and starting the cooldown. It queues two
  `CombatUnit.mantisTurns`, which `combatStore.nextTurn` grants at once, one per hand-over, with the order unmoved
  and `bonusTurn.active` (nothing ticks, nothing regenerates; the toast reads "Threefold Scythe"). Each sets
  `CombatUnit.scytheStage`; on that turn the Scythe's button is `stages[stage - 2]` merged over the skill — a
  depth-1 arc (`SCYTHE_ARC`, three hexes), then a depth-2 arc (`SCYTHE_SWEEP`, eight hexes) that lays the Mantis
  Bleed — costing nothing and ignoring the cooldown, and the `scythe` usability guard refuses every other button,
  the Basic Attack and Meditate included (`SCYTHE_LOCKED`). A move stays free. A stage passed with End Turn is
  lost; the next turn is still the next stage. The stages rank with the node (`perRank.nested`). A speed bonus
  turn the Mantis was owed is kept and taken after the stages.
- **Mantis Execution** (`mantis_execution`, every fourth turn). Aimed at an enemy within `EXECUTION_RANGE`, it
  moves the Mantis to `strikeLanding` before the strike (a Root refuses a move, not a cut from where it stands),
  then strikes `EXECUTION_CUTS` times at `EXECUTION_CUT` (`repeats`), each its own dodge and crit roll. If the
  aimed enemy dies, the cast queues one Mantis turn ("Mantis Execution") and the cooldown is not started. Nothing
  caps the chain: a bonus turn regenerates no chi, so the pool is the bound.
- Aiming Execution or the release tints the rear of every lit enemy they could reach, as a dash or a blink does
  (`mantis.blinksInBehind`, `boardOverlays.flankShownIds`); the impact clock waits for the crossing
  (`combatMotion.selfMoveLeadMs`).

**The side trees** open on any capstone point; their one-rank starters share `exclusiveGroup: 'side'`.

- **Bleed Harvest** (`bleedHarvest`, one rank, side A) is read where Twin Reap reaps: before the Bleed is removed,
  `mantis.harvestDamage` sizes it as the Bleed's per-turn damage × the turns it had left, and the resolver deals
  that at once through `damageUnit` on a body still standing (a red float, "Bleed Harvest" in the log). It lands
  before the reap's on-hit, so a kill by the harvest is the reap's kill. No Bleed, no harvest; a dodged reap reaps
  nothing.
- **Fresh Kill** (`freshKill`, `onKill`) restores `FRESH_KILL_CHI` × the rung of chi through the passive outcome
  `chi` (`combatStore.restoreMana`, floated "+N Chi"), on any kill a blow makes.
- **Evasive Weave** (`evasiveWeave`, `onMove`) lays an `Evasive` aura of `EVASIVE_WEAVE_DODGE` × the rung, one
  tick long: it holds through the enemies' turns and the tick at the Mantis's next turn start retires it, so it
  is up on a turn the Mantis moved and refreshed by the next move.
- **Deep Cuts** (one rank, side B) is the modifier `bleedDurationBonus` (`DEEP_CUTS_TURNS`, an integer modifier):
  `combatStore.applyEffect` adds it to every Bleed whose `sourceUnitId` carries it (`mantis.bleedDurationBonus`),
  so the Basic Attack's, Scything Step's and the Scythe's last stage's Bleeds all last longer. The
  skill text still states the authored duration.
- **Haemorrhage** is the existing `bleedMagnitudeBonus` (`HAEMORRHAGE`), applied where a Bleed's magnitude is
  resolved, the passive's Bleed included.
- **Scent of Blood** is the modifier `bleedingDamageBonus` (`SCENT_OF_BLOOD`), one more term of
  `damageCalc.masteryTargetMultiplier`, read off the target as the blow lands — so the reap that removes a Bleed
  still struck a Bleeding enemy.

## Boss control and interrupts

**Target rules are stated and pinned.** Every warned or scripted move of the four Empire bosses has a
one-sentence rule in `bossSkills` (`<skillId>.target`, `data/templates/bossText.skillTargetRule`,
`TARGET_RULE_IDS`), in English and Polish, shown on the warning banner. `targetRules.test.ts` holds every targeting function to its sentence on a fixed board, ties
included: Farthest Prey (`preyTarget`), Warren Collapse (`collapseCentre`), Boundary Smash (its ring),
Imperial Cleave and the Dragon's Claw and Wing Thrust (the arc the ordinary scoring aims, first hero on a
tie; a Taunt turns the Claw), Foreclosure (`foreclosureSeals`), Chains of Tribute (`chainPair`), Collateral
Claim (`claimBrands`), Crownfall (`crownHexes`), the Realm (`realmHexes`), Furnace Heart (`heartSpot`),
Cinder Rift (`riftLine`), Skyfire (`skyfireLandingCentre`), Creeping Winter (`winterHexes`), Icebound
Reprisal (`reprisalPlan`) and Whiteout Convergence (`convergencePlan`). A new warned move of these bosses
must state its rule or the suite fails.

**The unharmed-round counter** (`BossScriptState.unharmedRounds`, `systems/combat/unharmed.ts`): 0 after
any hero damage (a barrier eating the blow included; `damageFunnel`), up by one as each regular turn of
any boss begins (`bossRegistry.turnBegun`, after the boss's own turn start has read it). A Fury action or a speed bonus turn takes `beginTurn`'s short
road and neither counts nor resets it. Read as his turn begins, 2 or more means a whole round passed
unharmed (`wholeRoundUnharmed`). The Troll acts on it (he regenerates, while two heroes stand); the other bosses do not yet.

Bosses (`unitTier` — the template's tier) **ignore Stun, Silence, Freeze and Root** as ordinary disables
(`bossControl.BOSS_IGNORED_DISABLES`, enforced in `combatStore.applyEffect`), so a party cannot win a boss
fight by chaining them. **Taunt stays normal target control.** Root was the open question and is resolved
here: it is a disable with a displacement edge — a rooted boss could not leave a warned footprint or reach a
marked hero — so it is ignored like the others and a preparation may still list it.

- **An authored preparation states what interrupts it** (`PreparedSpec.interruptedBy`, `tauntCancels`).
  `combatEvents.applySkillStatus` — the funnel both execution paths use — settles the interrupt *before*
  the application, so the status still does not persist on a boss, and an accepted one cancels exactly the
  listed preparation and nothing else (not other casters', not the boss's turn). It works through
  `DebuffImmunity` too: the authored counterplay must not depend on an unrelated immunity.
- The result is visible: the log says who interrupted what, the target floats **INTERRUPTED** or
  **IMMUNE**, the armed skill's card says *Interrupts X* / *May interrupt X* (`previewInterrupts`, which
  reads the same `statusInterrupts` the resolver does, and says "may" for a `chance`), and a preparing skill
  describes its own rule ("Interrupted by Stun, Taunt" / "Cannot be interrupted").
- Elites keep their disables: only `tier: 'boss'` is immune.

## Attackable objectives

A `CombatUnit` with `objective` (`ObjectiveSpec`) is an attackable arena objective — an Imperial Standard, a
Furnace Heart. It has HP, a hex and a side, is targeted and destroyed like any enemy (barrier, armour and
damage types all apply), but **never takes a turn, is not in `turnOrder`, and does not count for victory**
(`combatOutcome` filters it) or as an ally to mend or buff.

- Raised by a skill's `places` (`ObjectivePlacement`), shared by both resolvers
  (`objectiveBoard.castObjectives`). HP is a fraction of the caster's own maximum, so it follows encounter
  scaling. `maxStanding` (default `count`) stops a skill being recast onto its own field; it is available
  again once enough have fallen.
- **It means something to its owner.** While it stands the owner takes `protection` less
  (`protectedDamage`, applied in `damageUnit` before the barrier and capped at `MAX_OBJECTIVE_PROTECTION`);
  destroying it applies `onDestroy` to the owner, and the *last* of its kind applies `onAllDestroyed` ("left
  exposed"). `linkedToPrepared` ties it to the warning the same cast announced: destroying it cancels that
  attack, the attack landing spends it (a Furnace Heart). `turnsLeft` counts down on the owner's turns;
  `shattersOnPhase` (default true) removes it at the owner's phase change. Destruction is detected in
  `damageUnit`, so a banner burned by a damage-over-time tick falls the same way a struck one does.
- **`areaResist`** is the share of an area hit the objective itself shrugs off (`areaResistMultiplier`, last in
  `calculateDamage`): a radius, cone, chain, line, arena-wide or random-enemies skill. Whiteout Convergence's
  spires (`HEART_SPIRE_AREA_RESIST`) and Aethelred's standards (`AETHELRED_STANDARD_AREA_RESIST`) take half
  since the playtest of 2026-10-14, when one area spell cleared either field; standards also rose from 3.5%
  to 5% of his (now +50%) health.
- **The AI scores setup.** Raising an objective deals nothing, so a damage-only score was zero and it would
  never be cast; `evaluateObjectives` scores what it buys (`AI_OBJECTIVE_VALUE`, plus protection), crowded
  down per one already standing, zero with nowhere to place. Prepared skills are scored by the footprint's
  expected damage as before.
- The arena draws an objective as a placeholder staff-and-crystal (`UnitMesh`) until the encounter that
  raises it supplies a model; the Furnace Heart, the Imperial Standard, the Heart of Winter's anchors and its
  spires each have a geometry of their own there.
- **An objective can ride on a hero** (`carrierId`: the Emerald Dragon's carried Furnace Heart). It shares its carrier's
  hex and goes wherever they go (`combatStore.moveUnit`, `carryObjective`), always after them in `units`, and
  `getUnitAt` never returns it; a harmful blow from the carrier's side on that hex strikes it instead of the hero
  (`objectives.struckBody`), and the carrier may aim an attack at its own hex to strike it. Its warning is
  `PreparedSpec.carried` (see the Emerald Dragon).
- **Objectives can also be bound to a warning without riding on it** (`bindsPrepared`, with `cancelsOnLast`),
  hurt their owner when they fall (`backlash`, a share of its maximum health, bypassing protection) and do
  something when the last of their kind falls (`onLast`: `release` the owner's phase, or `expose` it). The
  Heart of Winter's anchors and spires are the users.

## Forced movement

`forcedMovement.traceForcedMove` is the one answer to "where does this body land", used by `resolvePush`
(player and AI), `previewForcedMoves` (a warned attack's preview) and the resolution that follows. It walks
the push direction hex by hex and stops **before** the first hex that is off the board, holds a living unit or
an objective, or is solid ground (`ArenaHazard.solid`) — the deterministic fallback for a blocked destination
is the last free hex on the line, or the start if the first step is blocked. Non-solid hazards (a fire line)
are crossed and reported in `ForcedMove.hazardIds`, so a preview can show the combined landing threat. A body
never ends on a living unit or outside the arena (`forcedMovement.test.ts` sweeps 200 random crowded boards).

- **Several bodies resolve in a fixed order** — furthest from the origin first, ties by hex — so the front of
  a line clears the way for the ones behind and the preview, which uses the same order, is exact
  (`forcedMovement.test.ts` checks 60 random layouts, hazards included, against the real resolution).
- `combatStore.hazards` holds the ground that remembers (`addHazard`/`removeHazard`); it is read by every
  push and cleared with the fight. The Pyromancer's Detonation lays non-solid burning ground (see "Mastery Bleed and Burn payoffs") and
  the Troll Chieftain's Warren Collapse lays **solid** rubble (see "The Troll Chieftain"); the other encounter
  kits that need fire lines will add more. A solid hazard also blocks a unit's own movement
  (`getMovementRange(unit, units, hazards)`: neither entered nor walked through), not only a shove,
  and no self-move lands on it: `resolveSelfMove(caster, skill, aim, units, hazards)` gives a dash
  another free hex beside its target, refuses a blink or a `free` move aimed at it, and stops a
  withdrawal short of it as a shove does; `getValidSkillTargetHexes` and `selfMoveBlocked` take the
  same hazards, so the board never offers rubble as a landing (playtest 2026-10-09: a Warrior's dash
  landed on the Bonebound Warlord's rocks).
- **Burning ground that is crossed, not walled** is a non-solid hazard with `crossDamage` — the Emerald
  Dragon's Cinder Rift (see "The Emerald Dragon"). `combatStore.moveUnit` settles it for every driver: the
  path is the route an ordinary move walked (`findMovePath`, which prefers a route around the fire when one
  costs no more), or else the straight hex line from where the unit stood to where it ended (a shove travels
  a line, and it is the line `previewForcedMoves` reports); each patch costs a hostile body its fixed damage
  **once per move** however many of its hexes the path touches, leaving the ground from a hex on it costs nothing, and the owner's own side is never
  burned. `moveUnit` returns the ticks so the callers that hold a sink put the numbers on the board
  (`systems/combat/tickEvents.ts`).
- **A push from an ordinary skill is not previewed**: it resolves at the tap, with no confirm step to hang a
  preview on. Warned attacks are the case where a push is delayed, and those are previewed.

## Poison is a pile of doses

The one affliction with a rule of its own rather than an entry in `STACKING_MAGNITUDE` (that list
is now two, pinned by name in `blessings.test.ts`), because neither half of what it does is a
number that table can hold. All of it is symmetric — a spider doses a hero by exactly this table.

- **The cap is counted in doses** (`MAX_POISON_STACKS`), not points, and `ActiveEffect.stacks`
  carries the count. A dose is worth the applier's attack, so a points ceiling handed a strong hero
  fewer of them. `stacks` defaults to 1, which is what makes every poison authored before the
  mechanic existed a legal single dose without being told about it.
- **A dose is two turns of biting, front-loaded**: full magnitude on the first tick, half on each
  of the next two (`poisonTickDamage`, read on the *incoming* duration). Same total as biting
  evenly; what it buys is that poisoning something matters on the turn you spent doing it.
- **A dose landing on a full pile detonates** rather than doing nothing — `POISON_BURST` × the
  attacker's attack, rolled through `damageCalc` so it crits and armour applies, but never dodged
  (the venom is already inside them). The burst spends the pile: the Poison is removed and the next
  dose starts again from one. Reaching the cap used to mean the poison path's reward for succeeding
  was that its strikes stopped counting; keeping the doses after a burst (until 2026-10-09) made every
  later hit another burst, two a turn from Venomed Blades.
- **The rule lives in `combatStore.applyEffect`**, so every route in obeys it: a skill, a passive,
  an enemy's bite, a coated blade. It returns an `EffectOutcome` when a dose *was* the event, and
  the two execution paths put the number on the board themselves. The cap is enforced in
  `mergePoison` as well, because the burst needs an attacker to roll against and a dose from a
  dead one would otherwise stack past the ceiling on the one path that never checks.

**`applyOnHitStatuses` takes HP actually lost, and both call sites now read it back from the
store.** `damage - absorbed` accounts for a Barrier and nothing else, so an Invulnerable target
still reflected Thorns, chained Shock and took a dose from a blow that never reached it.

**A Shock spark is sized from the whole blow, not from the HP lost**, and only a Shock-applying spell
sets one off (see *Stormcaller remaster*). Both call sites pass `dealt`
(the blow past any Barrier, overkill included, and zero when nothing reached the health), and
`shockChain` takes `SHOCK_CHAIN_FRACTION` of it — so a killing blow on a nearly dead shocked unit still
jumps with the weight of the hit, to that unit's own side (heroes, when an enemy struck a shocked
hero). The spark is drawn as a `lightning` bolt in `SHOCK_COLOR` (`#66ccff`) from the struck unit to
the one it hurts, its number floats over that unit, and anything the spark kills that goes off when
it dies is played. The bolt goes through `EventSink.impactVfx` (`CombatSink.impactVfx`),
which the scene delays by the action's impact time, so it lands with the blow's
numbers. Pinned by `shockSpark.test.ts`.

`data/display/auraGlow.ts` maps a few auras to a colour that `UnitMesh` renders as a pulsing shell
around the unit (Carnage left it in the Berserker remaster for flames of its own, `CARNAGE_FLAME`). Pure and React-free, so it stays node-testable; it deliberately does **not** tint
model materials, and that stays right even though the frost tint has since shown a tint can be done
safely — this table fires on several auras at once, and a shell composes with anything by sitting
outside it while two overlapping tints would have to decide what they mix to.

**What is drawn on a body is a fixed vocabulary, and each entry has to mean one thing.**
`UnitMesh` draws six: the stealth fade, `AuraGlow`'s additive haze, `BarrierShell`, the frost tint,
`RimeShards` and `RootedFence`. (Path-specific pictures have since joined them, each for one status:
`FlameShroud` for Flame Guard, `ChargeOrb` for a held charge, `MartyrBubble` for the Martyr's protection.)

- **A gold pulse on the whole body means the player is choosing this hero's action** (`useTurnGlow`): every
  material's emissive eases toward `#ffd27a` and back over 1.1 s, only on the hero `choosingUnitId`
  (`components/combat/turnCue.ts`) names: a living, non-objective hero in `PlayerSelect`, `PlayerMove` or
  `PlayerTarget`, with no `handingOver` and none of the scene holds the action bar waits on (intro,
  deployment, a wave arriving, the opening shapes, `turnStartBusy`). The phase is back on `PlayerSelect`
  while a walk, cast or swing plays out, so the phase alone kept the hero glowing through its own
  animation (PT-07); enemies never wear it. The scene passes it to `UnitMesh` as `choosing`. The white
  `ActiveHexRing` under the hero follows the same rule. It shares `emissive` with the frost
  tint, so it is declared before that effect and re-runs with any tint (frost, Carnage, Righteous Fury): its
  cleanup restores the tinted colour first, and its snapshot is taken on the first frame after the tints apply.

- **A translucent shell means shielded.** It read as `Chill` for as long as `ColdOverlay` existed,
  which is the clearest visual language the board has saying something that was not true — so the
  shell is `AuraType.Barrier`'s now: since the 2026-10-09 VFX review a smooth bubble, nearly clear in
  the middle with a white-to-grey rim (a fresnel shader, normally blended), so it cannot be taken for
  `AuraGlow`'s soft additive haze and the protected unit's face stays readable through it. It **reports how much is left**: a Barrier is a pool, and
  plates that look the same at 40 points and at 4 add nothing the bar had not already said. The
  high-water mark is remembered in the component, because nothing in the store records what a
  shield was worth when it landed, and it resets by unmounting when the pool empties.
  - **The seams are the part that has to stay quiet.** The shell itself is `BackSide`, so its front
    hemisphere is culled and the unit is never behind glass — but the wireframe is drawn on both
    faces, and at its shipped 0.62 on a sphere wide enough to enclose the model it put a cage across
    the face of whoever was being protected. A status is not allowed to hide the unit it is a status
    *of*. Roughly halved (≈0.27 for the seams, ≈0.12 for the shell) and pulled in to hug the torso;
    everything the drawing says survives that, because what carries the information is the thinning
    and drawing-in as the pool is spent rather than the opacity it starts at.
- **`BARRIER_COLOR` in `data/display/statusDisplay.ts` is the one colour a shield is.** The badge
  and pip were `#66ccff` and the bar's shield segment `#cfd4d8` — cyan and steel, for the same
  effect on the same unit — and the shell would have been a third. The steel wins: `Chill`,
  `Freeze` and `Shock` are all saturated ice blues and Barrier is the one of the four that is good
  news, so `statusDisplay.test.ts` pins the shield desaturated and the ice statuses not. Hue cannot
  separate them; saturation can.
- **`dodgeText()` / `DODGE_COLOR` sit in the same file for the same reason** — a combat display
  constant *both execution paths* have to agree on, and they had been two spellings of one event. The
  player's resolver floated `MISS`; the AI path had no text channel at all, only
  `onHit(position, damage)`, so it reported a dodge through the *damage* callback as zero and the
  arena drew **"-0"** over the hero who had just avoided the blow — in the half of the fight the
  player watches most closely, and saying the opposite of what happened. `EventSink` gained an
  optional `float`, and since the AI executor took a `CombatSink` and an enemy's cast became `resolveSkillUse`
  both sides float the word through the one `float` channel (pinned at runtime by `dodgeReport.test.ts`). **"DODGED", not "MISS"**: the roll is the
  *target's*, off `dodgeChance` on the defender's effective stats, and nothing in this game rolls a
  miss.
- **Chill and Freeze differ by degree, because the mechanic does** — chilling a chilled target
  freezes it. Chill is a dusting the model still shows through; Freeze takes the palette most of
  the way over *and* grows `RimeShards` out of the ground, so the pair are told apart by silhouette
  as well as by saturation, which is the first thing a busy board takes away. The shards stay
  inside a third of a hex where `RootedFence` sits at 0.85 of one with a rail between its posts, so
  a rooted, frozen unit still reads as two things.

## Forms and boss phases

Boss defence tuning (playtest 2026-10-12) applies `BOSS_PHYSICAL_DEFENSE_SCALE` (1.1) and
`BOSS_MAGIC_DEFENSE_SCALE` (0.9) to the previous authored defence, rounded before encounter scaling.
Base P.DEF/M.DEF is now Dragon 11/9, Bonebound Warlord 10/8, Heart of Winter 14/12 (both since their
2026-10-19 nerfs) and Aethelred
22/18. Both channels retain normal encounter and phase scaling; ordinary enemies keep their
existing defences. This is a modest tuning starting point; actual fight feel still needs device play.

`systems/combat/forms.ts` owns "become this: these stat multipliers, this kit". **Wildshape and boss
phases are its two callers** — they are the same store write, and a parallel `bossPhase` path
would be two things to keep in sync forever.

- `CombatUnit.formStats` is what `getCombatEffectiveStats` reads. `wildForm` is only the *model
  key*; a unit with one and not the other is a state the game cannot produce, and only
  `setWildForm` writes both.
- **No profile may carry `maxHp` or `speed`.** For a boss the first is load-bearing rather than
  tidy: the phase triggers *are* HP thresholds, so rescaling max HP on entry re-triggers what
  caused it. Both are pinned by tests.
- Phases live in `data/templates/aethelred.ts` and carry **resolved skill objects, not ids** — the id
  resolver is in `mastery.ts` and importing it from boss data would close a cycle through
  `forms.ts`.
- `combatStore.enterPendingPhase` is called from `settleDamage` (`damageFunnel.ts`), which both
  `damageUnit` and `tickEffectsOnUnit` end with.
- Three rules, all in `bossPhases.ts`: the index is **monotonic**, a blow crossing two thresholds
  enters **only the next phase** and leaves his health exactly where the blow put it, and the entry
  threshold becomes a hard `hpCeiling` so a lifesteal boss's health is a ratchet. **A phase is
  lived in before it is left**: `pendingPhase` refuses the next one until he has begun a turn in this
  one (`bossScript.phaseTurns`), checked again at the start of his own turn
  (`bossActions.beginBossTurn`). That is the overflow rule — no phase is skipped and no earned
  damage is erased; a burst just makes the following phase short. A unit with no script (a fixture)
  has no turn requirement.

**`AfflictionType.Doom`** is the one new mechanic: nothing while it runs, `magnitude` damage the
turn it expires. Handled in `tickEffectsOnUnit` on the *outgoing* duration, so it fires once.
Effects tick at the **start** of a unit's turn, so a Doom of duration 2 gives exactly one turn to
answer — a 1 would detonate before the target ever acted.

## Aethelred: the three-phase Obsidian Emperor

The fight is a *sequence*, so it has a script: `systems/combat/bossScript.ts` (pure — what his next
move is, what each warning covers) and `bossActions.ts` (store-writing — raising the warning, the
turn-start rules, the passives). The skills in `data/templates/aethelred.ts` are what the party
reads; the rotation and the footprints are the script's. A highest-damage AI cannot hold together a
preparation, a linked effect and a delayed payoff, so `decideEnemyAction` hands a scripted boss to
`decideScripted`, which asks `chooseMove` and aims the sword and the wedge with the ordinary scoring
restricted to that one skill. The rotation position rides on the `AIAction` (`bossStep`) and is
written only when the move is actually made.

- **The fight's feeling** (the boss feel pass, plan): the
  closer the party gets to winning, the harder he flips the table. He plays by his rules, changes them, then wrecks the
  board rather than lose.
- **Every move is his alone, including the repeatable one.** The Emperor's Blade is a frontal arc
  (depth 2) that applies Bleed; a second hit refreshes it (Bleed keeps the larger magnitude and the
  longer clock). There is no single-target fallback and Undying is gone.
- **One major delayed attack at a time.** The Cleave, Foreclosure, Chains, the Claim, Crownfall and
  the black sun are all `PreparedAttack`s (`prepares`), so the HUD line, the red hexes, the response
  window and the landing are the machinery every warning uses. `chooseMove` skips a major while any
  of his warnings is open, so the Crown and the seals never combine. Each phase's rotation
  (`ROTATIONS`) opens on the moves it exists to teach, because a warning takes two of his turns (the
  cast and the landing) and a phase is three or four turns long.
- **Footprints are fixed at the cast and never retarget.** Foreclosure stamps every hero's hex and
  the six around each (`foreclosureSeals`, radius `AETHELRED_FORECLOSURE_RADIUS` 1, in both phases;
  playtest 2026-10-14 — it was the two or three hardest hitters' own hexes); a ring hex is stamped only
  while every hero can still step clear (`everyoneCanLeave`). A hero stepping away moves the hero, not
  the seal. Black glass and rubble are never stamped, marked by the Realm or a claim, or counted as a way
  out: every footprint function takes the arena's hazards.
- **Imperial Cleave can be blocked, and can whiff** (boss tactics, 4.4). It carries `PreparedSpec.blockedBy`
  (`AETHELRED_CLEAVE_BLOCK_SHARE`): a hero in the wedge holding a Barrier, Last Stand (while it bites) or
  Immovable stops the blade. The blow falls on the shielded hero nearest where he stood at the cast, at half
  strength, with no push and no Bleed; the rest of the wedge is spared and he is left Exposed
  (`AETHELRED_CLEAVE_EXPOSED`, for the party's next round). The wedge still fixes his facing, so a hero who
  steps to his side or back strikes for more. Its `onWhiff` (hook `cleave`, answered by the script's
  `whiff`) fires when the wedge is empty at the landing: the orb takes a charge and, in phase 1 while
  fewer than three Standards stand, a Standard rises on the free wedge hex nearest where the sword was
  aimed (`bossActions.cleaveWhiffed`, `whiffStandardHex`). A Cleave raised with charges on the orb spends
  them on hexes beside the wedge like every orb warning (`spendOrbOnCleave`, from the script's `afterCast`).
  The plate names the blocker, and says "A hero who holds the wedge behind a Barrier stops the blade."
- **Imperial Standards pay the breaker.** `ObjectivePlacement.breakerBarrier`
  (`AETHELRED_STANDARD_BARRIER`, a share of the breaker's own maximum health, for
  `AETHELRED_STANDARD_BARRIER_TURNS` turns) is granted by the damage funnel (`damageFunnel.objectiveFell`)
  to whoever brought the banner down, in whatever order they fall; the last still exposes him. A
  phase change shatters banners without paying anyone. A Standard a whiffed Cleave raises pays the same.
  Each standing banner reduces the damage he takes by `AETHELRED_STANDARD_PROTECTION` (20%, summed), and
  since the playtest of 2026-10-28 each one destroyed costs him `AETHELRED_STANDARD_BACKLASH` (2%) of his
  maximum health, less `AETHELRED_STANDARD_BACKLASH_TIER_STEP` (0.25 points) per Seal tier above the first
  (1% at tier 5), through the objective backlash path (`ObjectivePlacement.backlashTierStep`,
  `objectiveBoard.placementBacklash`; his Seal tier is `CombatUnit.challengeTier`, set when the castle
  builds him). The skill and briefing text say "reduces the damage he takes" rather than "turns aside".
- **Foreclosure has three answers per sealed hero** (`PreparedSpec.sealed`; the warning stores `bound`,
  `centres` and `tolls`). **Step off the seal**: at the landing the orb takes a charge for every seal left
  empty (`afterForeclosureLanded`; a hero who fell, or who paid, is no empty seal), up to the orb's cap
  for the phase (`orbChargeCap`: `AETHELRED_WHIFF_CAP` in phase 1, `AETHELRED_LEDGER_CAP` in phase 2,
  `AETHELRED_TITHE_CAP` in phase 3, raised so a party that steps off together can be held). **Strike him
  from it**: a basic attack on him from the hero's own seal pays it (`applySealToll`, part of his cast rule
  `aethelredCast`, which the resolver fires for every paid cast), and neither the seal nor its ring erupts under that hero. **Cast from
  it**: a class skill from the seal costs `AETHELRED_TOLL_HP` of the hero's maximum health (never kills,
  no Barrier lends it back) and the eruption still lands. A seal is answered once. The boss panel shows
  "Seals paid: n/N" while it is open and the orb row (`Orb n · next warning +k hexes`, which is the debt
  the next warning will add). `foreclosureSeals` keeps `everyoneCanLeave` as the fallback promise.
- **Crownfall leaves black glass.** After the fall (`afterCrownfallLanded`) every crown hex that held no
  body, less the orb's added hexes, becomes solid ground (`glassHexes`, kind `black_glass`, `lasts: 'phase'`),
  outermost first and only while the floor stays one connected piece, so it can wall off a corner and never
  seal a hero who held outer ground. It blocks movement, shoves and shots like rubble and clears when the
  phase turns. `crownIsFair` now walks the real ground (`getMovementRange` over the hazards) and refuses a
  cast that would leave a hero no way into the safety around him. The board draws it as dark glass
  (`GlassField`, two instanced meshes). A chain is the exception that proves it: its warning *follows* the
  two heroes it links (`followChains`), and it is gone, with the status, if either is cleansed or
  falls. A claim keeps only the rings of the soldiers still branded and shrinks its damage with them.
- **Orb charges mark hexes and nothing else.** The orb's charge is an `AuraType.OrbCharge` on the boss
  (visible on his status row). The next warning spends all of it to add hexes beside the pattern
  (`addOrbHexes`), as near the party as they can be, and **never one that leaves a hero without a way
  out** (`everyoneCanLeave`). The added hexes ride on the warning as `bonusHexes` and the scene draws
  them in the attack colour over the warning's own. Blood in the Ledger (phase 2) charges once at the
  start of his turn if any hero Bleeds; Tithe on Mercy (phase 3) charges once between two of his turns on a
  hero's effective direct heal or a Barrier landing on a hero. Every seal left empty and every Cleave that
  strikes nobody charges it too; the caps are per phase (`orbChargeCap`). Charges clear at a phase change.
- **The black sun widens only to a radius everyone can still leave**, and never silently. The Pyre's
  Bargain counts the damage the party deals while it burns (`bossScript.pyreDamage`); each step of it
  widens the warned disc by one hex up to `AETHELRED_REALM_MAX_RADIUS`, and any hero the wider disc
  newly covers is **owed a turn**, so the landing waits for them (`widenRealm`). He pays real HP up
  front (`payHealth`: no Barrier, never kills). Crownfall is only chosen when every hero can reach
  the safety ring around him in one move (`crownIsFair`).
- **Overturn: the closer the party gets, the harder he flips the table** (the boss feel pass;
  `bossScript.overturnDue`, `overturnThrows`, `bossActions.heave`, called from `beginBossTurn`). Not a move he chooses and
  never on his bar. As his turn begins after a phase has turned, and once more at `AETHELRED_OVERTURN_LAST` (10%) of his
  health in phase 3, every hero is thrown: in id order, a random distance within that throw's range
  (`AETHELRED_OVERTURN_DISTANCES`: 1–2, 2–3, 3–4) in a random one of the six directions, both on the fight's own dice
  (`dice.roll`, so a replay throws the same), each traced like a shove (`traceForcedMove`) seeing where the heroes before
  landed, so walls, bodies, objectives and black glass stop it and Immovable is not moved. Each hero then takes a light
  blow (`AETHELRED_OVERTURN_DAMAGE`, the `overturn` skill). The throw waits for his turn so that it comes after the banner
  and right before his first move. `LegionScriptState.overturns` counts the throws through phase changes, one a turn; a
  fight opened in phase 3 owes only the second. A hero thrown into an open warning is owed a turn before it lands, added
  to its responders and to who it threatens or given a window back (`oweThrownTurns`, the `widenRealm` rule). The gauge row
  names the next threshold ("Overturn at 33% health", `nextOverturnAt`). Pictured by the existing `quake`, with the boss's
  launch sound; the heroes `jump`; a toast carries his line, a different one per throw.
- **Phase 2 opens on the Chains** (`ROTATIONS[1]`: Chains, Foreclosure, Claim, Blade): right after the throw `chainPair`
  links the two it left farthest apart, so the throw picks the partners. They walk together, cleanse, or let the weaker take it all.
- **A Barrier on a crown point** (`PreparedSpec.heldBy`, `AETHELRED_CROWN_BLOCK_SHARE`): each hero on a crown hex holding a
  Barrier, Last Stand while it bites, or Immovable takes half the point there (`landingPlan`'s `shares` and `holders`), and
  nobody else is spared for it, unlike the Cleave's `blockedBy`. The rest are struck in full and empty points leave glass. The
  plate names who holds ("point held: Hunter"), the board draws their hex in the support colour apart from the points that
  fall in full (`boardOverlays.heldGroupHexes`), the log says so (`combatLog.log.held`) and the tally counts them `blocked`.
  `crownIsFair` and the glass's connectivity rule hold.
- **The Writ is the party's side of the rule.** A class skill under a Writ costs a share of the
  bearer's maximum HP and lends him a Barrier; a basic attack, a step (`markMoved`) or a cleanse voids
  it. His cast rule (`aethelredCast`, fired by `castRules.castPaid`) charges the price; the step is his
  registry entry's `onStep`.
- **The Legion Responds** is evaluated between turns (`resolveBossResponses`, called from `beginTurn`
  next to `resolveWaves`): a fifth of his maximum HP in the window since his last turn brings two
  infantry, once, under a cap. The damage is never erased.
- **Phase changes clear what the old phase raised**: warnings, orb charges, writs, chains and brands
  go, and standards shatter. His rotation restarts; the Legion's once and Overturn's count are remembered.
- **Obsidian Seal tiers** (`bossScript.aethelredTwist`, `AETHELRED_TWIST`, off `challengeTier`, which the castle run
  sets; plan). Tier 1 is the fight above, unchanged;
  each tier keeps the twists below it, and the castle's picker and his briefing list them (`castle.castleTwistsAt`).
  **Tier 2:** a falling Standard mends those left standing to full. The funnel marks the fall
  (`LegionScriptState.standardFell`) and `mendStandards` settles it between turns, once the blows of the turn that felled
  it have landed, so one area blow that fells two fells both whatever order it struck them in. The breaker's Barrier and
  his backlash are unchanged, and a phase turning (which pays nobody) mends nothing. **Tier 3:** each throw sets the hexes
  the heroes were thrown from to black glass (`layGlass`, the one rule Crownfall's glass keeps: `glassHexes`, solid, gone
  when the phase turns, never under a body and never cutting the floor in two). **Tier 4:** a seal left empty adds
  `AETHELRED_TIER_SEAL_CHARGES` (2) to the orb instead of one, up to the phase's cap (`emptySealCharges`). **Tier 5:** the
  third throw owes the black sun (`realmOwed`). `chooseMove` makes it his next move whatever its cooldown, as soon as no
  warning of his is open, and the rotation stays where it was. He still pays for it, but the health check an ordinary
  Realm makes does not apply, so at very low health `payHealth` leaves him at 1. The Pyre's Bargain widens it as ever.
- **Presentation** (`systems/combat/bossPhaseCard.ts`, `components/combat/hud/PhaseBanner.tsx`): a
  phase change shows a banner with his line (`BossPhase.voiced`: the phase's `announce`, in a sore loser's voice; no other
  boss speaks on one) over the new rule, one sentence, a strip keeps the phase on screen, the model grows
  into each phase (`BossPhase.presence`, eased in `UnitMesh`), the transition plays its own picture
  and the fight waits for the player to tap the banner. Pacing callbacks due while it is open
  are deferred until acknowledgement; the minimum `PHASE_BEAT_MS` still lets the picture land.
  **The banner and the transition's picture wait for the blow that crossed the threshold** (playtest
  2026-10-21, PT-25): `stage.beatAfterPicture` starts them once `busyMs` has run out — every number,
  fall and effect of that action landed — and holds the hand-over and the pacing `PHASE_BEAT_MS` past
  that (and for the tap). The log line is written at once. Before, the banner cut across the blow.
  The sound is the existing
  `BOSS_PHASE_CUES`; the signatures are Foreclosure and Crownfall (`bossSounds.ts`). The nine moves
  borrow the old kit's pictures through `HeroSkill.icon` until their own are drawn.

### How it was tuned

`systems/sim/emperorMeasure.ts` runs the real fight headlessly with a level-20 party from the tuning
harness's `perfParty` and reports boss turns by phase, party damage taken and the lowest any hero fell. It
plays a plain AI party and a *responding* one (`respondingPolicy`: steps out of a footprint, answers a writ
with a basic attack, regroups for a chain). `__tests__/combat/emperorFight.test.ts` pins what the sim can
honestly say.

**Three tunings, and the third is the one standing.** The first (`maxHp` 700, attack/magic 24, defence 16)
measured 10–13 boss turns for a responding sim party, but a playtest with an epic-geared party found him
"very very easy". The second raised attack and magic ×3 (72), defence ×1.5 (24) and `maxHp` to 2,600
(about 10,000 at level 20, tier 1). **The sim cannot judge it**: its parties do not heal, cleanse or kill
branded soldiers, and at these numbers they lose in phase one at every tier. Defence is the sensitive
dial — at ×2 the sim party's damage per boss turn fell to a third — so retune it from play, not from
the sim. A third pass, after the playtester clarified the party (four level-20 heroes in mostly epic gear with some legendary pieces, chosen paths), called the second an over-buff, defence especially: attack and magic ×2 (48), defence 20 and `maxHp` 2,080 (about 8,000 at level 20, tier 1). A fourth, from the playtest of 2026-10-14, which found him weaker than the Heart of Winter: `maxHp` 3,120 (+50%, about 12,000 at level 20, tier 1) and attack 53 (+10%); magic stays 48. The playtest of 2026-10-17 found the castle too long: every castle body now carries 70% of its scaled health (`CASTLE_HP_SCALE`), about 8,400 for him at level 20, tier 1, with attack untouched. That put him back under the Heart of Winter (about 12,300), so the playtest of 2026-10-23 raised `maxHp` to 5,600: about 15,100 at level 20, tier 1, after `CASTLE_HP_SCALE`. The playtest of 2026-10-28 found the rework and that health together an over-buff: his defences fell from `bossDefences(20)` to `bossDefences(16)` (18 physical, 14 magic), health kept. The sim stays useful for the shape of the fight (which moves appear, how warnings land), not for
its length.
`BALANCE.AETHELRED_*` holds every tunable number.

## The Troll Chieftain: the six-turn Bonebound Warlord

The Warren's boss is a *fixed sequence* too, so it has a script of its own: `systems/combat/trollScript.ts`
(pure — the cycle, what each warning marks, what the rubble does) and `trollActions.ts` (store-writing — raising the
two warnings with a footprint of their own, the turn-start rule, the leap, the rubble and the Sweep through it). The
skills are `data/templates/trollChieftain.ts`; every number is `BALANCE.TROLL_*`. His script (`systems/combat/scripts/troll.ts`)
asks `chooseTrollMove` and aims the Sweep and the Smash with the ordinary scoring restricted to that one skill. His
old Smash and Charge and his Regeneration passive are gone; what he recovers now is the price of a round nobody
fought him in (below). **Rubble is the fort** (the boss feel pass, its plan): the
Collapse builds it, the pair uses it and every move of his kicks it down — the Prey and the brace spend a heap, the
Sweep breaks every heap in its arc.

- **The cycle is fixed**: Farthest Prey → Bonebreaker Sweep → Bonebreaker Sweep → Boundary Smash → Bonebreaker
  Sweep → Bonebreaker Sweep, then round again (`TROLL_CYCLE`). **The Collapse has no slot**: the Smash's landing
  casts it (below), so six slots as before and warnings no more often, and between a Collapse and the next Smash
  come four Sweeps and a Prey. The position is `bossScript.step`, written only when the move is actually made
  (save version 81 changed what a step names). **A speed bonus turn takes the next slot and never skips one.** A move
  that cannot be made does **not** use its slot: a delayed attack wanted while one of his warnings is open becomes a
  Sweep without advancing (`chooseTrollMove`), and a Smash with nobody inside its reach becomes a Sweep or a walk. The
  HUD's intent strip (`IntentStrip`, from `trollIntent`) names what lands and the next three moves off the same
  step, so it cannot name a move he will not make. (`IntentStrip` is no longer mounted in the scene: the boss panel's
  summary line, the Troll's `next` fact of `bossReadout`, is the readout.) That line says in a few words the rule of
  the move due next (`trollMoveHint`, every move has one): "Next: Boundary Smash (brace on rubble; then the roof
  falls)", "(hunts the farthest; bait him onto rubble)", "(breaks the rubble in front of him)". The same rules are in
  each move's `.target` sentence in `bossSkills` (the Sweep has one now too; the briefing and the warning banner read
  them) and in the briefing's tips.
- **A landing is his turn**, as for every warning (`TurnStart` kind `'resolved'`), so the six slots are
  separated by the turns a warning takes to land; a landing does not advance the cycle.
- **Bonebreaker Sweep** is a frontal arc (depth 2) that adds one **Bonebreak wound** (`AfflictionType.Wound`)
  to each hero hit. The wound strips both defences by `TROLL_WOUND_DEFENSE` points a stack, has `duration: -1`
  and **no stack cap** (`STACKING_MAGNITUDE` is `Infinity`; the count rides `ActiveEffect.stacks` and shows as
  `×3 (−3)` on the hero). Only a cleanse (`removeAllAfflictions`) lifts it; the ordinary shred floor
  (`MAX_SHRED_FRACTION`) is what stops a pile of it taking defence below a fraction of its base.
  **It kicks the fort**: every heap of his rubble in the arc breaks, whether or not anyone stands behind it, and a
  hero in the arc with a heap between them and him (`heapsBetween`: a heap touching both, so only a hero two hexes
  off) is **spared** — no damage, no wound (`sweepThroughFort`). That heap is always inside the arc, so cover is
  spent as it is used. He sweeps the way he faces, **toward the hero the arc would hurt most**: a hero a heap
  shields counts for nothing while one he would hurt is in reach (`isCoveredFrom`), and when the only hero in reach
  is shielded he sweeps the heap anyway. So a pair that fights him from the side away from the heaps it wants keeps
  them for the Smash, and the wall at a hero's back still braces when no heap is left. The script strikes it itself
  (`trollActions.strikeSweep`, from `cast`): the resolver over the arc less the shielded heroes' hexes, as a landing
  is struck (`resolving`, so a swing a heap took whole is still a swing and the cycle moves on; the Sweep costs
  nothing), then the heaps break. Fury's extra Sweep is the same Sweep, so in Fury the fort goes twice as fast.
- **Farthest Prey** marks the one-hex area around the hero farthest from him (`preyTarget`: distance, then
  lower current health, then lower id, so a tie is never a coin) — a `PreparedAttack` with `scripted: 'prey'`,
  fixed at the cast like every warning. When the response window is over he **leaps in** (`trollPreyLanding`) and the
  ordinary resolver strikes the fixed footprint from there: damage and a Stun on whoever is still in it. A hero who
  steps out is not struck. **A mark that holds his rubble baits him onto it**: he comes down on the heap nearest the
  mark's centre (then nearest where he leapt from, then by coordinate), the heap gives way and he is **Exposed**
  (`AuraType.Exposed`, `TROLL_PREY_EXPOSED`, +25%) until his own next regular turn begins (`PREY_EXPOSED_TURNS` 1:
  the pair's next round, exactly; a Fury action or a bonus turn ticks no clock). The banner says so before he leaps
  ("rubble in the mark: he lands on it, it breaks and he is Exposed", `warningLines` given the hazards), and the
  landing is the same function, so the banner and the leap agree. With no heap of his in the mark it is the ordinary
  leap (`preyLanding`: the free hex of the marked area nearest its centre, then nearest where he leapt from; never a
  living unit or solid ground; a hex outside the mark only if the whole mark is occupied — the Dragon's landing is
  the same function). **He lands facing the marked ground and does not turn until he acts** (`setFacing` at the cast,
  again at the landing and by the strike; nothing a hero does and no turn start changes it, and `trollScript.test.ts`
  pins this), so who stands farthest chooses where he comes down and whose back he shows; the gauge row names the
  hero standing the way he faces. The **knock-up is a picture only**: `VfxSpec.knockUpIds` plays `AnimKind`
  `'knockUp'` on the struck units, and nothing about their hex, height or turn order changes.
- **Boundary Smash** is a ring (radius `TROLL_SMASH_RADIUS`) around him that throws every hero in it
  `TROLL_SMASH_PUSH` hexes along the push axis away from him — toward the boundary when he stands inside it.
  It goes through the ordinary preparation, so the landings the warning draws are `previewForcedMoves` and the
  landings that happen are `traceForcedMove`'s; blocked landings (a unit, rubble, the wall) stop short on the
  last free hex of the line, and a hero already on the wall simply does not move. **A hero with rubble or the wall
  at their back is not moved**, and the warning says so: `PreparedPreview.braced` (the struck bodies whose trace
  was stopped by the boundary or solid ground before the first step) is named on the banner ("no throw (rubble or
  wall at the back): ..."), arrows are drawn only for bodies that will move, and the landing is the same trace, so
  the preview and the result agree. The answer tally counts such a hero as `blocked`: they took the blow and kept
  the hex. **The heap a braced hero leaned on breaks** as the Smash lands (read off the preview the landing held,
  which `warnedLanding` hands every `afterLanding` hook as `held`); a brace against the wall breaks nothing.
  **Then the roof comes down**: the Smash's landing casts the Warren Collapse (`afterTrollLanding`) over the densest
  cluster where the throw left the heroes (`collapseCentre` read after the throw), so the pair decides at once
  whether to walk under a partner's roof to halve it or leave them. The two land close together: verify the damage
  in playtest.
- **Warren Collapse** marks the densest cluster (`collapseCentre`: the centre that catches the most heroes
  within `TROLL_COLLAPSE_RADIUS`, then the tighter cluster, then a hero's own hex, then coordinate — one board,
  one collapse). It is only ever cast by the Smash's landing and never from a slot. It lands only after every hero
  in the mark has had a turn — the shared response rule, so
  **Fury actions and bonus turns cannot bring it forward** (both take the short road and land nothing).
  **The roof's weight is shared** (`prepares: { split: true }`, the landing plan): two heroes inside take half
  each, three a third each, one alone the whole of it, and a hero who steps out leaves the rest the bigger share;
  the banner says "the blow is shared by N: P% each" off the same plan (`trollFight.test.ts` pins the split and that
  the preview equals the landing). On landing, every impact hex that holds no living unit becomes **rubble**
  (`rubbleHexes`): a solid `ArenaHazard` (`lasts: 'replaced'`, `kind: 'troll_rubble'`, `RUBBLE_KIND`) that **stands
  until his next Collapse lands or the fight breaks it**: no clock counts it down. The next landing clears the last
  one's rubble first (even when the new roof leaves none), and the new heaps are chosen on the floor as it will then
  be. Rubble is never put under anyone and is only kept if the open floor stays one connected piece
  (`routesConnected`) — it can wall off a corner and cannot seal the party in; breaking a heap only ever opens the
  floor. It blocks heroes' and his own movement and shoves, **and Single, Line and Chain shots of range above one**
  (see "Ground can last, and is cover"): a ranged hero shoots round it, and it is the shelter from the Smash's throw
  and the Sweep.
- **Each break is seen and heard** (`trollActions.breakRubble`): the heaps leave the floor, a short debris picture
  (a `quake` over the broken hexes with a `dust` aftermath, in the rubble's colour) and a crumble of stone for each
  (a `fall` intent with `material: 'stone'`, the `death.stone` cue) play, and one log line says why ("The rubble
  gives way under him", "1 heap breaks under the brace", "The club smashes 2 heaps of rubble"); a hero a heap
  shielded from the Sweep is named ("{names}: the heap takes the club"). No new asset.
- **The fort, counted.** The boss panel's gauge row always carries the heaps of his rubble standing ("Rubble: 3
  heaps", the `rubble` gauge fact, `heapsOf`), so the pair sees the fort shrink, and the summary line says
  "Exposed +25%" while a heap has left him open (the `exposed` summary fact carries the share, as Kairen's does).
- **He regenerates when unharmed.** At the start of a regular turn of his (`trollActions.beginTrollTurn`), if no
  hero has damaged him since his last regular turn began (`unharmedRounds` of at least 1 before this turn adds
  to it; `trollScript.isUnharmed`), he recovers `TROLL_REGEN_SHARE` of his maximum health, through `healUnit`
  (so a phased boss's band holds: Fury's band ends at half, and regeneration cannot undo the work that lit it).
  A floating number, a log line and the mend sound go with it. A Fury action or a speed bonus turn never
  reaches the start, so it neither heals nor counts. The first turn of a fight, a turn after any hero damage and
  a turn at full health do not heal, and **nor does any turn once only one hero stands** (`regenerationOn`), so the
  last hero is never racing a heal they cannot stop alone. The boss panel's gauge row says "Unharmed: he will
  regenerate" while he is hurt, the counter is 1 or more, nobody has struck him yet and two heroes stand
  (`willRegenerate(boss, units)`, read before the turn), so the party sees it before it happens; the briefing carries
  the rule and a tip. With a pair this bites exactly when both answered a warning with their feet, which is the
  pressure against the step being the only answer.
- **Fury** is the second `TROLL_PHASES` entry, at `TROLL_FURY_THRESHOLD` of his health, and reuses the boss-phase
  machinery for the banner, the strip, the transition's picture and sound and a larger model. `keepsScript`
  makes it *not* a reset: a warning in the air still lands, the cycle and cooldowns carry on. Entering it lays
  `AuraType.Fury` (a red glow through `AURA_GLOW`, and `+50% damage` on his status row), which
  `calculateDamage` reads as a multiplier after mitigation. As for every phase he has to have begun a turn first.
- **Fury's second action** is a second turn of the same unit granted by `nextTurn` (`combatStore.furyExtra`),
  after a regular turn and after a bonus turn — so a pair is four actions, never five. `beginTurn` takes the
  short road for it (no clock moves, nothing lands), his script makes it a Sweep that does not advance the
  cycle, and the turn queue shows it as a `+1`. Landing, casting or sweeping, the scheduled action comes first.
- **Tuning.** `maxHp` 750 base is about 2,200 encounter HP for the two heroes at level 8–12 (level 10) that fight it,
  at the Warren's band power — above the plan's ~1,500, which assumed a smaller party; attack is 14, defence 9. Health
  and attack were cut about 10% on 2026-10-24 (from 830 and 16) after regeneration landed, and
  `TROLL_REGEN_SHARE` from 5% to 4%: at the lab's Troll budget (levels 18–24, one legendary, base seed 1, 1,000
  fights, playing party) the pair's wins went from 0.2% to 3.6% and the boss health dealt from 52% to 62%; 14% of
  fights still end with him held at exactly half, where Fury's ceiling stops regeneration. `systems/sim/trollMeasure.ts` runs the
  real fight headlessly and `trollFight.test.ts` pins what the sim can say (every signature lands, in order;
  Fury lights and carries extra actions; the encounter HP). Its parties neither heal nor cleanse, so the numbers
  are a floor — retune from play. `TROLL_REGEN_SHARE` (4%, about one hero's turn of damage at the Warren's band) is
  a guess: **verify in playtest**. The simulator's pair learned the new answers (`sim/balance/trollAnswers.ts`)
  and its tally is in the plan; it plays the
  fort too, and the fort's before and after (wins, tally, heaps standing at each Smash, braces against rubble and
  the wall) are in the boss feel pass: the
  Collapse's "took" fell under seventy per cent, Farthest Prey's "stepped" rose above it, nine braces in ten are
  still against the wall, and the answering pair wins under one fight in a hundred. The level-4 pair the gate admits is under-equipped for it by the plan's HP;
  `lairBosses.test.ts` records that the Heart is the retune still to come (the Dragon's is below).

## The Emerald Dragon: no cycle, five moves

The Wyrm's Hollow's boss is the one boss without a fixed rhythm — the plan wants him chosen by regular
action selection with full warnings — so his script is a *chooser*, not a sequence. `systems/combat/dragonScript.ts`
(pure — what each move is worth, where each footprint falls, who carries the Heart and who may pass it),
`dragonActions.ts` (store-writing — raising the Rift and Skyfire, throwing, passing and burning the Heart, his
turn count, what a broken launch costs him) and `dragonLanding.ts` (the Wing Thrust, and landing the Rift,
Skyfire and the Heart's burst through the `Landing` they are handed). The skills are
`data/templates/emeraldDragon.ts`; every number is `BALANCE.DRAGON_*`. `decideEnemyAction` hands him to
`decideDragon`. His old single-target Claw and his separate Dragon Breath are gone; Breath is the flame wave
that follows a Wing Thrust.

- **Dragon Claw** is the repeatable move: a wide frontal arc (depth 3), never a single-target fallback. **It hunts the
  Heart's carrier** (`clawOnCarrier`): while a Furnace Heart is carried and one of his six wedges reaches its carrier
  from where he stands, the Claw is turned to catch them (of those wedges, the one that catches the most heroes
  besides, then the first in `HEX_DIRS` order), and is worth 1.5 to the chooser instead of 1; otherwise it is aimed as
  before (the thinner side of a burning Rift, then the damage scoring). A Taunt still comes first.
- **Choosing.** Each signature is *on offer* only off its cooldown and only when the board gives it something to
  do, and is *valued* by what it would do to this party now (`chooseDragonMove`): a wing that catches more
  heroes, a Rift that parts the party, a Heart thrown onto a hero with a friend beside them, Skyfire always. **The
  Rift is not a move of its own**: it rides with the Wing Thrust (`riftFollowsWing`: off its cooldown, none of his
  burning, no major warning of his open, the gap kept, its first turn come), the wing then being worth the more of
  the two, and while a ready Rift waits out a warning or the gap the wing waits with it rather than spend its
  cooldown alone. A signature unmade for a while
  is worth more every turn (`bossScript.lastUsed`, up to five turns), so none is starved by a stronger one and
  none is a fixed rotation. Rules, not a cycle: nothing that prepares is on offer while a warning of his is open;
  a signature is followed by at least `SIGNATURE_GAP` turns (cast, land, claw); each has a first turn
  (`FIRST_TURN`: wing and Rift 3, Heart 4, Skyfire 5) so the party meets the claw and the wing before it is
  asked for an answer to Skyfire. `bossScript.step` is the turn of his last signature and `phaseTurns` his
  turn count. Taunt changes where his Claw goes and nothing else.
- **Wing Thrust** is **instant** and weak: forty percent of the power it had as a warned attack
  (`DRAGON_WING_DAMAGE` 0.44, `DRAGON_WAVE_DAMAGE` 0.4). No warning and no window, so it is the one move he can
  make while one of his warnings is open and it is not a signature for the gap rule (a Rift raised with it is). `strikeWing`
  (`dragonLanding.ts`), called from the executor, is **two ticks**: the wing (damage and the shove) and then a
  **flame wave** (`flame_wave`, magic) drawn `delayMs` later over the arc *and* the hexes the shove put heroes on,
  read from the same landings before anything moves. The shove runs **along the arc, away from him**, and a hero
  thrown onto or across an active Rift pays its fire (the rule is said in its `bossSkills` target line, which the
  briefing repeats). While a Rift burns, the arc goes to the side of the Rift with fewer heroes (see Cinder Rift).
  When a Rift follows it, the script's `cast` raises it once the shove has settled (`raiseRiftAfterWing`), over
  the party as the wing left it, and remembers it as his last signature.
- **Cinder Rift** (`riftLine`) is raised only with a Wing Thrust, on the board as the shove left it, and rakes **two
  full rows crossing in an X** at the hex nearest the party's centre, along
  the two of the board's three axes that best part the party (most on the smaller side, then the most even, then
  the axis squarer to him; his own hex is left out). It is a preparation the whole party answers; when the window is over the line erupts
  (damage on whoever stands on it) and stays as **non-solid** ground with `crossDamage` of `DRAGON_RIFT_CROSS` of
  his attack, fixed when it is laid. **It burns for `DRAGON_RIFT_TURNS` (3) of his regular turns after the one it
  erupts on**, whatever he casts meanwhile: it is laid with `turnsLeft` of one more than that (the eruption's turn
  has begun already) and `tickHazards` counts it down as each turn of his begins, so it is gone as the turn after
  the third begins; it is also `lasts: 'replaced'` (kind `cinder_rift`). Skyfire no longer puts it out, so the
  trench is there at a Skyfire only when a Rift happens to burn. It never blocks a route (`routesConnected` of the
  empty set is the arena itself), is drawn as burning ground, and only one burns at a time: a Wing Thrust while one
  burns comes alone. **The thinner side:** while it burns, his Claw and Wing Thrust go to the side of the X with fewer heroes
  (`riftTargets`, followed by the script's aim; a Taunt still turns the Claw on the taunter). The sides are read
  off the burning ground itself (the rows it holds, tolerating the hex he stood on when he raked it); a tie in
  numbers goes to the side holding the lower-health hero, then to the side nearer the hex in front of him, then to
  the lower side key; a hero standing in the fire is within reach of both sides, so the Rift is never a safe
  hex from the Claw. With no hero beside it to choose between, it is everyone. The rule is said in the `bossSkills`
  target lines of the Rift, the Claw and the Wing Thrust and on the Rift's banner.
- **Furnace Heart** is thrown onto a hero and **carried** (boss feel pass, 2026-11-03). `throwHeart` (`dragonActions`)
  picks the hero with the most health now (`heartCarrier`, ties by the lower id), raises a warning owed by the whole
  party for `DRAGON_HEART_WINDOWS` (5) rounds of the heroes' turns (`everyone`, `windows`) with `PreparedSpec.carried`
  (scripted `'heart'`, the carrier in `bound`), and sets the crystal on them: an objective (`furnace_heart`,
  `DRAGON_HEART_HP` of his health, about 15%, with `backlash` `DRAGON_HEART_BACKLASH` 4%) with
  `ObjectiveSpec.carrierId`, linked to the warning. A carried warning **runs alongside his other warnings**:
  `canPrepare(caster, carried)` keeps one carried and one major warning apart, and his chooser holds back only for
  a major one; only one Heart stands at a time.
  - **It rides on its carrier.** `combatStore.moveUnit` moves the crystal with them and re-centres the warning on
    them (`carriedFootprint`: the disc of `DRAGON_HEART_RADIUS`, 1, round them), and a pass moves both
    (`carryObjective`). The crystal stays after its carrier in `units` and `getUnitAt` never returns it, so the hex
    answers with the hero; a blow from the carrier's side that harms, landing on that hex (an ally's or the
    carrier's own), strikes the crystal instead and leaves the hero unhurt (`objectives.struckBody`, read by the
    resolver's strike, the highlights and an attack aimed at the caster's own hex). A heal there finds the hero.
  - **It burns its carrier** (`burnHeartCarrier`, the script's `turnTick`, which runs as each regular turn begins
    after the statuses tick, stunned or not): `DRAGON_HEART_BURN` (0.25) of his magic on the first turn a hero holds
    it and `DRAGON_HEART_BURN_STEP` (0.1) more for each further turn they keep it, counted on their Seared's `stacks`
    and started again by a pass. At the Hollow's band the five burns of a whole countdown on a hero who never passes
    stay under their health (`dragonHeart.test.ts`); the next burn is `nextHeartBurn`.
  - **Seared** (`AfflictionType.Seared`, a cut-through cross) marks the carrier: they receive
    `DRAGON_HEART_HEAL_CUT` (half) less healing on every path through `healUnit` (a heal, a drain, a mote) and on a
    heal over time's tick (`statusEffects.healingReceived`); a Barrier is not healing and is whole. It goes wherever
    the Heart goes, leaves when it does (broken, burst, retired), and no cleanse lifts it (`UNCLEANSABLE`).
  - **Pass the Heart** (`passHeart`, `HeroSkill.passesHeart`) is put on a hero's bar only while it is legal
    (`passTargets`, lent through `barActions`): the carrier hands it to any hero within `DRAGON_HEART_PASS_RANGE`
    (2), or a hero within that reach of the carrier takes it from them, so a carrier with no action left can still be
    saved. It is aimed through the ordinary flow (`barActionTargets`), cast through `barActionCast` (the resolver
    names no boss), costs the action and nothing else, resets the burn and keeps the countdown. A log line, the
    Heart's own picture and a thrown bolt from the existing assets.
  - **The burst.** When the countdown ends it lands as his turn begins (`landHeart`): `DRAGON_HEART_BURST` (2.2× his
    magic) on whoever holds it and everyone beside them, over the footprint the store kept, so the preview of the
    burst is the landing; his heat climbs a step (`heatAfterBurst`). **If the carrier falls first** — to the burn,
    the Claw or anything else — it bursts at once on the hex they fell on (`preparedResolve.resolveFallenCarriers`,
    run between turns from `turnStart.beginTurn`, so nobody acts between the fall and the burst), through the same
    landing, with the same damage and the same step of heat, and the answer tally counts it the same way. A carrier
    who has passed it sets off nothing.
  - **Broken**, it cancels the burst, costs him the backlash and quenches his heat (`quenchedOnBreak`), as before.
  - The banner names the carrier and the rounds left and says the rule in one line ("pass it, break it, or let
    whoever holds it take the blast; if its carrier falls, it bursts at once"); the boss panel's gauge row carries it
    beside the heat (`heart` gauge fact); the board draws the burst's footprint only on its last round or while the
    next burn could fell the carrier (`heartBurstDrawn`), and the stepping and answering parties step off it only then
    (`emperorMeasure.warnedFor`; never its own carrier). Verify every number in playtest.
- **Skyfire** marks **every hex of the arena** plus a landing area on the half of the arena opposite him
  (`skyfireLandingCentre`: the free hex there that catches the most heroes within `DRAGON_LANDING_RADIUS`, then the
  nearest the centre — never the far rim when the middle will do), both fixed at the cast. The party owes one full
  window. **Stun, Silence, Freeze or Taunt on him** while it is prepared cancels it — the flame *and* the
  landing — through the ordinary interrupt (`interruptedBy: stun, silence, freeze`, `tauntCancels`); Root and
  every unlisted status do not. A broken launch leaves him **exposed** (`onDragonInterrupted`): a `DefenseDown`
  of `DRAGON_EXPOSED_DEFENSE` of his Defence, laid for two of his turns so it survives the start of his next
  turn and ends at the one after — the rest of this round, his turn and the whole next round, one full hero
  window even for the hero who broke it and acted last, and **his fire is quenched** (`quenchedOnBreak`: his registry
  entry's `onBroken` knocks his heat down when the warning is broken). Nothing else: no crash, no extra stun. Unbroken, it lands
  (`landSkyfire`): the flame strikes every hero wherever they stand, then he comes down on the free hex of the
  marked area nearest its centre and strikes that area a second time (`skyfire_landing`). Two more answers beside
  the interrupt. **The trench:** the warning carries `shelter: { onHazard: <the Rift's label> }`, so a hero standing
  on the burning Rift when the flame falls is spared by the one landing plan (`landingPlan`, previewed) and takes
  none of the flame; the banner names the sheltered heroes. The landing blow (`Landing.blow`) is not covered by the
  shelter: a sheltered hero outside the landing area is `unharmed` in the answer tally, one it comes down on `took`. Entering the Rift costs its crossing fire once. **The sprawl:** a
  hero standing in the landing area when he comes down still takes the landing blow, but he lands sprawled: Exposed
  (`DRAGON_EXPOSED_DEFENSE`, as a broken launch) and his heat quenched. A Rift still burning is left burning. The
  interrupt stays the best answer: it cancels the flame, the landing and the sprawl's cost. Verify all three in
  playtest.
- **Rising Fire** (`risingFire`, the template's passive) holds his attack and magic down early and lets them climb,
  read off an explicit **heat** gauge (`bossScript.heat`, `systems/combat/dragonHeat.ts`) rather than the turn
  count: `DRAGON_RISE_START` (75%) at the first reading, plus `DRAGON_RISE_STEP` (5% — one point of a base 20) of the
  stat per step, at full strength at reading `DRAGON_RISE_FULL_TURN` (6), stronger every step after, without limit.
  The gauge moves three ways: **one step at the start of each regular turn of his** (`beginDragonTurn`, read off the
  turn count before the registry adds this turn to it), **one more
  when a warning of his strikes nobody** (the Rift carries `onWhiff: 'dragonHeat'`, answered by the script's
  `whiff`; Skyfire does not, because a party sheltered on the Rift answered it rather than dodged it), **one when
  his Furnace Heart bursts**, on time or on a fallen carrier (`heatAfterBurst`),
  and **down by `DRAGON_QUENCH_STEPS` (3)** when a Furnace Heart is broken, a Skyfire is interrupted (his registry
  entry's `onBroken`, through `PreparedSpec.quenchedOnBreak`) or a landing is sprawled (`quenchDragon`), all through `heatAfterQuench`.
  A quench never takes it below the first reading, nor below a **floor** that rises with the fight: the first
  reading plus `DRAGON_QUENCH_FLOOR` (half) a step per regular turn of his (`heatFloorOf`, read off `phaseTurns`).
  A party that answers everything cools him but cannot hold him at his opening strength. Verify both numbers in
  playtest. It is a `statMod`, a share of the stat he has, so it follows the encounter's
  scaling. The boss panel's gauge row shows the strength now and on his next turn ("Rising Fire: 85% strength ·
  his next turn 90%"), so the next step is read before he takes it. `phaseTurns` stays his turn count for the
  chooser.
- **Readable before the door.** The need for an interrupt is in the contract the player is offered and in its
  stage text (`what_sleeps_in_the_hollow`), the banner names it when Skyfire is raised ("WHOLE ARENA ... Stun,
  Silence, Freeze or Taunt him to stop it ... or stand on a burning Rift ... or stand in the landing mark ..."), the
  briefing's composition tip reads "bring an interrupt, or walk into fire at every Skyfire"; the briefing says the
  Heart in one sentence ("pass it, break it, or let whoever holds it take the blast; if its carrier falls, it bursts
  at once"), that the Claw hunts its carrier and that the Rift is raked over where the wing threw the party, and
  `dragonPreparation.test.ts` holds that every
  class has a mastery path whose skill lands one of the four within the points a level-11 hero has earned (at
  most three points in every class), so no mastery unlock level needed correcting.
- **Presentation.** The model is scaled 1.05 (`modelMap`) — as large as the standing boss rules allow:
  `framing.test.ts` fails at 1.06 (his horns hide too much of the unit behind) and `bosses.test.ts` at 1.07
  (Aethelred must be 1.4× the tallest other boss). Anything more needs one of those two rules to move. The
  Furnace Heart has its own placeholder crystal; carried, a smaller one floats over its carrier's bar and status row
  (`CarriedHeart` in `UnitMesh`, no light of its own) with its own bar and the rounds left beside it. The Rift is
  drawn as burning ground and Skyfire's landing area
  as a second zone beside the whole-arena warning. Skyfire is the Dragon's `BossSignature` sound; the other
  moves are heard as any blow is. Their icons are copies of the old Claw's and Breath's pictures.
- **Tuning.** The Dragon is the stronger of the two lair bosses by design: `maxHp` 1,200 base (first set at 1,660,
  twice the Warren boss's 830, trimmed 10% on 2026-10-13 after a playtest found the fight dragging, then nerfed
  on 2026-10-19 from 1,500), attack and magic 15 (from 20; the Troll's attack is 14, its magic 4), defence 10
  (from 12). In the Hollow's band power he still stands at over 1.8× the Warren boss's encounter health. A flat doubling of attack (32) was measured and rejected: the sim pair died in
  five to seven boss turns. `systems/sim/dragonMeasure.ts` runs the real fight headlessly with a pair that steps
  out of warnings and, optionally, a first hero that Stuns him when Skyfire is open (standing in for whichever
  answer the party carries), or with the balance simulator's party policy, which also breaks the Heart, walks into
  the trench and sprawls him (`partyPolicy.ts`); it reports the answer tally, the peak of his heat and how often it
  was quenched. `dragonFight.test.ts` pins what the sim can say (the moves appear, the Claw is over a quarter of
  them, never two warnings at once, the party with the answer lasts longer, the trench is used and his fire is
  quenched, Skyfire cast both over a burning Rift and with none) and the carried Heart's rules; `dragonHeart.test.ts`
  pins the burn, Seared and the pass. `runDragon` also counts the Hearts thrown, passed, broken, burst on time and
  burst on a fallen carrier (with what those cost), and the Skyfires cast over a Rift; the balance records carry them
  (`dh`). After the feel pass the dividend's answering parties beat the plain ones but win 0–1.6% at the Hollow's band
  (the four won 14.4% before), the Rift is stepped 89–95%, and the first Skyfire of a fight comes before any Rift
  (measurements and the replayed loss in the plan).
  Whether a real party can win is for play to say; the dials are `DRAGON_HEART_HP` against `DRAGON_HEART_BACKLASH`,
  the Rift's first turn and lifetime, Skyfire's damage, `maxHp` and the other `BALANCE.DRAGON_*` multipliers.

## The Heart of Winter: three anchors, two phases, four spells

The Glacier Deep's boss is a fight about **objectives**, not a cycle. `systems/combat/heartScript.ts` (pure — the
chooser, the footprints, the anchor spots), `heartActions.ts` (store-writing — raising the three warned spells,
its turn count) and `heartLanding.ts` (the Pulse, and landing the warnings through the `Landing` they are handed). The
skills and the two phases are `data/templates/heartOfWinter.ts`; every number is `BALANCE.HEART_*`.
`decideEnemyAction` hands it to `decideHeart`. It has **no summons and no shared fallback attack**, and
`moveRange` 0: it is chained and never walks, so with nothing in Pulse range it waits.

- **The anchors.** `initCombat` puts the Heart on `heartStart()` (0, −2) and three `blood_iron_anchor` objectives
  on distinct free hexes `HEART_ANCHOR_RING` (3) away, spread as far apart as the board allows
  (`anchorSpots`). Each has `HEART_ANCHOR_HP` (5%) of its health (about 500 at the lair's encounter health), no defence and
  `protection` 0.33: **three standing take 99%, two 66%, one 33%, none 0** — a total by count through the
  objective-protection funnel (`MAX_OBJECTIVE_PROTECTION` is 0.99 for this), applied to every source of damage
  including damage over time, with the funnel's one-point floor so a real blow is never nothing. An anchor is
  drawn as a rune-cut pillar with a red spike (`UnitMesh`) and a chain to the Heart (`ChainLinks`); they never
  return.
- **The anchors feed it** (PT-39, playtest 2026-10-21: phase-1 time pressure). At the start of each of its own
  turns while chained, `beginHeartTurn` adds `HEART_ANCHOR_EMPOWER` (4%) of its Attack and Magic **per anchor
  still standing**, stacking: one self-laid whole-fight Attack Buff and Magic Buff whose `stacks` count the
  feeds (three anchors for four turns is +48%). The log says so each time (`bossSkills.heart.anchorFeed`) and
  the chained phase's rule and the Restraints passive tell the player. The pile is shed at the start of its
  first unbound turn. Its base Magic went 28 → 26 in the same pass. `heartFight.test.ts` pins it; verify the
  numbers in playtest.
- **Releasing it.** The last anchor falling (`ObjectiveSpec.onLast: 'release'`, read in `damageUnit`) calls
  `releaseBossPhase` — the phase machinery with **no health ceiling**, so the release takes nothing from the
  Heart and the damage the party dealt is exactly what it has left — and lays `Exposed` (+25% damage taken,
  `HEART_EXPOSED`, a multiplier on the strike like Mark and Fury) for `HEART_EXPOSED_TURNS` (2) of *its* turns:
  the rest of this round, its turn and the whole of the next, one full hero window even for the hero who broke it
  and acted last, and no bonus turn shortens it. It also clears any pending warning and shatters nothing else.
  At **half health** (`HEART_RELEASE_THRESHOLD`) it tears free by the ordinary threshold phase if anchors remain:
  they break without the exposure, the health is kept, the chained phase's warning is cleared visibly. The
  unbound phase hits a fifth harder (`HEART_UNBOUND_POWER` on attack and magic, a stat multiplier) and swaps
  Reprisal for Convergence.
- **Splintering Pulse** (repeatable, instant, range 5, 1.0× Magic, **a tenth less per hex between the Heart and its target**, `HEART_PULSE_FALLOFF`, applied to the fracture by its own distance too; added 2026-10-18 because the Marksman's range-5 at-will skills outranged the old range 4 and the Heart, which cannot walk, simply waited, so a Marksman won about 25% of simulated Heart fights against 0.1% for every party without one): a splinter at one hero, then a fracture of
  0.6× to the hero on the hex directly behind them (`fractureHex`: the neighbour of the target most nearly along
  the line from the Heart through them; none off the board). A target standing on frozen ground takes
  `HEART_PULSE_SHATTER` (0.3×) more and the ice under them is gone. It is the move it makes when nothing else is
  worth a turn; Taunt changes where it goes and nothing else.
- **Creeping Winter** (CD 3, both phases): marks `HEART_WINTER_SHARE` (half) of the arena's hexes, anywhere clear of
  bodies, solid ground, existing ice **and the ground beside a standing anchor** (`winterHexes` — a hex a hero
  stands on first, then nearest the heroes, a spread lattice first and then filled in). **That ground is
  sheltered: it neither erupts nor freezes** (`winterShelter`: the in-arena neighbours of the anchors standing at
  the cast). Like the footprint it is fixed at the cast and stored on the warning (`PreparedAttack.sheltered`), so
  an anchor that falls afterwards changes nothing, and the preview, the board (the support colour, apart from the
  footprint) and the landing all read the same ring. In the unbound phase no anchor stands and nothing is
  sheltered. The decision it sets is the formation: cluster at the anchors, where the chain of a Reprisal and the
  Pulse's fracture reach, or spread and take the cold. The whole party
  owes a window. On landing each marked hex erupts for 0.8× and **freezes**: the one `heart_ice` hazard
  (`ArenaHazard.moveCost`) costs `HEART_ICE_COST` extra movement points to enter, counted by
  `getMovementRange` over the cheapest route (which goes around bodies and rubble like any walk) and
  ignored by a shove. Ice stays until a Pulse shatters it; it is passable, so no pattern can wall a route off.
- **Icebound Reprisal** (CD 3, chained phase): picks the surviving anchor whose chain crosses the most heroes
  (`reprisalPlan`) and marks the line between it and the Heart. The anchor's spec is bound to the warning
  (`bindsPrepared`, `backlash`): **destroying it first cancels the warning and costs the Heart
  `HEART_REPRISAL_BACKLASH` (5%) of its maximum health, bypassing anchor protection** (`damageUnit`'s
  `bypassProtection`), which can trigger the half-health release; if it was the last anchor the release and
  exposure follow. Left standing it snaps taut for 1.3× on the line and the Heart gains a Barrier of
  `HEART_REPRISAL_BARRIER` (10%) of its maximum — **both scaled by how whole the bound anchor is when it lands**
  (`reprisalGrade`: its remaining health over its maximum, read in `landReprisal`; a whole anchor is the chain
  above, a half-broken one half of it, and the banner states the current share). Partial damage buys partial
  safety; the kill still cancels it and backlashes. The anchor is unbound afterwards, so breaking it then is an
  ordinary kill. The bound anchor wears a pulsing red ring on its hex and a bobbing arrow over its crown
  (`UnitMesh`'s `StrainMark`) besides the heavier chain, which alone was barely visible from the phone camera
  (playtest 2026-10-23b).
- **Whiteout Convergence** (CD 4, unbound phase): up to `HEART_SPIRES` (8) `ice_spire` objectives, each with its own radius-1
  blast warned now (`convergencePlan`: chosen near the party, **only raised if every hero keeps a hex no blast
  covers within one step**, fewer when that is what it takes). Each spire detonates separately (1× Magic since 2026-10-19, from 1.4×; overlaps
  hit twice) when the window is over, then leaves the board. Breaking one cancels its blast and sends
  `HEART_SPIRE_PULSE` (3%) of its maximum into it (bypassing protection); **breaking every spire cancels the
  warning and exposes it** for the same window. Spires take half damage from area skills (`areaResist`).
- **Choosing** (`chooseHeartMove`) is the Dragon's rule set: on offer only off cooldown with something to do,
  valued by what it would do now plus a stale bonus, no warning while one is open, and at least
  `HEART_SIGNATURE_GAP` (3) turns between warnings (cast, land, a Pulse). It opens with the Pulse, introduces
  Creeping Winter (turn 2) before the first Reprisal (turn 4), and a delayed attack's landing consumes its next
  action, so a Pulse is never made on the turn one resolves. **Raising a warned spell grants it a free turn at once**
  (`castHeartMove` sets `bonusTurn.pending`, never from inside a bonus turn): the open warning leaves it only the
  Pulse, so every spell is followed by an attack, and as a bonus turn it spends no warning window and counts no
  script turn. `bossScript.lastUsed`/`step`/`phaseTurns` hold what it
  remembers, as the Dragon's do; a phase change starts them again.
- **What the party reads.** The phase strip carries a pip per anchor and "takes N%" (or "Torn open +25%"), read
  off `heartIntent`; the banner names the answer to each warning in its own words (`warning.move.<id>`); its warnings are drawn in
  the cold `frost` tone (`warningToneFor`); anchors, spires and the ice are placeholder geometry in `UnitMesh`
  and `overlays.tsx`, the chain from each anchor to the Heart is `ChainLinks` drawn as iron links (`links`), slack ones
  sagging, and the one a Reprisal strains against is drawn taut, heavier and brighter. Chains of Tribute's
  `Chained` link is links too; tethers and bonds (the shared bloom, elite links) stay plain bars. Its four moves wear drawn frost spells' pictures until their own are
  drawn (`HeroSkill.icon`).
- **Tuning.** A first estimate, to be retuned from play. Base 1,880 health, attack 16, magic 26 (−10% after the
  playtest of 2026-10-14, from 20 and 34, and again on 2026-10-19, from 18 and 31; magic 28 → 26 on 2026-10-21, paid back by the anchor feed), defence 13 (from 14) — between
  the Dragon (1,200 / 15) and the Emperor (5,600 / 53) so `lairBosses.test.ts`'s ordering holds with nothing
  exempt — about 8,900 to 12,300 encounter health at the lair's band power for four to two heroes at the gate's
  levels. `systems/sim/heartMeasure.ts` runs the real fight headlessly (a plain brain, one that steps out of
  warnings, one that plays the objectives: spires, then anchors, then the Heart, and the balance simulator's party
  policy, which also stands beside the anchors while Creeping Winter is up and puts a round into the anchor a
  Reprisal strains against; it reports the answer tally and the grade each chain landed at);
  `heartFight.test.ts` pins the rules above. **The sim parties cannot win it** — they deal a few dozen a hero turn against tens of
  thousands of encounter health through 99% protection — so the 12–14 turn target is not measured, only the
  fight's shape (release by anchors around boss turn 5–6, every spell appearing, never two warnings open). The
  dials are `maxHp`, `HEART_ANCHOR_HP` / `HEART_SPIRE_HP` and the `HEART_*` multipliers.

- **Winter Seal tiers** (`heartTierOf`, off `challengeTier`; the refight's door, price and pay are in
  [world](world.md), *The Heart of Winter's refight*). Tier 1 and the lair are the fight above, unchanged; each tier
  keeps the twists below it (`HEART_TWIST`), and the briefing and the picker list them (`heartTwistsAt`).
  **Tier 2:** the Pulse's fracture runs on, each next hex `fractureHex(previous, struck)`, to the first hex with no hero
  or the board's edge; each link is 0.6× with its own falloff, and past the first it shatters ice under it for
  `HEART_PULSE_SHATTER` more, as the splinter does. **Tier 3:** Icebound Reprisal binds the two best anchors
  (`reprisalPlans`, one if only one stands): one warning over both lines. Each anchor carries its own line
  (`ObjectiveSpec.boundHexes`), so breaking one takes its backlash and only its line (`trimPreparedAttack`, keeping a hex
  the other line shares) and the last one standing cancels the warning. Each line left standing snaps for 1.3× and lends
  a `HEART_REPRISAL_BARRIER` Barrier, both graded by its own anchor (`landTwinReprisal`). The banner's share reads
  the first bound anchor. **Tier 4:** every spire that bursts freezes its blast's hexes into `heart_ice`, apart from solid
  ground; a broken spire freezes nothing. **Tier 5:** two phases only that tier lives (`BossPhase.fromTier`, which
  `pendingPhase`, `releaseBossPhase` and the phase card's count read): at `HEART_SEAL.RECHAIN_AT` (25%) of its health the
  unbound Heart enters `heart_rechained`, and `Boss.raise` stands `RECHAIN_ANCHORS` (2) anchors on free ring hexes
  farthest from the heroes and not adjacent, with the first chain's health, protection, feed and release: 66% less
  damage, the chained kit at the unbound power, Reprisal from its turn 2 and Winter from turn 3
  (`HEART_RECHAINED_FIRST_TURN`). The last of them tears it into `heart_torn` (the unbound kit), exposed as at the first
  release. It is the phase rules' one step at a time, so a blow that kills outright from above 25% skips the chain, and the
  chain waits for it to have begun a turn unbound. Numbers per tier, all *verify in playtest*, are in
  the plan.

`CombatScene.tsx` (~1.6k) holds the arena, the HUD and the phase orchestration. What is *not* in
it, deliberately:

- **`systems/combat/passiveFormulas.ts`** holds the pure rank formulas (what a rung of a passive is
  worth, and the neutral `rung` helper) that the display and the rules both read; `passives.ts` keeps
  the definitions and `resolvePassives`, and exports 25 names.
- **Passive triggers added by the passive seam.** `onTurnStartAura` fires after the turn's effect tick
  (Settle In's charge, Grounded Focus), `onDeath` fires on the owner of what a corpse carried (Venom
  Transfer), and `onSkillResolved` fires once when a cast is done (Cycle of Life, Slipstream). An
  `effect` outcome can be `silent`, `replace` the status and carry a log `color`; a `reposition`
  outcome grants the free step and `applyOnSkillResolved` reports it so the turn waits.
- **`data/display/bodyPictures.ts` and `boardOverlays.ts`** — which pictures a body wears for its
  statuses (`bodyPictures(unit, glowColor)`: charge, burn stacks, poison doses, blades, Carapace charges, the buff rim)
  and which hexes the board lights for hazards, warnings and duels (`warnedGroups`, `burningHexes`,
  `circleHexes`…, composed by `boardOverlays`), plus `highlightColour(kind, tone)`. The scene
  memoises each function on the inputs it reads. `statusVisuals.test.ts` and `combatHud.test.ts`
  assert on their output, not on the source of `UnitMesh` or the scene.
- **`systems/combat/combatRewards.ts`** — what a win pays and what a loss costs. Both were pure
  functions of (units, encounter, band, party) trapped in `useEffect`s, which is why neither had a
  test; they take their store reads as arguments now. **`BALANCE.ENEMY_GOLD_SCALE` (0.6) is applied
  once, here, on the fight's gold and not its XP** — the encounter *rate* changed under the templates
  when journeys started checking every tile rather than only the one tapped, so the same per-kill
  purse became far more purses and the Empire's tribute stopped being a bill worth reading. One knob
  rather than sixty template edits.
- **`encounterGenerator.enemiesForEncounter`** — the adapter that supplies the `easy` default and
  `huntedTemplates()`, so no caller has to remember that an active `kill` objective bends who
  turns up.
- **`systems/combat/encounterContext.ts`** — *where* a fight is being fought. `CombatScene` used to
  answer that itself by reaching into `worldMapStore` for `partyPosition`, in two places. That is
  right for an overworld fight and wrong for every other kind: a lair encounter starts from inside a
  location, and the party's world-map hex is the lair's **door**, so the inside of every dungeon was
  coloured by — and backed by a photograph of — whatever terrain noise sat under its entrance.
  `EncounterContext` rides on `gameStore` beside `currentEncounterId` and is cleared with it, so it
  costs no `SAVE_VERSION` bump. `resolveEncounterContext` falls back to the world tile and then to
  plains, so a call site that forgets to pass one behaves exactly as it did before.
  **`CombatScene.tsx`'s castle-stage advance is the trap**: it is the one `startEncounter` that fires
  without the scene unmounting, so it forwards the context by hand or stages 2-4 revert to grass
  while stage 1 looks right. `threat` is carried on the world variant and **deliberately unconsumed**
  — which band a lair fields is a balance question, not a presentation one.
  **Not every location is indoors.** `openCountry` (`data/display/terrainDisplay.ts`) names the
  places fought in the open air and the country around them — today only the city, whose one fight
  is the siege: `refuseCurrentTribute` starts it with `siegeContext()` rather than the city tile's
  world context, which used to put the sacking of the town on that tile's ordinary field kit. An
  open-air location keeps its own composition key (`city`) and takes its country's scatter,
  backdrop instead of the dungeon's; the siege is lit `siege`. No arena carries ambient air since
  2026-10-21 (see icons and VFX).
- **`encounterGenerator.curatedBand` is that balance question, and it was answered wrong for a long
  time.** The composition half of "a curated fight ignores the ground it stands on" existed from the
  start — a lair chamber composes at its `LairSpec.band`, a quest site at `QUEST_BAND` — but the
  *stat multiplier* those bodies were then built with came from `threatPowerScale(tile.threat, …)`
  read off the party's world hex, which for a lair is its **door**. So who turned up was curated and
  how hard they hit was a lottery on where `mapGenerator` dropped that door, which it places from a
  shuffled pool with only "≥ 8 hexes from the city" constraining it. The Warren composes at band 2
  (`×1.56`) and a door deep in band 4 built the identical roster at `×2.65` — a **70% swing on the
  same opposition**, invisible from inside the lair and different in every save. `CombatScene` reads
  the curated band from the same function the composer does, at `neutralDepth`, and `haunted` is
  forced false: a quest site is a POI, and POIs are placed in haunted ground on purpose, so reading
  the tile charged every quest fight the ×1.25 blighted premium on top of a band it does not fight at.
- **`systems/combat/arenaScenery.ts`** — the ring of scenery around the board, as a pure function.
  **Cosmetic by construction**: every hex it returns fails `inArena`, so nothing it places can be
  stood on, targeted, pathed through or seen by the AI. Cover and line of sight would be a
  combat-rules change. The camera looks down -z and `hexToPixel` maps +r to +z, so **larger r is
  nearer the viewer** and `heightScale` shrinks props toward the camera to nothing — tall scenery
  frames the board from behind and the flanks, and the near edge stays clear. Seeded on the
  encounter id, so one fight looks the same every frame and two fights on the same ground do not
  look like the same clearing. **~116 props a fight now** (`RING_REACH` 7, `ARENA_PROP_DENSITY` 0.85,
  a `depthDensity` falloff toward the rim), and the way that was paid for without putting anything in
  front of the fight is a *steeper* `heightScale` ramp and a higher `MIN_SCALE` — the near flank
  admits r ≤ 2 where it used to admit r = 3 at two-fifths height. Density without
  `TERRAIN_VARIANTS` at 8 would have been wallpaper rather than a forest. **The tundra has a kit
  since the arena remaster** (`TAIGA` and `RIMEBLIGHT` in `sceneryKits.ts`: huge snow-laden spruce,
  brown withered bushes, snow-capped rock and frozen pools, and their rimeblight twins); until then
  its fights were dressed from the map's `terrain_tundra` and `terrain_rimeblight` families. Every
  open-air Empire arena also carries an edge fill out to what the camera reaches — see
  arena internals, "The edge fill".
  - **The ground has an edge when a kit asks for one, and that is `systems/combat/arenaShelf.ts`.**
    The arena's ground has always been one flat disc of radius 170, which is the authored reason
    mountain reads as the bottom of a bowl: the fight and the range around it stand on one surface,
    so nothing anywhere says the fight is *above* anything. `SceneryKit.shelf` gives that disc a
    boundary inside its own sectors — a lip, a flight of terraces down from it, and a second plane a
    full drop lower running to the same 170 — and `components/combat/arena/ShelfGround.tsx` extrudes
    it. The review's fifth priority is the whole argument: "adding fog over the current continuous
    ground plane cannot create a drop".
    - **Cosmetic by arithmetic rather than by convention.** `shelfHeight` is zero over every
      playable hex *and over its corners*, because the smallest lip a spec can produce — the
      authored radius less the wobble — clears the board's circumradius plus a hex. Nothing a unit
      stands on, walks over or targets moves, and `arenaShelf.test.ts` measures that against the
      real board on eight seeds rather than trusting the sentence.
      - **`minShelfRadius()` is that sentence as a number a tool can refuse.** Until an editor
        existed the rule lived only in the suite, which is the right place to catch a kit somebody
        typed and the wrong place to catch a radius somebody is *dragging*. It is
        `(boardReach() + SHELF_CLEARANCE) / (1 - WOBBLE)` — derived from `arenaHexes` rather than
        written down, and divided by the wander because the wander is a multiplier, so authoring
        exactly the clearance would still graze on the seeds where the noise runs low. Pinned as an
        identity to full precision *and* from both sides: a spec at the floor never grazes on eight
        seeds, one half a unit under it does. `maxShelfRadius()` is the other end and is a
        correctness bound too — past `SHELF_PLANE_R` the taper term goes negative and a sector's
        flanks curve back *toward* the board.
    - **One derivation, three readers.** The scene's geometry, the cosmetic hex field (which stops a
      whole hex *early*, or a prism hangs its far corner over the drop) and every scenic prop's
      `tileTop` all read `shelfHeight`. A second answer to "how high is the ground here" is a crag
      hovering a step above its own ledge, which renders perfectly.
    - **A landmark stands on the ground the fight is on; the boundary does not have to.**
      `focalHex` refuses a candidate past the lip, so a group and a focal anchor degrade inward the
      way a blocked bearing already did — the pass's braziers sit two hexes out against a lip that
      wanders in to a little over two, and the first run of the suite caught them. A `wall` arc is
      *landscape*: the pass's far ridge at depth 6 now stands on the lower country without being
      re-authored, which is what its second depth was for.
    - **A ledge is told from the one below it by value, not by its riser.** At the bottom of a
      portrait frame the view ray is the pitch *plus* half the field of view — nearly straight down —
      so a riser there is edge-on and carries nothing. `ledgeLight` lifts each course 13% over the
      one under it, which is a third again over the ~10% at which the roster's own contrast rule
      says a surface stops being visible. The first pass drew them in one colour and photographed as
      a single grey wedge with four hairlines in it.
    - **`tierFits` takes the prop's own base for this.** Both of its height rules are about what
      rises above the *board's* plane, so a mass standing six units down is six units shorter to all
      of them — without that the front cap refused every mass on the near half of the drop, which is
      the half the portrait frame can actually see.
    - **The haze is `ZoomFog`, and its planes scale with the fitted zoom.** So an authored `near` is
      not the distance it lands at, which is how a first pass at 34 washed out the pass's own gate;
      `arenaShelf.test.ts` pins the authored number against the furthest playable hex at the
      reference portrait fit.
    - Both surfaces still run to `SHELF_PLANE_R` = the 170 the disc did, so the outermost silhouette
      a pan can reach is unchanged and the rings are contiguous by construction (each ring's outer
      radius is the next one's inner). Pinned by a source scan, because the number lives in two
      files.
    - **A drop that nobody can see is a drop that is not there, and the first one shipped that
      way.** Every assertion above passed, the ground genuinely fell 6.4 units, nine masses stood on
      the lower country — and it was reported from play as "a half-ring valley". Three reasons, none
      of which anything asked about, and `arenaShelf.test.ts`'s *visible from where the game is
      played* block is each of them as arithmetic:
      - **It was pointed at a flank.** The rig never turns, so depth exists only toward the far end;
        a drop at `0.15` is due right, which the camera looks *across*. Worse, a sector holds its
        authored radius over its **core** alone (`CORE_SHARE`) and tapers to the plane outside it,
        so a drop centred on a flank has already run out to the horizon by the time it reaches the
        middle of the frame. The far end must be inside some edge's core.
      - **The descent was a ramp and it ended off-screen.** Four treads of 2.1 is eight units of run
        for six of fall — thirty-seven degrees, a hillside — and the portrait frame reaches about
        twelve units either side of the board, so lip 11.6 plus that run put every terrace and the
        whole lower plane outside the picture. One unit of tread against seven of drop is sixty
        degrees and fits.
      - **It was painted as shadow.** `face` `#25272c` against `lower` `#282a2f` is a contrast of
        **1.041** — the roster's oldest rule broken on the one pair the landform is read by — and
        both sat at half the 0.045 below which a surface stops reading as a surface.
      - **And the evidence that passed it was a zoomed-out capture and a hard-panned one**, which is
        exactly where it was visible and is not where anybody plays. A visual claim is made at the
        default framing or it is not made.
    - **The lower country is its own material, where it used to borrow the flight's last ledge.**
      `ledgeLight`'s floor is the authored colour unlightened, so the largest surface in the frame —
      the plane running from the last terrace out to 170 — was the darkest value in the scene, which
      is the opposite of what distance does. The ledges are cut from `face` now (a terrace is rock,
      the same rock as the riser under it) and `lower` paints only the country, paler and cooler so
      it fades into the haze rather than fighting it.
    - **Something has to stand below, or the drop is a plateau.** An empty plane past the lip read
      as a shore on the first far-end render; what the eye takes altitude from is a *range*
      receding into haze, which is what the `below` masses and the second `wall` arc at depth 6
      supply — a six-unit mass standing a full drop down tops out under the ground the fight is on,
      and a ridge whose crest is below your feet is the one thing in the vocabulary that says *we
      are higher than that*.
    - **The far end belongs to the drop, and that cost the gate its bearing.** Both wanted the one
      direction the frame has distance in, and on a flank the gate cannot fit at all — in frame
      needs `|radius · cos(bearing)| + half-width < 12`, which at depth 3 means within about 55° of
      the far axis, which is the drop's. The gate is set into the rock on the left flank now and is
      framed with explicit landmark headroom. `SceneryKit.framingDepth` adds depth to the initial
      camera fit while centering the playable board as before; the same fit is used for recenter,
      resize and scenery reach. Mountain takes six world units so the complete gate fits desktop
      frames, while width still determines the reference portrait fit.
  - **Every prop says which rule put it there.** `ScenicProp.from` is a `PropSource` — `placement`,
    `group`, `anchor`, `colonnade`, `boundary`, `bank`, `scatter`, `cover`, `horizon`, `shelf`. The
    names live in `sceneryKits.ts` as `PROP_SOURCES` and `arenaScenery` re-exports the type, for
    `encounterShapes.ts`'s reason: they are one per *placing field of a kit*, and the second reader
    is the layout format, which records the origin of a baked placement and may not import a
    system. A list rather than a bare union because the format validates one by value —
    `oneOf(PROP_SOURCES)` cannot come apart from the union derived from it. The composer is still
    the only thing that knows: by the time anything downstream sees a finished prop
    it is a key, a hex and a matrix, so a crag placed by hand, one rolled out of the canopy list and
    one standing on a boundary arc are indistinguishable. That is fine for the scene, whose job is to
    draw them, and is the whole question for an editor, whose job is to say what a designer is
    looking at. Purely descriptive — nothing in the module reads it back, so tagging cannot move a
    prop — and **required rather than optional**, so a rule added to the file cannot quietly emit
    props that belong to nothing: the omission is a type error at the push site instead of an empty
    row in a hierarchy pane. `arenaScenery.test.ts` pins that every prop every shipped kit produces
    carries one, and that a key exactly one rule can place is filed under that rule; a key two rules
    share — `arena_brazier_0` is an anchor in one kit and a piece of the pass's gate in another — is
    legitimately either and is skipped rather than adjudicated.
  - **Water is an *area*, and `arenaWater` is the second entry point that says where.** A prop's
    boundary is its own outline; what a pond, a bog and a watercourse all needed was the shape of the
    *ground*, so `SceneryKit.water` declares a region and the composer claims it. Two entry points
    because the two answers go to two layers — the props are instanced meshes, the surface is drawn by
    `combat/arena/WaterSurface.tsx` as hex prisms — and they cannot disagree, because both read one
    memoised derivation (`composed`). **That memo is keyed on the kit's own object identity, and it
    has to be**: `sceneryFor` looks a kit up under the *location* indoors precisely because three
    places were floored in `stone`, so a key built from `surfaceKey` handed the castle the old
    Barrow's cold lamps and rendered the Obsidian hall in graveyard cyan.
  - Two shapes, and each has one narrowing that exists because a render said so. `pools` takes a
    **share** of its band and lets the field only *rank* it — a threshold on the same field gave a
    meadow 4% of its band on one fight and 55% on another, since the band is three and a half noise
    cells across. `course` names a `source`, the focal it flows out of, which is the one hex a region
    may share with something standing on it: a fall whose stream starts on the *next* hex is still
    the tap the review called it. `treed` lets a bog's canopy — and only the canopy — stand in the
    water, or the wetland loses the trunks that are its whole identity.
  - Nothing in a region is playable, and **in front of the board it cannot have a bank**: the
    envelope caps everything between the camera and the near rim at `FRONT_MAX_HEIGHT`, so a reed bed
    shrunk to fit is ten screen pixels tall. The shore there is drawn by the water instead, as a
    depth ramp off its own margin.
  - **`SceneryKit.groups` is several keys at fixed offsets about one bearing — a *composition*,
    where a `FocalAnchor` is one object.** A hall's head is a dais, a stair, a throne, flanking
    statues, standards and fire at the foot of the steps, and none of those is placed anywhere except
    with respect to the others. It is also what makes a dais *possible*: a platform wide enough to be
    one is five world units across against the canopy tier's 1.15 of half-footprint, so the flight is
    assembled out of blocks the envelope already has a size for. **A group stands on its axis, not on
    the hex `focalHex` picked** — a hex centre is wherever the lattice put it, which for the hall was
    0.87 units off its own carpet; and how far forward a piece may reach is `planClearance`'s answer
    on **both** flanks, because the board is not symmetric in world x. Seven compositions use it now —
    the hall's head, a camp, a desert ruin, the pass's gate twice, the pass's garrison and a highland
    terrace shelf — and the three targets it has not yet reached are all the same shape of problem:
    **a rate a composition has not replaced**, which is what `CASTLE_HALL.canopy: []` is the
    precedent for.
    - **`GroupPiece.lift` is the axis a composition could not say anything on, and the one a *built*
      thing is read by.** Every other offset is in plan, so a group could only lay its pieces out
      flat — right for a hall, whose floor is a floor, and exactly why the pass's gate came out as an
      arch standing on the ground, four step pieces making one wide tread 1.4 units in front of it
      that climbed 0.45 and stopped at nothing, and two timber decks on posts in the open. Rendered,
      that is an arch, a kerb and two tables. It is the prop's `tileTop`, and it **adds** to a
      `shelf`'s drop rather than replacing it, so a gate on ground that has fallen away falls with
      it; and it is handed to `tierFits` as the piece's own `baseY`, which is that parameter read the
      other way — a mass on the lower country is shorter than the board, a deck on a landing taller.
    - **`GATE_RISE` is one number, three models and a composition, and it lives in `sceneryKits`.**
      The flight climbs to it, the landing block's top *is* it, and the arch, the fires and both
      decks are lifted onto it by exactly it. Four copies is four ways for a stair to end short of
      its own landing, which renders perfectly. `voxel/models/scenery.ts` imports it from the data
      layer for the reason `props.ts` imports `TERRAIN_VARIANTS` from `terrainDisplay`: the
      composition is the one place a reader can see the whole agreement.
    - **The pass's landing is nine blocks wide because of what has to stand on it, not because nine
      looked right.** A terrace carrying the arch, a fire either side and a deck on each end does not
      fit in seven: the decks' own reach at their `scale` plus the fires' overlaps by about half a
      unit per flank, and bringing the decks in is what makes them crowd the gate they flank.
    - **Consolidation is a rule about what a kit may *also* do.** The pass used to answer "where is
      the garrison" four independent times — the watchtower a focal anchor spread by bearing, the
      tent a second, the stores and the fencing in the rolled thicket list — and at this framing a
      watchtower is a waist-high timber frame with a canvas top, so two of them at two bearings read
      as two tables with the same weight as the gate. `PASS_CAMP` holds all of it; the kit's tiers
      are rock and pine. Nothing fails the day somebody puts a fence back in the thicket list, so
      `passGate.test.ts` states it: no key the camp places may also be rolled or anchored. The
      brazier is the one named exception, because it is a light as well as a fixture.
    - **A supporting group's bearing is measured against the frame, not against the ring.** The camp
      first went at `-2.95`, nearly due left, which is where a portrait frame has no width: the whole
      composition stood off the left edge and the consolidation read as the furniture having been
      deleted. `-2.5` at depth 2 clears the gate's own span and stays in shot.
    - **The tier contract is measured over the tier lists, the focal anchors and — now — the group
      pieces**, and the half that was missing hid a real violation: `arena_arch_0`'s pier footings
      reached 1.19 against the canopy's 1.15 for the whole life of the pass's gate, because an arch
      has never stood anywhere but inside a group. `arenaScenery.test.ts` already carried the
      argument in a comment ("a check that walked only the lists would go quiet on exactly the
      pieces the composition guarantees to place") and then walked only two of the three.
    - **A fixture's light stands where the fixture does.** `arenaLightAnchors` took the flame's
      authored height and nothing else, which was true of every arena until a kit could declare a
      `shelf` and is false in both directions now — a brazier that has followed the land down a
      six-unit drop lit from six units above itself, and a gate's own fires sit a landing up. It
      reads `ScenicProp.tileTop`, the same field the prop is drawn at, so the flame and the light
      it casts cannot disagree about where the fire is.
  - **`SceneryKit.colonnade` is the wall ring's placement rule one course in, with a beat.** Pillars
    dominated the hall because a rate has no rhythm in it, and the first fix — the statue at a
    quarter rate in the same tier — produced twenty-five robed guardians, which is the same fault
    with different furniture. `CASTLE_HALL.canopy` is `[]`: a hall's large things are its walls, its
    colonnade and its group, all three of them placed rather than rolled.
  - **A quiet sector changes one hex more than its own ground, and the rule says so now.** The
    tier cascade is why: a rolled canopy publishes a feature site and the ground tier is biased
    toward it on the hexes around it — "continuous soil around roots" — so silencing a tree takes
    the ground prop beside it too, and *beside it* can be across the boundary. Measured on the pass,
    a pine at −103° is inside the sector and the `arena_ochre_0` its skirt was holding stands at
    −107.8°, outside. `arenaScenery.test.ts` had asserted that **nothing** outside moves and was
    passing on geometric luck: no sector authored before ran within a hex of a structural canopy.
    The tolerance is bounded to exactly that mechanism — a differing hex outside must *touch* a
    differing hex inside — so anything further out still fails.
  - **`SceneryKit.cover` is the opt-out from clumping, and one kit takes it.** An even sprinkle of
    small objects over flat ground is confetti and the *gaps* are what make a forest floor read as a
    mass — which is right for a wood and wrong for open country, where a field of grass with clear
    ground between the clumps is a field that has been mown in patches.
  - **The rolled scenery reads a *feature field*, which is how a prop comes to belong to
    something.** Every placed piece — a boundary segment, a colonnade shaft, a group's furniture, a
    focal anchor, a bank piece — publishes a point with a radius, and the middle tier, the ground
    tier and the cover are biased toward it: `FEATURE_BIAS` runs the rate from 0.38 in the open to
    2.3 on a landmark, and the cover's threshold is tilted the same way either side of half pull.
    Before it, a bush beside the camp and a bush alone in the sand were the same roll at the same
    rate turned by the same hash, which is the composition review's "individual boulders, outcrops,
    fences, trees and small ground clumps receive similar spacing and attention" stated as code.
    - **The canopy is deliberately exempt**, and that is the shape of the rule rather than an
      omission: the canopy is what a scene's *enclosure* is made of, so biasing it toward the
      landmarks would thin the flanks and put the wood back against the wall. It is also the
      suite's control — the gather statistic is computed over both, and the canopy's answer is
      byte-identical with the bias neutralised.
    - **A group also *excludes*, over `GROUP_MARGIN` past its own footprint, and claiming hexes was
      not enough.** A hex is claimed when its *centre* falls inside a piece's spread plus a hex
      half-width, and a rolled prop stands at its centre plus up to `JITTER` — so the first
      unclaimed ring could put a bush a third of a unit inside the dais beside it. The boundary and
      the anchors gather without excluding, because rubble at the foot of a cliff and growth at a
      lantern's foot are the thing being asked for.
    - **A prop deep in a landmark's skirt is turned to face it** (`ORIENT_PULL`), the way a bank
      piece already faces its water, with `ORIENT_JITTER` so the square ones do not read as a
      parade. Out in the open the hash still decides: a prop addressing a landmark three hexes away
      is pointing at nothing.
    - **The cascade is two passes over the ring, and that is what puts trunks in the field.**
      "Continuous soil around roots" needs the understorey and the cover to see the trees, and a
      single pass would make a hex's answer depend on which hexes the loop had already reached —
      the one thing the whole ring rests on not doing. Behaviour-preserving by construction: a hex
      that took a tree never tried a bush anyway, and every roll is salted per hex and per tier.
    - **`SIZE_FIELD` is the other half of "local variation".** An independent roll per hex is the
      only variation a per-hex hash can produce and it is salt and pepper — every size next to every
      other size, one average everywhere and no large shapes at all, which is the scale gap the
      review names. A coherent band a few hexes across multiplies over the per-hex roll, which is
      narrowed so the product keeps the old span.
  - **`groundPatches.AxisBand` is the patch that is a line.** A carpet lies on ground a unit has to
    be able to stand on, so it is a floor mark rather than geometry — and it is the one field in that
    file with no seed, because a carpet is a fact about the room and not about the fight. Its bearing
    and the group's are the same number in two files and nothing at runtime compares them, so
    `arenaGroup.test.ts` does. `bandTint` carries *only* the band past the playable rim: a runner is
    a made thing laid down the length of a room, while the blob patches are the board's own material
    and the surround is deliberately one ground fading outward.
- **`utils/floatQueue.ts`** — when a floating word is allowed to appear. The arena anchors every
  number and every status name in world space at its affected hex and draws it for 1.2s. Several routinely resolve
  in the *same frame on the same hex*: `strikeScales` makes Rapid Fire five strikes and Flurry up to three,
  each floating its own damage at one target, so the capstone whose whole selling point is the number
  of arrows drew one smeared number — and `STATUS_FLOAT_DELAY_MS` only ever separated the *first*
  status from its damage, so a skill landing three afflictions fired all three at 250 ms.
  `createFloatQueue(FLOAT_STAGGER_MS)` (260) is pure arithmetic over a clock — the scene keeps the
  timers — and is **keyed per anchor**: serialising the whole board would make a four-target AoE take
  a second and a half to finish reporting, with the last number arriving after the turn had visibly
  moved on. `sink.float`, `sink.status`, `floatAtHexRef` and `floatTextAtHexRef` all go through it,
  and `turnSink` no longer keeps a second copy of the delay or a second list of timers.
- **`components/shared/propInstancing.ts`** — where a prop stands, as plain numbers, shared by all
  three scenes. Three copies of "look up the def, lift it to the tile top" is where the next
  `offsetY` bug would have lived. It was a component (`PropAt`) until the scenes stopped drawing one
  `<primitive>` per prop; an instance is a matrix rather than an object with a `position`, so the
  same arithmetic is now a function. `components/shared/InstancedProps.tsx` draws the result.
- **`combat/arena/`** (`camera`, `UnitMesh`, `overlays`) and **`combat/hud/`** (`CombatLog`,
  `FloatingText`) — the R3F and 2D pieces.

## The elites: ten signatures

Every current elite has one thing that belongs to it and to nobody else. Ghost Touch, Rune Dome and
Dread Charge already did that for the Ghost, the Runeguard Sentinel and the Dread-Knight; the other ten are
below. The new-faction elites (Burrowmother, Herd-Khan, Rime Jarl, Glacier Colossus) follow them
([their own section](#the-new-faction-elites-four-signatures)).
The rules are pure functions in `systems/combat/eliteKits.ts` (nothing there imports the store, so the HUD, the
Node suites and a tuning harness ask the same questions the fight does); the store-writing halves are
`eliteActions.ts` (an elite's cast and what its AI makes of a signature) and `eliteWarnings.ts` (the warned ones). The skills
are `data/skills/eliteSkills.ts`, the passives are in `passives.ts`, and every number is a `BALANCE` constant named
below. Pinned by `eliteSleepers`, `eliteBerserker`, `eliteMage`, `eliteWarned`, `eliteWarchief`, `eliteCaptain` and
`eliteFights` (every elite fought to the end by the real AI, with the invariants checked each turn).

**Two shapes recur.** The *lethal saves* (Cave Bear, Revenant) are passives that use `survivesLethal`'s one shared
`UndyingSpent` mark, so each happens once per battle and no other save stacks with it. The *warned ones* (Mire Undertow,
Fracture, Briar Claim, Witch's Geas, Mind Control, Feast Slash) ride the shared prepared attack
(`castPrepared`, `preparedResolve`, `previewPrepared`): the footprint is fixed or follows the marked, every hero standing in it owes a
window, and the banner says what it does and how to answer it (a catalog move in its own words, `warning.move.<id>`;
a scripted one from the board as it stands, `preparedDisplay.eliteTail`). Elite signature skills
strike nobody at the cast, so `eliteSkillValue` scores each on what it buys; the AI otherwise scores damage. **A caster that
falls takes its open warnings with it** (`combatStore.retireOwned`, from every path a unit dies down), and a Matriarch's seed with her: a dead
elite lands nothing, and a lit footprint waiting on a turn that will never come would read as a bug. Other objectives are left standing, as ever.

### Cave Bear: Winter Sleep (`winterSleep`)

The first otherwise fatal blow leaves it at 1 health, heals `WINTER_SLEEP_HEAL` (8%) of its maximum and puts it to sleep for
`WINTER_SLEEP_TURNS` (3) of its own turns. While it sleeps every strike lands for `1 - WINTER_SLEEP_DAMAGE_REDUCTION` (92% less):
`damageCalc.slumberMultiplier`, applied last in `calculateDamage` — after the `MIN_DAMAGE_FRACTION` floor and every condition, so
armour penetration cannot reach it and a crit doubles the small number. It replaced a Defense coat (3× Defense), which showed as
"DEF ~100" on the sheet yet could never take more than 80% off a hit because of the floor. The tick that ends the sleep wakes it at
**full health** (`tickEffectsOnUnit`, read on the outgoing duration like Doom). A sleeping bear loses its turns (`TurnStart` kind
`asleep`, "is asleep!", and `isActionLocked`); it is an aura, so no cleanse reaches it. The party finishes it with big hits inside the
window, or beats it twice. Killing it in the window ends the fight; the save is spent, so a woken bear dies normally. It is not Druid
Hibernate (a heal over time with Defense) and shares nothing with it but the word, which is why the skill-less passive and the status say
**Winter Sleep**.

### Dark Mage: Mind Control (`mind_control`)

A warned mark (range `MIND_CONTROL_RANGE`, one window, interrupted by Stun, Silence or Freeze on the Mage) on the hero the AI
thinks hits hardest. If that hero is still on the marked hex when it lands they carry **Mind-taken** for `MIND_CONTROL_TURNS` (2) of
their own turns: **the turn is borrowed**, `nextTurn` flips `isPlayer` for it (`CombatUnit.seized`) and hands it back as it ends, so the AI that
plays every enemy plays the hero with their own skills against their own party and every rule that asks whose side a unit is
on reads the truth. The hero's `heroId`, health and saves are never touched. It is cooled for `MIND_CONTROL_COOLDOWN` (6), longer than
the control plus its window, so the Mage cannot chain it.
Decisions: **the last living hero is never taken** (`canBeSeized`: `applyEffect` refuses it, the AI does not cast it, and a hero whose last ally fell
before their turn is freed); a **cleanse** frees them (Mind-taken is an affliction); **the Mage falling** frees them at the start of their turn
(`controlVerdict`); `setPhase` hands a borrowed hero back the moment a fight ends, so nothing downstream reads them as an enemy. The turn announces
itself ("X acts for the Dark Mage!") and the arena draws a link from the Mage.

### Bog Hulk: Mire Undertow (`mire_undertow`)

Ground Slam, striking at once as before (the damage and the Taunt are the old slam's), plus a marked marsh over every hex within `MIRE_RADIUS`
(3) of the Hulk. Heroes standing in it owe a window; after it, those still inside are dragged `MIRE_PULL` (2) hexes toward the Hulk. It
is `traceForcedMove` run the other way (`traceForcedPull` pushes from the mirror of the Hulk through the target), so a wall, a body or Immovable
stops it exactly as it stops a shove, and bodies are pulled nearest-first so a front rank clears the way for the rest. The preview's landing
hexes and the resolution are one function (`previewPulls`), and they read the Hulk **where he stands now**: the marsh is fixed, the pull is toward
him, and the landings shown move with him. Leave the marsh, hold with Immovable, or accept the pull and meet the Hulk's next attack. One
warning at a time (`canPrepare`), so a second slam while the first is open is a plain slam. **The AI slams only when somebody stands
beside him** (`eliteSkillValue`): the slam has to strike for the cast to happen, and the marsh is laid only after it does, so with
the party two or three hexes off he walks in and the marsh drags the rest on a later turn (PT-14).

His **Maul** (`beast_maul`, shared with the Cave Bear) shoves its target a hex and waits `MAUL_COOLDOWN` (2) turns. At will it
shoved a lone melee hero out of reach on every one of his turns, and since a turn is move or act the hero walked back every turn and
never swung (0 swings, 0 wins in 20 headless fights of one 900-HP melee hero; 20 of 20 at a cooldown of 2, 5 of 20 at 1). Between
Mauls the Hulk swings `club_strike` (his mace, at will) and the Cave Bear `bite`, so neither spends the wait standing still. The
cooldown is a starting value to verify in playtest.

### Orc Berserker: Pain Feast (`painFeast`)

Every separate blow it takes builds one Rage (`AuraType.Rage`, to `PAIN_FEAST_THRESHOLD`, 6). Counted in `damageUnit`, the funnel each strike of a
multi-hit skill passes through one at a time, so Rapid Fire's five arrows are five stacks every time; a tick or a reflection with no hostile
author is nobody's blow. Rage persists across rounds. Full, the AI trades its Slash for **Feast Slash** (`eliteSkillsFor`, for exactly the turn
it fires): a wide arc (`PAIN_FEAST_DAMAGE` 1.8, against Slash's 1.1) that Bleeds, **announced** one window ahead and broken by
Stun, Silence or Freeze on the Berserker, with the Rage spent at the announcement. It cannot fire invisibly: the status badge reads `n/6`, the log says
when the Rage fills, and the warning names the swing.

### Orc Warchief: Warband Order (`warband_order`)

Marks a hero (`AfflictionType.Warband`, `WARBAND_TURNS` 2 of the hero's turns, range `WARBAND_RANGE`). Every Orc of his side (Grunt, Berserker; goblins
are not Orcs) **converges on that hero on its next actions** (`warbandTargetFor`, read at decision time, after Taunt so a taunt still wins): it strikes
them if it can and closes in if it cannot. The order stands only while he can still shout it: **Stun, Silence or Freeze on the Warchief, or his
death, ends it**, and killing the responders thins it. With no Orc standing he first calls one Grunt (`callBackup`) so the order still has someone to act on
it: the Grunt is an Orc ally like any other, which is what caps it at one living backup, and `WARBAND_BACKUP_TOTAL` (2) caps the fight, counted off every
Grunt he ever called. A called Grunt is a conscript (`WARBAND_BACKUP_POWER`, 0.7 of the warband's strength) and pays no reward of its own. No free hex
means no Grunt and the AI does not score the order. The `intimidating` passive, which reads a Taunt his kit can never lay, is gone.

### Revenant: Soul Fracture (`soulFracture`)

The first otherwise fatal blow leaves the body at 1 health, **untouchable** (`AuraType.SoulSplit`: no damage lands, no tick reaches it, single-target
skills cannot aim at it) and breaks it into `SOUL_FRAGMENTS` (3) fragments at separated graves (`soulSpots`: free hexes three to five from the body, each as far from
the ones already laid as the board allows). A fragment is an attackable objective (`SOUL_FRAGMENT_KIND`) with `SOUL_FRAGMENT_HP` of the Revenant's maximum that
crosses `SOUL_FRAGMENT_STEP` (2) hexes on each of the Revenant's own turns toward the body, round whatever stands in its way (a hero in the path blocks a hex, not the fragment), and
is home when beside it; past `SOUL_FRAGMENT_MAX_TURNS` (5) every fragment still loose arrives, so a wall of bodies delays it and cannot hold it.
When every fragment is **destroyed or home** (`settleSoul`, called as each falls or arrives): none home and the Revenant dies for good, otherwise it
reforms with `SOUL_REFORM_PER_FRAGMENT` (20%) of its maximum per arrival. The save is spent, so the second body dies normally. The status reads `n home · m loose`, a
line is drawn from each fragment to the body, and each fragment is a pale wisp. **The passive is paced so it can be
followed:** the break is a nova on the body and one wisp per fragment leaving it, each `soulVfx` held back 350 ms after the last;
on each of the Revenant's turns the fragments cross one after another (450 ms apart, a `bolt` per step or arrival) and the
turn is held for `SOUL_BEAT_MS` (`TurnStart` kind `soul`) instead of being passed on at once; a body that reforms blooms last. It replaces the shared Undying.

### Coven Matriarch: Briar Claim (`briar_blight`)

Her Blight (poison, as ever) now plants a **briar seed** beside the hero it poisoned most (`briarTarget`), on the free hex nearest her: an attackable objective (`BRIAR_SEED_HP`
of her maximum) tied to a warning that waits one window for that hero. When it is due the seed grows into a **Coven Thrall only if it still stands and the hero
is still poisoned by her**; cutting it down cancels the warning at once (`bindsPrepared`), cleansing the poison makes it wither. One seed at a time, never past
`BRIAR_THRALL_CAP` (2) living Thralls, and a Thrall pays no reward of its own. Raise Dead and Lifebloom (which no action of hers could trigger) are gone from her kit.

### Ashwood Crone: Witch's Geas (`witchs_geas`)

Curses one hero (`AfflictionType.Geas`, `GEAS_TURNS` 3 of their turns). The hero's **next skill that is not a basic attack** still works and
then spends the curse: the Crone raises a **warned eruption** (`geas_eruption`, `GEAS_DAMAGE` x Magic, radius `GEAS_RADIUS`) round them, with a window for everyone in the
ring. A basic attack lifts the Geas unspent; a cleanse lifts it; it never touches an unmarked hero. Answered by the Crone's cast rule (`eliteWarnings.geasCast`, after the
Writ's, whenever the resolver says a cast was paid for), so a hero the Mage is holding is covered too. **The full response window** is the marked hero's own turn: the curse is a status they can read
before they act, and the skill panel says whether the skill they are about to press is the one that spends it (`geasWarning`), and then the eruption itself is warned for a further
window. A dead Crone raises nothing, and she is never given a second eruption while one is open.

### Delve Overseer: Fracture (`fracturing_breaker`, `fracture_slam`)

Armour Breaker still takes Defense and now also leaves a **Fracture** mark (`FRACTURE_TURNS` 3 of the hero's turns). His Ground Slam, with a Fractured
hero on the board, is announced instead of struck: the footprint is the ring round him and a `FRACTURE_RADIUS` ring round **every marked hero wherever they stand**
(`fractureFootprint`, each hex once), with a window for everyone in it, and the marks are spent when it lands. The rings **follow the heroes**
(`followFractures`, every turn), a cleansed or fallen hero drops out, and a hero a moving ring newly reaches owes a window of their own, so nothing detonates unannounced. A cleanse, spreading apart or
stopping the Overseer each matters. Against an unmarked party the slam is the plain, immediate one.

### Brigand Captain: Captain's Authority (`captainsAuthority`)

While a Captain lives, every other ally of his wears `AuraType.Authority`: `AUTHORITY_BONUS` (+50%) on **every** combat stat (attack, defense, magic, magic
defense, speed, movement and maximum health). **`syncAuthority` is the one place that decides who wears it**, and it is idempotent: it runs when a fight begins, when units
arrive, and the instant a Captain falls (to a blow or a tick), so a latecomer is buffed, a death takes it from every ally at once, and two Captains cannot
stack it (each is buffed once, by the other). The Captain is never buffed by himself, and objectives and a hero the Mage is borrowing never wear it. **Health keeps its
share of the maximum** as the maximum moves, both ways, rounded the same way (`combatMaxHp` carries the aura, so every bar reads it). Interactions: Rally's +5 attack
is laid first and the word multiplies the result; `speedEdge` reads the Captain's +50% so a warband under him is quicker at the bonus-turn dice, the one speed modifier tempo
reads (a Chill or a timed buff never was), and `TEMPO_MAX_CHANCE` still caps it; the opening turn order counts it. **Formation:** `enemyFormation` puts a Captain on the back
rank behind the middle of the rest of the warband, so the hexes in front of him are held at the start; after that he moves and fights like any other
enemy — the aura is his passive, not a reason to stand still (a playtest found a Captain idling until his whole warband was dead). A gold line links him to every empowered ally. **Rally
waits for the warband** (playtest PT-08): his warband walks at the party on its first turns, away from his back rank, and he
used to spend his opening turn Rallying only himself. `enemyAI.isLonelyFormationBuff` marks a range-0 ring of auras alone
that would land on nobody but its caster; `decideEnemyAction` then takes any other skill that reaches something, else walks
(`chooseMoveTarget`, which for a unit holding a ready formation buff adds `AI_FORMATION_PULL_PER_ALLY` per other ally within
the buff's radius of a hex), and casts the lonely buff only when he cannot move. One action per turn still holds: he moves
this turn and Rallies on the next one that covers somebody. A pure `Self` buff is never lonely. Tests: `captainRally.test.ts`.

**Formation warbands** (playtest PT-12, 2026-10-10). `EnemyTemplate.formation` marks a template `line` or `behind`;
`systems/combat/formation.ts` answers the board questions and nothing without the field is affected. Today only the
Obsidian Legion carries it: Infantry and Runeguard Sentinel are `line`, the Blood-Thirster Stalker and Blood-Iron
Arcanist `behind`, the Dread-Knight none (it charges on its own). The Legion used to arrive back to front: its Stalker
(speed 15, move 4) and Arcanist (speed 9) act before the Infantry (6) and Sentinel (4), and the line opened with Shield
Wall and Rune Dome eight hexes from the party. Three rules now:

- **Spawn.** `enemyFormation` treats `behind` templates as it treats the Captain: back rank, behind the middle of the rest.
- **The line marches.** A `line` unit with no foe within `AI_LINE_CONTACT_REACH` (4) scores no `supportValue`, so it
  walks instead of laying a three-turn buff that would expire on the way; with a foe near it locks shields as before.
- **Behind holds.** Until some living `line` ally stands within `AI_LINE_ENGAGED_REACH` (2) of a foe, a `behind` unit's
  `chooseMoveTarget` refuses hexes nearer the nearest foe than the line's front plus `AI_BEHIND_LINE_GAP` (1); it is never
  pushed back, only kept from advancing. It still casts whatever reaches from where it stands. No living line, an engaged
  line, a taunt or the Warchief's order frees it.

One general change rode along: a melee unit's move scoring adds `AI_MELEE_CONTACT_BONUS` (1.5) to a hex beside any foe,
so a unit walled off from its lowest-health target by its own side strikes a neighbour instead of idling a hex short (the
held Stalker did, once the line had taken the hexes round its target). Measured headlessly (`legionAdvance.test.ts`, the
party standing still, seed 7, Infantry ×2, Stalker, Arcanist, Sentinel): before, the Stalker stood beside a hero in round
3 and the Arcanist was at casting range in round 2 while the Infantry arrived in rounds 4 and 5; after, both Infantry
arrive in round 4, the Stalker in round 5, and the Arcanist reaches range after the line. Not yet replayed in the app.

### Presentation

`data/display/eliteLinks.ts` is every line the arena draws between an elite and what its signature is tied to (Captain to allies, fragments to the body, a
seed to its hero, the Mage to a held hero, the Warchief to the hero he named), drawn with `ChainLinks`. Soul fragments and briar seeds have their own placeholder
meshes (`UnitMesh`). Every status has a badge with a one-line description. Elite skills borrow the nearest drawn skill's icon until their own is drawn
(`HeroSkill.icon`, listed in `icons.test.ts`). Looked at in the web preview with the visual-baseline harness (2026-10-02): the Captain's gold
lines and back-rank formation, the Revenant's fragments and their lines, the Hulk's marsh footprint and its banner, the Matriarch's seed on its marked hex, and the Mage's,
Berserker's and Crone's warnings all draw and read at a landscape phone's framing, with no page errors.

**What a signature puts on a body is drawn on the body** (`data/display/eliteMarks.ts`, pure; `arena/EliteMarks.tsx`),
because a badge has to be tapped and the decision is made on the board. Every mark sits on the ground round the feet or
above the HP readout, never over the model, so an elite's walk and swing stay as readable as anyone's:

- **A lethal save still to come** — the Cave Bear's and the Revenant's — is a slow hexagonal sigil at the feet, frost blue and
  soul white, gone the moment the save is spent (`UndyingSpent`): *this one does not die to the first killing blow*.
- **The Bear's sleep** is a faceted ice shell with breath rising off it and a bead for each of its turns left asleep, lit
  as they remain: the count the party is racing before it wakes at full health.
- **The Berserker's Rage** is a gauge of `PAIN_FEAST_THRESHOLD` segments round its feet, one lit a blow; full, it burns and
  the floor under it with it — the feast is next. Spent at the announcement, it empties as the Feast Slash's arc is drawn.
- **A hero an elite has named** carries the naming: a point above the head aimed down at a hero the Warchief named, a
  turning sigil over a hero the Mage holds or the Crone has cursed (each in its own colour), glowing cracks under a
  Fractured hero, long enough to run out from under them.
- **An Orc answering the Warchief** wears a quick ring at its feet, from the same `warbandTargetFor` its AI walks by, so
  the ring and the walk agree and both stop when a Stun breaks the order.
- **A warband under the Captain's word glows gold** (`AURA_GLOW`), his link's colour, so the glow and the line to him read
  as one thing.

**The moments are pictures handed back on the events the store already returns** (`eliteBeat`, like `soulVfx`): the Bear
is seen falling asleep (frost settling, rime left behind) on the blow that would have killed it, and rising to full
strength (a frost column) on the tick that wakes it; a Captain falling lifts a gold ring off every ally that loses his word.
The Warchief's order is lined up on the hero before the mark lands (`vfxPrelude: 'aim'`, a `buff` on the hero, where it was a
projectile), the Crone draws her curse before it flies, and each warned landing leaves its ground behind: blood under the
Feast Slash, churned mud where the marsh dragged, the curse's smoke round its caster, broken ground after a Fracture slam,
motes where a briar grew. A warned attack opens with no prelude of its own — its warning is the tell — which
`eliteMarks.test.ts` pins with the marks and the moments.

Photographed at 844x390 and 932x430 with `BATTLE_SET=signatures` (`scripts/battle-baseline.mjs`; the harness stages each
signature through the elite's own action, after the scene's fight start has settled), 2026-10-03, no page errors: each of
the ten signatures reads before its consequence, and the Ghost (a drain and a visible retreat), the Runeguard Sentinel (barrier
shells on the soldiers round it) and the Dread-Knight (a dash, a strike and a shove) were judged readable as they stand.
Evidence: the private project notes.

### Measured

The tuning harness's synthetic party (four AI-played heroes, 60 runs each) beat each of the ten, against 100% before the signatures: the Berserker with a Grunt 95%, the Bear 88% (the sleep
costs the party its easy win), the Warchief 100% in fights twice as long (his two conscripts), the rest at 100% with fights as long as before. The harness plays no counterplay (it never steps out of a warning or
Stuns a cast), so these are floors for a party that does. `PAIN_FEAST_THRESHOLD` was raised from the plan's 5 to 6, Feast Slash's damage lowered from 2.2 to
1.8 and the Warchief's rest raised from 5 to 8 turns after the first measurements had the Berserker's fight at 10% and the Warchief's at 18%.

## The new-faction elites: four signatures

The frozen-north factions' elites each have the one thing that belongs to them and to nobody else
(the private project notes; the plan **supersedes the board's task text** where they
differ: the Khan's is *Twin Raid*, not a Stampede Call, and a refused challenge wraps the Jarl in a Barrier, not
the warband in Fury). The rules are pure functions in `systems/combat/factionEliteKits.ts` (no store import,
like `eliteKits`); the store-writing halves are `factionEliteActions.ts`, with `duelRules.ts` for the two questions
the engine itself asks of a duel. The skills are `data/skills/factionEliteSkills.ts`, every number is a `BALANCE`
constant, and the suite is `factionElites.test.ts` (plus the four fought to the end in `eliteFights.test.ts`).
Where a rule needs a state the engine did not have, it is a status or a field on the unit, so the pure
rules, the HUD and a harness all read the same roster: `AuraType.Burrowed`, `Encased`, `Duel`, `Challenged`,
`Kneeling`, and `CombatUnit.duel` / `CombatUnit.challenge`.

### Burrowmother: Undermine (`undermine`)

Her Double Sting's Poison is `magnitude` 0.15 (halved from 0.3 after a playtest found it far too strong).

She burrows (`Burrowed`) and **nothing can aim at her and nothing lands on her** (`isSealed`: single-target skills,
damage and afflictions all refuse; `isHiddenFrom` and `isHeldFromHarm` are the shared predicates) until her eruption
lands. The ground it will erupt over is announced through the shared warning (`castPrepared`, `scripted: 'undermine'`):
a radius-`UNDERMINE_RADIUS` disc centred where it covers the most heroes (`undermineShape`), fixed at the cast, with
two **vents** on its edge (three against a party of three or more, `PreparedAttack.vents`, turned to leave as many
unplugged as the board allows so there is something to plug). Every hero in the disc owes a window, and **her
turn is inert until it is due** (`beginTurn` returns `inert`, so no speed-granted turn can shorten it). When it lands she surfaces in
the footprint (its centre, or the free hex nearest it; nobody is displaced, and she gets there by a swift dash slide, not a walk) and the eruption is the shared resolver run over the
warned ground: damage (`UNDERMINE_DAMAGE` x Attack) and a **knock-up that is a picture only** (`knockUpIds`, as Farthest
Prey's is): the plan leaves its meaning open, and a Stun on the whole party was what the first measurement found too
heavy. Then **each vent no hero stands on opens a Sand Mite** (`ventsThatSpawn`; a hero on it plugs it, anything else on it also
stops it), never past `UNDERMINE_MITE_CAP` standing, each a conscript at `UNDERMINE_MITE_POWER` of the brood's strength, and
she is **Exposed** (`UNDERMINE_EXPOSED` more damage taken) for exactly one round: the aura's one turn ends as her own
next regular turn begins, so every hero has had one. The banner says how many vents would open and how to answer
(`preparedDisplay`); the vents are drawn as green hexes beside the red footprint, and she is drawn as a ghost over a sand mound.

### Herd-Khan: Twin Raid (`twin_raid`)

Two dashes in one action (`planTwinRaid`): each up to `TWIN_RAID_DASH` hexes across free ground (never through a body or
solid ground), the second starting where the first landed, chosen jointly for the most heroes caught across both
arrivals. **Each arrival bursts over radius `TWIN_RAID_RADIUS`** for `TWIN_RAID_DAMAGE` x Attack and a Bleed, through the shared
resolver, so a hero's defences, crit and dodge answer it as any blow; **a hero caught by both takes both**, and Bleed
refreshes rather than stacking (its shared rule). Nothing is dealt along the route, nothing is pushed, and he ends at
his second landing; if no second dash is legal the raid ends after the first burst (no extra attack, no refund). It is
immediate, as the plan says (no preparation round): the AI makes the first dash as a move flagged `AIAction.dash` (its
route), which the scene slides and waits on, and the action that follows bursts where he landed and makes the second dash and burst
(`performTwinRaid`; the second burst's picture waits a beat). It costs one action and a cooldown, and he does not raid for show:
no landing that catches nobody.

### Rime Jarl: Jarl's Challenge (`jarls_challenge`)

He names a hero within `CHALLENGE_RANGE` (`castChallenge`): the hero carries a pending `challenge` (the circle that would close,
radius `CHALLENGE_RADIUS` round **his hex at the cast**, drawn on the board with a line to the Jarl) and a Challenged badge. **Only one challenge or duel is ever
open.** At the start of the hero's next actionable turn they are asked (`ChallengePanel`: **no Cancel**, back swallowed, every number read off
`duelOffer`) and the choice costs no action; a stunned turn is not an answer, so it never expires into acceptance. A challenge lapses if either
has fallen or left the previewed circle. An AI-driven hero, a harness's or one the Dark Mage is holding, answers by `decideChallenge` (accept when they can comfortably
outlast his best blows).

- **Accept:** both carry a `DuelBond` and a Duel badge; the Jarl's carries `DUEL_DAMAGE_BONUS` (+25%) on **direct Attack-scaled damage**
  (`calculateDamage`), ending with the circle. **The restriction is one predicate**, `duelBars(from, to)`: the two duelists can affect each
  other and themselves and *nobody else*, and nobody else can affect them (damage, healing, shields, cleanses and new statuses alike; statuses
  already on a duelist continue). It is asked by both resolvers, the highlight pass (`getValidSkillTargetHexes`) and the AI's foes. Outsiders may
  cross and stand in the circle: it is not a wall. The duelists cannot leave it: `getMovementRange`, a dash's landing (the Jarl's Charge, a
  blink) and a shove (`traceForcedMove`) all treat its edge as the board's. It ends when **both have ended `DUEL_TURNS` regular turns**
  (the hero's acceptance turn counts; bonus turns never do), or at once, with no punishment and no reward, when either falls.
  If the hero lived the Jarl **kneels** (`Kneeling`, read pre-tick like a Stun) and loses his next turn, bonus turns included.
- **Refuse:** no circle, no mark, nobody denied an action and **no Fury**. Only the Jarl is wrapped in a Barrier worth `REFUSE_BARRIER` (100%)
  of his maximum health for `REFUSE_BARRIER_TURNS` of his turns, replaced and never stacked.

### Glacier Colossus: Glacial Tomb (`glacial_tomb`)

He seals the hardest-hitting hero within `TOMB_RANGE`, with one tomb at a time and never against a party down to its last hero. The block is an
**attackable objective on the hero's hex** (`TOMB_HP` of his maximum health, no defence of either kind) and the hero is `Encased`:
untouchable, no turn, **nothing on them ticks** (their turn is lost before the tick, so a poison keeps exactly the clock it had), and no new
affliction lands. The block is put at the *front* of the roster (`sealInTomb`), so everything that finds a unit by its hex finds the block and
a hero's allies hit it with any attack. The collapse is the shared warning bound to the block (`bindsPrepared`), owing a window to **every
other living hero** and never to the sealed one.

- **Left standing** the block is taken away and the hero freed (`beforeTombLanding`), then they take `TOMB_DAMAGE` x his Magic as magic damage and an
  **exact** Chill (`SkillEffect.exact`): a Chill even on a hero already Chilled, never the shared Chill-to-Freeze upgrade.
- **Broken from outside** (`damageUnit` -> `breakTomb`), the hero is freed at once, the warning is cancelled, and the block shatters outward for the same
  magic damage into every enemy of the party in the six hexes round it, the Colossus included if he is there. **Heroes are never hit.**
- If the Colossus falls with a tomb standing, the block goes and the hero is freed (`retireOwned`).

The banner names the block's health and both outcomes. The block is a placeholder translucent ice block with a cold light, the hero visible inside it.

### Presentation, as looked at

Photographed in the web preview with the visual-baseline harness (`BATTLE_SET=elites`, 1280x640 and 844x390, 2026-10-02, no page errors): the
Burrowmother's marked ground reads as the shared violet warning with the three vents outlined in green round the party, the banner naming
who is waited on, how many vents would open and how to answer, and she stands as a ghost beside the sand; the Jarl's challenge is the
two-card panel over the dimmed board with no way to dismiss it, and once accepted the circle is a blue zone round his hex with a line between the
two and a Duel badge on the unit card; the Colossus's tomb is a pale translucent block over the sealed hero with the banner giving its
health and both outcomes. The Khan's raid is an action and is not reproducible at a fixed settle, so it was only checked in the rules suites.

### Measured

The harness's synthetic party (four AI-played heroes, 40 runs each, which never steps out of a warning, plugs a vent on purpose or breaks a
block, so these are floors for a party that does) beat each of the four, against 100% without the signatures: the Burrowmother 100% in fights about
1.7 times as long (75 turns against 43; her cooldown was raised from 5 to 8 after the first measurements had it at 0%, because the mites it
spawned were taking the party's attention for most of the fight), the Khan 100% in fights as long as before (30 against 29), the Jarl 100% in
fights half as long again (88 against 59, the party refusing about two of every three challenges), the Colossus 100% in fights a tenth longer (88 against 80).


## The Draconic Host: two warned elites

Jadeveil's summit faction (the private project notes, the Draconic Host section) fields two elites,
and both signatures ride the **shared warning** (`HeroSkill.prepares`): the cast fixes the footprint and pays the
cooldown through `castPrepared`, and the landing is the ordinary resolver over the warned ground
(`preparedResolve`), so no encounter script is involved. What the generic AI could not do is want them, so
`systems/combat/draconicHostAI.ts` (`draconicHostSkillValue`, one call in `enemyAI.evaluateSkill` after the
frozen-north elites') scores each on what it would catch, above an at-will whenever it catches anybody. The whole
kit, regular members included, is `data/skills/draconicHostSkills.ts`; every tunable is `BALANCE.DRACONIC_HOST`;
the suites are `draconicHostElites.test.ts` (rules, and both elites fought to the end) and
`world/draconicHostFaction.test.ts` (roster, placement, the AI's use of every kit, the jade's contrast).

- **Oni Warlord: Warlord's Doom (`warlords_doom`)** — a telegraphed Doom. He brands a radius-`DOOM_RADIUS` circle
  round a hero within `DOOM_RANGE` (`doomAim`: the circle catching the most heroes not already Doomed, then the
  weakest). Every hero in it owes a window; a Stun, Silence or Freeze on him breaks it. Whoever still stands in it
  when it lands takes a Doom of `DOOM_DAMAGE` x his Attack for `DOOM_TURNS` (2: one turn to cleanse it before it
  bursts). Three answers, in order: leave the mark, interrupt him, cleanse. He never brands a circle where every
  hero is already Doomed. His **Two-Handed Sweep** is a depth-2 arc on a `SWEEP_COOLDOWN` rest (the arc rule:
  only an elite's plain at-will may be an arc with no cost), beside a single-target at-will blow.
- **Daitengu: Great Gale (`great_gale`)** — a wind in an arc that pushes, announced a round ahead. The wedge
  (depth `GALE_DEPTH`, aimed by `galeAim` at the most heroes) is fixed at the cast and the board draws where each
  body will land (`warnedPushes`); a Stun, Silence or Freeze breaks it. It lands as `GALE_DAMAGE` x Magic and a
  shove of `GALE_PUSH` hexes from where he stood. **Hush of the Peaks** Silences one hero for their next turn on a
  `HUSH_COOLDOWN` rest, out-hitting his at-will Gale Cut so the AI presses it.
- **The warning banner** says what each does and how to answer it, in the move's own words (`warning.move.<id>`). Both are the
  shared violet footprint: the Doom a small circle round a hero, the Gale a wedge with push arrows.
- **The regular members.** The Oni Brute's every blow shoves (Kanabō Blow a hex, Oni Crush two; it carried a
  collision Stun until the measurement below); the Wyrmling bites and its Jadefire Bite Burns; the Karasu-Tengu
  throws feathers (drawn as thrown blades, `THROWN_BY_SKILL`) and Crow's Flit throws and retreats three hexes; the
  Raijū's at-will is a jade spark and its Raijū Chain leaps to two more heroes and Shocks each. The Brute leads
  (`formation: 'line'`); the Tengu, the Raijū and the Daitengu keep behind it.
- **The orb's light is jade.** Every Host effect is drawn in `JADE_LIGHT`, `JADE_STORM` or `JADE_GALE`, each 3:1 or
  more by value over every green arena and Jadeveil tile, and nothing is ember orange (the Empire's look).

### Measured

The eliteFights party (four AI-played heroes at level 5 x 1.6, which never steps out of a warning or cleanses), 20
runs each, 2026-10-15: the Warlord alone and the Daitengu alone 100%; the Warlord with a Rime Giantling 75%, against
45% for the Rime Jarl with one; the Daitengu with an Oni Brute 100%; the Warlord with an Oni Brute 0%. The first
numbers (a Brute at 104 health and a collision Stun, a Warlord at 185 with a sweep on a one-turn rest) lost every
pairing, so the Brute came down to a Giantling's weight and lost the Stun, and the Warlord's sweep, Doom and speed
came down. To verify in playtest: the Warlord-and-Brute pairing, which this party never wins; whether a party that
leaves the mark finds the Doom fair; and how often the Gale's shove breaks a party's formation.


## The Fallen Order: the Monk's disciplines, fought

Jadeveil's monks (the private project notes; **the board task supersedes the brief** where they
differ: the Beetle Warden has no Taunt, the Mantis Adept no Thorns aura, and the Abbot changes no stance through
`forms.ts`). Every member fights in one of the Monk's disciplines, and the kits are the Monk's own machinery spelled
for the enemy side. Skills are `data/skills/fallenOrderSkills.ts` (enemy-only ids, no chi), numbers
`BALANCE.FALLEN_ORDER`, pure rules `systems/combat/fallenOrderKits.ts`, the one board rule
`systems/combat/scripts/fallenOrder.ts`. Suites: `combat/fallenOrderElites.test.ts` (behaviour through the real AI
and resolver) and `world/fallenOrderFaction.test.ts` (roster and placement).

- **Beetle Warden** guards by standing between, never by a Taunt. *Shell Bastion* (`warden_bastion`) is the
  Beetle's Carapace Bastion on the enemy side: its hex and the six round it, for two of its turns, and a monk
  struck inside takes half while the Warden takes the rest (`beetle.bastionCover`, side-agnostic). It reacts
  through `retaliation`: a share of every blow it takes, a monk's half included, goes back at the striker. It
  leads (`formation: 'line'`). The AI plants the Bastion only with a monk beside it that a hero can reach.
- **Mantis Adept** moves and bleeds: an at-will cut that lays Bleed, *Flicker Cut* (`blinksBehind: 'first'`: in behind
  the hero, then the cut, a flank or a backstab under the facing rule; the Abbot's *Mantis Lesson* too) and *Pounce* (four hexes).
- **Chain-Sickle Monk**, ranged: the kusarigama at three hexes with a quarter chance to Root, and *Chain
  Snare*, a certain Root of two ticks on a cooldown.
- **Firefly Chanter**, caster: *Lantern Mote* (the Glowmote's `mote`: its bolt mends the most hurt monk near it)
  and *Lantern Hymn*, a ring of two that heals and lays a Barrier — no damage, so it is the AI's support branch
  (`supportValue` and the ring's healing) that casts it. It keeps behind the Warden.
- **Order Novice**, the chaff, is met **only in the band-2 Ambush** (`Faction.chaffShapes`: in any other shape a
  chaff slot resolves through `membersForRole`'s fallback and a shape that `requires` chaff is not offered, so
  band 3's Raid is withheld from the Order).

**Fallen Abbot** (elite) carries one technique of each discipline in one kit, and no form: the Beetle's *Iron
Palm* and *Vow of the Shell*, the Mantis's Flicker Cut (*Mantis Lesson*) and the Firefly's Glowmote (*Firefly
Lesson*). The Vow is the Beetle's Vengeful Shell (`interceptAlly`, reach two, two answers a round, three turns): a
single-target blow at a monk within two hexes of him is taken by the Abbot, who leaps beside them and strikes
back. **The decision it sets:** while the Vow stands, picking his monks off one blow at a time feeds him — strike
him, hit them all at once (an area blow is never taken), or fight them out of his reach. The AI swears it only
when a monk within its reach has a hero within four hexes.

**Bell-Keeper** (elite) tolls and rings. *Toll of Passing* (`toll_of_passing`, reach four, every fourth turn)
lays a Doom on the hardest hitter in reach — `TOLL_DOOM` × its Magic, two turns to answer — and **the Doom is the
Keeper's own**: between turns, any Doom whose source is a fallen Bell-Keeper is lifted
(`fallenOrderKits.liftedDooms`, logged "the bell is silent"). *Great Ring* is an announced ring of two round it
(`prepares`, one window; a Stun, Silence or Freeze on the Keeper breaks it) that damages and Stuns whoever is
still inside. **The decision it sets:** the toll is a clock on the Keeper's life — kill it, cleanse, or take
the hit — and closing on it to beat the clock is standing where the ring will land.

The AI scores the four signatures that deal little or nothing at the cast — the Bastion, the Vow, the toll and
the ring — on the problem each sets (`fallenOrderSkillValue`, one hook beside `factionEliteSkillValue` in
`enemyAI.evaluateSkill`), and returns `null` when a cast would do nothing; every other single-target cooldown
skill out-damages its owner's at-will, so the damage score presses it. The review fields both elites
(`encounterReview.ts`: the Abbot with a Warden, the Keeper with a Chain-Sickle Monk) and a prepared party
beats each at Hard.

**To verify in playtest:** the toll's Doom (`TOLL_DOOM` 2.2 × Magic) against a band-2 party that has no cleanse;
whether two turns is enough to reach and kill a Keeper behind its ring; the Vow's two answers a round against a
Monk-less party; the Hymn's heal and Barrier on a Warden that is also splitting blows; a Patrol of two monks
at band 1, where other factions field a chaff body.

### The Last Lesson: the Silent Hall's boss (Jadeveil: Silent Hall / Fallen Order)

The Fallen Order's lair boss (the private project notes): a blind old master behind the Silent
Hall's door (`lair_hall`, gate 92). Kit and phases `data/templates/lastLesson.ts`, numbers `BALANCE.LAST_LESSON`,
pure rules `systems/combat/lastLessonRules.ts`, what the resolver tells him `systems/combat/lastLessonWatch.ts`,
his script `systems/combat/scripts/lastLesson.ts`. Suite: `combat/lastLesson.test.ts`.

His fight is two rules about what the party does; his own kit is modest — *Walking Staff* (at-will, reach one)
and *Pilgrim's Step* (`blinksBehind: 'after'`: a blow, and he stands behind its target) — chosen by the ordinary AI.
He is `immovable`.

- **The same mistake.** Every party unit's own cast (not a landing warning, an echo or a Reaction's answer) is
  remembered per regular turn: `history[id].now` is this turn's skill, and a regular turn beginning moves it to
  `last`. A cast whose skill is the one its caster used on its **previous turn** is **parried** wherever it
  reaches him — each blow deals nothing, floats PARRIED — and a **riposte** is owed (once per cast). A different
  skill, a skill skipped for a turn, or a repeat aimed elsewhere is not punished. The check is
  `resolveSkillUse`'s, before the cast (`lessonParries`), and it is written after a cast that went through.
- **The lessons.** At the start of his regular turn, before any hero after him acts, he **names the round's
  lesson** — in the log, as a status over his head and as a line on the warning banner
  (his `lessons` in `bossReadout`, worded by `bossReadoutText.lessonWarnings`, with the repeat rule under the first) — and it stands until his next regular
  turn. They come in a fixed order, one step a round: **Face Your Master** (a blow from his back or rear sides,
  `flankOf` `back` or `side`, is rebuked), **Stillness** (a unit that ends its turn more than `STILLNESS_HEXES`
  from where the turn began), **Patience** (the first blow to land on him that round — any party unit, so a
  summon can spend it for the party) and **Keep Your Distance** (a unit that ends its turn beside him). Each
  breach owes one **rebuke**, at most once per lesson per unit a round. Below `FINAL_THRESHOLD` health he
  enters *The Last Lesson* (`keepsScript`, his memory carries over), names **two** lessons a round and hits
  `FINAL_POWER` harder.
- **When he answers.** Blows are judged as they land (Face, Patience); turns are judged between turns, once
  the turn is over (Stillness, Distance). Every owed riposte and rebuke is struck between turns, before the
  next unit acts, at any reach (`lessonRiposte`, `lessonRebuke`, through `resolveSkillUse` resolving).

**The decision it sets:** vary what each hero does every turn, read the banner before acting, and choose who
takes the round's first blow. No lesson is a tax the party must pay: each is kept by a choice (attack from
the front, stay put, lead with a summon or a durable hero, hit and step away).

**To verify in playtest:** his stat block (2,700 health, 46 attack — the strongest lair boss by
`lairBosses.test.ts`'s weight) against a gate-92 party; the riposte (1.5 × Attack) and rebuke (1.3 × Attack);
Stillness's two hexes against melee heroes who must close; whether two lessons at once in the final phase stay
readable on a landscape phone.


## The Yokai (Jadeveil): rank and file, the Nue, and the Jorōgumo's web

The Yokai of the low forest are Jadeveil's own at bands 0–2 on forest and plains
(the private project notes; `Faction.worlds: ['jadeveil']`). The kit is `data/skills/yokaiSkills.ts`
(spread into `ELITE_SKILLS`), every number a `BALANCE` constant, and the suites are `yokaiFaction.test.ts` (the roster, its
ground, its shapes, and each member doing its row), `nue.test.ts` (the Nue's rules) and `jorogumo.test.ts` (the web and the
canopy weaver, pinned as rules). Since the shrine campaign (the private project notes) the **Nue** is the
roaming elite and the **Jorōgumo** is the Silk Hollow's boss, met there and nowhere else.

- **Kodama** (chaff): weak and quick; its Rattle shoves the hero a hex (`pushDistance` 1), the first fight's lesson
  that where a hero stands is something the enemy can change.
- **Kappa** (front): Shell Bash at will; River Grapple Roots for 2 at `KAPPA_ROOT_CHANCE` (40%) and out-damages the bash,
  so the AI presses it.
- **Tanuki** (front): Belly Slam, and the passive **Tanuki's Trick** (`tanukiTrick`): struck by an enemy and still standing,
  it is laid `Stealth` for `STEALTH_DURATION` (laid in `damageFunnel`, the one place every blow passes). A single-target hit lands,
  then it is out of reach of anything aimed at it alone until its next turn; area blows still find it.
- **Onibi** (ranged): Foxfire at range 4, magic, and a Burn that stacks with every throw (the shared Burn pile).
- **Kitsune** (caster): Fox Flame at will; Hush silences for 2 turns and ends with a two-hex retreat (`selfMove: retreat`).
- **Nue** (elite, `factions.ts` `yokai.roles.elite`): a chimera in a black thundercloud, 160 health, 16 attack, 14 magic.
  Tiger Claws at will, and **Black Thunder** (`nue_black_thunder`, cooldown `NUE.THUNDER_COOLDOWN` 3): a ring round itself
  for `NUE.THUNDER_DAMAGE` (1.3) x Magic, after which the cloud closes over it — `Stealth` for `STEALTH_DURATION`, laid by the
  Yokai script's `afterCast` (`yokaiActions.cloakNue`), so only an area blow finds it until its next turn. Two passives, both
  played at its own turn start by `yokaiActions.beginNueTurn`: **Thundercloud** (`nueThundercloud`) Shocks every free hero
  beside it for `NUE.SHOCK_TURNS` (2), and **Serpent Tail** (`nueSerpentTail`) strikes the hero standing on the hex
  **directly behind it** (`hexesBehind(nue)[0]`, opposite its facing; the two rear-side hexes are safe) with Serpent Tail
  (`nue_serpent_strike`, `NUE.TAIL_DAMAGE` 0.9 x Attack and a `NUE.TAIL_POISON` dose) through the shared resolver. Neither
  costs it its turn. The read: do not end a turn beside it, and do not end one straight behind it. Verify in playtest.
- **Jorōgumo, the Canopy Weaver** (the Silk Hollow's boss): Venom Fangs (a Poison dose) and Silk Snare (Root, 2) between
  webs once she is on the board, Canopy Venom while she hangs, and her signature, below.

### Jorōgumo: Silk Shroud (`jorogumo_web`) and Widow's Kiss (`jorogumo_bite`)

The rules are pure in `systems/combat/yokaiKits.ts`, put on the board by `yokaiActions.ts`, and turned by
`src/systems/combat/scripts/yokai.ts` (registered last in `scriptRegistry`).

- **The cycle.** Her regular turns run **web → bite-or-attack → attack**, round and round (`nextSlot`, kept in
  `bossScript.step`/`phaseTurns`). A web turn whose volley cannot be cast (nobody within `JOROGUMO_WEB_RANGE`, a warning
  still standing, a Taunt on her) keeps the slot: she fights or closes, and webs on her next turn. A stunned turn is not a turn.
- **The volley.** She webs one hero on her first volley, two on her second, then three and four
  (`JOROGUMO_ESCALATING_VOLLEYS`), and from the fifth every hero she can — **always leaving at least one hero free**
  (`volleySize`), so the party never has nobody to answer. She takes the hardest hitters within reach.
- **The web** is an attackable objective (`WEB_KIND`) with **1 health** and no defence on the hero's hex, put at the front of the
  roster so a hero's attack on that hex finds it (`combatStore.spinWeb`). The hero is `Webbed`: held out of the fight as
  `Encased` is (no turn, no harm, no new afflictions, statuses held; `isSealed`). **Any hit cuts it, and so does an area
  blow that catches its hex** (the hero inside, the attacker's ally, is untouched); destroying it frees the hero at once
  (`damageFunnel` → `freeFromWeb`).
- **The warning.** The volley announces the bite through the shared warning (`castPrepared`, `scripted: 'web'`) over every
  webbed hero's hex — new webs and any left from before, which it re-binds — **owed a turn by every free hero** and never by
  a webbed one. The banner names who is held and says she dashes to them and bites on her next turn, how to cut a web
  (1 health, any hit or area blow) and that a Stun or Freeze on her breaks it (`interruptedBy`). Each web binds the warning
  with `cancelsOnLast`: cutting the last web calls the bite off. **It never lands in the round the web was spun**: it lands
  from her turn start only once every free hero has had a turn since (`isPreparedDue`).
- **The bite** (`landBite`): among the heroes a bound web still holds, the one with least health left (then nearest),
  is taken out of the web; she dashes to the nearest free hex beside them along free ground and bites: `JOROGUMO_BITE_DAMAGE`
  (7) x Attack, physical, through the shared resolver, and a heavy Poison dose (`JOROGUMO_BITE_POISON`). Rooted and not
  already beside them, she cannot reach and the bite is lost. One bite a turn: other webs stay, still holding their heroes,
  and her next volley warns of them again. With every web cut her bite turn is an ordinary attack.
- **A web gives way** (`releaseStrandedWebs`, between turns) when its owner has fallen, its hero is gone, or no hero is left
  free to answer it; and it goes with her when she dies (`retireOwned`).
- The web is drawn as a pale silk cocoon over the hero with a faint light (`SilkCocoon`), and the hero carries a Webbed badge.

### Jorōgumo, the Canopy Weaver: the Silk Hollow's boss

The designer's direction for the lair boss (the private project notes): she hangs off the board on threads, and
cutting them drags her down. Template `jorogumo` (tier `boss`; phases in `data/templates/jorogumoWeaver.ts`, registered in
`bossPhases.ts`); the opening is her `bossRegistry` entry's `arrange`, the rest the same Yokai script as above. The web cycle
above is the core of both phases.

- **The Canopy** (phase 1). The fight opens with her over her **perch** (`weaverPerch()`, `JOROGUMO_WEAVER.PERCH_Q/R`, the
  back row) under `AuraType.Suspended`, and **three Silk Threads** (`THREAD_KIND`, objectives with `JOROGUMO_WEAVER.THREAD_HP`
  (6%) of her max health, no magic defence) on the ring `JOROGUMO_WEAVER.THREAD_RING` (3) round the perch, spread as far
  apart as the board allows (`threadSpots`). While she is Suspended **nothing can aim at her, harm her or afflict her**
  (`isHiddenFrom`, `isHeldFromHarm`, the store's affliction refusal), but she takes her turns. She never walks; her web
  reaches every hero (`webReach`); her attack between volleys is **Canopy Venom** (`canopy_venom`, range 12,
  `JOROGUMO_WEAVER.VENOM_DAMAGE` 1.1 x Attack and a Poison dose). Her bite warning is `HUNG_BITE`, which a Stun or Freeze
  cannot break (nothing reaches her): **cutting the webs is the only answer**, and the banner says she *drops onto* them.
  The bite (`dropAndBite`) sets her down beside the webbed hero (`dropHex`, no path needed), tears them out of the web and
  bites; she stays Suspended and out of reach, and **climbs back to her perch between turns** (`climbBack`).
- **Dragged Down** (phase 2). The threads carry `onLast: 'release'`: the **last thread cut forces her second phase**
  (threshold 0, never by health). Entering any phase that does not keep the script lifts `Suspended` (her registry entry's `onPhase`, asked by `enterPendingPhase`),
  her warning in flight is dropped, and the cycle restarts at one web. She fights on the board with Venom Fangs, Silk Snare
  and the web, her Attack x `JOROGUMO_WEAVER.GROUND_POWER` (1.15); the bite is the dash above again, and a Stun or Freeze
  breaks it.
- **The threads tear at her** (boss feel pass, 2026-11-03). Each Silk Thread carries a `backlash` of
  `JOROGUMO_WEAVER.THREAD_BACKLASH` (5%) of her maximum health, paid through the objectives' backlash path (the Standards'
  and the Furnace Heart's, `damageFunnel.objectiveFell`) with `throughSuspension`: a restraint's backlash is the one harm
  `Suspended` does not hold off, so every cut is a step toward her while she still hangs, and the last both costs its share
  and drags her down. A web carries none. The passive, the Canopy's rule and the briefing (`jorogumo.chance2`) say it.
- **Canopy Venom seeks the farthest from the threads** (same pass). While any thread stands her attack turn spits at the
  hero standing farthest from every standing thread (the shortest walk to any), then the one with less health left, then
  the lower id, among the heroes it can reach (`venomTarget`, the Yokai script's `decide`; a Taunt still turns it). The
  sentence is `bossSkills.canopy_venom.target` (in `TARGET_RULE_IDS`, pinned in `targetRules.test.ts`) and the briefing's
  `jorogumo.danger4`; standing by the threads is the safe place. Once the last thread falls she is on the ground, where her
  attacks are the ordinary scoring.
- **Stats**: 1,900 health, 44 attack, 20 magic, `bossDefences(15)`, speed 10, `immovable`; Widow's Kiss is now
  `JOROGUMO_BITE_DAMAGE` **3** x her Attack (it was 7 on the 16-attack elite). Her weight (`maxHp + 5 x max(attack, magic)`,
  2,120) sits just over the Heart of Winter's 2,035, as `lairBosses.test.ts` orders the gates (84 after 39), leaving room for
  the Silent Hall's boss above her.
- **Drawn**: hung `HANG_LIFT` (1.4) above her hex in the arena with her three threads carried on up out of view
  (`HangingSilk`); each Silk Thread a thick pale rope staked to the floor in a knot of web, running up out of the arena with a
  faint light (`SilkThread`). Evidence: the private project notes.
- **Pinned** (`jorogumo.test.ts`, *the canopy weaver*): she opens on her perch with three threads, untargetable, unharmed and
  unafflicted; webs a hero beyond `JOROGUMO_WEB_RANGE`; never moves while she hangs; drops beside the webbed hero, bites, stays
  out of reach and climbs back; stays up with one thread left and comes down with the last; and restarts the cycle on the
  board. A Stun does not break the hung bite, and does once she is down. Each thread cut costs her its backlash while she
  hangs and the last also drags her down; a web cut costs her nothing; her attack turn from the canopy spits Canopy Venom
  at `venomTarget`'s hero.

To verify in playtest (2026-10-16, first estimates): her 1,900 health and the 6% threads against a party at the gate; whether
Widow's Kiss at 3 x a boss's Attack still takes most non-tanks from full health and no more; whether an untargetable first
phase with only threads and webs to hit reads, or wants a counter on the threads.

**As looked at** (web build from the worktree, `BATTLE_SET=elites`, state `web`, 844×390 at 2×, 2026-10-15, no page errors): the
second volley webs the Druid and the Arcanist; each stands in a pale cocoon under a red enemy bar reading 1, the warned hexes
are lit under them, and the banner reads "Jorōgumo: Widow's Kiss — waiting on Champion, Hunter · Druid & Arcanist are webbed
and cannot act. On her next turn she dashes to one of them and bites for heavy damage: cut each web (1 health — any hit, or
an area blow that catches it) to free them, or Stun or Freeze her", over the acting Champion's free turn.

**Measured** (encounter review, the Jorōgumo with a Kodama against the quad at level 10; and `calculateDamage` of the bite
against the review's geared heroes). The bite at band-2 scale (×1.25) takes 171–182 off a level-5 Hunter, Arcanist or Druid (141,
125 and 165 health) and 133 off the Champion (228); at level 7, 197–217 against 169–197 and 153 against 280: it takes most
non-tanks from full health and leaves a tank standing. The prepared party, which cuts webs, won 8 of 8 at Easy and at Hard
in 3–4 rounds with no bite landing; the plain party, which does not, won 8 of 8 too but landed 16 bites in 8 Hard fights
for two hero deaths a fight, over 12 rounds.

The measurement above is of the Jorōgumo as she was, the 150-health roaming elite with a 7 x Attack bite (2026-10-15); she
left the roaming roster for the Silk Hollow on 2026-10-16 (the section above). To verify in playtest:
- whether the Tanuki's Stealth after every hit makes it too slippery for a party without area damage;
- whether Kappa's 40% Root and the Kitsune's Silence together are too much control at band 1.

## Kairen, the Cloud-Crowned: the summit's three weathers (Jadeveil)

Jadeveil's last fight, on the Cloud Crown (the plan agreed with the designer: the private project notes).
`systems/combat/kairenRules.ts` (pure — every footprint, the chooser, the HUD lines),
`kairenActions.ts` (store-writing — raising each warning, the weather between phases, the storm, the brood, landing) and
`systems/combat/scripts/kairen.ts` (the `EncounterScript`). The skills and the three phases are `data/templates/kairen.ts`; every number
is `BALANCE.KAIREN`. Template `kairen` (tier `boss`, `immovable`, `bossDefences(20)`, move range 2); the fight's encounter
is `summit_kairen_<tier>` (`systems/world/summit.ts`, see *world*). **No Emerald Dragon move is reused.**

- **One hex.** The engine has no multi-hex units, so Kairen is an ordinary boss on one hex, his model rearing out of a
  loop of his own body there. **Nothing of his lies on the board**: the summit is open ground, and the cliff edge and the
  bodies on it are all that stop a push. (Solid coil scenery across the arena, one layout a phase, shipped first and was
  removed at the designer's request on 2026-10-16 after seeing it in game: it carried no mechanic worth its board.) His
  footprints still leave out any solid hazard (`solidKeys`), so a future one cannot be warned under.
- **Jade Taint** (`AfflictionType.JadeTaint`) stacks one a dose to **three** (`STACKING_MAGNITUDE`); it never decays and
  **no cleanse reaches it** (`statusEffects.UNCLEANSABLE` / `isCleansable`, read by `removeAllAfflictions`). It does nothing
  on its own: it multiplies Verdant Judgement. Drawn as three jade diamonds over a hero's bar, larger with the count
  (`UnitMesh.TaintPips`, from `bodyPictures.taint`), three under the turn-order portrait, and its count on the status row;
  each change floats once over the hero, `+TAINT n/3` or `CLEANSED` (`sayTaint`, between turns).
- **Every phase.** **Coil Lash** is his repeatable blow: an arc of depth 1 that knocks back a hex (`LASH_PUSH`), made only
  for a hero beside his head. **Orb Bolt** (range 7, magic) gives **+1 Taint** to the hero in reach carrying the least
  (`orbBoltTarget`), so the taint spreads; from tier 2 one bolt strikes the two carrying the least (`orbBoltTargets`,
  `castOrbBolt`, below). Taunt changes where the lash and the first bolt go and nothing else. **Cloud Dive** (warned): he rises
  into the clouds (`AuraType.Aloft`, held from harm and unaimable like `Suspended`, drawn lifted) and the warning is the
  full line across the board that crosses the most heroes (`divePlan`, his hex and any solid hex left out); it lands at the line's
  far end (`diveLanding`: the nearest free hex back along it if a body stands there), strikes the line, and leaves him
  **Exposed** (+25%, `EXPOSED_TURNS` 2 of his turns — one full hero window). Every `DIVE_GAP` (4) turns, `DIVE_GAP_TEMPEST`
  (3) in the last phase.
- **Gale** (phase 1). **Gale + Downdraft** is one warning: the wind's direction (east, then west each time, `windFor`) and
  distance ride on the warning (`PreparedAttack.wind`, `windDistance`); its `hexes` are empty — the wind is everyone's —
  and its `landing` is the **Downdraft rows**, the last `DOWNDRAFT_ROWS` (2) hexes of every line downwind
  (`downdraftHexes`). `previewPrepared` traces the wind for every body but him and the objectives (`windMoves`: furthest
  downwind first, each through `traceForcedMove` from a step upwind of it, so bodies and the cliff edge stop it),
  and the same trace lands it, so the push arrows are the landing. The Downdraft then strikes whoever the wind left on its
  rows; the banner names them. The answer: move upwind first (`GALE_ANSWER`). Every `GALE_GAP` (3)
  turns from the phase's second.
  **The shelter, said** (boss feel pass, 2026-11-03; no rule changed): the wind always stopped at a body, so a hero
  standing just upwind of a body that holds where it stands — Kairen, a Jade Shard, or a line packed against the cliff
  edge — is kept off the Downdraft. `galeSheltered` names the heroes whom the wind, alone on the board, would carry onto
  the rows and whom the landing leaves off them (`PreparedPreview.windSheltered`, read from the same `windMoves` the
  landing runs). They are drawn in the support colour where they will stand (`boardOverlays.shelterGroupHexes`) and
  named at the end of the Gale's tail ("held off the edge by a body: …", `bossLog.kairen.tail.galeSheltered`); the
  briefing's first tip says the rule. To keep the line inside the folded boss panel (its 40-point scroll), the Gale's
  plate drops the generic push count and the Smash's "no throw" note, which its own tail says in other words.
- **Thunderhead** (phase 2). On entering it he calls **Brood of the Orb** at once: `broodCount(tier)` (6 + tier − 1)
  `brood_wyrmling` summons (the field Wyrmling at `BROOD_HP` 30% health and `BROOD_ATTACK` 60% attack, whose **Tainted
  Bite** gives +1 Taint), spread round the arena and never beside a hero (`broodSpots`). **He cannot call
  another while any wyrmling of the last lives**, nor sooner than `BROOD_GAP` (3) turns after it (`canBrood`); it recurs
  in phases 2 and 3. **The storm**: at the start of each of his turns in the phase, the marks warned last turn strike and
  `THUNDER_MARKS` (4) new ones are marked a round ahead (`stormMarks`: one beside him nearest the party, then a step from
  each hero, most tainted first; never on his hex or another body), as `kairen_storm` warnings the whole party
  owes. The storm is his weather, not his action: his `beginTurn` lands it before anything else and it never spends his
  turn. A hero struck takes a bolt and **loses all Taint**; a bolt drawn beside him by a hero standing there leaves him
  **Exposed**. **Verdant Judgement** (warned, `everyone`, no hexes) strikes every hero for `VERDANT_BASE + VERDANT_PER_STACK
  × Taint` of his Magic (`verdantMultiplier`; the banner lists each hero's count) — the answer is a lightning mark first.
  Every `VERDANT_GAP` (4) turns from the phase's second. The storm's marks are drawn cold (`frost` tone), apart from the
  violet of his warned moves.
- **Jade Tempest** (phase 3). The storm stops; **every orb move gives the full three Taint** (Jade Orb Bolt, Orb Nova).
  **Orb Nova** (warned, `everyone`) rings him two to three hexes out (`novaRing`); it leaves up to `SHARDS` (2) **Jade
  Shards** (`SHARD_KIND`, 1-health objectives) on free ring hexes nearest the most tainted heroes, kept three apart
  (`shardSpots`), and at once raises **Verdant Judgement** a window later — a hero turn to reach a shard. **A shard broken
  clears all Taint from every hero beside it; only the unit that broke it takes its burst** (`shard_burst`, a bolt's
  damage; `combatStore.breakShard`, called from `damageUnit`'s objective funnel), so a tank can break it in melee while a
  ranged breaker from afar takes the burst and no cleanse. Nova every `NOVA_GAP` (4) turns from the phase's second.
- **Rules, not a rotation** (`chooseKairenMove`): each phase's warned moves are on offer from their first turn of the
  phase and their gap after the last, the phase's own first; **never while another of his is open** (`MAJOR_WARNINGS`; the
  storm's marks ride beside them, so his warnings are cast by `castKairenWarning` and not `castPrepared`'s one-at-a-time
  refusal); then a brood; then the lash or the bolt. His counters are `KairenMemory` (`bossScript.kairen`), which
  **survives a phase change** (his registry entry's `onPhase`), so the brood, the gales and the phase the board was last put right for (`boardPhase`, which
  says the weather turning once and calls the brood on entering the Thunderhead) carry across. A phase change moves nobody. A phase
  change clears his warnings, as every boss's, and lifts `Aloft`.
- **Weather in the air**: the arena's atmosphere follows his phase (`kairenWeather` → `KAIREN_ATMOSPHERE`: a torn-cloud
  `gale`, the wrath `storm`, a jade `jadeTempest`). The boss readout adds the tier (from 2), the weather and "Exposed +25%"
  (his summary facts in `bossReadout`).
- **Exempt from wrath's power**: `encounterPowerScale` prices a summit encounter by its tier alone (`summitTierScale`),
  never `wrathPower` — he is only fought at a full bar — while the vows still bless the party.
- **Stats**: 5,200 health (4,000 until the playtest of 2026-10-23 raised the Emperor), attack 72, magic 66 (Aethelred 5,600 / 53 / 48, his health compared as the castle fields it, at `CASTLE_HP_SCALE`), `bossDefences(20)`, speed 10. **Measured
  against the Emperor as each is fought** (`kairenStrength.test.ts`: the same party level, each encounter's own power,
  every phase's stat multipliers averaged over a fight spent a third in each — Aethelred's phases lift his Attack and
  Magic by about a sixth, Kairen's do not): health ×1.28, Attack ×1.27, Magic ×1.20, about **×1.26** as the geometric
  mean of health and damage — the plan's 25–30%. At level 25 that is 18,400 health against the Emperor's 14,352. It
  was ×1.19 at 3,900 / 66 / 60 before the measurement. Verify in playtest. His blows sit
  near the Emperor's own multipliers on a quarter more Attack and Magic (`LASH_DAMAGE` 0.9, `DIVE_DAMAGE` 1.4,
  `DOWNDRAFT_DAMAGE` 1.3, `ORB_BOLT_DAMAGE` 0.8, `THUNDER_DAMAGE` 0.6, `NOVA_DAMAGE` 1.0); Verdant Judgement is 0.25 +
  0.42 a stack. The first headless capture (2026-10-16) had 0.75 a stack, which killed a full-health Champion at three;
  it is now tuned to leave a level-25 caster a sliver.
- **Storm Seal tiers** scale his health and damage ×(1 + 0.2 × (tier − 1)) and add one twist each, every tier keeping
  those below it (`summit.twistsAt`): **2** the Orb Bolt strikes two heroes, the two carrying the least Taint, each +1 (+3 in the Jade
  Tempest; `ORB_BOLT_TARGETS_TIER2`, `orbBoltCount`: the script's `cast` resolves the chosen bolt and a second a beat
  later, both chosen before the first lands), **3** the Gale pushes
  two hexes (`galeDistance`), **4** the storm strikes twice a round — two mark sets (`castStorm`), **5** the Gale returns in
  the Jade Tempest (`chooseKairenMove`); the brood grows by one a tier. The tier rides on the boss
  (`CombatUnit.challengeTier`, set by `buildEncounter`), so a resumed fight keeps its twist.
- **Model**: `MODEL_DEFS.kairen` is his own builder (`voxel/models/kairen`, `KAIREN_SCALE` 1.48): a **world-final boss**,
  the Emperor's peer, standing his height on the board (crown 4.93 against 4.94, front area 9.79 against 9.31; the loop on the ground drawn in to
  keep to about his hex, `KAIREN_LOOP_SQUEEZE`; see *model-rebuild-gate*). His rig holds the orb as a
  staff-like focus, so `enemyBlows` lists his blows as built in (natural). The brood alias the Wyrmling (0.85).
- **The arena** is the summit's own, not the mountain's: the fight is a world context carrying `site: 'summit'`, which
  `compositionKeyFor` resolves to the `summit` layout (*world*, *The summit*): a karst peak top falling away into the
  cloud sea on every bearing, so the cliff the push stops at is the arena's edge.
- **Pinned** (`kairenFight.test.ts`): the opening on open ground; a phase change that moves nobody; Taint
  capped at three, laid by the bolt, never decaying, beyond a cleanse; Verdant scaling with it; the Gale's arrows equal to
  where the bodies land and the Downdraft striking exactly those the wind left on its rows; the edge and a body stopping
  the wind, two hexes from tier 3, and safe ground always left; the preview's sheltered heroes being exactly those the
  landing leaves off the rows that alone would have been on them (a line packed at the edge, a hero upwind of him), drawn
  where they stand and named on the banner; the dive's line, his landing at its far end and the
  exposure; the storm's marks off his hex, a struck hero cleansed, the lightning rod, two sets at tier 4; the Nova's ring,
  two shards and the Judgement after it; a shard cleansing those beside it and bursting only into its breaker; the brood's
  count, its bar on a living wyrmling and its gap, the bite's Taint; the bolt striking one hero in the story fight and the
  two least tainted from tier 2 (+3 each in the Jade Tempest); no warned move while one is open; wrath never reaching
  him; and a whole headless fight through all three phases with one warned move open at most. `kairenSummit.test.ts` and
  `summitSave.test.ts` pin the summit's door, the first kill and the ladder (see *world*).

**As looked at** (the web build from the worktree, harness `kairen(...)`, 932×430, 2026-10-16, no page errors; captures in
private captures): the Gale's violet push arrows run east from every hero with the Downdraft's two downwind
rows lit in the attack colour along the east edge, and the banner folds the wind, the Downdraft's names and the answer
into the folded banner (the first copy ran past it at 932×430; every Kairen line was cut to the warning and its one
answer). The dive's line is a violet row across the arena; the Thunderhead's four marks are pale blue outlines under
rain, the brood's six bars along the top rim; three jade diamonds stand over a three-Taint hero's bar and under its
portrait; in the Jade Tempest two shards stand in the ring with Verdant's line naming each hero's Taint. Landed through
the scene's own turn driver, the Gale moved every hero to its arrow and the Downdraft struck the three it named; the dive
struck the three on its row and he landed Exposed at the far end. Recaptured after the coils were removed and he grew to a world-final boss (2026-10-16,
private captures): the summit is open ground; the Gale's banner ends "— go upwind"; on the whole-board camera
with him on (0,1) and heroes in front, beside and behind, he stands the Emperor's height taken the same way, the hero in
front and the two beside him in full view and the one behind under his neck with its bar drawn over him, as behind the
Emperor; the lash's lunge and the orb's cast play whole at the new size, and a tier-2 Orb Bolt struck the two heroes
carrying no Taint.
The shelter readout (2026-11-03, the web build from the worktree, harness `kairen({ at, warn: 'gale' })` with the Champion
on the east edge (3,0), the Arcanist at (2,0), the Druid at (1,0) and the Hunter open at (−2,2), 844×390 and 932×430 in
English and Polish, no page errors; captures in private captures): the Druid's hex carries the
support-colour ring, the Hunter's violet arrow runs east, and the folded boss panel holds the whole line — "Gale · Waiting
on Champion, Arcanist, Druid, Hunter · wind 1 east, Downdraft on the edge (Champion, Arcanist) — go upwind · held off the
edge by a body: Druid" in three lines at 844×390; the Polish line ("… – przejdź pod wiatr · osłona przed krawędzią:
Druid") also in three, its last line at the panel's lower edge at 932×430. Before the plate dropped the push count and
the "no throw" note for the Gale, the same board ran past the fold at 844×390 in both languages.

To verify in playtest (first estimates): the 12–15 round target for four level-25 heroes; Verdant's three-stack hit
against the party's real health; whether two shards and four storm marks are enough answers; whether the Downdraft at 1.3
is fair for a squishy pinned at the edge; whether the cumulative tier twists (each tier keeps those below) are wanted, or
one twist a tier alone.

## Balance pass, 2026-10-09

From a playtest against Aethelred where the Shadowblade dealt 5,892 against 1,411 for the next hero:
- **The Overdose spends the pile** and `POISON_BURST` falls 1.73 to 1.4. Venomed Blades had been bursting on both
  hits of every turn once a target was capped.

## Balance pass, 2026-10-02

From a playtest of the Heart of Winter and a castle run:
- **Poison is 80% of what it was** against everything (`POISON_POWER` 0.9 to 0.72, `POISON_BURST` 2.16 to 1.73, kept in step).
  The dial is shared on purpose, so spiders' doses fall too. The Shadowblade's single-target boss damage had run far
  above every other path's.
- **The Skirmisher was cut by its own identity**: a group fight (the playtest's 2,043 for a Stormcaller against under 1,000 for
  a Skirmisher) is the thing it is for. Throwing Blades and Bolas 0.5 to 0.7, Volley 1.1 to 1.45, Throwing Blades' bleed 0.2 to
  0.25, Flurry's blades 0.2 to 0.25 each, Storm of Steel 12% to 20%, and Bladestorm reaches **two hexes** (`BLADESTORM_RADIUS`; `BladeRing` is drawn at that reach, twelve blades)
  at magnitude 0.55 to 0.75.
- **The Obsidian Legion's five templates are 65% stronger** in health, attack and magic and 30% in defence: Infantry,
  Blood-Thirster Stalker, Blood-Iron Arcanist, Runeguard Sentinel and Dread Knight, wherever they appear (castle, siege,
  patrols). The castle's stages were being cleared by the party that could beat Aethelred without losing anyone.

## Encounter review, 2026-10-03

`systems/sim/encounterReview.ts` fights every boss and every elite signature headlessly, at Easy and at Hard, and
measures them side by side; `combat/encounterReview.test.ts` pins the rules it can honestly speak to. The measured
table is the private project notes.

- **The party is built for the tier it is met at.** Each hero walks the path that holds an answer and buys it first,
  parents included (`spendToward`): the Templar's cleansing Divine Light, the Hydromancer's Silencing Depths, the
  Lifewarden's cleansing Warding Bloom, and for the Dragon a Bulwark, whose taunts break Skyfire. It is dressed in its
  class's kit at the rarity its level drops (`reviewGear`: common, rare from 8, epic from 14), each piece lifted to the
  party's level — the sim otherwise minted catalogue-level gear and fielded a level-20 party in its starting kit — or,
  for the endgame, in its path's legendary set (`gear: 'sets'`). The lairs are fought by the pair their gate admits
  (the Troll's at 10, the Dragon's at 11, the Heart's at 20) and Aethelred by four at 20 in castle tier 1; the elites by
  four at 10 in the rosters `eliteFights` fields them in.
- **The prepared party plays the counterplay** (`answeringPolicy`): step out of a footprint (`respondingPolicy`), break a
  preparation it holds the control for, mend a hero under 55%, cleanse a hero an elite has named (the Troll's wound
  from three stacks), cut down an objective — one a warning rides on first — and otherwise the ordinary brain; with
  `focus` it goes for the elite whenever nothing else is owed. Its answers are played through
  `executeAIActions`, which casts through the one resolver, so a held hero's mend works like any other. (Before the
  resolver was shared the AI's executor applied no healing, so an AI healer never mended anybody — which is most of
  why the boss measures' parties "neither heal nor cleanse". The measures themselves are unchanged.)
- **Difficulty** now uses the production rules: Medium is the permanent base, Easy is ×0.75 maximum HP and final damage,
  and Hard is ×1.25, including later summons, waves and backup. Reviews restore the caller's run settings afterwards.
  The review rolls real speed dice (`setTempoRandom(null)`): the test setup pins them to
  never, and every fight's tempo read zero until it did.

**Pinned:** every warning strikes only the ground it warned — the footprint, its landing area and the units it is tied to
— across every boss and elite, about 1,900 landings in the measured runs and none off its ground. Each landing is judged
alone (`struckOffGround`, from the board `landWarning` hands `CombatSink.warningLanded`), so Overturn's unwarned blow, which
can open the same turn, is on no warning's account, and a hero it threw is read where it left them. Every warning a control
can break, and every naming affliction that landed, has an answer some class can own at the fight's level
(`reachableAnswers`), Skyfire's for every class at the Hollow's; a prepared party beats every elite at Hard; no side takes
more bonus turns than `TEMPO_MAX_CHANCE` of its regular turns; the enemy side never fields more than eight.

**Historical measurements (eight runs a line, before the revised difficulty decision):** The following table and the
combat-spectacle report used the former Easy base and Hard ×1.5 HP/×1.25 raw attack and magic, with later units unscaled.
They preserve that review's evidence and are not measurements of the current Easy or Hard. Current difficulty
comparisons are recorded in the difficulty feature record.

- **Elites:** a prepared party wins all fourteen at Easy and at Hard, 8 of 8, in 2–6 elite turns; going for the elite first
  shortens most to 1–4 and cuts what the party takes. Fights this short often end before a signature fires (the Feast
  Slash was announced once in sixteen Berserker fights), so the signatures are met mostly when an elite comes with a
  retinue. Hard changes their length by a turn or two, not their outcome.
- **Tempo:** at level 10 the heroes run 1.1–2.4 times the elites' mean speed, so they take 3–27 bonus turns a hundred while
  the elites take almost none (the Captain's warband, at +41%, is the exception). The curve is doing what it says; the
  asymmetry is in the enemies' speeds, and is recorded here rather than tuned.
- **Bosses**, against the plan's targets (encounter health on the bar; turns are the boss's own):

  | Boss | Health (Easy) | Party | Easy | Hard |
  | --- | ---: | --- | --- | --- |
  | Troll Chieftain | 2,434 | pair, level 10 | lost in rare gear; won 8/8 in legendary sets, 72 turns | 3/8 in sets, ~98 turns |
  | Emerald Dragon | 6,109 | pair, level 11 | lost (53–80 a round into him) | lost |
  | Heart of Winter | 12,276 | pair, level 20 | lost (80–92 a round) | lost |
  | Aethelred | 8,008 | four, level 20 | 5/8 in epic gear, 36 turns; 8/8 in sets, 27 turns | 0/8 epic; 2/8 sets, 67 turns |

  At the prepared party's measured damage rates the plan's own numbers fall out as durations — Aethelred's ~3,000 is
  about twelve rounds of a set-geared four's 214–308 a round, the plan's 10–12 — while the standing values, raised by the
  owner after playtests ("very very easy" was the Emperor's first tuning), run well past the target lengths for a sim
  party — Aethelred two to three times, the Troll four to six — and are not won on Hard by one.

**Decided:** no boss's numbers were changed by this review. Each standing value is an owner's call recorded above (the
Troll's ~2,400 for the pair that fights it, the Dragon at twice the Warren boss, the Emperor's third tuning, the Heart's
"retune from play"), and the sim plays a prepared party, not a person — a human party out-damaged the Emperor's first
tuning by a wide margin. **Open, for play:** whether a prepared pair wins the Hollow and the ice lair and a prepared four
the castle at Hard. For reference, the sim party's rates (into the boss per round, rare or epic gear to legendary sets)
times the target lengths give about 350–1,000 encounter health for the Troll (two or three of his six-turn cycles),
650–1,200 for the Dragon (12–15 rounds), 950–1,300 for the Heart (the plan's 12–14) and 2,100–3,700 for Aethelred (the
plan's 10–12) — a floor, since a person out-damages the sim; play sets the factor.


## Combat health bars and floating feedback

Combat uses continuous HP bars without dividers: above units, in the active unit card,
in the unit inspector and in the boss display. The current HP number sits immediately
to the right of the overhead bar with no background; the panels show `hp/max` to the
right of their bars. Mana keeps its percentage bar. Barriers (and a Reckoning, the other
shield pool) extend the HP fill and also have numeric shield amounts, summed by `barrierTotal`; the overhead barrier shell
remains visible. `healthBarFill` shares the fill geometry between the arena and HUD.

Overhead HP, damage, healing and status words such as **Taunted** and **Stunned** all use
the same transparent pixel face (`data/display/combatGlyphs.ts` and `arena/PixelText.tsx`).
The text atlas is built from raw RGBA pixels so it also works on native GL.
`arena/FloatingText.tsx` renders event feedback as camera-facing meshes for 1.2 seconds.
The affected hex and model height are captured when the event resolves; camera movement
before or after the delayed display never detaches the text from that hex. The float rises
in world space and retains the original hex even if the unit is pushed, moves or dies.
A critical hit is floated as `-N!` on both sides (the resolver floats it through `CombatSink.float`); `utils/floatText.ts` reads the mark, and the float draws the number larger (0.56 against a
plain number's 0.38) with **CRITICAL** (`combat.float.critical`, KRYTYCZNE in Polish) beside it,
bottom-aligned, both in the hit's own colour (playtest 2026-10-13; it was gold with the word above).
The face has the Polish letters, their marks on rows of their own (localization).
**A number's colour says what it was** (`data/display/floatColors.ts`, playtest 2026-10-13): a direct hit by its
damage type (`damageTypeOf`), physical dark grey `#505050` and magic blue `#3d7bff`; Bleed ticks red `#e02424`;
Poison ticks and overdoses light green `#a6f075`; every heal, Regen, lifesteal and Sacred Seal included, dark
green `#1f8a32`; Barrier absorption white. Burn stays orange, Doom crimson, and the source-specific numbers
(shock, thorns, hazards, aftershocks, Death Mark, boss set pieces, a corpse's burst) keep their own colours.
Every float is outlined a pixel round each glyph (`outlinedTextBitmap`, colours baked into the texture): light
round a dark fill, dark round the rest (`floatOutline`), which is what lets dark grey read on the ground.
**The sheet's Crit is the chance a strike rolls** (playtest PT-11, 2026-10-10): `critRate.test.ts` fields a level-9
Marksman through the sim harness and the real resolver and counts these floats over 4,000 shots — sheet 14%, Basic
Attack and Mark Target each ~14%, one crit roll a shot. What the sheet leaves out is conditional and shown elsewhere:
Momentum (Repositioning, `MOMENTUM_CRIT` × rank scale, +11 at rank 1, a `CritBuff` status for two turns after any move:
~25% measured), Killing Eye against a Bleeding target, Blood Howl in Wolf form. Multi-strike skills (Rapid Fire,
Ricochet, dual wield) roll once per strike, so a volley shows several chances at a CRITICAL.
A float is also kept out from under the top HUD band (playtest 2026-10-09, PT-01: a boss's numbers
spawned over its tall crown, under the boss readout, and were never seen). Every frame
`utils/floatClamp.ts` checks where the legible part of the float — its base, half its 1.2 rise and the
text's top — projects on screen, and if that is above the band (the boss readout's measured bottom
edge, reported by `BossHealth`'s `onBottom`, plus `FLOAT_TOP_MARGIN_PX`; the canvas's own top edge
when no readout is up) it lowers the base along the float's vertical until it is not, never under 0.5
world units above the ground. Screen space rather than a lower anchor for big models, because the
action view, the whole-board view and the player's zoom put the same crown at very different heights.
At 844×390 with the readout open (bottom edge 63 pt), a Frostbite on the Bonebound Warlord floated its
number with its top at 71 pt where the unclamped anchor put it 38 pt above the canvas. A float over a
unit the camera has left above the frame drops to that floor while the camera is away.

`BossHealth` shows each living boss's full name, continuous bar and `hp/max`, with wrapping instead of
truncation, and folds to a thin strip on the player's request (see ui).
Up to two bosses get rows;
the phase and intent strips move down by `bossHealthHeight`. Under the summary line a **gauge row**
(the gauge facts of `bossRegistry.bossReadout`, worded from `bossLog.gauge.*` by `bossReadoutText`) shows what each boss's fight counts and what its next
step will do, from the boss's own script state: Aethelred's orb charges and the hexes the next orb warning
will add (shown before the cast; from phase 2 on it appears even at none) and, while a Foreclosure is open, how many of its seals are paid, the Troll's regeneration warning ("Unharmed: he will regenerate", never once one hero is left) and the heaps of his rubble standing ("Rubble: 3 heaps"), the signature moves still cooling, and,
once a move is committed, which way he faces (the hero standing that way, or empty ground). A boss that
supplies nothing draws no row. The bottom unit card also
wraps its full name.

Health presentation follows `utils/healthTimeline.ts` and its combat-store subscription.
The rules resolve immediately, while visible HP and barriers wait for the skill's main VFX
and attack and recoil animations to finish (`skillImpactDelayMs`). **Statuses wait with them**: a write
that adds or removes a status, or changes its doses (`statusKey`), during an action is shown at the same
moment, so the badges, a Chill's frost, a Freeze's ice and a burrow change when the picture lands, for every
skill on both sides and for reactions and warned strikes (`lands`). A Freeze broken by a blow therefore keeps
its ice until its `shatter` plays on the numbers' clock. A duration ticking is not a change and shows at
once; a change outside an action (a turn-start tick, a thaw) shows at once (playtest 2026-10-09: Blizzard's
Chill badges appeared at the press, and the ice vanished as the breaking swing began). Every health write is retained,
including synchronous double strikes; subtractions are separated by `FLOAT_STAGGER_MS`
(260 ms). Death animation and death audio read the presented health. Reaction responses wait
for the triggering picture and use their own effect clock. Contact recoil and aftermath
use `specImpactMs`, separately from health settlement; lingering aftermath is not part of
that wait. Both the arena and every combat health panel read the same presented frame.

Reinforcements call `CombatSink.arrive`: the camera frames the incoming units for two seconds,
then returns to the active unit. After the camera settles, each unit rises and grows into
place over 700 ms, staggered by 100 ms. Actions wait until the arrival presentation finishes.

## Status icons over units and on the HUD

A unit's statuses are a row of the hand-drawn status marks (`assets/icons/statusMarks`), not colour dots.
`data/display/statusPips.ts` (`statusPipRow`) is the one place that decides the row, so the arena and the HUD
cannot disagree: it takes the visible effects (afflictions first, then auras), keeps at most
`STATUS_PIPS_MAX` (4) things in the row including the overflow marker, and when something is cut the last slot
becomes the "+n". A poison or other stacked status carries its dose count, drawn as up to `STATUS_STACKS_MAX`
(3) stack dots; Jade Taint and the Beetle's Carapace count in their magnitude (`COUNTED_IN_MAGNITUDE`), so a
single charge shows one dot.

- **Over a unit.** `StatusPips` in `UnitMesh.tsx` builds each mark with `statusIconGeometry` as a flat mesh
  tinted the status colour on a dark disc, centred above the HP readout. Stack dots sit under the icon; the
  overflow is a drawn "+" (the arena has no text).
- **On the HUD.** `StatusIcons` (`ui/widgets/StatusBadges.tsx`) draws the same row as SVG on the turn-queue
  rings (at `QUEUE_ICON`, 9 px, max 3) and on the active unit's portrait on short screens (12 px, with the
  stack number and "+n"). On a queue ring the overflow is a bare "+" and the stack number is dropped.
- **Full detail.** Tapping a unit or a queue ring still opens `UnitInfoDialog` with the full `StatusBadges`
  list (names, magnitudes, durations).

Phone evidence (844x390, default and minimum zoom, `crowded` baseline state: every unit carries two poison
doses, burn, chill, root, barrier, mark, bleed and silence): over-head icons are about 11 px at default zoom
and 8 px at minimum zoom, distinct by shape and colour (poison green skull, burn orange flame, chill blue),
clear of the HP readout and pennant, with two stack dots under the poison and the "+" in the fourth slot.
Three 12 px icons plus the marker were wider than a 36 px queue ring and clipped at its edge, which is why the
queue uses 9 px icons and a bare "+": the row now sits inside the ring. The dialog listed all eight statuses.


## October playtest rework

Every hero recovers at least 1 MP on its regular turn. The five caster paths recover 3 before gear;
Shadowblade recovers 2. Attuned items can roll for every class; mana modifiers add to the baseline.
MP/turn is visible on the hero sheet. Bonus turns do not trigger regeneration.

Templar Smite costs 3 MP. Hallowing Sweep replaces Sanction's Mark with Sacred Seal: a holy cone,
35% hybrid power bonus magic damage and 25% Magic healing for the next allied direct attacker,
with normal rank scaling on the seal damage. It does not share Hunter Mark's bonus or ownership.
Dodges and periodic ticks preserve seals; a successful direct attack consumes one seal, once.
Judgement strips both Physical and Magic Defense (6/8/10) for two target turns.

Righteous Fury lasts for the battle and holds at most three stacks. Each rank supplies 15/20/25
extra magic damage per stack, resisted by Magic Defense. Only Basic Attack and Smite get the
rider and the +1 range, which does not grow with stacks. The weapon glows yellow, increasingly
bright at each stack. Sacred Rhythm replaces Long Reach: actual direct healing stores one
charge worth 40% effective Magic for the next landed Basic Attack or Smite. Cleansing alone,
overhealing and periodic healing do not charge it. It expires after two regular personal turns.
Skill detail rows show numerical payloads and explanations of the statuses they apply; the
unit inspector uses the same status descriptions and shows current Fury stacks and seal healing.

Stoneskin adds a Barrier worth 35% Magic (70% since the 2026-10 remaster). Stonecutter now cracks both defenses (replaced by Crumble in the remaster). Raise Rampart
replaces Upheaval with an atomic pair of connected, free hexes within range 3. The player picks
an anchor and neighboring orientation, then confirms the preview. Each rock has 37.5/50/62.5%
owner max HP and 6/8/10 Physical Defense; no turn of its own or victory/quest-kill contribution.
The pair expires on the second owner regular-turn start; recasting replaces that owner's pair
only after valid placement. Rocks block movement and Single/Line/Chain ranged damage on both
sides. A blocking rock can itself be attacked. Area/ground attacks and movement skills bypass
sight obstruction, but cannot occupy a rock. Targeting, resolution, chain hops and AI share the
obstruction rule. The inspector shows remaining owner turns.

Wave arrival has a two-second camera hold and staggered rise/landing motion. Acting-unit camera
updates and AI/player actions wait through that beat. Stale handoff callbacks check acting unit
and turn serial; turn-start processing runs once per serial. Legitimate disable reasons remain
explicit. The reported intermittent phone skip has not been reproduced on physical hardware.
Tall combat labels are fitted with a view that can widen as well as lower its seat.
