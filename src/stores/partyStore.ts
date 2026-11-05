import { createStore as create } from 'zustand/vanilla';
import { reportAchievement } from '@/utils/achievementBus';
import { distinctSetPieces } from '@/systems/progression/achievementEquipment';
import { useLocationStore } from "@/stores/locationStore";
import { partySlots } from "@/systems/world/lairs";
import * as Crypto from '@/platform/uuid';

import { BuildingType, CarriedWildFormId, Hero, HeroSkill, HeroStats, HeroClass, HeroTemplateId, EquipSlot, MasteryId } from "@/models/types";
import { calculateStatsForLevel, xpToNextLevel, averagePartyLevel, awardedXp } from "@/systems/progression/leveling";
import { useCityStore } from "@/stores/cityStore";
import { heroTemplates } from "@/data/templates/heroTemplates";
import { STARTER_KIT, masteryIssue } from "@/data/items/itemTemplates";
import { BALANCE } from "@/data/balanceConstants";
import { issuedItem } from "@/systems/economy/itemFactory";
import { heroMaxHp, heroMaxMana } from "@/systems/progression/statCalc";
import { selectGear, useInventoryStore } from "@/stores/inventoryStore";
import {
  availableMasteries,
  canChooseMastery,
  canUnlockNode,
  deriveHeroSkills,
  masteryStatBonus,
  pointsEarnedByLevel,
} from "@/systems/progression/mastery";
import { findMasteryNode } from "@/data/skills/masteryData";
import { recruitLevel } from "@/systems/progression/recruiting";
import { EquippedItems, illegalSlots, isTwoHanded } from "@/systems/progression/equipRules";
import { levelCap } from '@/data/levelCap';
import { templateName } from '@/data/templates/unitText';

export interface LevelUpEvent {
  heroId: string;
  heroName: string;
  heroClass: HeroClass;
  oldLevel: number;
  newLevel: number;
  newSkills: HeroSkill[];
  statGains: HeroStats;
  masteryPointsGained: number;
  /** True on the level-up that first opens the path choice. */
  masteryUnlocked: boolean;
}

interface PartyState {
  heroes: Hero[];
  addHero: (templateId: HeroTemplateId, name?: string) => void;
  removeHero: (heroId: string) => string[];
  gainXp: (heroId: string, amount: number, average?: number) => LevelUpEvent[];
  /** Commits a hero to a mastery path. Irreversible; returns false if refused. */
  chooseMastery: (heroId: string, pathId: MasteryId) => boolean;
  /** Buys a tree node. Returns false if gated, unaffordable or already owned. */
  unlockMasteryNode: (heroId: string, nodeId: string) => boolean;
  /**
   * Hands back every point spent inside the hero's path, keeping the path.
   *
   * The gold is the caller's business — this is the write, not the purchase.
   * Returns false when there is nothing to undo, so a caller cannot charge for
   * a no-op.
   */
  retrainMastery: (heroId: string) => boolean;
  resetXpProgress: () => void;
  setHp: (heroId: string, hp: number) => void;
  /**
   * The Wildshape animal a hero walks into their next fight in, or null for their
   * own shape (PT-16). Written when a fight ends, from `wildshape.formToCarry`.
   */
  setCarriedForm: (heroId: string, form: CarriedWildFormId | null) => void;
  /** Persists mana out of combat. Only the castle gauntlet needs this. */
  setMana: (heroId: string, mana: number) => void;
  healAll: (fraction: number) => void;
  /** Fills every hero's health and mana to the brim. The tavern's bed. */
  restAll: () => void;
  /** Whether anyone is short of health or mana — i.e. whether a rest would do anything. */
  needsRest: () => boolean;
  /**
   * Places `itemId` in `slot`, or clears it when null.
   *
   * Returns every item id that came off — the previous occupant plus anything
   * displaced by the hand rules (a two-hander evicts the off-hand and vice
   * versa). Callers return these to the bag.
   *
   * Legality is *not* checked here; call systems/equipRules.canEquip first. The
   * store stays a dumb writer so the UI can preview a move before committing.
   */
  equipItem: (heroId: string, slot: EquipSlot, itemId: string | null) => string[];
  /** Clears several slots at once. Used when a mastery invalidates worn gear. */
  unequipSlots: (heroId: string, slots: EquipSlot[]) => string[];
  reset: () => void;
}

