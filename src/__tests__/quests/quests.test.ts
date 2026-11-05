import { POIType, ResourceType } from '@/models/types';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { Objective, Quest, QuestEvent, QuestId } from '@/quests/types';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { itemTemplates } from '@/data/items/itemTemplates';
import { Rarity } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { questLevelFloor } from '@/systems/quests/questLeads';
import { NPCS } from '@/quests/npcData';
import { FACTIONS, EnemyRole } from '@/data/templates/factions';
import {
  QuestContext, QuestRecord, advanceStages, applyEvent, autoAcceptable, eventValue,
  isAvailable, isFinished, objectiveHave, objectiveLines, objectiveTarget, questById,
  startRecord, stageComplete,
} from '@/systems/quests/quests';

/**
 * The quest rules, driven without a store or a screen.
 *
 * `systems/quests.ts` is pure precisely so this is possible: a whole quest can
 * be played to completion here in a dozen lines, which is the only practical way
 * to know a multi-stage objective chain actually terminates.
 */

const ctx = (
  partyLevel: number,
  completed: QuestId[] = [],
  active: Partial<Record<QuestId, QuestRecord>> = {},
  lairsCleared = 0,
  held: Partial<Record<ResourceType, number>> = {},
  shrines = 0,
): QuestContext => ({ partyLevel, completed, active, lairsCleared, held, shrines });

/**
 * Feeds a quest whatever it asks for until it runs out of stages.
 *
 * `collect` is satisfied by putting resources in the bag rather than by
 * reporting them, because that is what the objective actually reads — a helper
 * that only reported would play a quest to completion here and stall in the
 * game, which is the bug this rule exists to fix.
 */
function playThrough(quest: Quest, cap = 200): QuestRecord {
  let record = startRecord(quest);
  const held: Partial<Record<ResourceType, number>> = {};

  for (let i = 0; i < cap && !isFinished(quest, record); i++) {
    const objective = quest.stages[record.stage].objectives.find(
      (o, idx) => objectiveHave(o, record.progress[idx] ?? 0, ctx(1, [], {}, 0, held, 4))
        < objectiveTarget(o),
    );
    // Every objective already met (a stock such as a held shrine): the stage
    // advances on the sweep rather than on a report
    if (!objective) {
      record = advanceStages(quest, record, ctx(1, [], {}, 0, held, 4));
      continue;
    }
    if (objective.kind === 'collect') {
      held[objective.resource] = (held[objective.resource] ?? 0) + 1;
    }
    record = applyEvent(quest, record, satisfyingEvent(objective), ctx(1, [], {}, 0, held, 4));
  }
  return record;
}

/** One report that moves the given objective by one. */
function satisfyingEvent(objective: Objective): QuestEvent {
  switch (objective.kind) {
    case 'kill':     return { kind: 'kill', template: objective.templates[0], count: 1 };
    case 'collect':  return { kind: 'collect', resource: objective.resource, count: 1 };
    case 'clearPoi': return { kind: 'clearPoi', poi: objective.poi, site: objective.site };
    case 'reach':    return { kind: 'reach', location: objective.location };
    case 'investigate': return { kind: 'investigate', site: objective.site };
    case 'talk':     return { kind: 'talk', npc: objective.npc };
    // A stock read off the chain (the helper holds every shrine): any report re-evaluates it
    case 'shrine':   return { kind: 'talk', npc: 'exile_monk' };
  }
}

