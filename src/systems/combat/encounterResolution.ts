import { CombatUnit, POIType, ResourceType } from '@/models/types';
import { clearedLairs } from '@/systems/world/lairs';
import { provokeJadeveil } from '@/systems/world/ascent';
import { shrineOfEncounter } from '@/systems/world/shrines';
import { liberate, villageOfEncounter, type Liberation } from '@/systems/world/villageGarrison';
import { summitTierFromId } from '@/systems/world/summit';
import { heartTierFromId } from '@/systems/world/heartRefight';
import { useAscentStore } from '@/stores/ascentStore';
import { useCityStore } from '@/stores/cityStore';
import { useCalendarStore } from '@/stores/calendarStore';
import { useCombatStore } from '@/stores/combatStore';
import { useEmpireStore } from '@/stores/empireStore';
import { useGameStore } from '@/stores/gameStore';
import { useHuntStore } from '@/stores/huntStore';
import { useInventoryStore } from '@/stores/inventoryStore';
import { useLocationStore } from '@/stores/locationStore';
import { useMythicStore } from '@/stores/mythicStore';
import { useQuestStore } from '@/stores/questStore';
import { useSimStore } from '@/stores/simStore';
import { LevelUpEvent, usePartyStore } from '@/stores/partyStore';
import { useWorldMapStore } from '@/stores/worldMapStore';
import { CastleRun, CombatReward, DefeatPenalties } from '@/systems/combat/combatRewards';
import { formToCarry } from '@/systems/combat/wildshape';
import { reportCampaignVictory } from '@/systems/progression/achievementBattle';
import { averagePartyLevel } from '@/systems/progression/leveling';
import { ensureAutoQuests, reportPoiCleared, reportVictory } from '@/systems/quests/questEvents';
import { CASTLE_STAGE_COUNT, castleStageCarry } from '@/systems/world/castle';

/**
 * What a finished fight does to the rest of the game.
 *
 * Both lived in `CombatScene`'s handlers, interleaved with the scene's own
 * state: nine stores written from inside a React component, which is why the
 * rules among them — a Druid's health is banked out of the animal's pool, the
 * siege costs the city its buildings — had no test that did not mount a scene.
 * Neither function renders anything. They read and write the stores through
 * `getState()` and hand back what the screen needs; the scene keeps its own
 * setters and the transition out.
 */

export interface VictoryContext {
  /** The board as the fight ended, before the combat store is reset. */
  units: CombatUnit[];
  encounterId: string | null;
  castleRun: CastleRun | null;
  /** The fight was the guard of a chest, which is spent on the win. */
  guardsChest: boolean;
}

export interface VictoryOutcome {
  /** The levels this win earned, for the level-up dialog. */
  levelUps: LevelUpEvent[];
  /** Something was added to the bag, for the loot sound. */
  looted: boolean;
  /** A village the win freed, for the toast that says what it paid. */
  liberated?: Liberation;
}

/**
 * Banks a win. Returns `null` when this fight has already been paid, which is
 * what makes a second close of the dialog a no-op.
 */
