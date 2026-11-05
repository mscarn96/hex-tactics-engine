import type { EncounterEntry } from '@/models/encounterEntry';
import type { EncounterContext, MotifId } from '@/models/types';
import type { LocationId } from '@/locations/types';
import type { HuntStreak } from '@/stores/huntStore';
import type { RunDifficulty } from '@/models/run';
import { isWorldSnapshot, type WorldSnapshot } from '@/systems/world/worldState';
import { isWorldId, type WorldId } from '@/data/worlds';
import { isWrathState, type WrathState } from '@/systems/world/wrath';
import { isVows, type Vows } from '@/systems/world/monastery';
import { SHRINE_COUNT } from '@/systems/world/shrines';
import { BALANCE } from '@/data/balanceConstants';
import { validVillageBuff, type VillageBuff } from '@/systems/economy/villageBuffs';
/**
 * Save-file shape.
 *
 * There is deliberately no migration path: a save whose version doesn't match
 * exactly is rejected and discarded. Bump SAVE_VERSION whenever a persisted
 * field changes shape, and old saves simply stop loading.
 *
 * Kept free of store and AsyncStorage imports so it stays plain data.
 */
import { validMeal } from '@/systems/economy/expeditionMeals';
import { isItemLevel } from '@/data/items/itemLevel';
import { highestLevelCap } from '@/data/levelCap';
import { isWorldBands, type WorldBands } from '@/systems/world/worldBands';
import { validGemStock, validSockets } from '@/data/items/gems';
import { validBag } from '@/data/items/bag';
import { isVariantOf } from '@/data/items/variants';
import { MOTIFS } from '@/data/items/motifs';
import { motifWorld } from '@/data/items/worldGear';

/**
 * 17: the calendar moved out of `worldMap`, and the encounter pre-roll became
 * daily.
 *
 * One number for both, the same way 16 covered two fields on `Item`. `dayNumber`
 * and `weekNumber` are gone from the file entirely — they are `Math.floor` of
 * `totalHours`, so storing them was storing a second copy of one clock, and two
 * clocks are a thing that can disagree. `weeklyEncounterTiles` is
 * `activeEncounterTiles`, because it is now re-rolled every day.
 *
 * A version-16 save would have *loaded* under this shape and been quietly wrong
 * in the worst available way: `activeEncounterTiles` reads `undefined`, so the
 * `new Set(...)` throws or comes back empty and the map has no fights on it at
 * all until the next dawn. That is exactly what the no-migration rule is for.
 */
/**
 * 23: heroes no longer own a class at-will. Slash, Arcane Bolt, Thorn Lash and
 * Throw Knife left the hero templates when the Basic Attack became a thing the
 * weapon makes at combat setup, and the Druid's starting weapon became a branch.
 * A version-22 hero carries its old at-will in the saved `skills` list, so it
 * would walk into every fight with two free attacks on the bar — one of them the
 * very class-fixed skill this version exists to retire, still hitting at its old
 * reach whatever the hero is holding.
 *
 * 22: `Item.upgradeLevel` is gone — a legendary's Crystal upgrades are item
 * levels past the cap now. A version-21 save would load every +3 legendary as a
 * +0, silently, while its owner remembers paying three Crystals for it.
 *
 * 21: every saved `Item` carries `itemLevel`.
 *
 * A version-20 item has no level, and an item's level is what its saved
 * `modifiers` are scaled to — so there is nothing honest to default it to: the
 * anchor would claim every old epic was found at 14, and anything the forge
 * later re-levels from that claim would move its stats by an amount nobody
 * chose. Exact-version, as always. **Within** version 21 a missing or malformed
 * level is not patched either: `isLoadable` refuses a save holding one, in the
 * bag or the stash, by the same rule it refuses a wrong version — a file that
 * claims to be this shape and is not is exactly what that rule exists for.
 *
 * 20: `inventory.rations` — food, as a counter.
 *
 * The mildest of the bumps so far, and taken anyway because the rule is that a
 * new persisted field means a bump and nothing else. A version-19 save would
 * have loaded with `rations` undefined, which is not the silent catastrophe 18
 * and 19 were — but `rations - 1` on an undefined is `NaN`, and a pack holding
 * NaN rations is a Feed button that neither works nor says why, forever, in a
 * save that looks fine. A `?? 0` on the read would paper over exactly that and
 * is the thing the exact-version rule exists instead of.
 *
 * 19: `Hero.masteryNodes` is a map of node id to level, not a list of ids.
 *
 * Every node in a tree holds three levels now and each is its own point, so
 * ownership stopped being a boolean. A version-18 save deserialises with an
 * *array* in that field, and an array is an object — so nothing throws.
 * `nodeLevel` would read `masteryNodes['bulwark_spite']` off an array and get
 * `undefined`, which reads as a hero who has spent fifteen points and owns
 * nothing: no tree skills, no tree stats, and a full points balance to spend
 * again. It looks like a hero who never picked anything rather than like a
 * corrupt save, which is exactly the failure the exact-version rule exists for.
 *
 * 18: `MapTile` gained `zone` and lost `isDanger` and `road`.
 *
 * The overworld is three zones now — road, corridor, haunted — where it used to
 * be two independent booleans that between them answered the same question in
 * two half-answers. A version-17 map deserialises with `zone` undefined on every
 * tile, which is not a subtle wrongness: `ZONE_ENCOUNTER_RATE[undefined]` is
 * `undefined`, so the daily roll produces an empty set and the entire world has
 * no fights in it, forever, while looking completely normal.
 */
