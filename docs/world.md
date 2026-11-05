# World generation and rendering

Current implementation notes and decision rationale for work in this area. Start with the relevant procedure in the reference index when one exists.

## The world has a shape: roads, corridors and haunted ground

`MapTile.zone` is one of **`road` / `corridor` / `haunted`**, and it replaced two independent
booleans (`isDanger`, `road`) that between them answered the same question in two half-answers and
could in principle contradict each other. A tile is exactly one zone.

The overworld used to be a noise field with a difficulty gradient over it — texture, but no
structure: nothing on it was a route, a frontier or a place you decided to leave.

- **Road**: the network joining the city to the Obsidian castle, plus branches. **Never holds an
  encounter**, and costs `ROAD_HOURS` (0.5) to walk against 1 off-road. Safety alone was not a
  trade — a road that is merely encounter-free is one anybody hunting XP ignores completely, which
  makes the network scenery with a rule attached. Both ends of a step must be road, or a route that
  clips a road tile would get a rebate for having been *near* infrastructure rather than for using
  it.
- **Corridor**: ordinary ground within `CORRIDOR_MIN`–`CORRIDOR_MAX` hexes of a road. **12%** of
  tiles hold an encounter — quiet, not silent. A corridor rate of zero would make the safe route
  perfectly safe and delete the decision; a rate near haunted's would delete the reason to leave.
- **Haunted**: everything else, **42%**, and where every lair door, magic well and quest site is
  placed, and where guarded chests lie. That is the deal the whole structure is built on: the road is
  safe and pays nothing. A find beside a road would be free money for staying on the safe route, so
  finds keep off it too.

**Haunted is a treatment, not a terrain** — haunted forest is still forest, and `DANGER_DISPLAY` has
carried the scorched palette per terrain all along. On the world map haunted ground also shows its
living twin in withered patches, and ash creeps a cell out onto living ground beside it (see
*Biome changes run across several cells* under *How ground looks*). It needed a **Water** entry the moment zones
became geometric: a lake inside haunted country is haunted whatever the party can walk on, and a
missing entry is not a subtle palette fault — `HexGridMesh` falls through to its default grey and
the lake renders as an untextured hole.

- **The corridor's width is value noise, not a constant.** A fixed radius reads as a buffer drawn
  around a line, because that is what it would be. Noise rather than a per-tile roll for the same
  reason: an independent roll per tile gives a dithered, salt-and-pepper frontier that reads as a
  rendering fault, where coherent noise gives a wandering edge.
- **The artery runs the whole way now**, where it used to stop at `ROAD_REACH` (0.72) on the premise
  that the Legion never reached the city. A road is infrastructure before it is a scar, and the
  network's job is to be the thing you navigate by.
- **`ROAD_DISPLAY` went from scorched violet-black to a pale packed track**, for the same reason.
  `#2e2630` was the darkest surface in the game, which was right for one line meaning "an army came
  down here" and wrong for a network meaning "this is the safe, fast way" — on screen the one
  surface that means safety looked like the one that meant the opposite. A branch running out to a
  trapper's camp has nothing to do with the Legion either, so a uniform ash across the whole network
  asserted something untrue about most of it.
- **A branch terminates on something real, and one generation is then all it takes.** `aimBranch`
  casts on the rolled bearing and returns the first road tile at or past `ROAD_BRANCH_MIN` — the
  artery, or a leg carved before it — or, failing that, the first hex *past* the map boundary, and
  the leg is truncated at the first off-map hex so "ends on the edge" is true rather than
  approximately true. `wanderingRoute` still walks it as a chain of jittered waypoints, so the shape
  stays organic. This reverses a decision made deliberately — branches used to **dead-end**, on the
  argument that "a network where every road leads somewhere is a map with no frontier" — and it is
  reversed on play rather than on theory: a track that simply stops in open grass does not read as a
  frontier, it reads as a cul-de-sac, which is the word the report used. The frontier survives in the
  **ground between the roads** rather than the point at which one gives up. Dead ends measured 6–13
  a map; they are **0 on all fourteen seeds**, and `zones.test.ts` now fails any road tile with one
  road neighbour that is not at the map edge, a POI, the city or the castle.
  - **`ROAD_BRANCH_MAX` and `ROAD_SUBBRANCHES` are deleted rather than zeroed.** Legs terminate on
    each other now, so a T-junction is what *finishing* looks like and a second generation had
    nothing left to add — and a constant that disables a code path is a code path nobody can tell is
    dead. There is no maximum length either: refusing a road at hex 23 and then running the leg out
    to the edge anyway is not a cap.
  - **`ROAD_BRANCHES` stays 12, and that is re-measured rather than left alone.** One artery and
    five branches produced a map **88% haunted** — safe ground too sparse to be a route at all. Each
    leg is far longer under the new rule, so twelve primaries plus eight secondaries came out
    **0.53–0.64** haunted, under `zones.test.ts`'s 0.6 floor on two of fourteen seeds: a road tile
    drags two to three hexes of corridor along either side, and that is what eats a map. Halving to
    6/4 is worse in a way the zone share does not show — it collapsed `threat.test.ts`'s gap between
    band 0 and the far bands to **0.08** on seed 90210 against a floor of 0.15. Twelve with no second
    generation holds both, at **0.63–0.79**. Primary branch roots are **spread evenly** along the
    artery: uniform roots clump, and a clump is a stretch with no side roads, which showed up as the
    home ring swinging between 16% and 71% haunted from seed to seed.
- **`ensureHomeHaunted` is the opening hour**, and it replaced `ensureHomeEncounters`. The city is
  the network's hub, so its surroundings are corridor by construction — without a floor, a new save
  opens with a walk down a safe road looking for the game. It converts the *outermost* corridor
  tiles first, so the road keeps its margin and the trouble forms at the corridor's edge. The apron
  inside `HOME_HAUNTED_INNER` is forced corridor, because distance-to-a-road is not
  distance-to-the-city: the artery runs through the gate in one direction, so a tile three hexes out
  perpendicular to it can come back haunted.
- **The castle's doorstep is always haunted** (playtest 2026-10-23). The main road ends at the
  Obsidian castle, so its surroundings used to come out corridor. After `ensureHomeHaunted`, every
  off-road tile without a POI within `CASTLE_HAUNTED_RADIUS` (3) of the far pole is haunted
  (`ZoneRules.farHauntedRadius`; 0 on Jadeveil, whose summit is reached by its own rules). The road
  itself stays the one quiet way in, and no lair door or find is dealt into that ring.
- **A destination is not a fight, and that line is load-bearing now.** The old danger pass skipped
  POI tiles so the two could never collide. Every door and vein sits in haunted ground on purpose
  now, and haunted ground is where the encounters are — so both `rollDailyEncounters` and
  `holdsEncounter` refuse a tile carrying a `poi`, or walking to a lair would roll a warband instead
  of opening it, roughly one visit in four, and read as broken.
- **Waysides are *preferred* onto roads** rather than excluded from them: people live where the
  traffic is, and a camp on the road is what makes the three of them read as somebody rather than as
  a marker. Reachability is still never relaxed — see the tier chain in `placeWaysides`.
- **`DAILY_ENCOUNTER_CHANCE` is a separate lever and is measured, not guessed.** `ZONE_ENCOUNTER_RATE`
  is *how much content this ground holds* and never changes; this is *how much is up today*, and it
  re-rolls every dawn. It was cut from 0.55 to 0.30 when the roll went daily, sized against a
  map-wide danger density of ~16% — but the ground near the city was 6.5%, and a player *aims* at
  scorched ground rather than crossing it by accident, so interception added almost nothing in the
  opening hours and the cut was nearly pure loss. A playtest could not find five wolves.
  `__tests__/world/encounterSupply.test.ts` pins what the first hour actually sees, and
  `__tests__/world/zones.test.ts` pins the structure: the artery is walkable city → castle **without
  leaving the road**, no road tile stands alone, the apron is never haunted, and no destination sits
  anywhere but haunted ground.
- **The two rates multiply, and nobody had multiplied them.** `ZONE_ENCOUNTER_RATE.haunted` at 0.60
  against `DAILY_ENCOUNTER_CHANCE` 0.55 is **33% of deep haunted tiles live on any given day**, and
  `planTravel` stops the party *on* the first live tile a route crosses — so a thirty-tile march into
  the far country was roughly ten consecutive fights and a journey that never completed. A playtest
  reported it as simply not being able to move out there. Haunted is **0.42** now; the corridor went
  *up*, 0.10 → **0.12**, which is not a rounding artefact. The gap between the zones is the reason to
  leave the road and cutting one of them alone narrows it, and the home ring is mostly corridor by
  construction, so the corridor's rise returns a little of what the haunted cut takes out of the
  opening hours.
- **The rate cut is only half the answer, because the complaint was about *consecutive*
  interruptions rather than about density.** Those want opposite fixes: thinning the world enough to
  settle the first on its own would have emptied the ground nobody was complaining about, which is
  the drought `encounterSupply.test.ts` is named after. `quietAfterVictory` in
  `systems/world/travel.ts` spends every live encounter within `BALANCE.ENCOUNTER_QUIET_RADIUS` of a
  fight the party has just won — a wiped warband leaves a gap, and nothing has moved into it by
  nightfall. Pure, and it returns the **identical set** when nothing was in reach so the caller can
  skip the write on `===`, the contract `questStore.report` already holds. Its one call site is
  `worldMapStore.clearActiveEncounter`, which it **replaces** rather than sits beside: the radius
  includes the tile fought on. Two, because one is the tile plus its neighbours and reads as no rule
  at all, while three is a 37-hex hole — most of a day's corridor walking bought with one win. What
  it costs is that clearing the road ahead is now a reason to pick a fight, which is a decision the
  overworld did not previously offer. Measured home-ring live fights a day on seeds
  [1, 7, 42, 99, 1234] against the suite's floor of 6: 37.2 / 18.4 / 19.3 / 19.5 / 28.0 before,
  24.2 / 24.4 / 16.3 / 29.0 / 20.5 after, and 16.3–30.5 across fourteen seeds. No assertion was
  relaxed.
- **A third factor: the strong are not hunted.** `systems/world/encounterTimidity.ts` scales the
  daily roll by `clamp(expected / partySummedLevel, 0.25, 1)`, where `expected` is
  `BAND_EXPECTED_LEVEL[band]` in the Empire and a full party at the area's fixed level beyond it
  (`expectedSummedLevel`), so ground the party has outgrown thins to a quarter while the bands ahead
  of it are untouched. Early encounters at
  summed level 30 are one-shot for no meaningful XP or gold — a time cost with nothing on the other
  side of it — and the whole point of the daily roll is that content is *up today*, not that it is
  compulsory forever. A **starting party sees precisely the pre-change supply**, pinned as an
  identity rather than a bound in `encounterSupply.test.ts`, because that suite exists for the one
  time a density cut left a playtest unable to find five wolves.
- **`THREAT_EARLY_FLOOR` applies to band 0 only, and the slope is its ceiling.** Band 1 is
  `1 + THREAT_POWER_PER_BAND`; a floor at or above that inverts the gradient at its first step,
  which is why hardening the home ring means raising both. Band 0 is the only band with no slope
  term, so it is the only one a floor is the whole answer for — band 1 steps up through its
  composition (`['front', 'chaff']`) instead. `threatRewardScale` applies the same floor on the
  same band, because ground must never cost more than it pays.
- **Difficulty has two axes now, and they are strictly ordered: band > depth > zone.**
  `threatPowerScale(band, depth, haunted)` and `threatRewardScale` take the same third argument, so
  ground that costs more pays more — the rule `threatDepth` already followed, one axis over.
  `THREAT_HAUNTED_PREMIUM` is **1.25** against a hard ceiling of **1.40**, which is where the
  ordering inverts and haunted ground deep in band N becomes worse than corridor ground entering
  band N+1.
  - **A uniform factor commutes with every ratio the band curve is pinned on**, so the measured
    seams (×1.14, ×1.41, ×1.00, ×0.91) are *exactly* unchanged in haunted ground. That is pinned to
    full precision, because an approximate commutation is a slow drift with no failing test.
  - **A cross-zone drop is legal where a cross-band one is not**, and the reason is legibility: a
    band seam is invisible — nothing changes on the map at radius 21 — while haunted terrain is
    drawn, visible several hexes out, and marked by `RoutePreview` before the second tap. The
    surprise budget belongs to the seams. A player stepping from haunted band 2 onto corridor band 3
    and finding it 20% easier has taken the road, which is what the road is for.
  - **`bandComposition` deliberately takes no `haunted`.** Haunted ground fields the same bodies in
    the same arrangement, only stronger, so the composer and `shapeViolations` are untouched — the
    same argument that keeps depth off the integer counts.