export function applyVictory(rewards: CombatReward, ctx: VictoryContext): VictoryOutcome | null {
  const { units, encounterId, castleRun, guardsChest } = ctx;
  const game = useGameStore.getState();
  const entry = game.encounterEntry;
  if (entry?.resolved) return null;
  if (entry) {
    useGameStore.setState({ encounterEntry: { ...entry, resolved: true } });
    if (entry.plan.hunt) {
      const hunt = entry.plan.hunt;
      const progressed = units.some(
        (u) => !u.isPlayer && !u.summonedBy && u.currentHp <= 0 && hunt.targets.includes(u.templateId ?? ''),
      );
      useHuntStore.getState().won(hunt.key, progressed);
    }
  }
  reportCampaignVictory(units, encounterId ?? '');
  // Before anything else touches the unit list: quest objectives count what
  // fell in this fight, and the party is about to be written back and reset
  reportVictory(units);

  const party = usePartyStore.getState();
  const levelUps: LevelUpEvent[] = [];
  const xpAverage = averagePartyLevel(party.heroes);
  // The harness's castle chain is the balance lab's, whose heroes never level between stages: a level
  // taken after the Gate would rescale every stage after it (`simCastle.ts`)
  const earnsXp = !(castleRun && useSimStore.getState().active);
  for (const unit of units.filter((u) => u.isPlayer && u.currentHp > 0)) {
    if (unit.heroId && earnsXp) levelUps.push(...party.gainXp(unit.heroId, rewards.xpPerHero, xpAverage));
  }

  for (const unit of units.filter((u) => u.isPlayer)) {
    if (!unit.heroId) continue;
    // Out of the shape before the number is banked. A fight won as a bear
    // ends with health measured against the bear's pool, and writing that
    // straight back would hand the Druid a share of a body they are no
    // longer wearing. `setHp` clamps to the hero's own maximum on top.
    party.setHp(unit.heroId, Math.round(unit.currentHp / (unit.formVigor ?? 1)));
    // The animal is kept for the next fight; Apex and a fallen Druid are not
    party.setCarriedForm(unit.heroId, formToCarry(unit));
    useCombatStore.getState().restoreMana(unit.id, Infinity);
  }

  // Between stages the party is patched up, not rested. That is the whole
  // reason the gauntlet is a resource problem rather than four unrelated
  // fights — and mana has to be written back for it to be one at all, since
  // nothing outside the castle ever persists a hero's mana.
  if (rewards.nextStage) {
    useSimStore.getState().logBattleStage(rewards.nextStage.name);
    for (const unit of units.filter((u) => u.isPlayer && u.heroId)) {
      const carry = castleStageCarry(unit);
      party.setHp(unit.heroId!, carry.hp);
      party.setMana(unit.heroId!, carry.mana);
    }
  }

  if (rewards.chest) {
    const empire = useEmpireStore.getState();
    empire.addSeal(rewards.chest.sealTier);
    // The debt dies with the man who was collecting it. Set once and never
    // unset — the tribute clock reads this every week rollover.
    empire.setEmperorDefeated(true);
  }

  const inventory = useInventoryStore.getState();
  inventory.addResource(ResourceType.Gold, rewards.gold);
  for (const { type, amount } of rewards.resources) inventory.addResource(type, amount);
  for (const item of rewards.items) inventory.addItem(item);
  for (const gem of rewards.gems) inventory.addGem(gem);
  // Jadeveil's Spirit Ink is the range's, banked beside its other progression
  if (rewards.ink) useAscentStore.getState().addInk(rewards.ink);
  if (rewards.mythicKills !== undefined) useMythicStore.getState().setKills(rewards.mythicKills);

  // Mark boss/quest tiles as defeated so their prop disappears from the map
  const { partyPosition, getTile, markDefeated } = useWorldMapStore.getState();
  const combatTile = getTile(partyPosition);
  // A location fight is spent here rather than on the way in, so a room only
  // counts as cleared once it actually was
  const lairsBefore = clearedLairs(useLocationStore.getState().spentTriggers).length;
  useLocationStore.getState().resolvePending();
  // A lair cleared in Jadeveil provokes the range (`ascent.provokeJadeveil`)
  if (clearedLairs(useLocationStore.getState().spentTriggers).length > lairsBefore) provokeJadeveil('lair');

  // A shrine's keepers beaten: the shrine is claimed, and the band above opens
  const shrine = shrineOfEncounter(encounterId);
  if (shrine !== null) useAscentStore.getState().claimShrine(shrine);

  // Kairen slain: the summit banks the kill and pays its Storm Seal. Only the first kill
  // is the story's — the orb and the quest's close ride on the kill objective, which a
  // finished quest no longer counts, so a repeat pays the tier and nothing more
  const summitTier = summitTierFromId(encounterId);
  if (summitTier !== null) {
    const clear = useAscentStore.getState().clearSummit(summitTier);
    if (clear.firstKill) {
      useAscentStore.setState({ news: { kairenSlain: true } });
    }
  }

  // The Heart killed, in its lair or at a Seal tier: the next Winter Seal, and the tier on the ledger
  if (rewards.winterSeal) useEmpireStore.getState().clearHeart(rewards.winterSeal.tier);

  // The third lair falling is the one world change that opens a quest nobody
  // offers. Swept here because this is the moment it can happen.
  ensureAutoQuests();

  // The chest is spent on the win, whose rewards already paid its contents;
  // on a loss it stays where it lies until the week turns.
  if (guardsChest) useWorldMapStore.getState().claimFind(partyPosition);

  // A Heart refight is fought from the cleared Barrow's door: the lair's one-time payouts were paid on its first kill
  const refight = heartTierFromId(encounterId) !== null;
  if (!refight && combatTile && (combatTile.poi === POIType.BossTile || combatTile.poi === POIType.QuestSite)) {
    markDefeated(partyPosition);
    // Reported on the win rather than on arrival: walking back onto a site you
    // already cleared should not tick an objective a second time
    reportPoiCleared(combatTile.poi, combatTile.questId);
  }

  // A village's garrison beaten: the village is free for the rest of the run, pays
  // its gold and grants its current buff for a week. Only a win reaches here, so a
  // loss leaves it occupied; a village already free pays nothing a second time.
  let liberated: Liberation | undefined;
  const garrison = villageOfEncounter(encounterId);
  if (garrison && combatTile?.poi === POIType.Village && combatTile.village === garrison.theme) {
    const freed = useWorldMapStore.getState().freeVillage(partyPosition);
    liberated = liberate(garrison.theme, freed, (gold) => inventory.addResource(ResourceType.Gold, gold)) ?? undefined;
    // A followed village is done with once it is free
    if (useQuestStore.getState().trackedVillage === garrison.theme) useQuestStore.getState().trackVillage(null);
  }

  if (castleRun && castleRun.stage === CASTLE_STAGE_COUNT - 1) useEmpireStore.getState().endCastleRun(true);

  return { levelUps, looted: rewards.items.length > 0 || rewards.gems.length > 0, liberated };
}

