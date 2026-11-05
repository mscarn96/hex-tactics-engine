import { HeroClass, MasteryId } from '@/models/types';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { findMasteryPath, masteriesForClass } from '@/data/skills/masteryData';
import { CampaignStageId, stageBudget, stagePartySize } from './campaignStages';
import { PartyPick, RolledParty, rollMasterySpend, rollPickedParty } from './balance/partyRoll';
import { makeRng, mixSeed, pick, Rng, shuffled } from './balance/rng';

/**
 * PvP proof of concept: two hero teams rolled inside one campaign stage's budget, so neither side
 * is better dressed or levelled than the stage allows. The player picks classes and paths as in
 * Save Creator; the AI's picks are rolled. Both teams then spend every mastery point at random
 * through the real tree (`rollMasterySpend`), which Save Creator leaves to the player.
 */

const CLASSES: HeroClass[] = heroTemplates.map((t) => t.heroClass);

export interface PvpTeams {
  player: RolledParty;
  ai: RolledParty;
  aiPicks: PartyPick[];
}

/** Distinct random classes, each on a random one of its paths. */
export function rollAiPicks(count: number, rng: Rng): PartyPick[] {
  return shuffled(rng, CLASSES).slice(0, count).map((heroClass) => ({
    heroClass,
    masteryPath: pick(rng, masteriesForClass(heroClass)).id as MasteryId,
  }));
}

/** A picked party levelled and dressed in the stage's budget, with its mastery points spent at random. */
export function rollPvpTeam(stage: CampaignStageId, picks: readonly PartyPick[], rng: Rng): RolledParty {
  const party = rollPickedParty(stageBudget(stage), picks, rng);
  for (const hero of party.heroes) {
    const path = hero.masteryPath ? findMasteryPath(hero.masteryPath) : undefined;
    if (!path) continue;
    const spend = rollMasterySpend(path, hero.level, rng);
    hero.masteryNodes = spend.nodes;
    hero.capstone = spend.capstone;
  }
  return party;
}

/** Both teams from one seed: the player's from their picks, the AI's from rolled picks of the same size. */
export function rollPvpTeams(stage: CampaignStageId, picks: readonly PartyPick[], seed: number): PvpTeams {
  const size = stagePartySize(stage);
  if (picks.length < size.min || picks.length > size.max) throw new Error(`This stage fields ${size.min}–${size.max} heroes.`);
  if (new Set(picks.map((p) => p.heroClass)).size !== picks.length) throw new Error('Each class may join a team once.');
  const aiRng = makeRng(mixSeed(seed, 2));
  const aiPicks = rollAiPicks(picks.length, aiRng);
  return {
    player: rollPvpTeam(stage, picks, makeRng(mixSeed(seed, 1))),
    ai: rollPvpTeam(stage, aiPicks, aiRng),
    aiPicks,
  };
}