describe('the quest data', () => {
  it('gives every quest at least one stage with at least one objective', () => {
    const empty = QUEST_IDS.filter(
      (id) => QUESTS[id].stages.length === 0 || QUESTS[id].stages.some((s) => s.objectives.length === 0),
    );
    expect(empty).toEqual([]);
  });

  /**
   * The failure this exists for is silent: a quest that names an enemy the game
   * no longer fields never progresses, and looks like a bug in the counter
   * rather than a typo in the data.
   */
  it('only asks for enemies that exist', () => {
    const known = new Set(enemyTemplates.map((t) => t.id));
    const ghosts = QUEST_IDS.flatMap((id) =>
      QUESTS[id].stages.flatMap((stage) =>
        stage.objectives.flatMap((o) =>
          o.kind === 'kill' ? o.templates.filter((t) => !known.has(t)).map((t) => `${id}: ${t}`) : [],
        ),
      ),
    );
    expect(ghosts).toEqual([]);
  });

  /**
   * The same failure as a `kill` objective naming an enemy nobody fields: a
   * `talk` objective naming somebody who is not in `NPCS` is a counter that
   * never moves, and it does not look like a typo from inside the game.
   */
  it('only sends the player to people who exist', () => {
    const strangers = QUEST_IDS.flatMap((id) =>
      QUESTS[id].stages.flatMap((stage) =>
        stage.objectives.flatMap((o) => (o.kind === 'talk' && !NPCS[o.npc] ? [`${id}: ${o.npc}`] : [])),
      ),
    );
    expect(strangers).toEqual([]);
  });

  /**
   * An early quest must be finishable on early ground.
   *
   * `SHAPES` in `encounterGenerator` fields only `chaff`, `front` and `ranged`
   * below band 2 — the first `caster` and the first `elite` both arrive at band
   * 2, which on a 70×70 map starts eleven hexes out. So a kill objective naming
   * *only* a caster or an elite is not a hard quest, it is a quest a party at
   * that gate cannot legally meet the enemy for, and it reads as a counter that
   * never moves.
   *
   * The Goblin Tithe was written that way — "the one with the chalk" was a
   * goblin shaman, gated at summed level 5 and deliverable only at band 2 — and
   * nothing about the data said so.
   *
   * Six is the cutoff because The Roadwardens sits at eight and asks for a
   * brigand captain on purpose: it is the quest that says the home ring is
   * behind you, and its first stage is a curated waypoint fight rather than a
   * wandering one. Everything below it is meant to be finishable without
   * leaving bands 0–1.
   */
  it('asks early quests only for enemies early ground actually fields', () => {
    const EARLY_GATE = 6;
    const EARLY_ROLES: EnemyRole[] = ['chaff', 'front', 'ranged'];
    const earlyFielded = new Set(
      FACTIONS.flatMap((f) => EARLY_ROLES.flatMap((role) => f.roles[role])),
    );

    const unmeetable = QUEST_IDS
      .filter((id) => {
        return !QUESTS[id].autoAccept && questLevelFloor(id) <= EARLY_GATE;
      })
      .flatMap((id) =>
        QUESTS[id].stages.flatMap((stage, s) =>
          stage.objectives.flatMap((o) =>
            o.kind === 'kill' && !o.templates.some((t) => earlyFielded.has(t))
              ? [`${id} stage ${s}: ${o.templates.join('/')}`]
              : [],
          ),
        ),
      );
    expect(unmeetable).toEqual([]);
  });

  it('can be finished, every one of them', () => {
    const stuck = QUEST_IDS.filter((id) => !isFinished(QUESTS[id], playThrough(QUESTS[id])));
    expect(stuck).toEqual([]);
  });

  it('never gates a quest behind itself', () => {
    const cycles = QUEST_IDS.filter((id) => {
      const gate = QUESTS[id].unlockedBy;
      return gate?.kind === 'questDone' && gate.quest === id;
    });
    expect(cycles).toEqual([]);
  });

  // Every reward is a promise the claim path has to keep
  it('pays out something for every quest', () => {
    const stingy = QUEST_IDS.filter((id) => {
      const r = QUESTS[id].rewards;
      return !r.xp && !r.gold && !r.items?.length && !r.unlocksHero;
    });
    expect(stingy).toEqual([]);
  });
});

describe('matching a report to an objective', () => {
  const killWolves: Objective = {
    kind: 'kill', templates: ['wolf', 'wolf_pup'], count: 3,
  };

  it('counts any template on the list', () => {
    expect(eventValue(killWolves, { kind: 'kill', template: 'wolf' })).toBe(1);
    expect(eventValue(killWolves, { kind: 'kill', template: 'wolf_pup' })).toBe(1);
  });

  it('ignores anything else', () => {
    expect(eventValue(killWolves, { kind: 'kill', template: 'goblin' })).toBe(0);
    expect(eventValue(killWolves, { kind: 'clearPoi', poi: POIType.QuestSite })).toBe(0);
  });

  // A fight kills three wolves at once; three separate reports would be a lie
  it('takes a whole fight in one report', () => {
    expect(eventValue(killWolves, { kind: 'kill', template: 'wolf', count: 3 })).toBe(3);
  });

  it('treats reach and talk as one-and-done', () => {
    expect(objectiveTarget({ kind: 'reach', location: 'city' })).toBe(1);
    expect(objectiveTarget({ kind: 'talk', npc: 'archivist' })).toBe(1);
  });
});