/**
 * 28: the lair reorder. The ice lair keeps `lair_barrow`'s id on a new floor
 * plan, so a version-27 save's spent triggers name hexes of the Barrow that
 * are not where the ice lair's chests and guards stand; its map placed the
 * Hollow's and the ice lair's doors without their sites; and it can hold a
 * Staff of Undeath the item table no longer has.
 *
 * 27: the frozen north. `MapTile` gained `frost` and the map can hold
 * `TileType.Tundra`. A version-26 map has neither — no north at all — and would
 * load as a world the latitude pass never ran on.
 *
 * 26: the `of_the_bulwark` affix is `of_the_aegis`.
 *
 * Affix ids are persisted on every affixed item, and an id nothing defines
 * would load as a piece whose name and stats no longer agree. The old name
 * also read as the Bulwark path's gear; see `itemAffixes.test.ts`.
 *
 * 25: held items carry `variant`, the named silhouette they were minted as.
 *
 * A version-24 weapon has none, which would load and draw as its form's base
 * model — a quiet change of what the player's own sword looks like, the day it
 * could first have been a falchion. Within 25, a variant that is not one of its
 * item's form's is refused rather than drawn as something else.
 *
 * 24: socket capacity, embedded gems and both loose gem stacks are persisted.
 */
/** 29: remove drill/market shelf stamps; persist purchased expedition meal tier and week. */
/** 31: fixed campaign difficulty and Hard-only Hardcore. */
/** 32: campaign victory ids for the ten-win achievement; earned profile stays separate. */
/** 33: resource nodes are gone; the world map persists this week's exploration finds. */
/** 34: equipment defence bonuses are independent; remint old test-save equipment. */
/** 36: committed encounters, location/run entry state and quest hunt streaks. */
/** 37: the Hydromancer remaster removes the Rime, Coldblooded and Rime Tornado nodes. */
/** 38: the Pyromancer remaster replaces the Kindling node with Fuel the Flame. */
/** 39: the Lifewarden remaster removes the Green Hands, Wellspring Heart, Verdant and Evergreen nodes. */
/** 40: the Bulwark remaster removes the Iron Frame, Immovable and Set Stance nodes and moves three. */
/** 41: the Marksman remaster removes Evasion, Piercing Shot, Follow-Through, Sure Footing and Braced. */
/** 42: the Stormcaller remaster removes the Quickened and Afterimage nodes. */
/** 43: the Templar remaster swaps four nodes, which changes the derived prerequisites of the rows below. */
/** 44: the Stoneshaper remaster removes the Patient Earth, Living Rock and Stonecutter nodes. */
/** 45: the Skirmisher remaster removes Light Foot, Bandolier, Evasion and Volley. */
/** 46: the Berserker remaster removes the Thick Hide node. */
/** 47: the Wildshape remaster replaces Bear Hug, Hamstring, Takedown, Skyward, Feral Heart and Primal Bond. */
/** 48: the Shadowblade remaster removes Quick Hands and Rot and moves Lethality. */
/** 49: heroes persist `wildForm`, the Wildshape animal carried into the next fight. */
/** 50: penetration splits into Armour Pen and Magic Pen; pen and lifesteal affixes are repriced and of Ruin is martial-only. */
/** 51: a committed encounter snapshot stores each scripted boss's own counters (`LegionScriptState`) instead of the Emperor's on every boss. */
/** 52: heroes persist their choices and state only; `skills`, `baseStats` and `heroClass` are derived on load. */
// 53: one carried consumable town portal; old test saves require a fresh campaign.
// 54: item `classLock` is a list of classes; old items carry a single class.
// 55: the Monk ships whole — three mastery paths and their sets, path armour weight at every rarity
// (common pieces in another weight are refused), a Monk focus that waits for the Firefly, and unit
// facing; old test saves can hold gear these rules now refuse.
// 56: warding incense — `inventory.wards` and `worldMap.wardUntil` (playtest 2026-10-14).
// 57: worlds. `worldMap` holds one compact `WorldSnapshot` per visited world — seed plus explored
// and defeated keys instead of 4,900 whole tiles — and which world the party stands in.
// 58: Jadeveil Range generates as its own 44×40 range, so a saved Jadeveil seed's explored keys
// and position no longer describe the map it regenerates.
// 59: Jadeveil's wrath stamp and the monastery's vows (`ascent`).
// 60: Jadeveil's shrines claimed (`ascent.shrines`), which gate the range's bands.
// 61: Kairen's summit (`ascent.summit`): slain, the Storm Seals held, the highest tier cleared.
// 62: Jadeveil's equipment: the collection, Votive and Spiritsealed motifs, the two
//     authored weapons, a collection bonus's `path`, and the forge's Spirit Ink and
//     learned patterns (`ascent.forge`).
// 63: the unified bag — `inventory.bag`, one list of entries with a kind (gear, gem,
//     ration, town portal, warding incense), replaces `items`, `gems`, `rations`,
//     `townPortal` and `wards`.
// 64: item instances no longer carry `name` or `description`; both are built from the
//     template, form, motif, variant and affixes when shown (`data/items/itemText.ts`).
// 65: the prospector chain's Delve fight (`the_overseers_cut`) adds a named quest site, so a
//     saved map generated without it has no address for the new contract.
// 66: `city.sackedUntilDay` — a lost siege leaves the town looking sacked for
//     `SACK_DAYS` (`systems/economy/sacking.ts`).
// 67: the biome lock moves the Wyrm's door to desert only and the Fallen Order's shrine onto
//     highlands (`mapGenerator`), so a saved map holds doors and shrines on ground the generator
//     no longer places them.
// 68: Jadeveil's Spirit gem tier — every gem stock (the bag's stacks, the stash's
//     `gemStash`) and every socket now has twelve gem ids, not eight.
// 69: `city.recruitNoticeShownFor` — the "a new hero can join" notice is shown once per opening.
// 70: Hoofprints in the Mud replaces What the Reeds Hide (`hoofprints_in_the_mud`), with two new
//     named quest sites a saved map has no address for.
// 71: playtest 2026-10-23 — the Obsidian castle's ring is generated haunted, and Jadeveil's map is
//     39×35 with the foothill camp in its south-west corner, so a saved map holds neither.
// 72: boss tactics, shared systems — `PreparedSpec` grows split/onWhiff/blockedBy/shelter,
//     `ArenaHazard` grows lasts/kind and `BossScriptState` grows `unharmedRounds`. Fight state
//     is rebuilt from the checkpoint rather than saved, so this is the epic's single precaution.
// 73: the Emerald Dragon's heat — `BossScriptState` grows `heat` (Rising Fire reads it, not the turn count),
//     `PreparedSpec` grows `quenchedOnBreak`, and his Cinder Rift lasts until his next Skyfire (`lasts`/`kind`).
// 74: boss tactics, Aethelred — `PreparedAttack` grows `tolls` (the Foreclosure seals a hero has paid),
//     `PreparedSpec` grows `sealed`, and a placed objective carries `breakerBarrier`.
// 75: the Heart's Creeping Winter spares the ground beside a standing anchor — `PreparedAttack` grows `sheltered`.
// 76: villages — the generator places four on the Empire's map, so a saved map holds none.
// 77: village buffs — `worldMap.villageBuff`, the buff held and the hour it ends.
// 78: travelling merchants — each world snapshot carries `merchants`, the week's deal.
// 79: playtest 2026-10-28 — Aethelred carries `challengeTier`, the Seal tier, and a placed Imperial
//     Standard a `backlash` that falls with it; the castle's Sanctum and Inner Yard swap places.
// 80: playtest 2026-10-29 — `quests.trackedVillage`, a held village followed in a quest's place.
// 81: the Troll's fort — his six-slot cycle is Prey, Sweep, Sweep, Smash, Sweep, Sweep, so a saved
//     `bossScript.step` names a different move.
// 82: the Emerald Dragon's hot potato — a Furnace Heart rides on a hero (`ObjectiveSpec.carrierId`, a
//     `'heart'` warning bound to its carrier), the new `seared` affliction, and the Cinder Rift counts its
//     own turns.
// 83: the Heart of Winter's Seal refight — `empire.winterSeals` (Winter Seals held by tier) and
//     `empire.heartTier` (the highest Heart tier cleared).
// 84: Aethelred the sore loser — his script remembers Overturn's throws (`LegionScriptState.overturns`), his
//     phase 2 opens on the Chains, and Crownfall carries a per-point block (`PreparedSpec.heldBy`).
// 85: Aethelred's castle-tier twists — his script remembers a fallen Standard (`LegionScriptState.standardFell`) and a
//     black sun his last throw called (`realmOwed`).
// 86: The world band ledger (`worldBands`): the band each expansion world took, and which are finished.
// 87: The mythic bad-luck counter (`mythicKills`): eligible boss kills since the last mythic.
export const SAVE_VERSION = 87;

