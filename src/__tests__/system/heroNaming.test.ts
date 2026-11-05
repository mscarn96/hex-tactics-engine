import { pathName } from '@/data/gameText';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SRC_DIR } from '../support/paths';
import { heroClassName, heroTitle } from '@/data/display/heroDisplay';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { MASTERY_PATHS } from '@/data/skills/masteryData';
import { HeroClass } from '@/models/types';

/**
 * The player never reads the `HeroClass` enum.
 *
 * `ranger` / `warrior` / `mage` / `healer` are keys. The *classes* are
 * **Champion, Arcanist, Druid and Hunter**, and once a path is taken the hero
 * is a **Shadowblade** or a **Stoneshaper** and nothing else. Six screens
 * rendered the key instead — mostly by capitalising it — so a Hunter's detail
 * sheet read "Ranger · Lv 2" and the barracks list read "Lv 3 ranger" in
 * lower case, two vocabularies for the same thing and neither of them the
 * game's.
 *
 * **The scan is the deliverable more than the six edits are.** Capitalising an
 * enum is one line, it type-checks, it renders, and it looks entirely
 * reasonable in a diff — nothing at runtime and nothing in `tsc` can observe
 * that the word it produces exists nowhere in the fiction. Same argument as
 * `glyphs.test.ts` and `lighting.test.ts`.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Strip comments — prose *about* the enum is how this rule is documented. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** `x.heroClass.charAt(0).toUpperCase() + …`, in any of its spellings. */
const CAPITALISED_ENUM = /heroClass(\?)?\.(charAt\(0\)\.toUpperCase|toUpperCase|replace|slice)/;

/**
 * `heroClass` interpolated straight into JSX text.
 *
 * The barracks and tavern rows did exactly this and printed the enum in lower
 * case, which the capitalise pattern above would never have caught.
 */
const RENDERED_ENUM = /\{[^{}]*\bheroClass\b[^{}]*\}\s*<\/Text>|<Text[^>]*>\s*\{[^{}]*\bheroClass\b[^{}]*\}/;

describe('heroTitle', () => {
  it('names the template before a path is chosen', () => {
    expect(heroTitle({ heroClass: HeroClass.Ranger, templateId: 'ranger', masteryPath: null }))
      .toBe('Hunter');
    expect(heroTitle({ heroClass: HeroClass.Warrior, templateId: 'warrior' })).toBe('Champion');
    expect(heroTitle({ heroClass: HeroClass.Mage, templateId: 'mage' })).toBe('Arcanist');
    expect(heroTitle({ heroClass: HeroClass.Healer, templateId: 'healer' })).toBe('Druid');
  });

  it('names the path once one is chosen, and nothing else', () => {
    const title = heroTitle({
      heroClass: HeroClass.Ranger, templateId: 'ranger', masteryPath: 'shadowblade',
    });
    expect(title).toBe('Shadowblade');
    expect(title).not.toMatch(/Hunter|Ranger/);
  });

  // The sim harness builds a pseudo-hero from a class and a path and has no
  // `templateId` until Fight is pressed.
  it('works on a class and a path alone', () => {
    expect(heroTitle({ heroClass: HeroClass.Healer })).toBe('Druid');
    expect(heroTitle({ heroClass: HeroClass.Mage, masteryPath: 'stormcaller' }))
      .toBe('Stormcaller');
  });

  it('answers for every class and every path', () => {
    const blank: string[] = [];
    for (const template of heroTemplates) {
      if (!heroClassName(template.heroClass, template.id)) blank.push(template.id);
      for (const path of MASTERY_PATHS.filter((p) => p.heroClass === template.heroClass)) {
        const title = heroTitle({
          heroClass: template.heroClass, templateId: template.id, masteryPath: path.id,
        });
        if (title !== pathName(path)) blank.push(`${template.id}/${path.id} → "${title}"`);
      }
    }
    expect(blank).toEqual([]);
  });

  // Every one of the four names must exist, or the fallback silently renders an
  // empty string where a title should be.
  it('has a name for every class even with no template id', () => {
    const missing = Object.values(HeroClass).filter((c) => !heroClassName(c));
    expect(missing).toEqual([]);
  });
});
