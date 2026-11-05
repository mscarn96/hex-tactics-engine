import { BuildingType } from '@/models/types';
import { provokeJadeveil } from '@/systems/world/ascent';
import { averagePartyLevel, awardedXp } from '@/systems/progression/leveling';
import { isQuestCombatSite } from '@/quests/sites';
import { reportAchievement } from '@/utils/achievementBus';
import {
  CombatUnit, MapTile, POIType, ResourceType,
} from '@/models/types';
import { HexCoord, hexDistance, hexKey } from '@/utils/hexUtils';
import { resAmount } from '@/utils/resourceText';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { LocationId } from '@/locations/types';
import { NpcId, ObjectiveGroup, QuestId } from '@/quests/types';
import { useQuestStore } from '@/stores/questStore';
import { useAscentStore } from '@/stores/ascentStore';
import { NPCS } from '@/quests/npcData';
import { questTitle } from '@/quests/questText';
import { formatNumber, formatPercent, t } from '@/i18n';
import { usePartyStore, LevelUpEvent } from '@/stores/partyStore';
import { selectGear, useInventoryStore } from '@/stores/inventoryStore';
import { useCityStore } from '@/stores/cityStore';
import { findTemplate, mintItem } from '@/systems/economy/itemFactory';
import { partyItemLevel } from '@/systems/economy/itemLevelSources';
import { questGearLevel, questXpGold } from '@/systems/quests/questRewards';
import { resolveGearReward } from '@/systems/economy/questGear';
import { itemTitle } from '@/data/display/itemDisplay';
import { equippedItemsFor } from '@/systems/progression/equipRules';
import { autoAcceptable, isFinished, questById, questContext } from '@/systems/quests/quests';
import { HuntGround, huntGround } from '@/systems/quests/questHints';
import {
  BattleSite, QuestTargetLine, VictoryPreview, killEvents, previewVictory, questTargetsInBattle, siteEvent,
} from '@/systems/quests/battleQuests';
import {
  noticesForChange, pushQuestNotice, questLogSnapshot,
} from '@/systems/quests/questNotices';
import { useLocationStore } from '@/stores/locationStore';
import { clearedEmpireLairs, clearedLairs } from '@/systems/world/lairs';
import { heldVillageCoord } from '@/systems/world/villageGarrison';
import { nearestFindOf } from '@/systems/world/finds';
import { openingIsUseful } from '@/systems/progression/recruiting';
import { questSiteOpen } from '@/systems/quests/questSiteAccess';

/**
 * Where the game tells the quest log what happened.
 *
 * One module, called from the handful of places an outcome is already known —
 * combat victory, a POI cleared, a resource picked up. `combatEvents.ts` is the
 * precedent: one place that fans an outcome out to interested systems, rather
 * than every call site remembering to report.
 *
 * The reporters are deliberately thin. They exist so a scene never imports
 * `questStore` and never has to know that objectives are counters — a component
 * says what happened, and what that is worth is decided here.
 */

/**
 * Runs a write to the log and announces what it changed.
 *
 * One wrapper rather than a notice raised at each reporter, for the reason this
 * whole module exists: the reporters are thin on purpose, and five of them each
 * remembering to announce is five places for the AI-path bug — the one where a
 * second route in quietly does not do the thing the first one does. A diff of
 * the log either side of the write cannot be forgotten by a caller, and it picks
 * up `sync`'s stock objectives, which report nothing and can still finish a
 * quest.
 *
 * `questStore` writes only on a real change and returns the identical record
 * otherwise, so an event nothing wanted costs one snapshot and no notices.
 */
function announcing(mutate: () => void): void {
  const before = questLogSnapshot(useQuestStore.getState());
  mutate();
  const after = questLogSnapshot(useQuestStore.getState());
  for (const notice of noticesForChange(before, after)) pushQuestNotice(notice);
}

/**
 * Takes a quest on, and says so.
 *
 * The one route in, so that the conversation, the auto-accept sweep and any
 * later caller all raise the same notice. `questStore.accept` is still the thing
 * that writes — this adds nothing to the rule that dialogue never mutates state
 * except through the functions the rest of the game uses; it *is* one of them.
 */
