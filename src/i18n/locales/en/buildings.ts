/**
 * `buildings` — each city building's name and description (`<type>.name`,
 * `<type>.description`, read through `data/templates/buildingData.ts`), and the
 * one-line perk of each level (`perk.*`, built by `systems/economy/cityServices.levelPerk`).
 */
export const buildings = {
  'barracks.name': 'Barracks',
  'barracks.description': 'Plan the party’s starting positions; retrain mastery picks.',
  'shop.name': 'Shop',
  'shop.description': 'Buy equipment for your heroes.',
  'forge.name': 'Forge',
  'forge.description': 'Craft powerful items from resources.',
  'tavern.name': 'Tavern',
  'tavern.description': 'Rest, pack rations, recruit heroes and buy week-long expedition meals.',
  'market.name': 'Market',
  'market.description': 'Trade Wood, Stone, Iron and Crystal at weekly rates.',
  'library.name': 'Library',
  'library.description': 'Provides passive XP bonus to all heroes.',

  /** `{deploy}` is the deployment rule of that level. */
  'perk.barracks': '{deploy}; retrain {percent} cheaper',
  'perk.shop': {
    one: 'Common/Rare assortment, {count} distinct family',
    other: 'Common/Rare assortment, {count} distinct families',
  },
  'perk.forge.common': 'crafts up to common',
  'perk.forge.rare': 'crafts up to rares',
  'perk.forge.epic': 'crafts up to epics',
  'perk.forge.legendary': 'crafts up to legendaries',
  'perk.forge.sets': 'crafts legendaries — mastery sets and learned Jadeveil collections — and rerolls their skill bonus',
  'perk.market': 'resources only; buy/sell spread ×{spread}',
  'perk.library': '+{percent} XP to all heroes',
  'perk.tavern.none': 'rest, rations and recruits; no expedition meal',
  /** What the next level brings, under a building's counter. */
  'perk.next': 'Level {level}: {perk}',
};