export interface SaveData {
  version: number;
  game: {
    phase: string;
    currentEncounterId?: string | null;
    currentEncounterContext?: EncounterContext | null;
    encounterEntry?: EncounterEntry | null;
    mapSeed: number;
    starterHeroId: string | null;
    difficulty: RunDifficulty;
    hardcore: boolean;
    achievementVictories: string[];
  };
  party: {
    /** `SavedHero`s (`heroSave`): choices and state, with the kit and stats derived on load. */
    heroes: any[];
  };
  inventory: {
    /**
     * The bag as one list of entries with a kind (`BagEntry`): gear pieces, and
     * stacks of gems, rations, the town portal and warding incense. Checked by
     * `validBag`, and its gear by `savedItemsWellFormed`.
     */
    bag: any[];
    resources: any;
  };
  worldMap: {
    /** The world the party stands in; `worlds` must hold it. */
    current: WorldId;
    /**
     * Every world the party has entered, as seed and player marks
     * (`WorldSnapshot`): the map is regenerated on load. Worlds not yet entered
     * are absent and generate fresh on arrival.
     */
    worlds: Partial<Record<WorldId, WorldSnapshot>>;
    /**
     * The whole campaign clock, as one number — one hour per tile walked.
     *
     * The day and the week are `Math.floor` of this (see `calendarStore`), so
     * they are derived on load rather than stored. Same rule lairs follow:
     * completion is derived, never stored, because a second record of one fact
     * is a second thing that can be wrong.
     */
    totalHours: number;
    /** The campaign hour a lit ward burns until; 0 when none was lit. Carried with the party. */
    wardUntil: number;
    /** The village buff held (`systems/economy/villageBuffs.ts`), or null. Carried with the party. */
    villageBuff: VillageBuff | null;
  };
  /** The world band ledger (`systems/world/worldBands.ts`): the band each expansion world took, and which are finished. */
  worldBands: WorldBands;
  /** The mythic bad-luck counter (`stores/mythicStore.ts`): eligible boss kills since the last mythic. */
  mythicKills: number;
  /**
   * Jadeveil's progression: the wrath bar as a stamp (`wrath.ts` derives the
   * reading from the clock) and the monastery's party-wide vows, one per ring.
   */
  ascent: {
    wrath: WrathState;
    vows: Vows;
    /** Shrines claimed in order (`shrines.ts`), 0–4. */
    shrines: number;
    /** Kairen's summit (`ascentStore.summit`): slain once, Storm Seals by tier, the highest tier cleared. */
    summit: { slain: boolean; seals: number[]; highestTier: number };
    /** Spirit Ink held and the world patterns the forge has learned (`ascentStore.ink` / `patterns`). */
    forge: { ink: number; patterns: string[] };
  };
  city: {
    buildings: any[];
    gemStash: any;
    /**
     * Places at the table earned, not the classes filling them.
     *
     * Who the party holds is already on `party.heroes`, and who it *could* hold
     * is everyone else — so the only thing that cannot be derived is how many
     * more it is allowed.
     */
    recruitsEarned: number;
    /** The party size the recruit notice was last shown for (`recruitNoticeDue`); 0 before the first. */
    recruitNoticeShownFor: number;
    /**
     * Items left in the city. The one thing a defeat cannot take.
     *
     * Persisted separately from `inventory.items` because that is exactly what
     * the wipe operates on — a shelf the wipe has never heard of cannot be
     * cleared by a later change to it.
     */
    stash: any[];
    meal: { week: number; tier: number } | null;
    /** The first day the town no longer looks sacked after a lost siege; 0 if it never was. */
    sackedUntilDay: number;
  };
  quests: {
    huntStreak?: HuntStreak;
    /** Quest id → `{ stage, progress }`. */
    active: Record<string, { stage: number; progress: number[] }>;
    completed: string[];
    tracked: string | null;
    /** A held village followed in a quest's place (`questStore.trackedVillage`). */
    trackedVillage: string | null;
  };
  locations: {
    current?: LocationId | null;
    position?: { q: number; r: number };
    pending?: { q: number; r: number } | null;
    /**
     * One-shot triggers already used, as `"<location>:<q>,<r>"`.
     *
     * Cleared triggers survive every save. The current location and pending fight
     * are restored for combat checkpoints; ordinary location saves reopen on
     * the world map. **Chests never respawn**, which is what this set is
     * for — a lair is a place you loot once.
     */
    spentTriggers: string[];
  };
  empire: {
    castleTier?: number | null;
    castleStage?: number;
    lastSettledWeek: number;
    tributePaid: number;
    goldPaid: number;
    siegesFought: number;
    emperorDefeated: boolean;
    /**
     * Seals held, by tier. An unresolved castle stage keeps its run tier, stage
     * and original entry party, preserving the attrition of earlier stages.
     */
    seals: number[];
    castleCleared: boolean;
    deepestTier: number;
    crystals: number;
    /** The Heart of Winter's refight: Winter Seals held by tier, and the highest tier cleared. */
    winterSeals: number[];
    heartTier: number;
  };
}

