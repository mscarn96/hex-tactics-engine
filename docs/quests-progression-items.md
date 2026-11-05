# Quests, progression, and items

Current implementation notes and decision rationale for work in this area. Start with the relevant procedure in the reference index when one exists.

A boss kill pays the same on the first kill and the hundredth (`rollBossLoot`, tunables in
`BALANCE.BOSS_LOOT`): one guaranteed Legendary, a 35% chance of a second and never a third, then 2-4
Epics and Rares (each Epic with 40%) aimed at the party like any random drop. Legendaries use the
same pool as castle chests, including mastery set pieces: a random party member is chosen fairly,
then `CHEST_ON_PATH_BIAS` (70%) favors pieces that hero can equip. The final castle boss pays this
roll alongside the run chest, whose own rolls stay the same, and so does Kairen beside his summit
chest. First estimates: verify in playtest.

**Each boss has one item only it drops** (`EnemyTemplate.lootTable`, `ItemTemplate.bossOnly`): the
dragon's Dragon Scale Armor, the Troll Chieftain's club, the Heart of Winter's Heartfrost Staff and
Kairen's Fang. It is rolled at `BOSS_LOOT.ONLY_ITEM_CHANCE` (25%) on every kill and never
guaranteed, takes the place of a random Legendary so the count stays at two, and is in no other
pool: `worldPool` leaves out every `bossOnly` template, so no chest, lair, quest or other boss pays
it. Aethelred's is the Crown of the Last Legion, Jorōgumo's Widow's Needle and the Last Lesson's the
Staff of the Silent Lesson (which has a voxel model of its own, `voxel/items/uniques/`). Six more
standalone Legendaries join Excalibur and Aegis in the general pool: Oathbreaker (Warrior maul),
Stormglass Wand (Mage, Monk), Greenheart Bough (Healer), Windpiercer (Ranger bow), Vestment of the
Long Road (Healer, Monk chest) and the Emberheart Pendant (Mage, Monk); stats are hand-set first
estimates. The Monastery Bellstaff in the Silent Hall's
first chest is not boss-only and stays as it was.

