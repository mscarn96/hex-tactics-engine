# hex-tactics-engine

The rules of a turn-based tactics RPG played on a hex grid, written in TypeScript and covered by Jest
test suites. It handles combat, world generation, the economy, hero progression and quests.

This is the rules only. There is no user interface, graphics or sound, so there is nothing to play
here. You drive it from code and tests.

## Getting started

You need Node 24.

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

There are 338 test suites, and a full run takes about two minutes on a desktop machine. To run one
suite:

```bash
npx jest src/__tests__/combat/<suite>.test.ts
```

## What's in it

| folder | what it holds |
|---|---|
| `src/systems/combat` | turns, movement, targeting, skills, status effects, boss phases and enemy AI |
| `src/systems/world` | map generation, encounters, travel, threat, castles and lairs |
| `src/systems/economy` | loot, the forge, merchants, pricing and salvage |
| `src/systems/progression` | levelling, masteries, equipment rules, set bonuses and achievements |
| `src/systems/quests` | quest tracking, objectives, rewards and dialogue actions |
| `src/systems/save` | the save format and persistence |
| `src/systems/sim` | a headless fight simulator, which many suites use as a harness |
| `src/data` | the tables the rules read: skills, items, enemy and hero templates, and balance numbers |
| `src/stores` | game state, in plain `zustand` stores |
| `src/models` | shared types |
| `src/locations`, `src/quests` | location layouts and quest definitions |
| `src/i18n` | English text catalogs |

`zustand` is the only runtime dependency. See [`docs/architecture.md`](docs/architecture.md) for how the
layers fit together.

## Good to know

- **Story text is placeholder text.** Quest, character and place prose has been replaced, with its keys
  and parameters kept. Rules text, such as skill and item descriptions, is as written.
- **Tests pin the dice.** `jest.setup.ts` removes the random bonus-turn roll, so a suite that wants
  randomness sets its own dice.
- **This repository is generated.** It is produced from a private game project, and that project's
  history is not included. Changes made here do not flow back to it automatically.
- **The code was written with heavy AI assistance,** under human direction.

## License

Copyright 2026 mscarn96.

Licensed under the [Apache License, Version 2.0](LICENSE). See [`LICENSE`](LICENSE) for the full terms
and [`NOTICE`](NOTICE) for the required notice. You may use, change and distribute this code, including
commercially, as long as you follow those terms. It comes with no warranty.

**Not included and not licensed:** the name of the game this came from, and its art, models, audio, music
and story. The licence gives no rights to any project name or trademark (section 6).