/**
 * Whether every item a save holds carries a level this build can read.
 *
 * The bag and the stash are the two places an item lives; equipment is a map of
 * ids into the bag, so it holds no items of its own to check. A legendary may
 * stand up to `MAX_UPGRADE_LEVEL` past the cap; nothing else may pass it.
 * Measured against the **highest** cap (`highestLevelCap`), not the one in
 * force: this runs before the campaign's stores are restored, and a level an
 * owner's campaign reached is real even when ownership cannot be read today.
 * A named variant must be one its form comes in.
 */
export function savedItemsWellFormed(data: Pick<SaveData, 'inventory' | 'city'>): boolean {
  const bag = Array.isArray(data.inventory?.bag) ? data.inventory.bag : [];
  const items = [...bag.filter((e) => e?.kind === 'gear').map((e) => e.item), ...(data.city?.stash ?? [])];
  return items.every((item) => isItemLevel(item?.itemLevel, item?.rarity, highestLevelCap())
    && validSockets(item?.sockets, item?.rarity)
    && isVariantOf(item?.form, item?.variant));
}

/** Whether the saved worlds name real worlds, hold the current one and are each restorable. */
export function savedWorldsWellFormed(worldMap: SaveData['worldMap'] | undefined): boolean {
  if (!worldMap || !isWorldId(worldMap.current) || !worldMap.worlds) return false;
  const entries = Object.entries(worldMap.worlds);
  return entries.every(([id, world]) => isWorldId(id) && isWorldSnapshot(world))
    && isWorldSnapshot(worldMap.worlds[worldMap.current]);
}