**Set bonuses** (`systems/progression/setBonuses.ts`, numbers in `BALANCE.SET_BONUSES`): wearing 3
pieces of one mastery set gives a plain stat bonus and wearing 5 adds a plain number on that path's
signature; the two add up and a sixth or seventh piece adds nothing. The collections give only the
3-piece bonus. The count is `matchingSetPieces` (distinct legal pieces of the hero's own, a mythic counting as two; see *Mythic items*;
no rings) or the distinct worn pieces of one collection; the +12%-per-piece skill roll
(`setBonus.ts`) is separate and unchanged. A 3-piece bonus is max health (a `maxHpPercentBonus`),
attack, magic or defence by a percentage after gear (`statCalc`), or crit points or Heal power as
a stat; a 5-piece one rides an existing channel — `shieldPowerBonus`, `bleedMagnitudeBonus`,
`burnMagnitudeBonus`, `chilledDamageBonus`, `regenMagnitudeBonus`, `formVigorBonus`,
`markedDamageBonus`, `bleedingDamageBonus`, `poisonPower`, or `skillPowerBonus` on Smite, Blade Recall
or Glowmote (which scales that skill's damage and healing alike) — except two new integer modifiers,
`chainJumpBonus` (Stormcaller: +1 jump on Chain Lightning) and `carapaceChargeBonus` (Beetle: +1
Carapace charge, read by `beetle.carapaceMax`; the status chip still prints the base maximum).
"Spell damage" is the Magic stat and "healing" is Heal power. First estimates: verify in playtest.
`setCardView` (`setBonusText.ts`) is what `ItemCard` shows on the gear screen: the set's name and
`count/total`, or "if worn" for a piece in the bag, with the two tier lines dim until reached.

**Legendary rolls skip what the party owns** (`LootOptions.owned`, from `ownedTemplateIds` over the
bag, where equipped pieces live too): a boss, chest or lair roll draws pieces not owned yet. A hero
whose wearable pieces are all owned falls back to the rest of the unowned pool, and once every
piece is owned a roll repeats. A roll that pays several pieces tracks its own copy of the set, so
they do not repeat each other, and never changes the caller's. A boss's own item is not rolled for
once owned. `bossLoot.test.ts` checks counts, the boss-only rule and the skip against the real item
library.

Carnage's descriptions name the two skills it repeats: Basic Attack and Bloodthirst. Each hits
twice at full strength; for a dual wielder the two Basic Attack hits are one full hit from each
weapon (the Berserker remaster, 2026-10, replaced four half hits), and Bloodthirst heals on each
strike. Other abilities are unaffected.

## Quests

All six quest givers now have static conversation portraits rendered from their own world
figures. The speaker's name, role and location remain visible above speech and choices, with
a person mark and initials when art is missing or cannot load. The landscape presentation
and regeneration command are documented in UI.

`src/quests/` is the data (pure TS, no RN imports); `systems/quests/quests.ts` is the rules, entirely
pure — state in, state out — so a whole quest can be played to completion in a node test.
`questStore` is a thin shell that calls those and keeps the answer.

- A quest is stages; a stage is objectives; an objective is a **counter**. `applyEvent` folds one
  report into one quest and **advances the stage as part of the same call** — the kill that
  finishes a stage and the stage ending are one thing that happened.
- **`systems/quests/questHints.ts` says where to hunt, and it is derived rather than authored.** A
  hint written beside a quest is a second statement of where an enemy lives, and only the first one
  — `Faction.threatRange`, `Faction.terrain`, `Faction.homeLocked` — is what the encounter generator obeys; retuning a
  faction would silently make every authored hint about it wrong, and a wrong hint is worse than
  none. "Kill five wolves" against 4,900 tiles is a *search*, which is the failure `questHunt`
  answered on the supply side by weighting the roll — this is the other half. It also states the
  rule a player who stayed on the road will not have worked out: encounters only happen off it. A
  quarry whose every faction is `homeLocked` reads "Found only in …" (`campaign.hunt.lockedTerrain`),
  and a frost-locked one names the snowy highlands and paints them only where the tile has frost.
  `null` for a target no faction fields, which today is Aethelred alone and is right — he is at a
  fixed address the Grand Quest already points at, not somewhere to be found.
  - **A faction fielding a template is not the same as a faction fielding it everywhere it goes**,
    and reading `threatRange` as though it were is the bug `bandsFielding` exists to end. The range
    says where the faction turns up; the *shape table* decides which of its members turn up there.
    Greenskins run bands 0–2, but band 0 offers one shape — `pack`, two `chaff` — and Greenskin chaff
    is the Goblin Whelp alone, so an Orc Grunt cannot appear in Home Reach at any price. The Goblin
    Tithe asks for two of them, and both the log and the map pointed the player at Home Reach: a
    search of ground the quarry provably is not on, which is worse than the four-week wolf hunt this
    module was written to end, because a wrong answer is followed with confidence. `bandsFielding`
    asks through `shapesFor` and `membersForRole`, so both of the composer's own indirections are
    honoured, and a faction contributing no reachable band is dropped **entirely, terrain included** —
    keeping its terrain would paint swamp for a quarry only ever met in forest, which is the same lie
    one field over.
  - **One terrain list and one band window is only honest while every objective is answered by one
    faction**, so `fieldedByOneFaction` is exported for the suite to pin exactly that. Two factions on
    different ground in different bands would paint the cross-product. The day somebody writes a
    two-faction hunt the suite fails and this grows a region per faction; building that now would be
    a shape nothing in the game produces.
  - `questHints.test.ts`'s band check **was re-deriving the bug** — it read `threatRange` too — so it
    was fully green throughout, the way `push.test.ts` was. It goes through `bandsFielding` now.
- `applyEvent` **returns the identical record when nothing matched**, and `questStore.report`
  skips the write on that check. Every kill in the game is offered to every active objective, so
  this is the hot path. Pinned with `toBe`, not `toEqual`.
- **`systems/quests/questEvents.ts` is the only place the game talks to the log** — `reportVictory`,
  `reportPoiCleared`, `reportCollected`, `reportLocationReached`, `reportTalk`, `reportSiteInvestigated`. Scenes never
  import `questStore`. `combatEvents.ts` is the precedent.
- **`collect` is a stock; ordinary hunt, talk and travel objectives count events.** "Bring me eight crystals" asks what
  is in the bag when you reach the archivist, so `objectiveHave` reads `QuestContext.held` and
  `eventValue` returns **0** for it — counting the report as well would count the same crystals
  twice. As a counter it was unfinishable: crystals mined before taking the job, or won from a
  chest, a fight or the market, never counted. Nothing *happens* when you hold eight of something,
  so there is no event to fold — `advanceStages` is swept by `questEvents.syncQuests()` (called
  from `ensureAutoQuests`) and that is the only thing that can move such a stage on. `claimQuest`
  spends what was asked for.
- **The log is a tracker and nothing else.** `QuestLogScreen` has no Accept and no Claim: a
  contract is taken on at the person whose problem it is and handed back to the same person, which
  is what makes the six of them people rather than dispensers — and it puts the walk home back
  inside the quest. Every detail ends in a name and a place (`NpcDef.where`) instead of a control.
  The board used to accept, on the argument that a quest you were told about and cannot find again
  is a dead end; the answer to that is the name, not the button. `autoAccept` is the one quest
  that arrives without being handed over, and it never had a button either.
  On acceptance or hand-in, automatic tracking selects the easiest held side contract by its strength floor.
  Lair contracts and the Grand Quest require an explicit Track press; with only boss contracts held,
  the strip stays empty. Existing manual tracking is preserved when another contract is accepted or paid.
  The log's campaign goal still makes the lair lead available without automatically steering there.
  - **Tracking is the one control the log is allowed, and it is the detail's one gold button.** It
    was a 60pt word in a card's corner, then the whole card; with a detail pane beside the list a tap
    on a row has to mean "show me this one", so the toggle moved to Track on map — a larger target
    than the card ever was, and one that says what it does (`questLog.toggleTracked`). The gold rail
    on a row is the readout of *which* quest the HUD strip is following, the same rail
    `TrackedQuest` wears. And a **finished, unclaimed** quest can be tracked, which is exactly when
    the pointer is worth the most: `TrackedQuest` already renders "Report to X — where" for that state and
    `trackedQuestTarget` already aims the arrow at the giver's own tile, and neither could be reached
    because the control was hidden the moment it became useful. Three of the six givers live out on
    the map, so "go and get paid" is a direction.
- `kill` objectives take a **list** of templates, so "wolves" means any wolf. `quests.test.ts`
  checks every named template against `enemyTemplates` — a quest naming an enemy the game no
  longer fields never progresses and looks like a broken counter rather than a typo. `talk`
  objectives are checked against `NPCS` for the same reason.
- **Objective labels are generated, never authored** (`systems/quests/objectiveLabel.ts`). A
  playtest read "Their overseers 0/2" without knowing it meant Orc Grunts, and "The troll
  chieftain" named a boss the fight calls the Bonebound Warlord. The log, the map tracker, the
  notices and the combat intro/victory lines all print `objectiveLabel(objective)`: a kill names the
  enemy template's display name, pluralised by count ("Orc Grunts 0/2", "Brigand Captain 0/1"); a
  collect names the resource ("Wood 0/8"); talk, reach, investigate and clear name the NPC, location
  or quest site ("Speak with Rell Ashcroft", "Search the Frozen Camp", "Clear a quest waypoint").
  The only authored words are a kill `group` (required past two templates; must be a faction name or
  the plural of a word every member's name shares — "Wolves", "Goblins", "Brigands") and an optional
  `verb` that replaces "Speak with"/"Search"/"Reach"/"Clear" but never the derived name.
  `objectiveLabel.test.ts` asserts every label in `questData` contains the thing it counts.
  The map's `TrackedQuest` strip never truncates: lines wrap inside the right column, and a collect
  line (like the log's) carries its resource icon (`ObjectiveLine.resource`).
- **A fight says what it means to the log, before and after** (`systems/quests/battleQuests.ts`).
  The battle intro lists every unfinished kill counter of an active quest that this fight's enemies,
  reinforcement waves included, count toward — "Quest: Orc Grunts 0/2 — 2 here"
  (`questTargetsInBattle`, the `huntedTemplates` reading with a count). The victory card's Quests
  section ("Orc Grunts 2/2 ✔", "Wolves 3/5 (+2)", "Quest complete — return to …") is
  `previewVictory` over the same events `reportVictory` and `reportPoiCleared` write when the card
  closes — kill events from the shared `killEvents`, then the quest-site/boss-tile clear — folded
  through the same `applyEvent`; `battleQuests.test.ts` pins preview == applied. The card is shown
  before the write because the write happens on close.
- **An early quest must name an enemy early ground fields.** `SHAPES` has no `caster` and no
  `elite` slot below band 2, so a kill objective naming only one of those is not a hard quest at
  summed level 5 — it is a counter the party cannot legally meet the enemy for. The Goblin Tithe's
  second stage was written as a goblin shaman and had to become orcs. Pinned for every gate at or
  below 6; The Roadwardens at 8 is the first quest that assumes band 2 on purpose.
- **Offers combine summed party level with completed story contracts and actual lair victories.**
  Recruitment alone previously opened four to seven offers at once. After Wolves, the Trapper
  and Tithe are the two branches on offer; following them leaves roughly two or three actionable
  contracts on the intended early route. There is no cap on accepted quests, and gates never
  recheck an active record's progress or payout. The campaign audit lists
  every gate, giver, recruitment jump and lair milestone. `campaignPacing.test.ts` verifies the
  combined route and dialogue reachability; level-floor audits inspect compound gates too.
- **The log separates Active, Available, Upcoming and Done.** Available lists actionable NPC
  offers. Upcoming previews the next three named leads with their giver and unmet story, lair
  and strength requirements, instead of anonymous level locks mixed among offers. It ranks by
  remaining prerequisite steps, then strength still needed. `questLeads.ts` derives those steps
  from the same predicates the NPC offers use. Future leads have no objective destinations or
  Track control; active and ready-to-report contracts still track normally. The log subscribes
  to lair progress as well as party, quests and inventory so its offers update after a boss victory.
- **The campaign goal stays above all four tabs.** Past the red orb it reads the roads
  (`worldGates.campaignRoads`, quest campaign). Before that, `campaignGoal.ts` derives the next unfinished
  lair from exact boss victories and finds its contract through the actual reach objective. Before
  that contract is offered, it follows the unmet story prerequisites to an actionable lead, including
  Rell's northern chain. It names a lair when its contract is available or held, states the next
  giver or objective, and shows lairs cleared plus the eventual Obsidian Castle gate. It does not
  reveal terrain or add a marker for an unaccepted lead. A ready lair hand-in takes precedence over
  the next destination, even after victory opens the castle.
- **Lair offers lead side offers at their givers; payments still come first.** The log marks lair
  rows, View lead selects the NPC offer, and Track goal follows the accepted contract in one press.
  Each lair's chase line also offers explicit map tracking. Acceptance, sync and automatic Grand
  Quest acceptance preserve an existing tracked side quest. The door stays targeted through a failed
  run; victory changes the target to Aldris at the gate, Ferrow at his wayside, or Ivane at the library.
  If a side errand owns the NPC's current line, a compact held-lair shortcut keeps that contract
  visible. Explicit Track on map, Track goal and NPC tracking also enable the world guide's Quest
  mode, so its destination marker and bearing appear without cycling the separate Guide control.
  This uses the existing session guide state and adds no save fields.
  The six NPCs connect the collectors, wagon obstructions, workings and northern supply line to
  the Empire and Obsidian Castle. Camp-paper stages and each stage of Hoofprints in the Mud have their own reminder lines.
  Campaign spine evidence records the phone review.
- **A late lair contract recognises its own saved victory.** Accepting and syncing credit a
  current stage naming both that exact lair and its boss from the lair's spent boss trigger.
  This keeps milestone-delayed contracts finishable after an exploratory victory; a different
  lair or a failed attempt gives no credit. Ordinary hunts remain flows. No new save data is
  required. `lateLairContracts.test.ts` checks all three lairs and one-time payment.
  Named site objectives use the existing `MapTile.questId` as their address. `clearPoi` may
  require a `site`; `investigate` always names one. Arrival reports investigation, victory reports
  the cleared identity, and tracking points to that exact tile even under unexplored fog. Peaceful
  investigations mark the site spent and display the clue; hostile sites retain their fight until
  victory, so an investigation does not clear the camp. Saved defeated sites supply exact credit
  when a contract is accepted late. Unnamed `quest_0..2` fights remain unchanged. Roadwardens still
  accepts any defeated **combat** waypoint; peaceful clues cannot substitute for a fight.
  Every site stands on its fixed hex all campaign: dark until a quest that sends the party there
  has been accepted, lit while live, dark again once cleared (playtest 2026-10-30) — see *Named
  quest destinations* in [World](world.md). Late credit
  therefore comes from a site cleared for another quest, such as a named camp counting toward the
  Roadwardens' generic waypoint.
- **Five repetitive stages now ask for distinct activities.** Thicket clears Rell's named nest;
  Greywater clears the actual crossing after meeting Sedge; Claim examines stamped stakes then
  delivers iron; Bell investigates a drain and has Ivane read its seal; Cold Keeps delivers six
  crystal and asks Rell for northern news. The wolf opening, Tithe, Reeds and boss hunts keep combat.
  The northern chain follows Cold Keeps: Silent Trapline (total 18, one lair), Frozen Camp (22, one
  lair), Supply Trail (28, two lairs). Rell gives the first two, Ivane the last. The camp's Rime Jarls
  guard Imperial sled papers; the manifest identifies Glacier Deep. Since the playtest of 2026-10-14 the
  camp is a war camp — three Rime Jarls with a Giantling, a Skald and a Hurler at band 3 (it was three
  ordinary bodies at band 2, and the Jarl it named was absent) — and the trail is a fight as well as a
  clue: seven lighter bodies at band 2, two Frost Motes, two Shardcasters, a Hoarfrost Wraith, an
  Obsidian Infantry and a Blood-Iron Arcanist, the one mixed-faction roster (`QUEST_SITES`), which the
  stage's new clear objective asks the party to break. Its contract requires both
  Cold Keeps and Supply Trail reported, plus total 36 and two lairs. The Grand Quest still starts
  from the third lair victory. See the campaign table.
- **SAVE_VERSION 30 deliberately requires a fresh test campaign.** Revised positional stage records
  and new map destinations cannot be read as the old campaign. Following the project notes, there is no
  migration; the unnamed sites' rules and existing lair-credit behavior remain intact.
- **The lair contracts retain strength floors just under their lairs, in campaign order**: the Warren's at 7, the
  Wyrm's Hollow's at 20 and the ice lair's at 36 (see *Locations* for the order). The ice lair's lead
  is *What the Cold Keeps* at 16, the recruitment curve's third hero: the cold going out of the
  ground is waking the dead, the crystal Sister Ivane reads by grows in the frozen north, and her
  reading of the Empire's returns finds the drain her next contract sends the party to. The northern supply chain carries that reading to the door. Both keep
  the old Barrow quests' ids (`what_the_barrow_keeps`, `the_door_in_the_barrow`) beside the lair's
  own `lair_barrow`. The Warren follows the Tithe; the Hollow follows High Workings and the first
  lair; Glacier Deep follows Cold Keeps, the northern Supply Trail and two lairs. Names and lines are new, and `lairReorder.test.ts` fails a quest or a person
  that still says *lich*, *barrow* or *midwinter*.
- **`QuestRewards.items` existed and was paid out from the day it was written, and no quest used
  it** — so a contract paid gold, XP and sometimes a place at the table, and never once a thing you
  could wear. Eight carry one now, including the three lair milestones and the frozen camp, and **none of them names an item.**
  - **A reward is a *shape* — a slot and a rarity — resolved against the party by
    `systems/economy/questGear.ts`.** Naming a template was the first attempt and it does not work:
    non-common gear is class-locked, so a named piece is dead weight to three quarters of the roster.
    The best a fixed id can manage is one reward per class spread across the campaign, which still
    hands most players something for a hero they never recruited, and "go and sell your reward" is a
    strange thing for a contract to say.
  - **What a path wants is derived from the path's own tree**, never authored beside it. Summing
    `statBonus` across a path's nodes gives Bulwark `{maxHp: 60, defense: 8, shieldPower: 8}` and
    Berserker `{critDamage: 35, armourPen: 20, critChance: 18, defense: −4}` — the two shopping lists
    a player would write, already written down. A table restating them would be wrong the first time
    a node is retuned, which is the argument `questHints` makes one system over. **Negative entries
    count against a piece**: the Berserker's tree spends defence away, and an item handing it back is
    working against the build rather than merely not helping it.
  - **Legality goes through `canEquip`, not a re-derived class check**, and the main-hand reward is
    why. A path names the weapons it carries, so that is where the *mastery* lock lives — and a
    forgotten lock does not throw, it hands a Skirmisher a bow they cannot hold. It is also where the
    mechanism pays best: every path names its own weapons, a warhammer for the Bulwark and a
    short sword for the Berserker, where rare plate has two motifs and cannot tell the two apart at
    all.
  - Deterministic, with no rng: the same party claiming the same quest is paid the same piece, so a
    reward is something a player can be *told* about. The affixes roll at `mintItem`, which is the
    acquisition step and belongs to the caller. Legendary set pieces are refused outright — the forge
    and the dungeon chest are their only two routes, and a third costing a conversation flattens both.
  - The gates are still late, for a changed reason: a path is chosen at `MASTERY_UNLOCK_LEVEL`, so a
    reward that reads the party's masteries wants a party that has some. Below that it falls back to
    the first hero who can wear anything, which is the old behaviour under another name rather than a
    quest that pays nothing.
- **Milestone rewards distinguish a lair from a short errand.** Warren pays a Rare main hand;
  Hollow pays an Epic chest; Glacier pays an Epic main hand and eight crystal. Frozen Camp pays
  Epic boots. Silent Trapline pays eight wood, Supply Trail six crystal. Bell's investigative
  errand and Cold Keeps' reduced delivery/news route pay less gold and XP than their former long
  hunts. `QuestRewards.resources` is one authored record read by payout, row chips and detail tiles.
  Gear previews state rarity and slot; the current party resolves its wearable piece at claim.
  Recruit openings stay on Wolves, Roadwardens and Cold Keeps; party slots stay on lair victories.
  The reward audit records effort, payouts and the automated route evidence.
- `rewards.unlocksHero` is `true`, never a class — and **nothing downstream resolves it to one
  either**. It grants an *opening*: `cityStore.recruitsEarned`, the right to hold one more hero.
  Both payout paths used to name the class themselves (`getQuestHeroReward` by quest index,
  `nextUnlockableHero` by first missing template) and both put the Warrior first in three saves
  out of four. `systems/progression/recruiting.ts` is the rule now: the offer is **derived** — every class the
  party is not fielding — and the tavern is the picker. Converts to gold only when all four
  classes are already recruited. **Quest completion is the only source of an opening.** The three
  `quest_N` fights on the map pay ordinary `QUEST_BAND` combat rewards and never an opening; they
  once did (`questEarnsRecruit`, from the one-site-per-hero design), which stacked three extra
  openings on top of the curve. `src/__tests__/quests/openingSource.test.ts` pins the sole caller.
- **Openings and party slots are two gates, not one.** Quests hand out *who*
  (`recruitCapacity` = 1 + earned), lairs hand out *room* (`partySlots`); `hasRecruitRoom` takes
  the minimum. An opening is counted against the roster rather than spent, so dismissing a hero
  hands the place straight back.
  - **Both gates have to be said out loud, and one of them never was.** The quest log advertised
    `unlocksHero` as "a new recruit", which is a promise only half the game keeps: The Roadwardens
    opens at summed level 8 and The Warren is the lair that pays for the room, so a player finishing
    it walked to the tavern and was turned away by a gate no quest had ever mentioned. A playtester
    reported it as the quests simply lying, which it was. It reads "a place at the table" now, and
    the log carries a notice for the one state the tavern cannot reach the player in — an opening
    held with no room for it — because that player has no reason to walk to the tavern at all.
  - **The tavern is marked in the city when both gates line up.** Recruiting is the only thing in the
    game whose availability is decided entirely elsewhere, so the moment it becomes possible the
    player is standing wherever the second gate closed. It is `QuestMarker`'s `recruit` kind — a teal
    figure with a plus — hung over the tavern *building* (`recruitMarkSpot`, the same pick box the
    destination plate hangs on). It used to be the quest-offer "?" on the door's walk-in hex, which
    floated over an empty tile and said nothing about hiring.
  - **And the player is told, once, wherever they are** (PT-08, playtest 2026-10-22: a third or
    fourth hero was easy to miss). The moment `recruitNoticeDue` holds — both gates open, somebody
    left to offer, and the notice not yet shown for the party size the recruit would make
    (`cityStore.recruitNoticeShownFor`, saved) — `RecruitNotice` (`components/ui/dialogs/`, the
    shared `DialogShell`) covers the screen on the world map or in a place, never in a fight, once
    nothing else is open: "A new hero can join your party", where to go, and **Got it**; in a place
    with a Tavern (the city) also **Go to the Tavern**, which opens it. Dismissing records the size,
    so a dismissed hero handing their seat back does not repeat it and the next opening does. The
    one-shot `recruitHero` tip waits behind it.
  - **The lasting marks stay until somebody joins**, on the same `hasRecruitRoom`: the city on the
    world map wears the 3D recruit mark, larger (`CITY_RECRUIT_MARK_LIFT`/`_SCALE` in
    `worldmap/markHeights.ts`); the map's **Guide** button — the way home — and the Tavern's name
    plate in the city wear `RecruitBadge`, a pulsing teal square with a plus at the corner (the
    plate's edge turns teal too). A camp world (Jadeveil) has no city and shows neither map mark.
    Checked in the web build at 844×390 (2026-10-22): the notice card is 440pt wide with both
    buttons on one row, unclipped in English and Polish; the badge sits on the Guide button's corner
    and the Tavern plate. The harness's `quests({ openings })` stages openings as already noticed
    unless `recruitNotice: true`, so captures of the tavern are not covered by the notice.
  - **Inside, the tables say the same thing.** On the same `hasRecruitRoom` gate (`openingStation`
    in `components/city/tavernRoom.ts`) the tavern room opens on the tables, with the first waiting
    recruit picked, rather than on the hearth. The tables station wears the recruit teal
    (`MARKER_COLORS.recruit`): a teal edge, the flat `RecruitMark` (the figure with a plus) before
    its label and a "!" badge, and the waiting figures sit on a teal wash. The party's table shows
    an open chair for each opening a recruit can take now. See
    the tavern room.
- **A recruit joins partway up the curve.** `recruitLevel(heldCount)` reads
  `BALANCE.RECRUIT_LEVELS` (`[1, 3, 5, 10]`), so the starting hero is level 1 and each later one
  arrives higher — the fourth latest and highest, because the openings are paced so that they
  arrive last, onto ground scaled to the party they are joining. At level 1 they were not a weak
  hero, they were a body one-shot by everything on the map. `addHero` builds them **whole**:
  `calculateStatsForLevel`, `deriveHeroSkills` and `pointsEarnedByLevel` at the arrival level, path
  still unchosen. The last table entry repeats past the end of the table, so raising
  `MAX_PARTY_SIZE` cannot silently reintroduce the level-1 case.

## NPCs and dialogue

`src/quests/dialogue.ts` is the format, `npcData.ts` the content, `systems/quests/dialogue.ts` the
(pure) selection rules, `systems/quests/dialogueActions.ts` the application.

**Six people: three keep the city, three live on the map.** Nothing in the dialogue layer knows
which is which — a conversation is a conversation, and the only thing that varies is whether the
trigger fired in `LocationScene` or in `WorldMapScene`. See "Waysides" under World map for how the
three outside are placed. Each stands in a figure of their own, named by `NpcDef.prop` and built to
their card in `voxel/models/npcs.ts` (see models); no two share one.

- **Dialogue never mutates game state.** A choice emits a `DialogueAction`, applied through the
  *same* functions the rest of the game uses (`questStore.accept`, `claimQuest`). Accepting at an
  NPC is now the *only* route, but the indirection stays: it is what keeps the conversation a
  content format rather than a second, parallel way for things to happen.
- An NPC's opening line is **the first node whose `requires` passes**, scanned in author order —
  so the most specific state goes first and **the last node must carry no predicate**. Both are
  pinned by `dialogue.test.ts`, which also walks every NPC through every quest state looking for
  one with nothing to say.
- **File order is priority order, and it runs payouts → offers → chases → small talk.** Somebody
  holding three quests hands one in before offering the next, which is also the order the player
  wants them in. Two rules fall out of it and both are measured:
  - `questReady` must be ordered *before* `questActive` (or `questStage`) for the same quest — a
    finished quest satisfies both, and the wrong order means it can never be handed in. Now that
    the log cannot pay anything out, that is a quest that can never be finished at all. Pinned
    across **every** tree, not just the gate captain's: one person holding three quests makes it
    easy to add a node in the wrong place.
  - Every NPC carries a `where`, because the log points at people instead of handing quests over
    and a name with no place attached is a name the player walks the map looking for. And a
    `place` — "City gate", "The reeds" — because the log's rows read "place · person" and `where` is
    a phrase built to finish a sentence; no rule shortens "where the ground gives" into a name.
- Choices are **hidden** when their predicate fails, never greyed out: a disabled line still tells
  you a quest exists and what it wants, which is what the world state is withholding.
- `QuestPredicate` is one vocabulary for two jobs — gating content and picking a greeting — since
  "has the player done this yet" is the same question either way. It carries `not`/`all`.
- Tests pin that **every quest's giver both offers and takes back** its quest: a quest reachable
  only through the log is half-built content.

## Progression: masteries

At `BALANCE.MASTERY_UNLOCK_LEVEL` a hero picks one of three paths for their class — permanent, fifteen
paths across five classes. `data/skills/masteryData.ts` is a **barrel over `data/skills/trees/*.ts`**, one file per
original class and one per Monk path.

**What the pipeline owns.** `scripts/mastery-trees.mjs` (`npm run mastery:build`) generates six files from
the private project notes: `champion`, `arcanist`, `druid`, `hunter`, `firefly` and `beetle`, fourteen paths.
Everything in those files comes from the draft or the script, comments and import order included, so
change a tree in the draft and build: a hand edit fails `masteryLab.test.ts`, which builds every file on a
temporary copy and compares it byte for byte with the one shipped. The same suite fails if a file or a
path appears that the build does not write. Three things stay outside it:

- `trees/shared.ts` is hand-written: the node constructors the generated files import, and therefore the
  documentation, since the generated files carry nothing but imports and a banner.
- `trees/mantis.ts` is hand-written, and the Mantis is not in the draft.
- The draft's `name`, `description`, `tagline` and `notes` are the editor's working copy and are read by nothing that
  ships, so they do not count as drift; the catalogs hold the words. Node `requiresLabel` is a working copy
  too for the wordless files (`druid`, `firefly`, `beetle`, `WORDS_IN_CATALOG`), whose labels are in the
  catalogs, and an id into `masteryCommon.requires.*` for the other three.

A `statBonus` or `modifier` value in the draft is a number or a `BALANCE` reference, written as a string
(`"modifier": {"hotBloomShare": "BALANCE.ADVANCED_DRUID.LAST_BLOOM_SHARE"}`). The build writes the reference
as code and adds the import, and refuses any other string. The editor reads a reference as the number it
comes to, so importing the draft does not report a change, and keeps it through an export. The editor starts from
the shipped trees and its own diff; only Import reads the draft. the private project notes is an old rendering
from the first v3 draft that nothing regenerates, so it does not show the current trees.

**The generated files carry ids, never words.** A node's name and description and a path's name and
tagline are read from the class's locale namespace (`masteryChampion`, `masteryArcanist`,
`masteryHunter`, `masteryDruid`, `masteryMonk`) under `node.<id>.*` and
`path.<id>.*`, through `masteryNodeName`, `masteryNodeDescription` and `masteryPathTagline`
(`data/display/masteryText.ts`) and `pathName` (`data/gameText.ts`); a mastery skill's under
`skill.<id>.*`, and a charged skill's release line under `skill.<id>.release`
(`skillStageDescription`). `requiresLabel` is an id into `masteryCommon.requires.*`
(`firstCapstone`, `advanced`). `scripts/mastery-trees.mjs` does not read the draft's English
`name`, `description` or `tagline`, which are the editor's working copy: changing a node's words
means editing the catalogs in every language. `npm run mastery:build -- champion hunter` writes only
the files named. The shared stat labels, modifier lines and role words are `masteryCommon`.

**224 nodes: 18 per path, and 26 for Wildshape.** Each path is a main tree plus two side trees.

- **The main tree is a 5 → 4 → 3 pyramid** (`MASTERY_TIER_WIDTH`). Tier 1 is five stat-or-passive
  feeders, tier 2 is four active skills, tier 3 is three capstones. **Prerequisites are derived from
  `column`, never authored** — a node feeds from the two above it, at `column` and `column + 1`,
  which is what keeps twelve trees from needing an edge table nobody would maintain. A node carrying
  `requires` opts out and `column` becomes ordering only.
- **The two side trees hang off the capstones, and are not a tier.** Each is a starter on the tier-1
  row with two children on the tier-2 row; the starter carries `requires: [the three capstones]` with
  `requiresCount: 1`, so it opens with the first tier-3 point. `MasteryNode.sideTree` (`'a' | 'b'`)
  excludes them from every pyramid invariant while `tier` still says which **row** they draw on —
  one grid, not two.
- **Wildshape is the exception and declares it**, via `MasteryPath.tierWidths` (`[5, 12, 3]`).
  Anything walking every path reads the path, not the constant.

**Every node costs 1, at every tier.** The cost table used to be 1 / 2 / 5, and that 5 *was* the
one-capstone rule — a second capstone came to 20 against a 15-point budget, so two were unreachable
by arithmetic. With a flat cost the rule is stated directly instead: the three tier-3 nodes of every
path share `exclusiveGroup: 'capstone'` and lock each other out.

**What the flat cost buys is that a node is a rank, not a switch.** Each holds `NODE_MAX_LEVEL` (3)
levels and **each level is its own point**, so `BALANCE.MASTERY_POINTS_AT_CAP` (15) is spent on *how
deep* as much as on *how wide*. `LEVEL_SCALE` is `[0.75, 1, 1.25]` and **every authored number is the
level-2 value** — which is why the whole shipped roster of numbers stayed exactly where it was when
levels arrived, and level 1 became a discount rather than 224 new values.

- **Magic from a node is a percentage** (playtest 2026-10-23: a flat few points of Magic was
  nothing late on; flat Speed stays). The fourteen nodes that granted flat Magic (Live Wire, Inner
  Flame, Deep Well, Zealotry, Crusader, Deep Roots, Glowing Wraps and the rest) grant
  `magicPercentBonus` instead, at 2% a former point (Live Wire's +5 is +10%), scaled by
  `LEVEL_SCALE` like any modifier. `getEffectiveStats` applies it after the gear, added to a worn
  set's Magic share rather than compounded with it, as `maxHpPercentBonus` is. Quest gear reads such
  a node as 50 Magic to the share (`PRIORITY_REFERENCE_MAGIC`), so its ranking did not move.
- **Mana decreases as an active node improves.** Authored mana costs are rank two;
  rank one costs 110% and rank three 90%, rounded and never below one for a costed skill.
  `nodeSkillAt` and the granted combat skill use the same rule, including occupied variants.
- **Mastery mana balance** (`BALANCE.MASTERY_MANA`): Shadowblade has a 25% larger effective
  pool and +2 mana per regular turn. Pyromancer, Hydromancer, Stormcaller, Lifewarden and
  Stoneshaper have 15% smaller pools and +2 mana per regular turn. Their costed spells use
  `casterManaCost` at +15%, and active tier-three capstones at +50%, before rank adjustment.
  At-will zero-cost skills stay free.
- **Chi** (`BALANCE.CHI`, `data/classResource.ts`, `systems/combat/chi.ts`) is the Monk's pool. It
  is still `maxMana`/`currentMana`, so cost checks, the AI and rank discounts read it unchanged.
  `calculateStatsForLevel` gives a chi class `CHI.POOL` at every level, whatever its template grows;
  only nodes raise it. `getEffectiveStats` replaces the base regen with `CHI.REGEN`, adds gear and
  node `manaRegen` one to one, and applies no path bonus. `playerUnitFor` fields a chi hero full,
  castle stages included, and tags the unit `resource: 'chi'`. `resolveSkillUse` pays
  `CHI.BASIC_ATTACK_REFILL` once per Basic Attack action after the cost, dodged or not, and once for
  a dual-wield swing; `refillChi(unitId, 'meditate', sink)` pays `CHI.MEDITATE_REFILL`. Every Monk
  signature costs `CHI.SIGNATURE`, no more than one swing refills, and every capstone `CHI.CAPSTONE`;
  the values were set through the Monk harness (development). The sheet
  tiles, the HUD bar, the skill and unit inspectors, the refusal and the float text say Chi for a
  chi unit and MP or mana for everyone else, and since the 2026-10-17 playtest (PT-02) draw it in
  its own yellow, `UI.color.state.chi` (`statusDisplay.resourceColor`): the bar over the unit and on
  the combat card, a skill button's cost corner, the cost chip and the "+N Chi" floats and log
  lines. Mana keeps its blue. Tavern rest and the dawn fill it like mana, which a
  fight start makes moot. The class key is the string `'monk'`, which is `HeroClass.Monk`. Pinned
  by `chiResource.test.ts`.
- **The Monk** (`HeroClass.Monk`, template `monk`, design in
  the Monk plan) is the fifth class. It owns **Meditate** at level 3: no
  chi, `cooldown: 1` (every other turn), the action only. Now it lays `DefenseBuff` and
  `MagicDefenseBuff` of `BALANCE.MEDITATE` for one turn and a `Meditation` aura, and
  `resolveSkillUse` pays `CHI.MEDITATE_REFILL`. On the start-of-turn tick that retires the aura,
  `effectTick` calls the store's `payMeditation` (`systems/combat/meditate.ts`): a `HEAL_SHARE` of
  maximum HP and `AttackBuff`/`MagicBuff` for that one turn, the Martyr seal's "pay when it
  expires" shape. It is the **Jadeveil expansion's class**: hero select shows it as the fifth card
  and the Tavern offers it as a recruit only while Jadeveil is owned (`heroTemplatesOpenTo`, fed by
  [expansion ownership](#expansion-ownership) in `HeroSelectScreen`, `TavernCounter` and
  `recruiting.recruitableClasses`) — ownership alone, with no Emperor, Jadeveil visit or level in
  front of it. A quest opening stays useful while an owner has no Monk; for an unowned player the
  four base classes are a full set and the opening converts to gold. A Monk already in a party
  (a save from an owner's device) is kept and played; ownership decides what is offered, not who
  stays. Pinned by `monkAccess.test.ts`. Hero select's path line
  names the class's paths (a class with no tree reads "not built yet"). It has its own body
  (`voxel/models/monk.ts`, models) and its own mark, a bound fist in jade
  (`class_monk`, icons). A level-1
  Monk winning the band-0 fights headlessly is pinned by `monkOpening.test.ts`; the rest by
  `monkClass.test.ts`.
- **The Mantis** (`mantis`, the Monk's blade dancer; design in
  the Monk plan) is the first Monk path with a tree: signature Twin Reap,
  feeders Chitin Grace, Bleeding Blades, Reaping Momentum, Predator's Breath and Light Frame, the
  actives Scything Step, Flicker Cut, Pinning Cut and Pounce, the exclusive capstones Marked Prey,
  Threefold Scythe and Mantis Execution, and the side trees Bleed Harvest (Fresh Kill, Evasive Weave) and
  Deep Cuts (Haemorrhage, Scent of Blood) — the last of the three to be whole, held to every whole-tree suite. Its
  growth is +1 ATK and +1 SPD. Its tree (`data/skills/trees/mantis.ts`) is **hand-written**:
  it is not in the draft that `scripts/mastery-trees.mjs` generates from (the Firefly is), and the
  mastery lab's `PATH_FAMILY` maps it to its own file. The rules are in [combat](combat.md#mantis-the-reap-and-the-flank-monk).
- **The Firefly** (`firefly`, the Monk's support that heals by hurting) is the second: signature
  Glowmote, feeders Glowing Wraps, Lantern Breath, Brighter Motes, Afterglow and Wingbeat, and the
  actives Lantern Sweep, Lightbond, Purifying Light and Lantern Glide, and the exclusive capstones
  Firefly Motes, Firefly Swarm and Lantern Beacon ([combat](combat.md#firefly-the-three-capstones-monk)),
  and the side trees Far Light (Kindled Light, Steady Flame) and Twin Motes (Bright Bolt, Second Light)
  ([combat](combat.md#firefly-the-side-trees-and-the-copy-monk)). Its growth is +2 MAG. Its tree is **generated** from the draft's `firefly` path —
  `scripts/mastery-trees.mjs` gives it a file of its own (`trees/firefly.ts`). The rules are in
  [combat](combat.md#firefly-glowmote-the-feeders-and-the-four-actives-monk).
- **The Beetle** (`beetle`, the Monk's bodyguard in plate) is the third: signature Iron Carapace,
  feeders Thick Plates, Shell Breath, Hardened Shell, Shoulder to Shoulder and Steady Breath, and the
  actives Horn Sweep, Carapace Leap, Grip and Throw and Shell Wall, and the exclusive capstones Vengeful
  Shell, Carapace Bastion and Shell Swap, and the side trees Second Watch (Lasting Shell, Retribution)
  and Numbing Staff (Heavy Hands, Planted Guard).
  Its growth is +2 Physical and +2 Magic Defense, the two its Barriers are a factor of (doubled by PT-04,
  2026-10-22; verify in playtest). Its tree is
  **generated** from the draft's `beetle` path into a file of its own (`trees/beetle.ts`).
  The rules are in [combat](combat.md#beetle-monk-the-signature-the-feeders-and-the-four-actives) and
  [its side trees](combat.md#beetle-monk-the-side-trees).
- **All three Monk trees are whole** and held to every tree suite like the twelve before them — six
  points to a capstone, fifteen for the full line, the legal builds. They landed a path at a time
  behind a test-support exemption list and a `PathId` type wider than `MasteryId`; both are gone, and
  every table keyed by path (`MotifId`, `MASTERY_SET_FORMS`, `MASTERY_PALETTES`, `MASTERY_LOOKS`, the
  marks and colours) is keyed by `MasteryId`.

- **`maxLevel: 1` is a statement, not an unfilled field.** The things that cannot hold three levels
  are the binary immunities and the integer steps (+1 range, +1 radius, +1 taunt turn), and those are
  exactly the two side-tree starters of every path.
- The economy is **measured, not assumed**, in `treeEconomy.test.ts`: the cheapest closure to a
  capstone is **6 points on all fifteen paths**, which lands tier 3 at level 11 and the side tree at
  12; and capstone + raising it + a whole side tree is **exactly 15**. `masteryData.test.ts`
  brute-forces every legal build on top of that.

**The path is permanent; the picks inside it are not.** `partyStore.retrainMastery` clears
`masteryNodes`, keeps `masteryPath`, and recomputes points from the hero's *current* level — so a
hero who levelled since spending is made whole rather than refunded the older, smaller number. It is
sold at the Barracks (`cityServices.retrainCost`, per point spent, discounted by building level),
because the mastery screen is reachable from anywhere and a button that un-picks a build should cost
a walk into the city — the same argument that puts salvage in the forge and selling in the shop.
These are two different mistakes and only one is worth living with: *which discipline* decides a
hero's capstones, their re-tint and — since the weapon locks — what they may hold, while a point
misspent at level six is only punishing. Changing path is still refused outright.

`systems/progression/mastery.ts` derives everything from `hero.masteryNodes`: unlocked skills, passives, stat
bonuses and `MasteryModifier`s. Tree skills live in `data/skills/masterySkills.ts`, **separate from
`skillData.ts`**, so a path-exclusive skill can be tuned without a summon or an enemy inheriting
the change. `data/skills/skillData.ts`'s rule still holds: **shared skills stay neutral** — `slash`,
`arcane_bolt`, `bite` are used by enemies and summons alike (heroes' free attack is the weapon's).

Modifiers are baked into the unit's skill list once in `createPlayerUnits`, so the HUD, the
targeting highlights and the damage resolution all read the same numbers.

`MasteryScreen` is split in two: the exported `MasteryScreen` binds `partyStore` to a hero id, and
`MasteryView` takes a `Hero` plus `onChoosePath`/`onUnlockNode`. That split exists so the **tuning
harness** can drive the same view off a throwaway hero built from a `SimHeroConfig` — see below.
There is no separate mastery lab: it was the same view against a hero that could never fight, so
browsing a tree and testing it are one screen.

**Eleven of the twelve *main* trees are the pyramid; Wildshape is not.** `masteryData.test.ts`
therefore splits its rules between `MASTERY_PATHS` and `PYRAMID_PATHS`, and `wildshapeTree.test.ts`
keeps the branching honest.

The escape hatches below used to be Wildshape's alone. **They are not any more — the side trees put
all four in every path**, which is what makes them worth stating as vocabulary rather than as one
tree's special case:

- `MasteryNode.requires` / `requiresCount` replace the derived pyramid for a node. `requiresCount`
  below the list length is "any N of these", which the screen renders as a stub plus a sentence
  rather than a dozen converging lines. Two users now: Wildshape's Apex asks **any 2** of the twelve
  branch nodes, and every side-tree starter asks **any 1** of its path's three capstones.
- `MasteryNode.exclusiveGroup` is a **tag, not a list of ids on each side** — a group cannot be
  half-declared, which is the bug that would let a Druid be two animals. Three groups: `'capstone'`
  (all fifteen paths), `'side'` (all fifteen), `'shape'` (Wildshape).
- `MasteryNode.x` names a node's cell for drawing, fractions included. Tiles are absolutely
  positioned against that grid (`nodeCentre`), so a branch parent can sit over its own children;
  `treeWidthFor` measures the grid from the nodes rather than a constant.
- `MasteryPath.signatureSkill` may be `null`, in which case `bonusPoints` is what arrives instead.
  `pointsEarnedByLevel(level, pathId)` adds it — **flat, so it cancels out of `gainXp`'s
  level-to-level delta**, and `chooseMastery` is the one caller that passes a path. Wildshape is the
  only path with no signature, because choosing the animal is the question the tier exists to ask.

## Wildshape — the tree that is three trees

The Druid's `wildshape` path swaps silhouette, stats and kit together via
`combatStore.setWildForm`; forms are defined in `data/templates/wildForms.ts` and the rules are pure in
`systems/combat/wildshape.ts`. A shift skill cast while already in that shape reverts. Two rules the
stat profiles keep, both pinned by tests:

- **No `maxHp` in `stats`** — that field is shared with boss phases, whose triggers *are* HP
  thresholds. Health scales through `WildForm.vigor` → `CombatUnit.formVigor` → `combatMaxHp`
  instead, a separate field precisely so a boss profile cannot reach it.
- **No `speed` multiplier** — see the `turnOrder` note above.

Two rules the shift itself follows, both from playtest failures:

- **`combatMaxHp(unit)` is the pool being fought out of; `unit.stats.maxHp` is the hero's own.**
  Everything asking "how hurt is this unit" — every percentage passive, the health bar, the heal
  caps — must read the former, or a bear at 120/150 looks over-healed against a base of 100.
  `setWildForm` scales current HP by the *ratio* of the two vigors, so the fraction is preserved,
  a round trip is a no-op, and chained shifts do not compound. `applyVictory` divides it back out
  before writing to `partyStore`. `bossPhases` deliberately still reads `stats.maxHp`.
- **`shiftEndsTurn`: going in is free, coming back costs the turn**, and so does beast-to-beast —
  except entering Apex, free from any shape since the remaster (it holds three spells in three turns).
  Charging both directions made the path a net loss — a turn to arrive, a turn to leave — so the
  strongest thing a Druid could do with Wildshape was not use it, and self-healing upright
  out-tanked the Bear. Mana and the cooldown are still paid either way; what is free is the action.

The tree asks *what are you* before it asks anything else, and the answer reshapes it:

- **Tier 1 is three shapes, exclusive and permanent** (Bear / Wolf / Hawk). There is no signature
  skill — the path hands over the point instead, because a signature is a skill the path picks for
  you and choosing the animal is the entire question.
- **Tier 2 is twelve nodes, four per shape**, each fed by its own shape and nothing else: two
  skills it can learn and two ways of being better at it.
- **Tier 3 is three exclusive capstones** — Apex, Primal Surge and Ancestral Hunt (2026-10 remaster; they
  replaced Feral Heart and Primal Bond) — each gated on all four branch nodes of the shape held. Primal
  Surge and Ancestral Hunt are `anyForm`: on the bar in every shape, upright included. Apex is a three-turn
  shape with one use of each of its three spells and a long cooldown after it; see combat.md, *Wildshape
  remaster*.
- **Costs are the tree's own** (1 / 3 / 2 / 6, not the uniform 1 / 2 / 5). Shape + whole branch +
  Apex is 17 against the 16 a Druid ever holds: **one node always goes unbought**, and that is the
  decision the tier exists to force. Pinned by arithmetic, not by a gate.

Every shape carries exactly two skills innately — **a free basic attack with no cooldown, and a
signature**. The basic is load-bearing: a shape whose whole kit is on cooldown is a turn spent
walking, which is what a Hawk holding only Dive and Screech actually was.

**A shape has to be worth taking, and the Hawk was not.** At `attack ×1.1 / defense ×0.6` with no
`vigor`, against the Wolf's `×1.4 / ×0.9` and the Bear's `×1.25 / ×1.8 / vigor 1.5`, it was behind on
offence *and* the flimsiest thing on the board — and extra move range does not pay for that in a
61-hex arena. It is `×1.55 / ×0.7` now, with `talons` 1.0 → 1.25 and `dive` 1.3 → 1.85 (the last step,
1.15 → 1.25 and 1.7 → 1.85, from the playtest of 2026-10-24, which asked for ratios rather than defence
and widened the damage-per-turn band to ×1.45 to fit), which takes it
from worst on both axes to leading on damage per turn while staying the easiest to kill: the shape it
was always meant to be. `__tests__/progression/wildForms.test.ts` measures all four analytically
through the real `damageCalc`, the way `homeRing.test.ts` does — **the defence bump is documented
there as doing nothing at typical stats**, because `calculateDamage` rounds to a whole number and
0.6 → 0.7 on a Druid's 10 defence does not survive the rounding. The attack multiplier and the kit
did all the work; the multiplier is kept because it starts paying on a Druid who invests in defence.
Its model is registered at scale **0.75**, because unscaled its rig is the *tallest* of the three
(wings plus a raised head) and at 1.0 it read as a roc rather than a bird.

- `HeroSkill.formSkill` marks a skill as needing those paws. Learned form skills sit on
  `hero.skills` like everything else the tree grants — one list, one derivation — and
  **`skillsForForm` is the single place that decides which reach the bar**, including for the
  upright shape. `createPlayerUnits` routes the opening kit through it too, so there is no second
  filter to keep in step.
- Form skills cost **no mana**, always: summons and beasts are built against a mana pool they do
  not have, and the mana was paid at the shift.
- `skillDisplayName(skill, unit)` is why a shift button reads **"Druid Form"** while you are the
  bear. One button covers both directions of the toggle, so it has to name what pressing it does
  rather than the shape you are standing in.

## Advanced nodes

Every path, the three Monk paths included, has two or three **advanced nodes** past its capstones
(the private project notes, "Progression across expansions"). They are **tier 4**
(`ADVANCED_TIER`) and stand outside the pyramid the way a side tree does:

- **Gate.** Rows open by hero level, not by world: `BALANCE.MASTERY_ROW_LEVELS` is [21, 26, 31, 36],
  one row per level band, and a node names its row in
  `masteryRow` (absent is row 1; row 2 is the level-26 node, which each of the fifteen paths has one of,
  and the 31–36 rows stay empty until later worlds). A level-26 node is
  the same shape as a level-21 one (tier 4, `requires` the capstones, `requiresCount: 1`, three ranks
  unless it says otherwise; `NODE_MAX_LEVEL` stays 3), so a Corsair path adds its own the same way.
  `nodeMinLevel` reads it, and `canUnlockNode` refuses a node below its row's level with
  `level-too-low`, checked before prerequisites, so a level-20 hero is told about the level, not a
  capstone that would not open it. A hero who reached 21 in Jadeveil buys row 1 back in the Empire. Each names the path's three capstones in `requires` and asks for
  one (`requiresCount: 1`), or an advanced node that is itself behind one; a derived parent pair would
  be two capstones, which no hero can hold. No advanced node carries `capstone`, `side` or `shape`
  exclusivity, and no tier 1–3 node depends on one, so no second capstone, side tree or form becomes
  legal and every level-20 build is unchanged.
- **Points.** One point a rank, three ranks unless a node says otherwise. A level-25 hero holds 20,
  a level-40 hero 35 (one more on Wildshape); the points past 20 spend anywhere in the tree, so the
  advanced row competes with raising old nodes. Retraining recomputes from `pointsEarnedByLevel` as
  before.
- **Screen.** Sections of the **Side** tab (`sideLayout`): one framed row per row that has nodes,
  earliest first, under the two side trees and as wide as they are. Each frame is labelled with its
  own level (`advancedRowLabel`): "Unlocks at level 26" below it and "Level 26+" from it, so a level-25
  hero reads one row open and the next shut. The frames span the tab because a frame only as wide as
  its nodes put the level-26 label over its one node and, in Polish at 667×375 with the detail panel
  open, clipped the number off. Measured at 844×390 (2026-11-04, a stub row-2 node): the tree room is
  about 220 high, four rows draw 56 apart with 33pt nodes, and each label clears the row above by a pixel
  or two. **That is the room there is:** a third advanced row would leave its frame no room for a label, so
  rows 3 and 4 need another arrangement when they arrive. The whole tab still reads "Unlocks at your first capstone"
  without one, which the nodes also need. A node's detail panel reads "Any capstone, from level N" with
  its own level (`requires.advanced`).
- **Data.** Generated paths author them in the private project notes as tier-4 nodes, all rows;
  `scripts/mastery-trees.mjs` writes them after the side trees. Mantis is hand-written in
  `trees/mantis.ts`. A draft node names its row with `masteryRow`, which the generator writes out, row 1
  first (`MASTERY_DRAFT` and `MASTERY_OUT` run it on another draft). The editor draws each advanced row on
  a canvas row of its own (L21 to L36), so columns of two rows never meet, sets a node's row by dropping
  it there or in the inspector, budgets to the highest cap, and counts a node legal, and lets it be spent,
  only from its row's level (`opensAtLevel`, compared to `nodeMinLevel` by `masteryLab.test.ts`).
- **Pinned by** `advancedNodes.test.ts` for every path: two or three row-1 nodes, behind a capstone,
  each closed below its row's level (stub nodes exercise rows 2–4), row 1 opening at 21 in the Empire
  through `unlockMasteryNode`, all 15 points spent at level 20 without the row, and every point spent
  at each row level and band top (21–40) toward each capstone with exactly one capstone, some of the
  row, and whichever side tree and shape was picked. `masteryData.test.ts` runs its reachability
  walk and the unfinishable-tree rule at the same levels, with the row gate in the walk.
- **The level-26 node is pinned before it is authored.** The same suite runs every path with its
  level-26 node, or a stub while the path is on `AWAITING_LEVEL_26`: behind any capstone, shut at 25
  and open at 26 (through `unlockMasteryNode` too), every level-20 and level-25 build identical with
  the node in the tree and out of it, and every point spent at 26 and at 30 (25 points) with the node
  and exactly one capstone. The list holds exactly the paths without the node, so authoring one takes
  its path off, and a new path brings its node or goes on. `heroScreens.test.ts` pins the two frames,
  their labels in both languages and the fit at 844×390.

**What a level-40 hero can spend** (measured 2026-11-04, the input for the level-26 design; `room` is
every rank a build with one capstone can hold, over the side tree and shape picks where they differ):

| path | points at 40 | room | spare at the tightest pick | of which advanced ranks |
|---|---|---|---|---|
| Bulwark | 35 | 43–45 | 8 | 6 |
| Templar | 35 | 43 | 8 | 6 |
| Berserker | 35 | 43 | 8 | 6 |
| Pyromancer | 35 | 46 | 11 | 9 |
| Hydromancer | 35 | 44 | 9 | 7 |
| Stormcaller | 35 | 46 | 11 | 9 |
| Lifewarden | 35 | 46 | 11 | 9 |
| Stoneshaper | 35 | 44 | 9 | 7 |
| Wildshape | 36 | 40 | 4 | 9 |
| Marksman | 35 | 43 | 8 | 6 |
| Skirmisher | 35 | 41 | 6 | 4 |
| Shadowblade | 35 | 43 | 8 | 6 |
| Mantis | 35 | 46 | 11 | 9 |
| Firefly | 35 | 46 | 11 | 9 |
| Beetle | 35 | 44 | 9 | 7 |

**Every path can spend every point with exactly one capstone, at 30, 35 and 40, before any level-26
node exists**, whichever capstone, side tree and shape was taken. So the rows past 21 need not exist
for the points to have somewhere to go: a level-26 node competes for points rather than rescuing
them, and a three-rank one adds 3 to every row above. Wildshape is the tightest, with 4 spare, and
Skirmisher next, with 6.

### Champion

Each sits behind any of the path's three capstones, three ranks (authored number = rank 2).
Pinned by `combat/championAdvanced.test.ts` through `createPlayerUnits` and `resolveSkillUse`.

- **Bulwark.** *Rallying Taunt* (`bulwark_rallying_taunt`, passive `rallyingTaunt`): when a Taunt
  of the Bulwark's lands (`onTauntApplied`), every living ally within
  `ADVANCED_CHAMPION.RALLY_REACH` (2) hexes gains +3 / +4 / +5 Defense for a turn (a `DefenseBuff`
  of duration 2; merged by the stronger, so a many-target taunt steadies each ally once). Not the
  Bulwark itself: Braced owns its Defense buff. A boss that shrugs the Taunt off rallies no one.
  *Unbowed* (`bulwark_unbowed`): +3 / +4 / +5 Physical and Magic Defense.
- **Templar.** *Aegis of Faith* (`templar_aegis_of_faith`): `healGrantsDefense` 2 / 3 / 4 — anyone
  the Templar heals, itself included, gains that much Defense for a turn (the Lifewarden's Barkskin
  rule, read in `combatEvents.applyOnHeal`). *Crusader* (`templar_crusader`): +4 / +5 / +6 Attack
  and Magic.
- **Berserker.** *Red Mist* (`berserker_red_mist`, passive `redMist`): at or below
  `ADVANCED_CHAMPION.RED_MIST_AT` (50%) of fighting max HP, +9 / +12 / +15% critical chance, as a
  `statMod` so the sheet shows it exactly while it holds. *Gorge* (`berserker_gorge`):
  `lifestealBonus` 6 / 8 / 10% on every damaging skill, baked into the kit by
  `applyMasteryModifiers` so the skill's "Heals for N% of damage dealt" line shows it.

**Level 26** (`masteryRow: 2`, figures in `BALANCE.ADVANCED_CHAMPION`; same gate and shape as the row
above, one rank-scaled modifier each).

- **Bulwark.** *Dropped Guard* (`bulwark_dropped_guard`, modifier `tauntedExposure`): an enemy under
  the Bulwark's Taunt takes +6 / +8 / +10% from every direct hit, the Bulwark's own included.
  `combatStore.applyEffect` stamps the share on the Taunt, as Crumble's shred is stamped on a Root, so a
  refused Taunt carries none and it ends when the Taunt does; `mergeEffect` keeps the larger across
  re-applications, whoever's they are. `damageCalc.exposedMultiplier` adds it beside Exposed and the
  Beacon's light. Ticks and fixed bursts do not pass through that function and are not raised.
- **Templar.** *Carrying Word* (`templar_carrying_word`, modifier `allyHealSpill`): Smite's spilled
  heal also reaches the next ally of `combatEvents.allyHealOrder`, whose head is
  `allyHealRecipient`, for 45 / 60 / 75% of what was cast, not of what landed. With one ally
  wounded there is one heal. `applyAllyHealOnHit` returns a list, one outcome per ally. The second heal
  raises its own `onHeal`, so Aegis of Faith and Blessed Hands follow it, and Mercy raises both while
  Wrath heals no one. Smite's sentence states the second number for a Templar holding the node.
- **Berserker.** *Bottomless Thirst* (`berserker_bottomless_thirst`, modifier `thirstMissingBonus`):
  Bloodthirst is multiplied by 1 + bonus × the share of `combatMaxHp` missing, up to +30 / +40 / +50%
  near zero, so rank two is +20% at half health. `damageCalc.thirstMultiplier` is read beside
  `overloadMultiplier` in `calculateDamage` and in `skillDamagePreview`. No bonus while
  `AuraType.UndyingWindow` stands: at 1 HP it would sit at its maximum on top of Undying's own surge.

Verify in playtest: whether Rallying Taunt's ally Defense is worth a point beside Unbowed's self
Defense; Crusader's flat stats against Aegis of Faith's support; Red Mist stacking with Wrath, Killing
Eye and Undying's surge on a low-health Berserker; Gorge's lifesteal with Carnage's doubled hits. None of the
level-26 figures is measured yet: Bottomless Thirst is marked at risk, and Dropped Guard's value depends on
who else is fielded, so a Bulwark's own damage numbers will not show it.

### Arcanist

Each path's row builds on the combat rule it already plays: Burn's stacking ceiling and detonation
for the Pyromancer, Chill → Freeze (Brittle on a boss) and barriers for the Hydromancer, Shock's
single-hop jump and speed for the Stormcaller. Six new modifier keys carry them, each read where the
rule lives; `arcanistAdvanced.test.ts` pins them through `createPlayerUnits`.

- **Pyromancer**
  - **White Heat** (`pyro_white_heat`, `burnCapBonus` 0.3 / 0.4 / 0.5): a Burn pile this hero adds
    to caps at `MAX_BURN_MAGNITUDE` × (1 + bonus) instead of the plain ceiling. Read in
    `combatStore.applyEffect` (`burnCeilingScale`) off the incoming Burn's source, so the hand
    stacking it now sets the ceiling.
  - **Cataclysm** (`pyro_cataclysm`, `detonationBonus` 0.225 / 0.3 / 0.375): the bonus a detonation
    pays (`detonationMultiplier`) grows by that fraction on this hero's strikes; the strike under it
    is untouched.
  - **Pyre Heart** (`pyro_pyre_heart`): +3 / 4 / 5 Magic and `burnMagnitudeBonus` 0.15 / 0.2 / 0.25,
    so the pile reaches its ceiling in fewer casts.
- **Hydromancer**
  - **Permafrost** (`hydro_permafrost`, one rank, `freezeDurationBonus` 1): a Freeze this hero's
    Chill makes lasts `FREEZE_DURATION` + 1, and a boss's Brittle mark `BRITTLE_DURATION` + 1. Read
    in `combatStore.applyEffect`; a boss is still never frozen.
  - **Bitter Cold** (`hydro_bitter_cold`, `chilledDamageBonus` 0.1125 / 0.15 / 0.1875): more damage
    against a Chilled, Frozen or Brittle target, post-mitigation in `masteryTargetMultiplier`, read
    off the pre-blow target so the shattering hit counts.
  - **Glacial Bulwark** (`hydro_glacial_bulwark`): +19 / 25 / 31 HP and `shieldPowerBonus`
    0.1875 / 0.25 / 0.3125 on the barriers this hero grants.
- **Stormcaller**
  - **High Voltage** (`storm_high_voltage`, `shockChainBonus` 0.375 / 0.5 / 0.625): every Shock jump
    this hero's spells set off carries that extra share of `SHOCK_CHAIN_FRACTION`, added to
    Conductive Arc's (`shockJumpBonus` in `combatEvents`). Still one hop.
  - **Ionize** (`storm_ionize`, `shockedDamageBonus` 0.1125 / 0.15 / 0.1875): more damage against a
    Shocked target, in `masteryTargetMultiplier`.
  - **Quickening** (`storm_quickening`): +6 / 8 / 10 Speed and +3 / 4 / 5 Magic.

Verify in playtest: White Heat's raised ceiling against long boss fights; Permafrost's extra
frozen turn on ordinary enemies; whether Quickening's speed tips extra turns too often.

**Level 26** (row 2, one node a path, behind any capstone, three ranks; authored number = rank 2,
`BALANCE.ARCANIST_ROW_TWO`). All three pay little or nothing against a lone boss with nothing beside
it, which the owner accepted. Pictures are owed
(`NODES_AWAITING_ART`). `arcanistAdvanced.test.ts` buys each through `unlockMasteryNode`, refused at 25
and sold at 26, and fights with the hero the store then holds.

- **Pyromancer: Brimming Over** (`pyro_brimming_over`, `burnOverflowShare` 0.45 / 0.6 / 0.75): that
  share of the Burn this hero adds past the ceiling lands on the nearest enemy within
  `BURN_OVERFLOW_REACH` (2) hexes of the target that is not at the ceiling. Read in
  `combatStore.applyEffect` off the Burn's source, against the same `burnCeilingScale` `mergeEffect` uses, so
  White Heat delays the spill. A Burn starting a pile spills nothing, and only what arrived can spill
  when a pile already stands past this hand's ceiling. A spill is flagged (`spilled`, consumed by
  `applyEffect`, never stored) and never spills again, so what overfills its receiver is lost. Objectives,
  Burn-immune units and anyone else who would refuse the Burn are passed over for the next enemy in reach.
  A spill adds a stack to its receiver's pile, which Firemind and Spark read.
- **Hydromancer: Flying Shards** (`hydro_flying_shards`, passive `flyingShards`, `onHit`): once a turn
  (a `spend` key), the blow that breaks a Freeze or a Brittle mark (`isShatterable` of the pre-blow
  snapshot) throws 0.3 / 0.4 / 0.5× effective Magic at every other enemy within `SHARD_REACH` (1) hex of
  the target, fixed and through a Barrier, and lays a Chill (3 Speed, 2 ticks) on those not Chilled or
  Frozen. A break with nobody beside it spends nothing. A shard is ordinary damage to a neighbour, so it breaks
  a neighbour's own Freeze and charges that burst; it raises no `onHit`, so it never throws again.
- **Stormcaller: Forked Current** (`storm_forked_current`, `shockSecondHop` 0.45 / 0.6 / 0.75): a Shock jump
  hops once more, to the lowest-health enemy beside the first victim, for that share of the first jump.
  Never back to the struck enemy, never a third hop (`statusEffects.shockSecondHop`, from the jump block of
  `applyOnHitStatuses`). Conductive Arc and High Voltage raise the first jump, so they raise this. A
  companion's echo forks on its owner's node (`shockSecondHopShare`), the one modifier an echo reads off
  its owner, so an echo's first jump carries no High Voltage and its second hop does fork.

Verify in playtest: whether a shard's Chill makes a Blizzard's later blow in the same cast freeze too often.

### Druid

Five new modifier keys, read where each rule lives; `druidAdvanced.test.ts` pins them through
`createPlayerUnits`, the Wildshape one-shape rule, and `retrainMastery` at level 25.

- **Lifewarden**
  - **Overflowing Grace** (`life_overflowing_grace`, `overhealBarrier` 0.375 / 0.5 / 0.625): the part
    of a heal that put no HP back (`applyOnHeal`'s `amount` minus `restored`) becomes a Barrier on
    the mended unit for `OVERHEAL_BARRIER_TURNS` (3). Barriers do not stack, so it refreshes rather
    than piles.
  - **Verdant Hands** (`life_verdant_hands`): +9 / 12 / 15 % healing (`healPower`) and +2 / 3 / 4
    Magic. (Not `life_green_hands`: that id is a retired node whose drawn picture is on loan.)
  - **Evergreen** (`life_evergreen`): `regenMagnitudeBonus` 0.15 / 0.2 / 0.25 and +11 / 15 / 19 MP.
- **Stoneshaper**
  - **Deep Grip** (`stone_deep_grip`, one rank, `rootDurationBonus` 1): a Root this hero lays lasts
    one turn longer, stamped in `combatStore.applyEffect` beside Deep Cuts' Bleed. Crumble's shred
    rides the Root, so it lasts longer too.
  - **Crushing Weight** (`stone_crushing_weight`, `pinnedDamageBonus` 0.1125 / 0.15 / 0.1875): more
    damage against a Rooted or Stunned target, in `masteryTargetMultiplier`.
  - **Granite Mantle** (`stone_granite_mantle`): `shieldPowerBonus` 0.1875 / 0.25 / 0.3125 and
    +3 / 4 / 5 Magic.
- **Wildshape** (the one-shape rule is untouched: no advanced node grants a skill, a passive or a
  shape, or carries an `exclusiveGroup`)
  - **Deep Hide** (`wild_deep_hide`, `formVigorBonus` 0.09 / 0.12 / 0.15): the vigor of whichever shape
    is worn grows by that fraction, in `wildshape.wornForm` — on vigor rather than flat `maxHp`, so
    the victory write-back still divides it out.
  - **Fang and Talon** (`wild_fang_and_talon`, `formSkillDamageBonus` 0.1125 / 0.15 / 0.1875): the
    damage multiplier of every `formSkill` (the worn shape's innate pair, its bought skills, Apex's
    spells), pre-mitigation in `rawSkillDamage`.
  - **Feral Instinct** (`wild_feral_instinct`): +5 / 6 / 8 Speed and +5 / 6 / 8 % crit.

Verify in playtest: Overflowing Grace pre-shielding healthy allies before big hits; Deep
Grip's extra Root turn with Crumble; Deep Hide against Second Skin's save.

**Level 26** (row 2, three ranks each, behind any capstone; figures in `BALANCE.ADVANCED_DRUID`, unmeasured
until the band measurement). Pinned by the same suite through `createPlayerUnits`, each refused at 25.

- **Last Bloom** (`life_last_bloom`, `hotBloomShare` 1.2 / 1.6 / 2): a Regen (`AuraType.HealOverTime`) that runs
  out on a living unit heals once more, for that multiple of its tick. Read off the effect's `sourceUnitId` in
  `effectTick.tickEffects`, on the tick where `duration === 1`, so a re-cast, which refreshes the clock, never
  blooms, and a dispelled Regen does not either. It takes `healingReceived` and the phase ceiling, and like every
  tick raises no `onHeal`, so Overflowing Grace does not see it. Evergreen and Overgrowth raise it through the
  tick. The Lifewarden's own Regen on itself counts. A dose listed before the Regen that kills the unit takes the
  bloom with it; one listed after it kills a unit that has already bloomed.
- **Stone's Answer** (`stone_stones_answer`, passive `stonesAnswer`, 0.3 / 0.4 / 0.5 of Magic): the enemy that
  breaks a Barrier this Stoneshaper gave takes a certain physical blow, answered by Physical Defense, wherever it
  stands, and is Rooted for a turn (`STONES_ANSWER_ROOT_TURNS`). `combatStore.answerFromStone`, off the
  `brokenBarrierOf` follow in `damageFunnel` beside Rubble Recovery, with the breaker in `brokenBarrierBy`. So a
  tick, an expiry or a dispel never answers. Once per protected ally per Stoneshaper regular turn
  (`CombatUnit.stonesAnswered`); its own self-Barrier counts. The holder must be standing, and a duel bars the
  blow as it bars any outside hand, without spending the allowance. The Root goes through `applyEffect`, so it
  carries Crumble's shred, lasts longer with Deep Grip, and a boss refuses it and keeps the damage.
- **Second Nature** (`wild_second_nature`, `shapeSettledBonus` 0.03 / 0.04 / 0.05 a step): each regular turn begun
  in Bear, Wolf or Hawk adds a step (`CombatUnit.shapeTurns`, at most `SECOND_NATURE_MAX_STEPS`, 3), counted in
  `turnStart.beginRegularTurn` before the tick, so a stunned turn counts and a bonus turn does not. Each step adds
  that share of the worn shape's own Attack, Physical Defense and Magic Defense, in
  `getCombatEffectiveStats` beside Blood Howl and not in `formStats`, so the shape band and the rules against
  `maxHp` and `speed` multipliers stand. `setWildForm` zeroes it, so any shift resets it and a carried opening
  shape starts at none, its first regular turn being its first step. Upright and Apex never count. No skill,
  passive or `exclusiveGroup`, so the one-shape rule is untouched.

### Hunter

Each sits behind any of the path's three capstones, three ranks (authored number = rank 2) unless
noted. None grants a skill or changes one, so every skill preview and the Basic Attack the weapon
makes read the same with or without them; none touches what a path may wield. Pinned by
`combat/hunterAdvanced.test.ts` through `createPlayerUnits`, `resolveSkillUse` and
`critChanceAgainst`.

- **Marksman.** *Opening Volley* (`marks_opening_volley`): `highHpDamageBonus` 11 / 15 / 19% —
  more damage against an enemy above half health, picking it apart before it closes. *Eagle Eye*
  (`marks_eagle_eye`, passive `eagleEye`): +11 / +15 / +19% critical chance against an enemy
  carrying this Marksman's own Mark (the owner check `markMultiplier` makes); per target through
  `critBonusAgainst`, never a sheet stat. `PassiveDef.critAgainst` now also receives the attacker.
- **Skirmisher.** *Light Step* (`skirm_light_step`, one rank): +1 movement. *Open Seams*
  (`skirm_open_seams`, passive `openSeams`): +9 / +12 / +15% critical chance against an enemy with
  at least one of this Skirmisher's blades in it (`blades.ownBlades`), read as the strike rolls —
  not more for more blades.
- **Shadowblade.** *Coup de Grace* (`shadow_coup_de_grace`): `lowHpDamageBonus` 15 / 20 / 25% inside
  the execute window. *Unseen Blade* (`shadow_unseen_blade`, passive `unseenBlade`): +19 / +25 / +31%
  critical chance while Stealthed (Shadowstep, Vanish, an Assassinate kill), a `statMod`; the strike
  that breaks Stealth rolls with it, since `applyOnHitStatuses` lifts Stealth after the roll.

**Level 26** (row 2, `masteryRow: 2`, three ranks; figures in `BALANCE.ADVANCED_HUNTER`). Pictures are still
owed (`NODES_AWAITING_ART`). No save change. Pinned by the same suite, on heroes who bought the node through
`canUnlockNode` at level 26, each refused at 25 and each buying a 25-point build behind every capstone.

- **Marksman.** *Next Quarry* (`marks_next_quarry`, passive `nextQuarry`): when an enemy wearing this
  Marksman's Mark dies, the Mark passes to the nearest enemy without that Marksman's Mark within 2 / 3 / 4 hexes
  of the corpse, at its magnitude, for the turns it had left and at least 2 (`NEXT_QUARRY_MIN_TURNS`). Trigger `onDeath`, in
  `combatStore.spreadMark` beside `spreadSpark` and `spreadVenom`, so a poison tick's kill passes it too, even a
  last-turn Mark that tick dropped (`knownMark`). A Basic Attack that cashed the Mark removed it before the blow,
  so that kill passes nothing. Ties go to the lowest health, then id. An objective, a sealed or suspended enemy and
  one the Mark would not land on (immunity, Debuff Immunity) are skipped, and so is an enemy already wearing this
  Marksman's Mark, so a pass is never wasted. Another Marksman's Mark does not count and merges by the ordinary
  rule. With no enemy left that qualifies, nothing passes and the Mark is spent.
- **Skirmisher.** *Buried Steel* (`skirm_buried_steel`, modifier `bladesCapBonus` 1 / 2 / 3): this Skirmisher's
  blades cap at 6 / 7 / 8 in one enemy instead of 5 (`blades.bladesCapOf`, read by `combatStore.embedBlades`).
  Each Skirmisher's pile keeps its owner's cap. Blade Recall pays for every blade pulled; Barbed Blades stops at
  its own `amplifiedBy.max` and Open Seams at one blade, so neither gains. The text behind
  `displayNumbers.bladesCap` takes the unit, so the fight's skill panels say the unit's own cap; the mastery
  tree's skill previews have no unit and say the plain 5, and the node's own line states the new cap.
- **Shadowblade.** *Into the Dark* (`shadow_into_the_dark`, passive `intoTheDark`): each kill this unit's blow
  makes brings Shadowstep's cooldown 1 / 2 / 3 turns forward (`onKill` through `applyOnHitStatuses`, a
  `refundCooldown` outcome with `onlyIds`), so rank three against its cooldown of 3 is a full reset. A poison tick
  and the Assassinate execution do not fire `onKill`. A step that kills with its own blow had no cooldown running
  when `onKill` fired, so `resolveSkillUse` brings that one forward right after starting it. The step still costs
  its action and its mana.

Verify in playtest: Light Step's whole hex for one point against Open Seams' three ranks; Eagle Eye
with Quarry and Rapid Fire's burst on a Marked target; Unseen Blade's crit on Vanish's payoff and
with Lethality's crit damage; Coup de Grace beside Assassinate's own execute. Level 26: Buried Steel's deeper pull against
a lone boss, with one rank at 6 as the approved fallback; Into the Dark's reset with Unseen Blade's crit.

### Monk

Three per path at level 21 and one at level 26, each behind any capstone. Figures are
`BALANCE.MONK_ADVANCED` (the level-26 nodes: `BEETLE`, `FIREFLY`, `MANTIS`) and the formulas in
`passiveFormulas`; the rules are pinned by `monkAdvanced.test.ts`, which also buys each path as a legal
20-point build toward every capstone, and with its level-26 node as a legal 25-point one.

**Beetle** (protection)

- **Shell Ward** (`beetle_shell_ward`, passive `shellWard`): at the start of each Beetle turn every
  living ally beside it gains a Barrier of 0.225 / 0.30 / 0.375 × (Physical + Magic Defense) for two
  turns (raised from 0.20 at rank two by PT-04, 2026-10-22; verify in playtest). Barriers merge as the stronger, so it tops up a worn one and never shrinks a Shell Wall.
- **Ironbound Shell** (`beetle_ironbound_shell`): +3 / +4 / +5 Physical and Magic Defense, which
  also feeds every defence-scaled Barrier.
- **Rooted Stance** (`beetle_rooted_stance`, one rank): the existing `immovable` passive, immune to
  Root and push.
- Verify in playtest: Shell Ward on top of Shoulder to Shoulder may make the
  Beetle's neighbours too hard to kill.

**Firefly** (hybrid utility)

- **Searing Light** (`firefly_searing_light`, passive `searingLight`): Glowmote's bolt lays Defense
  Down 4 / 5 / 6 on both defences of the enemy it hits, through that enemy's next turn (`onHit`, the
  stronger of two stands).
- **Shared Glow** (`firefly_shared_glow`, modifier `healRestoresMana`): every ally the Firefly
  heals — the mote, the bond and the casts — regains 3 / 4 / 5 mana or chi; never the Firefly itself
  (`combatEvents.applyOnHeal`).
- **Radiant Core** (`firefly_radiant_core`): +3 / +4 / +5 Magic and +6 / +8 / +10 heal power.
- Verify in playtest: whether Shared Glow's chi on a Monk ally is worth a point next to Steady Flame.

**Mantis** (bounded combo movement)

- **Reaping Stride** (`mantis_reaping_stride`, passive `reapingStride`): a Twin Reap that hits and
  spent the turn's action leaves a free step of 1 / 2 / 3 hexes, through Slipstream's reposition.
  **Once a turn** (a `spend` key): another action in the same turn earns no second step, a bonus
  turn (Threefold Scythe, Mantis Execution) is a turn of its own, and Root or no free hex grants
  nothing. The step never exceeds the last entry of `REAPING_STRIDE_STEP`.
- **Stalking Rush** (`mantis_stalking_rush`): the existing `momentum` passive — a move gives
  critical chance through the next turn.
- **Honed Edges** (`mantis_honed_edges`): +2 / +3 / +4 Attack and +19 / +25 / +31 critical damage
  (armour penetration stays with the four paths `armourPen.test.ts` names).
- Verify in playtest: Reaping Stride with Mantis Execution's kill turns (each turn its own step).

**Level 26** (row 2, `masteryRow: 2`; three ranks; the figures are not measured yet)

- **Beetle: Returned Blow** (`beetle_returned_blow`, passive `returnedBlow`): when a full Carapace
  soaks a blow, the attacker takes 0.75 / 1 / 1.25 × Attack wherever it stands, a certain blow (no dodge,
  no critical) answered by Physical Defense. `settleDamage` passes the attacker to
  `combatStore.carapaceSoaked`, and the blow is `beetle.returnedBlow`, in Retribution's shape. It needs an
  attacker: damage that only names a source spends the set and answers nobody. At most once per full set,
  and the neighbours' shield the 2026-10-28 rework took off the soak stays off. A Beetle whose full set
  soaks a blow it took for an ally answers twice, Retribution beside this.
- **Firefly: Spilled Light** (`firefly_spilled_light`, passive `spilledLight`): the part of Glowmote's
  mote that restores nothing strikes the enemy the bolt struck, for 45 / 60 / 75% of that part, fixed.
  `combatEvents.applyMote` compares the mote with what landed; with no recipient at all the whole mote
  counts. With Twin Motes the larger of the two gaps counts, never their sum, and a second mote that found
  nobody is not a gap of its own, so one hurt ally pays by its own heal. It goes straight through
  `damageUnit`, so no bond heal, mote or Steady Flame follows, and a dodged bolt sends no mote and spills
  nothing.
- **Mantis: Reaper's Breath** (`mantis_reapers_breath`, passive `reapersBreath`): a reap returns 4 / 6 / 8
  chi (`REAPERS_BREATH_CHI`), so a 14-chi reap costs 10 / 8 / 6. A dodged cut reaps nothing and returns
  nothing. The reap owes it and the resolver pays it after the cast's own price: chi is paid after the
  blows, so a refund paid as the Bleed closes would be lost to the pool's ceiling on a full pool.
- Verify at the band measurement: Spilled Light on a healthy party at rank three with Brighter Motes;
  Reaper's Breath against the chi that bounds Mantis Execution's chain and the capstones.

## City buildings: distinct roles

The six roles were approved on 2026-10-02 and implemented together. Construction costs,
Forge services and the Library XP ladder stay as before. Base services are available at level 0.

| Building | Level 0 | Level 1 | Level 2 | Level 3 |
| --- | --- | --- | --- | --- |
| Barracks: deployment and mastery retraining | Default starts | Swap heroes’ starts | Swaps plus one hero off the starting hexes | Freely arrange the party in the friendly area |
| Shop: everyday outfitter, Cut gems and equipment selling | 6 Common/Rare families | 8 | 10 | 12 |
| Forge: craft and maintain exact equipment | Common | Rare | Epic | Mastery legendaries and skill-bonus rerolls |
| Tavern: recovery, recruitment and expedition meals | Base services; no meal | Meal: 25% dawn healing | Also full-HP rations | Also +10% ordinary loot and better equipment odds |
| Library: permanent XP investment | +0% XP | +10% | +20% | +30% |
| Market: resource exchange at weekly rates | Buy/sell spread ×1.55 | ×1.40 | ×1.25 | ×1.15 |

### Service rules and prices

**Barracks:** deployment is a standing privilege, with no fee. All real encounter entries share
CombatScene’s initialization, including lairs, sieges and each castle stage. Planning happens
after the intro and before the first turn: select a hero, tap a legal highlighted hex, then
Confirm deployment. Occupied friendly hexes swap the two heroes. Default restores every start.
The original speed order and action flags survive confirmation; neither ticks nor enemy AI
start early. Level 2 allows at most one hero outside the original starting-hex set, so swaps
do not spend the reposition privilege. Moving that hero back frees it for another hero.

The area is a connected expansion of authored friendly starts by one hex, clipped to the
playable arena, no more than one hex ahead of the friendly front edge and at least two hexes from every enemy.
Scenery and water are cosmetic outside the playable field; future blocked terrain must be
removed from the legal-hex input to deployment. The rule rejects enemy, missing, dead and
out-of-area placements. Mastery retraining still refunds picks, never the path, for
`max(1, ceil(60 × pointsSpent × (1 - 0.15 × barracksLevel)))`; an empty reset costs nothing.
There is no drill state or stat bonus.

**Shop:** Common/Rare equipment at every level. Stock is sampled without replacement over
form × motif families, then a silhouette, using the week and building level as the seed.
Consecutive weeks rotate the rack; reloads in the same week reproduce it without saved stock.
Offers stay at party item level; repeat purchases still roll their own affixes. Asking prices
use the existing 2.5 multiplier and rarity floors. Equipment selling (single and bulk) and
Cut gems remain available. Epic gear comes from crafting and loot; mastery legendaries from
crafting and dungeon chests.

**Market:** trades only Wood, Stone, Iron and ordinary Crystal, never equipment, Seals or
Obsidian Crystals. Seeded weekly sell bases remain 4/5/12/40 gold with ±35% swing and are
independent of level. Buy = max(sell + 1, round(sell × spread(level))), so immediate resale
always loses gold. No equipment shelf or purchased-stock save state remains. Each row buys or sells
one unit or a lot of ten at the same rate (playtest 2026-10-14); a lot is disabled until the purse or
the stock covers all ten.

**Tavern:** recruitment costs 50 gold at every level. Ordinary rest costs
`max(1, ceil(summedPartyLevel))`; a ration costs `max(1, ceil(0.33 × calculatedRestPrice))`.
These services no longer receive level discounts. Rest restores HP and mana, including the
fallen; recruiting, rations and dismissal retain their existing rules and access gates.
A new campaign starts with `STARTING_RATIONS` (1) in the bag (`inventoryStore.reset`). Rations are
a bag stack, eaten outside combat from the bag's ration panel (the world map's or a location's Bag)
or the hero sheet, both through `hooks/feedHero.ts` over `eatRation`; with none left the stack
leaves the bag, and the rations tip says where to buy them. Food is drawn as the `ration` loaf mark in
`RATION_COLOR` on the map, the sheet and the Tavern row.
Rest advances to the next dawn through normal rollover (healing, daily encounters and weekly
resource/well recharge). The paid rest then fills effective HP/mana. A warning names the
tribute shortfall after the bed price before sleeping into an unpaid bill; accepting recalls
the party for the usual siege. Active meals affect an ordinary dawn and expire before the
first dawn of the next week. Prices ignore Tavern level and missing health.

A purchased expedition meal stores its tier and the current week; it expires at the next
week boundary, including ordinary travel rollover and reload. Later upgrades do not backdate
its effects. Tiers are cumulative: tier 1 increases dawn healing from 15% to 25% of effective
max HP; tier 2 makes rations restore full HP outside combat; tier 3 adds 10% to looted gold and
ordinary resources and shifts the random equipment rarity die by ten percentage points.
Daily healing and rations never revive; rations do not restore mana. Only a magic well and a Tavern
rest revive, and every text that refuses a fallen hero (the ration refusal) or offers the bed names
that: "A magic well or a Tavern rest brings them back". The rarity ceiling,
party equip legality, item-level roll and authored guaranteed boss rewards remain unchanged.
Chest random rolls and exploration finds also receive the applicable benefits.

Full-week meal price is `3 × tier × summedPartyLevel` gold. Multiply by remaining hours / 168,
round up and floor at 1. For summed level 12, full-week prices are 36/72/108; with one hour
left all three cost 1. Rebuying an active equal/lower tier is refused without charge or expiry
extension. A higher-tier replacement costs the full prorated new-tier price, shown before
purchase, and keeps the same week boundary. The counter shows active effects, replacement
effects, price and expiry. Tier-3 fractional resource bonuses use unbiased stochastic rounding
so a three-Wood find gains 0.3 Wood on average. Resource sales, salvage, crafting, quest payouts,
Seals and Obsidian Crystals never enter the loot-bonus function. XP and guaranteed items are
unaffected. Meal constants live in balanceConstants; seeded measurements and landscape-phone
evidence are in the feature record.

**Forge and Library:** existing crafting, upgrades, salvage, reforge, gem work and skill-bonus
rerolls are unchanged; XP still uses the +10% per Library level multiplier. Building hints
call the same deployment, assortment, meal and spread functions that enforce the rules.

### Upgrade costs

Each cell is the cost of reaching that level from the preceding one, in the order
**Gold / Wood / Stone / Iron / Crystal**. There is no construction charge at level 0.
`src/data/templates/buildingData.ts` is the source and `cityStore.upgradeBuilding` charges it.

| Building | Reach level 1 | Reach level 2 | Reach level 3 |
| --- | --- | --- | --- |
| Barracks | 40 / 16 / 8 / 0 / 0 | 100 / 33 / 25 / 8 / 0 | 205 / 50 / 40 / 25 / 4 |
| Shop | 33 / 12 / 8 / 0 / 0 | 80 / 25 / 16 / 4 / 0 | 165 / 40 / 33 / 16 / 4 |
| Forge | 50 / 8 / 16 / 8 / 0 | 115 / 16 / 33 / 20 / 0 | 230 / 25 / 50 / 40 / 8 |
| Tavern | 40 / 20 / 4 / 0 / 0 | 90 / 40 / 12 / 4 / 0 | 180 / 65 / 25 / 12 / 4 |
| Library | 50 / 16 / 12 / 0 / 0 | 105 / 29 / 25 / 8 / 2 | 215 / 40 / 40 / 20 / 8 |
| Market | 25 / 16 / 4 / 0 / 0 | 125 / 33 / 20 / 8 / 2 | 245 / 50 / 37 / 20 / 6 |

## Items

Items are generated, not authored: **form × motif**. A *form* is a silhouette
(`voxel/items/forms.ts` geometry + `data/items/itemForms.ts` metadata — slot, class lock, stat tilt); a
*motif* is a treatment (`voxel/items/motifs.ts` palette and decor). Rarity is a property of the
motif. `data/items/itemGen.ts` produces the cross-product, `data/items/itemTemplates.ts` bolts on hand-written
uniques, and `systems/economy/forge.ts` decides what is craftable. An armour form's silhouette is the
piece its builder in `voxel/items/armour/` dresses a hero with — one builder per weight, slot and
motif, drawn on the body and in the bag alike; see *Worn armour* in models.

**A motif flavours a form; it may never out-vote it.** `combineTilts` clamps every stat's share to
the form's own top stat, and `motifWeight` runs in three tiers derived from data that already exists
(`isMasteryMotif`, `MotifSpec.elemental`) rather than a list of names: material 0.2, elemental 0.35,
mastery 0.5. Without the clamp a single-axis motif captured a third of an item's whole budget on an
axis the item has nothing to do with — an Iron Throwing Blade came out `+2 attack, +1 speed, +2
defense` against the plain one's `+3 attack, +1 speed`, so a Hunter's *upgrade* traded away the only
stat their weapon exists for. It is `+3/+1/+1` now. **Mastery motifs are clamped too**: `bulwark` is
`{defense: 4, maxHp: 4}` and the Bulwark's set weapon is a warhammer, so exempting them ships a
legendary hammer whose largest stat is armour. `primaryStats` returns a *list* because `band` and
`fetish` genuinely tie, and holding the tied stats down to one arbitrary winner would delete the
treatment rather than temper it. `itemTilt.test.ts` sweeps every form × motif pair.

**How a motif treats a held item is read off the outfit cards, and it is `MotifSpec.held`.** A
motif's two colours cut every shape's materials by that shape's own card's factors, and what they
cannot say is `HeldTreatment`: fittings forged in a colour of the motif's own (plain, bronze and
gold in their accent, holy in its gold, storm in its navy), a leather where the accent is not one
(holy and storm brown, silver near black), a caster's haft drawn dark under a claw of the body's
colour (fire, ice, runed, silver, storm), plain's wood (its staves, bows, quivers, totems and shield
faces), leaves on the Druid's branch and totem (and on everything in nature), a bare blade for the
four metals, a quartered round shield for bronze, gold and holy, storm's blue stone and runed's lit
sigils. Iron, the item cards' motif, sets none. Evidence and the decisions behind each field:
the private project notes.

- **Only a held item reads it**: worn armour, jewellery and a tinted unique build exactly as they do
  without it, and `heldTreatment.test.ts` proves all three. A unique's tint was chosen for the
  whole item.
- **A held item is built from its motif in the fist and in the bag alike** — the rig hands
  `buildForm` the item's own tint and nothing else (see the private project notes).
- **`formPalette` resolves a form's colours in a motif once**, for `buildForm` and for
  `heldMaterials.test.ts`, which measures every shape's ladder in the colours its builder is handed.
- **A stone glows exactly when its motif has a light**, on all six staves (`stoneGlows`); a focus
  is a light in every motif, a gem-only motif's lit from its gem taken toward the card's light; a
  flame is never a gem.
- **Decoration on a held item follows the cards**: a quiver's, totem's and bow's jewel on the face
  the hide and vestment cards put it (`DecorOpts.gem`), no crown jewel on a shape that sets its own
  stone, a glowing fuller on every held blade but a metal's, a quiver fletched in its gem.
- **Strings are linen in every motif**: the item cards measure it, and all seven hide cards draw a
  dark string alike, so it is not a motif's treatment.

Legendary exists only as the mastery sets (one motif per path, `masteryLock`ed), Jadeveil's four
collections ([below](#jadeveil-equipment)) and the hand-written uniques. Set pieces stay out of
`rollLoot`, but the **dungeon chest can drop them** — the forge is how you finish a set, the chest is
how you get surprised by one.

**Every instance carries a saved `itemLevel`, and it is also a legendary's whole upgrade track.**
`data/items/itemLevel.ts` is the curve: a template's `modifiers` are its stats at its rarity's
`BALANCE.ITEM_LEVEL_ANCHOR`, and an instance at level `L` carries `(OFFSET + L) / (OFFSET + anchor)`
of its anchored stats — base and affixes together — rounded per stat and **floored at one point**,
so the staircase is monotone, keeps the order of an item's own stats (form primacy survives) and
never rolls an affix dead. The level never gates equipping.

- **The level is baked into `modifiers`**, the way affixes already were, and
  `itemFactory.itemAtLevel` re-derives from the template and the affixes rather than rescaling
  rounded numbers — so two routes to one level agree, and every level change (a Crystal, and later
  the forge) goes through it.
- **An acquisition that names no level mints at the anchor**, which is the catalogue's own numbers.
  Every source in the game now names one, and `systems/economy/itemLevelSources.ts` is the two
  answers they choose between:
  - **Ground** — combat drops, lair chests and the castle chest take the fight's band and depth
    (`BALANCE.BAND_ITEM_LEVEL`, ramped toward the next band, ±`DROP_ITEM_LEVEL_SPREAD`), or the
    run's Seal tier (`levelCap() - MAX_SEAL_TIER + tier`, the Seal ladders' one rule,
    `sealLadder.ladderItemLevel`, which the summit's chest reads too). Band 4's deep end meets castle tier 1, so
    the overworld and the gauntlet do not step. A lair chest reads its `LairSpec.band`, never its
    door — `curatedBand`'s argument. An expansion world's ground is its content level instead: see
    [Jadeveil equipment](#jadeveil-equipment).
  - **The party** — the shop, the market, the forge and quest rewards mint at the mean hero level;
    starter kit and a path's first weapons are *issued* (`issuedItem`, no affixes) at the hero's
    own level, so a recruit joining at ten is not handed level-one iron.
  - **`sellPrice` rides the same curve** (`levelledSellPrice`), so the shop's and market's markups
    hold at every level rather than only at the anchor, and `forgeCost` scales by the level the
    craft lands on. **Asking prices rise with rarity** (`economy/pricing.ts`, `askingPrice`): each
    rarity is scaled to its own anchor, so the plain markup let a common two-hander out-price a
    rare one-hander in the shared weapon slot; the ask is floored one gold over the dearest
    lower-rarity piece of the slot at that level. The *sell* side is left on the raw curve — it
    prices the stats actually carried, and a common two-hander really does carry more than a rare
    one-hander — so buy stays above sell, but sell prices can still cross between rarities. **A counter row is the purchase, not a preview of it**: the shop, the market
    and the forge render `itemFactory.offeredItem` — `mintItem` rolled from a seed keyed on the
    counter (the market's week; the shop's and forge's week plus how many copies the party owns)
    — and the button adds that exact object. `previewItem` priced a row off base stats while the
    press rolled affixes and sockets, so the tag and the thing bought differed. Seeded rather than
    random so reopening a counter cannot reroll it for free, which would make the forge's paid
    affix reroll pointless. `itemPresentation.test.ts` fails a component that calls `mintItem` or
    `previewItem`.
  - **`itemDisplay.itemTitle` heads an item everywhere**: name (with any legendary +N), `Lv N`
    and socket pips (`◆` filled, `◇` empty). The bag, stash, sell list, comparison, rewards and
    quest payouts named an item with no level, the forge put it on the stat line and two screens
    showed sockets, so one piece read three ways. The same suite fails a bare `{itemDisplayName(…)}`
    heading and a hand-spelled `Lv {x.itemLevel}`.
- **An ordinary random roll leans toward the party** (`BALANCE.PARTY_LOOT_BIAS`, 0.7). The draws
  are strictly nested — rarity, slot, *whose*, then *which* — and *whose* is **one hero drawn
  uniformly**, not the party: narrowing to what anybody could wear gave each hero a share
  proportional to their class's forms, and a Champion beside a Druid took 62% of the
  class-specific drops. The bias only picks among pieces of
  the rarity and slot already rolled and can never make a rare commoner or a helm likelier; the bias
  die is thrown whether or not a party is passed, so `lootLevels.test.ts` states that as an equality
  per seeded roll. A pool nobody in the party can wear falls back to the whole pool rather than
  losing the drop. **Which piece is a form first, then a template of it**, so a silhouette with more
  motifs or named variants does not become the commonest thing on the ground (`lootForms.test.ts`).
  Authored loot tables take no bias. The chest's legendary branch leans toward what one hero,
  drawn uniformly, can wear, rather than toward the chosen paths — which gave a recruit still
  short of their path nothing. **A lair's chests are not that lottery any more** (`rollLairChest`):
  the first holds exactly one Legendary and the second exactly two Epics, each rolled for one named
  hero dealt round-robin from a shuffled party (so two Epics go to two heroes when there are two),
  with the Epic's slot chosen among slots that hero can wear in. A hero with no path yet may have no
  wearable Legendary, so that piece goes to the next hero who does; only a party with none falls back
  to any Legendary. Both chests then fill to `CHEST_ITEMS` with ordinary rolls. The castle's final
  chest keeps `rollChest`.
- **A legendary always drops at its source's ceiling**, read at the call, whatever level it is handed:
  the cap in force (`levelCap()`) in the Empire and for repeatable content, and the band's top for an
  expansion world's story content (`mintItem`'s `ceiling`). That story legendary then shows +0 and takes
  Crystals up to the cap + 5, as an Empire legendary does when the cap rises. **Its "+N" is N item levels past that cap**: each Obsidian Crystal raises it one level, up
  to `maxItemLevel(Legendary)` = `levelCap() + MAX_UPGRADE_LEVEL`. When the cap rises to 25 an old
  +2 (level 22) reads as an ordinary legendary below the new drops, with Crystals left to spend, and
  its stats stay its own level's ([the effective level cap](#the-effective-level-cap)). Above its anchor a legendary
  climbs a steep segment, `1 + LEGENDARY_LEVEL_STEP` (0.15) per level, so a +5 is ×1.75 of what
  dropped; the ordinary curve is nearly flat up there and made it ×1.18. The segment starts at the
  legendary *anchor*, not the cap in force, so the scale is a function of the level alone — tied to
  the cap, raising it would slide the segment under a legendary already past the old one and its
  next Crystal would re-derive it weaker than its baked numbers. There used to be a separate `upgradeLevel` multiplier beside the level (+15% per step, so a
  +5 was ×1.75); it is gone, because two numbers saying how strong one piece is are two things the
  sheet, the comparison and the forge could disagree about. `upgrades.upgradeSteps` reads the +N off
  the cap *in force*, so raising the cap for a new map reads an old +3 as an ordinary legendary of
  its level, lifts its ceiling, and mints new ones higher. The legendary anchor is a literal 20
  rather than the cap, so none of that re-derives an old piece as weaker. Anywhere an item name is
  rendered should use `itemDisplayName`, which appends the +N — an unlabelled +3 is invisible value.
- **`Item.itemLevel` is required**, so every place an instance is built has to say its level — the
  compiler is what checks "every acquisition persists one". `SAVE_VERSION` 21 added it and 22 dropped
  `upgradeLevel`; `isLoadable` refuses a save holding an item whose level is missing, fractional or
  past its rarity's ceiling rather than patching it.
- **`systems/progression/itemStats.effectiveModifiers` is the only answer to what a worn item
  adds** — baked `modifiers` plus fixed socketed gem bonuses applied afterward, so no level can
  multiply a gem. `statCalc` — and therefore combat —
  `modifierDelta` and every modifier line go through it; `economy/itemLevel.test.ts` measures the
  sheet, a combat unit, the comparison and the item lines agreeing on one +3 legendary.

**Sockets belong to an item instance and gems are stackable until socketed.** `mintItem` rolls
capacity once from `BALANCE.GEM_SOCKET_WEIGHTS`; `sockets` is an array whose length is permanent
capacity and whose `null` entries are empty. Two equal gem ids in it are valid. `itemAtLevel` and
Crystal upgrades preserve it, and the save gate refuses missing or malformed socket data at
`SAVE_VERSION` 24. `data/items/gems.ts` maps Ruby, Sapphire, Jade and Amber to Attack, Magic, % of
maximum HP and Speed; Cut, Brilliant and Spirit values live in `BALANCE.GEM_BONUS`, outside the levelled modifiers.
Jade is a percentage (`maxHpPercent`, 2% Cut and 5% Brilliant) since the playtest of 2026-10-14, which asked
for health buffs to be percentages: `statCalc` adds gear's percentage to the mastery's and applies it last.
Loose gems are bag entries, one stack per gem id (`BagEntry` of kind `gem`); the city stash keeps
its own gem count record, and a lost siege clears only the bag's. Combat rewards roll a gem
independently of equipment; shops sell Cut gems. Setting and taking out happen in the bag, merging at
the Forge; each charges gold and checks the full cost before a single store update. `economy/gems.test.ts` pins the probability table, save shape, duplicate math and
failure behavior.

**Each expansion brings a gem tier of its own, and the tier's power follows its world's band;
Jadeveil's is Spirit.** `GEM_TIERS` is Cut, Brilliant, Spirit (designer, 2026-10-22), ids `${kind}_${tier}`
(`ruby_spirit`, English "Spirit Ruby", Polish "Duchowy rubin"), twelve ids in every gem stock since
`SAVE_VERSION` 68. A tier's **grade** (`gemGrade`) is the band its world took, read from the ledger
through `levelCap.worldBand`, which `worldBandStore` pushes, because the data layer imports no store;
grade 1 until the world has a band. A world's band never changes and gems never leave their campaign,
so every gem of a tier in a campaign has one grade, nothing is stored per gem, and `SAVE_VERSION` did
not move. `gemBonus` is the one reader, so the bonus text, the socket lines, `effectiveModifiers` and
combat all agree. `BALANCE.GEM_BONUS.spirit` is a table by grade, each row one point over two gems of
the row below, the least that keeps a merge up from losing stats; `GEM_WORLD_TIER_GOLD` is the merge's
price by grade, doubling as its inputs do. Starting values, to verify in playtest:

| grade (Jadeveil's band) | Attack, Magic, % HP | Speed | merge gold |
|---|---|---|---|
| 1 (first world) | 11 | 7 | 240 |
| 2 | 23 | 15 | 480 |
| 3 | 47 | 31 | 960 |
| 4 | 95 | 63 | 1,920 |

`GEM_TIER_WORLD` ties a tier to its world (`spirit` → `jadeveil`; Cut and Brilliant to none), and
that one table decides both ways a Spirit gem is had:
- **Merging, once the world has a band.** The Forge's `mergeGem(kind, tier)` takes `GEM_CUT_INPUT` gems
  of the tier's source (`gemMergeSource`) for `gemMergeGold(tier)` — `GEM_CUT_GOLD` 120 into Brilliant,
  the grade's price into Spirit — and refuses a tier whose world has no band (`gemTierOpen`), which
  means the first crossing into it, not just an open gate. A world's tier merges from the tier of the
  world one band below it; if that world has no tier yet, from the highest tier below that exists,
  and Brilliant below them all (`gemMergeSourceIn`, pure over any table of tiers). Spirit is the only
  world tier that ships, so its source is Brilliant at every grade until a second arrives. The bench
  reads the ledger live through `useWorldHasBand`. Before then the bench draws no Spirit rows at all — not a locked row — as
  the gate never tells an unowned campaign of a road it cannot take; once offered, the Merge column grows a
  tier switch (below), the bench's line becomes `economy.gem.mergeBenchSpirit`, and the tab's ◆ badge
  also calls for two Brilliants of a kind.
- **Dropping, only in its own world.** `rollRewardGem(chest, world)` rolls a world's own tier
  (`worldGemTier`) first, at `GEM_WORLD_TIER_CHANCE.jadeveil` — 5% of a Jadeveil fight's gems, 15% of
  a boss chest's or a summit's, starting values to verify in playtest — then Brilliant at its
  `GEM_CHEST_BRILLIANT_CHANCE` on a chest, Cut otherwise. The Empire's rolls are the same draws as
  before Spirit existed and never pay one. `combatRewards` passes the fight's world.

Shops still sell Cut only. `GemMark` draws a Spirit stone edged like a Brilliant inside a faint halo
of its own colour until its voxel sheet (`ui:gem_<kind>_spirit`, awaiting review in `uiPaths.test.ts`)
is approved; bag, stash, reward row, socket lines and the Handbook read names and bonuses from the
tables, so they need nothing of their own. The Handbook's gems page states all three tiers, both merge
prices and the Jadeveil drop rates for every campaign, as its Jadeveil page does, at this campaign's
grade, and says the grade follows when Jadeveil's road was taken.
`economy/spiritGems.test.ts` pins the ids and bonus table, grades 1 and 2 with the bonus text and the
socketed stats agreeing, band-order merging over a stub tier in either order, no loss on any merge at
any grade, the refused and paid merges by grade, Empire-never and Jadeveil-first drops (through
`victoryRewards` too) and the twelve-stack save shape. Later tiers (`abyssal`, `astral`, `regal`) arrive with their worlds:
worlds and expansions, *Equipment across worlds*.

**Gems are set from the bag, free; taking one out and merging are the Forge's, for gold.** Common gear, the starter kit included, never
has a socket, so a first gem usually fits nothing the party carries. `economy/gemGuide.ts` reads
what the party carries (worn or in the bag). The victory screen shows a found gem as one loot row: its
name, its bonus "when set in a socket" and a "Gems ›" link to the Handbook's gems page, which holds
where gems are set, the prices and which rarities have sockets (read from `GEM_SOCKET_WEIGHTS`). The
bag keeps one state line over its grid (`gemStateText`) and the gems page's Handbook link. Picking a
gem lists every carried piece with an empty socket, worn pieces included and left worn, each with
`gemSetPreview` (the piece's effective stat before and after) and Set, free, wherever the party is;
a piece lists its set gems and says they come back out only at the Forge. The Forge's Gems tab is the
paid gem bench: merging two gems of a kind into one of the tier above for `gemMergeGold` (Spirit only
once Jadeveil is open, above), and Take out for every set gem on a carried piece, worn or not, for
`GEM_RECOVER_GOLD`, over one line (`mergeBenchText`) and the Handbook link; its tab carries a ◆ badge
while a merge is possible. **One tier at a time** (playtest 2026-10-22: with Spirit open the Merge
column listed eight rows and scrolled at 844×390): with more than one tier open, a switch heads the
Merge column (`city.forge.gems.tier.*`, each with a ruby in the tier's look while there are two), and
the four kinds sit two by two below it, opening on the tier the ◆ called for. Each merge and each
Take out is one plate press (`GemTile`): the gem and its name, then for a merge the gem it spends with
the pouch's count and what the new gem adds (`city.forge.gems.tileLine`), for Take out what the gem
gives, where it is set and who wears it, and the price; the confirm dialog says the rest. The Merge
column takes three fifths of the width. Captured on 2026-11-03 in the web preview at 844×390 and
932×430 (the latter at the web's 1.25 interface scale), English and Polish, both tiers, with two set
gems: every merge, both tier switches and the Take out column are on screen without scrolling, nothing
is cut with an ellipsis (a gem name over 16 characters steps down a size: "Bursztynowy brylant" at
932×430), and every press is at least 44 pt (`TOUCH_MIN`). With a stand-in third tier the head still
holds "Łączenie" and three switches at 932×430 in Polish once the switches drop their ruby, which
they do from a third tier on. The designer chose this split on 2026-10-18: setting costs nothing so a found gem goes in at
once, and the gold is in undoing it, which needs a trip to town. Salvaging a piece (one or Salvage
all, city or camp) hands its set gems back to the bag free (`salvage.setGems`, playtest
2026-10-23b): the item panel lists them, both prompts count them and the toast says how many came back. The Shop's Gems tab sells cut gems with the link instead of a rule line.
`economy/gemGuide.test.ts` pins the starter kit having no sockets, the three cases, the preview, the
short lines, and that only `BagPanels.tsx` calls `socketGem` and only `ForgeCounter.tsx` calls
`recoverGem`; `economy/bag.test.ts` pins free setting into a worn piece and paid taking out.

**A two-hander is budgeted for both hands** (`itemGen.itemBudget`, main-hand plus off-hand), and
the generator, the affixes, the forge recipe and its level upgrade all read it. At one-hander
budget the greatsword was one attack over a short sword and strictly worse than the short sword
and second weapon it displaced. `itemProgression.test.ts` pins that a two-hander out-hits every
legal one-hander at early, mid and late gear, and that a dual pair leads it by under 15% — the
pair's advantage is its two procs. The tuning record is in the private project notes.

**A held form comes in named silhouettes, and a silhouette is geometry and a noun and nothing
else.** `voxel/items/variants.ts` lists each weapon's and off-hand's variants (`FORM_VARIANTS`, base
first and spelled as the form) and their builders (`variantShapes.ts` for the weapons, and
`offhands.ts` for the off-hands, their variants and the jewellery); the `items` catalog names them
(`noun.<variant>`, read through `itemText.variantNoun`). A Falchion is a short sword to `canEquip`, to the stat tilt and to the
Basic Attack — none of those tables is keyed by a variant, which is the whole contract.

- **`Item.variant` is the identity, and it rides the instance.** Every generated held template
  carries one and `mintItem` spreads it onto the item, so the save, `visualFor`, `equipmentKey` (and
  therefore the geometry cache), `ItemIcon`'s raster cache and the voxel lab all read the exact
  silhouette. A base variant keeps its old template id (`short_sword_iron`) so the starter kit, the
  path grants and authored loot tables are untouched; any other is `<variant>_<motif>`.
  `SAVE_VERSION` 25 added it, and `isLoadable` refuses a variant its form does not come in.
- **More silhouettes may not mean more drops.** The loot roll is already form-first, and the shop stocks form × motif *families* (`templateFamily`, `familiesOf`) and then pick one
  silhouette of the family, so a bow drawn three ways is no likelier on the shelf than a helm drawn
  one. Pinned as rates in `__tests__/economy/itemVariants.test.ts`.
- **Legendary set pieces and the authored uniques keep their one silhouette.** A set is one look
  per path, so it is minted in the base variant only; the forge falls back to it when the chosen
  silhouette has no set recipe. **A set's weapon and off-hand are that one silhouette drawn as the
  set card draws it**, not the form recoloured: `voxel/items/sets/` keys a piece on its form and its
  path's motif, and the form still decides everything else — the size, the hand, the carry, the
  stats (see *Legendary set pieces* in models). All twenty-three set weapons and
  off-hands are drawn so, the Druid's three branches and three totems each their own set's.
- **A variant has to be told apart at icon size**, the smallest it is ever seen: the intersection
  over union of two siblings' 18-cell icon masks stays under 0.8 (`__tests__/voxel/itemVariants.test.ts`).
  The heater shield and the scroll first came out at 0.86 and 0.80 and were redrawn rather than
  excused. Rebuilt to their cards, the tower shield and the pavise are the closest pair at 0.79: both
  cards draw a tall board, and what parts them is the ends, the tower's clipped top and narrowing
  foot against the pavise's posts and plinth. **A bow's icon is its profile** (`FormGeom.iconSide`):
  front-on every bow was a stick.

**A hard mastery weapon lock, per path.** `MASTERY_WEAPON_FORMS` in `data/items/itemForms.ts`
states the weapons each of the fifteen paths carries and `canEquip` refuses everything else — so a
path that *gains* a weapon has to say so, rather than a path that loses one having to be
remembered. Before a path is chosen nothing narrows, the same rule shields already followed.

- **A set is not a vocabulary.** `MASTERY_SET_FORMS` is seven pieces of legendary art, two of them
  weapons; reading the lock off it would say a Berserker holds a war axe and a short sword and
  nothing else for the whole campaign. The table is authored, and `equipRules.test.ts` holds it to
  the shape the sets imply — every set weapon appears in its own path's list, every listed form
  belongs to the path's class, and every path can hold the iron it is handed at level 5.
- **The Hunter is where it came from.** A Skirmisher throws blades and fights at a spear's length; a
  bow let it opt out of every risk its damage is priced against. Arcanists and Druids keep both of
  their implements, because two forms is the whole class vocabulary and splitting it one-each would
  make the lock the only thing separating three paths.
- **The Shadowblade carries daggers and the sabre, and nothing that leaves the hand** — the same
  argument one path over. It is two blades and a gap it has to cross on foot, and the throwing blade
  it used to keep was the identical opt-out the bow was for the Skirmisher: a ranged answer on a
  path whose whole damage profile is priced against having to be *there*. The sabre is a longer
  blade and no reach of flight, so it widens the path without breaking it, and it dual-wields like
  the dagger. The set list needed no change; it never carried the blade.
- **Five forms arrived with the named variants, each for exactly one class or path**: the flanged
  mace (Bulwark and Templar), the sickle (all three Druids, a physical `blade` strike), the lantern
  (an Arcanist `focus`), the sabre (Shadowblade) and the throwing axe (Skirmisher, `thrown`).
  `newWeaponForms.test.ts` pins *who else may not* rather than who may, because a sabre a Marksman
  could hold is the lock quietly undone.
- **The Monk's main hand is locked until a path** (`equipRules.mainHandLocked`). Its starter kit is
  plain hand wraps and plain vestment chest, legs and feet. The `hand_wraps` form makes the `fist`
  Basic Attack: melee, one hex, 1.0× Attack, blunt, where the empty-hand `unarmed` blow stays at
  0.5×. While `masteryPath` is null, `canEquip` refuses every new main-hand piece (wraps may only
  bind an empty hand) and `canUnequip` refuses to empty the slot, so the screens hide the unequip
  badge and refuse with a notice. A path opens the hand, and the path sweep below moves the wraps
  to the bag. The wraps come only in `plain`.
- **On choosing a path, the path hands out its iron weapons and illegal gear goes back in the bag.**
  `masteryIssue` (`data/items/itemTemplates.ts`) names the issue: the path's weapons
  (`MASTERY_STARTER_WEAPONS`) and nothing else: no path issues armour (playtest 2026-10-17, PT-03 —
  the Monk's iron chest, legs and feet were more than any other class was handed). A Templar's epic
  cuirass stays on; a Beetle's plain vestment goes to the bag and the slot stays empty. `chooseMastery` equips the issue, returns what it replaced to the bag, then
  sweeps `illegalSlots`, so nobody is left barehanded. **A hand that already holds something the path
  may carry keeps it**, at any rarity, and nothing is minted for it (playtest 2026-10-23, PT-05): only an
  empty hand or one the path forbids is filled. A dual-wielder's second weapon still replaces a legal
  shield, quiver or focus in the off-hand; the off-hand issue is skipped beside a kept two-hander, and a
  newly issued two-hander bags a kept off-hand. Leaving illegal gear equipped makes the lock
  a lie; deleting it is theft. Nothing is destroyed — `equipment` is a map of ids and unequipping
  is a matter of forgetting one.

**Gear is shared between classes: class locks are lists, and armour weight is a path vocabulary.**
The rule from the Monk on (the Monk plan): classes share
weapons and armour, and only the legendary mastery sets are locked to one path.

- **`classLock` is a `HeroClass[]`** on forms, templates and items, `OFFHAND_CLASS` maps a kind to a
  list, and `MOTIF_CLASS` maps a motif to a list. `canEquip` accepts any listed class and names them
  all when it refuses ("Only Champions and Monks can use…"); `itemWearerLine` reads "Champion or
  Monk · Beetle" on rare plate. Affix pools (`itemAffixes.affinityClasses`) admit an affix that
  suits any listed class. `SAVE_VERSION` 54 changed the stored shape.
- **`MASTERY_ARMOUR_WEIGHT`** (`data/items/itemForms.ts`) gives each path one weight: every
  original path its class's, the Beetle plate, the Firefly vestment, the Mantis hide. Armour's class
  lock is derived from it, so plate names the Champion and the Monk, hide the Hunter and the Monk,
  vestment the Druid and the Monk, and robe the Arcanist alone. `canEquip` refuses armour outside
  `wearableWeights` — the path's weight, or before a path the union of the class's paths', all three
  for a Monk — **at every rarity, common included**: a common piece carries no class lock, but its
  weight is asked of the wearer, so an Arcanist wears no plain plate and a Beetle no plain hide
  ("Arcanists do not wear plate." before a path, "Your mastery does not wear hide." after). The
  four original classes' starter armour is their paths' one weight, so this takes nothing off them;
  the Monk's apprentice vestment is re-dressed by the path issue, and the path choice's sweep
  (`illegalSlots`) bags any other piece in the wrong weight, such as a common hood. Loot's party
  lean (`wearableByParty`) asks the same rule, so a common piece in another weight is no longer
  counted as for everybody, and the shop's and forge's wearer line (`itemWearerLine`) names the
  weight's wearers on common armour ("Champion or Monk · Beetle") rather than "Anyone".
  Every item card names the armour weight or off-hand kind beside the rarity ("Rare · Plate
  armour", `itemRarityKind`); every counter adds which heroes in the party could wear the piece
  (`partyWearerLine` over `equipRules.couldWear`); and the gear tab says what the hero wears
  (`heroWearsLine`, from `wearableWeights`, the path's weapon forms and `offHandKindsFor`) — all
  playtest 2026-10-30.
- **The Monk's three legendary sets** (the private project notes, "Equipment rules"): the
  Beetle's **Hornshell** plate — helm, cuirass, greaves, sabatons, pendant and greatstaff, six pieces
  with no off-hand; the Firefly's **Lanternwing** vestment — four pieces, pendant, a lantern crook on
  the staff form and a lantern, seven; the Mantis's **Bladeleaf** hide — four pieces, pendant and the
  claw handblade, one recipe crafted twice, six (`MASTERY_SET_FORMS`). The claw is legendary and
  `canEquip` lets a hero wear only one of a legendary, so a Mantis wears one claw and a lesser blade in
  the other hand — whether the second claw should be allowed is to verify in playtest
  (the Monk plan). Each is locked to its path
  (`masteryLock`, the only gear the Monk does not share), forges at the level-3 set bench once the
  party has the path, and rolls its bonus from that path's skills (`setBonus.ts`). Tilts
  (`itemGen.MOTIF_TILT`): the Beetle both defences and health, since its Barriers scale from its
  defences; the Firefly magic first; the Mantis attack, crit and armour penetration, the fourth
  executioner. `achievementEquipment` counts six-recipe sets as the Shadowblade's. Their models are
  in models; tests `monkSets.test.ts` and the
  shared set suites.
- **Every material motif that names the Druid or the Arcanist names the Monk** (runed, fire, ice,
  storm, nature, holy), so a Monk can be handed jewellery at every drop rarity. Set motifs stay
  single-class; their `masteryLock` is the real gate.
- **Every path is a `MasteryId` for the item rules.** `PATH_CLASS` gives every path's class for the
  item tables, pinned against `masteryData`. The set tables (`MotifId`, `masteryLock`,
  `MASTERY_SET_FORMS`, the looks and their palettes, `MASTERY_MOTIFS`, `SET_PIECES`) key on it, and
  `itemForms.setFormsOf` is every path's set; `setBonusPool` answers empty for a path with no tree.
  Colours, glyphs and marks: icons.
  `lootPool.test.ts` holds every class, the Monk included, to a rare and an epic for every slot and
  jewellery at every drop rarity, its hands counted through its paths.
- **The Monk's weapons: two new forms and the Arcanist's shared** (the private project notes,
  "New forms"; pinned by `monkWeapons.test.ts`). The **greatstaff** (`twoHanded`, `blunt`) is the
  Beetle's only weapon, so a Beetle holds no one-hander and no off-hand. The **handblade** (`main`,
  `blade`) is the Mantis's only weapon, and the Mantis joins `DUAL_WIELD_MASTERIES`, so it holds two.
  The **Firefly** gains no form: `staff` and `wand` name the Monk beside the Arcanist, the `focus`
  kind does too, and `OFFHAND_MASTERIES.focus` keeps it to the Arcanist paths and the Firefly the
  way shields are kept to two Champion paths — so the Firefly holds a staff and a lantern and no
  Druid branch or totem. **Unlike a Champion's shield, the focus waits for the path**
  (`equipRules.OFFHAND_NEEDS_PATH`): a Monk with no path holds nothing in the off-hand, and choosing
  the Beetle or the Mantis bags a focus. Other classes' pre-path off-hands are unchanged. The path
  issue (`MASTERY_STARTER_WEAPONS`, keyed by every path) is an iron greatstaff; an iron staff and
  lantern; two iron handblades. `equipRules.test.ts` now holds every non-common item to at most one
  of the four original classes and to somebody, since the Monk shares theirs.
- **Each Monk form has two silhouettes** (`voxel/items/monkKit.ts`): the greatstaff, a pole
  shod in heavy iron knobs at both ends, and the Ringed Staff, a loop with two rings on a spiked
  foot; the handblade, a bracer worn on the forearm with a long curved claw running from high on its
  face down past the fist (the Mantis sheet), and the Crescent Blade, the same bracer under a
  half-moon from past the elbow to below the fist; the hand wraps, linen turns with hanging tails in the body's own
  forearm linen, and the Cestus, the wraps under a studded iron knuckle bar (both drawn only as items:
  on the body the hand stays empty, `FormGeom.bareHand`). Icon masks part every
  pair (closest greatstaff / ringed staff 0.71) and each form from its nearest other form at the
  variant ceiling of 0.8 (greatstaff / spear 0.72, handblade / short sword 0.75); the knobs are
  cut wide on purpose, since at icon size a plainer pole is the spear. The wraps and the handblade
  are punched (`rigAnimations.STABBING_FORMS`, the stab), the greatstaff comes down overhead like
  a hammer and is carried planted (`carry.ts` `POLE`), and the wraps hang plumb so their tails do.
  The handblade is **worn, not gripped**: the fist closes on a bar inside the bracer's frame, and
  `carry.ts` `WORN_BLADE` leans it back along the guard stance's forearm (`rigs.armRest`) so the
  bracer lies on the forearm and the claw bows forward past the fist (`monkWeapons.test.ts` pins
  the bracer above the fist, the blade below it and the lean). The Mantis's set claw is built on
  the same bracer (`monkKit.clawBracer`, `clawBlade`).
  Captures and the verdict: the Monk weapons record.

**Seven stats past the five that are just bigger numbers**, each consumed by exactly one system:
crit chance and crit damage (`damageCalc`), `lifesteal` (`calculateLifesteal`, so gear drains on
the at-will swing that has never carried the field — and on spells: the drain never asks a hit's
type, so a Vampiric staff heals its caster from magic damage; the sheet stat is capped at
`MAX_LIFESTEAL` 40%), `manaRegen` (`combatStore.tickEffectsOnUnit`,
flat rather than a percentage of a small pool), `healPower` (`calculateHealing`), `shieldPower` and
`poisonPower` (`damageCalc.resolveEffectMagnitude`, on the resolved value so flat and fractional
authoring both scale). **The last three are three stats and not one "power" on purpose** — folding
them together puts a Lifewarden and a Stoneshaper back on the same loot table, which is the
complaint rather than the fix. `itemDisplay` marks the percentages as percentages;
`skillEffectLines` says what the caster's gear adds *on the skill it adds to*.

**Penetration is two stats**, also gear-carried and Epic-and-up only (`itemGen.RARITY_GATED_STATS`):
`armourPen` ("Armour Pen", ignores that share of Physical Defense on physical hits) and `magicPen`
("Magic Pen", the same against Magic Defense on magic hits) — see *Physical and magic damage* in
[combat.md](combat.md). The hero sheet shows them as separate tiles, "Armour pen" and "Magic pen";
tooltips, the equip comparison and the forge read them through `itemDisplay` as "Armour Pen" and
"Magic Pen", both marked as percentages. Mastery `statBonus` pen is all `armourPen` (the four
martial killers' trees). Martial set motifs carry `armourPen` in `MOTIF_TILT` (Berserker, Marksman,
Skirmisher, Shadowblade); the caster sets mirror them with `magicPen` on the **Pyromancer** (at the
Berserker's weight, 3) and the **Stormcaller** (the Skirmisher's, 2). The Hydromancer carries none
— it is the caster's Bulwark, and its pen is Killing Frost's — and the Pyromancer and Stormcaller
pieces gave up about a point of Magic for it.

**Pen and lifesteal are priced to be felt** (`itemGen.STAT_PER_POINT`, save version 50). They were
`armourPen: 0.4` and `lifesteal: 0.25` per budget point, which made a legendary helm's Vampiric +1%
and its "of Ruin" pen +2%. They are now `armourPen` / `magicPen: 1.4` and `lifesteal: 1`:

- **Lifesteal**: a point of HP buys 4 health once; 1% lifesteal returns about 3 over a fight of ~8
  turns at ~40 damage a turn, so one percent a point is the fair price. Vampiric is now legendary
  helm 4, cuirass 6, one-hander 7, two-hander 11; epic 3–4 (two-hander 7); rare 1–2. "of the Leech"
  dropped its lifesteal weight from 2 to 1, so it is Vampiric's lifesteal plus its attack (legendary
  helm 4 + 4 attack) rather than a +23% two-hander. `MAX_LIFESTEAL` caps a kit forged to drain on
  every slot (about 70% uncapped).
- **Penetration**: a point of attack is about one point of a hit, a point of pen DEF × 0.4 / 100, so
  against a late 40–80 defence a point of attack is worth 4–8% pen; 1.4 stays under that because pen
  stacks toward a cap that deletes most of a defence. Sundering / Piercing (and the pen half of of
  Ruin / of Unmaking, same weight) are now legendary helm 6, cuirass 8, one-hander 10, two-hander 16;
  epic helm 4, one-hander 6, two-hander 10. Set pieces carry 2–4 apiece instead of 1.
- Commons never roll an affix and neither pen reaches below Epic, so early gear is unchanged.

**Affixes are what make two Frostbound Long Swords two swords.** `data/items/itemAffixes.ts` —
twenty-two named riders, eleven prefixes and eleven suffixes, rolled at acquisition and spending a
share of the item's own budget.

- **Pen riders follow the class.** Sundering (prefix, `armourPen`, Champion / Hunter) and of Ruin
  (suffix, `critDamage` 2 + `armourPen` 1, Champion / Hunter / Druid) are the martial half; Piercing
  (prefix, `magicPen`) and of Unmaking (suffix, `critDamage` 2 + `magicPen` 1) are the Arcanist's.
  All four are Epic and up. of Ruin used to be any class, which handed an Arcanist's cowl Armour Pen
  it could never spend.

- **Commons stay clean, always.** They are the baseline the stat budget is read from.
- **A prefix and a suffix**, never two of a kind: a name has room for one of each. A rare rolls the
  suffix alone, because a suffix says what the piece is *for*.
- **Names never borrow a mastery path's name** unless the piece is that path's set (`masteryLock`).
  The shield-power suffix was "of the Bulwark", and a Bulwark player looted a Druid circlet that
  seemed to be theirs; it is `of_the_aegis` now (save version 26). `itemAffixes.test.ts` reads the
  twelve names from `MASTERY_PATHS` and fails any affix, non-mastery motif adjective or template
  name that carries one it is not locked to.
- **The forge's reroll shows numbers.** `affixRerollPreview` (`economy/forge.ts`) gives the current
  affix's gain on this piece and each candidate's, as the piece's modifiers with the affix minus
  without it, both through `itemWithAffixes` — so the bench states exactly the change `rerolledAffix`
  will make (`forgeWork.test.ts` checks that for every affixed template). Below a rarity's anchor
  level an affix on a stat the piece already carries can round to nothing; the bench then reads
  "no effect at this level" as a fallback. It should not occur now: `affixedModifiersAt` holds a
  vanished affix up one point (only when the rounded result would equal the bare piece's), so an
  affix is never a dead roll at any level; `forgeWork.test.ts` sweeps levels 1–30 for it.
- **Never a dead roll.** Affinity is derived — class lock, then off-hand kind, then motif — so no
  item is told what suits it. Both penetrations name an Epic floor, or `budgetToModifiers`'s
  "give it something" fallback would hand out a token point below the tier that may carry it.
- **`mintItem` in `systems/economy/itemFactory.ts` is the acquisition answer; `itemFromTemplate` is
  the catalogue one.** A second function rather than a flag, because the forge preview, the shop
  rack, the equip picker's legality check and the sim harness all want an item that does not
  re-roll itself every render — the forge showing one thing and producing another is the single
  comparison that building exists to support.
- Stats are baked into `modifiers`, so `statCalc` and `effectiveModifiers` need know nothing.
  `Item.affixes` records *which* riders they were, and `itemName` says them in the name when shown.

**An item carries no words.** Neither a template nor an instance has a `name` or `description`
(save version 64): `itemName(item)` and `itemDescription(item)` in `data/items/itemText.ts` build
them when shown from the template id, form, motif, variant and affixes, in the current language.
A generated name is the motif's pattern around the form's or variant's noun (`items.motif.<motif>.pattern`,
or `items.implement.<motif>.pattern` for iron, steel and silver on a caster's tool — `usesImplementWord`
in `itemGen.ts`), with the prefix affix's pattern in front and the suffix's after. An authored
legendary is its own proper name (`items.unique.<id>.name`). A generated piece's description is its
motif's flavour line. Gem names, bag kinds, Basic Attack lines, slot and rarity names, modifier
labels and the wearer and set-bonus lines are in the same namespace, each read through a helper beside
its table (`gemName`, `bagKindName`, `weaponAttackVerb`, `slotLabel`, `rarityName`, `modifierLabel`).
Polish agreement is described in localization, "Generated names".

**A legendary set piece rolls a bonus to one skill of its own path** (`data/items/setBonus.ts`),
once, at acquisition. The pool is the path's signature plus every skill a node grants, read off
`MASTERY_PATHS` rather than authored. A **miss is build-relative, never path-relative** — it names
a node this particular build skipped, and the point budget guarantees skipped nodes exist. It rides
`MasteryModifier.skillPowerBonus` and is applied in `applyMasteryModifiers`, the funnel
`createPlayerUnits` already bakes once, so the HUD, the targeting and the damage all read one
number. It scales the skill's **multiplier**, not the finished damage: a post-mitigation bonus
would be worth wildly more against armour than against paper, which is armour penetration's job.

- **`maxForgeRarity` opens a tier at the *bottom* of the scale.** It read `>= 3 → Epic`,
  `>= 2 → Rare`, so levels 0 and 1 crafted the identical tier and the forge's first upgrade bought
  nothing a player could do. Moving it down a rung leaves level 3 with nothing to say, which is
  where the reroll bench lands: `MASTERY_SET_FORGE_LEVEL` gates crafting a set piece *and* re-aiming
  its bonus for `BALANCE.SET_BONUS_REROLL_COST`.
- **A reroll never returns the skill it started with.** A price with no product reads as the bench
  being broken rather than as the dice being unkind.

### Mythic items

**A mythic is a legendary set piece minted with `Rarity.Mythic`**, from a mastery set or a world
collection (`canBeMythic`, `data/items/setBonus.ts`). Standalone legendaries, boss-only items and
authored weapons are not set pieces and are never mythic. Its template, stats, level, affixes,
sockets, skill roll, Crystal track, salvage and price are its legendary's. `isLegendaryGrade`
(`data/items/rarity.ts`) is the one funnel every rule asks: the anchor of 20 and the steep segment,
the Crystal ceiling and +N, the set skill bonus and the forge's reroll of it, salvage and Ink, the sell
price, "only one may be worn" (which reads the template, so a mythic and its own legendary may not be
worn together) and the affix gates. `RARITY_RANK` puts it above legendary, and `RARITY_SCALE`,
`GEM_SOCKET_WEIGHTS` and `ITEM_LEVEL_ANCHOR` equal legendary's. `mythicRarity.test.ts` mints every
set and collection template both ways from one seed and finds them equal at every level from 20 to 45.

**Only bosses offer one, because the catalogue holds none.** Every template is at most legendary, so a
mythic exists only as an instance: `mintMythic` (`systems/economy/itemFactory.ts`) throws `mintItem`'s
dice in `mintItem`'s order and changes the rarity. Shops, markets, the forge's craft list and quest
rewards read templates and cannot name one, and a save's validation accepts it through the same tables.
The boss drop below is the one acquisition that calls `mintMythic`; development builds also reach a
mythic through the Save Creator's item browser, which stores a piece as `mythic:<templateId>` in a
recipe slot, behind `SAVE_CREATOR`.

**The boss drop.** `rollBossLoot` rolls it first, at most one a kill and inside the legendary count, so
it takes a Legendary's place as a boss's own item does; a kill whose only Legendary is the mythic rolls
no boss-only item. Only a boss beyond the Empire rolls (the lair bosses, and the orb boss at every tier), plus Aethelred.
`mythicRollFor` (`systems/economy/mythicDrops.ts`) answers `null` where `contentLevel` does (the Empire
and a siege), and the roll is carried in `LootOptions.mythic`, which nothing but a boss reads, so chests,
guards, non-boss fights and the Empire's dice are untouched.

- **Aethelred is the Empire's one exception**, by the designer's decision of 2026-11-04; the Troll, the Dragon and
  the Heart of Winter never drop one. He rolls at the same chance as any boss (`aethelredMythicRoll`), at his
  castle tier. His loot has no world band, so tier 1 reads band 1 and a higher Seal tier reads the current
  cap's band, as repeatable loot does elsewhere. He counts toward the counter, and his piece comes from a
  mastery set, since the Empire's pool holds no collection.
- **The chance** is `mythicChance(band, tier)`. The band is the loot's (`levelBand` of the content's
  ceiling): a story boss reads its world's band, and a Storm Seal tier, minting at the cap, reads the
  newest band. A lair boss is tier 1, and so is Kairen's free story-tier refight.
- **The piece.** A hero is chosen fairly among those with a set piece of this world's pool they can
  wear that the party does not hold as a mythic, then one of their pieces. Held means anywhere: worn, in
  the bag or on the city's shelf (`heldMythics`). A piece held only as a legendary can still come as a
  mythic. It mints at the content's ceiling, as its legendary would.
- **The bad-luck counter** (`mythicStore.kills`, saved as `mythicKills`, from `SAVE_VERSION` 87) counts
  eligible kills since the last mythic, across worlds, and a defeat leaves it alone. The kill that brings
  it to `COUNTER_CAP` always pays, and any mythic resets it. A kill with no piece left for anybody is not
  eligible: it throws no die and does not count. The reward holds the counter's next value and
  `applyVictory` banks it when the dialog closes, as it does the Ink.

**The tuning** (`mythicDrops.test.ts`, seeded; the test pins properties and `MYTHIC_AUDIT=1` prints this
table, from 20,000 real boss rolls a cell with the party's holdings emptied at each drop, so it measures
the rate and not the pool running dry). `BALANCE.MYTHIC`: `BASE_CHANCE` 6.3%, `PER_BAND` 1.6 points,
`PER_TIER` 4.725 points, `COUNTER_CAP` 15.

| Loot band | Boss tier | Chance per kill | Kills to first, mean | Kills to first, median | Mythics per 100 kills | Share forced by the counter |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 6.3% | 9.8 | 11 | 10.2 | 40% |
| 1 | 2 | 11.0% | 7.5 | 7 | 13.3 | 20% |
| 1 | 3 | 15.8% | 5.9 | 5 | 16.9 | 9% |
| 1 | 4 | 20.5% | 4.8 | 4 | 20.8 | 4% |
| 1 | 5 | 25.2% | 3.9 | 3 | 25.6 | 1% |
| 2 | 1 | 7.9% | 8.9 | 9 | 11.2 | 31% |
| 2 | 2 | 12.6% | 6.8 | 6 | 14.6 | 15% |
| 2 | 3 | 17.4% | 5.4 | 4 | 18.6 | 7% |
| 2 | 4 | 22.1% | 4.5 | 3 | 22.4 | 4% |
| 2 | 5 | 26.8% | 3.7 | 3 | 26.9 | 1% |
| 3 | 1 | 9.5% | 8.0 | 7 | 12.4 | 25% |
| 3 | 2 | 14.2% | 6.4 | 5 | 15.5 | 12% |
| 3 | 3 | 18.9% | 5.0 | 4 | 20.0 | 5% |
| 3 | 4 | 23.7% | 4.2 | 3 | 24.0 | 2% |
| 3 | 5 | 28.4% | 3.5 | 3 | 28.6 | 1% |
| 4 | 1 | 11.1% | 7.4 | 6 | 13.5 | 19% |
| 4 | 2 | 15.8% | 5.8 | 4 | 17.2 | 9% |
| 4 | 3 | 20.6% | 4.7 | 4 | 21.1 | 4% |
| 4 | 4 | 25.3% | 3.9 | 3 | 25.5 | 2% |
| 4 | 5 | 30.0% | 3.3 | 2 | 30.1 | 1% |

The worst case in every cell is 15 kills, the counter's cap, and no run in the audit passed it.

- **The rates are the designer's decision of 2026-11-04**: the audited values (4%, +1, +3) scaled by ×30/19, so the
  top cell, band 4 tier 5, is exactly 30%, with the cap kept at 15.
- **Why the tier outweighs the band.** The counter flattens low chances: at the plan's starting +1 per tier a
  free tier-1 refight paid 8.7 mythics per 100 kills and a finished band-1 world's tier 5 only 11.9, so the Seal
  ladder, up to 80% more boss, was worth about a third more mythics. Now that tier (loot band 2) pays 26.9,
  over twice the free refight's 10.2, and is the farm: one every three or four kills.
- **Why the story stays rare though its cell reads 10.2.** The table counts kills, and a world has three story
  bosses (two lairs and the orb boss). All three at band 1 pay a mythic about one campaign in six (17.7%). Four
  worlds' worth plus Aethelred's first fight is thirteen kills, so the story alone can never reach the counter.
- **Kills, not hours.** The audit counts kills. How fast they come is the summit's wrath window and the
  Seals, which it does not measure.

**Its one power: a worn mythic counts as two pieces** toward its set's 3- and 5-piece bonuses
(`setPieceWeight`, read by `matchingSetPieces` and `wornCollectionPieces`). A template counts once,
at its best. A world collection still has only its 3-piece bonus. The +12%-per-piece skill roll does
not change. `setCardView` counts the same way on `ItemCard` and `HeroGear`, says why ("Emberlord 5/7 —
mythic counts twice" / "mityczny liczy się podwójnie"), and stops the shown number at the set's size,
since a double count can pass it. A piece not yet worn counts as what wearing it would do, including
a mythic swapped for its own legendary. The equipment achievements read `distinctSetPieces`: *Dressed
for legend* asks for seven pieces on the body.

Its ink is in ui and its teal recolour and glow in models. The name is Mythic /
*Mityczny*, agreeing with its noun and lowercase in prose.

## Jadeveil equipment

**Everything in it mints by where it was fought for** (`LootGround.content`, from
`systems/world/contentLevel.ts`; the plan, *Loot levels*). With the world's
level band as `floor` to `top`:

| Source | Item level | Legendary |
| --- | --- | --- |
| Fights on the ground, chest guards | the area's level, floor + 0 to + 4, ramped by depth toward the next area's, ±1, never past top | top |
| Lair and shrine fights | the site's level (Silk Hollow + 1, Silent Hall + 3, a shrine's area), ±1, never past top | top |
| Lair chests | the lair's level (22 and 24 at band 1) ±1, never past top | top |
| Summit chest, story tier | floor | top |
| Summit chest, Storm Seal tier *t* (2–5) | cap − 5 + *t* | cap |
| Quest gear (`questGearLevel`) | the party's level, clamped to floor–top | top |

So at band 1 and a cap of 25 every source mints what it did, apart from the fights' own drops, which read the
Empire's 2–14 ladder (an epic found by the camp minted at about 2) until they were put on the area's level.
At a cap of 35 a band-1 world's story still mints at 25 at most, and its Storm Seal tiers 2–5 mint at 32–35 with
legendaries at 35. Affixes and sockets are not separate: they follow the item level as anywhere, to 40
(`bandLoot.test.ts`).

Jadeveil adds four legendary armour **collections**, two ordinary motifs and two authored weapons
(the expansion plan). **All of it is
the range's own**: every template carries `world: 'jadeveil'` (`data/items/worldGear.ts`, written
by the generator from the motif), and every pool that rolls or stocks gear asks `inWorld` — the
loot rolls through `LootOptions.world`, the lair chest through its `LairSpec.world`, quest gear
through the world it is handed in, the shop never. A roll in the Empire draws exactly the dice it
always did (`jadeveilRewards.test.ts` holds a seeded Empire roll equal with and without the world
named), so the older world's odds do not move.

**Collections are identified by weight** (`data/items/collections.ts`): Jade Bastion is plate,
Canopy Strider hide, Cloud Script robe, Monastery Oath vestment. Each is four pieces — head, chest,
legs, feet — legendary, with no `masteryLock`: its class lock is the weight's, so `canEquip`'s
weight rule (`wearableWeights`) is the whole gate. Jade Bastion is worn by the three Champion paths
and the Beetle, Canopy Strider by the Hunters and the Mantis, Cloud Script by the Arcanists,
Monastery Oath by the Druids and the Firefly. Tilts (`MOTIF_TILT`) suit the weight's wearers in
general, mixed at the mastery weight. The models are in models.

**The archipelago's collections are built ahead of their world.** `COLLECTION_WORLD` names each
collection's world. The archipelago's four are legendary like Jadeveil's, one a weight, worn by
the same paths: Ironclad Admiral (plate) tilts to defence, health and attack, with health at three
pieces; Saltrunner (hide) to attack, critical chance and speed, with crit points; Stormglass (robe)
to magic, speed and critical chance, with spell damage; Shellwoven (vestment) to Heal power,
health and magic defence, with Heal power. Their templates carry `world: 'archipelago'`, a world
the campaign cannot reach yet and whose map rolls no fights (`WorldDef.content.encounters`), so no
drop, chest, shop or pattern reaches them, and the forge's count of patterns left to find
(`forge.patternsToFind`) counts only the worlds with fights, which leaves them out.

- **A collection piece rolls a skill of one path of its weight** (`setBonus.rollSetBonus`): a path
  first — with `BALANCE.COLLECTION_BONUS_PARTY_BIAS` (0.7) one hero of the party who wears the
  weight, drawn uniformly, gives theirs (or before a path one of their class's that wears it);
  otherwise any path of the weight — then a skill of that path's whole pool, skipped nodes
  included. The bonus records its `path` (`SetSkillBonus.path`, save 62). `mintItem` takes the
  wearers; drops pass the party, the forge's offer the heroes.
- **A wrong-path roll is shown and repairable.** The bonus is applied to the named skill whoever
  wears the piece (`gearSkillPowerBonuses`), so on a hero without that skill it does nothing.
  `ItemCard` now shows every legendary's bonus (`setBonusText`), a collection's with its path, and
  given the wearer — the gear tab's comparison — says "Not this hero's path: no effect" and names
  the repair. At a level-3 forge the Obsidian bench re-aims it: the player picks a path of the
  weight (`rerollPaths`, defaulting to one the party walks) and the reroll lands on a different
  skill of that path, for the set reroll's price.
- **The mastery sets are unchanged**: one path, a bonus with no `path`, re-aimed only at their own.

**Votive and Spiritsealed** are the range's Rare and Epic motifs, minted on all sixteen armour forms
and eleven selected weapons (`JADEVEIL_MOTIF_WEAPONS` — one a path reaches for at least, so every
path can find a wearable Rare and Epic weapon and armour piece) but not on off-hands or jewellery,
which keep the Empire's motifs and their class affinity. They are listed beside a form's own motifs
(`worldMotifsFor`) rather than in `FORMS[form].motifs`, so the Empire's 2 / 2 / 3 per weight and its
drop pool are untouched. Votive tilts toward magic defence and speed, Spiritsealed toward health
with some attack and magic.

**Redflag and Compassbound** are the archipelago's Rare and Epic motifs, built ahead of its world as
its collections are and minted on all sixteen armour forms, as a world's motifs cover its four
weights, and on no weapon yet (`ARCHIPELAGO_MOTIFS`, listed by `worldMotifsFor`). Redflag tilts
toward attack with some critical damage, Compassbound toward speed and critical chance. Their
templates carry `world: 'archipelago'`, so nothing rolls, stocks or teaches them yet, and their
`MOTIF_CLASS` names every class, deciding nothing, as Jadeveil's two do.

**The authored weapons** (`itemTemplates.ts`) are not collection pieces and there is no quota per
class. **Kairen's Fang** is a spear, so it is the Skirmisher's (and any pathless Hunter's); its
Basic Attack is `dragon_fang`, a spear's reach a little heavier and jade-lit. The **Monastery
Bellstaff** is a staff, so the Arcanists' and the Firefly's; it makes `bell_toll`, the staff's bolt
a little harder and heard in the arcane school's bell. An item may name its own Basic Attack
(`Item.attack`, read before the form's in `basicAttack.weaponAttackId`) and its own model
(`Item.model`, `voxel/items/uniques/`).

**Where it is found** (`systems/economy/jadeveilRewards.ts`):

- Every legendary roll in the range is narrowed to the range's own pieces with
  `BALANCE.WORLD_LEGENDARY_SHARE` (0.5) — to what the hero the roll leans to can wear, when it leans
  — and draws from the whole catalogue otherwise. Ordinary rolls draw Votive and Spiritsealed
  beside the Empire's motifs, form first as always.
- **Kairen's Fang** is his boss-only item: a chance on every kill, never guaranteed, and not a
  first-kill reward. **Every summit clear** — the story's and each Storm Seal tier's — adds one collection piece made for a hero of the party
  (`rollCollectionPiece`, round a shuffled party to the first who can wear one), on top of his drop
  and the chest. **The Silent Hall's first chest** holds the Monastery Bellstaff.
- **Spirit Ink** (`ascentStore.ink`, kept off the inventory's resources so a siege loss cannot clear
  it) is paid by the range's fights (a 0.2 chance per ordinary enemy, 1 an elite, 2 a boss), its
  shrines (+3), its lair chests (4 and 2) and Kairen (3 + tier on top of his own), banked when the
  victory closes and shown on the victory and chest dialogs; salvaging the range's gear returns
  1 / 2 / 5 by rarity. Numbers in `BALANCE.SPIRIT_INK`.

**The forge finishes the chase and cannot start it.** A world motif's recipe waits for its
**pattern** — the forge learns one from any piece of that motif entering the bag
(`inventoryStore.addItem` → `ascentStore.learnPattern`, saved as `ascent.forge`) — then asks its
rarity's level, a collection the set bench's (3). It costs Spirit Ink on top of `forgeCost`
(`forge.inkCost`, by budget at `SPIRIT_INK.FORGE_PER_POINT`: a Jade Bastion cuirass 9, a
Spiritsealed one 3, a Votive one 1). So a level-3 forge crafts nothing of the range's on arrival.
The craft bench names unlearned patterns and the Ink a recipe needs; the camp shows the Ink held.

**The seeded audit** (`jadeveilRewards.test.ts`, a party of a Templar, a Pyromancer, a Lifewarden
and a Firefly; thirty fights, four shrines, both lairs, Kairen at every tier) measured, over five
seeds: 8–9 of the sixteen collection pieces from drops, every weight the party wears found, Votive
and Spiritsealed found, both weapons; 87–101 Ink to the first kill against 112 to forge all four
collections outright, enough to finish one; each repeat tier a collection piece for the party and
one more Ink than the tier below (6 at tier 1 to 10 at tier 5). The test pins the properties — every
worn weight found, the catalogue not completed by drops, the Ink short of the whole catalogue but
enough for one collection, every tier paying a wearable piece and more Ink — not these numbers.

## The castle gauntlet

`systems/world/castle.ts` is pure: four stages, encounter ids (`castle_{tier}_{stage}`), tier scaling and
the Seal rules. The run's state lives on `empireStore` (`castleTier`, `castleStage`, `seals`,
`crystals`).

- **The Seal rules are the shared ladder's.** `systems/world/sealLadder.ts` holds them once for every
  repeatable boss, each ladder described by data (top tier, power step, what opens tier 1:
  `CASTLE_LADDER` free once, `SUMMIT_LADDER` the story fight, `HEART_LADDER` free): entering, the tiers
  open, the Seal spent, the Seal a clear pays, the tier's power, the chest's item level and the twists
  in force. `castle.ts`, `summit.ts` and `heartRefight.ts` keep their own names and call it.
  `systems/world/repeatableFights.ts` names the fights made to be repeated (`isRepeatableEncounter`,
  `repeatableFightOf`): every castle run, the summit's tiers 2–5 and every Heart refight tier, for
  Archipelago 0 to scale to the cap
  (repeatable boss tiers).

- **The Heart of Winter's Seals and chests.** Winter Seals (`empireStore.winterSeals`, `heartTier`) open
  only the Heart's refight. The lair's first kill and a clear of free tier 1 pay a tier-2 Seal; tier 1 pays
  its ordinary drops and no chest; a clear of tier n ≥ 2 pays a chest and the boss's drop at
  `ladderItemLevel` (`levelCap() − 5 + n`, the same rule as the castle's and the summit's) and a Seal of
  tier n + 1, capped at 5. The door and the rest are in [world](world.md).

- **The scene does not unmount between stages.** `finishVictory` calls `startEncounter` with the
  next stage instead of `endEncounter`, so CombatScene's init effect (which only writes `buildEncounter`'s result into the stores) is keyed on
  `currentEncounterId` rather than on mount.
- Seals and Crystals live on `empireStore`, **not** in `inventoryStore.resources` — a siege loss
  calls `clearResources`, and wiping the endgame currency would make one bad week cost far more
  than the design says.
- A Seal is **spent on entry**, and the run itself is deliberately **not persisted**: a save
  reloaded mid-gauntlet would resume with a fresh party and no memory of what the first three
  fights cost.
- **The garrison and the Emperor scale apart** (playtest 2026-10-14, which found a level-20 party in
  epic and legendary gear one-shotting the stages at ×1.0, below a week-3 siege). The Gate, Yard and
  Sanctum fight at `castleGarrisonScale` (×1.5 since the castle nerf of 2026-10-20, from ×2.0; +0.25 a tier) with five
  bodies at tier 1 (`CASTLE_BASE_ENEMIES`); Aethelred's stage stays on `castleTierScale`, his own
  template carrying his +50% health. `castleStagePower` is the one answer `encounterPowerScale` reads.
  Rewards still scale by `castleTierScale`.
- **Castle health is cut apart from its strength** (playtest 2026-10-17, which found the buffed
  stages too long): every castle body, garrison and Aethelred, carries `CASTLE_HP_SCALE` (0.7) of the
  health its stage multiplier gives it (`castleEnemyHp`, applied in `buildEncounter`; a resumed fight
  keeps its numbers). Attack, magic and defence keep the full multiplier, and `enemyStatScale` is
  untouched, so summons and Standards still scale off the unreduced multiplier (Standards' 5% share of
  his health falls with it). A tuning starting point to verify in play.
- Two scaling levers — count (`castleStageSize`) and stats (`castleTierScale`) — and they
  *multiply*. Neither should be tuned without the other in view. The count lever stops at the boss
  stage, which is always exactly one unit.
- `wildTemplates` in `encounterGenerator` excludes the Legion **and Aethelred** from the generic
  tier pools. It is load-bearing: the map carries six boss tiles picked by `index % bosses.length`,
  so without it `boss_3` would put the emperor on an ordinary lair tile.

## The effective level cap

`data/levelCap.ts` is the one cap every level-linked rule reads: **`BALANCE.MAX_LEVEL` (20), plus
`BALANCE.EXPANSION_LEVELS` (5) for each crossing opened**, at most `BALANCE.MAX_WORLD_CROSSINGS` (4).
One road at a time (the bands plan): before Aethelred falls none
is open, and after it

```
crossings opened = min(owned enterable worlds, 1 + finished worlds)
```

| campaign | crossings | cap |
| --- | --- | --- |
| unowned, or owner before Aethelred | 0 | 20 |
| owner of one world, after Aethelred | 1 | 25 |
| … after that world's orb boss, nothing else to enter | 1 | 25 |
| owner of two worlds, after Aethelred | 1 | 25 |
| … after the first world's orb boss | 2 | 30 |

The cap rises when a crossing opens, so a new world is never above it on arrival and the cap equals the
top of the newest level band. A world counts only when this build can enter it (`WorldDef.enterable`;
`ownedWorlds` also counts a `devCrossing` world in a development build whose DLC switch is on). The
inputs live in stores that must not import each other, so `entitlementStore` pushes the worlds owned,
`empireStore` pushes `emperorDefeated` and `worldBandStore` pushes the banded and finished worlds; the
module imports only `BALANCE`, which lets the data layer read it. `worldBand` answers a world's band
from the same state, for the gem grades.

Readers: the XP loop and `isMaxLevel`; mastery points (one per level from 6); recruit levels; minted
legendaries, castle tiers, ground and party item levels; `maxItemLevel`, the Crystal ceiling and the
displayed `+N`; the bonus-resource ramp. Item stats stay anchored to the instance's own level and the
legendary segment to the literal anchor 20, so a rising cap moves the ceiling and the `+N`, never an
existing piece's numbers. Two places read the **highest** cap (`highestLevelCap`, 40) instead of the one
in force, because a level a campaign reached is real even when ownership cannot be read today: save
validation (`savedItemsWellFormed`, which runs before any store holds the campaign) and the mastery
point and path-growth counts. If the cap falls back, a hero keeps its level and points, a piece keeps
its level (`itemAtLevel` never climbs downward), and only further climbing stops. Pinned by
`levelCap.test.ts` across the campaign states, and the XP curve and stat growth to level 40 by
`leveling.test.ts`. The extra points spend anywhere in the chosen tree, including its
[advanced nodes](#advanced-nodes).

## Party XP catch-up and talk markers

Combat XP is shared by the heroes standing at the end of the fight (`encounterResolution.applyVictory`);
a quest's XP is split across the **whole** party, a hero who fell in the last fight included
(`claimQuest`, pinned by `questXpFallen.test.ts` after the playtest of 2026-10-30).
Combat and quest XP snapshot the arithmetic average of the entire party before the reward batch.
A hero at least two levels below that average gains +25% per exact level of difference, without
a cap; fractional differences count. The existing Library award is calculated first, then the
catch-up result is floored. Gap 2 gives +50%, gap 3 +75%; party [10,10,5] awards the level-5 hero
183 XP from a base 100 without a Library. Reward displays show actual per-hero awards.

NPC interest includes unfinished intermediate talk objectives (for example Ivane in The Bell
Below), below claim priority and above new offers. That `talk` marker is the offer's gold
question mark (it was silver, which read as "nothing yet" over Ivane; playtest 2026-10-23b) and
clears when that objective advances.
