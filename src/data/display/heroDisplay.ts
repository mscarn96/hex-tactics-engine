import { pathName } from '@/data/gameText';
import { HeroClass, HeroTemplateId, MasteryId } from '@/models/types';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { templateName } from '@/data/templates/unitText';
import { findMasteryPath } from '@/data/skills/masteryData';

/**
 * What to call a hero.
 *
 * `HeroClass` is an internal enum — `ranger`, `warrior`, `mage`, `healer` —
 * and several screens rendered it by capitalising the string, so a Hunter's
 * detail screen read "Ranger · Lv 2" and a Shadowblade's read "Ranger" beside
 * the path name. Those four words exist nowhere in the fiction: the classes are
 * **Champion, Arcanist, Druid and Hunter**, and once a path is taken the hero
 * is a **Shadowblade** and nothing else. The enum is a key, not a noun, and the
 * capitalise-the-key idiom is exactly the kind of thing that looks fine in a
 * diff and ships a second, contradictory vocabulary to the player.
 *
 * One rule, in one place, so no screen has to remember it:
 *
 *  - **path chosen** → the path's own name. A Shadowblade is a Shadowblade;
 *    naming the class as well would say the same thing twice at a lower
 *    resolution, and the class it came from stops being interesting the moment
 *    the choice is permanent.
 *  - **no path yet** → the template's name. That is the word the hero-select
 *    screen used to introduce them and the word the tavern sells them under.
 *
 * Sibling to `statusDisplay` / `itemDisplay` / `terrainDisplay`, and free of
 * the UI layer for the same reason — `heroNaming.test.ts` measures it in the
 * node environment.
 *
 * `CLASS_COLORS` and `CLASS_ICONS` stay keyed on `HeroClass`. They are lookups
 * rather than text, and a Shadowblade is still drawn in the Hunter's green.
 */

/** Enough of a `Hero` to name it. The sim harness's throwaway has no id and no template. */
export interface HeroNameable {
  heroClass: HeroClass;
  masteryPath?: MasteryId | null;
  templateId?: HeroTemplateId;
}

/**
 * The one template per class.
 *
 * Built rather than written out, so a fifth class is named correctly by
 * existing. `templateId` is preferred when the caller has one — it is the
 * hero's actual origin — and this is the fallback for the sim harness's
 * pseudo-hero, which is a class and a path and nothing else.
 */
const CLASS_TEMPLATE = new Map<HeroClass, string>(
  heroTemplates.map((t) => [t.heroClass, t.id]),
);

/**
 * The class's own name — `Champion`, `Arcanist`, `Druid`, `Hunter`, `Monk` — from
 * the `units` catalog, in the current language. Never the enum.
 */
export function heroClassName(heroClass: HeroClass, templateId?: HeroTemplateId): string {
  const id = templateId && heroTemplates.some((t) => t.id === templateId) ? templateId : CLASS_TEMPLATE.get(heroClass);
  // A class with no template is a data fault, not a thing to render an enum for
  return id ? templateName(id) : '';
}

/**
 * A hero on one line: the name, then the path or class when that says something
 * the name does not ("Rowena · Bulwark"). A hero who was never named (the tuning
 * harness, Save Creator) is called by the class once, not "Champion · Champion".
 */
export function heroLabel(hero: HeroNameable & { name: string }): string {
  const title = heroTitle(hero);
  return title.toLowerCase() === hero.name.toLowerCase() ? hero.name : `${hero.name} · ${title}`;
}

/** The path's name once one is chosen, the class's name until then. */
export function heroTitle(hero: HeroNameable): string {
  if (hero.masteryPath) {
    const path = findMasteryPath(hero.masteryPath);
    if (path) return pathName(path);
  }
  return heroClassName(hero.heroClass, hero.templateId);
}