export function acceptQuest(id: QuestId): void {
  announcing(() => {
    useQuestStore.getState().accept(id);
    syncRecords();
  });
}

/**
 * Every enemy that fell, by template.
 *
 * Takes the whole unit list rather than a tally so the caller cannot get the
 * counting wrong, and filters on `isPlayer` so a dead summon of the party's own
 * never counts toward a kill objective.
 */
export function reportVictory(units: CombatUnit[]): void {
  // The whole fight is one announcement, not one per template: four wolves and
  // two goblins in one battle is a single "3/5", the number the player wants.
  // `killEvents` is shared with `previewBattleVictory`, so the victory card and
  // the log count the same bodies.
  announcing(() => {
    const report = useQuestStore.getState().report;
    const ctx = currentQuestContext();
    for (const event of killEvents(units)) report(event, ctx);
  });
}

/**
 * Active quests' unfinished kill counters that this fight's enemies count
 * toward, for the battle intro. See `battleQuests.questTargetsInBattle`.
 */
export function battleQuestTargets(templateIds: readonly string[]): QuestTargetLine[] {
  return questTargetsInBattle(useQuestStore.getState().active, templateIds);
}

/**
 * What a won fight will do to the log, before `reportVictory` and
 * `reportPoiCleared` write it — for the victory card, which is shown first.
 */
export function previewBattleVictory(units: readonly CombatUnit[], site?: BattleSite | null): VictoryPreview {
  const site_ = siteEvent(site);
  const events = site_ ? [...killEvents(units), site_] : killEvents(units);
  return previewVictory(useQuestStore.getState().active, events, currentQuestContext());
}

export function reportPoiCleared(poi: POIType, site?: string): void {
  if (poi === POIType.QuestSite && isQuestCombatSite(site)) reportAchievement({ kind: 'site' });
  announcing(() =>
    useQuestStore.getState().report({ kind: 'clearPoi', poi, site }, currentQuestContext()),
  );
}

export function reportSiteInvestigated(site: string): void {
  announcing(() => useQuestStore.getState().report({ kind: 'investigate', site }, currentQuestContext()));
}

export function reportLocationReached(location: LocationId): void {
  announcing(() =>
    useQuestStore.getState().report({ kind: 'reach', location }, currentQuestContext()),
  );
}

export function reportTalk(npc: NpcId): void {
  announcing(() =>
    useQuestStore.getState().report({ kind: 'talk', npc }, currentQuestContext()),
  );
}

/**
 * Prompts a re-read of the bag.
 *
 * The count is not added anywhere — a `collect` objective reads what is held
 * rather than what passed through — so this is a nudge rather than a deposit.
 * Kept as its own reporter because the pickup site should not have to know
 * that, and because a quest completing the moment the last crystal is mined is
 * worth the call.
 */
export function reportCollected(resource: ResourceType, count: number): void {
  if (count <= 0) return;
  announcing(() =>
    useQuestStore.getState().report({ kind: 'collect', resource, count }, currentQuestContext()),
  );
}

/**
 * Re-checks every quest in flight against the world as it stands.
 *
 * Swept alongside `ensureAutoQuests` and for the same reason: a stock objective
 * can be satisfied by something that reported nothing — buying crystals, opening
 * a chest, or simply having had them before the quest was taken on, which is
 * what left a player holding eight of them unable to hand them in.
 */
export function syncQuests(): void {
  announcing(syncRecords);
}

function syncRecords(): void {
  const store = useQuestStore.getState();
  // Only scan the map when a held stage asks for a waypoint. Ordinary event
  // sweeps do not need a walk through all 4,900 tiles.
  const needsSite = Object.entries(store.active).some(([id, record]) =>
    questById(id as QuestId).stages[record!.stage]?.objectives.some(o => o.kind === 'investigate'
      || (o.kind === 'clearPoi' && o.poi === POIType.QuestSite)));
  const sites: string[] = [];
  if (needsSite) for (const tile of useWorldMapStore.getState().tiles.values()) {
    if (tile.poi === POIType.QuestSite && tile.defeated) sites.push(tile.questId ?? '');
  }
  store.sync(currentQuestContext(), clearedLairs(useLocationStore.getState().spentTriggers), sites);
}

