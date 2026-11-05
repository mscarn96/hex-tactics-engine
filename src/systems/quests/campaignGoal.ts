import { EMPIRE_LAIRS } from '@/locations/lairs';
import { SHRINE_COUNT } from '@/systems/world/shrines';
import { shrineName, summitName } from '@/systems/world/rangeSites';
import { placeName } from '@/locations/text';
import { LocationId } from '@/locations/types';
import { QUESTS, QUEST_IDS } from '@/quests/questData';
import { npcName, npcWhere } from '@/quests/npcText';
import { questStageSummary, questTitle } from '@/quests/questText';
import { NpcId, QuestId } from '@/quests/types';
import { t, type MessageKey } from '@/i18n';
import { orbBossName, worldName, type WorldId } from '@/data/worlds';
import { NO_ROADS, type CampaignRoads } from '@/systems/world/worldGates';
import { QuestContext, isAvailable, isFinished } from './quests';
import { questUnlockSteps, unmetQuestGates } from './questLeads';

/** Contracts are identified by the destination they actually ask the party to reach. */
export function lairContract(id: LocationId): QuestId | undefined {
  return QUEST_IDS.find(q => QUESTS[q].stages.some(s => s.objectives.some(o =>
    o.kind === 'reach' && o.location === id)));
}

export function isLairContract(id: QuestId): boolean {
  return EMPIRE_LAIRS.some(s => lairContract(s.id) === id);
}

/** Keep a held lair visible at its giver even while their opening line handles a side errand. */
export function activeLairAtGiver(npc: NpcId, ctx: QuestContext): { id: QuestId; name: string } | null {
  for (const spec of EMPIRE_LAIRS) {
    const id = lairContract(spec.id)!;
    if (ctx.active[id] && QUESTS[id].giver === npc) return { id, name: placeName(spec.id) };
  }
  return null;
}

export interface CampaignGoal {
  title: string;
  reason: string;
  nextStep: string;
  quest: QuestId | null;
  trackable: boolean;
  progress: string;
}

/** Follow story dependencies to an actionable lead, without inventing another unlock table. */
function nextLead(id: QuestId, ctx: QuestContext, seen: QuestId[] = []): QuestId {
  if (ctx.active[id] || isAvailable(id, ctx) || seen.includes(id)) return id;
  for (const gate of unmetQuestGates(id, ctx)) {
    if (gate.kind === 'questDone') return nextLead(gate.quest, ctx, [...seen, id]);
  }
  return id;
}

/**
 * No new saved state: victories, accepted contracts and offer predicates supply every answer.
 *
 * Past the ledger the goal is the orb story: hand Aethelred's orb to Ivane, then
 * every open road the party has not taken, and a world's own goal while it is the
 * world being played. A campaign with no road ends where it always did.
 */
export function campaignGoal(ctx: QuestContext, cleared: readonly LocationId[], roads: CampaignRoads = NO_ROADS): CampaignGoal {
  // Jadeveil's shrines claimed ride in the context (`QuestContext.shrines`)
  const total = EMPIRE_LAIRS.length;
  const count = EMPIRE_LAIRS.filter(s => cleared.includes(s.id)).length;
  const progress = t(count === total ? 'campaign.goal.progress.lairsOpen' : 'campaign.goal.progress.lairsLocked', { have: count, total });
  // The walk back is part of the route, even when the boss victory has opened the next lair.
  const ready = EMPIRE_LAIRS.map(s => lairContract(s.id)!).find(id =>
    ctx.active[id] && isFinished(QUESTS[id], ctx.active[id]!));
  const next = EMPIRE_LAIRS.find(s => !cleared.includes(s.id));
  const contract = ready ?? (next ? lairContract(next.id)! : 'the_obsidian_ledger');
  const id = ready ?? nextLead(contract, ctx);
  const quest = QUESTS[id];
  const npc = person(quest.giver);
  const record = ctx.active[id];
  const finished = !!record && isFinished(quest, record);
  const available = isAvailable(id, ctx);
  const known = !!record || available;
  const castleDone = ctx.completed.includes('the_obsidian_ledger');
  if (castleDone) return afterTheLedger(ctx, progress, roads);
  return {
    title: castleDone ? t('campaign.goal.ledgerClosed.title')
      : ready ? t('campaign.goal.report.title', { place: placeName(EMPIRE_LAIRS.find(s => lairContract(s.id) === ready)!.id) })
        : !next ? t('campaign.goal.castle.title')
          : id === contract && known ? placeName(next.id) : t('campaign.goal.nextLead.title', { quest: questTitle(id) }),
    reason: castleDone ? t('campaign.goal.ledgerClosed.reason')
      : !next && !ready ? t('campaign.goal.castle.reason')
        : t('campaign.goal.lairs.reason'),
    nextStep: castleDone ? t('campaign.goal.complete.next')
      : finished ? t('campaign.goal.reportTo.next', npc)
        : record ? questStageSummary(id, record.stage)
          : available ? t('campaign.goal.speakTo.next', npc)
            : questUnlockSteps(id, ctx).join(' '),
    quest: castleDone ? null : id,
    trackable: !!record,
    progress,
  };
}

/** A person's name and where to find them, in the current language. */
function person(id: NpcId): { name: string; where: string } {
  return { name: npcName(id), where: npcWhere(id) };
}