describe('applying reports', () => {
  const quest = questById('the_roadwardens');
  const empty = ctx(1);

  it('returns the same record when nothing matched', () => {
    const record = startRecord(quest);
    const after = applyEvent(quest, record, { kind: 'kill', template: 'dragon' }, empty);
    // Identity, not equality: the store skips the write on this exact check, and
    // every swing in the game passes through here
    expect(after).toBe(record);
  });

  it('never counts past the target', () => {
    const wolves = questById('wolves_at_the_gate');
    let record = startRecord(wolves);
    record = applyEvent(wolves, record, { kind: 'kill', template: 'wolf', count: 99 }, empty);
    expect(isFinished(wolves, record)).toBe(true);
    expect(record.progress[0]).toBe(5);
  });

  it('advances to the next stage and resets its counters', () => {
    let record = startRecord(quest);
    record = applyEvent(quest, record, { kind: 'clearPoi', poi: POIType.QuestSite }, empty);
    expect(record.stage).toBe(1);
    expect(record.progress).toEqual([0, 0]);
  });

  it('holds a stage until every objective on it is done', () => {
    let record: QuestRecord = { stage: 1, progress: [0, 0] };
    record = applyEvent(quest, record, { kind: 'kill', template: 'bandit', count: 6 }, empty);
    expect(record.stage).toBe(1);
    record = applyEvent(quest, record, { kind: 'kill', template: 'brigand_captain' }, empty);
    expect(record.stage).toBe(2);
    expect(isFinished(quest, record)).toBe(true);
  });

  it('ignores everything once finished', () => {
    const done: QuestRecord = { stage: quest.stages.length, progress: [] };
    expect(applyEvent(quest, done, { kind: 'kill', template: 'bandit' }, empty)).toBe(done);
  });

  it('stops offering objective lines once there is no stage left', () => {
    expect(objectiveLines(quest, { stage: quest.stages.length, progress: [] }, empty)).toEqual([]);
  });

  it('reports a stage complete only when it is', () => {
    expect(stageComplete(quest.stages[1], [6, 0], empty)).toBe(false);
    expect(stageComplete(quest.stages[1], [6, 1], empty)).toBe(true);
  });
});

/**
 * A delivery is about what is in the bag, not about what passed through it.
 *
 * The counter version of this cost a playtest an unfinishable quest: the
 * archivist wants eight crystals, the player was carrying eight crystals, and
 * the hand-in was refused because they had been mined before the job was taken
 * on. Crystals from a chest, a fight or the market never counted either.
 */
describe('collect objectives read the bag', () => {
  const quest = questById('what_the_barrow_keeps');
  const crystals = (n: number) => ctx(99, [], {}, 0, { [ResourceType.Crystal]: n });

  it('counts what is held, however it was come by', () => {
    const objective = quest.stages[0].objectives[0];
    expect(objectiveHave(objective, 0, crystals(8))).toBe(8);
    // The stored counter is ignored outright — it is not where the answer lives
    expect(objectiveHave(objective, 99, crystals(3))).toBe(3);
  });

  it('completes the stage on stock alone, with nothing reported', () => {
    expect(stageComplete(quest.stages[0], [0], crystals(objectiveTarget(quest.stages[0].objectives[0]) - 1))).toBe(false);
    expect(stageComplete(quest.stages[0], [0], crystals(8))).toBe(true);
  });

  /**
   * Nobody *does* holding eight crystals, so there is no event to fold and no
   * moment `applyEvent` would have run. The sweep is the only thing that can
   * move this stage on.
   */
  it('advances without an event once the goods are in hand', () => {
    const record = startRecord(quest);
    expect(advanceStages(quest, record, crystals(objectiveTarget(quest.stages[0].objectives[0]) - 1))).toBe(record);
    expect(advanceStages(quest, record, crystals(8)).stage).toBe(1);
  });

  it('is worth nothing as a report, so the same crystals cannot count twice', () => {
    const objective = quest.stages[0].objectives[0];
    expect(eventValue(objective, { kind: 'collect', resource: ResourceType.Crystal, count: 8 }))
      .toBe(0);
  });
});