/** Whether a saved summit is one this build can restore: a flag, a Seal count per tier, a tier cleared. */
export function isSummitState(value: unknown): value is SaveData['ascent']['summit'] {
  const s = value as SaveData['ascent']['summit'] | undefined;
  return !!s && typeof s.slain === 'boolean'
    && Array.isArray(s.seals) && s.seals.length === BALANCE.KAIREN.MAX_TIER
    && s.seals.every((n) => Number.isInteger(n) && n >= 0)
    && Number.isInteger(s.highestTier) && s.highestTier >= 0 && s.highestTier <= BALANCE.KAIREN.MAX_TIER
    && (s.slain || s.highestTier === 0);
}

/** Whether a saved Heart ladder is restorable: a whole count of Winter Seals per tier, and a tier cleared within the ladder. */
export function isHeartLadder(empire: unknown): boolean {
  const e = empire as Partial<SaveData['empire']> | undefined;
  return !!e && Array.isArray(e.winterSeals) && e.winterSeals.length === BALANCE.HEART_SEAL.MAX_TIER
    && e.winterSeals.every((n) => Number.isInteger(n) && n >= 0)
    && Number.isInteger(e.heartTier) && e.heartTier! >= 0 && e.heartTier! <= BALANCE.HEART_SEAL.MAX_TIER;
}

