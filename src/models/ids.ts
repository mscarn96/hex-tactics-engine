// ============ STRICT ID TYPES ============

export type HeroTemplateId = "warrior" | "mage" | "healer" | "ranger" | "monk";

export type EnemyTemplateId =
  // ── Greenskins ────────────────────────────────────────────────────────────
  | "goblin_whelp"
  | "goblin"
  | "goblin_spearthrower"
  | "goblin_shaman"
  | "orc_grunt"
  | "orc_berserker"
  | "orc_warchief"
  | "troll_chieftain"
  // ── The Restless Dead ─────────────────────────────────────────────────────
  | "skeleton_archer"
  | "skeleton_warrior"
  | "skeleton_mage"
  | "ghost"
  | "revenant"
  | "dark_mage"
  // ── Beasts ────────────────────────────────────────────────────────────────
  | "wolf_pup"
  | "wolf"
  | "dire_wolf"
  | "giant_spider"
  | "cave_bear"
  | "dragon"
  // ── Brigands ──────────────────────────────────────────────────────────────
  | "footpad"
  | "bandit"
  | "brigand_archer"
  | "brigand_captain"
  // ── The Ashwood Coven ─────────────────────────────────────────────────────
  | "coven_thrall"
  | "hexer"
  | "coven_matriarch"
  | "ashwood_crone"
  | "briar_shrike"
  // ── The Fenfolk ───────────────────────────────────────────────────────────
  | "fen_spawn"
  | "mire_wader"
  | "reed_stalker"
  | "silt_speaker"
  | "bog_hulk"
  // ── The Delve ─────────────────────────────────────────────────────────────
  | "delve_pickhand"
  | "delve_breaker"
  | "delve_slinger"
  | "delve_alchemist"
  | "delve_overseer"
  // ── The Obsidian Legion ───────────────────────────────────────────────────
  | "obsidian_infantry"
  | "blood_iron_arcanist"
  | "blood_thirster_stalker"
  | "runeguard_sentinel"
  | "dread_knight"
  | "aethelred"
  // ── The Sandscourge ───────────────────────────────────────────────────────
  | "sand_mite"
  | "scorpid_brute"
  | "glass_spitter"
  | "dune_caller"
  | "burrowmother"
  // ── The Thunder Herd ──────────────────────────────────────────────────────
  | "colt_runner"
  | "herd_lancer"
  | "steppe_archer"
  | "storm_drummer"
  | "herd_khan"
  // ── The Rime Jarls ────────────────────────────────────────────────────────
  | "hold_thrall"
  | "rime_giantling"
  | "glacier_hurler"
  | "rime_skald"
  | "rime_jarl"
  // ── The Hoarfrost ─────────────────────────────────────────────────────────
  | "frost_mote"
  | "frost_sentinel"
  | "shardcaster"
  | "hoarfrost_wraith"
  | "glacier_colossus"
  | "heart_of_winter"
  // The Draconic Host, Jadeveil's summit approach (factions.ts)
  | "oni_brute"
  | "wyrmling"
  | "karasu_tengu"
  | "raiju"
  | "oni_warlord"
  | "daitengu"
  // ── The Fallen Order (Jadeveil) ───────────────────────────────────────────
  | "order_novice"
  | "beetle_warden"
  | "mantis_adept"
  | "chain_sickle_monk"
  | "firefly_chanter"
  | "fallen_abbot"
  | "bell_keeper"
  // Jadeveil: Silent Hall / Fallen Order — the lair boss
  | "last_lesson"
  // ── The Yokai of the low forest (Jadeveil) ────────────────────────────────
  | "kodama"
  | "kappa"
  | "tanuki"
  | "onibi"
  | "kitsune"
  | "jorogumo"
  // Jadeveil: Silk Hollow / Yokai — the roaming elite since the shrine campaign
  | "nue"
  // Jadeveil: Kairen, the Cloud-Crowned Dragon — the summit's boss
  | "kairen";