describe('availability', () => {
  it('offers the ungated quest to a level-1 solo hero', () => {
    expect(isAvailable('wolves_at_the_gate', ctx(1))).toBe(true);
  });

  it('withholds a gated quest until the whole party is strong enough', () => {
    expect(isAvailable('the_roadwardens', ctx(7, ['the_warren_under_the_fields'], {}, 1))).toBe(false);
    expect(isAvailable('the_roadwardens', ctx(8, ['the_warren_under_the_fields'], {}, 1))).toBe(true);
  });

  it('never re-offers something running or finished', () => {
    expect(isAvailable('wolves_at_the_gate', ctx(20, [], { wolves_at_the_gate: startRecord(questById('wolves_at_the_gate')) }))).toBe(false);
    expect(isAvailable('wolves_at_the_gate', ctx(20, ['wolves_at_the_gate']))).toBe(false);
  });

  it('opens every quest in the game to a fully grown party', () => {
    // Every lair behind them too — the Grand Quest counts places, not levels
    for (const id of QUEST_IDS) {
      expect(isAvailable(id, ctx(99, QUEST_IDS.filter(other => other !== id), {}, 3))).toBe(true);
    }
  });

  /**
   * The Grand Quest is the one gate that measures the map rather than the party.
   * A level-20 five-hero party that has not touched a lair must not see it.
   */
  it('holds the Grand Quest back until every lair has fallen', () => {
    expect(isAvailable('the_obsidian_ledger', ctx(99, [], {}, 2))).toBe(false);
    expect(isAvailable('the_obsidian_ledger', ctx(99, [], {}, 3))).toBe(true);
  });

  it('lets the Grand Quest in without being offered, and nothing else', () => {
    expect(autoAcceptable(ctx(99, [], {}, 3))).toEqual(['the_obsidian_ledger']);
    expect(autoAcceptable(ctx(99, [], {}, 2))).toEqual([]);
  });

  /**
   * The gates are the recruitment curve. If two quests opened at once the party
   * would jump from one hero to three, and the fights in between — which are the
   * only reason the gates exist — would never happen.
   */
  /**
   * The grind this content exists to fix.
   *
   * A playtest walked the first lair's worth of levels with one contract in
   * hand and nothing else being asked of them, because the only three quests
   * in the game opened at nothing, 8 and 16 — so between summed level 1 and 8
   * the log had a single line in it and the map had wolves.
   *
   * A *gap* rather than a count: nine quests bunched at level 3 would satisfy
   * any tally and leave the same hole. Three is the ceiling because a solo hero
   * takes roughly one fight per level early on and a pair takes two — so this
   * is "something new is asked of you every few fights", stated in the units
   * the gates are actually written in.
   */
  it('never leaves the early game without something new to be asked', () => {
    const CEILING = 3;
    const gates = QUEST_IDS
      .map(questLevelFloor)
      .filter(total => total > 0)
      .filter((total) => total <= 16)
      .sort((a, b) => a - b);

    // The ungated first quest is the floor everything else is measured from
    const steps = [1, ...gates];
    const holes = steps
      .slice(1)
      .map((total, i) => ({ from: steps[i], to: total }))
      .filter(({ from, to }) => to - from > CEILING);
    expect(holes).toEqual([]);
  });

  it('staggers strength floors between the story milestones', () => {
    // Level gates only. The Grand Quest is gated on lairs, and a lair gate is
    // already staggered by the lair gates themselves.
    const gates = QUEST_IDS
      .map(questLevelFloor)
      .filter(total => total > 0)
      .sort((a, b) => a - b);
    expect(new Set(gates).size).toBe(gates.length);
  });
});