/**
 * The context, assembled from the stores.
 *
 * One place rather than three, so nothing ends up asking about the Grand Quest
 * with `lairsCleared: 0` and concluding the war has not started.
 */
export function currentQuestContext() {
  const spent = useLocationStore.getState().spentTriggers;
  return questContext(
    usePartyStore.getState().heroes.reduce((sum, h) => sum + h.level, 0),
    useQuestStore.getState(),
    clearedEmpireLairs(spent).length,
    useInventoryStore.getState().resources,
    useAscentStore.getState().shrines,
  );
}

/**
 * Lets in any quest that does not wait to be offered.
 *
 * Called wherever the world may just have changed enough to open one — after a
 * fight, on arriving somewhere. Idempotent: `accept` is a no-op for a quest
 * already running or already done, so calling it too often costs nothing and
 * calling it too rarely is the only real failure.
 */
export function ensureAutoQuests(): void {
  for (const id of autoAcceptable(currentQuestContext())) acceptQuest(id);
  // Same sweep, same places, same idempotence — a quest that just let itself in
  // may already be satisfied by what the party is carrying
  syncQuests();
}

/**
 * A tile on the world map the tracked quest wants you to visit, if there is one.
 *
 * Deliberately partial. A quest that says "kill six wolves" has no place to
 * point at, and inventing one — the nearest danger tile, say — would be a guess
 * dressed as guidance. The arrow stays off instead, which is honest and quiet.
 *
 * Nearest match wins, measured from where the party is standing: an objective
 * satisfied by any of four resource nodes should send you to the near one.
 *
 * A followed village (`trackedVillage`, playtest 2026-10-29) is a place by
 * definition: the guide points at it while it is held.
 */