/**
 * Creates the class starter loadout and returns it already slotted.
 *
 * Items are minted into the inventory (so they can be unequipped, sold and
 * saved like any other), then placed — at the hero's own arrival level, so a
 * recruit who joins at ten is not issued the kit the first hero set out in.
 * Slots come from each template, so adding a piece to STARTER_KIT needs no
 * change here.
 */
function grantStarterKit(heroClass: HeroClass, level: number): Partial<Record<EquipSlot, string>> {
  const equipment: Partial<Record<EquipSlot, string>> = {};

  for (const templateId of STARTER_KIT[heroClass] ?? []) {
    const item = issuedItem(templateId, level);
    if (!item) continue;
    const id = useInventoryStore.getState().addItem(item);
    // 'ring' is the only ambiguous slot and no starter kit uses one
    const slot = item.slot === 'ring' ? 'ring1' : (item.slot as EquipSlot);
    equipment[slot] = id;
  }

  return equipment;
}

/**
 * Mints what this path hands out — its weapons (`masteryIssue`) — and returns
 * the slots to fill.
 *
 * A hand already holding something the path may carry keeps it, whatever its
 * rarity, and nothing is minted for it; only a hand that is empty or holds what
 * the path forbids is filled (playtest 2026-10-23, PT-05). A dual-wielder's second
 * weapon still replaces a shield, quiver or focus it may legally hold, since its
 * off-hand is a weapon; an off-hand issue is skipped beside a kept two-hander,
 * which has no room for one.
 *
 * Items are added to the inventory store as normal loot; the returned map just
 * points the hero's slots at them. Anything previously worn stays in the bag,
 * because equipment is a map of ids and unequipping is only ever a matter of
 * forgetting one.
 */
function grantMasteryIssue(hero: Hero, pathId: MasteryId, level: number): {
  equipment: Partial<Record<EquipSlot, string>>;
  displaced: string[];
  /** Slots the issue empties: a kept off-hand beside a newly issued two-hander. */
  clears: EquipSlot[];
} {
  const equipment: Partial<Record<EquipSlot, string>> = {};
  const clears: EquipSlot[] = [];
  const worn = wornItems(hero);
  const illegal = new Set(illegalSlots({ ...hero, masteryPath: pathId }, worn).map((entry) => entry.slot));
  const keeps = (slot: EquipSlot) => !!worn[slot] && !illegal.has(slot);

  for (const [slot, templateId] of Object.entries(masteryIssue(pathId)) as [EquipSlot, string][]) {
    const item = issuedItem(templateId, level);
    if (!item) continue;
    const secondWeapon = slot === 'offHand' && item.slot === 'mainHand' && worn.offHand?.slot !== 'mainHand';
    if (keeps(slot) && !secondWeapon) continue;
    if (slot === 'offHand' && keeps('mainHand') && isTwoHanded(worn.mainHand!)) continue;
    // `addItem` mints its own id and returns it. Storing the pre-add id would
    // point the hero's slots at something that is not in the bag — empty hands
    // and orphaned items nobody can reach.
    equipment[slot] = useInventoryStore.getState().addItem(item);
    if (slot === 'mainHand' && isTwoHanded(item) && worn.offHand && !equipment.offHand) clears.push('offHand');
  }

  return { equipment, displaced: [], clears };
}

/**
 * Everything a hero is wearing, resolved out of the bag.
 *
 * `hero.equipment` is a map of *ids*; `equipRules` reasons about items. One
 * conversion, here, rather than at each of the two places that need it.
 */
function wornItems(hero: Hero): EquippedItems {
  const bag = useInventoryStore.getState();
  const worn: EquippedItems = {};
  for (const [slot, id] of Object.entries(hero.equipment) as [EquipSlot, string][]) {
    const item = bag.getItem(id);
    if (item) worn[slot] = item;
  }
  return worn;
}

/**
 * Strips anything the freshly-chosen path may no longer hold, back into the bag.
 *
 * The third option, and the only honest one. Leaving an off-path bow equipped
 * makes the lock a lie — the screen refuses to *re-equip* the weapon the hero is
 * visibly holding — and destroying it is theft of something the player earned
 * four levels before the rule existed. Unequipping costs nothing: `equipment` is
 * a map of ids and the items themselves never left `inventoryStore`, so this is
 * a matter of forgetting one. It sells, it salvages, and it goes straight back
 * on if the hero it belongs to ever recruits.
 *
 * Run *after* `grantMasteryIssue`, which is what stops it leaving anyone
 * barehanded: the path fills both hands and its armour weight with its own iron
 * first, and only what survives that is swept.
 */