- **A band is a window, not a step: `threatDepth(coord, city, castle)` reports how far through it a
  tile sits.** Every number in `threat.ts` used to be a function of the band index alone, so the map
  was five flat plateaus joined by four cliffs — a tile one hex inside Borderland and a tile ten
  hexes deeper were the same fight, and then band 2 arrived carrying the first elite, the third body
  and a jump in `threatPowerScale` all on one hex. A playtest read that as "bands 0–1 trivial, band 2
  unwinnable, nothing in between".
  - **The band and the depth are one read.** `threatAt` is `threatDepth(...).band` and nothing else,
    derived from the same `THREAT_CITY_RADII` / `THREAT_CASTLE_RADII` windows, so no retune can make
    the label and the scaling disagree about which band a tile is in. The castle's windows run the
    other way — its own hex is the *deep* end of band 4 — and the two anchors are compared
    **lexicographically**, band then depth: the castle's band with the city's depth would let ground
    inside the Legion's rings read as the discounted entrance to band 4.
  - **Two ramp shapes, and which one a band gets is derived from `threatEliteCount(band) === 0`.**
    A band with no elite (0–1) is too weak everywhere, so its old value is a **floor** and depth only
    adds: `×1.00 → ×1.40`. A band with one (2–4) is already a step up on arrival, so its old value is
    the **midpoint** and the ramp is `×0.75 → ×1.25` — the discount pays for the elite, the premium
    charges it back so the band's average does not move. Deriving the split means the discount
    follows the elite if the elite ever moves, which is the only reason it exists.
  - **`threatRewardScale` rides the identical `depthScale`.** Two ramps would have to be kept in step
    by hand, and the deepest ground in every band is exactly where an unpaid premium would land.
  - **Depth moves the stat multiplier and the pay, and nothing else.** `threatEncounterSize` and
    `threatEliteCount` are integers and an integer cannot ramp, it steps — moving them would put a
    fifth cliff in the *middle* of a band. They are also what `shapeViolations` derives the shape
    table's invariants from, so a count that varies inside a band means a shape table per depth
    bucket; and band 0's two chaff is its only legal arrangement by arithmetic.
  - **`neutralDepth(band)` is the depth at which a band scales by exactly one** — 0 for bands 0–1,
    0.5 for 2–4 — and it is the default every entry point takes. That is what makes curated fights
    numerically untouched by the whole mechanism: a lair chamber, a quest site and the gauntlet have
    no ground, and a depth on `EncounterContext` would hand each of them the depth of the hex its
    *door* happens to occupy. `threat` there stays deliberately unconsumed and gained no sibling.
  - **`__tests__/world/threatDepth.test.ts` is the deliverable more than the constants are.** It
    measures the seam between two bands against `bandComposition × threatPowerScale` — composition
    included, because composition is where the cliff actually lives and a check against the
    multiplier alone would pass trivially. The rule: crossing a seam is never a bigger surprise than
    walking a whole band, and never opens below the average of the band being left. Seams were
    ×1.59, ×2.63, ×1.67, ×1.53; they are ×1.14, ×1.41, ×1.00, ×0.91 against a within-band ramp of
    ×1.40 / ×1.67. Analytic, not sampled, for the reason `homeRing.test.ts` records — the arithmetic
    is shared with it in `__tests__/support/threatCurve.ts`.
- **The tile's band is the fight's band**, with no bump. A danger tile used to fight one band above
  its surroundings — but since encounters only happen on danger tiles there were no surroundings to
  be worse than, so it was a silent +1 on every fight and made the threat label the map shows wrong
  by one. `SHAPES` in `encounterGenerator` is therefore the actual, honest difficulty curve.
- **A band offers several arrangements, not one.** `SHAPES[band]` is a list of `EncounterShape`s —
  pack, patrol, skirmish, warband, ambush, vanguard, phalanx — and one is rolled per fight. It
  replaced a single `EnemyRole[]` per band, under which the whole game could produce three distinct
  band-0 fights and *one* band-4 fight away from the castle. Same roster, asked for several
  different arrangements of itself.
  - **The table lives in `systems/world/encounterShapes.ts` and is re-exported from
    `encounterGenerator`**, so no caller had to learn it moved. The move is forced by a cycle rather
    than by tidiness: `questHints` has to derive which bands actually field a template from this
    table, `encounterGenerator` imports `questEvents` for `huntedTemplates()`, and `questEvents`
    imports `questHints` — `questHints → encounterGenerator → questEvents → questHints`, which is
    exactly what `importCycles.test.ts` exists to catch. The composer is still where a reader looks
    for how a fight is put together.
  - **Faction first, then shape.** Narrowing the candidate pool by shape would skew the distribution
    `huntWeighted` is tuned against, and worse, it can empty the pool — at which point
    `factionCandidates`'s fallback returns every non-Legion faction *regardless of band*, and the
    Coven turns up in the home ring. Faction-first never reaches that line.
  - **`requires` means "resolves distinctly", not "natively fielded"** (`fieldsDistinctly`). A role
    qualifies when `membersForRole` returns something other than the faction's front line. Asking
    whether the faction *authors* the role is the tempting version and it locks the Coven and the
    Legion — bands 3 and 4, most of the late game — out of every shape. What the gate exists to
    exclude is Beasts, whose `ranged` falls all the way through to `front`.
  - **Two invariants, both derived rather than written:** every shape fields exactly
    `threatEncounterSize(band)` bodies and exactly `threatEliteCount(band)` elites, checked by
    `shapeViolations`. Elite weight is nearly flat across bands, so how many elite slots a fight has
    is almost the whole difficulty curve — pin that and no shape roll can invert it.
  - **`threatEliteCount` returned 1 at band 1 for as long as it existed** and nothing noticed,
    because nothing called it while the composer carried its own hand-written table. Wiring it up
    failed on the first run, which is the entire argument for a derived table over a written one.
  - **No per-shape size delta.** More bodies is more actions per round — a difficulty *increase*
    wearing the word "weaker" — and at bands 3–4 a chaff swarm cannot even be delivered, because the
    Coven and the Legion have none and it resolves to Thralls and Infantry. Only `composeForFaction`
    may widen a fight, and only because a curated chamber is not part of the wandering curve.
  - **Band 0 is one shape, by arithmetic.** Two Footpads leave a level-1 Arcanist 6.7 rounds against
    a bar of 6; three leave 4.4. Two Goblin Spearthrowers leave 4.2. There is exactly one legal
    arrangement of the home ring.
  - `homeRing.test.ts`'s monotonicity check is **analytic, not sampled**. At 200 Monte Carlo rolls
    the bimodal band-3/4 means carried ~2% standard error each, so a narrow step turned the suite
    intermittently red rather than red — and an intermittent red gets re-run, not investigated.
- **The composer reports who turned up.** `planEncounter` returns an `EncounterPlan`
  (`enemies`, `factionId`, `shape`); `CombatScene` names the faction and the shape in the log at the
  start of a fight. The faction's tagline (now `factionTagline`) carried the comment "Shown in the encounter banner" for its
  whole existence with nothing reading it, because the faction was discarded the moment the bodies
  were picked. The shape rides on the same line because it is the tactical read — "Skirmish Line" is
  the player expecting shooters before the first turn, which is what makes several arrangements of
  one roster feel like several fights.
- **Curated fights name their faction; they do not index a tier list.** A lair carries `faction`,
  `band` and `boss` on its `LairSpec`. All three used to be positional lookups into arrays sorted by
  *file order*, which meant every guard room in the game was an elite plus a pile of Goblin Whelps
  drawn from whichever factions those indices landed on, and the **dragon** guarded The Warren — the
  first lair, gated at summed party level 8 — while a troll chieftain sat in The Wyrm's Hollow at
  level 39. Unnamed quest sites compose at a fixed `QUEST_BAND`, so they stay curated: a curated fight
  ignores the ground it stands on, or it is not curated.
- **The siege fills a fixed shape, and each role sends its soldiers in turn.** `SIEGE_SHAPE` in
  `encounterGenerator` lays out the army at the gate with an elite at its head, and `siegeArmySize`
  decides how much of it arrives, so a later siege is the same army with more soldiers. Nothing is
  rolled: a week's siege is the same army however often it is reloaded. Each place takes the next
  soldier of its own role, counted within that role. It used to count along the whole army
  (`members[slot % length]`), and the shape puts every front place on an odd slot and every elite on
  an even one, so a full siege was four Stalkers, two Sentinels and two Arcanists, and the Infantry
  and the Dread-Knight never came. A full siege is now one of each elite, two of each front-line
  soldier and two Arcanists. Pinned by `legion.test.ts`.
- **An active `kill` objective bends who turns up.** `questEvents.huntedTemplates()` reports the
  templates of unfinished kill counters; `generateForBand` weights factions fielding one of them
  ×5 (`QUEST_HUNT_WEIGHT`, same scale as terrain, so the two compose) **on that faction's own ground
  only** and fills their slots with the hunted member. Without it a five-wolf quest is a lottery on
  top of a lottery, and a playtest lost four in-game weeks to it; since the biome lock the Beasts are
  the forest's alone, so the lottery is played on forest. Curated fights return before it is
  consulted. Pinned by `questHunt.test.ts` (see *The biome lock* for the guarantee and the hint).
- **On the quarry's own ground most fights are the hunt (playtest PT-01, PT-09).** `planForEncounter`
  rolls `QUEST_HUNT_CHANCE` (0.85) for every wandering fight on a tile where a home faction can field
  an unfinished kill target (`huntPlans`), and on a hit takes the same path as the miss guarantee: a
  hunt fight from that faction, a shape that holds the quarry (by shape weight), its slots filled with
  the hunted member. On a miss the fight is the ground's ordinary one *without* the hunt weighting,
  so the roll is the whole of the hunt and the rate stays near the chance at every band (with the
  weighting kept, band 2 climbed to 93%). The miss guarantee stays as the backstop. Where no shape of the band holds the
  quarry, a hunted **shooter or caster** stands in for one chaff slot (`huntStandIns`); `front` and
  `elite` quarry never stand in, so the home ring still never meets an Orc Grunt. What the Reeds Hide
  (replaced on 2026-10-23 by Hoofprints in the Mud, whose Storm Drummers the Thunder Herd fields on
  plains and highlands at bands 2–4: 87–96% of fights there in `questHunt.test.ts`, none elsewhere)
  was the case: band 0's only shape is two chaff (Fen Spawn), so the quarry was 0% there, about 25%
  at band 1 and 49% at band 2; a band-0 hunt is now one Reed Stalker or Silt Speaker beside one Fen
  Spawn. `bandsFielding` counts stand-in bands, so the hint and the paint cover them (the reeds paint
  swamp at bands 0–2). Measured in `questHunt.test.ts` over 2,000 fights per band on swamp (seeded):
  84.8% at band 0, 85.4% at band 1, 86.6% at band 2; 0 off the swamp (measured before the quest went). Swamp exists on haunted
  ground at every band (eight seeds: 144 band-0, 509 band-1, 673 band-2 haunted swamp tiles), and the
  paint stops at band 2 because the Fenfolk do. Encounter frequency itself is unchanged: this is the share of
  fights met, not how often a fight is met.
- **Status application follows one rule on both paths: afflictions cross the line, auras do not.**
  The AI path used to check `isAffliction(type) && target.isPlayer`, which silently discarded every
  buff an enemy cast — `rally` sat on the orc warchief for a whole version without ever landing. The
  rule is one shared `effectReaches(effect, caster, target)` in `statusEffects.ts` now, called from
  both, because a clause restated is a clause that drifts.
  - **`SkillEffect.selfOnly` is the narrowing on top of it, per entry rather than per skill**:
    "your own side" and "you" are not the same thing on a self-centred `Ring`. Unbreakable Vow taunts
    a two-hex ring and turns its own armour to spines — and the Thorns landed on every ally standing
    in the radius, which is precisely the set of people the same cast had just made safe by pulling
    the ring onto the Bulwark, while the one unit being hit by everything got nothing. The skill's own
    comment claimed the aura stayed on the caster for its whole existence. Per entry because that one
    cast needs both behaviours at once: a Taunt that must cross the line and an aura that must not
    leave the caster.
- `enemyAI` scores in units of expected damage, so a skill that deals none scores zero and is never
  chosen. Summons and support each need their own branch (`evaluateSummon`, `supportValue`); the
  caster's own hex counts half, which is what stops a lone unit buffing itself instead of fighting.
  Nothing values afflictions, so a skill whose point is its debuff has to *also* out-damage the
  unit's at-will attack or it will never be picked.
- A warband can fight as a formation (`EnemyTemplate.formation`, `systems/combat/formation.ts`):
  the Obsidian Legion's line marches first and its Stalker and Arcanist keep behind it until it
  engages. [Combat](combat.md) describes the rules (playtest PT-12).

Supporting pure systems: `statusEffects` (barrier, thorns, conditions, detonation) ·
`taunt` · `passives` · `cooldowns` · `summoning` · `forms` · `wildshape` · `bossPhases` ·
`combatEvents` (applies statuses and passive outcomes for *both* the player and AI execution
paths — keep them in sync there, not at the call sites).


## World map

Procedurally generated once per `mapSeed` by `systems/world/mapGenerator.ts` using the seeded
`utils/rng.ts` (mulberry32 + value noise) — regenerating from the same seed must be deterministic,
because the save holds only the seed and the player's marks (see *Worlds* below).
Time advances 1 hour per tile walked.

### Worlds: rules as data, one clock, a gate

