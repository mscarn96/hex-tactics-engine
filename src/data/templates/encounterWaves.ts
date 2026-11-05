import { EncounterWave } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { FactionId, findFaction } from '@/data/templates/factions';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { entryText } from '@/i18n/dataText';

/**
 * The reinforcements a fight announces, as authored rules over its roster.
 *
 * A wave is an *encounter* rule, never a spell on a boss or an elite, so these
 * read the composed fight — who turned up, from which faction — rather than any
 * template. Only wandering and quest fights carry them: a lair chamber, the
 * castle and the siege have curated sizes the rest of the balance is built
 * around, and the tuning harness names its own opposition.
 *
 * Each wave brings **fewer or weaker** bodies than the fight it follows: the
 * point is a fight that changes shape, not one that is simply longer. The
 * deliberate exceptions are the Snare Thicket (`THICKET_NEST`), whose broods grow,
 * and the Greywater crossing (`GREYWATER_CROSSING`), which ends on a Bog Hulk.
 */

/** What the party is told when a wave arrives: `factions.wave.<id>.announce`. */
export const waveAnnounce = (id: string) => entryText('factions', `wave.${id}`, 'announce');

/** The shape of what `planEncounter` returns that waves need — kept structural to stay import-light. */
export interface WavePlanInput {
  enemies: readonly string[];
  factionId: string | null;
}

const CURATED_PREFIXES = ['lair_', 'castle', 'siege', 'tribute'];

/** Brigands: take the captain down and his crew comes for revenge. */
const BRIGAND_REVENGE: EncounterWave = {
  id: 'brigand_revenge',
  trigger: { kind: 'unitFallen', templateId: 'brigand_captain' },
  templateIds: ['footpad', 'footpad'],
};

/** Beasts: a nest has more in it than the first brood. */
function spiderBrood(spiders: number): EncounterWave {
  return {
    id: 'spider_brood',
    trigger: { kind: 'enemiesFallen' },
    templateIds: Array<string>(Math.min(spiders, BALANCE.WAVE_MAX_SIZE)).fill('giant_spider'),
  };
}

/**
 * The Ford at Greywater: the dam is not the first thing in the water. Two waves
 * wade in after the three at the timbers, so the crossing is held in three pushes
 * rather than cleared in one (playtest 2026-10-21: still too easy at band 1, so it
 * is band 2 with the fen's harder bodies).
 *
 * **The last wave is deliberately its strongest**, against the "fewer or weaker"
 * rule above, as the Snare Thicket's broods grow: the playtest asked for the ford
 * to end on its keeper — a Bog Hulk, with a Silt Speaker and a Reed Stalker beside
 * it, exactly. Every wave still sits inside `WAVE_MAX_SIZE` and
 * `WAVE_MAX_PER_ENCOUNTER`.
 */
const GREYWATER_CROSSING: EncounterWave[] = [
  {
    id: 'greywater_first_wave',
    trigger: { kind: 'enemiesFallen' },
    templateIds: ['fen_spawn', 'mire_wader', 'reed_stalker'],
  },
  {
    id: 'greywater_second_wave',
    trigger: { kind: 'enemiesFallen' },
    templateIds: ['bog_hulk', 'silt_speaker', 'reed_stalker'],
  },
];

/**
 * The Thing in the Thicket: the nest is the thing. Two spiders at the snares,
 * then a brood of three, then four — each wave only once the last is down.
 *
 * **Deliberately larger than the fight it follows**, against the "fewer or
 * weaker" rule above: a playtest found the lone pair far too easy, and the
 * quest's point is a nest that keeps emptying. Every wave still sits inside
 * `WAVE_MAX_SIZE` and `WAVE_MAX_PER_ENCOUNTER`.
 */
const THICKET_NEST: EncounterWave[] = [
  {
    id: 'thicket_brood',
    trigger: { kind: 'enemiesFallen' },
    templateIds: ['giant_spider', 'giant_spider', 'giant_spider'],
  },
  {
    id: 'thicket_nest',
    trigger: { kind: 'enemiesFallen' },
    templateIds: ['giant_spider', 'giant_spider', 'giant_spider', 'giant_spider'],
  },
];

/**
 * The Overseer's Cut: the crew works in shifts. Once the face is cleared the
 * shift resting behind it comes up — two Pickhands and their Alchemist, fewer
 * and lighter than the overseer's gang, so the fight changes shape rather than
 * repeating.
 */
const OVERSEERS_CUT: EncounterWave[] = [
  {
    id: 'overseers_cut_shift',
    trigger: { kind: 'enemiesFallen' },
    templateIds: ['delve_pickhand', 'delve_pickhand', 'delve_alchemist'],
  },
];

/**
 * The guards of a chest do not stop at the first rank: their faction's chaff
 * closes in once the board is clear, and a second wave follows it. Both come
 * from the faction already on the field, so a chest's fight changes shape
 * without changing who is fighting — the "stronger than the ground expects"
 * rule, by waves rather than by raw numbers.
 *
 * **The second wave is an elite only where the ground already fields one.** The
 * first elite waits until band 2 (`threatEliteCount`) because home ground has to
 * stay somewhere a level-1 party can learn the game, and a chest in the home
 * ring is not an exception to that — it brings a rank of the faction's front
 * line instead.
 */
function chestGuardWaves(plan: WavePlanInput): EncounterWave[] {
  const faction = plan.factionId ? findFaction(plan.factionId as FactionId) : undefined;
  if (!faction) return [];
  const chaff = faction.roles.chaff[0] ?? faction.roles.front[0];
  const front = faction.roles.front[0] ?? chaff;
  const elite = faction.roles.elite[0];
  const eliteGround = plan.enemies.some((id) => enemyTemplates.find((t) => t.id === id)?.tier === 'elite');
  const waves: EncounterWave[] = [];
  if (chaff) {
    waves.push({
      id: 'chest_reserve',
      trigger: { kind: 'enemiesFallen' },
      templateIds: [chaff, chaff],
    });
  }
  if (waves.length < BALANCE.EXPLORATION_FINDS.CHEST_GUARD_WAVES) {
    const last = eliteGround && elite ? [elite] : front ? [front, front] : [];
    if (last.length > 0) {
      waves.push({
        id: 'chest_captain',
        trigger: { kind: 'enemiesFallen' },
        templateIds: last,
      });
    }
  }
  return waves;
}

export function wavesForPlan(encounterId: string, plan: WavePlanInput): EncounterWave[] {
  if (CURATED_PREFIXES.some((p) => encounterId.startsWith(p))) return [];

  if (encounterId === 'chest_guard') return chestGuardWaves(plan);

  if (encounterId === 'quest_greywater') return GREYWATER_CROSSING;

  if (encounterId === 'quest_thicket') return THICKET_NEST;

  if (encounterId === 'quest_overseers_cut') return OVERSEERS_CUT;

  const waves: EncounterWave[] = [];
  if (plan.factionId === 'brigands' && plan.enemies.includes('brigand_captain')) {
    waves.push(BRIGAND_REVENGE);
  }
  if (plan.factionId === 'beasts') {
    const spiders = plan.enemies.filter((e) => e === 'giant_spider').length;
    if (spiders >= 2) waves.push(spiderBrood(Math.min(3, spiders)));
  }
  return waves;
}