/**
 * How much max HP the tree gained between two states of the same hero.
 *
 * Asked as a difference rather than read off the node, because a node's
 * `statBonus.maxHp` is its *level-2* value and buying any single level is worth
 * a fraction of it — and `masteryStatBonus` is where that arithmetic, including
 * its rounding, already lives. Reproducing it here is how the two would drift.
 */
function masteryMaxHpDelta(
  before: Pick<Hero, 'masteryPath' | 'masteryNodes'>,
  after: Pick<Hero, 'masteryPath' | 'masteryNodes'>,
): number {
  return (masteryStatBonus(after).maxHp ?? 0) - (masteryStatBonus(before).maxHp ?? 0);
}

function stripIllegalGear(heroId: string, get: () => PartyState): EquipSlot[] {
  const hero = get().heroes.find((h) => h.id === heroId);
  if (!hero) return [];
  const slots = illegalSlots(hero, wornItems(hero)).map((entry) => entry.slot);
  if (slots.length > 0) get().unequipSlots(heroId, slots);
  return slots;
}

export const usePartyStore = create<PartyState>((set, get) => ({
  heroes: [],

  addHero: (templateId: HeroTemplateId, name?: string) => {
    const template = heroTemplates.find((t) => t.id === templateId);
    if (!template) return;
    // The cap is earned, not fixed — see `systems/lairs.ts`. Read through the
    // location store rather than passed in, so no caller can recruit past it by
    // forgetting to check.
    if (get().heroes.length >= partySlots(useLocationStore.getState().spentTriggers)) return;
    if (get().heroes.some((h) => h.templateId === templateId)) return;

    // Where in the party they are arriving decides what they arrive as. The
    // first hero reads level 1; later ones join partway up the curve, because
    // the fights waiting outside are scaled to the party they are joining and
    // not to the save file's first hour. See `systems/recruiting.recruitLevel`.
    const level = recruitLevel(get().heroes.length);
    const baseStats = calculateStatsForLevel(template, level);
    const seed = { level, masteryPath: null, masteryNodes: {} as Record<string, number> };

    const hero: Hero = {
      id: Crypto.randomUUID(),
      templateId,
      name: name ?? templateName(template.id),
      heroClass: template.heroClass,
      level,
      xp: 0,
      baseStats,
      // Filled in below, once the hero exists to be measured: the starter kit is
      // already in the bag, so their real ceiling includes it
      currentHp: baseStats.maxHp,
      currentMana: baseStats.maxMana,
      skills: deriveHeroSkills(seed, template.skills),
      equipment: grantStarterKit(template.heroClass, level),
      masteryPath: null,
      // Paid the same way `gainXp` pays it, so a hero who joins at 10 arrives
      // with the points those ten levels are worth and a path still to pick —
      // rather than a tree they can look at and not afford a single node of.
      masteryPoints: pointsEarnedByLevel(level),
      masteryNodes: {},
    };
    hero.currentHp = heroMaxHp(hero);
    hero.currentMana = heroMaxMana(hero);
    set((s) => ({ heroes: [...s.heroes, hero] }));
    reportAchievement({ kind: 'recruit', heroClass: hero.heroClass, size: get().heroes.length });
  },

  removeHero: (heroId) => {
    const hero = get().heroes.find((h) => h.id === heroId);
    const returnedItems = hero ? Object.values(hero.equipment) : [];
    set((s) => ({ heroes: s.heroes.filter((h) => h.id !== heroId) }));
    return returnedItems;
  },

  gainXp: (heroId, amount, average = averagePartyLevel(get().heroes)) => {
    const events: LevelUpEvent[] = [];
    // The Library's cut is taken here because here is where XP is granted —
    // every source in the game (a won fight, a claimed quest) already funnels
    // through this one function, so nothing else has to know the building
    // exists. Read outside the updater: `set` may re-run, and a bonus applied
    // twice would be a bonus that grows every time React felt like it.
    const granted = awardedXp(
      amount,
      get().heroes.find(h => h.id === heroId)?.level ?? average,
      average,
      useCityStore.getState().getBuildingLevel(BuildingType.Library),
    );
    set((s) => ({
      heroes: s.heroes.map((h) => {
        if (h.id !== heroId) return h;
        const template = heroTemplates.find((t) => t.id === h.templateId);
        if (!template) return h;

        const oldLevel = h.level;
        let xp = h.xp + granted;
        let level = h.level;

        while (xp >= xpToNextLevel(level) && level < levelCap()) {
          xp -= xpToNextLevel(level);
          level++;
        }
        if (level >= levelCap()) xp = 0;

        const baseStats = calculateStatsForLevel(template, level);
        const skills = deriveHeroSkills({ ...h, level }, template.skills);

        // One point per level past the unlock level. Computed from the level
        // rather than incremented, so a level-up that fires twice (or a save
        // loaded mid-flight) cannot hand out the same point again.
        // No path argument: a path's own grant is a flat term and would cancel
        // itself out of this delta anyway, and reading it here would hand the
        // bonus out a second time to a Druid who levelled after choosing.
        const earned = pointsEarnedByLevel(level) - pointsEarnedByLevel(oldLevel);
        const masteryPoints = h.masteryPoints + Math.max(0, earned);

        if (level > oldLevel) {
          const oldSkillIds = new Set(
            deriveHeroSkills({ ...h, level: oldLevel }, template.skills).map((sk) => sk.id)
          );
          const newSkills = skills.filter((sk) => !oldSkillIds.has(sk.id));
          events.push({
            heroId: h.id,
            heroName: h.name,
            heroClass: h.heroClass,
            oldLevel,
            newLevel: level,
            newSkills,
            statGains: {
              maxHp: baseStats.maxHp - h.baseStats.maxHp,
              attack: baseStats.attack - h.baseStats.attack,
              defense: baseStats.defense - h.baseStats.defense,
              magic: baseStats.magic - h.baseStats.magic,
              speed: baseStats.speed - h.baseStats.speed,
              moveRange: baseStats.moveRange - h.baseStats.moveRange,
              maxMana: baseStats.maxMana - h.baseStats.maxMana,
            },
            masteryPointsGained: Math.max(0, earned),
            masteryUnlocked: h.masteryPath === null && oldLevel < BALANCE.MASTERY_UNLOCK_LEVEL
              && level >= BALANCE.MASTERY_UNLOCK_LEVEL,
          });
        }

        const grown = { ...h, level, xp, baseStats, skills, masteryPoints };
        // Measured on the effective sheet at both ends, not on `baseStats`: the
        // level-up hands over exactly the health the ceiling gained, and the cap
        // is the ceiling the hero actually fights with. See `heroMaxHp`.
        const maxHp = heroMaxHp(grown);
        const maxMana = heroMaxMana(grown);
        return {
          ...grown,
          currentHp: Math.min(h.currentHp + (maxHp - heroMaxHp(h)), maxHp),
          currentMana: Math.min(h.currentMana + (maxMana - heroMaxMana(h)), maxMana),
        };
      }),
    }));
    return events;
  },

  /**
   * Commits a hero to a path. Irreversible by design — the choice is the point.
   *
   * Grants the signature skill immediately by re-deriving the skill list, and
   * back-pays any points the hero earned before choosing, so a player who puts
   * the decision off is not punished for it. A path with no signature pays its
   * grant in points instead — see `pointsEarnedByLevel`.
   */
  chooseMastery: (heroId, pathId) => {
    let chosen = false;

    // Built before the `set` because creating items has to hit the inventory
    // store, and doing that inside another store's updater is how you get a
    // write that only half happens
    const hero = get().heroes.find((h) => h.id === heroId);
    const eligible = hero && canChooseMastery(hero) && availableMasteries(hero).includes(pathId);
    const { equipment: granted, displaced, clears } = eligible
      ? grantMasteryIssue(hero, pathId, hero.level)
      : { equipment: {}, displaced: [], clears: [] as EquipSlot[] };

    // What the path replaced goes back to the bag rather than vanishing — a
    // Hunter's starting bow is still worth selling
    if (hero && eligible) {
      for (const slot of Object.keys(granted) as EquipSlot[]) {
        const worn = hero.equipment[slot];
        if (worn) displaced.push(worn);
      }
    }

    set((s) => ({
      heroes: s.heroes.map((h) => {
        if (h.id !== heroId) return h;
        if (!canChooseMastery(h)) return h;
        if (!availableMasteries(h).includes(pathId)) return h;

        const template = heroTemplates.find((t) => t.id === h.templateId);
        if (!template) return h;

        chosen = true;
        const withPath = { ...h, masteryPath: pathId, masteryNodes: {} as Record<string, number> };
        return {
          ...withPath,
          // The path is passed here and nowhere else: this is the one moment a
          // hero acquires one, so it is the one moment its grant can be paid.
          masteryPoints: Math.max(h.masteryPoints, pointsEarnedByLevel(h.level, pathId)),
          skills: deriveHeroSkills(withPath, template.skills),
          equipment: Object.fromEntries(
            Object.entries({ ...withPath.equipment, ...granted }).filter(([slot]) => !clears.includes(slot as EquipSlot)),
          ),
        };
      }),
    }));
    // Displaced gear is already in the bag: `equipment` is a map of ids and the
    // items themselves never left `inventoryStore`
    void displaced;

    // Committing to a path is the one event that can invalidate gear
    // retroactively — see `stripIllegalGear`. After the grant, so the hands the
    // path just filled are what gets checked rather than the ones it replaced.
    if (chosen) {
      stripIllegalGear(heroId, get);
      reportAchievement({ kind: 'mastery', action: 'path' });
    }

    return chosen;
  },

  /**
   * Un-spends a hero's tree without touching which tree it is.
   *
   * The path stays. That distinction is the whole feature: committing to a
   * discipline is still the one permanent thing a hero does — it decides their
   * capstones, their re-tint and, since the weapon locks, what they may hold —
   * while the fifteen picks *inside* it are now recoverable for gold. A player
   * who misread a node at level six should not be living with it at twenty.
   *
   * Points are recomputed from the level rather than counted back up from the
   * nodes being cleared, so a tree that has since been re-costed cannot refund
   * the wrong number, and a hero who levelled past a cost change is made whole.
   * Skills are re-derived for the same reason `unlockMasteryNode` derives them:
   * a node-granted skill has to leave the bar when the node does.
   */
  retrainMastery: (heroId) => {
    let done = false;
    set((s) => ({
      heroes: s.heroes.map((h) => {
        if (h.id !== heroId) return h;
        // Nothing to buy back. Refusing here rather than in the shop keeps the
        // store the authority on whether the write is meaningful.
        if (!h.masteryPath || Object.keys(h.masteryNodes).length === 0) return h;

        const template = heroTemplates.find((t) => t.id === h.templateId);
        if (!template) return h;

        done = true;
        const cleared = { ...h, masteryNodes: {} as Record<string, number> };
        return {
          ...cleared,
          masteryPoints: pointsEarnedByLevel(h.level, h.masteryPath),
          skills: deriveHeroSkills(cleared, template.skills),
        };
      }),
    }));
    return done;
  },

  unlockMasteryNode: (heroId, nodeId) => {
    let unlocked = false;
    set((s) => ({
      heroes: s.heroes.map((h) => {
        if (h.id !== heroId) return h;
        const check = canUnlockNode(h, nodeId);
        if (!check.ok) return h;

        const node = findMasteryNode(nodeId)!.node;
        const template = heroTemplates.find((t) => t.id === h.templateId);
        if (!template) return h;

        unlocked = true;
        const withNode = {
          ...h,
          masteryNodes: { ...h.masteryNodes, [nodeId]: (h.masteryNodes[nodeId] ?? 0) + 1 },
        };
        const baseStats = calculateStatsForLevel(template, h.level);

        return {
          ...withNode,
          masteryPoints: h.masteryPoints - node.cost,
          skills: deriveHeroSkills(withNode, template.skills),
          baseStats,
          // A node granting +maxHp should hand over the health it promised
          // rather than leaving the bar short of a ceiling that just moved.
          // Measured as the difference the *level just bought* makes, not the
          // node's whole bonus — buying the third level of Iron Frame is worth
          // a quarter of it, and paying out the full 30 each time would be a
          // free heal per point spent.
          currentHp: Math.min(
            h.currentHp + masteryMaxHpDelta(h, withNode),
            heroMaxHp({ ...withNode, baseStats }),
          ),
        };
      }),
    }));
    if (unlocked) {
      const found = findMasteryNode(nodeId)!;
      reportAchievement({ kind: 'mastery', action: found.node.tier === 3 && !found.node.sideTree ? 'capstone' : 'node' });
    }
    return unlocked;
  },

  resetXpProgress: () => {
    set((s) => ({
      heroes: s.heroes.map((h) => ({ ...h, xp: 0 })),
    }));
  },

  setCarriedForm: (heroId, form) => {
    set((s) => ({
      heroes: s.heroes.map((h) => (h.id === heroId && (h.wildForm ?? null) !== form ? { ...h, wildForm: form } : h)),
    }));
  },

  setHp: (heroId, hp) => {
    set((s) => ({
      heroes: s.heroes.map((h) =>
        h.id === heroId
          ? { ...h, currentHp: Math.max(0, Math.min(hp, heroMaxHp(h))) }
          : h,
      ),
    }));
  },

  /**
   * Writes a hero's mana back out of combat.
   *
   * Only the castle gauntlet calls this. Everywhere else a fight ends at the
   * world map, where the dawn heal exists and mana simply resets — so nothing
   * ever needed to persist it. Between castle stages there is no map and no
   * dawn, and mana that refilled itself would remove the resource pressure the
   * gauntlet is built on.
   */
  setMana: (heroId, mana) => {
    set((s) => ({
      heroes: s.heroes.map((h) =>
        h.id === heroId
          ? { ...h, currentMana: Math.max(0, Math.min(mana, heroMaxMana(h))) }
          : h,
      ),
    }));
  },

  healAll: (fraction) => {
    set((s) => ({
      heroes: s.heroes.map((h) => {
        // A night's sleep does not raise the dead. The fallen are revived at a
        // magic well or by a rest at the city's Tavern, and a dawn that did it for free would
        // delete the reason to walk to either.
        if (h.currentHp <= 0) return h;
        // The dawn heal is a fraction of the bar being healed, so both terms are
        // the effective ceiling — a fraction of `baseStats` would mend less the
        // better geared the hero is, and stop short of full besides.
        const maxHp = heroMaxHp(h);
        return { ...h, currentHp: Math.min(maxHp, Math.ceil(h.currentHp + maxHp * fraction)) };
      }),
    }));
  },

  /**
   * A night at the tavern: everyone wakes up whole.
   *
   * Both ceilings are the *effective* ones. `baseStats.maxHp` is the body and
   * `heroMaxHp` is the bar — a hero in +HP gear has a ceiling `baseStats` has
   * never heard of, and filling to the smaller one would sell the player a full
   * night's rest that stops short by exactly the gear's worth. That is the bug
   * every other ceiling in this store once had; `heroHp.test.ts` pins it.
   */
  restAll: () => {
    set((s) => ({
      heroes: s.heroes.map((h) => ({
        ...h,
        currentHp: heroMaxHp(h),
        currentMana: heroMaxMana(h),
      })),
    }));
  },

  needsRest: () =>
    get().heroes.some((h) => h.currentHp < heroMaxHp(h) || h.currentMana < heroMaxMana(h)),

  equipItem: (heroId, slot, itemId) => {
    const removed: string[] = [];
    set((s) => ({
      heroes: s.heroes.map((h) => {
        if (h.id !== heroId) return h;

        const equipment = { ...h.equipment };
        if (equipment[slot]) removed.push(equipment[slot]!);

        if (itemId === null) {
          delete equipment[slot];
          return { ...h, equipment };
        }

        // The same item can't occupy two slots — moving a ring from ring1 to
        // ring2 must vacate ring1 rather than duplicate it
        for (const [other, id] of Object.entries(equipment) as [EquipSlot, string][]) {
          if (other !== slot && id === itemId) delete equipment[other];
        }

        equipment[slot] = itemId;
        return { ...h, equipment };
      }),
    }));
    const equippedHero = get().heroes.find(h => h.id === heroId);
    if (equippedHero && itemId !== null) {
      reportAchievement({ kind: 'equipment', pieces: distinctSetPieces(equippedHero, selectGear(useInventoryStore.getState())) });
    }
    return removed;
  },

  unequipSlots: (heroId, slots) => {
    const removed: string[] = [];
    set((s) => ({
      heroes: s.heroes.map((h) => {
        if (h.id !== heroId) return h;
        const equipment = { ...h.equipment };
        for (const slot of slots) {
          if (equipment[slot]) {
            removed.push(equipment[slot]!);
            delete equipment[slot];
          }
        }
        return { ...h, equipment };
      }),
    }));
    return removed;
  },

  reset: () => {
    set({ heroes: [] });
  },
}));