/** Whether a saved Jadeveil forge is restorable: whole Ink, and patterns that are world motifs, once each. */
export function isAscentForge(value: unknown): value is SaveData['ascent']['forge'] {
  const f = value as SaveData['ascent']['forge'] | undefined;
  return !!f && Number.isInteger(f.ink) && f.ink >= 0
    && Array.isArray(f.patterns)
    && f.patterns.every((m) => typeof m === 'string' && m in MOTIFS && !!motifWorld(m as MotifId))
    && new Set(f.patterns).size === f.patterns.length;
}

/** Whether a parsed save can be loaded by this build. */
export function isLoadable(data: SaveData | undefined): boolean {
  return data?.version === SAVE_VERSION
    && ['easy', 'medium', 'hard'].includes(data.game?.difficulty)
    && typeof data.game?.hardcore === 'boolean'
    && (!data.game.hardcore || data.game.difficulty === 'hard')
    && Array.isArray(data.game.achievementVictories)
    && data.game.achievementVictories.length <= 10
    && data.game.achievementVictories.every(key => typeof key === 'string' && key.length > 0)
    && new Set(data.game.achievementVictories).size === data.game.achievementVictories.length
    && savedWorldsWellFormed(data.worldMap)
    && isWorldBands(data.worldBands)
    && Number.isInteger(data.mythicKills) && data.mythicKills >= 0
    && isWrathState(data.ascent?.wrath) && isVows(data.ascent?.vows)
    && Number.isInteger(data.ascent?.shrines) && data.ascent.shrines >= 0 && data.ascent.shrines <= SHRINE_COUNT
    && isSummitState(data.ascent?.summit)
    && isHeartLadder(data.empire)
    && isAscentForge(data.ascent?.forge)
    && validBag(data.inventory?.bag)
    && typeof data.worldMap?.wardUntil === 'number' && Number.isFinite(data.worldMap.wardUntil)
    && validVillageBuff(data.worldMap?.villageBuff)
    && savedItemsWellFormed(data)
    && validMeal(data.city?.meal)
    && Number.isInteger(data.city?.sackedUntilDay) && data.city.sackedUntilDay >= 0
    && Number.isInteger(data.city?.recruitNoticeShownFor) && data.city.recruitNoticeShownFor >= 0
    && validGemStock(data.city?.gemStash);
}