**Each surface world is a `WorldDef`** (`data/worlds.ts`): its dimensions, home and far anchors,
threat radii, zone rules and which authored content it carries (frozen north, lairs, quest sites,
waysides, the gate). `generateMap(seed, world)` reads only that. The Empire's def is built from the
same `BALANCE` numbers the map was tuned with, and `worlds.test.ts` pins its output to hashes taken
before the refactor, so its map, routes and bands are unchanged seed for seed. `threatDepth` takes
the world's radii; in the Empire the castle's radii still never bind (see the plan's measurement),
while Jadeveil's do — every `home[i] + far[3 - i]` exceeds its camp-to-summit separation, so its
bands lean toward the summit.

**Jadeveil Range** is the second world, a generated range with its own terrain rules — see
*Jadeveil Range* below. Its seed is `worldSeed(mapSeed, 'jadeveil')`; the Empire keeps the
campaign seed itself. **The archipelago** is the third, islands in a sea, generated and drawn
only — see *The archipelago* below. Its id is appended to `WORLD_IDS`, never inserted, so no
earlier world's seed moves; only a development build crosses to it yet.

**What is per world and what is global.** `worldMapStore` holds the current world's tiles, party
position, live encounters, spent wells and finds, and keeps every other visited world as a compact
`WorldSnapshot` in `dormant`. The party, inventory, city, quests, empire, the ward and the clock are
global. Spent lair triggers stay one global set keyed by location id: every location belongs to the
one world that places it (a world never deals another's lairs), which is what keeps the keys
world-scoped and lets party slots keep counting every lair cleared. A world left behind catches up
on return — a new week recharges its wells and deals its finds, a new day re-rolls its encounters,
exactly as a rollover would have.

**The crossing** (`systems/world/worldGates.ts`, the rule; `worldTravel.ts`, the walk). The Empire's
gate is its own `POIType.WorldGate` — an arch on level road at the eastern frontier (threat bands 2–3,
at least `WORLD_GATE_MIN_CASTLE_DISTANCE` from the castle, with a free hex beside it), placed last and
without drawing from the generator so nothing else moves. A gate names its world (`WorldDef.gateTo`),
and the Empire's also offers every other world this build can enter (`WorldDef.enterable`), so the
player picks the order; the archipelago stays out of a release until Archipelago 1 builds the harbour.

A road beyond the Empire (`gateState`) is open when the world is owned (`ownedWorlds`, refusal reason
`unowned`, checked first), the Emperor has fallen (`emperor`), and the world has a level band already
or a crossing is free (`orb`, which names the orb boss of the world in play). **One road at a time:**
Aethelred's fall opens one crossing, and each world's orb boss opens the next on its first kill
(`data/levelCap.ts`, `crossingsOpened`, [the effective level cap](quests-progression-items.md#the-effective-level-cap)).
The way home is never locked, whatever ownership reads. With no road open the map refuses in those
words. With one open road, the dialog (`worldmap/WorldGateDialog.tsx`) asks the plain question; with
several, it is a choice, each open road a button and each shut one saying why. Before a first crossing
it says which levels the world will take ("This road will be levels 26–30", `crossing.bandFirst`),
afterwards which it holds (`crossing.bandKept`).

**The band ledger** (`systems/world/worldBands.ts`, held by `stores/worldBandStore.ts`, saved as
`worldBands`). `crossWorldGate` gives a world the next band on its first crossing, one more than the
number already banded, and the band never changes: band 1 is levels 21–25, 2 is 26–30, 3 is 31–35 and
4 is 36–40. A world is finished when its orb boss first falls: `ascentStore.clearSummit` marks
Jadeveil on Kairen's first kill. These are **level** bands, not a world's five threat bands. The world
map's region readout shows the world's as "Foothills · Lv 21–25". Story and repeatable levels inside a
band belong to a later feature (the bands plan).

Once Ivane has taken the red orb, the Empire's map guide gains a mode pointing at the gate
(`worldGateCoord`) while any road is open, **Jadeveil** when that is the one road and **Gate** when
there are more. The castle and its gauntlet keep their own door. Jadeveil's home tile is the foothill camp's gate,
which always leads home: arriving there walks into the camp, whose lacquered gate is the crossing to
the Empire. Crossing spends `WORLD_CROSSING_HOURS` on the shared clock, then stands the party
on the free hex beside the far gate, and autosaves. Every crossing leaves `worldMapStore.arrivalNotice`,
which the world map takes and says once ("You reach the Empire", `worldmap.toast.worldReached`) as
soon as it is current and its transition cover is down — a crossing from inside the camp unmounts the
camp's scene before the map mounts, and crossed in silence until 2026-11-03 (playtest 2026-10-21-b).
Never saved. A defeat carries the party to its world's home — the camp in Jadeveil, walked into
(`homeLocation`, which `CombatScene`'s defeat enters) — and a town portal, carried or a cleared lair's,
opens onto the same home (`townPortalHome`; see locations).

**Two clocks, deliberately: encounters re-roll daily, the land recovers weekly.** A day rollover
triggers the dawn heal — which mends the living only; the fallen wait for a magic well or a Tavern rest — and
re-rolls `activeEncounterTiles`, and the day's toast says both in plain words (`dawnNotice`:
"Day N: living heroes heal X% HP. Enemies roam to new places.", X including an expedition meal's
dawn bonus); a week rollover recharges magic wells
and deals a new week of exploration finds (below). Encounters are the game's *content*, and a week is
168 tiles of walking — content refreshing that slowly is a map the player memorises and routes around.
Wells and finds are the *economy*, and a well that recharges every 24 tiles is a free full heal on demand, which
deletes the attrition that makes a long expedition a decision.

**One rule for every way the clock reaches a world: the world catch-up.** `catchUpWorld` in
`systems/world/worldState.ts` is pure: given a world's live state, the day and week it was current
for and the clock's now, it returns only what re-rolled — finds, spent wells and merchants at a new
week, `activeEncounterTiles` at a new day (finds first, so the roll keeps clear of them). A world
with no state yet (`null`) is owed everything. `worldMapStore` calls it from `setTiles` (a new map),
`moveParty` (a step) and `switchWorld` (a return, or a first visit), always after the party's reveal,
and passes in the party's summed level, the ward's share and the clock. The dawn heal and the clock
itself are not a world's and stay in `moveParty`. The encounter roll (`rollDailyEncounters`) takes an
`rng`: the game rolls with `Math.random`, and `scenarioCreator` with its scenario seed. Tests:
`worldCatchUp.test.ts`.

**A spent well shows it.** A well drunk from this week is drawn as `poi_magic_well_dry` — the same
ring and arch with the water gone and the lamp out, nothing in it `glow` — in place of the lit
`poi_magic_well` (`propPlacements` swaps the key off `usedMagicWells`), and its sparkle ring is
already gone. Walking onto it again toasts "The well is dry — it refills in N days", from
`daysUntilNewWeek`; the week rollover empties the set and the model flips back.

**A journey is every tile of it.** `systems/world/travel.ts` is the rule, pure so it can be tested:
`planTravel` walks the route in order and stops the party **on** the first tile holding a live
encounter. Before it, the overworld reacted to exactly one hex per journey — the one tapped — so a
party could cross the length of a warband's hunting ground and arrive unbothered. The tile the party
is standing on is never re-checked, or winning a fight would restart it every time they tried to
leave; and the destination is checked like any other hex, which cannot collide with arriving
somewhere because `mapGenerator`'s danger pass skips any tile carrying a `poi`.

**Movement is two taps: arm, then confirm.** The first tap draws `components/shared/RoutePreview.tsx`
— the way there in blue, a ring on the destination, and **red on every `isDanger` tile crossed** —
and every threat-band seam touching the route's cells lights at full strength over the quiet default
(see *The threat-band seams* under *How ground looks*), so a route into a harder band says where it
crosses before the second tap. The red is keyed on the terrain and deliberately **not** on the day's roll: which danger tiles are
live is the one thing the player must not know before setting out, and colouring by it would turn
the confirm step into a minesweeper readout. Tapping the party's own hex calls the route off — it is
the one tile that can never be a destination, so it is free to mean that. **A route crosses
explored ground only** (`travel.planRoute`, shared by the tap handler and the review harness): the
destination always had to be explored, and the hexes between now must be too, so no plate — and no
red plate saying the hidden ground is haunted — ever lies on the mist, and two known patches joined
only through unknown ground are not one walk. A walk still reveals radius three round every hex it
steps on. The preview's meshes carry
`raycast={() => null}`, which is load-bearing rather than tidy: they sit directly over the hexes the
player must tap to confirm, so without it arming a move would make it impossible to make.

**The party token is a marching column under a crimson-and-gold standard, on a pool of light.**
`voxel/models/partyToken.ts` draws one figure per hero at `TOKEN_VOXEL` 0.12 (a figure is ~0.73
world units; it was 0.08 and a playtest could not find the party), the lead carrying a hanging
gonfalon — crimson field, gold cross, gold edge trim and two gold-tipped tails from a gilt crossbar,
about 0.67 × 0.62 world units, with a glowing finial near 1.8 — so it is two colours of strong
contrast rather than one gold rectangle the sand swallowed. `PartyToken.tsx` lays a soft unlit
warm disc with a brighter rim (1.75 across, inside the hex) on the tile under the column, so the
party reads against dark forest and pale sand alike. `partyToken.test.ts` keeps a full column
inside its hex, the standard on the lead figure only and above 1.0, and the figures readable by
value.

**The world map walks hex by hex; a location still moves in one store write.** Stepping is what
makes fog lift along the route, the clock tick by the hour it actually costs, and a fight start
partway. `stepInterval` in `components/shared/PartyToken.tsx` divides a fixed walking budget by the
number of hexes, so a short hop is unhurried and a forty-hex march is brisk rather than eight
seconds of watching. Locations get the two-tap confirm too — what it buys inside a place is that
triggers are one-shot, and mis-tapping the hex beside a chest used to be unrecoverable.

Tile arrival is **deferred** until the party token finishes walking, and re-reads the store rather
than the captured render — `revealAround` replaces the whole tiles Map on every step, so the copy
captured when the route was planned is several versions stale.

**What a step meets is the world step's, not the scene's.** `systems/world/worldStep.ts` holds the
rules the walk asks after every hex: `stepMeeting(world, hour)` reads the world map's store and the
clock after the step and says whether the hex holds a live warband (`holdsEncounter`) or, failing
that, a merchant (`merchantMet`, which an arrival also asks); `offersFlight` says whether a warband
is offered as Fight or Flee (Escape, under *Villages* below); `resolveFlight` and `fightWarband`
make the store writes a flight and a fight leave; and `worldContext` is what a fight on a map tile
carries into the arena. `WorldMapScene` keeps the walk's timers, the token, the settle before a
reaction and the dialogs, and `handleTileArrival`'s places (a lair, a gate, a well), each of which
opens a screen of its own. Tests: `worldStep.test.ts`.

**Mountains are ground, and `TileType.Highlands` is how you get onto them.** `isPassable` refused
water *and* mountains, which made a sixth of the map scenery: the peaks already had a height, a
relief amplitude, a prop family and a combat backdrop that nothing could ever reach. It refuses
water only now, and what stops a party strolling onto a summit is `movementCost`.

- **`MAX_CLIMB` sits in a window with a floor and a ceiling, and both are load-bearing.** At or below
  1.6 (swamp → highlands) a bog walls a range off from the rest of the map; at or above 2.0
  (forest → mountain) a peak can be walked onto directly and the highlands stop being the way up.
  1.8 is the middle. Every number in `TERRAIN_HEIGHT` is therefore a traversal rule, not decoration
  — Mountain came down from 3.0 to 2.6 to leave room for a legal step off the shoulder.
- **The comparison is symmetric**, so the movement graph is undirected. An ascent-only limit lets a
  party walk down into a bowl it cannot climb out of, and that is a soft-locked save.
- **Highlands are generated as the noise band directly under the peaks** (`0.88`–`0.94`). The noise
  is continuous, so that contour already wraps every range — the foothills come out geometrically
  correct for free, and `openMountainApproaches` only has to catch the places where the gradient is
  too steep for the band to have any width. It **demotes** a stranded peak rather than promoting its
  neighbour, because promoting grows a range outward and can cascade.
- **Three passes rewrite terrain — the city clearing, the castle and the road — and every one of
  them used to set `type` without `height`.** That cost nothing while elevation was decoration and
  strands a tile now that it is not, so they all go through `flatten`. They also check
  `isLevelGround` rather than `isPassable`: the latter stopped excluding mountains, so the castle
  could have been left on a peak with the endgame behind it.
- **`POI_PER_1000_TILES.magicWell` is 1.8, because four wells is the same as none.** At 0.9 a 70×70
  map got **four** — one per 1,225 tiles — so the attrition release valve the whole weekly recharge is
  designed around was decorative: a party effectively never routed through one, and the only recovery
  anybody used was the walk home, which is the decision a well exists to be an alternative to. 1.8 is
  **nine, on all fourteen seeds, measured rather than assumed** — the placement loop only *skips* a
  candidate too close to a well already placed, so it can silently under-deliver against its target
  and nothing would say so. `MAGIC_WELL_MIN_SPREAD` stays 10 and did not have to move, but it is a
  second and silent cap on the same number and has to be re-measured before any further raise.
  `MAGIC_WELL_COUNT_MAX` was read by nothing at all and is gone: a second answer to "how many wells"
  that never wins is a constant somebody eventually tunes expecting it to do something.
- **Ore prefers high ground and is the one POI allowed on an actual summit** — a mine at the top of
  a mountain is a destination. Quest sites and lair doors stay off peaks, because the lair gate is
  load-bearing and `lairs.test.ts` pins that every boss can be walked to.
- **`POIType.Wayside` is a person, and the only POI that is not a fight, a resource or a door.**
  Three of them — a trapper at a treeline, a hermit in the reeds, a prospector on a shoulder of
  rock — placed by `placeWaysides` and carrying an `NpcId` in `MapTile.npcId`. Walking onto one
  opens the same `DialogueModal` the city square does. They exist because every other destination
  on the map was somewhere to be attacked, so the only reason to leave the road was a danger tile.
  Each stands in a figure of their own — the fur hat and pale mantle, the drooping hood and lamp,
  the brimmed hat and digging bar (see models, `npcs.ts`) — where they used to borrow
  the city's three.
  - **Terrain first, then band, then distance from the city**, in `WAYSIDE_SPECS`. Terrain is what
    makes them read as somebody rather than as a marker; the band window is what makes the walk the
    right size of dangerous for the level their quests open at.
  - **Reachability is never relaxed and everything else is.** The tiers fall back terrain → band →
    distance, because a worse camp is a worse camp and *not placing one* is a person who does not
    exist and two quests that can never be taken. `movementCost` refuses water and refuses a step
    over `MAX_CLIMB`, so a hut across a lake is content with no error attached — `waysides.test.ts`
    flood-fills from the city on five seeds. The prospector is on `Highlands` and never a peak, the
    same argument that keeps lair doors off summits.
  - **Placed before the shuffled POI pool** is dealt from, which excludes tiles already carrying a
    `poi` — so nothing later can land on one. That also keeps them off danger tiles, since the
    danger pass skips anything with a `poi`.
  - **Revealed on generation, neighbours included.** A quest that says "go and find Rell" aimed
    into unexplored fog is the wolf quest that cost a playtest four in-game weeks, in a new hat.
    The *figure* is still culled at `PROP_RENDER_RADIUS`, so what carries across the map is a lit
    tile rather than a spoiled one.
  - `trackedQuestTarget` points a `talk` objective at the wayside holding that person, falling back
    to the city for the three who keep it. Without that the arrow sends the party home, which is
    exactly the wrong way.
- Anything that stands *on* a tile goes through **`tileTopY`**. The `0.3` and `0.1` were written out
  at each call site, and the party token became a third consumer the moment high ground was
  walkable — a fixed `y = 0.5` put the banner inside the hillside. `highlands.test.ts` flood-fills
  from the city over the real cost function; all five sample seeds reach 100% of their high ground.


## The frozen north

**A latitude rule, not a noise band.** Terrain is one noise value ordered water, swamp, plains,
forest, desert, highlands, mountain, so nothing on the map depended on where it was and the map had
no cold region at all. `mapGenerator.inFrozenNorth` freezes a wedge in the north-east, the far end
of the map from the city that is not the castle's corner: above a row threshold that is zero at
`FROST_WEST` (0.32) of the width and deepens with a smoothstep to `FROST_DEPTH` (0.4) of the height
at the east edge. Every tile inside is marked `MapTile.frost`. Plans and design reasons:
the private project notes.

- **Level ground freezes; water and rock keep their terrain.** Plains, forest, desert and swamp
  become `TileType.Tundra`; water stays water; highlands and mountains stay what they are, because
  `TERRAIN_HEIGHT` is a traversal rule about rock, and draw as their frozen surfaces instead
  (`frost_highlands`, `frost_mountain` — see *How ground looks*). **Swamp is frozen too, which the
  plan's list left out**: left alone it stood in the snow as green bog with reeds, about one frozen
  tile in fourteen. `flatten` writes Tundra rather than Plains on a frozen tile, so a road or a
  clearing cut through the north leaves no strip of grass.
- **Tundra stands at 0.3**, between the plains and the desert it is made from and inside the window
  `MAX_CLIMB` leaves level ground: the highlands are a legal step up from it and a peak is not.
- **One region on every seed, and that is built rather than hoped for.** The edge wobbles column by
  column (`FROST_WOBBLE`, a 1-D noise over the column), so each column's frozen tiles are one run down
  from row 0 and every run touches the top row; a two-dimensional wobble would drop frozen islands
  south of the line. The wobble eases in with the square root of the depth and never cuts deeper
  than half of it, so row 0 is frozen in every column that has any north. In proportion to the depth
  it left the shallow western tip a ruled row for ten columns.
- **Never below band 2** (`FROST_MIN_BAND`). The wedge's south-western edge runs close to the city's
  rings, and a shore put the odd snow tile in band 1 on 18 of 60 sampled seeds. Bands fall toward the
  city down every column, so the cut trims the foot of a run and cannot split the region. 0 of 60
  seeds split or reach band 1 with it.
- **The wobble's phase is taken from the seed, not from the generator's stream.** `valueNoise2D`
  ignores the `rng` it is handed — the terrain noise is the same field on every seed, and only roads,
  zones and placements differ — so drawing a number from the stream here would have moved every road,
  door and well on every map to buy a shoreline.
- **Crystal prefers the north**, the way ore prefers high ground: a frozen tile weights Crystal 4 in 7
  in the weekly find deal (see *Exploration finds*), and `finds.test.ts` pins that most Crystal finds
  lie in the region.
- **Roads barely reach it.** On the capture seed 664 of 705 frozen tiles are haunted, so what a
  player sees of the north is mostly haunted Tundra. That is why haunted Tundra is tuned to still read
  as snow.
- **Factions.** **The Rime Jarls** (bands 2–4) and **the Hoarfrost** (bands 3–4, and the ice lair's
  guards besides) are locked to frozen ground (`Faction.homeLocked`, `frostOnly`): Tundra, and
  highlands that carry `MapTile.frost` — snowy highlands are winter ground, bare highlands are not.
  Off it they have no entry at all; on it they roll at the local weight beside the roamers. The ice
  lair's door stands inside the frozen north (`LairSite`, see *Locations*). See *Combat* for the four
  rosters, and *The biome lock* below for the rule.
- **The ice lair's door is the north's landmark**: a tongue of glacier with a cave in its face, the
  Heart's cyan deep inside and Blood-Iron chains staked into the snow before it. Its apron is the one
  darker than its ground — trodden blue ice on pale haunted Tundra — where every other lair's is a
  pale patch on dark haunted earth. The Wyrm's Hollow's door stands on desert outside
  the north, so the red-rock crag stands in red rock.

**Encounter ground after the change**, measured as the plan's table was: haunted, walkable tiles
without a POI, over ten seeds (1, 7, 42, 99, 1234, 4242, 90210, 777, 31337, 1471934286). The frozen
north is 14.1% of all tiles; inside it 88% is Tundra, 7% highlands, 3% mountain, 1% water.

| Terrain | Share | Band 0 | Band 1 | Band 2 | Band 3 | Band 4 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Plains | 33.0% | 1.7 | 9.2 | 9.6 | 8.7 | 3.8 |
| Forest | 23.3% | 1.0 | 4.8 | 8.3 | 6.4 | 2.8 |
| Tundra | 17.4% | 0.0 | 0.0 | 4.5 | 9.1 | 3.8 |
| Desert | 13.3% | 0.5 | 1.6 | 4.4 | 4.9 | 1.8 |
| Swamp | 8.4% | 0.6 | 1.9 | 2.6 | 2.3 | 1.0 |
| Highlands | 3.2% | 0.3 | 0.2 | 0.6 | 1.4 | 0.8 |
| Mountain | 1.4% | 0.2 | 0.0 | 0.1 | 0.4 | 0.8 |
| **All** | | 4.3 | 17.7 | 30.1 | 33.2 | 14.8 |

The plan's before-figures were plains 39%, forest 29%, desert 15%, swamp 9%, high ground 4%. Tundra
takes about a sixth of encounter ground, all of it in bands 2–4, and band-3 plains and desert fall
from about 17% of encounters to 13.6%.

### The biome lock

A themed faction lives somewhere (the private project notes). **A `homeLocked` faction is a
candidate only on its home ground and has no entry anywhere else** — not one, no edge bleed
(`factionCandidates`, `atHome`). **A roamer fits every ground its band allows and keeps its three
entries at home against one elsewhere.**

| Locked to | Faction |
| --- | --- |
| frozen tiles (Tundra, snowy highlands) | Rime Jarls, Hoarfrost |
| desert | Sandscourge |
| swamp | Fenfolk |
| forest | Beasts |
| highlands, mountain | Delve; and in Jadeveil the Fallen Order |
| plains, highlands | Thunder Herd |

Roamers: Greenskins, Brigands, Ashwood Coven, the Restless Dead (who still enter band 4 at home only,
`homeOnlyFrom`), the Obsidian Legion (its castle leash is its turf), and in Jadeveil the Yokai and the
Draconic Host. The frost flag travels with the fight (`EncounterTerms.frost`, from `MapTile.frost`).

- **Hunts and chest guards obey the lock.** The 5× hunt weight is given to a hunted faction only on its
  own ground; a roamer met off it is unweighted. The hunt roll (`QUEST_HUNT_CHANCE`) and the guaranteed hunt after `QUEST_HUNT_MISSES` take
  only a faction that is at home on the tile, so they wait for the next fitting tile instead of fielding
  a faction off its ground, and a tile that cannot field the quarry leaves the streak alone. The hint
  names the biome: a locked quarry reads "Found only in …" (`campaign.hunt.lockedTerrain`), and the map
  paints snowy highlands only where the tile has frost. Chest guards draw from the same filtered pool;
  `CHEST_GUARD_HOME_WEIGHT` is 1 now, because the locked natives already crowd it.
- **The pool is never empty.** Every walkable ground has a roamer at every band of both worlds, so the
  old "every faction regardless of band" fallback is gone and `factionCandidates` throws if it would
  be reached (`factionLock.test.ts` pins it across both worlds, every band, terrain and frost).
- **Sites sit on their faction's ground**: see *Locations* for the Wyrm and the ice lair, and the
  Jadeveil bullet on shrines above.
- **Pinned on real maps.** `biomeLock.test.ts` rolls every walkable tile of ten Empire and ten Jadeveil
  maps for wandering fights, hunts and chest guards, and fails if a locked faction is fielded off its
  ground; `sitePlacement.test.ts` sweeps forty seeds for the door and shrine placement.

**Who meets you there, with the lock** (same ground and ten seeds, each tile weighted equally, the
Legion counted where its leash reaches): the share of fights rolled from a faction native to the
ground, and who holds the most of it. The Legion is not counted as native.

| Terrain | Band 2 | Band 3 | Band 4 |
| --- | --- | --- | --- |
| Plains | 82% — Greenskins, Brigands, Thunder Herd (27% each) | 58% — Thunder Herd | 67% — Thunder Herd (Legion 11% near the castle) |
| Forest | 67% — Restless Dead, Beasts (33% each) | 74% — Restless Dead, Coven the rest | 72% — Restless Dead, Coven the rest |
| Tundra | 43% — Rime Jarls | 75% — Rime Jarls, Hoarfrost (38% each) | 86% — Rime Jarls, Hoarfrost (43% each) |
| Desert | 82% — Greenskins, Brigands, Sandscourge | 60% — Sandscourge | 75% — Sandscourge, Coven the rest |
| Swamp | 82% — Restless Dead, Fenfolk, Coven (27% each) | 97% — Restless Dead, Coven | 97% — Restless Dead, Coven |
| Highlands | 61% — Delve, Thunder Herd (29% each) | 80% — Delve, Thunder Herd; snowy highlands add Rime Jarls and Hoarfrost | 91% — Delve, Thunder Herd, snowy Rime Jarls and Hoarfrost |
| Mountain | 43% — Delve | 60% — Delve | 75% — Delve |

- **Identity over variety**: late forest, desert, swamp and mountain are two or three factions now
  (band-4 desert is the Sandscourge at 75% and the Coven at 25%, the Coven being the only outsider
  there). That is the point of the lock. **The supply shift is landed as it fell, with no
  retuning: verify in playtest.** `homeRing.test.ts`'s 3→4 step is ×1.24, under its old ×1.25 floor,
  which is now ×1.2, and `threatDepth.test.ts` records the new seams (×1.10, ×1.14, ×1.59, ×0.86).
  `encounterSupply.test.ts` measures how many fights there are, not who fields them, so its bounds did
  not move.
- **Band 4's natives are the frozen north's older gap, kept**: before its release check, 92% of band-4
  forest tiles, 98% of band-4 desert and all band-4 mountain had no native faction. The Restless Dead
  reach band 4 at home only (`homeOnlyFrom`); the Sandscourge and the Delve are locked to their
  ground.
- **Outside the check's bands**, band-0 highlands and mountain (0.5% of encounters, by the city's
  ring) still have no native faction: the Delve start at band 1. `frozenNorth.test.ts` pins the rules: one region, north of
the city and leaning east, between 8% and 22% of the map, never under band 2, Tundra exactly where
frozen level ground is, and peaks on most seeds.

## Jadeveil Range

The second world (`JADEVEIL_WORLD` in `data/worlds.ts`): a 39×35 range, **1,365 tiles against the
Empire's 4,900 (28%)**, climbing from the foothill camp in the south-west corner to the summit in the
north-east, 47 hexes apart. The camp is the map's first column on its last row, with no ground behind
it (playtest 2026-10-23); it stood five columns and rows in on a 44×40 map, and cutting that strip
kept the distance and every band radius. In the corner it stands at the range's lowest, wettest
ground, so no tarn forms within `RANGE_CAMP_DRY_RADIUS` (6) of it, and a shrine bound to its keepers'
ground (the Fallen Order's) may be reached across a tarn the road will causeway when it cannot be
walked to, which on one seed in 25 left the generator throwing. Older figures below (terrain shares,
band shares) were measured on the 44×40 map. Its seed is `worldSeed(mapSeed, 'jadeveil')`; the Empire keeps the
campaign seed. Its factions, shrine chain, two lairs and camp people are its own (below and
quest-campaign, *Jadeveil*), and nothing of the Empire's is dealt onto it. Evidence: Jadeveil map and camp.

**It plays at the level band it took** (the plan, *Jadeveil,
restated*; `systems/world/contentLevel.ts`). Numbers below that name a level are band 1's, and every one
moves up five levels per band (`data/levelCap.contentBand`). Each area and site has a fixed level whatever
the party's: Foothills, Bamboo Terraces, High Passes, Storm Ridges and Cloud Crown at band floor +0 to +4
(`WorldDef.levelOffsets`), the Silk Hollow +1, the Silent Hall +3, shrine keepers their shrine's threat band,
Kairen's story fight +4. His Storm Seal tiers 2–5 are repeatable, at the current cap. A party at an area's
level meets the fights it always did, and a party coming back later finds the story where it left it. The
sheets, the band power table and the off-pace table are in [combat](combat.md); its loot in
[quests-progression-items](quests-progression-items.md#jadeveil-equipment); its XP, gold and gates in
quest-campaign.

**Its encounter supply, measured** (2026-11-04, five seeds, analytic over the real generator: rate ×
`DAILY_ENCOUNTER_CHANCE` over the tiles that can roll, the week's finds not taken off). `encounterTimidity` read
the Empire's `BAND_EXPECTED_LEVEL` here, which held a party at an area's level to 0.25–0.55 of the roll; it now reads
the area's own level, so that party sees all of it.

| Area (level) | Tiles that can roll | Timidity before | Live per day before | Live per day after |
| --- | --- | --- | --- | --- |
| Foothills (21) | 151 | 0.25 | 5.4 | 21.4 |
| Bamboo Terraces (22) | 189 | 0.25 | 7.3 | 29.3 |
| High Passes (23) | 282 | 0.28 | 13.6 | 48.0 |
| Storm Ridges (24) | 273 | 0.42 | 19.0 | 45.7 |
| Cloud Crown (25) | 316 | 0.55 | 28.4 | 51.7 |

That is four times the fights in the first two areas and about 1.8 times on the Cloud Crown, and over the map
74 a day becomes 196. The rule stays; if the full supply reads as too busy in playtest, the knob is an encounter
chance for the world, which does not exist yet. A level-40 party back in a band-1 world reads 0.53–0.63 of the
roll, by the Empire's own reciprocal, and flight reads the same measure (`fleeChance`).

- **The Yokai** (`'yokai'`, *Nothing here is what it looks like.*) are the range's own at bands 0–2 on forest and plains,
  the bamboo and the terraced slope below the shrines, and walk no other world (`Faction.worlds`). Kodama, Kappa,
  Tanuki, Onibi, Kitsune and, as the roaming elite since the shrine campaign, the **Nue**; their kits are in
  [combat](combat.md), their models in the Yokai models' verdict and
  the Nue's in the Silk Hollow's. `yokaiFaction.test.ts` pins them.
  The **Jorōgumo** left the roaming roster: she is the Silk Hollow's boss.
- **The Silk Hollow** (`lair_silk`, `locations/jadeveil/silkHollow.ts`) is the Yokai's lair, in band 2 on forest or plains,
  gated at summed level 84 (`unlockOverBand`, +4 over `4 × (band floor − 1)`), its boss the Jorōgumo, the Canopy Weaver (hanging on three threads until they are cut; see
  [combat](combat.md)). A hollow in the bamboo: six chambers — a small entry, a small guarded den, the great web hall
  (radius 3) holding the first chest, a cocoon cave off its north side holding the second, a second guarded den and her nest
  — on one-hex runs. Its own surfaces (`silkmoss` chambers, `bamboo` runs, `rootwall` rock with a mossy cut face,
  `terrainDisplay`), its own dressing (`voxel/models/silkHollowProps.ts`: bamboo culms, silk sheets, cocoons, moss and fern,
  foxfire lanterns as its only, cold light, and her web nest behind the boss), and its own door
  on the map (`poi_lair_silk`: bamboo over a dark root mound, the mouth sheeted with web, cocoons hung off the culms, and
  foxfire inside that goes out when it is cleared).

- **The ground is an altitude, not the Empire's noise bands** (`systems/world/rangeTerrain.ts`,
  `WorldDef.terrain: 'range'`). A slope from camp to summit (`RANGE_SLOPE`), ridged noise that
  raises spurs with valleys between them (`RANGE_RIDGE`, `RANGE_RIDGE_SCALE`) and fine detail; the
  cuts in `RANGE_ALTITUDES` make tarns in the wet valley floors, moss and bamboo below the
  shoulders, terraced highlands and rock. The field is offset by a phase taken from the seed, as the
  frozen north's is, and draws nothing from the generator's stream. Over ten seeds: plains 27%,
  highlands 28%, forest 27%, mountain 15%, water 3%, and no desert, swamp or tundra. Peaks stand in
  bands 1 to 4 (2%, 12%, 27% and 58% of them), so there are ranges below the summit's.
- **Every tile is an ordinary `TileType` at that type's height**, so the climb rules are the
  Empire's: highlands are the way up, a peak is entered only from them, water is the one wall.
  What is Jadeveil's own is the ground each wears, `MapTile.jade`: moss on plains, bamboo on
  forest, terraces on highlands, ridge on mountain, the storm-worn **crown** on band-4 mountain, and
  **shrine** ground on the level hexes round a shrine. Set last, once no pass moves terrain.
- **Five bands, spread evenly and leaning toward the summit.** Home radii `[18, 25, 32, 39]` and
  far radii `[12, 19, 26, 33]` were chosen by search over the map's own hexes for the most even
  shares with every `home[i] + far[3 - i]` above the 47-hex separation: **21.1 / 16.8 / 21.9 / 20.2
  / 19.9%** (the Empire's band 4 alone is a sixth of its map and band 3 nearly a third). The bands
  are perpendicular to the camp-to-summit line, so a route's direction, not only its length,
  decides how hard the ground gets. Each world names its bands (`threatBandName`, read from the `world` catalog's `<world>.threat.<band>`):
  Foothills, Bamboo Terraces, High Passes, Storm Ridges, The Cloud Crown.
- **Two lairs of its own** (`lairsOf('jadeveil')`, files in `locations/jadeveil/`): the Yokai's Silk Hollow in
  band 2 and the Fallen Order's **Silent Hall** in band 3 (gate 92, boss the Last Lesson), both described in
  the locations reference, *Boss lairs*.
- **A shrine stands on its keepers' ground when they are locked to one** (`Faction.homeLocked`): the
  Fallen Order's shrine 2 takes a band-2 highlands tile and keeps it highland — not flattened to
  plains — and generation throws when none is reachable, as for a lair door
  (`sitePlacement.test.ts`). The Yokai's and the Draconic Host's shrines roam and stay flattened.
- **Four shrines on a pilgrim road that climbs** (`placeShrines`, `content.shrines`). Shrine `i`
  stands in band `i`, on ground the camp reaches without crossing a harder band (the lair doors'
  rule), at least `SHRINE_MIN_SPREAD` from the shrines below it and from the summit, nearest the
  middle of its band's ascent and pushed alternately `SHRINE_SWITCHBACK` hexes to either side of
  the camp-to-summit line, so the road switches back. Each is flattened (but see the bullet above for locked keepers), lit from the start with its
  neighbours, and keeps its place in `MapTile.shrine`. The artery runs camp → shrine 1 → … →
  shrine 4 → summit. **A range's road climbs rather than levels** (`cutStep`): it cuts a peak to a
  shoulder and a tarn to a causeway and keeps shoulders, so every road step is at most plains to
  highlands, inside `MAX_CLIMB`. The summit and its ring are cut to shoulders too, so the crown's
  peaks ring the summit rather than stand over it. A road hex that climbs into a harder band than
  the road it joins is a **pass** (`MapTile.pass`), about fourteen to a map.
- **The shrine chain gates the ascent** (`systems/world/shrines.ts`). Shrine `i` is claimed by
  beating its keepers on its hex (`shrine_<i>`: the Yokai at 1, the Fallen Order at 2, the Draconic
  Host at 3 and 4 — the Host holds the road to Kairen and has no lair). The keepers are six bodies,
  one of every kind their faction fields (`composeShrineKeepers`: the line, the archers and casters,
  the elites, then any chaff, so the Yokai field all six of theirs), at the shrine's band and
  `SHRINE_KEEPER_POWER` (×1.25) above the ground's own power (playtest 2026-10-28: a warband one body
  wider was far too easy). Claims are made in order and kept as one count,
  `ascentStore.shrines` (save 60), global and permanent: wrath decays, a claim never does, and no
  world snapshot holds it. **Bands 0–1 are open from the start; band `b` opens with shrine `b − 1`;
  the summit hex opens with shrine 4** (Kairen's fight waits on the wrath window — *The summit*
  below). A route
  refuses barred ground (`planRoute`'s `refuse`), and tapping it says which shrine opens it
  (`lockedRefusal`). Solvable by construction: a shrine stands on ground the camp reaches without a
  harder band, which `shrineChain.test.ts` walks on eight seeds with only the claims below each
  shrine. Arriving at a held shrine says the incense burns for you; the next one starts its keepers'
  fight; the summit says which shrine is missing, then the wrath rule (`summitArrival`), unless
  its door has a tier to climb to.
- **How the chain reads on the map.** An unclaimed shrine is drawn with its lamps out
  (`poi_shrine_spent`), lit once held; a pass into barred ground carries a straw rope hung with white
  paper streamers across its flags (`poi_pass_barred`), so the next pass to open reads from the road
  below. The guide's Ascent mode points at the next shrine to claim, then the summit.
- **Reachability is pinned on eight seeds** (`jadeveilRange.test.ts`): all land reachable from the
  camp, every well, every shrine within its own band, the summit; the road joining camp, shrines and
  summit; deterministic per seed.

**The Heart of Winter's refight** (`systems/world/heartRefight.ts`, on the shared `sealLadder.ts`;
twists in [combat](combat.md)). It is an Empire door, described here beside the summit it is modelled on. The cleared
Glacier Deep (`lair_barrow`) does not refuse the party as the Warren and the Hollow do: its map door opens
`HeartGateDialog`, and the chosen tier starts `heart_seal_<tier>` straight in the lair boss's chamber
(`locationContext` at `bossAt`), with no guard rooms. `curatedBand` and the plan read it as `lair_barrow_boss`.

- **Its own Winter Seals** (`empireStore.winterSeals`, `heartTier`, save 83, `isHeartLadder`). Castle and Storm Seals do not
  open it, and these open nothing else. The lair's own kill pays a tier-2 Seal (`CombatReward.winterSeal`).
- **Tier 1 is free at the cleared Barrow** (the ladder's `free` bottom rung): it pays the ordinary drops and a tier-2 Seal
  but no chest, so a party out of Seals climbs back without a chest farm. **Tiers 2–5 spend a Seal of that tier on the way
  in, win or lose.** A loss costs what any lost fight does and leaves the party on the map at the door (`atDoor`), not
  carried home. A save mid-fight resumes from its snapshot, the Seal still spent.
- **Price and pay.** Power is the lair boss fight's × `heartTierScale` (1 + 0.2 × (tier − 1)), XP and gold the same factor.
  A tier-n clear (n ≥ 2) pays a chest and the boss's drop at `levelCap() − 5 + n` (`ladderItemLevel`) and a Seal of tier
  n + 1, capped at 5. A refight skips the boss tile's `markDefeated` and `reportPoiCleared`, and the lair's chest, slot and
  achievement belong to its own encounter, so none repeats. A kill objective on a quest still active would count a refight's
  Heart, as a finished quest's never does.
- `isRepeatableEncounter` names every tier. `heartRefight.test.ts`, `heartSave.test.ts` and `sealLadder.test.ts` pin this.

**The summit** (`systems/world/summit.ts`, the door to Kairen's fight — see *Kairen* in the combat
reference). Arriving on the summit hex with all four shrines held opens `SummitGateDialog` whenever
a tier can be climbed to (`openSummitTiers`); otherwise it says what is missing (`summitArrival`).

- **Tier 1 is the story fight, and the open wrath window is its door**: entering spends nothing,
  and a loss or a turn back leaves the window running — the party may try again while it lasts; once
  it closes the wrath must fill again. The same door still opens on tier 1 while a window is open
  after Kairen is dead, so a party that has spent every Storm Seal is never locked out for good
  (a refight pays a tier-2 Seal and no story).
- **Every tier above is a Storm Seal of that tier**, any time and with no window (wrath only grows
  from one-time deeds, so a ladder tied to it would end), and **the Seal is spent on the way in, win
  or lose** (`ascentStore.enterSummit`, `summitSpendsSeal`), as the castle's are.
- **A tier-n clear pays a Storm Seal of tier n + 1, capped at 5** (`stormSealRewardFor`: a tier-5
  clear pays another tier 5), and a chest at item level `levelCap() − 5 + tier`
  (`summitItemLevel`, the loot's `ground.level`; `combatRewards` rolls the boss's drop and a chest as
  the castle's last stage does — the legendary table itself is the equipment feature's). The
  fight's power is `summitTierScale` (1 + 0.2 × (tier − 1)) and **never wrath's** (see *Wrath*);
  each tier adds its twist (`TIER_TWISTS`, cumulative), which the dialog lists beside his strength,
  the chest's level and the Seal's warning.
- **The first kill is the story's, once** (`ascentStore.clearSummit` → `firstKill`): its reward
  carries the death line and the orb falling (`CombatReward.summit.story`), it pays the tier-2
  Seal, and the orb's quests close by their own kill and hand-in, which a finished quest never
  counts again (*quest-campaign*). A repeat kill pays its tier's Seal and chest and nothing else.
- **Saved** as `ascent.summit` — `slain`, the Seals by tier and `highestTier` (the highest ever
  cleared, never lowered) — in save 61 (`isSummitState`); `summitSave.test.ts` writes and reloads
  it, and `kairenSummit.test.ts` pins the door, the spend, the reward ladder and the one-time story.
- **The arena is the site's own** (`EncounterContext.site: 'summit'`, set by the door and the harness):
  `compositionKeyFor` looks a site up by its own name, so the summit fights in `arenas/summit.json`
  (`CLOUD_CROWN` in `sceneryKits.ts` and `groundPatches.ts` its fallback) rather than in the mountain pass its
  hex's terrain would give. A karst peak top: six shelf sectors at radius 11.6 meet all round, so the land
  falls 11 units in five terraces on every bearing — the cliff that stops a push is the arena's edge — into a
  pale cloud-sea lower country under a cold pale haze. It stands only Jadeveil's own pieces: the crown's crags
  on the rim, wind pines and boulders on the peak top and flags at its head, and out to the camera's reach
  karst towers and crags standing out of the cloud sea with banks of cloud lying on it
  (arena internals, "Jadeveil's arenas").
  Layouts, the format and Arena Forge gained a third context kind, `{ kind: 'site', site }`
  (`arenaLayout.ARENA_SITES`, `encounterContext.siteContext`, the forge's site choices), and the gate's
  table a `summit` row (derived: no reference image). What it costs to draw is in the closing gate run's
  record (the private project notes).
- **For review**, the visual harness's `kairen({ tier, phase, taint, at, warn, due })` opens the
  fight at any tier and phase with a warning raised, and `summitArrive(summit)` opens the door as a
  walk there would.

**The foothill camp** is Jadeveil's home (`WorldDef.camp`). Its tile is still the `WorldGate` (the
arrival point and the way home), but arriving there walks into the camp — a place of its own,
`camp_jadeveil`, like the city (see locations, *The foothill camp*) — instead of the
crossing dialog. Each service is a station there with its own counter (`CampCounter`): **rest by the
fire** (`systems/economy/campRest.ts`: `CAMP_REST_HOURS` 6 on the clock for
`CAMP_REST_PRICE_FRACTION` 0.5 of a Tavern bed, full health and mana with the fallen revived),
the **monastery**, **Sell** at the pack-trader and **Salvage** at the whetstone (the shop's
`SellBench` and the forge's `SalvageBench`, one rule wherever they are done), and **the lacquered
gate**, which asks for the crossing to the Empire. Nothing else of the
city's is there. The rest's numbers are a first pass, to be judged in playtest.

**Navigation.** The guide's home mode reads "Camp ●" in a camp world and points at the camp. A
range adds **Ascent** after Quest (off → Camp → Quest → Ascent): the arrow points at the next shrine
to claim (`ascentTarget`), and once all four are held at the summit. The summit is lit from the first turn like the castle, and prayer
flags (`poi_pass_flags`) stand at every pass.

**How it looks** (see *How ground looks* and *What stands on a world hex*):

- `JADE_DISPLAY` / `DANGER_JADE_DISPLAY` in `terrainDisplay.ts`, keyed `jade_<ground>` and
  `danger_jade_<ground>`: grey-green moss, jade bamboo, gold terraces, blue-grey ridge, violet
  crown, pale shrine stone. They answer to the separation rule among themselves and against water,
  which is all they meet; every haunted twin is ash with its hue kept, except the crown's, which
  goes a cold teal-grey because it is too dark to step down by value. Walls follow the 1.35 / 0.022
  rules. **Every grain is Jadeveil's own** (`JADE_GRAIN`, `JADE_GRAINS`): moss (turf with stone
  flecks), culm (litter laid one way), terrace (the strongest stretch, contour lines), and, laid in
  square blocks (`GroundTextureSpec.cells`, the voxel language; every Empire grain is smooth),
  karst on the ridges (smeared down the slope like rain streaks), crag on the crown (scoured bands),
  paving round a shrine, and for the haunted twins ghost moss, dead terrace and cold rock — never
  the Empire's ash. The blight fields work as in the Empire; the range has no climate field.
- **The range's high ground is its own land, not the Empire massif recoloured** (`worldLandforms.ts`,
  `jadeRise` and `jadeColumnLook`, from the look bible).
  The same world-aligned columns, centre ledges, road guards and cutaway as the Empire's, shaped
  three ways. *Terraced hillsides* on the terrace shoulders: a coarse field (higher toward the
  ridges) cut by the absolute terraces into level treads that follow its contour; a steep cut
  (`JADE_LAND.terraceSlope` 0.95) keeps the ledge round a centre a block or two wide, because a
  gentle one ringed every centre with treads and drew the hex net. Gold turf on the treads, laid dry
  stone with dark joints down every riser, dark tea along a tread's edge toward the camera where the
  tea field runs, a paddy (water ringed by its bund) on a swell's lowest tread where the paddy field
  peaks. Treads take no hill shade (they are level) and skip its four samples. *Karst towers* on the
  mist ridges: pale limestone on a jittered grid (`karstCell` 1.25, 60% of cells), each a ragged
  block column 0.4–0.7 across and 1.0–2.0 tall with a short rubble skirt, standing sheer
  (`towerSlope` 4.6) out of low rough ridge ground; streaked walls, a moss cap. *The crown's spires*:
  the same towers narrower and crowded (`spireCell` 0.82), violet, cloud-capped above a wandering
  line. Haunted: grey-gold dead treads, bare tea, black still paddies, karst weathered mid-grey with
  ghost moss in patches, the crown cold teal-grey. A column carries a wall colour as well as a top
  (`TerrainColumn.wall`, an instanced `bankWall` attribute in `bankShader.ts`): a side face takes it
  under a lip of the top's colour (`BANK_LIP` 0.04), turf over laid stone; the Empire's rock is one
  stone through (wall = top), so it draws as before. Cost: the range composes about 32,000 columns
  fully explored (seed 42), mostly treads — about 0.27 ms a column inside Jest against the Empire's
  0.19, roughly six times the Empire map's whole-map work; a window and a reveal are carried as before.
- Scenery (`worldScenery.ts`, kit in `strategic.ts`): bamboo stands by the wood mass rule, the
  wind-shaped mountain pine, mossy boulders, karst pillars on ridges, tea and dry-stone terrace
  courses turned one way per hex so they read as contour, fallen terrace stones, blue-grey lichened
  scree on the ridges and violet scree and rock on the crown, and nothing on shrine ground. **The
  haunted grounds are yokai-touched, each its own setting** (`ghost-moss` for moss and shrine,
  `dead-bamboo`, `dead-terrace`, `dead-ridge`, `dead-crown`): withered black culms with pale node
  rings, snapped culm stumps with a charm, charm posts and cold lanterns (their fire a pale-blue
  colour, not a light) in knots where the `haunt` field runs high, ghost pines where the meadow field
  peaks, ghost moss, still black paddies, dead tea, pale weathered boulders and dead karst. No bone,
  grave, ash, burnt wood or burgundy. Water and its reeds stay the shared ones. The scenery suite
  runs every rule on two Jadeveil maps as well, and `jadeveilMap.test.ts` pins that no Jadeveil
  setting places a piece any Empire setting does.
- Landmarks (`landmarks.ts`): the foothill camp (a red lacquered gate with the jade lamp, two tents
  and a fire), the shrine (plinth, hall and two tiered jade roofs with gold eaves, lanterns), the
  summit (a storm-worn spire with cloud on its flanks and the orb's light in a cleft, drawn at 1.4),
  and the pass flags. The pilgrim road carries no Legion wreckage. **No shared landmark draws on a
  Jadeveil tile** (`propKeysFor` by `MapTile.jade`): a magic well is a *spirit spring* (mossy stones
  round a lit jade pool with mist lifting off it, a tall marker stone tied with rope and streamers;
  `poi_spirit_spring_dry` once drunk, silted dark), a wayside camp a *tea house* (timber on a
  platform under a dark hipped roof, a red door cloth, a bench, a lit brazier and kettle, a tea row),
  an unnamed quest arch a *torii* (vermilion, a waiting charm on its tie beam, a lit stone lantern).
  The range deals no waysides or quest sites today, so the tea house and the torii stand ready for
  when it does.
- **The sky is the wrath's** (`data/display/worldSky.ts`): the scene reads the haze and how far
  into it the frame's top edge stands from `worldSky(world, weather)`, and the weather from the live
  wrath (*Wrath, weather and the monastery* below). The Empire has only its tuned `clear` row;
  Jadeveil's clear sky is a damper green-grey.
- Fights on Jadeveil ground are fought in arenas of its own (`EncounterContext.jade`, carried from
  `MapTile.jade` by the world step's `worldContext` and `resolveEncounterContext`): `compositionKeyFor`
  gives `jade_moss`, `jade_bamboo`, `jade_terrace`, `jade_ridge` and `jade_crown` and their `danger_`
  twins, the board and its grain are the ground's own (`JADE_DISPLAY`), and a shrine's keepers — and
  any fight on the paving round a shrine — are fought in the `shrine` courtyard, a world site like the
  summit. Every one is dressed only from Jadeveil's prop kit (`arena_jade_*`, built from
  the look bible); `jadeveilArenas.test.ts` pins that no Jadeveil
  fight, the lairs and the summit included, reaches an Empire kit, ground or prop. What each arena is —
  the open moss valley, the closed grove, worked terraces, the steep ridge, the crown over the cloud sea,
  the courtyard dressed per band — is in arena internals, "Jadeveil's arenas".


### The Draconic Host

Jadeveil's summit faction (`Faction` `draconic_host`, tagline "The god's own."): the jade dragon Kairen's chosen,
at bands 3–4 on mountain and highlands (the mist ridges, the crown and the terraces' shoulders), in Jadeveil only
(`worlds: ['jadeveil']`). No chaff, as the Legion has none: its chaff slot falls to the front line, so the two
shapes that call for chaff (Raid at band 3, Storm at band 4) never field it, and the Karasu-Tengu, its one
shooter, is met at band 3 only (the Skirmish Line) — `draconicHostFaction.test.ts` pins that. Its combat rules are
[the Draconic Host](combat.md#the-draconic-host-two-warned-elites).


### The Fallen Order

Jadeveil's monks walk its shrine ground and mist ridges: **bands 1–3, Highlands and Mountain**,
`worlds: ['jadeveil']`, so they never roll in the Empire. Their Novice is fielded only in the band-2
Ambush (`Faction.chaffShapes`), so a band-1 Patrol is two monks and band 3's Raid is not offered to
them. Kits and elites: [combat](combat.md), *The Fallen Order*; models:
the verdicts.

## The archipelago

The third world (`ARCHIPELAGO_WORLD` in `data/worlds.ts`; the design is the
worlds plan's *The shattered archipelago*): a 56×30 map of six
islands in a sea, **1,680 hexes, about a quarter of them land**. Generated and drawn only: no
factions roll on it, the sea is not sailed, the ship does not move and no raid comes. Only a
development build crosses to it (`WorldDef.devCrossing`): the Empire's gate offers it through the same
`crossWorldGate`, so it takes a band, and its camp (`POIType.IsleCamp`) is the door home until the
harbour replaces both in Archipelago 1. The Save Creator's *Archipelago start* stage, development-only
as well, sets a party down by its camp to walk it.

- **Laid out, not cut from a field** (`systems/world/isleTerrain.ts`, `WorldDef.terrain: 'isles'`,
  which `generateMap` hands over from the first tile; none of the Empire's passes — roads, zones,
  the shuffled pool, wells — fits islands). The camp's island stands up and to the right of the home
  anchor (column 2, row 24) and Varr's up and to the left of the far one (column 52, row 9), so each
  anchor is on its island's south coast with open sea in front of it; the middle four stand at
  `ISLE_STATIONS` along the line between, alternating `ISLE_ZIGZAG` (5.5 hexes) to either side, so
  each channel runs across the chain. Each island is a disc of `ISLE_RADIUS` whose coast a noise
  field pushes `ISLE_COAST` in or out; land of two islands is never within `ISLE_CHANNEL` (2) hexes,
  and land cut off from its island's middle is sea. Nothing is drawn from the generator's stream:
  the fields are offset by the seed's phase and every choice is a hash of the seed.
- **Its grounds**: beach on the coast (desert, `MapTile.isle: 'beach'`), jungle inland (forest,
  `'jungle'`) and down to the water where a field runs high, and a few rock hexes where the rock
  field peaks two hexes from the sea (highlands, `'rock'`; 6–11% of the land on six seeds), Varr's
  crag and the grotto's included. A fight on a hex carries its ground (`worldStep.worldContext`), so
  it is fought in that ground's arena, `isle_beach`, `isle_jungle` or `isle_rock`. The sea is water,
  `MapTile.sea` saying `shallows` beside a coast and `deep` beyond. Every
  height is its type's, so the climb rules are the Empire's: an island is walked end to end, and the
  sea walls it (`MapTile.island` names which).
- **Its bands are the islands'**: `ISLE_BANDS` 0, 1, 2, 2, 3, 4 from the camp's island to Varr's
  (the plan's "threat bands follow island distance from the camp"), named Landfall, Outer Shoals,
  Pirate Waters, Siren Reaches and Varr’s Waters. A sea hex takes the band of the island it lies
  nearest, so a seam runs down the middle of a channel, drawn on the water (`ThreatBorders`'
  `ownBands`). Every hex is corridor: no road and no haunted ground.
- **Its places**: the camp (`POIType.IsleCamp`) and the ship at its berth on the sea hex south-west
  of it (`MapTile.berth`); Varr's stronghold (`POIType.Stronghold`) on rock over the sea, seen from
  the first turn; on the four middle islands two pirate forts (`PirateFort`) and two ports
  (`IslePort`), the seed choosing which; the Sunken Hull's door (`BossTile`, `lair_hull`) on a beach
  of a band-2 island and the Flooded Grotto's (`lair_grotto`) on rock by the sea of the band-3 one;
  and the storm (`MapTile.storm`) over one of the three middle channels, on open sea two hexes off
  the coast of the island south of it, as near the channel's middle as that allows, so it is seen
  across the water from that shore. A place takes a coast hex with the sea on the camera's side where its island has one,
  at least three hexes from every other place, facing the island before it. Their lairs, forts and
  ports are still to come, so arriving at one does nothing yet.
- **What stays stubbed**: `catchUpWorld` rolls no warbands for a world whose `content.encounters` is
  false, and finds (haunted ground only) and merchants (roads only) find nowhere to deal, so the map
  is quiet; `factionLock.test.ts` walks only the worlds that fight. The forge counts patterns left
  to find only in those worlds too (`forge.patternsToFind`), so the archipelago's collections stay
  out of it. Until the archipelago has its own, it plays the Empire's music
  (`soundtrack.musicWorldOf`) and a defeat there would carry the party to the city (`homeLocation`).

**How it looks** (see *How ground looks* and *What stands on a world hex*):

- Its grounds are `ISLE_DISPLAY`'s `beach`, `jungle` and `rock` rows, keyed `isle_<ground>`, solved
  1:1 to the beach, jungle and rock arenas' boards as the map lights them (the table under *How
  ground looks*); those arenas draw their own authored floors (`groundPatches.ts`), so solving the
  rows moved only the map. The jungle's top stands light of its board's because its canopy shades the
  hex. Damp sand under the beach, dark loam under the jungle, dark basalt under the rock. The rock
  was the Empire's olive highlands, ground, wall and hills, until the islands' rock arena
  (2026-11-03): it is its own grey basalt now, its hills built round its top as the Empire's strata
  are round theirs (`worldLandforms`' `ISLE_ROCK_STRATA`), a grain of its own (`headland`), and the
  highlands' relief kept. Its top is a little blue as albedo for the snowfield's reason: under the
  map's warm light it renders the arena board's neutral grey.
- The sea is the shore layer's (`worldShores.WATER_COLOURS`): turquoise `shallows` and deep blue
  `sea`, blended across their shared vertices, at water's height below every island's slab, the
  open sea with one or two low white crests a hex. The sky is the Empire's haze a little bluer.
- Scenery (`worldScenery.ts`, kit in `strategic.ts`): the jungle is a wood by the mass rule, in
  jungle trees, palms and flowering bushes; a beach carries palms leaning out to sea where their
  field runs high, beach grass and driftwood; rock carries basalt. No piece is an Empire or a
  Jadeveil one (`archipelagoMap.test.ts`).
- Its places stand as their board models (`voxel/models/archipelagoProps.ts`, by
  `terrainDisplay.propKeysFor`), the ship turned three-quarters to the camera so its hull and its
  sails both read. Varr's fortress and the grotto bring their own land up out of the sea
  (`terrainDisplay.seaStanding`): their hexes are drawn at the water's level, under the shore
  layer's water, so the model's cliff is the coast. Render-only, like every lift.

**For review**: recipes with `world: 'archipelago'` and the `isle-*` foci (`worldReview.ts`):
`isle-camp`, `-berth`, `-stronghold`, `-fort`, `-port`, `-hull`, `-grotto`, `-storm`, `-beach`,
`-jungle`, `-rock`, and `-chain`, the middle of the chain, for the map at the pinch-out limit.
`archipelagoMap.test.ts` pins the map on eight seeds: six islands of one piece each, the channels,
camp and stronghold at opposite edges, every place on land of its island, the ship and the storm on
the sea, the bands, the quiet clock, deterministic per seed; and that every land hex wears its own
ground, the rock its own basalt, grain and hills, and fights in that ground's arena.

## Wrath, weather and the monastery

Jadeveil's live difficulty dial and its small party-wide progression. Rules are in
`systems/world/wrath.ts` and `monastery.ts`, data in `data/monastery.ts`, numbers in
`BALANCE.WRATH_*`. Evidence: Jadeveil wrath and monastery.

- **Wrath is a stamp read off the clock.** `ascentStore` holds the bar's value at an hour, the
  permanent floor and the end of any summit window; `liveWrath(state, now)` is the reading. Nothing
  ticks it, so a reload, a crossing or a rest cannot make it drift, and the save holds the stamp
  (`SaveData.ascent`, save 59). It is global like the clock: it keeps falling while the party is in
  the Empire, which is what makes a trip to the city a lull.
- **Gains are deliberate Jadeveil work only:** a quest handed in (+15) or a lair cleared (+22) while
  the party is in Jadeveil (`ascent.provokeJadeveil`, called from the quest hand-in and the
  lair-clear check in `encounterResolution`). Wandering fights never provoke it. Jadeveil's quests are handed in
  at the foothill camp and its two lairs are the Silk Hollow and the Silent Hall;
  the visual harness's `wrath(value, open, vows)` sets it for review.
- **Decay** is 0.15 an hour (3.6 a day) on the shared clock, never below the floor. **Floors**
  ratchet at 25, 50 and 75% and never fall back.
- **A full bar opens the summit for `WRATH_WINDOW_HOURS` (48).** The bar holds at full and the
  weather calms, then it decays toward 75%. A gain while it is open is not banked. Filling it again
  opens it again, so the route is repeatable. The window outlasts the whole walk up from the camp.
- **Enemy strength:** every Jadeveil ground fight is built at `1 + 0.25 × wrath` on top of its band
  (`encounterPowerScale`'s `wrathPower`; castle, siege and harness fights price themselves, and so
  does Kairen: he is only fought at a full bar, so his tier alone prices him — the vows still bless
  the party). A
  quarter at a full bar is a little under one band's step (0.28).
- **Weather follows the floors** (`wrathWeather`): clear below 25%, clouds, rain and storm from each
  floor, and calm while the summit is open. On the map each weather is three things:
  - a `worldSky` row: the haze, and the haze share at the frame's top edge, rising from 0.2 clear to
    0.38 in a storm and held under `MAX_HAZE_SHARE` 0.4, so the far ground keeps most of its colour
    and no haze reads as the deep mist;
  - a `WEATHER_LIGHT` entry that dims and cools the key light by name (to 42% in a storm, a warm
    108% in the calm), while the flat terms keep the shaded side's floor and every lantern its glow;
  - an `Atmosphere` drift that follows the ground under the camera (`follow`): wisps of cloud, rain
    and storm streaks leaning with the wind, slow gold motes in the calm. One or two draw calls,
    thinned by reduce-effects.

  A fight carries the weather it began under in its `EncounterContext`, so the arena wears the same
  air, haze and light, and a resumed fight keeps them.
- **The gauge** under the calendar (Jadeveil only) shows the reading, the bar with the floor reached
  shaded and the three floors notched, and the weather (or the summit's remaining window) under it.
  A tap opens the wrath panel, which shows live numbers only: the reading, enemy strength under the
  vows, the floor it holds at (or the summit's remaining window), the vows in force, and a "Wrath and
  vows ›" link to the Handbook's Jadeveil page, which says what raises and lowers it (PT-13). A floor reached or the summit opening is told once on the map,
  including on the way back out of the fight or lair where it happened (`ascentStore.news`).

**The monastery** offers four rings of two blessings for the whole party, in force only in Jadeveil:

| ring | opens | choices |
|---|---|---|
| Vow of the Gate | on arrival | Stone Bell (+10% Physical and Magic Defense) · Mountain Stride (+1 Movement) |
| Vow of Rain | 25% floor | Rain-Walker (wrath's extra strength halved) · Cedar Heart (+10% Max HP) |
| Vow of Wind | 50% floor | Wind Step (+10% Speed) · Lantern Vigil (dawn mends 15% more HP) |
| Vow of the Crown | 75% floor | Crane Poise (+6% Dodge) · Eye of the Storm (+6% Critical Chance) |

- One selection per ring, held by the party (`ascentStore.vows`) and never written on a hero. The
  vows bless the player units when a Jadeveil fight is built (`blessUnit`) and add to the dawn there,
  so a late recruit fights under them like the founder, and they vanish on crossing home and return
  on re-entry with nothing to strip. Max HP rises with current HP, and the fight's end writes HP back
  through `setHp`, which holds it to the hero's own maximum.
- The first vow is offered on arrival, before a step is taken. Every ring is at the camp's
  **Monastery** tab, which opens first while a ring waits. A first vow is free; changing a taken one
  costs a day of prayer on the clock (`MONASTERY_REVOW_HOURS` 24), the same at every ring. The bench
  lists each ring's choices with their lines and ends with a "Vows ›" Handbook link; who a vow holds
  for is on the Jadeveil page, not repeated under the rings.
- The whole set stays under what five hero levels add, for every class (`monastery.test.ts`). The
  blessings' numbers are a first pass; verify in playtest.

**Measured on real routes** (`systems/sim/wrathRoutes.ts`, pinned by `wrathRoutes.test.ts`). Quests
and lairs stand in where they will be placed: haunted ground in each band, quests at a third, two
thirds and the far end of a band's walking hours from the camp, lairs at the remote end of bands
2–4. Each is walked at the game's own hours, and again with every pass refused (the detour while a
shrine above has not opened it). A city trip is both crossings, the Empire's road from its gate to
the city and back, and a night there. Eight seeds (1, 7, 42, 99, 2026, 31337, 5, 123):

| measure | range |
|---|---|
| camp → summit, passes refused | 31.5–34.5 h |
| city trip | 69–84 h; takes 10.4–12.6 off a bar above its floor |
| most remote lair, there and back, passes refused | nets +9.8 to +10.9 of its 22 |
| one sortie at a time from the camp, with a rest | every objective nets wrath; 10–11 of the 12 fill the bar |
| a push from one objective straight to the next | 6–7 objectives (38–102 h) |

So a distant objective pays for its walk, sorties alone climb the floors but fill the bar only with
nearly all the range's work, a deliberate push fills it, and a week away (25.2) costs a floor's
width. Re-measure when the shrine campaign places the real quests and lairs.

## Exploration finds

Resource nodes are gone. Wood, stone, iron, crystal and gold lie on the open map as **finds**, dealt
fresh every week by `systems/world/finds.ts`, and chests with guards stand among them. A find is not a
`poi` and is never stored on a tile: it is a record on `worldMapStore.finds` (hex key → `MapFind`).

- **A deal is a pure function of `(map seed, week number)`.** `rollWeeklyFinds` draws from a stream
  seeded by both, so a fixed seed and week always deal the same ground and the next week deals different
  ground. `setTiles(tiles, seed)` deals week 1; `moveParty` deals again whenever the clock crosses a week
  boundary, so a find nobody collected is simply not there next week. Claiming one deletes it from the
  record, which is why the save keeps the record (`worldMap.finds`, save version 34) rather than
  re-dealing from the seed on load.
- **Where they lie.** Reachable haunted ground, off water and peaks, at least
  `EXPLORATION_FINDS.MIN_CITY_DISTANCE` from the city, on a hex with no destination, one find per hex.
  Caches, purses and chests all spawn only on haunted hexes. The daily encounter roll skips a hex that holds a
  find, so the party never wins a fight standing on a prize it could only claim by stepping off and on.
- **How many.** Stated against the old node density, `POI_PER_1000_TILES.resource`: three resource
  caches per old node, one gold purse per old node, and `CHESTS_PER_1000_TILES` guarded chests (four on
  a 70×70 map before the density reduction). Every count is multiplied by `DENSITY_MULT` (0.75),
  reducing the old total by 25%. One cache is placed within `STARTER_FIND_RADIUS` (14)
  when eligible haunted ground is available. A cache pays a fraction of what a node did (`RESOURCE_AMOUNTS`); a purse is
  `GOLD_AMOUNT` times `threatRewardScale` for its ground, so harder ground pays more.
- **What they are made of.** Terrain weights the resource, not a quota: Crystal in the frozen north,
  stone and iron on high ground, wood where trees are.
- **Arrival.** A cache pays on arrival, with the active meal's loot bonus, and shows the amount in the
  existing reward dialog (`Gold Found` or `Resources Found`); collect objectives hear of it. A chest asks
  first (`ChestChallengeDialog`): challenge the guards or walk away, and the chest stays until the week
  turns.
- **Chest guards are stronger than the ground expects, three ways.** They are built and paid one band
  above the ground (`chestGuardBand`, capped at band 4), at `CHEST_GUARD_POWER_MULT` (×0.97: ×1.2 cut
  10% to ×1.08 after the 2026-10-08 playtest and another 10% after 2026-10-09) of that band's
  power, and carry two reinforcement waves from their own faction (`chest_reserve`, `chest_captain` in
  `encounterWaves.ts`). With the multiplier under 1 the whole fight carries the rule: bodies (waves
  included) times power stays more than 1.2× a wandering fight's on the same ground at every band
  (`finds.test.ts`), though at band 4, where the bump is capped, each guard is 3% weaker than a wanderer.
- **Who guards a chest is drawn from a wider pool than a warband** (`chestGuardCandidates`,
  `composeChestGuard`): the factions of the ground's band and of the guards' band together, a native
  at `CHEST_GUARD_HOME_WEIGHT` entries against an outsider's one (1 since the biome lock, see
  *The biome lock*; it was 2). Drawing at the guards' band
  alone made the Thunder Herd's centaurs most chests' guards: chests lie on plains and highlands more
  than anything else, and from band 3 up the Herd is the only native of either, so it held 3 of 8
  entries on band-3 plains and 3 of 5 on band-4. Measured over twelve seeds and six weeks of chests,
  the Herd fell from 21% of guards overall and 39% on plains and highlands to 14% and 21%; no faction
  now holds more than 15% overall. With the lock no pool on any terrain from band 1 to 4 has fewer
  than two factions or one over half (`finds.test.ts`; the late forest and swamp only have the Dead and
  the Coven). The roll is not seeded: it is `Math.random` when the
  fight opens, kept on the save's encounter entry once it has. The second wave is an elite only where the ground already fields one: the first
  elite waits until band 2, and a home-ring chest brings a rank of the front line instead. Winning pays
  the fight (every body, reinforcements included, at the guards' band), the chest's gold and ore
  (`RewardContext.treasure`, `CHEST_GOLD_AMOUNT` times `threatRewardScale` for the ground) and one extra
  item drop levelled by the ground. Its tier is rolled on `CHEST_RARITY_ODDS` for the guards' band
  (`rollChestGuardItem`), not the flat drop weights: Rare 30–40%, Epic 6% at band 0 rising to 28% at
  band 4, and **Legendary only from band-4 guards, at 20%** (playtest 2026-10-14; it was 1% rising
  to 7% everywhere). Meal luck still shifts the die but never onto a zero, so it cannot make a
  Legendary below band 4. Losing leaves the chest where it lies.
- **Measured review** (`findsTuning.test.ts`, twelve seeds over six weeks, report at
  private captures). A 4,900-tile map now deals 78 finds: 56 resource
  caches, 19 purses and 3 chests, down from 104. The checks retain the near-home discovery,
  uncrowded placement, purse value and guard-fight reward rules.
- **Marks.** `FindIndicators` draws only explored haunted finds: stacked logs with cut ends
  for wood, a rock pile for stone, metal ingots for iron, a crystal cluster for crystal,
  the existing standing gold coin, and a wood chest with golden bands and a lock. Shared
  geometry, materials and one animation clock keep the vocabulary inexpensive. Collect
  objectives guide toward the nearest seen find of their resource.

Unexplored ground lies under the exploration mist (see *How ground looks*, below) and has no
visible findings or destinations. Existing exploration rules continue to reject clicks on those
hexes. Lair landmarks (`BossTile`) are permanent map props:
entering, leaving, losing and completing a lair never remove its door icon.

## Villages

The Empire's main map has four villages, one per theme: Lookout and Trading post held by brigands,
Smithy and Shrine held by the Obsidian Legion. Each starts held, is freed by an authored garrison
fight, stays free for the run, and then sells a weekly buff and a small weekly rack. Design and
the playtest checklist: villages plan. Travelling merchants
are the next section. Out of scope, parked: other worlds, villages being retaken, the Herbalist and
Hunters themes, hostile merchants or villages, walk-in villages.

- **Placement** is `placeVillages` in `mapGenerator.ts`, behind `WorldDef.content.villages` (the
  Empire only). It runs last, like the gate, and draws nothing from the generator's stream, so no
  other tile, POI or find moves for a seed. A hash of the seed and tile picks among near-equal
  spots. Each village takes a free, level, reachable tile 1–2 hexes from a road and at least 6
  from another village, nearest its ring's share of the home-to-castle distance (near 0.2–0.32,
  far 0.5–0.66; the far ring leans toward the castle). `villages.test.ts` pins this on five
  seeds. Numbers live in `BALANCE.VILLAGE_*`, all first guesses: **verify in playtest**.
- **State** is the tile's `defeated` mark: occupied by default, free once `freeVillage` sets it.
  World snapshots already save that mark, so a freed village survives saves and travel between
  worlds. A village tile holds no encounter or find (every POI tile is skipped by both).
- **Garrison** (`systems/world/villageGarrison.ts`): walking onto a held village opens a confirm
  dialog stating who holds it and the strength (the band's expected summed party level); nothing is
  locked and the fight cannot be fled. It is fought in the village's own arena, `village_<theme>`
  (playtest 2026-10-28; see arena internals). It is the encounter `village_<theme>_<band>`, composed by
  `planEncounter` from the occupier (brigands, or the Obsidian Legion) at the band
  `garrisonBand` gives the village's own tile threat (brigands held to 0-2, the Legion to 2-4), with
  a seeded roll so it is the same fight each visit, and curated (`curatedBand`) so its power does
  not follow the ground. Numbers: `BALANCE.VILLAGE_GARRISON`; measurements and their caveat are in
  the plan's section 2.2a.
- **Liberation**: `applyVictory` frees the village (`freeVillage`), pays `liberationGold` and calls
  the buff hook for a week (`setVillageBuffGrant`, which defaults to the village store's `grantBuff`). A loss leaves it held. The journal lists one note per village in the quest log's Active
  tab ("Free X from the brigands", garrison strength and payout) and the done form in its Done tab
  (`villageNotes`); these are derived from the map, not `QuestStore` quests, because the quest
  system is built around an NPC giver and a claim. **A held village is listed only once the party's
  summed hero level meets its stated garrison strength** (`meetsGarrison`, playtest 2026-10-29); a
  freed one is always listed. Each held note has **Track on map** (`toggleVillageOnMap`): the quest
  store follows it as `trackedVillage` in the tracked quest's place (one or the other, never both;
  saved as `quests.trackedVillage`, `SAVE_VERSION` 80), the HUD strip shows its note, the quest guide
  points at its tile (`trackedQuestTarget` → `heldVillageCoord`), and winning its garrison drops it.
- **Counter panel** (`components/worldmap/VillageCounter.tsx`): stepping onto a freed village opens
  it in the shared `Modal`, in the manner of the Jadeveil camp's counter. The **Buff** tab shows this
  week's buff, its price in materials and effect, the buff held (and what buying replaces) and
  "Next week: …". The **Shop** tab is the village's rack (`systems/economy/villageShop.ts`): Smithy
  rare and epic weapons and armor, Shrine rare and epic trinkets (neck, ring) and magic gear,
  Trading post the Shop's own tiers plus two weekly material swaps (give 3, take 2), and the
  Lookout's ward, ration and map scroll (the scroll reveals eight hexes round the party). Racks are
  seeded by week and village like `shopStock`. `scripts/village-shots.mjs` photographs it.
- **Buffs** (`systems/economy/villageBuffs.ts`, held in `stores/villageStore.ts`, saved as
  `worldMap.villageBuff`): each village has two, offers one a week strictly alternating by week
  number from its own `VILLAGE_CYCLE_OFFSET`, and the party holds one at a time as
  `{ village, buff, untilHour }` (168 hours from purchase, read off the clock, never ticked). Buying
  pays materials (`BALANCE.VILLAGE_BUFF_PRICE`, crystal for the strongest) and replaces any held
  buff; freeing a village grants its current buff free through `grantBuff`. It stacks with the meal
  and the ward, which are separate state. The held buff and its time left show on the calendar plate,
and tapping the plate lists it with its exact effect (`InForceDialog`, playtest 2026-10-30).
  **What a buff does** is one pure module, `systems/economy/villageBuffEffects.ts`: every effect
  below is a function of the running buff's id alone (`villageBuffUnit`, `discounted`,
  `goldMultiplier`, `fleesWarbands`, `seesDanger`, and `effectPercent` for the number its sentence
  quotes). The held buff is read against the clock in one place, at the foot of
  `stores/villageStore.ts`: `villageBuffIdNow()` for an event's moment (a fight being built, a find
  paid) and `useVillageBuffId()` for a screen that redraws as the buff ends. Every buff is sold:
  each has an effect. Tests: `villageBuffEffects.test.ts`.
  - **Smithy**: armor (+15% defense and magic defense), or +12% attack or magic, whichever is higher
    for that hero (`villageBuffUnit`, applied when the fight is built, like the monastery's vows).
  - **Shrine**: a Barrier of 10% of max health on every hero at the start of each fight, or +8 crit.
  - **Trading post**: 25% off item purchases (the city Shop's gear, village racks and the Lookout's
    goods) and Market materials bought, or +25% gold from fights and finds. Never Market sell rates,
    the Forge, tribute, the Tavern or gems. The discounted Market buy price is held above the sell
    price so buying and selling cannot loop. Merchants will read the same discount when they land.
  - **Lookout, Escape** (`fleesWarbands`; `systems/world/escape.ts` for the chance,
    `systems/world/worldStep.ts` for the offer and the outcome): while held, a wandering warband
    that stops the walk opens a dialog, Fight or Flee (xx%). The chance is `VILLAGE_ESCAPE.base`
    (0.6) times the party's summed level over what the warband's band expects
    (`expectedSummedLevel`, the measure `encounterTimidity` uses), kept between 20% and 90%. Success leaves the party on the hex it
    came from (the step's hour is spent), takes that one warband off the roll
    (`removeActiveEncounter`, which spares its neighbours) and gives no XP. Failure starts the
    fight with `enemiesFirst`, which opens the turn order on the fastest enemy (`initCombat`).
    Only `WARBAND_ENCOUNTER_ID` can be fled (`canFlee`): never a lair, boss, quest fight, guarded
    chest or village garrison. Closing the dialog fights, which is what happens without the buff.
  - **Lookout, Danger sight** (`seesDanger`; `systems/world/dangerSight.ts`, drawn by
    `DangerSight.tsx`): while held, the day's live encounters (`activeEncounterTiles`) within 4
    hexes of the party and on revealed ground glow red. It moves with the party and refreshes with
    each dawn's re-roll because it only reads the set. A route armed across a red hex draws that stretch red (the
    route preview's danger colour) and says so once. `scripts/lookout-shots.mjs` photographs it.
  Every number is in `BALANCE.VILLAGE_BUFF_*`, `VILLAGE_SHOP_*` and `VILLAGE_SWAP` and is a first
  guess: **verify in playtest**.
- **Arrival at a free village** opens the counter.
- **Look**: `voxel/models/villages.ts` builds `poi_village_<theme>` (occupied: palisade, the
  occupier's banners, unlit) and `poi_village_<theme>_free` (bunting, lit). `propPlacement` swaps
  in the free twin when the tile is `defeated`. Captures were taken with
  `npm run shot -- prop:poi_village_<theme>[_free]`.

## Travelling merchants

One or two merchants a week walk the Empire's roads, selling a narrow slice of one shared pool and
buying loot at a poor rate. Design: villages plan, section 3.
Every number is in `BALANCE.MERCHANT` and is a first guess: **verify in playtest**.

- **The deal** (`systems/world/merchants.ts`, `dealMerchants`): at every new week (and with the map)
  1-2 merchants of distinct kinds are dealt onto road tiles the party has already revealed, never a
  tile carrying a place (so never a village or home). Dealt by the world catch-up (`catchUpWorld`,
  below) with the map, when a step turns the week, and for a world the party returns to after one has
  turned; every path deals after the party's reveal, so a step's or an arrival's newly seen road can
  carry one. The deal is saved in each world snapshot (`merchants`, `SAVE_VERSION` 78).
- **The walk** is derived, not stored: a merchant is where it was dealt and when, and its position
  at any hour is a replay of its walk (`merchantAt`), one road hex every 6 hours, each choice a draw
  from a stream seeded by the world seed, week and merchant, so it is deterministic, costs no write
  per hour and needs no catch-up. At a fork it never goes back the way it came; a hex nearer a
  village or home weighs `1 + leanWeight` against 1; at a dead end it turns back. It leaves 96 hours
  after the deal. A merchant is drawn only on revealed ground.
- **Meeting**: after every step of a walk the world step (`stepMeeting`, above) asks whether a
  merchant is on the party's hex at the new hour (`merchantMet`, through `merchantsNow`, which reads
  the targets off the world). If so the walk stops there, at the hex reached, and the cart opens,
  whether the party stepped onto it or it walked onto the party (`meetAlongRoute` is the same rule
  over a whole route, for the tests). A warband on the same hex comes first. A walk that ends
  elsewhere is unaffected.
- **Stock** (`systems/economy/merchantStock.ts`): the **armourer** racks three epic weapons and armor
  pieces; the **curio dealer** gear from other worlds (Jadeveil's, when the expansion is held; the
  Empire's rare and epic trinkets otherwise); the **provisioner** a ward and a ration bundle, each a
  share cheaper than the city's. A cart is seeded by merchant, so it is the same every time it is
  opened. Prices are the Shop's, with the Trading post's discount when held.
- **Loot**: the cart's Sell tab is the Shop's sell bench at `buyRate` (half) of each piece's sell
  price. Merchants pay nothing for free.
- **Look**: `voxel/models/merchants.ts`, a figure with a cart (armourer), a mule (curio dealer) or a
  barrow (provisioner), drawn through `propPlacements` where the merchant stands now.
  `scripts/merchant-shots.mjs` photographs the map and the carts.

### Every tuned number

Every number below is a first guess recorded as **verify in playtest**; the playtest checklist is in
the plan (section 7). All live in `src/data/balanceConstants.ts`.

| Rule | Constant | Value |
| --- | --- | --- |
| Village distance off a road | `VILLAGE_ROAD_OFFSET` | 1-2 hexes |
| Share of the home-to-castle distance | `VILLAGE_ROUTE_SHARE` | near 0.2-0.32, far 0.5-0.66 |
| Spacing between villages; lean step | `VILLAGE_MIN_SPACING`, `VILLAGE_LEAN_STEP` | 6 hexes; 4 hexes |
| Garrison band, bonus, extra bodies | `VILLAGE_GARRISON` | brigands bands 0-2, +1 body; Legion bands 2-4, no bonus |
| Liberation gold | `VILLAGE_LIBERATION_GOLD` | brigands 150, Legion 400 |
| Free buff on liberation; bought buff length | `VILLAGE_LIBERATION_BUFF_HOURS`, `VILLAGE_BUFF_HOURS` | 168 hours each |
| Buff effects | `VILLAGE_BUFF_EFFECT` | armor +15%; attack or magic +12%; Barrier 10% of max HP; crit +8; discount 25%; gold +25% |
| Buff prices (materials) | `VILLAGE_BUFF_PRICE` | e.g. Smithy armor 8 iron 6 stone; Smithy power 10 iron 2 crystal; Shrine 8 stone 1 crystal or 6 stone 2 crystal |
| Rack sizes | `VILLAGE_SHOP_SLOTS` | Smithy 4, Shrine 4, Trading post 3 |
| Lookout scroll gold and radius | `VILLAGE_MAP_SCROLL_GOLD`, `VILLAGE_MAP_SCROLL_RADIUS` | 60 gold; 8 hexes |
| Trading post swaps | `VILLAGE_SWAP` | give 3, get 2, two a week |
| Escape chance | `VILLAGE_ESCAPE` | 0.6 x level over band expectation, 20-90% |
| Danger sight radius | `VILLAGE_DANGER_SIGHT_RADIUS` | 4 hexes |
| Merchants | `MERCHANT` | 1-2 a week, 6 hours a hex, 96 hours' stay, fork lean +2, buy rate 0.5, 3 slots, ward 80%, bundle of 3 rations at 80% |

The village and merchant text lives in the `villages` and `merchants` catalogs, in English and
Polish. The Trading post's discount touches the city Shop's gear, village racks, merchant carts, the
Lookout's goods and Market materials bought (never Market sell rates, the Forge, tribute, the Tavern
or gems), and is held above the Market's sell price so buying and selling cannot loop.

## Named quest destinations

`quests/sites.ts` authors ten named destinations using the existing `MapTile.questId`. Three
carry fixed opposition (Snare Thicket at band 0, Greywater at band 1, Frozen Camp at band 2); four
are peaceful investigations. The original three `quest_N` fights retain their band-2 composition.
Map generation places named sites after other POIs, without drawing from their RNG stream, on
unoccupied haunted terrain in the city's real movement component. The early sites sit near their
relevant wayside; northern sites sit on Tundra. Ordinary interception skips all POIs, including
peaceful clues. When the tuning harness disables the north entirely, northern sites are omitted.
Tracking matches the exact identity, and clues/defeated sites remain valid for late acceptance.
**Every site stands on its fixed hex all campaign** (playtest 2026-10-30, reversing PT-17 of
2026-10-09, which hid a site until its quest: a building that appeared and vanished read as
illogical). A site opens once a quest that sends the party there is active or completed
(`systems/quests/questSiteAccess.ts`): a named site belongs to the quests whose objectives name
it, an unnamed `quest_N` waypoint to the generic waypoint objective (the Roadwardens). Until then
`propPlacements` draws it dark (`dormantSites` → `<site>_spent`), arriving on it does nothing, and
the guide arrow never points at it. Open, it is lit; cleared (`tile.defeated`), it is dark again and
stays, as a cleared lair's door does. The hex keeps its POI, so it carries no scenery and holds no
encounter. Placement never changed: generation puts every site on the same hexes for a seed.


Every victory ends travel. The party remains on the encounter hex and needs a fresh map tap
to continue, including after shrine encounters. Each step checks current encounters and charges
only its own hours. A pending weekly decision also stops a route at the actual walked hex.

For unfinished kill objectives, eligible wandering fights use 5× faction weight. After two
eligible victories without hunt progress, the third eligible fight fields a legal unfinished
target. `huntQuarry` orders the objectives it serves: one naming a unit (the brigand captain)
before a faction-wide `group` objective (six of any brigand), the tracked quest first within each,
so a stage asking for both guarantees the named unit wherever its role can stand and falls back to
the group where it cannot. Eligibility uses terrain, threat and actual shape-role
supply; authored fights and impossible targets do not consume the streak. A hunt kill resets it;
changed hunt contexts start a new streak. Defeats do not count. Saves retain both streak and plan.
