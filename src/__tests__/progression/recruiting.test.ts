import { heroTemplates } from '@/data/templates/heroTemplates';
import { Hero, HeroTemplateId } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { QUESTS } from '@/quests/questData';
import { LAIR_SPECS, getLocation } from '@/locations';
import { triggerKey } from '@/locations/types';
import { partySlots } from '@/systems/world/lairs';
import {
  hasRecruitRoom,
  openingIsUseful,
  recruitCapacity,
  recruitLevel,
  recruitableClasses,
  recruitNoticeDue,
} from '@/systems/progression/recruiting';
import { resetEntitlementsForTest } from '@/stores/entitlementStore';

/**
 * Who joins the party is a choice, and it used to not be one.
 *
 * Two payout paths both resolved `unlocksHero` to a specific class on the
 * player's behalf — one by quest index against the classes they did not start
 * as, one by first-missing-template — and both put the Warrior first in three
 * saves out of four. What a quest hands over now is an opening; the tavern is
 * where it becomes a person.
 */

let n = 0;
const hero = (templateId: HeroTemplateId): Hero =>
  ({ id: `h${n++}`, templateId, level: 1 } as Hero);

// Every class, the Monk included — for a player who owns Jadeveil (`monkAccess.test.ts` has the unowned side)
const ALL = heroTemplates.map((t) => t.id);
beforeEach(() => resetEntitlementsForTest(['jadeveil']));

describe('who the tavern can offer', () => {
  it('offers every class the party is not already fielding', () => {
    expect(recruitableClasses([])).toEqual(ALL);
    expect(recruitableClasses([hero('warrior')])).toEqual(
      ALL.filter((id) => id !== 'warrior'),
    );
  });

  it('offers nothing once every class has been recruited', () => {
    expect(recruitableClasses(ALL.map(hero))).toEqual([]);
  });

  /**
   * The bug, stated as a test: the offer must not depend on who you started as
   * or on the order the quests were finished in. Every starter sees the
   * same others, and picks among them.
   */
  it('offers the same classes whichever one you started as', () => {
    const offers = ALL.map((starter) => recruitableClasses([hero(starter)]));
    for (const [i, offer] of offers.entries()) {
      expect(offer.sort()).toEqual(ALL.filter((id) => id !== ALL[i]).sort());
    }
  });
});

/**
 * PT-08 (playtest 2026-10-22): a third or fourth hero was easy to miss. The
 * notice is said once per opening — keyed by the party size the recruit
 * would make — and never when there is nobody left to offer.
 */
describe('the "a new hero can join" notice', () => {
  const offered = heroTemplates;
  it('is due the moment both gates open, and not before', () => {
    const party = [hero('warrior')];
    expect(recruitNoticeDue(party, 0, 5, 0, offered)).toBe(false); // no opening yet
    expect(recruitNoticeDue(party, 1, 1, 0, offered)).toBe(false); // opening, but no slot
    expect(recruitNoticeDue(party, 1, 2, 0, offered)).toBe(true);
  });

  it('is said once for an opening', () => {
    const party = [hero('warrior')];
    // Dismissed for a party of two: not again for the same opening.
    expect(recruitNoticeDue(party, 1, 2, 2, offered)).toBe(false);
  });

  it('is said again for the next opening, after the recruit is taken', () => {
    const party = [hero('warrior'), hero('mage')];
    expect(recruitNoticeDue(party, 2, 3, 2, offered)).toBe(true);
    expect(recruitNoticeDue(party, 2, 3, 3, offered)).toBe(false);
  });

  it('is not said again when a dismissed hero hands their seat back', () => {
    const party = [hero('warrior')];
    // Shown for the second seat, recruited, then dismissed: room again, old news.
    expect(recruitNoticeDue(party, 1, 2, 2, offered)).toBe(false);
  });

  it('is not said when nobody is left to offer', () => {
    const party = [hero('warrior')];
    expect(recruitNoticeDue(party, 1, 2, 0, offered.filter((t) => t.id === 'warrior'))).toBe(false);
  });
});

describe('how many the party may hold', () => {
  it('starts at one and grows by one per recruit earned', () => {
    expect(recruitCapacity(0)).toBe(1);
    expect(recruitCapacity(3)).toBe(4);
  });

  /**
   * Two gates that are different questions. Quests hand out *who*, lairs hand
   * out *room* — so a player with three openings and one lair beaten still
   * cannot field four, and neither can a player with five slots and no quests
   * finished. Collapsing them into one counter would lose one of the two
   * progression curves entirely.
   */
  it('needs both an opening and a slot', () => {
    const party = [hero('warrior')];
    expect(hasRecruitRoom(party, 0, 5)).toBe(false); // room, but nobody owes you
    expect(hasRecruitRoom(party, 3, 1)).toBe(false); // owed, but no room
    expect(hasRecruitRoom(party, 1, 2)).toBe(true);
  });

  /**
   * Dismissing gives the place back. The opening is counted against the roster
   * rather than spent on recruiting, so sacking someone cannot quietly cost a
   * roster place forever — which would be a trap with no warning on it.
   */
  it('frees the place again when a hero is dismissed', () => {
    const full = [hero('warrior'), hero('mage')];
    expect(hasRecruitRoom(full, 1, 5)).toBe(false);
    expect(hasRecruitRoom(full.slice(0, 1), 1, 5)).toBe(true);
  });
});