export interface DefeatContext {
  castleRun: CastleRun | null;
  /** Losing the siege is the sacking of the city. */
  isSiege: boolean;
  /** A lost Heart refight: the party stays on the map at the Barrow's door rather than being carried home. */
  atDoor?: boolean;
}

/**
 * Pays for a loss: the bag, the gold, the fight's XP progress, a castle run,
 * and, if it was the siege, the city. The party is carried home whole and in
 * their own shapes, and moved to the city; the scene resets the combat store
 * and chooses where the screen goes next.
 */
export function applyDefeat(penalties: DefeatPenalties | null, ctx: DefeatContext): void {
  // Only unworn gear is lost; what is worn stays, and so do the bag's stacks
  const party = usePartyStore.getState();
  const equippedIds = new Set(party.heroes.flatMap((h) => Object.values(h.equipment)));
  useInventoryStore.getState().keepGear(equippedIds);
  party.resetXpProgress();
  if (penalties && penalties.goldLost > 0) {
    useInventoryStore.getState().addResource(ResourceType.Gold, -penalties.goldLost);
  }

  // Losing at any stage ejects you and resets the run — and the Seal was
  // already spent walking in. Harsh, but the way back up is a ladder climb
  // rather than a save file: craft a tier-1 Seal and start again.
  if (ctx.castleRun) useEmpireStore.getState().endCastleRun(false);

  // Losing the siege is the sacking of the city, and costs more than any other
  // defeat in the game — it is also the only one you were warned about seven
  // days in advance. Applied after the standard penalty, not instead of it.
  // The town then looks sacked for `SACK_DAYS` (`systems/economy/sacking.ts`).
  if (ctx.isSiege) {
    useInventoryStore.getState().clearResources();
    useCityStore.getState().sack(useCalendarStore.getState().dayNumber);
  }

  /**
   * Carried home whole.
   *
   * Defeat already costs the bag, the gold and the fight's XP progress; a forced
   * bed on top is a fourth penalty nothing announced, and it read as heroes
   * respawning broken. `restAll` fills to `heroMaxHp` and `heroMaxMana` — the
   * gear-aware ceilings — and writes mana back to the heroes, which the loop it
   * replaced never did (it restored the combat units, thrown away on reset).
   */
  party.restAll();
  // Carried home in their own shapes: nobody walks out of a lost fight a bear
  for (const hero of party.heroes) party.setCarriedForm(hero.id, null);

  // Home: the city, or the arrival camp of a world without one.
  const home = useWorldMapStore.getState().homeCoord;
  if (home && !ctx.atDoor) useWorldMapStore.getState().moveParty(home);
  // The room is still armed when they come back — a defeat already costs the
  // whole run, and charging for it twice would make a lair unwinnable after
  // one bad fight
  useLocationStore.getState().dropPending();
}
