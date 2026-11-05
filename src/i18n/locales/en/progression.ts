/**
 * `progression` — sentences built by game logic at runtime: why a hero cannot
 * wear or take off a piece (`equipRules.ts`). The rules return a key and its
 * values; the screen words them.
 */
export const progression = {
  'equip.slot': '{item} does not go in that slot.',
  'equip.classLock': 'Only {classes} can use {item}.',
  'equip.weight.mastery': 'Your mastery does not wear {weight}.',
  'equip.weight.class': '{classes} do not wear {weight}.',
  'equip.masteryLock': '{item} requires a different mastery.',
  'equip.legendary': '{item} is legendary — only one may be worn.',
  'equip.mythic': '{item} is mythic — only one may be worn, legendary or mythic.',
  'equip.weapon': 'Your mastery does not carry a {noun}.',
  'equip.dualWield': '{item} needs a dual-wield mastery to hold.',
  'equip.twoHandedOff': '{item} is two-handed and cannot be held off-hand.',
  'equip.offhand.class': 'Only {classes} can use {offhand}.',
  'equip.offhand.mastery': 'Your mastery cannot use {offhand}.',
  'equip.offhand.path': '{classes} take up {offhand} with a path.',
  'equip.locked': 'The hand wraps stay on until a path is chosen.',

  // The words those sentences are built from: a class in the plural, an armour
  // weight, and an off-hand kind as it reads after "use"
  'class.warrior': 'Champions',
  'class.mage': 'Arcanists',
  'class.healer': 'Druids',
  'class.ranger': 'Hunters',
  'class.monk': 'Monks',
  'weight.plate': 'plate',
  'weight.hide': 'hide',
  'weight.robe': 'robe',
  'weight.vestment': 'vestment',
  'offhand.shield': 'shields',
  'offhand.quiver': 'quivers',
  'offhand.focus': 'magic focuses',
  'offhand.totem': 'totems',
  'offhand.weapon': 'a second weapon',
  'list.and': '{list} and {last}',
};