/**
 * Creatures that only ever enter combat by being summoned.
 *
 * Kept separate from `EnemyTemplateId` on purpose: `encounterGenerator` builds
 * encounters by filtering `enemyTemplates` on tier, so anything added there
 * starts appearing as a random encounter and in loot rolls. A summon is neither.
 */
export type SummonTemplateId =
  | "fire_elemental"
  // The Stormcaller's companion: no turn of its own, it echoes its owner's spells
  | "thunder_elemental"
  // The Stoneshaper's capstone is three casts, not one: a rock, a stack, then
  // the elemental. The first two are the same creature part-built, which is
  // why they are stages of one summon rather than three separate summons.
  | "stone_heart_rock"
  | "stone_heart_stack"
  | "stone_elemental"
  // No `rime_tornado`: the Hydromancer's capstone stopped being a summon and
  // became a chill-only area spell, so nothing can call one. The **voxel model**
  // of that name is very much alive — `vfx/effects/Cyclones.tsx` stands several
  // of them up as the spell's effect — and it is keyed off `MODEL_DEFS`, which
  // is a `Record<string, …>` and has never read this union.
  | "treant"
  | "risen_skeleton"
  // Aethelred's reinforcements. Separate ids for the same soldiers you meet on
  // the map, because a summon must never enter the random-encounter pool.
  | "legion_infantry"
  | "legion_knight"
  // Wildshape's Primal Bond, one per shape. Separate ids from the wild animals
  // of the same name for the reason the Legion's are separate: a summon must
  // never enter the random-encounter pool.
  | "bonded_bear"
  | "bonded_wolf"
  | "bonded_hawk"
  // The Firefly's capstone: a stationary lantern with no turn of its own
  | "lantern_beacon"
  // Jadeveil: Kairen's Brood of the Orb — a weakened field Wyrmling whose bite taints
  | "brood_wyrmling";