describe('collect objectives, as reports arrive', () => {
  const quest = questById('what_the_barrow_keeps');
  const crystals = (n: number) => ctx(99, [], {}, 0, { [ResourceType.Crystal]: n });

  /**
   * A pickup does not deposit anything — it prompts a re-read of the bag. The
   * bag is the argument, so a report arriving while the party is short changes
   * nothing, and the same report once they are not finishes the stage.
   */
  it('moves the stage on when the bag is full enough, and not before', () => {
    const record = startRecord(quest);
    const haul = { kind: 'collect', resource: ResourceType.Crystal, count: 3 } as const;

    expect(applyEvent(quest, record, haul, crystals(3))).toBe(record);
    expect(applyEvent(quest, record, haul, crystals(8)).stage).toBe(1);
  });

  it('ignores the wrong resource however much of it turns up', () => {
    const record = startRecord(quest);
    expect(
      applyEvent(
        quest, record,
        { kind: 'collect', resource: ResourceType.Wood, count: 99 },
        crystals(0),
      ),
    ).toBe(record);
  });
});

/**
 * A reward is a *shape*, and the party decides what fills it.
 *
 * Naming a template was the first attempt: four quests, one rare chest piece
 * each, one per class. It is the best a fixed id can do and it is still mostly
 * wrong — non-common gear is class-locked, so three quarters of the time the
 * piece is for somebody the player never recruited, and a contract that tells
 * you to go and sell your reward is a strange contract.
 *
 * What is measured here is therefore the *shape*, not the item: which slots and
 * rarities the quests ask for, and where they ask. Which piece arrives is
 * `questGear.test.ts`'s business, because it is a function of the party.
 */
describe('gear rewards', () => {
  const rewarded = QUEST_IDS.filter((id) => QUESTS[id].rewards.gear);

  it('asks for gear on more than one quest, or the rules below prove nothing', () => {
    expect(rewarded.length).toBeGreaterThan(1);
  });

  /**
   * Rare, never legendary. The twelve mastery sets have exactly two routes —
   * the forge and the dungeon chest — and a third that costs only a
   * conversation would flatten both. `resolveGearReward` also refuses a
   * `masteryLock`ed template outright, so this is the authoring half of a rule
   * enforced on both sides.
   */
  it('never offers a legendary', () => {
    const overpaid = rewarded.filter((id) => QUESTS[id].rewards.gear!.rarity === Rarity.Legendary);
    expect(overpaid).toEqual([]);
  });

  /**
   * Every shape has to be answerable by *something* in the library, or the
   * reward silently never arrives — the same failure a `kill` objective naming a
   * retired enemy has, and the reason the named-template version was checked
   * against the catalogue too. Legality against a given hero is a separate
   * question; this is the one that says the slot and rarity pair exists at all.
   */
  it('names a slot and rarity the item library can actually fill', () => {
    const unfillable = rewarded.filter((id) => {
      const { slot, rarity } = QUESTS[id].rewards.gear!;
      return !itemTemplates.some(
        (t) => t.slot === slot && t.rarity === rarity && !(t.masteryLock && t.masteryLock.length),
      );
    });
    expect(unfillable).toEqual([]);
  });

  /**
   * Late enough that the party has masteries to read.
   *
   * This gate mattered before because a named piece landed on a solo hero of the
   * wrong class; it matters differently now. A path is chosen at
   * `BALANCE.MASTERY_UNLOCK_LEVEL`, and a reward whose whole job is to answer a
   * discipline wants a party that has chosen one — before that it falls back to
   * the first hero who can wear anything, which is the old behaviour by another
   * name.
   */
  it('waits until the party is likely to have chosen a path', () => {
    const early = rewarded.filter((id) => {
      return questLevelFloor(id) < BALANCE.MASTERY_UNLOCK_LEVEL;
    });
    expect(early).toEqual([]);
  });

  /**
   * More than one slot across the four, and one of them a weapon.
   *
   * Not variety for its own sake: a main-hand reward is the only one that goes
   * through the mastery *weapon* lock, which is the rule most likely to be
   * forgotten and least likely to be noticed — a forgotten lock does not throw,
   * it hands a Skirmisher a bow they cannot hold.
   */
  it('spreads across slots and includes a weapon', () => {
    const slots = new Set(rewarded.map((id) => QUESTS[id].rewards.gear!.slot));
    expect(slots.size).toBeGreaterThan(1);
    expect(slots.has('mainHand')).toBe(true);
  });
});
