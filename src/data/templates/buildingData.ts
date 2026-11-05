import { BuildingData, BuildingType, ResourceType } from '@/models/types';
import { entryText } from '@/i18n/dataText';

/** A building's name ("Barracks" / "Koszary"). */
export const buildingName = (type: BuildingType) => entryText('buildings', type, 'name');
/** A building's one-line description. */
export const buildingDescription = (type: BuildingType) => entryText('buildings', type, 'description');

/**
 * What each building's next level costs.
 *
 * **Every row was cut by ~18% on a playtest report that the city was too dear.**
 * The cut is uniform across buildings and resources rather than aimed at the
 * expensive ones, because the *relative* prices are what say which building is
 * the cheap way in — the Market is deliberately the cheapest opening step, the
 * Forge the dearest — and re-weighting them under cover of a discount would
 * silently re-order that. Figures are rounded to readable numbers afterwards,
 * which is why none of them is exactly 0.82 of what it was.
 *
 * The one number left alone is the Market's 2 Crystal at level 1: 18% of two is
 * rounding noise, and taking it to 1 would be a halving rather than a discount.
 */
export const buildingData: BuildingData[] = [
  {
    type: BuildingType.Barracks,
    maxLevel: 3,
    upgradeCosts: [
      { [ResourceType.Gold]: 40, [ResourceType.Wood]: 16, [ResourceType.Stone]: 8, [ResourceType.Iron]: 0, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 100, [ResourceType.Wood]: 33, [ResourceType.Stone]: 25, [ResourceType.Iron]: 8, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 205, [ResourceType.Wood]: 50, [ResourceType.Stone]: 40, [ResourceType.Iron]: 25, [ResourceType.Crystal]: 4 },
    ],
  },
  {
    type: BuildingType.Shop,
    maxLevel: 3,
    upgradeCosts: [
      { [ResourceType.Gold]: 33, [ResourceType.Wood]: 12, [ResourceType.Stone]: 8, [ResourceType.Iron]: 0, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 80, [ResourceType.Wood]: 25, [ResourceType.Stone]: 16, [ResourceType.Iron]: 4, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 165, [ResourceType.Wood]: 40, [ResourceType.Stone]: 33, [ResourceType.Iron]: 16, [ResourceType.Crystal]: 4 },
    ],
  },
  {
    type: BuildingType.Forge,
    maxLevel: 3,
    upgradeCosts: [
      { [ResourceType.Gold]: 50, [ResourceType.Wood]: 8, [ResourceType.Stone]: 16, [ResourceType.Iron]: 8, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 115, [ResourceType.Wood]: 16, [ResourceType.Stone]: 33, [ResourceType.Iron]: 20, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 230, [ResourceType.Wood]: 25, [ResourceType.Stone]: 50, [ResourceType.Iron]: 40, [ResourceType.Crystal]: 8 },
    ],
  },
  {
    type: BuildingType.Tavern,
    maxLevel: 3,
    upgradeCosts: [
      { [ResourceType.Gold]: 40, [ResourceType.Wood]: 20, [ResourceType.Stone]: 4, [ResourceType.Iron]: 0, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 90, [ResourceType.Wood]: 40, [ResourceType.Stone]: 12, [ResourceType.Iron]: 4, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 180, [ResourceType.Wood]: 65, [ResourceType.Stone]: 25, [ResourceType.Iron]: 12, [ResourceType.Crystal]: 4 },
    ],
  },
  {
    type: BuildingType.Market,
    maxLevel: 3,
    // Cheapest opening cost in the city, and deliberately: the market is how a
    // party that has run out of gold converts what it does have into what it
    // needs, so pricing it out of reach would shut the door on the people it is
    // for. Upgrades improve the resource purchase spread.
    upgradeCosts: [
      { [ResourceType.Gold]: 25, [ResourceType.Wood]: 16, [ResourceType.Stone]: 4, [ResourceType.Iron]: 0, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 125, [ResourceType.Wood]: 33, [ResourceType.Stone]: 20, [ResourceType.Iron]: 8, [ResourceType.Crystal]: 2 },
      { [ResourceType.Gold]: 245, [ResourceType.Wood]: 50, [ResourceType.Stone]: 37, [ResourceType.Iron]: 20, [ResourceType.Crystal]: 6 },
    ],
  },
  {
    type: BuildingType.Library,
    maxLevel: 3,
    upgradeCosts: [
      { [ResourceType.Gold]: 50, [ResourceType.Wood]: 16, [ResourceType.Stone]: 12, [ResourceType.Iron]: 0, [ResourceType.Crystal]: 0 },
      { [ResourceType.Gold]: 105, [ResourceType.Wood]: 29, [ResourceType.Stone]: 25, [ResourceType.Iron]: 8, [ResourceType.Crystal]: 2 },
      { [ResourceType.Gold]: 215, [ResourceType.Wood]: 40, [ResourceType.Stone]: 40, [ResourceType.Iron]: 20, [ResourceType.Crystal]: 8 },
    ],
  },
];
