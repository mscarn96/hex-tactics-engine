/**
 * `economy` — sentences built by game logic at runtime: the dawn toast and the
 * expedition meal's effects, rations, the gem guide's lines and the Barracks'
 * deployment rule.
 */
export const economy = {
  // Dawn and the expedition meal (`expeditionMeals.ts`); effects are joined with " · "
  'dawn.notice': 'Day {day}: living heroes heal {percent} HP. Enemies roam to new places.',
  'meal.none': 'No expedition meal',
  'meal.effect.dawn': 'dawn heals {percent} HP (living heroes)',
  'meal.effect.rations': 'rations restore full HP; no revive or mana',
  'meal.effect.loot': '+{loot} looted gold/resources; +{luck} points to Rare-or-better equipment chance',

  // Why a hero will not eat (`rations.ts`)
  'ration.empty': 'No rations in the pack — buy food at the tavern.',
  'ration.whole': '{name} is not hungry — already at full health.',
  'ration.fallen': '{name} has fallen. A magic well or a Tavern rest brings them back.',

  // Which gear has sockets (`socketRuleText`); a rarity reads before "gear"
  'socket.rule.common': 'Common gear, the starter kit included, has no sockets.',
  'socket.rule.firstOne': '{names} gear can have one',
  'socket.rule.firstUpTo': '{names} gear can have up to {amount}',
  'socket.rule.nextOne': '{names} one',
  'socket.rule.nextUpTo': '{names} up to {amount}',
  'socket.count.2': 'two',
  'socket.count.3': 'three',
  'socket.rarity.rare': 'Rare',
  'socket.rarity.epic': 'Epic',
  'socket.rarity.legendary': 'Legendary',
  'socket.rarity.mythic': 'Mythic',
  'list.and': '{list} and {last}',

  // Gems in the reward, the bag and the Forge (`gemGuide.ts`)
  'gem.reward.note': 'when set in a socket',
  'gem.state.none': 'No sockets on carried gear.',
  'gem.state.filled': 'Every socket you carry is filled.',
  'gem.state.open': {
    one: '{count} piece you carry has an empty socket.',
    other: '{count} pieces you carry have an empty socket.',
  },
  'gem.mergeBench': {
    one: '{count} cut gem of a kind makes one brilliant. Gems are set, free, from the bag; they come back out only here.',
    other: '{count} cut gems of a kind make one brilliant. Gems are set, free, from the bag; they come back out only here.',
  },
  'gem.mergeBenchSpirit': {
    one: '{count} gem of a kind makes one of the next tier: cut into brilliant, brilliant into Spirit. Gems are set, free, from the bag; they come back out only here.',
    other: '{count} gems of a kind make one of the next tier: cut into brilliant, brilliant into Spirit. Gems are set, free, from the bag; they come back out only here.',
  },
  'gem.focus': '{gem}: {bonus} in an empty socket.',

  // The Barracks' first-turn rule by level (`deploymentPerk`)
  'deploy.default': 'default deployment',
  'deploy.swap': 'swap heroes’ starting positions',
  'deploy.swapAndMove': 'swap starts and reposition one hero',
  'deploy.free': 'freely arrange the party in the deployment area',
};
