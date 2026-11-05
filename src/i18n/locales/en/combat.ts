/** The combat scene and its HUD: the intro card, the turn bar, the action bar, the boss readouts and the defeat card. */
export const combat = {
  // The opening card
  'intro.kicker': 'Enemies ahead',
  'intro.skip': 'Tap to begin',
  'intro.quest': 'Quest: {target}',

  // Board controls and the turn bar
  'board.sides': 'Show sides',
  'board.whole': 'Show whole board',
  'queue.fury': '{name} acts again — Fury',
  'queue.bonus': '{name} acts again — speed bonus turn',
  'queue.focus': 'Focus {name} and show details',
  'queue.taint': 'Jade Taint {count} of 3',
  'menu': 'Menu',

  // The active unit's card and the 3D bar over a unit (pixel font: no letters outside A–Z)
  'card.level': 'Lv {level}',
  'arena.level': 'L{level}',

  // The skill inspector
  'skill.close': 'Close skill details',
  'skill.details': 'Details',
  'skill.simple': 'Simple',
  'skill.interrupts': 'Interrupts {name}',
  'skill.mayInterrupt': 'May interrupt {name}',
  'mode.mercy': 'Mercy',
  'mode.wrath': 'Wrath',
  'mode.strike': '{mult}× {scaling} strike',
  'mode.heal': 'heals for {mult}× MAG',
  'mode.noHeal': 'no heal',

  // The action bar and aiming
  'action.move': 'Move',
  'action.stunned': 'Stunned',
  'action.frozen': 'Frozen',
  'action.hidden': 'Hidden',
  'action.rooted': 'Rooted',
  'action.return': 'Return',
  'action.endTurn': 'End Turn',
  'endTurnConfirm.title': 'End turn?',
  'endTurnConfirm.message': '{name} has not moved or acted this turn.',
  'endTurnConfirm.confirm': 'End Turn',
  'endTurnConfirm.cancel': 'Keep playing',
  'aim.hex': 'Choose a hex',
  'aim.again': 'Tap again to cast',
  'aim.target': 'Choose a target',
  'deploy.hint': '{perk} · select hero, then highlighted hex',
  'deploy.default': 'Default',
  'deploy.confirm': 'Confirm deployment',

  // Turn notices and the log
  'toast.stunned': '{name} is stunned!',
  'toast.asleep': '{name} is asleep!',
  'toast.kneeling': '{name} kneels, spent by the duel!',
  'toast.frozen': '{name} is frozen!',
  'toast.noMove': 'Nowhere to move',
  'toast.noReturn': 'Cannot return',
  'log.aimDropped': '{name} lowers the bow: the aim is dropped',

  // Boss and warning readouts
  'boss.health': 'Boss health',
  'boss.nameLevel': '{name} · Lv {level}',
  'boss.shield': '+{amount} shield',
  'boss.incoming': 'Incoming: {count} · {toggle}',
  'boss.hideDetails': 'Hide details',
  'boss.more': '+{count} more',
  'boss.phase': 'Phase {phase}/{total}',
  'fold.showBoss': 'Show boss details',
  'fold.hideBoss': 'Hide boss details',
  'fold.showWarnings': 'Show incoming attack details',
  'fold.hideWarnings': 'Hide incoming attack details',
  'warning.label': 'Incoming attack warning',
  'warning.folded': 'Incoming: {count}',
  'warning.foldedImminent': 'Incoming: {count} · lands next',

  // Boss phases and intents
  'phase.label': '{boss}, phase {numeral}: {title}',
  'phase.kicker': '{boss} · Phase {numeral}',
  'phase.continue': 'Tap to continue',
  'phase.strip': '{boss}: {title}, phase {phase} of {total}',
  'heart.torn': 'Torn open +25%',
  'heart.takes': 'takes {percent}',
  'intent.lands': 'Lands: {move}',
  'intent.then': '{first}, then {next}',
  'intent.next': 'Next: {moves}',
  'intent.nextFury': 'Next: {moves}. Fury: a second Bonebreaker Sweep each turn',
  'intent.kicker': 'NEXT',
  'intent.landing': '{move} lands',
  'intent.fury': 'FURY +Sweep',

  // Waves
  'wave.final': 'Final wave, {current} of {total}',
  'wave.more': {
    one: 'Wave {current} of {total}, {count} more to come',
    other: 'Wave {current} of {total}, {count} more to come',
  },
  'wave.kickerLast': 'LAST',
  'wave.kicker': 'WAVE',

  // The Rime Jarl's challenge
  'challenge.title': '{jarl} challenges {hero}',
  'challenge.accept': 'Accept',
  'challenge.acceptLabel': 'Accept the challenge',
  'challenge.circle': {
    one: 'A rune circle closes round the two of you for {count} turn each.',
    other: 'A rune circle closes round the two of you for {count} turns each.',
  },
  'challenge.rules': 'Neither can leave it or touch anyone else, and nobody can touch either. He hits {bonus} harder. Survive it and he kneels, losing a turn.',
  'challenge.refuse': 'Refuse',
  'challenge.refuseLabel': 'Refuse the challenge',
  'challenge.noCircle': 'No circle, and no one is marked or denied a turn.',
  'challenge.barrier': {
    one: 'The Jarl is wrapped in a {barrier}-point Barrier for {count} of his turns.',
    other: 'The Jarl is wrapped in a {barrier}-point Barrier for {count} of his turns.',
  },

  // The in-fight menu
  'leave.title': 'Save and exit',
  'leave.message': 'Your progress is saved. Continue restarts this same encounter from its beginning.',
  'leave.stay': 'Fight On',

  // Defeat
  'defeat.title': 'Defeat',
  'defeat.siegeTitle': 'The City Falls',
  'defeat.return': 'Return to City',
  'defeat.subtitle': 'Your party was overwhelmed.',
  'defeat.siegeSubtitle': 'The Legion takes what it was owed, and then some.',
  'defeat.penalties': 'Penalties',
  'defeat.items': {
    one: '{count} item lost from bag',
    other: '{count} items lost from bag',
  },
  'defeat.bagEmpty': 'Bag was empty',
  'defeat.xp': 'XP progress reset to 0',
  'defeat.gold': '{gold} lost',
  'defeat.noGold': 'No gold to lose',
  'defeat.buildings': 'Every building razed to level 0',
  'defeat.stores': 'Treasury and stores emptied',
};