export type SkillId =
  | "basic_attack"
  | "slash"
  | "arcane_burst"
  | "thorn_lash"
  | "throw_knife"
  | "disengage"
  | "meditate"
  | "whirlwind"
  | "ground_slam"
  | "meteor"
  | "heal"
  | "divine_light"
  | "arrow_shot"
  | "poison_arrow"
  | "rain_of_arrows"
  | "arcane_bolt"
  | "mace_strike"
  | "stone_fist"
  | "holy_bolt"
  | "bite"
  | "ranged_shot"
  | "charge"
  | "dark_bolt"
  | "ghost_touch"
  | "dragon_claw"
  | "troll_smash"
  // Granted by exactly one mastery node each and carried by no template, so
  // both live in `data/skills/mastery/` rather than in the shared pool.
  | "summon_elemental"
  | "flare_dash"
  | "summon_treant"
  | "timber_crush"
  | "rootlash_sweep"
  // The Treant's third skill (Lifewarden remaster, 2026-10)
  | "canopy_guard"
  | "raise_dead"
  | "cleave"
  | "hex"
  | "blight"
  | "web"
  | "venom_bite"
  | "beast_maul"
  | "cutpurse"
  | "rally"
  | "bone_shards"
  | "poisoned_shot"
  | "mire_grasp"
  | "cave_in"
  | "blasting_charge"

  // ── The Obsidian Legion (data/skillData.ts) ──────────────────────────────
  | "legion_advance"
  | "shield_wall"
  | "plasma_orb"
  | "obsidian_spikes"
  | "dread_charge"
  | "rune_dome"
  | "armor_breaker"
  | "melt_away"
  | "serrated_daggers"

  // ── The four frozen-north factions (data/skillData.ts) ───────────────────
  | "glass_shot"
  | "scorpid_sting"
  | "acid_spit"
  | "sand_squall"
  | "double_sting"
  | "hoof_kick"
  | "lance_thrust"
  | "running_lance"
  | "recurve_shot"
  | "parting_shot"
  | "thunderbeat"
  | "rolling_thunder"
  | "glaive_sweep"
  | "spear_jab"
  | "club_strike"
  | "club_sweep"
  | "hurl_ice_block"
  | "rime_note"
  | "shelter_of_the_hold"
  | "winter_horn"
  | "axe_hew"
  | "cold_spark"
  | "ice_fist"
  | "frozen_bulwark"
  | "shard_shot"
  | "icicle_lance"
  | "frost_bolt"
  | "cold_grasp"
  | "snowblind"
  | "glacier_hammer"

  // ── Aethelred, by phase (data/aethelred.ts) ──────────────────────────────
  | "ledger_strike"
  | "obsidian_sweep"
  | "call_the_line"
  | "crimson_verdict"
  | "sundering_spikes"
  | "blood_iron_ward"
  | "interest_due"
  | "total_assessment"
  | "the_legion_answers"
  // The three-phase kit that replaced them; each wears one of the pictures above
  | "emperors_blade"
  | "writ_of_seizure"
  | "imperial_cleave"
  | "imperial_standards"
  | "foreclosure"
  | "chains_of_tribute"
  | "collateral_claim"
  | "crownfall"
  | "the_realm_that_burned"
  // Not on his bar: the throw as each phase turns (the boss feel pass)
  | "overturn"
  // The Troll Chieftain's fixed six-turn cycle
  | "bonebreaker_sweep"
  | "farthest_prey"
  | "boundary_smash"
  | "warren_collapse"
  // The Emerald Dragon: the claw is his repeatable attack, the rest are his signatures
  | "wing_thrust"
  | "flame_wave"
  | "cinder_rift"
  | "furnace_heart"
  | "skyfire"
  | "skyfire_landing"
  // The party's answer to his carried Furnace Heart, put on a hero's bar while a pass is legal
  | "pass_heart"
  // The Heart of Winter (data/templates/heartOfWinter.ts)
  | "splintering_pulse"
  | "splintering_fracture"
  | "creeping_winter"
  | "icebound_reprisal"
  | "whiteout_convergence"
  | "whiteout_blast"
  // The elites' signatures (data/skills/eliteSkills.ts)
  | "pain_feast_slash"
  | "mire_undertow"
  | "mire_pull"
  | "mind_control"
  | "warband_order"
  | "briar_blight"
  | "briar_claim"
  | "witchs_geas"
  | "geas_eruption"
  | "fracturing_breaker"
  | "fracture_slam"
  // The new-faction elites' signatures (data/skills/factionEliteSkills.ts)
  | "undermine"
  | "undermine_eruption"
  | "twin_raid"
  | "twin_raid_burst"
  | "jarls_challenge"
  | "glacial_tomb"
  | "tomb_collapse"
  // The Draconic Host's kits and its elites' signatures (data/skills/draconicHostSkills.ts)
  | "kanabo_blow"
  | "oni_crush"
  | "wyrm_bite"
  | "jade_flame_bite"
  | "feather_dart"
  | "crows_flit"
  | "raiju_spark"
  | "raiju_chain"
  | "warlord_strike"
  | "two_handed_sweep"
  | "warlords_doom"
  | "gale_cut"
  | "hush_of_the_peaks"
  | "great_gale"
  // The Yokai (data/skills/yokaiSkills.ts); the Jorogumo's web and the bite it buys
  | "kodama_rattle"
  | "shell_bash"
  | "kappa_grapple"
  | "belly_slam"
  | "foxfire"
  | "fox_flame"
  | "kitsune_hush"
  | "venom_fangs"
  | "silk_snare"
  | "jorogumo_web"
  | "jorogumo_bite"
  // Jadeveil: Silk Hollow / Yokai — the Nue, and the canopy weaver's boss kit
  | "nue_claws"
  | "nue_black_thunder"
  | "nue_serpent_strike"
  | "canopy_venom"

  // ── Mastery tree skills (data/masterySkills.ts) ──────────────────────────
  | "provoking_strike"
  | "challenge"
  | "intercept"
  | "bellow"
  | "unbreakable_vow"
  | "shield_avalanche"
  | "reckoning"
  | "smite"
  | "lay_on_hands"
  | "judgement"
  | "consecrate"
  | "righteous_fury"
  // `riposte_stance` names no skill any more: the Bulwark remaster (2026-10) removed
  // Set Stance and the Riposte Stance it granted. The id stays because its committed
  // drawing is still in the icon set and may be lent to a future skill.
  | "riposte_stance"
  | "martyr"
  | "bloodthirst"
  | "rend"
  | "executioner"
  | "carnage"
  | "ignite"
  | "cinder_burst"
  | "wildfire"
  | "immolation"
  | "burning_out"
  | "frostbite"
  | "ice_barrier"
  | "silencing_depths"
  | "blizzard"
  | "arc"
  | "thunderstep"
  | "chain_lightning"
  | "tempest"
  // `afterimage` names no skill any more: Summon Thunder Elemental replaced the
  // Afterimage ultimate in the 2026-10 remaster. The id stays because its committed
  // drawing is what the new summon borrows (`HeroSkill.icon`) until it has its own.
  | "afterimage"
  | "summon_thunder_elemental"
  | "lifebloom_skill"
  | "warding_bloom"
  | "emergency_bloom"
  | "wellspring"
  | "rooted_vitality"
  // `evergreen` names no skill any more: Wild Sanctuary replaced the Evergreen
  // capstone in the 2026-10 remaster. The id stays because its committed drawing
  // is what Wild Sanctuary borrows (`HeroSkill.icon`) until it has its own.
  | "evergreen"
  | "wild_sanctuary"
  | "tremor"
  | "stoneskin"
  | "grasping_earth"
  | "stone_ward"
  | "upheaval"
  | "stone_heart"
  | "boulder_leap"
  // `summon_rime_tornado` names no skill any more: Glacial Barrage replaced the
  // Rime Tornado capstone in the 2026-10 remaster. The id stays because its
  // committed drawing is what Glacial Barrage borrows (`HeroSkill.icon`) until
  // that skill has a picture of its own.
  | "summon_rime_tornado"
  | "glacial_barrage"
  | "absolute_zero"
  | "living_stone"
  | "bedrock_stand"
  | "bear_form"
  | "wolf_form"
  | "hawk_form"
  | "apex_form"
  | "roar"
  | "maul"
  | "pounce"
  | "rip"
  | "dive"
  | "screech"
  | "talons"
  | "bear_slam"
  | "hibernate"
  | "throat_tear"
  | "blood_howl"
  | "cyclone"
  | "antler_strike"
  | "antler_charge"
  | "primal_wrath"
  | "mark_target"
  // `piercing_shot` and `follow_through` name no skill any more: Ricochet Shot and
  // Covering Fire replaced them in the 2026-10 Marksman remaster. The ids stay
  // because their committed drawings are what the new skills borrow
  // (`HeroSkill.icon`) until those have pictures of their own.
  | "piercing_shot"
  | "follow_through"
  | "ricochet_shot"
  | "execute"
  | "concussive_shot"
  | "aimed_shot"
  | "rapid_fire"
  | "covering_fire"
  | "covering_fire_shot"
  | "assassinate_strike"
  | "bladestorm"
  | "flurry"
  | "creeping_death"
  | "vanish"
  | "blade_recall"
  | "knife_dance"
  // `throwing_blades` and `volley` name no skill any more: Blade Recall and Knife
  // Dance replaced them in the 2026-10 Skirmisher remaster. The ids stay for the
  // drawings the new skills borrow until they have their own.
  | "throwing_blades"
  | "volley"
  | "bolas"
  | "hit_and_run"
  | "shadowstep"
  | "venomed_blades"
  | "garrote"
  | "hemlock"
  | "assassinate"

  // ── Added by the v3 tree rework ──────────────────────────────────────────
  // Tier 2 is four active skills on every path now, so each of the twelve
  // needed the spell wing filling out. See the private project notes.
  | "reposition"
  | "sanction"
  | "cleaving_throw"
  | "blood_price"
  | "ember_shroud"
  | "frost_lance"
  | "cold_snap"
  | "static_burst"
  | "thunderbolt"
  | "skyfall"
  | "thornrow"
  | "hamstring_shot"
  | "smoke_bomb"
  | "barbed_blades"
  | "cheap_shot"
  // Wildshape's tier 2 is twelve form skills, four per shape — two learnable
  // per animal was a shape whose whole kit was on cooldown every other turn.
  | "bear_grapple"
  | "bear_shrug"
  | "wolf_hamstring"
  | "wolf_takedown"
  | "hawk_shear"
  | "hawk_skyward"
  | "primal_bond"
  // The Monk's Firefly: Glowmote, its signature, and the four tier-2 actives
  | "glowmote"
  | "lantern_sweep"
  | "lightbond"
  | "purifying_light"
  | "lantern_glide"
  // and its three exclusive capstones
  | "firefly_motes"
  | "firefly_swarm"
  | "lantern_beacon"
  // The Wildshape remaster (2026-10). The ids it replaced stay above: their pictures
  // are lent to these until their own are drawn.
  | "crushing_leap"
  | "slip_the_net"
  | "rending_circle"
  | "hunters_mark"
  | "crowned_prey"
  | "primal_surge"
  | "ancestral_hunt"
  // The Mantis (Monk) tree: the signature, its four tier-2 actives and three capstones
  | "twin_reap"
  | "scything_step"
  | "flicker_cut"
  | "pinning_cut"
  | "mantis_pounce"
  | "marked_prey"
  | "threefold_scythe"
  | "mantis_execution"
  // The Beetle (Monk), the private project notes. The leap's response is the
  // answer Carapace Leap fires when its ward is struck.
  | "iron_carapace"
  | "horn_sweep"
  | "carapace_leap"
  | "carapace_leap_answer"
  | "grip_and_throw"
  | "shell_wall"
  // The Beetle's three capstones; Vengeful Shell's answer is the strike back
  | "vengeful_shell"
  | "vengeful_shell_answer"
  | "carapace_bastion"
  | "shell_swap"
  // Retribution's strike back, the Beetle side tree's answer to a blow taken or split
  | "retribution_strike"
  // Returned Blow's strike back, the Beetle's level-26 answer to a blow its full Carapace soaked
  | "returned_blow_strike"
  // Stone's Answer's blow, the Stoneshaper's reply to a broken Barrier
  | "stones_answer"

  // ── The Fallen Order (data/skills/fallenOrderSkills.ts) ──────────────────
  | "novice_staff"
  | "warden_staff"
  | "warden_bastion"
  | "adept_cut"
  | "adept_flicker"
  | "adept_pounce"
  | "sickle_throw"
  | "chain_snare"
  | "chanter_mote"
  | "lantern_hymn"
  | "abbot_palm"
  | "abbot_flicker"
  | "abbot_glowmote"
  | "abbot_vow"
  | "abbot_vow_answer"
  | "bell_strike"
  | "toll_of_passing"
  | "great_ring"
  // Jadeveil: Silent Hall / Fallen Order — the Last Lesson
  | "lesson_staff"
  | "lesson_step"
  | "lesson_riposte"
  | "lesson_rebuke"
  // Jadeveil: Kairen (data/templates/kairen.ts)
  | "coil_lash"
  | "orb_bolt"
  | "jade_orb_bolt"
  | "cloud_dive"
  | "gale_downdraft"
  | "thunderhead"
  | "verdant_judgement"
  | "orb_nova"
  | "brood_of_the_orb"
  | "shard_burst"
  | "brood_bite";
