import { EQUIP_SLOTS, EquipSlot, HeroClass, HeroTemplateId, MasteryId, Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { findTemplate } from '@/systems/economy/itemFactory';
import { anchorItemLevel } from '@/data/items/itemLevel';
import { SimHeroConfig } from '@/systems/sim/simHarness';
import { EncounterId } from './encounters';
import { RolledHero, RolledParty } from './partyRoll';

/**
 * What one fight stores: facts, not a score, so the score can be recomputed with
 * other weights without running anything again (the private project notes,
 * "One fight's record"). Short keys and ids instead of names, because a run is
 * thousands of these written as newline-delimited JSON.
 */

export type Outcome = 'victory' | 'defeat' | 'draw';

/** One hero at the end of a fight. */
export interface HeroFact {
  /** 1 when standing. */
  a: 0 | 1;
  /** Health left as a share of the maximum, 0–1. */
  hp: number;
}

/** One castle stage. */
export interface StageFact {
  /** Stage index in the chain: 0 Gate, 1 Inner Yard, 2 Sanctum, 3 Aethelred. */
  n: number;
  o: Outcome;
  /** Individual unit turns, every side. */
  t: number;
  /** Boss turns, or enemy turns in a garrison stage. */
  bt: number;
  /** Boss health dealt as a share of its maximum (garrison: the share of enemy health dealt). */
  d: number;
  h: HeroFact[];
}

/** A rolled hero as stored: enough to rebuild and to aggregate by. */
export interface HeroRecord {
  /** Class. */
  c: HeroClass;
  l: number;
  /** Mastery path, or '' before level 5. */
  p: MasteryId | '';
  /** Nodes in the order they were bought (an id repeated is a second level). */
  n: string[];
  /** Capstone node, or ''. */
  cap: string;
  /** Slot → [template id, item level]. */
  g: Partial<Record<EquipSlot, [string, number]>>;
}

export interface PartyRecord {
  /** Level sum. */
  ls: number;
  /** The rarity budget rolled: legendary, epic, rare. */
  bud: [number, number, number];
  h: HeroRecord[];
}

export interface FightRecord {
  seed: number;
  enc: EncounterId;
  /** 1 when the party dodged warnings, 0 for the plain AI party. */
  dg: 0 | 1;
  o: Outcome;
  /** Individual unit turns over the whole fight, every side. */
  t: number;
  /** Boss turns (castle: enemy turns over every stage). */
  bt: number;
  /** Boss health dealt as a share of its maximum (castle: Aethelred's, 0 if never reached). */
  d: number;
  /** Heroes at the end (castle: after the last stage fought), in party order. */
  h: HeroFact[];
  party: PartyRecord;
  /** Castle only: the facts per stage fought, in order. */
  st?: StageFact[];
  /**
   * How each warned move was answered (`answerTally`), per move the five counts in `ANSWER_KINDS` order:
   * stepped off, took it, blocked, unharmed, broken. Absent when the enemy warned of nothing; for the
   * castle it adds every stage fought.
   */
  an?: Record<string, number[]>;
  /**
   * PvP only: the other party. A PvP fight is two parties of equal standing, so it is stored twice,
   * once from each, and each record carries the other so either replays alone (`replayRecord`).
   */
  vs?: PartyRecord;
  /** PvP only: 1 on the second party's record (the one rolled by `pvpRival`), absent on the first's. */
  sd?: 1;
  /** Troll only: the heaps of his rubble standing as each Boundary Smash was cast, in order (the fort left to brace on). */
  hs?: number[];
  /** Troll only: heroes braced as each Smash landed, summed over the fight: against his rubble, against the wall. */
  hb?: [number, number];
  /** Troll only: Farthest Prey landings that came down on his rubble (he was Exposed for the pair's next round), and all of them. */
  hx?: [number, number];
  /**
   * Dragon only: his carried Furnace Heart over the fight (`dragonMeasure.HeartFacts`) — thrown, passed, broken,
   * burst on time, burst at once on a fallen carrier, the health those early bursts took and the heroes they
   * felled — then the Skyfires he cast over a burning Cinder Rift and with none.
   */
  dh?: [number, number, number, number, number, number, number, number, number];
}

/** The level a worn piece sits at, whichever field carries it. */
function itemLevelOf(hero: SimHeroConfig, slot: EquipSlot, templateId: string): number {
  const template = findTemplate(templateId);
  if (!template) return 1;
  if (template.rarity === Rarity.Legendary) return BALANCE.MAX_LEVEL + (hero.upgrades?.[slot] ?? 0);
  return hero.itemLevels?.[slot] ?? anchorItemLevel(template.rarity);
}

export function partyRecord(party: RolledParty): PartyRecord {
  return {
    ls: party.levelSum,
    bud: [party.budget.legendary, party.budget.epic, party.budget.rare],
    h: party.heroes.map((hero) => {
      const g: HeroRecord['g'] = {};
      for (const slot of EQUIP_SLOTS) {
        const id = hero.equipment[slot];
        if (id) g[slot] = [id, itemLevelOf(hero, slot, id)];
      }
      return { c: hero.heroClass, l: hero.level, p: hero.masteryPath ?? '', n: hero.masteryNodes, cap: hero.capstone ?? '', g };
    }),
  };
}

/** The hero a record describes, ready for `buildSimHero` — so a fight can be replayed from its record. */
export function heroConfigFromRecord(record: HeroRecord): RolledHero {
  const equipment: SimHeroConfig['equipment'] = {};
  const upgrades: NonNullable<SimHeroConfig['upgrades']> = {};
  const itemLevels: NonNullable<SimHeroConfig['itemLevels']> = {};
  for (const slot of EQUIP_SLOTS) {
    const piece = record.g[slot];
    if (!piece) continue;
    equipment[slot] = piece[0];
    if (findTemplate(piece[0])?.rarity === Rarity.Legendary) upgrades[slot] = piece[1] - BALANCE.MAX_LEVEL;
    else itemLevels[slot] = piece[1];
  }
  return {
    templateId: heroTemplates.find((t) => t.heroClass === record.c)!.id as HeroTemplateId,
    heroClass: record.c,
    level: record.l,
    masteryPath: record.p === '' ? null : record.p,
    masteryNodes: record.n,
    capstone: record.cap === '' ? null : record.cap,
    equipment,
    upgrades,
    itemLevels,
  };
}

export const partyFromRecord = (record: PartyRecord): RolledHero[] => record.h.map(heroConfigFromRecord);
