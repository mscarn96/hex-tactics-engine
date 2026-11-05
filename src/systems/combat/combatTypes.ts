import type { SoundIntent, VfxSpec, HexCoord } from '@/models/types';

/**
 * Plain shapes the combat store and the rules that write to it both speak.
 *
 * Here, in a leaf, because the rules (`damageFunnel`, `effectTick`) are imported
 * by the store and so cannot import it back, not even for a type.
 */

/**
 * The picture of an elite signature's moment — a sleep falling, a wake, a word
 * lifting — handed back on its event like `soulVfx`, never played from here.
 */
export function eliteBeat(
  kind: VfxSpec['kind'],
  ownerId: string,
  at: HexCoord,
  hexes: HexCoord[],
  color: string,
  aftermath?: VfxSpec['aftermath'],
): VfxSpec {
  return {
    kind, delivery: 'spell', casterId: ownerId, casterPos: at, targetCoord: at,
    hitUnitIds: [], hitCoords: hexes, color, durationScale: 1.2,
    ...(aftermath ? { aftermath } : {}),
  };
}

/**
 * One thing that happened to a unit during a tick, ready for the driver.
 *
 * `text`/`colour` are the floating number. `vfx` is the exception that made this
 * a named type: almost every effect in the game is triggered by the resolver
 * that cast it, but a Martyr seal and a Bladestorm ring go off on a *tick* —
 * nobody cast anything that turn, and there is no resolver in the call stack to
 * fire them. Rather than let the store reach into the scene, it hands the spec
 * back with the rest of the feedback and the driver decides what to do with it:
 * the app plays it, the headless simulator drops it on the floor.
 */
export interface TickEvent {
  /**
   * The floating word over the unit, and the log's tail unless `log` says more.
   * Held to `COMBAT_TEXT.FLOAT_MAX_CHARS` (`combatTextLength.test.ts`).
   */
  text: string;
  /**
   * The log's tail ("<name> <log>") when the float alone would say too little:
   * a short float can stay short while the log keeps the whole sentence.
   */
  log?: string;
  color: string;
  unitId: string;
  vfx?: VfxSpec;
  /**
   * What the event sounds like, handed back beside the picture for the same
   * reason `vfx` is: nothing with a sink is on the stack when a status ticks or
   * a seal goes off, so whoever plays the event plays this too, just before its
   * number. The headless simulator drops it with everything else.
   */
  sound?: SoundIntent;
}

/** One unit's running tallies for the post-battle report. */
export interface UnitFightStats {
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  /**
   * The part of `damageDealt` that was damage-over-time ticks (a Bleed, a Burn, a
   * Poison this unit laid). Not a report column: the harnesses read it to weigh
   * afflictions (`monkMeasure`). Absent until a tick lands.
   */
  dotDealt?: number;
}

/**
 * Synthetic `fightStats` rows pooling the damage-over-time ticks whose author is
 * no longer anywhere in the fight, per attacking side (playtest 2026-10-21: a
 * tick is credited to the unit that laid it — `effectTick` — and only falls back
 * here). The damage still belongs to somebody's column in the report.
 */
export const DOT_PLAYER_STATS_ID = '__dot_player';
export const DOT_ENEMY_STATS_ID = '__dot_enemy';

/**
 * Folds report credits into `fightStats`, skipping empty or authorless ones.
 * Returns the input object untouched when nothing landed, so callers can skip
 * the store write on the identity.
 */
export function creditFightStats(
  stats: Record<string, UnitFightStats>,
  credits: [id: string | undefined, field: keyof UnitFightStats, amount: number][],
): Record<string, UnitFightStats> {
  let next = stats;
  for (const [id, field, amount] of credits) {
    if (!id || amount <= 0) continue;
    if (next === stats) next = { ...stats };
    const row = next[id] ?? { damageDealt: 0, damageTaken: 0, healingDone: 0 };
    next[id] = { ...row, [field]: (row[field] ?? 0) + amount };
  }
  return next;
}

