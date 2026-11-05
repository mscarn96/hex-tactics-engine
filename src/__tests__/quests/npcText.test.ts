import { DEFAULT_LOCALE, setLocale } from '@/i18n';
import { NPCS, NPC_IDS } from '@/quests/npcData';
import { dialogueChoice, dialogueLine, npcName, npcPlace, npcTitle, npcWhere } from '@/quests/npcText';
import { catalogGaps } from '../support/catalogEntries';

/**
 * Every person's words live in the `npcs` catalog, in every language: their
 * name, title, where and place, and each node's line and answers.
 */

const FIELDS = ['name', 'title', 'where', 'place'];

/** The fields each node needs: its line, and one entry per authored answer. */
const nodeFields = (choices: number) => ['text', ...Array.from({ length: choices }, (_, i) => `choice.${i}`)];

afterEach(() => setLocale(DEFAULT_LOCALE));

describe('npc text', () => {
  it('has every person and every line in every language, and nothing else', () => {
    const missing = [
      ...catalogGaps('npcs', NPC_IDS, FIELDS),
      ...NPC_IDS.flatMap((id) => NPCS[id].nodes.flatMap((node) =>
        catalogGaps('npcs', [`${id}.${node.id}`], nodeFields(node.choices.length)))),
    ].filter((gap) => gap.endsWith(' missing'));
    expect(missing).toEqual([]);

    const wanted = new Set([
      ...NPC_IDS.flatMap((id) => FIELDS.map((f) => `${id}.${f}`)),
      ...NPC_IDS.flatMap((id) => NPCS[id].nodes.flatMap((node) =>
        nodeFields(node.choices.length).map((f) => `${id}.${node.id}.${f}`))),
    ]);
    // With no ids, every entry in the namespace reports itself; keep those no data wants
    const orphans = catalogGaps('npcs', [], [])
      .filter((gap) => !wanted.has(gap.replace(/^\w+:npcs\./, '').replace(/ has no data entry$/, '')));
    expect(orphans).toEqual([]);
  });
});
