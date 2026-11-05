/** The world map's HUD, its dialogs and toasts, the foothill camp, the monastery and Jadeveil's wrath. */
export const worldmap = {
  // Hours on the clock: "18h" under a day, "2d 6h" over (`hoursText`).
  'hours.hours': '{hours}h',
  'hours.days': '{days}d',
  'hours.daysHours': '{days}d {hours}h',

  // The calendar plate
  'calendar.title': 'Day {day} · Week {week}',
  'calendar.tribute': 'Tribute {amount}g',
  'calendar.incense': {
    one: 'Incense · {count} day',
    other: 'Incense · {count} days',
  },

  // The calendar plate, opened (`InForceDialog`): what runs against the clock, and what it does
  'inForce.title': 'In force',
  'inForce.open': 'Calendar, {title}. Opens what is in force',
  'inForce.left': '{name}, {left} left',
  'inForce.meal': 'Expedition meal, tier {tier}, until the week turns',
  'inForce.mealEffects': 'This week: {effects}.',
  'inForce.tribute': 'Tribute: {amount} gold',
  'inForce.tributeLine': 'Falls due when the week turns.',

  // The map's buttons
  'hud.menu': 'Menu',
  'hud.questLog': 'Quest log',
  'hud.bag': 'Bag',
  'hud.bagRations': { one: 'Bag, {count} ration in the pack', other: 'Bag, {count} rations in the pack' },
  'hud.centre': 'Centre',
  'hud.threat': 'Threat',
  'hud.threatOn': 'Threat ●',
  'hud.threatView': 'Threat view',
  'hud.guide': 'Guide',
  'hud.guideCity': 'City ●',
  'hud.guideCamp': 'Camp ●',
  'hud.guideQuest': 'Quest ●',
  'hud.guideAscent': 'Ascent ●',
  'hud.guideJadeveil': 'Jadeveil ●',
  'hud.guideGate': 'Gate ●',

  // The threat legend
  'legend.label': 'Threat view legend',
  'legend.zone.road': 'Road',
  'legend.zone.corridor': 'Corridor',
  'legend.zone.haunted': 'Haunted',

  // Toasts and refusals on the map
  'toast.questOffered': 'New quest offered: {name}',
  'toast.questsOffered': { one: '{count} new quest offered', other: '{count} new quests offered' },
  'toast.wellRestored': 'Magic well — all heroes restored!',
  'toast.worldReached': 'You reach {world}.',
  'refusal.lairCleared': '{name} lies empty. Whatever was in it is dead.',
  'refusal.lairLevel': '{name} is beyond you — the party must total level {needed}, and stands at {have}.',
  'refusal.castleRoad': 'The Obsidian Road is watched. Take the three lairs first — you will need every hand.',
  'refusal.gateUnowned': 'The far road leads into {expansion}, an expansion this game does not yet hold.',
  'refusal.gateBarred': 'The far road is barred while the Emperor holds the throne. Break the Obsidian Legion first.',
  'refusal.gateOrb': 'The next road opens when {boss} falls ({world}).',

  // Crossing to another world
  'crossing.title': 'The road to {world}',
  'crossing.choose': 'Which road?',
  'crossing.bandFirst': 'This road will be levels {floor}–{top}.',
  'crossing.bandKept': 'This road is levels {floor}–{top}.',
  'region.banded': '{region} · Lv\u00a0{floor}\u2060–\u2060{top}',
  'crossing.message': {
    one: 'A journey of {count} hour. The party, its pack and the city\'s clock go together; the ground behind stays as you leave it.',
    other: 'A journey of {count} hours. The party, its pack and the city\'s clock go together; the ground behind stays as you leave it.',
  },
  'crossing.confirm': 'Set out',
  'crossing.cancel': 'Stay',

  // Save and quit
  'menu.leaveTitle': 'Leave the Field',
  'menu.message': 'The chronicle will be saved where it stands, and you will return to the main menu.',

  // The first vow, offered on arrival
  'vowOffer.title': 'The monastery',
  'vowOffer.later': 'Later',

  // The foothill camp's stations (`CampCounter`), each opened from its own hex
  'camp.station.fire.title': 'The camp fire',
  'camp.station.fire.subtitle': 'Rest and mend here. The Tavern is back in the Empire.',
  'camp.station.monastery.title': 'The monastery',
  'camp.station.monastery.subtitle': 'Vows against the Wrath, taken and changed here.',
  'camp.station.trader.title': 'The pack-trader',
  'camp.station.trader.subtitle': 'Turn the range’s haul into gold.',
  'camp.station.whetstone.title': 'The whetstone',
  'camp.station.whetstone.subtitle': 'Break gear down for its materials.',
  'camp.ink.title': 'Spirit Ink · {count} held',
  'camp.ink.patterns': {
    one: 'The city forge spends it on the range\'s gear — {count} pattern learned. Salvage here returns some.',
    other: 'The city forge spends it on the range\'s gear — {count} patterns learned. Salvage here returns some.',
  },
  'camp.ink.none': 'Paid by the range\'s fights, shrines and chests. The city forge spends it on gear like any range piece you bring home.',
  'camp.rest.title': 'Rest by the fire',
  'camp.rest.wanted': {
    one: 'Full HP and mana, the fallen revived; {count} hour passes.',
    other: 'Full HP and mana, the fallen revived; {count} hours pass.',
  },
  'camp.rest.whole': 'Nobody needs the fire — the party is already whole.',
  'camp.rest.button': 'Rest',
  'camp.rest.done': {
    one: 'The party rests {count} hour by the fire.',
    other: 'The party rests {count} hours by the fire.',
  },

  // The monastery's rings
  'monastery.kind.defence': 'Defence',
  'monastery.kind.mobility': 'Mobility',
  'monastery.kind.storm': 'Storm',
  'monastery.kind.offence': 'Offence',
  'monastery.blessing': '{name} · {kind}',
  'monastery.ring.taken': 'taken',
  'monastery.ring.choose': 'choose one',
  'monastery.ring.opens': 'opens when wrath holds at {percent}',
  'monastery.confirmChange': 'Change vow: a day of prayer, {time} on the clock. Press again.',
  'monastery.pray': 'Pray',
  'monastery.change': 'Change',
  'monastery.take': 'Take vow',
  'monastery.taken': 'The party takes the {name} vow.',
  'monastery.takenAfterPrayer': 'After a day of prayer the party takes the {name} vow.',
  'monastery.handbook': 'Vows',

  // Wrath: the gauge and its dialog
  'wrath.weather.clear': 'Clear',
  'wrath.weather.clouds': 'Clouds',
  'wrath.weather.rain': 'Rain',
  'wrath.weather.storm': 'Storm',
  'wrath.weather.calm': 'Calm',
  'wrath.gauge': 'Wrath {percent}',
  'wrath.gaugeLabel': 'Wrath {percent}, {weather}',
  'wrath.gaugeLabelOpen': 'Wrath {percent}, {weather}, summit open {time}',
  'wrath.summitOpen': 'Summit open · {time}',
  'wrath.title': 'Wrath of the range',
  'wrath.strength': 'Enemies in Jadeveil are {percent} stronger.',
  'wrath.windowOpen': 'The summit is open for {time} more.',
  'wrath.floor': 'It holds at {percent} or more.',
  'wrath.handbook': 'Wrath and vows',
  'wrath.vows': 'Vows in force',
  'wrath.noVows': 'None yet. The monastery above the camp offers them.',
};
