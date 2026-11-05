/**
 * Who the tavern can offer, and how many of them the party may keep.
 *
 * The offer is **derived** — every class the party is not fielding — rather
 * than stored, so nothing can pick the order on the player's behalf. What a
 * quest hands over is an *opening*: the right to hold one more hero, of
 * whichever class the player walks in and picks.
 */

import { heroTemplatesOpenTo } from '@/data/templates/heroTemplates';
import { BALANCE } from '@/data/balanceConstants';
import { Hero, HeroTemplate, HeroTemplateId } from '@/models/types';
import { ownsExpansion } from '@/stores/entitlementStore';
import { levelCap } from '@/data/levelCap';

/** What this player is offered at hero select and the Tavern: the Monk only with Jadeveil owned. */
export function offeredHeroTemplates(): HeroTemplate[] {
  return heroTemplatesOpenTo(ownsExpansion);
}

/** Every offered class the party is not already fielding, in template order. */
export function recruitableClasses(
  heroes: Hero[],
  offered: readonly HeroTemplate[] = offeredHeroTemplates(),
): HeroTemplateId[] {
  const held = new Set(heroes.map((h) => h.templateId));
  return offered.map((t) => t.id).filter((id) => !held.has(id));
}

/**
 * How many heroes the party is entitled to hold, ignoring room.
 *
 * The one you started with, plus one per recruit earned. Counted against the
 * roster rather than spent on recruiting, so dismissing a hero hands the
 * entitlement straight back — a sacking that permanently cost a roster place
 * would be a trap with no warning on it.
 */
export function recruitCapacity(recruitsEarned: number): number {
  return 1 + recruitsEarned;
}

/**
 * Whether one more hero can join right now.
 *
 * Two independent gates, and they are different questions: quests hand out
 * *who* (an opening), lairs hand out *room* (`partySlots`). Taking the minimum
 * is what keeps them from collapsing into one counter.
 */
export function hasRecruitRoom(
  heroes: Hero[],
  recruitsEarned: number,
  partySlots: number,
): boolean {
  return heroes.length < Math.min(recruitCapacity(recruitsEarned), partySlots);
}

/**
 * Whether the "a new hero can join" notice is due (PT-08, playtest 2026-10-22).
 *
 * A third or fourth hero was easy to miss: the opening arrives at a quest
 * hand-in or a lair's fall, far from the tavern, and the only signs were a mark
 * over the tavern inside the city and a one-shot tip. So the moment both gates
 * line up the player is told, once — **once per opening**, keyed by the party
 * size the recruit would make (`shownFor`, saved): a dismissed hero handing
 * their seat back does not repeat it, the next opening after a recruit does.
 * Never when nobody is left to offer, since then the opening is gold.
 */
export function recruitNoticeDue(
  heroes: Hero[],
  recruitsEarned: number,
  partySlots: number,
  shownFor: number,
  offered: readonly HeroTemplate[] = offeredHeroTemplates(),
): boolean {
  return hasRecruitRoom(heroes, recruitsEarned, partySlots)
    && openingIsUseful(heroes, offered)
    && heroes.length + 1 > shownFor;
}

/** Whether an earned opening would do anything, or should convert to gold. */
export function openingIsUseful(
  heroes: Hero[],
  offered: readonly HeroTemplate[] = offeredHeroTemplates(),
): boolean {
  return recruitableClasses(heroes, offered).length > 0;
}

/**
 * What level someone joining a party of `held` arrives at.
 *
 * A recruit is not a new save. The party they are joining has been fighting
 * since the first hour, and the ground the game will next put in front of them
 * is scaled to that party — so a level-1 fourth hero is not a weak hero, they
 * are a body that dies on the first turn of every fight they are taken to.
 *
 * The table is indexed by how many heroes are *already* held, so the starting
 * hero (an empty party) reads the first entry and joins at 1. Past the end of
 * the table the last entry repeats, which is what keeps a longer
 * `MAX_PARTY_SIZE` from silently reintroducing the level-1 case.
 */
export function recruitLevel(held: number): number {
  const table = BALANCE.RECRUIT_LEVELS;
  const level = table[Math.min(Math.max(0, held), table.length - 1)];
  return Math.min(level, levelCap());
}