/**
 * What a recruit arrives *as*.
 *
 * Everyone used to join at level 1 whenever they joined, so the fourth hero —
 * who by the pacing of the openings arrives latest — walked into band-3 ground
 * with band-0 stats and was one-shot by everything on it. A slot the player
 * could not actually field is not a reward.
 */
describe('the level a recruit joins at', () => {
  it('starts the first hero at 1', () => {
    expect(recruitLevel(0)).toBe(1);
  });

  it('brings later recruits in partway up the curve', () => {
    expect(recruitLevel(1)).toBe(3);
    expect(recruitLevel(2)).toBe(5);
    expect(recruitLevel(3)).toBe(10);
  });

  /**
   * The table's last entry covers every slot past its end, so raising
   * `MAX_PARTY_SIZE` cannot quietly reintroduce the level-1 case for a fifth or
   * sixth hero — which is exactly the party size where it would hurt most.
   */
  it('repeats its last entry past the end of the table', () => {
    const last = BALANCE.RECRUIT_LEVELS[BALANCE.RECRUIT_LEVELS.length - 1];
    for (let held = BALANCE.RECRUIT_LEVELS.length; held < 12; held++) {
      expect(recruitLevel(held)).toBe(last);
    }
  });

  /** A floor, never a ceiling breach: nobody may join above the cap. */
  it('never exceeds the level cap', () => {
    const over = Array.from({ length: 12 }, (_, i) => recruitLevel(i))
      .filter((l) => l > BALANCE.MAX_LEVEL);
    expect(over).toEqual([]);
  });

  /**
   * Monotonic, because the table is read as "how far behind is this hero
   * allowed to start". A dip would mean a later, harder-won recruit arriving
   * weaker than the one before them.
   */
  it('never goes backwards', () => {
    const drops = Array.from({ length: 11 }, (_, i) => i)
      .filter((i) => recruitLevel(i + 1) < recruitLevel(i));
    expect(drops).toEqual([]);
  });
});

describe('an opening that could never be spent', () => {
  it('is useful while any class is missing', () => {
    expect(openingIsUseful([hero('warrior')])).toBe(true);
  });

  // Converts to gold at the payout site rather than vanishing: a reward that
  // silently pays nothing is worse than one that pays something else
  it('is useless once every class is in the party', () => {
    expect(openingIsUseful(ALL.map(hero))).toBe(false);
  });
});

// ─── The two counters ─────────────────────────────────────────────────────────

/**
 * "How many heroes may I have" is asked of two different things — `partySlots`
 * (room, earned from lairs) and `recruitCapacity` (openings, earned from
 * quests) — and `hasRecruitRoom` takes the smaller. That is fine as a design
 * only while the two can actually meet.
 *
 * They could not. `MAX_PARTY_SIZE` was 5 and every `unlocksHero` quest in the
 * game summed to 4, so the fifth slot was earnable from a lair and could never
 * be filled by anybody — and the Grand Quest's summary promised it out loud.
 * A reward that cannot be spent is worse than no reward, because the player
 * goes looking for the thing that spends it.
 */
describe('slots and openings', () => {
  const heroUnlockQuests = Object.values(QUESTS).filter((q) => q.rewards?.unlocksHero).length;

  it('can actually fill every slot the game hands out', () => {
    expect(recruitCapacity(heroUnlockQuests)).toBe(BALANCE.MAX_PARTY_SIZE);
  });

  /**
   * The other direction: openings must not outrun room either, or a quest pays
   * in a place at a table that has no chair.
   */
  it('never offers an opening there is no room for', () => {
    // Built the way `isLairCleared` reads it, rather than by hand: a lair is
    // beaten when its boss hex's trigger is spent, and completion is derived
    // from exactly that.
    const everyLair = new Set(
      LAIR_SPECS.map((spec) => {
        const lair = getLocation(spec.id).lair!;
        return triggerKey(spec.id, lair.bossAt);
      }),
    );
    expect(recruitCapacity(heroUnlockQuests)).toBeLessThanOrEqual(partySlots(everyLair));
  });
});
