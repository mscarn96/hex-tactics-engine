import { pathName } from '@/data/gameText';
import { HeroClass, MasteryId, Rarity } from '@/models/types';
import { itemTemplates } from '@/data/items/itemTemplates';
import { heroTemplates } from '@/data/templates/heroTemplates';
import { masteriesForClass } from '@/data/skills/masteryData';
import { masteryNodeName } from '@/data/display/masteryText';
import { DEFAULT_MIN_SAMPLE } from './aggregate';
import { BALANCE_LEVEL_CAP, BAND_IDS, BANDED_ENCOUNTER_IDS, BandBudget, bandBudget, DEFAULT_ENCOUNTERS, EncounterId, EncounterSpec, ENCOUNTER_IDS } from './encounters';
import { capstonesOf } from './partyRoll';
import { DEFAULT_WEIGHTS, ScoreWeights } from './scoring';
import { itemName } from '@/data/items/itemText';
import { templateName } from '@/data/templates/unitText';

/**
 * What the balance lab's pages need to know about the game, as plain data.
 *
 * The pages run in a browser, which cannot load the game's modules (they reach
 * `@/platform/uuid`), so the dev server reads this once and serves it as JSON: the
 * classes, paths and capstones the constraint pickers list, the default budgets,
 * and the names results rows are labelled with.
 */

export interface BalanceMeta {
  encounters: { id: EncounterId; name: string; defaults: EncounterSpec }[];
  classes: { id: HeroClass; name: string }[];
  paths: { id: MasteryId; name: string; heroClass: HeroClass; capstones: { id: string; name: string }[] }[];
  rarities: Rarity[];
  weights: ScoreWeights;
  minSample: number;
  levelCap: number;
  /** The level bands, each with its built-in budget (a saved one overrides it: the `meta` route's `bands`). */
  bands: Record<number, BandBudget>;
  /** The encounters that always stand at a band. */
  banded: EncounterId[];
  /** Names for the rows of the item views. */
  items: Record<string, string>;
  /** Names for capstone rows. */
  capstones: Record<string, string>;
}

const ENCOUNTER_NAMES: Record<EncounterId, string> = {
  troll: 'Troll Chieftain',
  dragon: 'Emerald Dragon',
  heart: 'Heart of Winter',
  castle: 'Castle chain',
  pvp: 'PvP (two random parties)',
  jorogumo: 'Jorōgumo',
  last_lesson: 'The Last Lesson',
  kairen: 'Kairen',
};

export function balanceMeta(): BalanceMeta {
  const paths = heroTemplates.flatMap((t) => masteriesForClass(t.heroClass)).map((p) => ({
    id: p.id as MasteryId,
    name: pathName(p),
    heroClass: p.heroClass,
    capstones: capstonesOf(p).map((n) => ({ id: n.id, name: masteryNodeName(n) })),
  }));
  return {
    encounters: ENCOUNTER_IDS.map((id) => ({ id, name: ENCOUNTER_NAMES[id], defaults: DEFAULT_ENCOUNTERS[id] })),
    classes: heroTemplates.map((t) => ({ id: t.heroClass, name: templateName(t.id) })),
    paths,
    rarities: [Rarity.Common, Rarity.Rare, Rarity.Epic, Rarity.Legendary],
    weights: DEFAULT_WEIGHTS,
    minSample: DEFAULT_MIN_SAMPLE,
    levelCap: BALANCE_LEVEL_CAP,
    bands: Object.fromEntries(BAND_IDS.map((band) => [band, bandBudget(band)])),
    banded: [...BANDED_ENCOUNTER_IDS],
    items: Object.fromEntries(itemTemplates.filter((t) => t.rarity === Rarity.Legendary || t.rarity === Rarity.Epic).map((t) => [t.id, itemName(t)])),
    capstones: Object.fromEntries(paths.flatMap((p) => p.capstones.map((c) => [c.id, c.name]))),
  };
}
