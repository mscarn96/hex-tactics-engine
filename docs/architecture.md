# Architecture

## Layers

```
src/stores/    game state
src/systems/   the rules: combat/ world/ economy/ progression/ quests/ save/ sim/
src/data/      tables the rules read: balanceConstants.ts, templates/, items/, skills/, display/
src/models/    shared types; models/types.ts re-exports them
src/i18n/      text catalogs and t()
src/utils/     small helpers, including the hex maths
src/platform/  what a host would provide: ids and key-value storage
```

- **A rule belongs in `systems/`.** Systems may read and write stores through `getState()` and
  `setState()`.
- **Tunable numbers belong in `data/balanceConstants.ts`,** under `BALANCE`, not inline.
- **`data/display` is left over from the game's presentation:** colours, sound ids, effect ids and
  lighting. A few combat paths still read it, and it ships no assets.
- **No barrel files in `systems/`.** Import each module by its direct path. `models/types.ts` is the one
  exception, since it only holds types.
- **`stores/`, `systems/` and `data/` have no import cycles.** The `importCycles` suite enforces this.

## Stores

Each store is a plain `zustand/vanilla` store with `getState()`, `setState()` and `subscribe()`. The
`use…Store` names come from the game they were written for. They aren't React hooks here.

Nothing persists automatically. `systems/save` builds and restores a save, and a save holds choices and
state rather than anything that can be worked out again. A hero's skills and base stats are derived on
load, for example, so a tuning change reaches a loaded game at once. There is no migration path: a save
whose version doesn't match `SAVE_VERSION` is discarded.

## Determinism

Combat rolls come from one source, `systems/combat/dice.ts`:

- `roll()` draws from `Math.random` unless told otherwise.
- `withDice(rng, fn)` pins the dice for one synchronous call.
- `setDice(rng)` replaces them until `setDice(null)`.

Speed-granted bonus turns have their own source, `setTempoRandom` in `systems/combat/turnTempo.ts`.

`jest.setup.ts` removes that bonus-turn roll for every suite and resets the dice after each test. A suite
about randomness has to set its own dice.

## Hex grid

Coordinates are axial, `{ q, r }`. `utils/hexUtils.ts` is the single source of truth, and `hexKey()`
gives the `"q,r"` key used for tiles and occupancy.

## Text

`t(key, params)` reads the catalogs in `i18n/locales/en`. Rules text is as written. Story catalogs hold
placeholders such as `[quests.some_key] {name}`, with real keys and parameters. A key that kept code needs
and a catalog lacks is a type error.

## Other pages

- [Combat](combat.md)
- [World](world.md)
- [Quests, progression and items](quests-progression-items.md)

These come from the game's own notes, so they sometimes mention screens, models and tools that aren't in
this repository.
