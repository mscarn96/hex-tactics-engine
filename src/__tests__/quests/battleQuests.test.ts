import { CombatUnit, POIType } from '@/models/types';
import { useQuestStore } from '@/stores/questStore';
import {
  killTally, previewVictory, questProgressText, questTargetText, questTargetsInBattle,
} from '@/systems/quests/battleQuests';
import {
  battleQuestTargets, previewBattleVictory, reportPoiCleared, reportVictory,
} from '@/systems/quests/questEvents';
import { questContext } from '@/systems/quests/quests';
import { QuestId } from '@/quests/types';
import { QuestRecord } from '@/systems/quests/quests';

const ctx = questContext(99, { active: {}, completed: [] });

const dead = (templateId: string, isPlayer = false) =>
  ({ templateId, isPlayer, currentHp: 0 }) as CombatUnit;
const alive = (templateId: string) => ({ templateId, isPlayer: false, currentHp: 10 }) as CombatUnit;

function setActive(active: Partial<Record<QuestId, QuestRecord>>) {
  useQuestStore.getState().reset();
  useQuestStore.setState({ active });
}

describe('battle quests', () => {
  it('tallies only fallen enemies, never the party', () => {
    expect(killTally([dead('wolf'), dead('wolf'), alive('wolf'), dead('wolf_pup'), dead('summon', true)]))
      .toEqual([['wolf', 2], ['wolf_pup', 1]]);
  });

  describe('the intro', () => {

    it('says nothing for a finished counter or an unrelated fight', () => {
      expect(questTargetsInBattle({ wolves_at_the_gate: { stage: 0, progress: [5] } }, ['wolf'])).toEqual([]);
      expect(questTargetsInBattle({ wolves_at_the_gate: { stage: 0, progress: [0] } }, ['bandit'])).toEqual([]);
      expect(questTargetsInBattle({ wolves_at_the_gate: { stage: 1, progress: [5] } }, ['wolf'])).toEqual([]);
    });
  });

  describe('the victory card', () => {

    it('stays silent about a quest the fight did not touch', () => {
      expect(previewVictory({ wolves_at_the_gate: { stage: 0, progress: [1] } },
        [{ kind: 'kill', template: 'bandit', count: 3 }], ctx).quests).toEqual([]);
    });

    it('previews exactly what reportVictory and reportPoiCleared then write', () => {
      const cases: { active: Partial<Record<QuestId, QuestRecord>>; units: CombatUnit[]; site?: { poi: POIType; questId?: string } }[] = [
        {
          active: {
            the_goblin_tithe: { stage: 0, progress: [4] },
            wolves_at_the_gate: { stage: 0, progress: [3] },
          },
          units: [dead('goblin'), dead('goblin'), dead('goblin'), dead('orc_grunt'), dead('wolf'), alive('wolf')],
        },
        {
          active: { the_roadwardens: { stage: 0, progress: [0] } },
          units: [dead('bandit'), dead('brigand_captain')],
          site: { poi: POIType.QuestSite, questId: 'quest_1' },
        },
        {
          active: { the_ford_at_greywater: { stage: 1, progress: [0] } },
          units: [dead('fen_spawn')],
          site: { poi: POIType.QuestSite, questId: 'quest_greywater' },
        },
      ];
      for (const c of cases) {
        setActive(c.active);
        const preview = previewBattleVictory(c.units, c.site);
        reportVictory(c.units);
        if (c.site) reportPoiCleared(c.site.poi, c.site.questId);
        expect(useQuestStore.getState().active).toEqual(preview.active);
      }
    });
  });
});