function afterTheLedger(ctx: QuestContext, progress: string, roads: CampaignRoads): CampaignGoal {
  const ivane = person('archivist');
  const orb = ctx.active.the_red_orb;
  if (!ctx.completed.includes('the_red_orb')) {
    return {
      title: t('campaign.goal.redOrb.title'),
      reason: t('campaign.goal.redOrb.reason'),
      nextStep: t('campaign.goal.bringOrb.next', ivane),
      quest: 'the_red_orb',
      trackable: !!orb,
      progress,
    };
  }
  const orbs = orbsRemaining(roads);
  // Jadeveil's own road runs on past Kairen, to the orb's hand-in
  if (roads.banded.includes('jadeveil') && !ctx.completed.includes('kairens_orb')) return greenOrbGoal(ctx, orbs);
  const playing = roads.banded.find((world) => world !== 'jadeveil' && !roads.finished.includes(world));
  if (playing) {
    const named = { boss: orbBossName(playing), world: worldName(playing) };
    return {
      title: worldName(playing),
      reason: t('campaign.goal.playing.reason', { orbs, ...named }),
      nextStep: t('campaign.goal.playing.next', named),
      quest: null,
      trackable: false,
      progress,
    };
  }
  if (roads.unentered.length === 1 && roads.unentered[0] === 'jadeveil') return greenOrbGoal(ctx, orbs);
  if (roads.unentered.length > 0) {
    return {
      title: t('campaign.goal.roads.title', { count: roads.unentered.length }),
      reason: t('campaign.goal.roads.reason', { orbs }),
      nextStep: roads.unentered.map((world) => t('campaign.goal.road.item', { world: worldName(world), step: roadStep(world) })).join(' '),
      quest: null,
      trackable: false,
      progress,
    };
  }
  if (roads.banded.includes('jadeveil') && ctx.completed.includes('kairens_orb')) {
    return {
      title: t('campaign.goal.orbSafe.title'),
      reason: t('campaign.goal.orbSafe.reason', { orbs }),
      nextStep: t('campaign.goal.orbSafe.next'),
      quest: null,
      trackable: false,
      progress,
    };
  }
  return {
    title: t('campaign.goal.ledgerClosed.title'),
    reason: t('campaign.goal.ledgerClosed.orbsReason'),
    nextStep: t('campaign.goal.complete.next'),
    quest: null,
    trackable: false,
    progress,
  };
}

/** "Four orbs remain.", counting the orb bosses still standing: the Empire's first, then one per world finished. */
function orbsRemaining(roads: CampaignRoads): string {
  const left = Math.max(1, Math.min(4, 4 - roads.finished.length));
  return t(`campaign.goal.orbsRemain.${left}` as MessageKey);
}

/** What the party does next to take a road it has not taken. */
function roadStep(world: WorldId): string {
  return world === 'jadeveil'
    ? t('campaign.goal.greenOrb.next', person('exile_monk'))
    : t(`campaign.goal.road.${world}.next` as MessageKey);
}

/**
 * Ivane's word on the roads, under what she says when an orb changes hands: every
 * open road the party has not taken; with none, the orb boss the party is after;
 * with neither, that she has no road to name. She names roads, never a disposal.
 */
export function ivaneRoadsLine(roads: CampaignRoads): string {
  if (roads.unentered.length > 0) {
    const lines = roads.unentered.map((world) => t(`campaign.ivane.road.${world}` as MessageKey));
    return [...lines, ...(lines.length > 1 ? [t('campaign.ivane.choose')] : [])].join(' ');
  }
  const playing = [...roads.banded].reverse().find((world) => !roads.finished.includes(world));
  return playing
    ? t('campaign.ivane.playing', { boss: orbBossName(playing), world: worldName(playing) })
    : t('campaign.ivane.none');
}

/**
 * Jadeveil's story goal: find Tōma at the foothill camp, then the next shrine
 * up the chain, then the summit. Read off the same chain the map gates on
 * (`QuestContext.shrines`), so the goal and the barred passes never disagree.
 */
function greenOrbGoal(ctx: QuestContext, orbs: string): CampaignGoal {
  const toma = person('exile_monk');
  const progress = t('campaign.goal.progress.shrines', { have: ctx.shrines, total: SHRINE_COUNT });
  const reason = t('campaign.goal.greenOrb.reason', { orbs });
  if (!ctx.completed.includes('the_green_orb')) {
    return {
      title: t('campaign.goal.greenOrb.title'),
      reason,
      nextStep: t('campaign.goal.greenOrb.next', toma),
      quest: 'the_green_orb',
      trackable: !!ctx.active.the_green_orb,
      progress,
    };
  }
  if (ctx.shrines < SHRINE_COUNT) {
    const next = shrineName(ctx.shrines + 1);
    return {
      title: next,
      reason: t('campaign.goal.shrine.reason'),
      nextStep: t('campaign.goal.shrine.next', { shrine: next, ...toma }),
      quest: null,
      trackable: false,
      progress,
    };
  }
  // The grand quest: Kairen, then Tōma, then the orb home to Ivane
  const ivane = person('archivist');
  if (ctx.completed.includes('the_cloud_crown')) {
    return {
      title: t('campaign.goal.greenOrb.title'),
      reason: t('campaign.goal.orbHome.reason'),
      nextStep: t('campaign.goal.bringOrb.next', ivane),
      quest: 'kairens_orb',
      trackable: !!ctx.active.kairens_orb,
      progress,
    };
  }
  const crown = ctx.active.the_cloud_crown;
  if (crown && isFinished(QUESTS.the_cloud_crown, crown)) {
    return {
      title: t('campaign.goal.kairenDead.title'),
      reason: t('campaign.goal.kairenDead.reason'),
      nextStep: t('campaign.goal.reportTo.next', toma),
      quest: 'the_cloud_crown',
      trackable: true,
      progress,
    };
  }
  return {
    title: summitName(),
    reason,
    nextStep: t('campaign.goal.summit.next'),
    quest: crown ? 'the_cloud_crown' : null,
    trackable: !!crown,
    progress,
  };
}