export function trackedQuestTarget(tiles: Map<string, MapTile>): HexCoord | null {
  const log = useQuestStore.getState();
  const { tracked, active, trackedVillage } = log;
  if (trackedVillage) {
    // A village is a POI, so the index below holds it; the whole map only for a store without one
    const { poiCoords } = useWorldMapStore.getState();
    const pois = poiCoords.length > 0
      ? poiCoords.flatMap((coord) => tiles.get(hexKey(coord)) ?? [])
      : tiles.values();
    return heldVillageCoord(pois, trackedVillage);
  }
  if (!tracked) return null;
  const record = active[tracked];
  if (!record) return null;

  const quest = questById(tracked);
  const { partyPosition: from, poiCoords, finds } = useWorldMapStore.getState();

  /**
   * Everything this function can point at *is* a POI tile, so the search walks
   * the store's fixed POI index — a few dozen coordinates — rather than all
   * 4,900 tiles, which it used to do on every revealing step whenever the quest
   * guide was on. The `tiles` parameter still supplies the live per-tile state
   * (`defeated`, `explored`); only the *where* comes from the index.
   *
   * The empty-index fallback is for callers that populated the store without
   * `setTiles` — a handful of tests write state directly — and costs nothing on
   * a real map, which always indexes at least the city.
   */
  const nearest = (match: (t: MapTile) => boolean): HexCoord | null => {
    let best: HexCoord | null = null;
    let bestDistance = Infinity;
    const consider = (tile: MapTile | undefined) => {
      if (!tile || !match(tile)) return;
      const d = hexDistance(from, tile.coord);
      if (d < bestDistance) {
        bestDistance = d;
        best = tile.coord;
      }
    };
    if (poiCoords.length > 0) {
      for (const coord of poiCoords) consider(tiles.get(hexKey(coord)));
    } else {
      for (const tile of tiles.values()) consider(tile);
    }
    return best;
  };

  const cityTile = () => nearest((t) => t.poi === POIType.City);

  /**
   * Where a given person is standing.
   *
   * A wayside carries the id of whoever keeps it, so the three who live on the
   * map have an address; falling back to the city is right for the three who
   * keep it, and is also the only safe answer on a save whose camp has not been
   * placed. One helper rather than the same scan written twice, because the two
   * callers below — a `talk` objective and the walk home — must never disagree
   * about where somebody lives.
   */
  const npcTile = (npc: NpcId) =>
    // A camp's people are found at its gate: the camp itself in their world,
    // and the far road's arch in the Empire
    NPCS[npc].camp ? nearest((t) => t.poi === POIType.WorldGate)
      : nearest((t) => t.poi === POIType.Wayside && t.npcId === npc) ?? cityTile();

  /**
   * Everything done: the arrow's job is now "go and get paid".
   *
   * At its **giver**, which is not the same thing as the city. This returned
   * `cityTile()` unconditionally, written when the quest log still carried a
   * Claim button and the walk home was a formality — a quest is handed back to
   * the person whose problem it was now, and three of the six live out on the
   * map. So finishing anything the huntsman, the hermit or the prospector gave
   * pointed the guide arrow and the gold marker at the city, which is the wrong
   * way and puts a mark on a city that has nothing to offer.
   */
  if (isFinished(quest, record)) return npcTile(quest.giver);

  for (const objective of quest.stages[record.stage].objectives) {
    switch (objective.kind) {
      case 'clearPoi': {
        const hit = nearest((t) => t.poi === objective.poi && !t.defeated && questSiteOpen(t, log)
          && (objective.site ? t.questId === objective.site : t.poi !== POIType.QuestSite || isQuestCombatSite(t.questId)));
        if (hit) return hit;
        break;
      }
      case 'investigate': {
        const hit = nearest(t => t.poi === POIType.QuestSite && t.questId === objective.site && questSiteOpen(t, log));
        if (hit) return hit;
        break;
      }
      case 'collect': {
        // Only a find the party has already seen: the arrow must not reveal
        // the weekly deal through the fog.
        const find = nearestFindOf(
          finds,
          from,
          objective.resource,
          (f) => tiles.get(hexKey(f.coord))?.explored === true,
        );
        if (find) return find.coord;
        break;
      }
      case 'reach': {
        if (objective.location === 'city') return cityTile();
        if (objective.location === 'castle') return nearest((t) => t.poi === POIType.EmpireCastle);
        const hit = nearest((t) => t.poi === POIType.BossTile && t.encounterId === objective.location);
        if (hit) return hit;
        break;
      }
      /**
       * Three of the six people in the game live on the map now, so "go and
       * talk to somebody" is a direction again rather than always being "go
       * home".
       *
       * Load-bearing rather than a convenience: the whole point of
       * `a_word_with_the_trapper` is to put the huntsman's camp on the arrow,
       * and an arrow that pointed at the city instead would send the player
       * exactly the wrong way.
       */
      case 'talk':
        return npcTile(objective.npc);
      case 'shrine': {
        const hit = nearest((t) => t.poi === POIType.Shrine && t.shrine === objective.index);
        if (hit) return hit;
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/**
 * The country to search when the tracked quest wants something killed.
 *
 * The other half of the hole `trackedQuestTarget` leaves open on purpose. That
 * function refuses to point at a hunt because there is no single tile to point
 * at, and the arrow going dark is the honest answer — but honest is not the same
 * as helpful, and "kill five wolves" against 4,900 tiles is still the search that
 * cost a playtest four in-game weeks. There is no *tile*; there is very
 * definitely *ground*, and `huntGround` derives it from the same faction fields
 * the encounter generator obeys.
 *
 * The tracked quest alone, unlike `huntedTemplates`: this is a HUD affordance
 * answering "where do I go for the thing I am following", where that one decides
 * what the world contains and must not be narrowed by a display preference.
 *
 * The current stage's *first* unfinished kill counter. A stage can hold several,
 * but painting the union of two factions' ranges is a highlight that means
 * "somewhere", which is what the map already looked like.
 */
export function trackedHuntGround(): HuntGround | null {
  return trackedHunt()?.ground ?? null;
}

/**
 * The tracked quest's open kill objective: where its quarry is found, what the
 * objective calls it, and how many are already down — what the hunt-ground
 * tip says and when it has done its job.
 */
export function trackedHunt(): { ground: HuntGround; quarry: ObjectiveGroup | null; killed: number } | null {
  const { tracked, active } = useQuestStore.getState();
  if (!tracked) return null;

  const record = active[tracked];
  if (!record) return null;

  const quest = questById(tracked);
  // A finished quest wants the walk home, and `trackedQuestTarget` has a city
  // tile to aim the arrow at — so there is nothing left to hunt.
  if (isFinished(quest, record)) return null;

  const stage = quest.stages[record.stage];
  if (!stage) return null;

  for (let i = 0; i < stage.objectives.length; i++) {
    const objective = stage.objectives[i];
    if (objective.kind !== 'kill') continue;
    const killed = record.progress[i] ?? 0;
    if (killed >= objective.count) continue;
    const ground = huntGround(objective);
    return ground ? { ground, quarry: objective.group ?? null, killed } : null;
  }
  return null;
}

/**
 * Every template an unfinished `kill` objective is currently asking for.
 *
 * Read by the encounter generator to bias which faction turns up. Only counters
 * that are actually short are reported — once five wolves are dead the world
 * stops being full of wolves, which matters because the next stage may want
 * something else entirely.
 *
 * All active quests, not just the tracked one. Tracking is a HUD preference and
 * should not decide what the world contains.
 */
export function huntedTemplates(): string[] {
  const { active } = useQuestStore.getState();
  const wanted = new Set<string>();

  for (const [id, record] of Object.entries(active)) {
    if (!record) continue;
    const quest = questById(id as QuestId);
    const stage = quest.stages[record.stage];
    if (!stage) continue;
    stage.objectives.forEach((objective, i) => {
      if (objective.kind !== 'kill') return;
      if ((record.progress[i] ?? 0) >= objective.count) return;
      for (const template of objective.templates) wanted.add(template);
    });
  }

  return [...wanted];
}

// ─── Paying out ──────────────────────────────────────────────────────────────

export interface ClaimResult {
  /** Player-facing summary lines, in the order they should be shown. */
  lines: string[];
  /** Level-ups triggered by the XP, for the dialog the caller already owns. */
  levelUps: LevelUpEvent[];
}

/**
 * Hands over the rewards and files the quest.
 *
 * The store's `claim` only moves the quest to `completed`; everything that
 * touches another store happens here, so `questStore` never reaches sideways.
 */
export function claimQuest(id: QuestId): ClaimResult {
  const store = useQuestStore.getState();
  if (!store.readyToClaim().includes(id)) return { lines: [], levelUps: [] };

  const quest = questById(id);
  const { rewards } = quest;
  const lines: string[] = [];
  const levelUps: LevelUpEvent[] = [];

  // What was asked for is handed over. A `collect` objective is satisfied by
  // holding the goods rather than by having gathered them, so nothing has been
  // spent up to this point — and a delivery quest that left the crystals in the
  // bag would pay for itself and stock the next one at the same time.
  const inventory = useInventoryStore.getState();
  for (const stage of quest.stages) {
    for (const objective of stage.objectives) {
      if (objective.kind !== 'collect') continue;
      inventory.spendResources({ [objective.resource]: objective.count } as any);
      lines.push(t('campaign.claim.handedOver', { amount: resAmount(objective.resource, objective.count) }));
    }
  }

  // At the band of the world the quest is handed in at
  const paid = questXpGold(quest);
  if (paid.gold) {
    useInventoryStore.getState().addResource(ResourceType.Gold, paid.gold);
    lines.push(resAmount(ResourceType.Gold, paid.gold));
  }

  for (const [resource, amount] of Object.entries(rewards.resources ?? {})) {
    useInventoryStore.getState().addResource(resource as ResourceType, amount);
    lines.push(resAmount(resource as ResourceType, amount));
  }

  if (paid.xp) {
    // Split evenly, the same way a fight pays out — a five-hero party should not
    // level five times faster off one quest than a solo hero does
    const heroes = usePartyStore.getState().heroes;
    const each = Math.max(1, Math.round(paid.xp / Math.max(1, heroes.length)));
    const average = averagePartyLevel(heroes);
    for (const hero of heroes) {
      const paid = awardedXp(each, hero.level, average, useCityStore.getState().getBuildingLevel(BuildingType.Library));
      levelUps.push(...usePartyStore.getState().gainXp(hero.id, each, average));
      lines.push(t('campaign.claim.xp', { name: hero.name, xp: formatNumber(paid) }));
    }
  }

  // Measured after the XP above, so a contract that levels the party pays in
  // gear of the level it has just reached. See `itemLevelSources`. In an expansion
  // world it is clamped to the world's band.
  const { level: rewardLevel, ceiling: rewardCeiling } = questGearLevel(quest, partyItemLevel(usePartyStore.getState().heroes));

  for (const templateId of rewards.items ?? []) {
    const template = findTemplate(templateId);
    if (!template) continue;
    const item = mintItem(template, Math.random, rewardLevel, [], rewardCeiling);
    useInventoryStore.getState().addItem(item);
    lines.push(itemTitle(item));
  }

  /**
   * A piece chosen for the party rather than named in the quest.
   *
   * `mintItem` rather than `itemFromTemplate`, which is the standing split:
   * this is an *acquisition*, so the piece rolls its affixes here and arrives as
   * a Keen Cuirass rather than as a catalogue entry. The reward is the one thing
   * about it that is deterministic — see `resolveGearReward` — because a player
   * should be able to be told what a contract pays.
   *
   * Named for whoever it was chosen for. "Steel Cuirass" is a line in a list;
   * "Steel Cuirass — for Roland" is the sentence that says the reward was
   * *aimed*, which is the whole point of resolving it against the masteries.
   */
  if (rewards.gear) {
    const heroesNow = usePartyStore.getState().heroes;
    // Handed in where the party stands, so a Jadeveil contract may pay the range's own gear
    const pick = resolveGearReward(rewards.gear, heroesNow, (hero) =>
      equippedItemsFor(hero, selectGear(useInventoryStore.getState())), useWorldMapStore.getState().worldId);
    const template = pick && findTemplate(pick.templateId);
    if (pick && template) {
      const item = mintItem(template, Math.random, rewardLevel, [], rewardCeiling);
      useInventoryStore.getState().addItem(item);
      const forHero = heroesNow.find((h) => h.id === pick.heroId);
      lines.push(forHero ? t('campaign.claim.gearFor', { item: itemTitle(item), name: forHero.name }) : itemTitle(item));
    }
  }

  if (rewards.unlocksHero) {
    // An opening, not a name: the quest says the party may grow, and the player
    // says by whom, at the tavern. Quests never named a class because the
    // player picks one of four to start with — but resolving it here for them
    // was the same mistake one step further down.
    if (openingIsUseful(usePartyStore.getState().heroes)) {
      useCityStore.getState().earnRecruit();
      lines.push(t('campaign.claim.recruit'));
    } else {
      // Every class already in the party, so the opening could never be spent.
      // Paying nothing would make the reward a lie, so it converts.
      useInventoryStore.getState().addResource(ResourceType.Gold, 250);
      lines.push(t('campaign.claim.recruitGold', { amount: resAmount(ResourceType.Gold, 250) }));
    }
  }

  // A quest handed in on the range is deliberate Jadeveil work, and provokes it
  const wrath = provokeJadeveil('quest');
  if (wrath && wrath.gained > 0) lines.push(t('campaign.claim.wrath', { percent: formatPercent(wrath.gained / 100) }));

  store.claim(id);
  reportAchievement({ kind: 'quest', completed: useQuestStore.getState().completed.length });
  return { lines: lines.length > 0 ? lines : [t('campaign.claim.complete', { quest: questTitle(id) })], levelUps };
}
