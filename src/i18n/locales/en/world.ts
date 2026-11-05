/**
 * `world` — the worlds, their threat bands, the expansions, the monastery's
 * vows and blessings, and the resources. Read through `worldName`,
 * `threatBandName` (`data/worlds.ts`), `expansionTitle` (`data/expansions.ts`),
 * `blessingName`, `blessingLine`, `vowName` (`data/monastery.ts`),
 * `resourceName` (`constants/uiConstants.ts`) and `resourceShort` and friends
 * (`data/classResource.ts`).
 */
export const world = {
  // Worlds: `<world>.name`, and each threat band `<world>.threat.<band>`, gentlest first
  'empire.name': 'The Empire',
  'empire.orbBoss': 'Aethelred',
  'empire.threat.0': 'Home Reach',
  'empire.threat.1': 'Borderland',
  'empire.threat.2': 'Contested',
  'empire.threat.3': 'Legion Ground',
  'empire.threat.4': 'The Emperor’s Shadow',
  'jadeveil.name': 'Jadeveil Range',
  'jadeveil.orbBoss': 'Kairen',
  'jadeveil.threat.0': 'Foothills',
  'jadeveil.threat.1': 'Bamboo Terraces',
  'jadeveil.threat.2': 'High Passes',
  'jadeveil.threat.3': 'Storm Ridges',
  'jadeveil.threat.4': 'The Cloud Crown',
  'archipelago.name': 'The Shattered Archipelago',
  'archipelago.orbBoss': 'Captain Varr',
  'archipelago.threat.0': 'Landfall',
  'archipelago.threat.1': 'Outer Shoals',
  'archipelago.threat.2': 'Pirate Waters',
  'archipelago.threat.3': 'Siren Reaches',
  'archipelago.threat.4': 'Varr’s Waters',

  // Expansions
  'expansion.jadeveil.title': 'The Jadeveil Ascent',

  // The monastery's rings: `vow.<ring>.name`
  'vow.gate.name': 'Vow of the Gate',
  'vow.rain.name': 'Vow of Rain',
  'vow.wind.name': 'Vow of Wind',
  'vow.crown.name': 'Vow of the Crown',
  /** A ring's two blessings on one line, as the Handbook lists them. */
  'vow.choices.text': '{first}: {firstLine} Or {second}: {secondLine}',

  // Blessings: `blessing.<id>.name`, `blessing.<id>.line`
  'blessing.stone_bell.name': 'Stone Bell',
  'blessing.stone_bell.line': '+{percent} Physical and Magic Defense.',
  'blessing.mountain_stride.name': 'Mountain Stride',
  'blessing.mountain_stride.line': '+{amount} Movement.',
  'blessing.rain_walker.name': 'Rain-Walker',
  'blessing.rain_walker.line': 'Wrath strengthens the range’s foes only half as much against the party.',
  'blessing.cedar_heart.name': 'Cedar Heart',
  'blessing.cedar_heart.line': '+{percent} Max HP.',
  'blessing.wind_step.name': 'Wind Step',
  'blessing.wind_step.line': '+{percent} Speed: act sooner in the turn order.',
  'blessing.lantern_vigil.name': 'Lantern Vigil',
  'blessing.lantern_vigil.line': 'Each dawn in Jadeveil mends {percent} more of every hero’s HP.',
  'blessing.crane_poise.name': 'Crane Poise',
  'blessing.crane_poise.line': '+{percent} Dodge.',
  'blessing.storm_eye.name': 'Eye of the Storm',
  'blessing.storm_eye.line': '+{percent} Critical Chance.',

  // Resources: `resource.<type>.name`
  'resource.gold.name': 'Gold',
  'resource.wood.name': 'Wood',
  'resource.stone.name': 'Stone',
  'resource.iron.name': 'Iron',
  'resource.crystal.name': 'Crystal',

  // What a class casts from: `resource.<mana|chi>.<field>`
  /** Beside a number: `40 MP`, `40 Chi`. */
  'resource.mana.short': 'MP',
  'resource.mana.perTurn': 'mana / turn',
  'resource.mana.lacking': 'Not enough mana',
  'resource.chi.short': 'Chi',
  'resource.chi.perTurn': 'chi / turn',
  'resource.chi.lacking': 'Not enough chi',
};
