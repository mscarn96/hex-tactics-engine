import * as champion from '@/data/skills/mastery/champion';
import * as arcanist from '@/data/skills/mastery/arcanist';
import * as druid from '@/data/skills/mastery/druid';
import * as hunter from '@/data/skills/mastery/hunter';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { WILD_FORMS } from '@/data/templates/wildForms';
import { HeroClass, HeroSkill, MasteryId, SkillId } from '@/models/types';
import { skillName } from '@/data/gameText';

/**
 * A mastery skill lives in the file for the class whose path grants it.
 *
 * **This rule had no enforcement and two skills had already drifted.** The
 * Hydromancer's Rime Tornado sat in `druid.ts` — inside the *Stoneshaper* block,
 * under a comment that opened "The Hydromancer's summon" — and the Lifewarden's
 * treant sat in the same block one path over. Both were authored in a pass that
 * grouped by "is a summon" rather than by owner, and both survived indefinitely.
 *
 * They survived because **file placement here has no observable consequence**:
 * `masterySkills.ts` flattens all four modules into one `MASTERY_SKILLS` array
 * with `export *`, so `findSkill`, the tree screen, the HUD and every test are
 * byte-identical whichever file a skill sits in. Nothing at runtime can notice,
 * which is precisely the shape of failure `glyphs.test.ts` and
 * `heroNaming.test.ts` exist for — a rule that is only a convention is a rule
 * that decays, and the comment naming the right path is not much use when it is
 * sitting in the wrong file.
 *
 * The mapping is **derived from `MasteryPath.heroClass`**, not authored, so a
 * path moved between classes drags its skills' correct home with it rather than
 * making this suite wrong.
 */

const MODULES: Record<string, Record<string, unknown>> = {
  'mastery/champion.ts': champion,
  'mastery/arcanist.ts': arcanist,
  'mastery/druid.ts': druid,
  'mastery/hunter.ts': hunter,
};

/** Which file each class's paths are authored in. */
const FILE_FOR_CLASS: Record<HeroClass, string> = {
  [HeroClass.Warrior]: 'mastery/champion.ts',
  [HeroClass.Mage]: 'mastery/arcanist.ts',
  [HeroClass.Healer]: 'mastery/druid.ts',
  [HeroClass.Ranger]: 'mastery/hunter.ts',
  // No Monk path exists yet; its trees will be authored here
  [HeroClass.Monk]: 'mastery/monk.ts',
};

/** Duck-typed rather than `instanceof`: these modules export plain object literals. */
function isSkill(value: unknown): value is HeroSkill {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HeroSkill).id === 'string' &&
    typeof (value as HeroSkill).range === 'number' &&
    (value as HeroSkill).targetType !== undefined
  );
}

/** Skill id → the file it is authored in. */
const fileOf = new Map<SkillId, string>();
for (const [file, module] of Object.entries(MODULES)) {
  for (const value of Object.values(module)) {
    if (isSkill(value)) fileOf.set(value.id, file);
  }
}

/**
 * Skill id → every path that hands it over.
 *
 * Three routes, and all three count: a path's signature, a node's `grantsSkill`,
 * and — for Wildshape alone — the innate pair every shape arrives wearing, which
 * comes off `WILD_FORMS` rather than off a node. Missing that third route would
 * exempt `maul` and `talons` from the rule for no reason anybody could state.
 */
const grantedBy = new Map<SkillId, Set<MasteryId>>();
const claim = (skill: SkillId | undefined, path: MasteryId) => {
  if (!skill) return;
  const set = grantedBy.get(skill) ?? new Set<MasteryId>();
  set.add(path);
  grantedBy.set(skill, set);
};

for (const path of MASTERY_PATHS) {
  claim(path.signatureSkill ?? undefined, path.id);
  for (const node of path.nodes) claim(node.grantsSkill, path.id);
}
for (const form of Object.values(WILD_FORMS)) {
  for (const skill of form.skills) claim(skill, 'wildshape');
}

const classOf = new Map<MasteryId, HeroClass>(MASTERY_PATHS.map((p) => [p.id, p.heroClass]));

describe('mastery skills are authored in their own class file', () => {
  it('puts every granted skill in the file for the class that grants it', () => {
    const offenders: string[] = [];

    for (const [skill, file] of fileOf) {
      const paths = grantedBy.get(skill);
      // Ungranted skills are the next test's problem, not this one's.
      if (!paths || paths.size === 0) continue;

      const expected = new Set([...paths].map((p) => FILE_FOR_CLASS[classOf.get(p)!]));
      // A skill granted by two classes is a *shared* skill and belongs in
      // `skillData.ts` — reported here rather than silently passing, since no
      // single mastery file could be the right home for it.
      if (expected.size > 1) {
        offenders.push(`${skill}: granted across classes (${[...paths].join(', ')})`);
        continue;
      }
      const [home] = [...expected];
      if (home !== file) {
        offenders.push(`${skill}: authored in ${file}, granted by ${[...paths].join(', ')} → ${home}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('grants every skill authored in a mastery file', () => {
    /**
     * The other direction. A mastery file is for skills exactly one path hands
     * over, so an ungranted one is either dead code or a shared skill in the
     * wrong place — and `deriveHeroSkills` can never reach it either way.
     *
     * This is the check that would have caught the Rime Tornado's *other* half:
     * a skill can be misfiled and still granted, but a skill nobody grants is
     * invisible to the game entirely.
     */
    const orphans = [...fileOf.keys()]
      .filter((id) => !grantedBy.has(id))
      .sort();
    expect(orphans).toEqual([]);
  });

  it('accounts for every skill in all four files', () => {
    // Guards the duck-type above: if `isSkill` stopped matching, both tests
    // would pass vacuously over an empty map.
    expect(fileOf.size).toBeGreaterThan(80);
  });
});
